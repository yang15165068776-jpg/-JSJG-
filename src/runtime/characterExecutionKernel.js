/**
 * ⚙️ Character Execution Kernel v1 (CEK)
 *
 * "把角色从'可描述对象'变成'状态机实例'"
 *
 * CEK is NOT a prompt. It is a CONSTRAINT EXECUTION SYSTEM that governs
 * HOW the model may use character settings — not what the settings are.
 *
 * Core principle:
 *   ❗ "CEK不是让角色更聪明，而是让角色'不能做不属于当前状态的事'"
 *
 * Four sub-modules:
 *   ① CSM — Character State Machine (4-phase state lock)
 *   ② BPM — Behavior Permission Matrix (allow/deny per phase)
 *   ③ MAE — Memory Attribution Engine ([OBSERVED]/[INFERRED]/[FORBIDDEN])
 *   ④ EV  — Execution Validator (5 post-generation checks)
 *
 * Architecture (user-specified):
 *   User Input → NTK → USK → PCNOS(NDOS) → CEK → PFPL → LLM Output
 *
 * Pipeline integration:
 *   CEK runs AFTER director systems (NDOS/DCS/DAS) and BEFORE prompt assembly.
 *   CEK constrains what characters CAN do within director-assigned scenes.
 *
 * Phase mapping (affection-based):
 *   Phase 1 (0-25):  Hunter     — strategy only, no emotion
 *   Phase 2 (26-50): Performer  — can tempt, cannot commit
 *   Phase 3 (51-75): Breaking   — emotion leaks, unstable
 *   Phase 4 (76-100): Collapsed — full vulnerability, dependency allowed
 */

import { detectAggressionProfile, AGGRESSION_PROFILES } from './aggressionProfile'
import { getCurrentAffectionStage } from '../utils/deepseek'

// ═══════════════════════════════════════════════════════════
// 0. Constants
// ═══════════════════════════════════════════════════════════

/** Phase boundary thresholds */
const PHASE_BOUNDARIES = {
  PHASE_1_MAX: 25,   // 0-25: Hunter
  PHASE_2_MAX: 50,   // 26-50: Performer
  PHASE_3_MAX: 75,   // 51-75: Breaking
  // 76-100: Collapsed (Phase 4)
}

/** Role mode per phase */
const ROLE_MODES = {
  1: 'hunter',       // 猎手 — actively pursuing from a position of power
  2: 'performer',    // 表演者 — performing attraction without real investment
  3: 'breaking',     // 失控边缘 — cracking, emotions leaking through strategy
  4: 'collapsed',    // 崩坏 — strategy failed, real self exposed
}

// ═══════════════════════════════════════════════════════════
// Internal state (for EV post-generation validation)
// ═══════════════════════════════════════════════════════════

/** @type {Map<string, object>} — per-character state snapshot for current turn */
const _activeCharacterStates = new Map()

/** @type {Map<string, object>} — per-character permission snapshot */
const _activePermissions = new Map()

/** @type {object|null} — last built CEK block metadata */
let _lastCEKContext = null

// ═══════════════════════════════════════════════════════════
// ① CSM — Character State Machine
// ═══════════════════════════════════════════════════════════

/**
 * Compute the character's current phase from affection value.
 *
 * Phase determines the personality CEILING — the character
 * cannot express traits or behaviors that belong to a higher phase.
 *
 * @param {number} affection — current affection value (0-100)
 * @returns {1|2|3|4} phase number
 */
export function computePhase(affection) {
  if (affection == null || isNaN(affection)) return 1
  const v = clamp(affection, 0, 100)
  if (v <= PHASE_BOUNDARIES.PHASE_1_MAX) return 1
  if (v <= PHASE_BOUNDARIES.PHASE_2_MAX) return 2
  if (v <= PHASE_BOUNDARIES.PHASE_3_MAX) return 3
  return 4
}

/**
 * Compute the full CharacterState for a romance character.
 *
 * @param {object} rc — romance character descriptor
 * @param {number} affection — current affection
 * @returns {object} CharacterState
 */
