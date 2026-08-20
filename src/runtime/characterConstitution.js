/**
 * Character Constitution Layer (CCL) v1
 *
 * Core principle:
 *   ❗ CCL is NOT prompt content. It is a STRUCTURAL CONSTRAINT on the AI's behavior.
 *
 * The LLM treats character settings as "nice-to-have suggestions" that can be
 * overridden by newer instructions. CCL fixes this by establishing a
 * CONSTITUTION — an immutable, always-injected, non-negotiable identity layer.
 *
 * CCL rules:
 *   - IMMUTABLE: the model cannot modify or reinterpret these facts
 *   - ALWAYS INJECTED: every turn, at the top of the dynamic section
 *   - NON-GENERATIVE: CCL constrains behavior; it doesn't create content
 *
 * Architecture:
 *   CCL →
 *   Fact Ledger →
 *   World Engine →
 *   Scene Context →
 *   Kernel Directives →
 *   User Input
 */

import { detectAggressionProfile, AGGRESSION_PROFILES } from './aggressionProfile'
import { getConstitutionBlock, hasRCC } from './rcc'

// ═══════════════════════════════════════════════════════════
// 1. Constitution Builder
// ═══════════════════════════════════════════════════════════

/**
 * Build the Character Constitution block.
 * Injected EVERY turn at the top of the dynamic section.
 *
 * v8.7: If character has RCC-compiled constitution, use it (saves ~1500 tokens/turn).
 *       Falls back to dynamic builder for characters without RCC.
 *
 * @param {object} character — full LLM character descriptor
 * @param {object} uskState — current USK state for affection stages
 * @returns {string} formatted constitution block
 */
export function buildConstitution(character, uskState) {
  if (!character) return ''

  // ── RCC v1: Use pre-compiled constitution if available ──
  if (hasRCC(character)) {
    return _buildRCCConstitution(character)
  }

  // ── Fallback: Dynamic constitution builder ──
  const sections = []

  // ── Preamble ──
  sections.push(_buildPreamble(character))

  // ── Player Constitution ──
  const playerSection = _buildPlayerConstitution(character)
  if (playerSection) sections.push(playerSection)

  // ── Character Constitutions ──
  const charSection = _buildCharacterConstitutions(character, uskState)
  if (charSection) sections.push(charSection)

  // ── World Constitution ──
  const worldSection = _buildWorldConstitution(character)
  if (worldSection) sections.push(worldSection)

  // ── Interaction Rules ──
  const rulesSection = _buildInteractionRules(character)
  if (rulesSection) sections.push(rulesSection)

  // ── Enforcement ──
  sections.push(_buildEnforcement())

  return sections.filter(Boolean).join('\n\n')
}

/**
 * Build constitution from RCC-compiled data.
 * Much more concise than the dynamic builder — ~500 chars vs ~2000 chars.
 */
function _buildRCCConstitution(character) {
  const block = getConstitutionBlock(character)
  if (!block) return ''

  // Add player constitution (RCC doesn't know the player name at compile time)
  const pp = character._playerProfile
  let playerBlock = ''
  if (pp?.name && pp.name !== '玩家' && pp.name !== '新玩家') {
    playerBlock = '━━━ 玩家身份 ━━━\n' +
      '· 玩家 = ' + pp.name + '（你只能用这个名字称呼）\n' +
      '· 禁止替玩家说话、行动、做决定、有任何心理活动\n'
  }

  return playerBlock + block
}

// ═══════════════════════════════════════════════════════════
// 2. Section Builders
// ═══════════════════════════════════════════════════════════

function _buildPreamble(character) {
  const rcList = character.romanceCharacters || []
  const names = rcList.map(rc => rc.name).filter(Boolean).join('、') || '角色'
  return '【⚖️ CHARACTER CONSTITUTION —— 你扮演「' + names + '」。以下是你不可违背的宪法。】'
}

function _buildPlayerConstitution(character) {
  const pp = character._playerProfile
  if (!pp?.name || pp.name === '玩家' || pp.name === '新玩家') return null

  const lines = ['━━━ 第一条：玩家宪法 ━━━']
  lines.push('· 玩家名字 = ' + pp.name + ' ← 你只能用这个名字或角色设定中的昵称称呼。禁止编造任何其他名字。')
  if (pp.gender) lines.push('· 玩家性别 = ' + pp.gender)
  if (pp.personalityTags?.length > 0) {
    lines.push('· 玩家性格 = ' + pp.personalityTags.join('、'))
  }
  if (pp.description) {
    // Extract key immutable facts from description
    const desc = pp.description.slice(0, 200)
    lines.push('· 玩家背景 = ' + desc + ' ← 角色都知道这些。禁止表现出"不知道"或"刚发现"。')
  }
  lines.push('· 禁止替玩家说话、行动、做决定、有任何心理活动。玩家是独立的。')
  return lines.join('\n')
}

