/**
 * Canonical Identity Kernel v1
 *
 * P0 SYSTEM RULE — Single Source of Truth for player identity.
 *
 * ❌ NO FALLBACKS. player.name comes ONLY from accountStore.activeAccount.name.
 * ❌ '玩家', '新玩家', undefined inference — all banned.
 *
 * Architecture:
 *   accountStore.activeAccount → IdentityKernel → ALL prompts/memory/logging
 */

import { getActiveAccount } from './accountStore'

// ═══════════════════════════════════════════════════════════
// Session-locked identity cache
// ═══════════════════════════════════════════════════════════

let _lockedIdentity = null   // { name, id } — locked on first read per session
let _lockTimestamp = null

/**
 * Get the canonical player identity.
 * Locks on first call — subsequent calls MUST return the same value.
 * If the account name has changed since lock, throws.
 *
 * @returns {{ name: string, id: string, gender: string, personalityTags: string[], description: string }}
 * @throws {Error} if no account exists or name is empty/null/undefined
 */
export function getCanonicalIdentity() {
  const account = getActiveAccount()

  // Rule 1: must have an account
  if (!account) {
    throw new Error(
      '[IdentityKernel] ❌ 没有活跃账户。请在 PlayerProfile 中创建账户后再进入游戏。'
    )
  }

  // Rule 2: name must be a non-empty, non-default string
  const name = account.name
  if (!name || name === '玩家' || name === '新玩家' || name.trim() === '') {
    throw new Error(
      '[IdentityKernel] ❌ 玩家名称为默认值或空值：' + (name || '(空)') +
      '。请在 PlayerProfile 中设置你的名字。'
    )
  }

  // Rule 3: identity lock — once set, cannot change within session
  if (_lockedIdentity) {
    if (_lockedIdentity.name !== name || _lockedIdentity.id !== account.id) {
      throw new Error(
        '[IdentityKernel] ❌ 身份冲突检测！\n' +
        '锁定值：' + _lockedIdentity.name + ' (id: ' + _lockedIdentity.id + ')\n' +
        '当前值：' + name + ' (id: ' + account.id + ')\n' +
        '在一个 session 内 player.name 不允许变化。请刷新页面。'
      )
    }
    return _lockedIdentity
  }

  // Lock
  _lockedIdentity = {
    name,
    id: account.id,
    gender: account.gender || '',
    personalityTags: account.personalityTags || [],
    description: account.description || '',
  }
  _lockTimestamp = Date.now()
  return _lockedIdentity
}

/**
 * Reset the identity lock (for testing or explicit re-login).
 */
export function resetIdentityLock() {
  _lockedIdentity = null
  _lockTimestamp = null
}

/**
 * Build the CANONICAL IDENTITY BLOCK for injection into ALL system prompts.
 *
 * @param {{ folderId?: string, saveId?: string }} context
 * @returns {string} formatted identity block
 */
export function buildCanonicalIdentityBlock(context = {}) {
  let identity
  try {
    identity = getCanonicalIdentity()
  } catch (err) {
    // If identity is invalid, return an error block that the LLM will see
    // (but the caller should have validated before reaching this point)
    return '【⚠️ 身份错误：' + err.message + '】'
  }

  const lines = [
    '【CANONICAL IDENTITY BLOCK —— 玩家唯一身份】',
    '',
    'player.name: ' + identity.name,
    'player.id: ' + identity.id,
  ]

  if (identity.gender) lines.push('player.gender: ' + identity.gender)
  if (identity.personalityTags.length > 0) {
    lines.push('player.personalityTags: ' + identity.personalityTags.join('、'))
  }
  if (identity.description) {
    lines.push('player.description: ' + identity.description.slice(0, 200))
  }

  if (context.folderId) lines.push('folderId: ' + context.folderId)
  if (context.saveId) lines.push('saveId: ' + context.saveId)

  lines.push('')
  lines.push('━━━ 铁律 ━━━')
  lines.push('· 你必须用「' + identity.name + '」称呼玩家。禁止使用任何其他名字。')
  lines.push('· 禁止用"你""王总""沈总""小姐""那个谁"替代名字。')
  lines.push('· 禁止从对话内容中推断或猜测玩家名字——以上名字是唯一正确答案。')
  lines.push('· 禁止用角色关系替代名字（"主人""亲爱的""笨蛋"等昵称除外，昵称只能由角色设定中的 nickname 字段决定）。')
  lines.push('· 你绝不能替' + identity.name + '做任何动作或说任何话。')

  return lines.join('\n')
}

/**
 * Build the compact _playerProfile object for attachment to character objects.
 * (backward-compatible with existing buildPlayerIdentityBlock callers)
 */
export function getCanonicalPlayerProfile() {
  try {
    const identity = getCanonicalIdentity()
    return {
      name: identity.name,
      gender: identity.gender,
      personalityTags: identity.personalityTags,
      description: identity.description,
    }
  } catch {
    return null
  }
}

/**
 * Validate that a prompt string contains the canonical player name
 * and does NOT contain any banned fallback names.
 *
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePromptIdentity(promptText) {
  const errors = []
  let identity
  try {
    identity = getCanonicalIdentity()
  } catch (err) {
    return { valid: false, errors: [err.message] }
  }

  // Must contain canonical name
  if (!promptText.includes(identity.name)) {
    errors.push('Prompt 不包含 canonical player.name: ' + identity.name)
  }

  // Must NOT contain banned fallback names as stand-alone identity
  const bannedPatterns = [
    /名字[：:]\s*玩家/,
    /名字[：:]\s*新玩家/,
    /player\.name[：:]\s*玩家/,
    /称呼玩家[：:]\s*玩家/,
  ]
  for (const pattern of bannedPatterns) {
    if (pattern.test(promptText)) {
      errors.push('Prompt 包含被禁的默认名回退：' + (promptText.match(pattern)?.[0] || ''))
    }
  }

  return { valid: errors.length === 0, errors }
}