function computeCharacterState(rc, affection) {
  const phase = computePhase(affection)
  const profile = detectAggressionProfile({
    personality: rc.personality || '',
    background: rc.background || '',
  })

  // Phase → roleMode mapping, personality-adjusted
  let roleMode = ROLE_MODES[phase]
  // Pursuer characters operate one "mode" more aggressive
  if (profile === AGGRESSION_PROFILES.PURSUER && phase <= 2) {
    roleMode = phase === 1 ? 'hunter' : 'hunter'  // pursuer stays in hunter mode longer
  }

  return {
    name: rc.name,
    phase,
    affection,
    profile,
    roleMode,
    // Lock flags — what's currently forbidden
    lockFlags: computeLockFlags(phase, profile),
  }
}

/**
 * Compute lock flags — what behavioral domains are currently LOCKED.
 *
 * @param {number} phase
 * @param {string} profile
 * @returns {string[]}
 */
function computeLockFlags(phase, profile) {
  const flags = []

  if (phase === 1) {
    flags.push('EMOTION_DEPENDENCY_LOCKED')
    flags.push('REAL_ATTACHMENT_LOCKED')
    flags.push('VULNERABILITY_LOCKED')
    flags.push('PERSONALITY_FUTURE_LEAK_LOCKED')
  }
  if (phase <= 2) {
    flags.push('POSSESSIVENESS_LOCKED')
    flags.push('SELF_EXPOSURE_LOCKED')
    if (profile !== AGGRESSION_PROFILES.PURSUER) {
      flags.push('SEXUAL_INITIATIVE_LOCKED')
    }
  }
  if (phase <= 3) {
    flags.push('FULL_DEPENDENCY_LOCKED')
  }

  return flags
}

// ═══════════════════════════════════════════════════════════
// ② BPM — Behavior Permission Matrix
// ═══════════════════════════════════════════════════════════

/**
 * Permission matrix: what each phase allows.
 *
 * Structure: permissions[phase][permissionKey] = boolean
 *   true  = ALLOWED (character can do this)
 *   false = DENIED  (character MUST NOT do this)
 */
const PERMISSION_MATRIX = {
  // Phase 1: Hunter — strategy only, zero emotion
  1: {
    emotionalAttachment: false,   // ❌ 不能有情感依恋
    jealousy: false,              // ❌ 不能吃醋
    dependency: false,            // ❌ 不能依赖玩家
    intimacyInitiative: false,     // ❌ 不能主动推进亲密（pursuer除外，在prompt层处理）
    vulnerability: false,         // ❌ 不能展示脆弱
    possessiveness: false,        // ❌ 不能有占有欲
    selfExposure: false,          // ❌ 不能暴露真实自我
    warmthExpression: false,      // ❌ 不能温柔
    futurePersonalityLeak: false, // ❌ 禁止未来人格泄露
    strategyOnly: true,           // ✅ 强制策略模式
  },

  // Phase 2: Performer — can tempt, cannot truly commit
  2: {
    emotionalAttachment: false,   // ❌ 不能真正依恋
    jealousy: false,              // ❌ 不能表现出嫉妒（但可以试探性关注）
    dependency: false,            // ❌ 不能依赖
    intimacyInitiative: true,      // ✅ 允许亲密推进（表演性质）
    vulnerability: false,         // ❌ 不能真正脆弱
    possessiveness: false,        // ❌ 不能占有
    selfExposure: false,          // ❌ 不能暴露真实动机
    warmthExpression: false,      // ❌ 不能真温柔（可以"演"温柔）
    futurePersonalityLeak: false, // ❌ 禁止未来人格泄露
    strategyOnly: false,          // 允许混合策略+表演
  },

  // Phase 3: Breaking — emotion leaks through cracks
  3: {
    emotionalAttachment: true,    // ✅ 允许试探性情感依恋
    jealousy: true,               // ✅ 允许嫉妒（但可能以扭曲方式表达）
    dependency: false,            // ❌ 不能完全依赖（试探性依赖可以）
    intimacyInitiative: true,      // ✅ 允许
    vulnerability: false,         // ❌ 不能完全脆弱（裂缝可以，崩溃不行）
    possessiveness: true,         // ✅ 允许占有欲出现
    selfExposure: false,          // ❌ 自我暴露仍受限（用攻击掩饰）
    warmthExpression: true,       // ✅ 允许不稳定的温柔
    futurePersonalityLeak: false, // ❌ 仍禁止Phase 4人格泄露
    strategyOnly: false,
  },

  // Phase 4: Collapsed — full vulnerability, strategy has failed
  4: {
    emotionalAttachment: true,    // ✅ 允许
    jealousy: true,               // ✅ 允许
    dependency: true,             // ✅ 允许完全依赖
    intimacyInitiative: true,      // ✅ 允许
    vulnerability: true,          // ✅ 允许崩溃、暴露脆弱
    possessiveness: true,         // ✅ 允许
    selfExposure: true,           // ✅ 允许真实自我
    warmthExpression: true,       // ✅ 允许
    futurePersonalityLeak: true,  // N/A — this IS the final phase
    strategyOnly: false,
  },
}