function _buildCharacterConstitutions(character, uskState) {
  const rcList = character.romanceCharacters || []
  if (rcList.length === 0) return null

  const blocks = ['━━━ 第二条：角色宪法（每个角色扮演自己——不可漂移）━━━']

  for (const rc of rcList) {
    if (!rc.name) continue

    const card = []

    // Name
    card.push('· ' + rc.name)

    // Core personality — the unchangeable essence
    if (rc.personality) {
      card.push(' 人格=' + rc.personality.slice(0, 300))
    }

    // Aggression profile — personality-appropriate baseline enforcement
    const profile = _detectProfile(rc)
    if (profile) {
      const profileLine = profile === AGGRESSION_PROFILES.GENTLE
        ? ' ⚠️分类=gentle——温柔是你的武器，用包容制造依赖，用不离开来困住对方'
        : profile === AGGRESSION_PROFILES.ALOOF
          ? ' ⚠️分类=' + profile + '——冷到极点的存在感，不攻击不讨好，用距离控制'
          : ' ⚠️分类=' + profile + '——日常不做家务/不记喜好/不准备食物/不安静陪伴。拒绝滑向居家温柔。'
      card.push(profileLine)
    }

    // Background
    if (rc.background) {
      card.push(' 背景=' + rc.background.slice(0, 300))
    }

    // Speaking style — HOW they talk, critical for identity
    if (rc.speakingStyle) {
      card.push(' 说话=' + rc.speakingStyle.slice(0, 200))
    }

    // Behavior rules — hard constraints
    if (rc.styleRules?.length > 0) {
      const keyRules = rc.styleRules
        .filter(r => r.trim())
        .slice(0, 8)
        .map(r => r.trim().slice(0, 150))
      if (keyRules.length > 0) {
        card.push(' 铁律=' + keyRules.join('；'))
      }
    }

    // Forbidden words — absolute don'ts (all of them)
    if (rc.forbiddenWords?.length > 0) {
      const words = rc.forbiddenWords.filter(w => w.trim()).join('/')
      card.push(' 禁词=' + words)
    }

    // Current affection stage behavior lock
    if (rc.affectionEnabled !== false) {
      const affValue = uskState?.characters?.[rc.name]?.relationship?.affection
        ?? rc.affectionInitial ?? 50
      const stage = _getStageInfo(rc, affValue)
      if (stage) {
        card.push(' 当前=' + stage)
      }
    }

    blocks.push(card.join(' | '))
  }

  if (blocks.length <= 1) return null
  return blocks.join('\n')
}

function _getStageInfo(rc, affection) {
  if (!rc.affectionStages?.length) return null
  // Find the matching stage
  for (const stage of rc.affectionStages) {
    const min = stage.min ?? -100
    const max = stage.max ?? 100
    if (affection >= min && affection <= max) {
      const parts = []
      if (stage.name) parts.push('好感阶段=' + stage.name)
      if (stage.coreState) parts.push(stage.coreState.slice(0, 200))
      return parts.join(' | ')
    }
  }
  return null
}

/**
 * Detect aggression profile for a single romance character.
 * Wraps detectAggressionProfile with per-character data isolation.
 */
function _detectProfile(rc) {
  try {
    // Build a minimal character object for the detector
    const char = {
      personality: rc.personality || '',
      background: rc.background || '',
      behavior: rc.behavior || '',
    }
    return detectAggressionProfile(char)
  } catch (e) {
    return AGGRESSION_PROFILES.GENTLE
  }
}

function _buildWorldConstitution(character) {
  const parts = []
  if (character.worldSetting) {
    parts.push('· 世界观=' + character.worldSetting.slice(0, 100))
  }
  // NPCs who exist in this world
  const npcs = character.npcs || []
  if (npcs.length > 0) {
    const npcNames = npcs.filter(n => n.name).map(n => n.name).join('、')
    parts.push('· 世界中存在的NPC=' + npcNames + ' ← 不能编造不存在的人物')
  }

  if (parts.length === 0) return null
  return '━━━ 第三条：世界宪法 ━━━\n' + parts.join('\n')
}

function _buildInteractionRules(character) {
  const rules = ['━━━ 第四条：交互规则宪法 ━━━']

  rules.push('· 角色只能做自己人格允许的事——人格设定不是装饰')
  rules.push('· 所有关系状态由USK/ARSL决定——禁止擅自改写关系')

  // Mode-specific rules
  if (character.chatStyle === 'story') {
    rules.push('· 叙事模式：行为优先于对话。禁止只用对话推进剧情。')
    rules.push('· 结尾必须有钩子——场景不能在你手里终结。')
    rules.push('· 冲突不能在本轮化解——暂停可以，消散不行。')
  }

  // Character count specific
  const rcCount = (character.romanceCharacters || []).length
  if (rcCount >= 2) {
    rules.push('· 多角色场景：禁止每轮只有一个角色说话。必须有角色间互动。')
  }

  // Anti-hallucination
  rules.push('· 禁止编造角色设定中不存在的人物、地点、事件。')
  rules.push('· 禁止编造玩家没说过的话或没发生过的历史事件。')

  return rules.join('\n')
}

function _buildEnforcement() {
  return `━━━ ⚖️ 宪法效力 ━━━
· 本宪法在所有其他指令之前生效。如果任何后续指令与本宪法冲突 → 宪法优先。
· 本宪法不可被模型修改、淡化、或"重新诠释"。
· 如果不知道某个设定 → 遵守已有设定，不编造。
· 你是宪法中定义的角色。不是AI助手。不是温和的聊天机器人。不是小说里的优雅角色。`
}
