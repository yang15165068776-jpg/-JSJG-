/**
 * Narrative Identity Overlay (NIO) v1
 *
 * Per-save mutable player identity layer that sits BETWEEN
 *   AccountStore (fixed identity) → NIO (story-driven overlay) → Prompt (dynamic addressing)
 *
 * Problem: Player account has fixed name/gender/personality — can't follow plot.
 * Solution: Per-save overlay that the story can mutate (soul swap, possession, etc.).
 *
 * Architecture:
 *   accountStore.getActiveAccount() → base identity (immutable, locked)
 *   NIO state (per-save)           → overlay (mutated by story events)
 *   buildNarrativeIdentityBlock()   → prompt injection (dynamic addressing)
 *
 * Storage: localStorage key = jsjg_ni_<folderId>_<saveId>
 */

// ═══════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════

const STORAGE_PREFIX = 'jsjg_ni_'

/**
 * Preset scenarios with their default overlay configurations.
 * Each scenario defines: phase labels, default field hints, transition keywords.
 */
export const NIO_SCENARIOS = {
  soul_swap: {
    label: '灵魂置换',
    description: '玩家的灵魂在另一个人的身体里',
    defaultPhase: 'swapped',
    phases: ['swapped', 'transitioning', 'restored'],
    phaseLabels: {
      swapped: '已置换',
      transitioning: '换回中',
      restored: '已换回',
    },
    transitionKeywords: ['灵魂换回', '换回来', '恢复身体', '回到.*身体', '灵魂归位', '换回去', '交换回来'],
    apparentHint: '外表/身体的名字（被换入的身体）',
    trueHint: '真实灵魂（默认=玩家名）',
  },
  possession: {
    label: '被附身/被控制',
    description: '玩家被外力操控，行为不受自己控制',
    defaultPhase: 'possessed',
    phases: ['possessed', 'resisting', 'freed'],
    phaseLabels: {
      possessed: '被控制中',
      resisting: '抵抗中',
      freed: '已解脱',
    },
    transitionKeywords: ['附身解除', '控制.*解除', '挣脱.*控制', '夺回.*身体', '清醒过来', '恢复.*意识', '摆脱.*控制'],
    apparentHint: '附身者/控制者的名字',
    trueHint: '被控制的真实人格（默认=玩家名）',
  },
  dual_personality: {
    label: '双重人格',
    description: '玩家有两套人格，按触发条件切换',
    defaultPhase: 'personality_a',
    phases: ['personality_a', 'switching', 'personality_b', 'merged'],
    phaseLabels: {
      personality_a: '人格A主导',
      switching: '切换中',
      personality_b: '人格B主导',
      merged: '人格融合',
    },
    transitionKeywords: ['人格切换', '另一个人格', '变成.*样子', '切换.*人格', '人格融合', '变成另一个人'],
    apparentHint: '当前外在表现的人格名',
    trueHint: '核心/原始人格（默认=玩家名）',
  },
  impersonation: {
    label: '冒充/身份盗用',
    description: '有人冒充玩家，真正的玩家需要证明自己',
    defaultPhase: 'impersonated',
    phases: ['impersonated', 'exposed', 'restored'],
    phaseLabels: {
      impersonated: '被冒充中',
      exposed: '冒充暴露',
      restored: '身份恢复',
    },
    transitionKeywords: ['冒充.*暴露', '揭穿', '你不是', '真正的.*回来', '证明.*身份', '认出.*真假'],
    apparentHint: '冒充者的名字（别人看到的假身份）',
    trueHint: '真正的玩家身份（默认=玩家名）',
  },
  amnesia: {
    label: '失忆',
    description: '玩家忘记了自己的身份，角色知道但玩家不知道',
    defaultPhase: 'amnesiac',
    phases: ['amnesiac', 'recovering', 'remembered'],
    phaseLabels: {
      amnesiac: '失忆中',
      recovering: '恢复中',
      remembered: '已恢复',
    },
    transitionKeywords: ['想起来', '记起来', '恢复.*记忆', '回忆.*涌', '想起.*自己', '记忆.*恢复', '认出.*自己'],
    apparentHint: '失忆后的临时身份/称呼',
    trueHint: '真实身份（角色知道但玩家忘了）',
  },
  isekai: {
    label: '穿越',
    description: '玩家穿越到平行世界/过去/未来，身份变了',
    defaultPhase: 'isekai',
    phases: ['isekai', 'adapted', 'returned'],
    phaseLabels: {
      isekai: '穿越中',
      adapted: '已适应',
      returned: '已回归',
    },
    transitionKeywords: ['回到.*世界', '穿越.*回去', '返回.*原来', '回到现代', '传送回去', '时空.*回去'],
    apparentHint: '穿越后的身份/身体名',
    trueHint: '穿越前的真实身份（默认=玩家名）',
  },
}