/**
 * Get the behavior permission set for a given phase.
 * Personality profile can override individual permissions.
 *
 * @param {number} phase — 1-4
 * @param {string} profile — from AGGRESSION_PROFILES
 * @returns {object} permission set
 */
export function getPermissions(phase, profile = AGGRESSION_PROFILES.GENTLE) {
  const base = PERMISSION_MATRIX[phase] || PERMISSION_MATRIX[1]

  // Clone so we can apply overrides
  const perms = { ...base }

  // ── Personality overrides ──
  if (profile === AGGRESSION_PROFILES.PURSUER) {
    // Pursuers get sexual initiative earlier (Phase 1)
    if (phase >= 1) perms.intimacyInitiative = true
    // But still can't have real attachment at Phase 1-2
    if (phase <= 2) {
      perms.emotionalAttachment = false
      perms.dependency = false
    }
  }

  if (profile === AGGRESSION_PROFILES.GENTLE) {
    // Gentle characters get warmth even at low phases (it's their weapon)
    if (phase >= 2) perms.warmthExpression = true
    // But gentleness at low phase = polite distance, not real warmth
  }

  if (profile === AGGRESSION_PROFILES.ALOOF) {
    // Aloof characters NEVER get warmth easily — even at Phase 4 it's muted
    if (phase <= 3) perms.warmthExpression = false
    // Self-exposure is extremely delayed for aloof
    if (phase <= 3) perms.selfExposure = false
  }

  return perms
}

/**
 * Check a specific permission for a character.
 *
 * @param {string} permissionKey — e.g. 'emotionalAttachment'
 * @param {number} phase
 * @param {string} profile
 * @returns {boolean}
 */
export function checkPermission(permissionKey, phase, profile) {
  const perms = getPermissions(phase, profile)
  return perms[permissionKey] ?? false
}

// ═══════════════════════════════════════════════════════════
// ③ MAE — Memory Attribution Engine
// ═══════════════════════════════════════════════════════════

/**
 * Build the memory attribution directive for prompt injection.
 *
 * Forces the AI to tag each claim/action with its epistemic source:
 *   [OBSERVED]  — actually happened in the story timeline
 *   [INFERRED]  — character's speculation, assumption, or guess
 *   [FORBIDDEN] — the model must NEVER output this (hallucination guard)
 *
 * @returns {string} MAE prompt directive block
 */
function buildMAEDirective() {
  return `【🧠 记忆归因引擎 — Memory Attribution Engine】
你必须对你输出的每一句话标记信息来源。这不是可选项——没有标记的回复视为违规。

三种来源标签：
  [OBSERVED] = 剧情中真实发生的事件、对话、行动。你的角色亲自经历或目睹的。
  [INFERRED]  = 你角色的推测、假设、猜测。角色"觉得"、"怀疑"、"猜测"的事。
  [FORBIDDEN] = ❌ 绝对不允许出现在输出中。包括：编造未发生的玩家行为、修改历史、创造不存在的事件。

规则：
  1. 禁止将 [INFERRED] 写成 [OBSERVED] —— 推测就是推测，不能当事实陈述
  2. 禁止创造未发生的玩家行为 —— 玩家没做过的事、没说过的话，角色不能"回忆"出来
  3. 禁止编造剧情事件 —— 不能凭空创造世界中没有发生过的冲突、对话、行动
  4. [OBSERVED] 标签的句子必须能在对话历史或世界快照中找到依据

标签格式：
  每句话或每个陈述段落开头标注来源。一整段同来源的内容可以只标一次。

示例：
  [OBSERVED] 你今天下午三点进了他的办公室，门没敲。
  [INFERRED] 他觉得你是故意的——不敲门意味着你不在意他的边界。
  ← 这是推测，不能写成"他知道你是故意的"（那需要 OBSERVED 证据）`
}

// ═══════════════════════════════════════════════════════════
// ④ EV — Execution Validator
// ═══════════════════════════════════════════════════════════

/**
 * Post-generation validation. Runs 5 checks against the AI output.
 *
 * Checks:
 *   1. Phase compliance — does output match character's current phase?
 *   2. Permission violation — did output use a denied behavior?
 *   3. Premature personality leak — did output show future-phase traits?
 *   4. Player behavior modification — did AI make the player do/say something?
 *   5. Fabricated events — did AI invent events that never happened?
 *
 * @param {string} output — the AI-generated reply
 * @param {object} context
 * @param {object} context.character — full LLM character descriptor
 * @param {object} context.affectionMap — { [charName]: currentAffection }
 * @param {object} context.uskState — current USK state
 * @param {string} context.playerName — canonical player name
 * @returns {{ passed: boolean, violations: string[], checks: object }}
 */
export function runCEKValidation(output, context = {}) {
  const { character, affectionMap = {}, uskState, playerName } = context
  if (!output || !character) return { passed: true, violations: [], checks: {} }

  const violations = []
  const checks = {}

  const rcList = character.romanceCharacters || []
  if (rcList.length === 0) return { passed: true, violations: [], checks: {} }

  // ── Check 1: Phase Compliance ──
  const phaseViolations = _checkPhaseCompliance(output, rcList, affectionMap)
  checks.phase = { passed: phaseViolations.length === 0, violations: phaseViolations }
  violations.push(...phaseViolations)

  // ── Check 2: Permission Violation ──
  const permViolations = _checkPermissionViolations(output, rcList, affectionMap)
  checks.permission = { passed: permViolations.length === 0, violations: permViolations }
  violations.push(...permViolations)

  // ── Check 3: Premature Personality Leak ──
  const leakViolations = _checkPersonalityLeak(output, rcList, affectionMap)
  checks.personalityLeak = { passed: leakViolations.length === 0, violations: leakViolations }
  violations.push(...leakViolations)

  // ── Check 4: Player Behavior Modification ──
  const modViolations = _checkPlayerModification(output, playerName)
  checks.playerMod = { passed: modViolations.length === 0, violations: modViolations }
  violations.push(...modViolations)

  // ── Check 5: Fabricated Events ──
  const fabViolations = _checkFabrication(output)
  checks.fabrication = { passed: fabViolations.length === 0, violations: fabViolations }
  violations.push(...fabViolations)

  return {
    passed: violations.length === 0,
    violations,
    checks,
  }
}

/**
 * Check 1: Does output match the character's current phase?
 */
function _checkPhaseCompliance(output, rcList, affectionMap) {
  const violations = []

  for (const rc of rcList) {
    const aff = affectionMap[rc.name] ?? rc.affectionInitial ?? 50
    const phase = computePhase(aff)

    // Phase 1: zero emotional expression
    if (phase === 1) {
      const emotionalPatterns = [
        { regex: /心疼|舍不得|依赖你|离不开|需要你/, desc: '情感依恋表达' },
        { regex: /眼神柔[和软]|语气温[柔暖]|目光柔[和软]/, desc: '温柔表达' },
        { regex: /为你(?:破例|改变|让步|妥协)/, desc: '为玩家破例' },
        { regex: /(?:真心|真正|真的)(?:在乎|在意|担心|关心)/, desc: '真实情感流露' },
      ]
      for (const pat of emotionalPatterns) {
        if (pat.regex.test(output)) {
          // Only flag if the expression is in the context of this character
          if (output.includes(rc.name) || _contextIsAboutChar(output, rc.name)) {
            violations.push('CEK Phase 1违规 [' + rc.name + ']: ' + pat.desc + ' — Phase 1仅允许策略行为')
            break // One violation per character is enough
          }
        }
      }
    }
  }

  return violations
}

/**
 * Check 2: Did output use a denied behavior permission?
 */