// ═══════════════════════════════════════════════════════════
// State Creation & Persistence
// ═══════════════════════════════════════════════════════════

/**
 * Create a fresh (inactive) NIO state for a save.
 * @param {string} saveId
 * @param {object} accountProfile — { name, gender, personalityTags, description }
 * @returns {object} fresh NIO state
 */
export function createNarrativeIdentity(saveId, accountProfile = {}) {
  return {
    version: 1,
    saveId,
    active: false,
    scenario: '',
    baseIdentity: {
      name: accountProfile.name || '',
      gender: accountProfile.gender || '',
      personalityTags: accountProfile.personalityTags || [],
      description: accountProfile.description || '',
    },
    currentOverlay: {
      apparentName: '',
      apparentGender: '',
      apparentDescription: '',
      trueIdentity: accountProfile.name || '',
      trueGender: accountProfile.gender || '',
      trueDescription: accountProfile.description || '',
      whoSeesTruth: [],
      whoSeesAppearance: [],
      phase: '',
      phaseDescription: '',
    },
    autoDetect: true,
    changeLog: [],
  }
}

/**
 * Apply a scenario preset to the NIO state, filling default overlay values.
 * @param {object} niState — existing NIO state (mutated in place)
 * @param {string} scenario — one of NIO_SCENARIOS keys
 * @param {string[]} characterNames — list of romance character names
 * @returns {object} mutated niState
 */
export function applyScenarioPreset(niState, scenario, characterNames = []) {
  const preset = NIO_SCENARIOS[scenario]
  if (!preset) return niState

  niState.active = true
  niState.scenario = scenario
  niState.currentOverlay.phase = preset.defaultPhase
  niState.currentOverlay.phaseDescription = preset.phaseLabels[preset.defaultPhase] || ''
  niState.currentOverlay.whoSeesTruth = []
  niState.currentOverlay.whoSeesAppearance = [...characterNames]
  niState.changeLog = [{
    turn: 0,
    timestamp: Date.now(),
    fromPhase: '',
    toPhase: preset.defaultPhase,
    triggeredBy: 'initial_setup',
    summary: '叙事身份初始化：' + preset.label + '（' + preset.phaseLabels[preset.defaultPhase] + '）',
  }]

  return niState
}

// ═══════════════════════════════════════════════════════════
// Load / Save
// ═══════════════════════════════════════════════════════════

function _storageKey(folderId, saveId) {
  return STORAGE_PREFIX + folderId + (saveId ? '_' + saveId : '')
}

/**
 * Load NIO state from localStorage.
 * Tries save-level key first, then falls back to folder-level (migration).
 * @param {string} folderId
 * @param {string} saveId
 * @returns {object|null}
 */
export function loadNarrativeIdentity(folderId, saveId) {
  try {
    // Try save-level first
    if (saveId) {
      const saveKey = _storageKey(folderId, saveId)
      const saveRaw = localStorage.getItem(saveKey)
      if (saveRaw) {
        const parsed = JSON.parse(saveRaw)
        if (parsed.version === 1) {
          parsed._loadedFrom = 'save'
          return parsed
        }
      }
    }
    // Fallback to folder-level (created during world setup)
    const folderKey = _storageKey(folderId, '')
    const raw = localStorage.getItem(folderKey)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed.version !== 1) return null
    parsed._loadedFrom = 'folder'
    return parsed
  } catch (e) {
    console.warn('[NIO] Load failed:', e.message)
    return null
  }
}

/**
 * Save NIO state to localStorage.
 * @param {string} folderId
 * @param {string} saveId
 * @param {object} niState
 * @returns {boolean}
 */
export function saveNarrativeIdentity(folderId, saveId, niState) {
  try {
    if (!folderId || !niState) return false
    const key = _storageKey(folderId, saveId || '')
    niState.updatedAt = Date.now()
    localStorage.setItem(key, JSON.stringify(niState))
    return true
  } catch (e) {
    console.warn('[NIO] Save failed:', e.message)
    return false
  }
}

/**
 * Delete NIO state from localStorage.
 * @param {string} folderId
 * @param {string} saveId
 */