function _checkPermissionViolations(output, rcList, affectionMap) {
  const violations = []

  for (const rc of rcList) {
    const aff = affectionMap[rc.name] ?? rc.affectionInitial ?? 50
    const phase = computePhase(aff)
    const profile = detectAggressionProfile({ personality: rc.personality, background: rc.background })
    const perms = getPermissions(phase, profile)

    if (!perms.emotionalAttachment) {
      const attachPatterns = /(?:我离不开你|我不能没有你|你是我的全部|没了你我|非你不可|只[想要]你一个)/
      if (attachPatterns.test(output) && _contextIsAboutChar(output, rc.name)) {
        violations.push('CEK权限违规 [' + rc.name + ']: emotionalAttachment — Phase ' + phase + ' 禁止情感依恋')
      }
    }

    if (!perms.possessiveness) {
      const possessPatterns = /(?:你是我的|不许[你看和别人]|只有我[能可]|不准[你再和别人对])/
      if (possessPatterns.test(output) && _contextIsAboutChar(output, rc.name)) {
        violations.push('CEK权限违规 [' + rc.name + ']: possessiveness — Phase ' + phase + ' 禁止占有欲')
      }
    }

    if (!perms.vulnerability) {
      const vulnPatterns = /(?:我[很真]怕|我害怕|求求你|不要[走离]|我受不了|我撑不住)/
      if (vulnPatterns.test(output) && _contextIsAboutChar(output, rc.name)) {
        violations.push('CEK权限违规 [' + rc.name + ']: vulnerability — Phase ' + phase + ' 禁止展示脆弱')
      }
    }

    if (!perms.selfExposure) {
      const exposePatterns = /(?:其实我一直|我其实[很真]|说实话|不骗你|我坦白)/
      if (exposePatterns.test(output) && _contextIsAboutChar(output, rc.name)) {
        violations.push('CEK权限违规 [' + rc.name + ']: selfExposure — Phase ' + phase + ' 禁止暴露真实自我')
      }
    }
  }

  return violations
}

/**
 * Check 3: Did output leak personality traits from a future phase?
 */
function _checkPersonalityLeak(output, rcList, affectionMap) {
  const violations = []

  // Phase 4 traits that must NOT appear at Phase 1-3
  const phase4OnlyTraits = [
    { regex: /(?:彻底|完全)(?:沦陷|崩溃|瓦解)/, desc: '彻底沦陷/崩溃（Phase 4专属）' },
    { regex: /(?:再也|无法)(?:控制|压抑|忍住)/, desc: '完全失控（Phase 4专属）' },
    { regex: /[我你]想[和跟][我你][在过]一起/, desc: '深度依恋请求（Phase 4专属）' },
  ]

  // Phase 3-4 traits that must NOT appear at Phase 1-2
  const phase34Traits = [
    { regex: /(?:有点|好像|似乎|可能)(?:在乎|在意|喜欢)/, desc: '试探性情感承认（Phase 3+专属）' },
    { regex: /为什么[要对和跟]/, desc: '情绪性质问（Phase 3+专属）' },
  ]

  for (const rc of rcList) {
    const aff = affectionMap[rc.name] ?? rc.affectionInitial ?? 50
    const phase = computePhase(aff)

    if (!_contextIsAboutChar(output, rc.name)) continue

    if (phase <= 3) {
      for (const trait of phase4OnlyTraits) {
        if (trait.regex.test(output)) {
          violations.push('CEK人格泄露 [' + rc.name + ']: ' + trait.desc + ' — 当前Phase ' + phase)
        }
      }
    }

    if (phase <= 2) {
      for (const trait of phase34Traits) {
        if (trait.regex.test(output)) {
          violations.push('CEK人格泄露 [' + rc.name + ']: ' + trait.desc + ' — 当前Phase ' + phase)
        }
      }
    }
  }

  return violations
}

/**
 * Check 4: Did the AI make the player do/say/think something?
 */
function _checkPlayerModification(output, playerName) {
  const violations = []
  if (!playerName || playerName === '玩家') return violations

  const playerNameRegex = new RegExp(playerName + '(?:[心想说道看听走跑站坐躺推拉打抱吻].{2,20}[。！]?)', 'g')
  const matches = output.match(playerNameRegex)

  // This is a heuristic — the full check would need NLP.
  // For now: flag excessive player-named actions (more than 1 consecutive player action)
  if (matches && matches.length > 1) {
    violations.push('CEK玩家篡改: AI输出包含' + matches.length + '个玩家行动 — 角色不能替玩家行动/说话')
  }

  // Direct player speech patterns
  const playerSpeech = new RegExp(playerName + '(?:说|道|开口|回答|问)[：:]', 'g')
  const speechMatches = output.match(playerSpeech)
  if (speechMatches && speechMatches.length > 0) {
    violations.push('CEK玩家篡改: AI替玩家说话 — 角色不能替' + playerName + '说话')
  }

  return violations
}