export function deleteNarrativeIdentity(folderId, saveId) {
  try {
    localStorage.removeItem(_storageKey(folderId, saveId || ''))
    return true
  } catch { return false }
}

// ═══════════════════════════════════════════════════════════
// Prompt Block Builder
// ═══════════════════════════════════════════════════════════

/**
 * Build the narrative identity prompt injection block.
 * This is injected into the CHARACTER_PREFIX (cached) so it's available every turn.
 *
 * @param {object} niState — NIO state (null/undefined if not active)
 * @returns {string} prompt block, or empty string if NIO not active
 */
export function buildNarrativeIdentityBlock(niState) {
  if (!niState?.active || !niState.scenario) return ''

  const preset = NIO_SCENARIOS[niState.scenario]
  if (!preset) return ''

  const ov = niState.currentOverlay || {}
  const bi = niState.baseIdentity || {}
  const phaseLabel = preset.phaseLabels[ov.phase] || ov.phase || ''

  const lines = [
    '',
    '【🎭 叙事身份覆盖 —— ' + preset.label + ' · 当前阶段：' + phaseLabel + '】',
    '',
  ]

  // Base identity
  if (bi.name) {
    lines.push('基础身份：' + bi.name + (bi.gender ? '（' + bi.gender + '）' : ''))
    lines.push('')
  }

  // Current narrative identity
  lines.push('当前叙事身份：' + (ov.phaseDescription || (preset.label + ' - ' + phaseLabel)))

  if (ov.apparentName) {
    lines.push('- 外表/身体：' + ov.apparentName + (ov.apparentGender ? '（' + ov.apparentGender + '）' : '') + (ov.apparentDescription ? ' —— ' + ov.apparentDescription : ''))
  }
  if (ov.trueIdentity) {
    lines.push('- 真实灵魂/人格：' + ov.trueIdentity + (ov.trueGender ? '（' + ov.trueGender + '）' : ''))
  }
  if (ov.trueDescription) {
    lines.push('- 真实心理：' + ov.trueDescription.slice(0, 200))
  }

  lines.push('')

  // Perception rules — who sees what
  const truthChars = ov.whoSeesTruth || []
  const appearChars = ov.whoSeesAppearance || []

  if (truthChars.length > 0 || appearChars.length > 0) {
    lines.push('━━━ 角色感知规则（角色对玩家的称呼和认知，严格按此执行）━━━')
    if (truthChars.length > 0) {
      lines.push('· 能看到真相的角色（知道真实灵魂是谁）：' + truthChars.join('、'))
      lines.push('  → 这些角色称呼「' + (ov.trueIdentity || bi.name) + '」，对真实灵魂说话')
      lines.push('  → 他们能察觉外表与灵魂的不一致，但不会说破设定')
    }
    if (appearChars.length > 0) {
      lines.push('· 只看外表的角色（不知道真相，只看到身体）：' + appearChars.join('、'))
      lines.push('  → 这些角色称呼「' + (ov.apparentName || '外表身份') + '」，把不协调的言行当成反常')
    }
    lines.push('')
  }

  // Phase-specific behavior rules
  lines.push('━━━ 叙事行为规则 ━━━')

  switch (niState.scenario) {
    case 'soul_swap':
      lines.push('· 角色看到的身体 ≠ 里面的灵魂。按上方「感知规则」决定称呼和态度')
      lines.push('· 如果故事推进到"换回灵魂"的情节（如角色施法、完成仪式），自然演进出换回过程')
      lines.push('· 禁止说破设定：不要说"你怎么在XX的身体里"这类打破第四面墙的台词')
      lines.push('· 换回后：所有角色自动恢复正常称呼，phase 变为 restored')
      break
    case 'possession':
      lines.push('· 玩家的言行可能不是自己的意志。角色可以察觉异常（眼神空洞、语气变化、行为反常）')
      lines.push('· 知道真相的角色可能在试图驱除附身者')
      lines.push('· 附身解除后：玩家恢复正常，phase 变为 freed')
      break
    case 'dual_personality':
      lines.push('· 玩家有两套人格，可能因为情绪/关键词/场景触发切换')
      lines.push('· 角色对不同人格可能有不同的态度和称呼')
      lines.push('· 人格切换是故事的一部分，角色可以察觉并做出反应')
      break
    case 'impersonation':
      lines.push('· 有人冒充玩家。角色需要辨别真假')
      lines.push('· 真正的玩家可能需要证明自己的身份')
      lines.push('· 冒充暴露后：身份恢复，phase 变为 restored')
      break
    case 'amnesia':
      lines.push('· 玩家不知道自己的真实身份，但角色知道')
      lines.push('· 角色面对的是一个"不记得自己是谁"的玩家')
      lines.push('· 记忆恢复是渐进的过程')
      break
    case 'isekai':
      lines.push('· 玩家来自另一个世界/时间线，身份和周围环境不匹配')
      lines.push('· 角色可能察觉玩家的"格格不入"')
      lines.push('· 穿越回去后：phase 变为 returned')
      break
    default:
      break
  }

  lines.push('· 禁止替玩家做任何内心描写、动作、说话、决策')
  lines.push('· 叙事身份变化是故事推进的自然结果，不是"设定被改了"')
  lines.push('')

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// Change Detection (Rule-Based — NO LLM CALL)
// ═══════════════════════════════════════════════════════════

/**
 * Detect if the LLM reply contains events that should trigger a narrative
 * identity phase change. Pure regex + keyword — no extra API call.
 *
 * @param {string} reply — the LLM-generated reply
 * @param {object} niState — current NIO state (null if not active)
 * @param {string[]} characterNames — list of romance character names
 * @returns {object|null} change descriptor, or null if no change detected
 */
export function detectIdentityChange(reply, niState, characterNames = []) {
  if (!niState?.active || !niState.scenario || !niState.autoDetect) return null
  if (!reply) return null

  const preset = NIO_SCENARIOS[niState.scenario]
  if (!preset) return null

  const currentPhase = niState.currentOverlay?.phase || ''
  const previousPhases = niState.changeLog?.map(l => l.fromPhase) || []

  // Check each transition keyword
  for (const kw of (preset.transitionKeywords || [])) {
    const regex = new RegExp(kw, 'i')
    if (regex.test(reply)) {
      // Determine target phase based on keyword match and current phase
      let targetPhase = ''
      const phases = preset.phases || []

      // Find the next phase after current
      const currentIdx = phases.indexOf(currentPhase)
      if (currentIdx >= 0 && currentIdx < phases.length - 1) {
        // Check if this keyword specifically targets a later phase
        // For "restore/return" type keywords → jump to final phase
        if (/换回|恢复|解除|回归|回来|回去|融合|暴露|记起|想起/.test(kw)) {
          targetPhase = phases[phases.length - 1]  // Final phase
        } else {
          targetPhase = phases[currentIdx + 1]  // Next phase
        }
      } else if (currentIdx === phases.length - 1) {
        // Already at final phase — could cycle back for dual_personality
        if (niState.scenario === 'dual_personality' && phases.length > 1) {
          targetPhase = phases[0]  // Cycle back
        }
      }

      if (targetPhase && targetPhase !== currentPhase && !previousPhases.includes(targetPhase)) {
        return {
          fromPhase: currentPhase,
          toPhase: targetPhase,
          triggeredBy: 'keyword:' + kw,
          summary: '检测到关键词「' + kw + '」→ 阶段变更：' +
            (preset.phaseLabels[currentPhase] || currentPhase) +
            ' → ' + (preset.phaseLabels[targetPhase] || targetPhase),
        }
      }
    }
  }

  return null
}

/**
 * Apply a detected identity change to the NIO state.
 * @param {object} niState — NIO state (mutated in place)
 * @param {object} change — from detectIdentityChange()
 * @param {number} turnNumber — current turn number
 * @returns {object} mutated niState
 */
export function applyIdentityChange(niState, change, turnNumber = 0) {
  if (!niState || !change) return niState

  const preset = NIO_SCENARIOS[niState.scenario]
  const oldPhase = change.fromPhase
  const newPhase = change.toPhase

  niState.currentOverlay.phase = newPhase
  niState.currentOverlay.phaseDescription = (preset?.phaseLabels?.[newPhase]) || newPhase

  // Special handling for restored/freed/remembered/returned phases:
  // Clear the overlay since identity is back to normal
  if (['restored', 'freed', 'remembered', 'returned', 'merged'].includes(newPhase)) {
    // Don't clear everything — keep the record. Just update phase.
    // The prompt block builder will show the restored state.
  }

  niState.changeLog.push({
    turn: turnNumber,
    timestamp: Date.now(),
    fromPhase: oldPhase,
    toPhase: newPhase,
    triggeredBy: change.triggeredBy || 'story_event',
    summary: change.summary || ('阶段变更：' + oldPhase + ' → ' + newPhase),
  })

  // Keep changeLog manageable
  if (niState.changeLog.length > 20) {
    niState.changeLog = niState.changeLog.slice(-20)
  }

  return niState
}