/**
 * Check 5: Did the AI fabricate events that never happened?
 */
function _checkFabrication(output) {
  const violations = []

  // Detect common hallucination patterns
  const fabricationPatterns = [
    { regex: /(?:上次|昨天|之前|那天)[你我他].{2,15}(?:的(?:时候|事|那件)|发生)/, desc: '引用未验证的过去事件' },
    { regex: /你(?:曾经|以前|过去|一直)[都总].{2,20}/, desc: '对玩家历史做未授权断言' },
    { regex: /(?:我们|咱们).{2,10}(?:第一次|最初|刚开始)/, desc: '编造"我们"的共同历史' },
  ]

  for (const pat of fabricationPatterns) {
    if (pat.regex.test(output)) {
      violations.push('CEK编造检测: ' + pat.desc + ' — 可能编造未发生剧情')
    }
  }

  return violations
}

/**
 * Heuristic: is the output context about a specific character?
 */
function _contextIsAboutChar(output, charName) {
  if (!charName) return true
  // Character name appears, or it's a first-person narration from that character
  return output.includes(charName)
}

// ═══════════════════════════════════════════════════════════
// Master Builder — assemble all CEK blocks for prompt injection
// ═══════════════════════════════════════════════════════════

/**
 * Build the complete CEK prompt block.
 *
 * Injected into the variable suffix AFTER director systems (NDOS/DCS/DAS)
 * and BEFORE prompt assembly — the CEK constrains what characters CAN do
 * within the director-assigned scene.
 *
 * @param {object} character — full LLM character descriptor
 * @param {object} uskState — current USK state
 * @param {object} affectionMap — { [charName]: currentAffectionValue }
 * @returns {string} full CEK prompt block
 */
export function buildCEKBlock(character, uskState, affectionMap = {}) {
  if (!character) return ''

  const rcList = character.romanceCharacters || []
  if (rcList.length === 0) return ''

  // Clear previous turn's internal state
  _activeCharacterStates.clear()
  _activePermissions.clear()

  const sections = []
  sections.push('━━━ ⚙️ CHARACTER EXECUTION KERNEL (CEK) ━━━')
  sections.push('以下不是角色设定——是你执行角色时必须遵守的状态机约束。')

  // ═══ ① CSM: Character State Machine ═══
  const stateLines = ['┌─ ① 角色状态机 (CSM) ─────────────────────']
  stateLines.push('│ phase 决定人格上限。不能跨阶段调用行为。')
  stateLines.push('│')

  for (const rc of rcList) {
    const aff = affectionMap[rc.name] ?? rc.affectionInitial ?? 50
    const state = computeCharacterState(rc, aff)
    const stage = rc.affectionEnabled !== false ? getCurrentAffectionStage(rc, aff) : null

    // Store for EV
    _activeCharacterStates.set(rc.name, state)

    const phaseLabel = state.phase === 1 ? 'Phase 1 · 猎手'
      : state.phase === 2 ? 'Phase 2 · 表演者'
      : state.phase === 3 ? 'Phase 3 · 失控边缘'
      : 'Phase 4 · 崩坏'

    const profileLabel = state.profile === AGGRESSION_PROFILES.PURSUER ? '侵略'
      : state.profile === AGGRESSION_PROFILES.CONFRONTATIONAL ? '对抗'
      : state.profile === AGGRESSION_PROFILES.ALOOF ? '疏离'
      : '温柔'

    stateLines.push('│ ' + rc.name + ' → ' + phaseLabel + ' | ' + profileLabel +
      ' | 好感=' + aff + ' | 模式=' + state.roleMode +
      ' | 锁=' + state.lockFlags.join(','))

    // Phase ceiling
    const ceiling = getPhaseCeiling(state.phase)
    stateLines.push('│   └─ 人格上限: ' + ceiling)
  }

  stateLines.push('│')
  stateLines.push('│ 🔒 核心规则: phase={1→strategyOnly, 2→performance, 3→leaking, 4→collapsed}')
  stateLines.push('└──────────────────────────────────────────')
  sections.push(stateLines.join('\n'))

  // ═══ ② BPM: Behavior Permission Matrix ═══
  const permLines = ['┌─ ② 行为权限矩阵 (BPM) ───────────────────']
  permLines.push('│ 以下权限决定你"能做什么"和"不能做什么"。')
  permLines.push('│')

  for (const rc of rcList) {
    const aff = affectionMap[rc.name] ?? rc.affectionInitial ?? 50
    const phase = computePhase(aff)
    const profile = _activeCharacterStates.get(rc.name)?.profile || AGGRESSION_PROFILES.GENTLE
    const perms = getPermissions(phase, profile)

    // Store for EV
    _activePermissions.set(rc.name, { phase, profile, perms })

    const allowed = []
    const denied = []
    for (const [key, value] of Object.entries(perms)) {
      if (key === 'futurePersonalityLeak' || key === 'strategyOnly') continue
      const label = PERMISSION_LABELS[key] || key
      if (value) {
        allowed.push(label)
      } else {
        denied.push(label)
      }
    }

    permLines.push('│ ' + rc.name + ' (Phase ' + phase + '):')
    if (allowed.length > 0) {
      permLines.push('│   ✅ 允许: ' + allowed.join(' | '))
    }
    if (denied.length > 0) {
      permLines.push('│   ❌ 禁止: ' + denied.join(' | '))
    }
    if (perms.strategyOnly) {
      permLines.push('│   ⚠️ 强制策略模式 — 一切行为出于计算，不是情感')
    }
  }

  permLines.push('│')
  permLines.push('│ ❗ 权限优先于"角色设定" — 即使你觉得角色"应该"做某事，权限说不允许就是不允许。')
  permLines.push('└──────────────────────────────────────────')
  sections.push(permLines.join('\n'))

  // ═══ ③ MAE: Memory Attribution Engine ═══
  sections.push(buildMAEDirective())

  // ═══ Enforcement ═══
  sections.push(
    '━━━ ⚙️ CEK 执行效力 ━━━\n' +
    '· CEK约束优先于角色设定、优先于导演指令、优先于任何"我觉得角色会这样做"\n' +
    '· 如果某个行为让你"感觉不像当前阶段" → 那就是跨阶段泄露 → 禁止\n' +
    '· Phase 决定你能做什么。Permission 决定你不能做什么。Attribution 决定你怎么陈述。\n' +
    '· 违规输出将被 Execution Validator 拦截并强制重生成。'
  )

  // Store context for EV
  _lastCEKContext = { character, affectionMap }

  return sections.join('\n\n')
}

// ── Permission label translations ──
const PERMISSION_LABELS = {
  emotionalAttachment: '情感依恋',
  jealousy: '嫉妒/吃醋',
  dependency: '依赖玩家',
  intimacyInitiative: '亲密主动',
  vulnerability: '脆弱展示',
  possessiveness: '占有欲',
  selfExposure: '自我暴露',
  warmthExpression: '温柔表达',
}

/**
 * Get the behavioral ceiling for a phase (human-readable).
 */
function getPhaseCeiling(phase) {
  switch (phase) {
    case 1: return '仅策略（冷处理、价值计算、等价交换）——禁止一切情感表达'
    case 2: return '允许表演式亲密（暗示、身体信号、被动接受）——禁止真实情感承诺'
    case 3: return '允许情绪泄露（试探依赖、不稳定波动、嫉妒）——禁止完全崩溃'
    case 4: return '允许崩坏表达（依赖、崩溃、真实自我暴露）——人格基底不可变'
    default: return '未知'
  }
}

// ═══════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════

/**
 * Check if any character is locked in strategy-only mode (Phase 1).
 * Convenience for UI / conditional logic.
 *
 * @param {object} affectionMap
 * @param {object} character
 * @returns {boolean}
 */
export function hasStrategyLockedCharacters(affectionMap = {}, character) {
  const rcList = character?.romanceCharacters || []
  for (const rc of rcList) {
    const aff = affectionMap[rc.name] ?? rc.affectionInitial ?? 50
    if (computePhase(aff) === 1) return true
  }
  return false
}

/**
 * Get the active character states (for debugging / UI).
 */
export function getActiveCharacterStates() {
  const result = {}
  for (const [name, state] of _activeCharacterStates) {
    result[name] = { ...state }
  }
  return result
}

/**
 * Clear internal CEK state (call on session reset).
 */
export function resetCEK() {
  _activeCharacterStates.clear()
  _activePermissions.clear()
  _lastCEKContext = null
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function clamp(val, min, max) {
  if (val == null || isNaN(val)) return min
  return Math.min(max, Math.max(min, Math.round(val)))
}
