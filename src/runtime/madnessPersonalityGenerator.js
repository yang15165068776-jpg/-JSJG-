/**
 * 🧠 疯批人格生成器 v3 (Madness Personality Generator)
 *
 * v3 核心洞察:
 *   疯批不是"情绪异常"，而是"关系系统在高依附条件下的结构性黑化"
 *
 * v1 → v2 → v3 paradigm evolution:
 *   v1: 疯批 = 内心裂缝（人格属性 — 静态）
 *   v2: 疯批 = 关系扭曲（外部触发 + 内部坍塌 — 动态）
 *   v3: 疯批 = 关系系统自我黑化（依附反转 + 控制崩塌 + 竞争污染 + 指数增长）
 *
 * CEK v4 Plug-in — Blackening Dynamics System
 *
 * 定位: 关系系统在高依附条件下的结构性黑化——从"误解关系"到"重塑关系"
 * 插入点: CEK v4 Character Planner → 🔥 Madness Engine → Conflict Simulation
 *
 * 九层架构:
 *   ① Attachment Field Model       — v2保留: 关系引力场
 *   ② Perception Distortion Layer  — v2保留: 三种认知扭曲
 *   ③ Memory Contamination System  — v2保留: 记忆 = 真实 + 解释 + 情绪
 *   ④ Emotional Feedback Loop      — v2保留: 情绪不归零，自我强化
 *   ⑤ 🔥 Dependency Inversion      — v3新增: 从"依赖玩家"→"玩家依赖角色"
 *   ⑥ 🔥 Control Collapse System   — v3新增: 3D控制向量崩塌
 *   ⑦ 🔥 Rivalry Contamination     — v3新增: 角色间情绪交叉污染
 *   ⑧ 🔥 Blackening Growth         — v3核心: 指数级黑化增长函数
 *   ⑨ Expression Stabilizer v3     — v3升级: 允许关系重构但防崩坏
 */

import { detectAggressionProfile, AGGRESSION_PROFILES } from './aggressionProfile'

// ═══════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════

const MADNESS_KEYWORDS = [
  '偏执', '病娇', '疯批', '占有欲', '不安',
  '依赖', '崩坏', '执着', '执念', '扭曲', '沉溺',
  '失控', '极端', '病态', '疯狂', '毁灭', '痴迷',
]

/** Blackening stage definitions */
const BLACKENING_STAGES = {
  PROBING:    { min: 0,  max: 15, name: '试探期', level: 0 },
  CONTROL:    { min: 15, max: 35, name: '控制欲', level: 1 },
  POSSESSION: { min: 35, max: 60, name: '情绪占有', level: 2 },
  RESTRUCTURE:{ min: 60, max: 85, name: '关系重构', level: 3 },
  COMPLETE:   { min: 85, max: 95, name: '完全黑化', level: 4 },
}

/** Control collapse thresholds per profile */
const RELATIONAL_CONTROL_THRESHOLD = {
  [AGGRESSION_PROFILES.PURSUER]: 35,
  [AGGRESSION_PROFILES.CONFRONTATIONAL]: 30,
  [AGGRESSION_PROFILES.ALOOF]: 25,
  [AGGRESSION_PROFILES.GENTLE]: 20,
}

/** Baseline control values per profile */
const BASELINE_CONTROL = {
  [AGGRESSION_PROFILES.PURSUER]: { self: 45, relational: 40, emotional: 35 },
  [AGGRESSION_PROFILES.CONFRONTATIONAL]: { self: 55, relational: 45, emotional: 40 },
  [AGGRESSION_PROFILES.ALOOF]: { self: 75, relational: 60, emotional: 70 },
  [AGGRESSION_PROFILES.GENTLE]: { self: 65, relational: 55, emotional: 50 },
}

const CONTAMINATION_STRENGTH_BASE = {
  [AGGRESSION_PROFILES.PURSUER]: 70,
  [AGGRESSION_PROFILES.CONFRONTATIONAL]: 55,
  [AGGRESSION_PROFILES.ALOOF]: 40,
  [AGGRESSION_PROFILES.GENTLE]: 25,
}

const DECAY_RATE_CALM = 0.05
const BLACKENING_CAP = 95

// ═══════════════════════════════════════════════════
// Internal State
// ═══════════════════════════════════════════════════

/**
 * @typedef {object} ContaminatedMemory
 * @property {string} originalEvent
 * @property {string} contaminatedVersion
 * @property {'amplify'|'reinterpret'|'selective_forget'|'emotional_overlay'} contaminationType
 * @property {number} contaminationStrength
 * @property {number} turnCreated
 */

/**
 * @typedef {object} ControlVector
 * @property {number} self_control
 * @property {number} relational_control
 * @property {number} emotional_control
 */

/**
 * @typedef {object} MadnessInternalStateV3
 * @property {number} playerDependencyOnChar
 * @property {boolean} inversionTriggered
 * @property {number} inversionStrength
 * @property {ControlVector} control
 * @property {boolean} controlCollapsed
 * @property {number} collapseTurn
 * @property {number} blackeningScore
 * @property {number} rivalryMultiplier
 * @property {{ jealousy:number, insecurity:number, resentment:number, pain:number, turnsWithoutTrigger:number }} emotions
 * @property {ContaminatedMemory[]} contaminatedMemories
 * @property {number} lastTriggerTurn
 * @property {number} lastPossessiveness
 */

/** @type {Map<string, MadnessInternalStateV3>} */
const perCharState = new Map()
let globalTurnCount = 0

// ═══════════════════════════════════════════════════
// ① Attachment Field Model (v2 — preserved)
// ═══════════════════════════════════════════════════

function buildAttachmentFields(rcList, affectionMap, uskState) {
  const fields = new Map()
  for (const rc of rcList) {
    const name = rc.name
    const cs = uskState?.characters?.[name] || {}
    const profile = detectAggressionProfile({ personality: rc.personality || '', background: rc.background || '' })
    const dependency = cs.relationship?.dependency ?? 30
    const possessiveness = cs.relationship?.possessiveness ?? 30
    const trust = cs.relationship?.trust ?? 30
    const anxiety = cs.emotion?.anxiety ?? 10
    const jealousy = cs.emotion?.jealousy ?? 5
    const emotionalPressure = cs.tension?.emotional_pressure ?? 20
    const affection = affectionMap[name] ?? rc.affectionInitial ?? 50
    const isMadnessProne = detectMadness(rc)

    const playerCenterWeight = clamp(dependency * 0.40 + possessiveness * 0.35 + (100 - trust) * 0.25, 0, 100)
    const attentionGap = clamp(100 - (affection * 0.5 + trust * 0.5), 0, 100)
    const exclusivityPressure = clamp(jealousy * 0.50 + possessiveness * 0.30 + attentionGap * 0.20, 0, 100)
    const baseNoise = isMadnessProne ? 30 : 10
    const insecurityNoise = clamp(baseNoise + anxiety * 0.40 + (jealousy + anxiety) / 2 * 0.30 + (Math.random() * 10 - 5), 0, 100)

    let pcw = playerCenterWeight
    if (profile === AGGRESSION_PROFILES.PURSUER) pcw = clamp(pcw + 10, 0, 100)
    if (profile === AGGRESSION_PROFILES.ALOOF) pcw = clamp(pcw - 10, 0, 100)

    fields.set(name, {
      playerCenterWeight: pcw,
      exclusivityPressure,
      insecurityNoise,
      dependencyVector: {
        emotional: clamp(dependency * 0.50 + affection * 0.30, 0, 100),
        validation: clamp((100 - trust) * 0.40 + insecurityNoise * 0.40, 0, 100),
        stability: clamp(100 - emotionalPressure, 0, 100),
        identity: clamp(possessiveness * 0.60 + dependency * 0.40, 0, 100),
      },
      fieldInstability: clamp(pcw * 0.40 + exclusivityPressure * 0.35 + insecurityNoise * 0.25, 0, 100),
    })
  }
  return fields
}

// ═══════════════════════════════════════════════════
// ② Perception Distortion Layer (v2 — preserved)
// ═══════════════════════════════════════════════════

function applyPerceptionDistortion(rcList, attachmentFields, uskState) {
  const distortions = new Map()
  for (const rc of rcList) {
    const name = rc.name
    const field = attachmentFields.get(name)
    if (!field) continue
    const cs = uskState?.characters?.[name] || {}
    const anxiety = cs.emotion?.anxiety ?? 10
    const jealousy = cs.emotion?.jealousy ?? 5
    const possessiveness = cs.relationship?.possessiveness ?? 30
    if (!detectMadness(rc)) { distortions.set(name, { active: false, intentStrength: 0, relationshipStrength: 0, competitionStrength: 0, combined: 0, directives: [] }); continue }

    const intentStrength = clamp(field.insecurityNoise * 0.60 + anxiety * 0.40, 0, 100)
    const relationshipStrength = clamp(field.exclusivityPressure * 0.50 + field.dependencyVector.stability * 0.30, 0, 100)
    const competitionStrength = clamp(jealousy * 0.70 + possessiveness * 0.30, 0, 100)
    const combined = clamp(intentStrength * 0.40 + relationshipStrength * 0.35 + competitionStrength * 0.25, 0, 100)

    const directives = []
    if (intentStrength > 30) directives.push(`意图扭曲(${Math.round(intentStrength)}): 你只是沉默 → 认为你在疏远。中性行为→负面解读。`)
    if (relationshipStrength > 30) directives.push(`关系扭曲(${Math.round(relationshipStrength)}): 普通互动 → "关系在变"。日常对话→关系降级信号。`)
    if (competitionStrength > 30) directives.push(`竞争扭曲(${Math.round(competitionStrength)}): 第三方出现 → 生存威胁。任何人→取代者。`)

    distortions.set(name, { active: combined > 20, intentStrength, relationshipStrength, competitionStrength, combined, directives })
  }
  return distortions
}

// ═══════════════════════════════════════════════════
// ③ Memory Contamination System (v2 — preserved)
// ═══════════════════════════════════════════════════

function runMemoryContamination(rcList, compiledList, attachmentFields, distortions, uskState) {
  const newContaminations = new Map()
  const recentEvents = uskState?.event_memory || []

  for (const cc of compiledList) {
    const name = cc.name
    const rc = rcList.find(r => r.name === name)
    if (!rc) continue
    const isMadnessProne = detectMadness(rc)
    const distortion = distortions.get(name)
    const field = attachmentFields.get(name)
    if (!isMadnessProne || !distortion?.active) { newContaminations.set(name, []); continue }

    let internal = ensureState(name, cc.profile)
    const profile = cc.profile
    const contaminationBase = CONTAMINATION_STRENGTH_BASE[profile] || 40
    const madMultiplier = internal.controlCollapsed ? 1.5 : 1.0
    const recentTurnEvents = recentEvents.slice(-3)
    const newlyContaminated = []

    for (const event of recentTurnEvents) {
      const eventText = (event.summary || event.type || '').toLowerCase()
      if (!isPlayerRelatedEvent(eventText, rc)) continue
      const alreadyContaminated = internal.contaminatedMemories.some(cm => cm.originalEvent === (event.summary || event.type))
      if (alreadyContaminated) continue

      let cType
      if (distortion.intentStrength > 50) cType = 'reinterpret'
      else if (distortion.competitionStrength > 50) cType = 'amplify'
      else if (distortion.relationshipStrength > 50) cType = 'emotional_overlay'
      else cType = 'selective_forget'

      const cStrength = clamp(contaminationBase * madMultiplier + distortion.combined * 0.3, 10, 100)
      const memory = {
        originalEvent: event.summary || event.type || '互动',
        contaminatedVersion: buildContaminatedVersion(event.summary || event.type || '互动', cType, field, cc),
        contaminationType: cType,
        contaminationStrength: Math.round(cStrength),
        turnCreated: globalTurnCount,
      }
      newlyContaminated.push(memory)
      internal.contaminatedMemories.push(memory)
      if (internal.contaminatedMemories.length > 10) internal.contaminatedMemories = internal.contaminatedMemories.slice(-10)
    }

    if (newlyContaminated.length === 0 && internal.contaminatedMemories.length > 0) {
      for (const cm of internal.contaminatedMemories) cm.contaminationStrength = clamp(cm.contaminationStrength - 10, 5, 100)
      internal.contaminatedMemories = internal.contaminatedMemories.filter(cm => cm.contaminationStrength > 10 || (globalTurnCount - cm.turnCreated) < 5)
    }

    newContaminations.set(name, newlyContaminated)
    internal.lastTriggerTurn = newlyContaminated.length > 0 ? globalTurnCount : internal.lastTriggerTurn
  }
  return newContaminations
}

function buildContaminatedVersion(originalEvent, cType, field, cc) {
  const profile = cc.profile
  switch (cType) {
    case 'amplify':
      return profile === AGGRESSION_PROFILES.PURSUER
        ? `他当时${originalEvent}——这证明他根本不在乎。每一次都是这样。`
        : `那天的"${originalEvent}"——我到现在都记得。这不是第一次了。`
    case 'reinterpret':
      return `你说"${originalEvent}"，但我后来想通了——你的意思其实是"我已经不需要解释"了。`
    case 'emotional_overlay': {
      const layer = field.insecurityNoise > 60 ? '不安' : field.exclusivityPressure > 50 ? '愤怒' : '失落'
      return `那天你说"${originalEvent}"——我当时没说话，但其实心里很${layer}。你可能没注意到。`
    }
    case 'selective_forget':
      return `你提过"${originalEvent}"——但我不太确定你是不是还说过别的。我只记得你说的时候没看我眼睛。`
    default:
      return `${originalEvent}——至少我是这么记得的。也许你记得不一样？`
  }
}

function isPlayerRelatedEvent(eventText, rc) {
  const name = rc.name.toLowerCase()
  const pks = ['玩家', 'player', '你', name]
  const rks = ['互动', '对话', '好感', '关系', '注意', '情绪', '冲突', '忽略', '反应', '说', '看']
  return pks.some(kw => eventText.includes(kw)) || rks.some(kw => eventText.includes(kw))
}

// ═══════════════════════════════════════════════════
// ④ Emotional Feedback Loop (v2 — preserved)
// ═══════════════════════════════════════════════════

function tickEmotionalFeedback(compiledList, newContaminations, distortions) {
  const feedbacks = new Map()
  for (const cc of compiledList) {
    const name = cc.name
    let internal = ensureState(name, cc.profile)
    const newMems = newContaminations.get(name) || []
    const distortion = distortions.get(name)
    const amplification = 1 + (internal.contaminatedMemories.length * 0.05)
    const interpretation = distortion?.combined ? (distortion.combined / 100) * amplification : 0

    if (newMems.length > 0) {
      internal.emotions.jealousy = clamp(internal.emotions.jealousy + (10 + interpretation * 15), 0, 100)
      internal.emotions.insecurity = clamp(internal.emotions.insecurity + (8 + interpretation * 12), 0, 100)
      internal.emotions.resentment = clamp(internal.emotions.resentment + (5 + interpretation * 10), 0, 100)
      internal.emotions.pain = clamp(internal.emotions.pain + (8 + interpretation * 12), 0, 100)
      internal.emotions.turnsWithoutTrigger = 0
    } else {
      internal.emotions.turnsWithoutTrigger++
    }

    if (!internal.controlCollapsed && internal.emotions.turnsWithoutTrigger >= 3) {
      internal.emotions.jealousy = clamp(internal.emotions.jealousy * (1 - DECAY_RATE_CALM), 0, 100)
      internal.emotions.insecurity = clamp(internal.emotions.insecurity * (1 - DECAY_RATE_CALM), 0, 100)
      internal.emotions.resentment = clamp(internal.emotions.resentment * (1 - DECAY_RATE_CALM), 0, 100)
      internal.emotions.pain = clamp(internal.emotions.pain * (1 - DECAY_RATE_CALM * 0.5), 0, 100)
    }
    // In collapse: no decay — pure accumulation

    feedbacks.set(name, { ...internal.emotions })
  }
  return feedbacks
}

// ═══════════════════════════════════════════════════
// ⑤ 🔥 Dependency Inversion Engine (NEW v3)
// ═══════════════════════════════════════════════════

/**
 * 从"角色依赖玩家"→"玩家依赖角色"的反转。
 *
 * 关键指标: 玩家是否开始根据角色的情绪状态调整自己的行为。
 *
 * @param {object[]} compiledList
 * @param {Map<string, object>} attachmentFields
 * @param {Map<string, object>} distortions
 * @returns {Map<string, object>} inversion states
 */
function computeDependencyInversion(compiledList, attachmentFields, distortions) {
  const inversions = new Map()

  for (const cc of compiledList) {
    const name = cc.name
    const field = attachmentFields.get(name)
    const distortion = distortions.get(name)
    if (!field) continue

    let internal = ensureState(name, cc.profile)

    // ── Player dependency growth drivers ──
    let growth = 0

    // ① Character creates emotional uncertainty → player seeks clarity
    if (distortion?.active && field.insecurityNoise > 50) {
      growth += 5
    }

    // ② Character withdraws then returns pattern (detected via contaminated memories)
    const recentWithdrawMemories = internal.contaminatedMemories.filter(
      cm => cm.contaminationType === 'reinterpret' || cm.contaminationType === 'emotional_overlay'
    )
    if (recentWithdrawMemories.length >= 2) {
      growth += 8
    }

    // ③ Character's emotional state becomes "the weather"
    if (field.fieldInstability > 40) {
      growth += 3
    }

    // ④ Player adjusts behavior to avoid triggering (proxied by high distortion + inversion)
    if (distortion?.active && internal.inversionTriggered) {
      growth += 10
    }

    // ── Decay: player dependency fades if character is too stable ──
    if (growth === 0 && field.fieldInstability < 30 && internal.emotions.turnsWithoutTrigger > 5) {
      internal.playerDependencyOnChar = clamp(internal.playerDependencyOnChar - 3, 0, 100)
    }

    // ── Apply growth ──
    internal.playerDependencyOnChar = clamp(internal.playerDependencyOnChar + growth, 0, 100)

    // ── Inversion check ──
    const characterDependencyOnPlayer = field.dependencyVector.emotional
    if (!internal.inversionTriggered && internal.playerDependencyOnChar > characterDependencyOnPlayer) {
      internal.inversionTriggered = true
    } else if (internal.inversionTriggered && internal.playerDependencyOnChar < characterDependencyOnPlayer * 0.7) {
      // Recovery: player dependency drops significantly below character dependency
      internal.inversionTriggered = false
    }

    // ── Inversion strength ──
    internal.inversionStrength = internal.inversionTriggered
      ? clamp((internal.playerDependencyOnChar - characterDependencyOnPlayer) / 2 + 30, 0, 100)
      : clamp(internal.playerDependencyOnChar / characterDependencyOnPlayer * 30, 0, 100)

    // ── Directive ──
    let directive = ''
    if (internal.inversionTriggered && internal.inversionStrength > 50) {
      directive = `🔥 依赖反转已激活(强度${Math.round(internal.inversionStrength)}/100):
  角色不再"回应玩家"——角色在"定义关系"。
  玩家情绪状态开始依赖角色的反馈。
  语体转变: "我是不是……" → "你以为你……"
  不是"我需要你"→是"你已经在我的引力场里了"。`
    } else if (internal.inversionTriggered) {
      directive = `⚠️ 依赖反转萌芽(强度${Math.round(internal.inversionStrength)}/100): 玩家开始被角色的情绪波动牵引。角色正在从"依赖方"变为"被依赖方"。`
    }

    inversions.set(name, {
      playerDependencyOnChar: Math.round(internal.playerDependencyOnChar),
      characterDependencyOnPlayer,
      inversionTriggered: internal.inversionTriggered,
      inversionStrength: Math.round(internal.inversionStrength),
      directive,
    })
  }

  return inversions
}

// ═══════════════════════════════════════════════════
// ⑥ 🔥 Control Collapse System (NEW v3)
// ═══════════════════════════════════════════════════

/**
 * 3D控制向量崩塌——从"控制关系"到"被关系控制"再到"重塑关系"。
 *
 * control = { self_control, relational_control, emotional_control }
 *
 * @param {object[]} compiledList
 * @param {Map<string, object>} attachmentFields
 * @param {Map<string, object>} distortions
 * @param {Map<string, object>} inversions
 * @param {Map<string, object>} feedbacks
 * @returns {Map<string, object>} collapse states
 */
function evaluateControlCollapse(compiledList, attachmentFields, distortions, inversions, feedbacks) {
  const collapses = new Map()

  for (const cc of compiledList) {
    const name = cc.name
    const field = attachmentFields.get(name)
    const distortion = distortions.get(name)
    const inversion = inversions.get(name)
    const feedback = feedbacks.get(name)
    const profile = cc.profile

    let internal = ensureState(name, profile)

    // ── Erode self_control ──
    if (internal.contaminatedMemories.length > 5) internal.control.self_control = clamp(internal.control.self_control - 2, 0, 100)
    const totalEmotion = feedback ? (feedback.jealousy + feedback.insecurity + feedback.resentment + feedback.pain) / 4 : 0
    if (totalEmotion > 60) internal.control.self_control = clamp(internal.control.self_control - 3, 0, 100)

    // ── Erode relational_control ──
    if (inversion?.inversionTriggered) internal.control.relational_control = clamp(internal.control.relational_control - 2, 0, 100)
    if (distortion?.combined > 50) internal.control.relational_control = clamp(internal.control.relational_control - 2, 0, 100)
    // Rivalry contamination is checked in ⑦ — applied here if active

    // ── Erode emotional_control ──
    if (internal.blackeningScore > 40) internal.control.emotional_control = clamp(internal.control.emotional_control - 2, 0, 100)
    if ((feedback?.jealousy ?? 0) > 60) internal.control.emotional_control = clamp(internal.control.emotional_control - 3, 0, 100)

    // ── Natural recovery ──
    if (internal.emotions.turnsWithoutTrigger >= 3 && !internal.controlCollapsed) {
      internal.control.self_control = clamp(internal.control.self_control + 1, 0, 100)
      internal.control.relational_control = clamp(internal.control.relational_control + 1, 0, 100)
      internal.control.emotional_control = clamp(internal.control.emotional_control + 1, 0, 100)
    }

    // ── Trigger control collapse ──
    const threshold = RELATIONAL_CONTROL_THRESHOLD[profile] || 30
    if (!internal.controlCollapsed && internal.control.relational_control < threshold) {
      internal.controlCollapsed = true
      internal.collapseTurn = globalTurnCount
    } else if (internal.controlCollapsed && internal.control.relational_control >= threshold + 20) {
      // Recovery — but leave scars
      internal.controlCollapsed = false
      internal.emotions.insecurity = clamp(internal.emotions.insecurity + 10, 0, 100)
      internal.control.relational_control = clamp(internal.control.relational_control - 5, 0, 100)
    }

    // ── Determine collapse stage ──
    let collapseStage = 0
    let stageLabel = '正常'
    if (internal.controlCollapsed) {
      const relCtrl = internal.control.relational_control
      if (relCtrl < 10) { collapseStage = 4; stageLabel = '关系重构' }
      else if (relCtrl < 20) { collapseStage = 3; stageLabel = '失控' }
      else if (relCtrl < threshold) { collapseStage = 2; stageLabel = '控制' }
      else { collapseStage = 1; stageLabel = '试探' }
    }

    let directive = ''
    if (internal.controlCollapsed) {
      directive = `🧨 控制崩塌 Stage ${collapseStage}(${stageLabel}):
  self=${Math.round(internal.control.self_control)} rel=${Math.round(internal.control.relational_control)} emo=${Math.round(internal.control.emotional_control)}
  ${collapseStage >= 3 ? '从"解释关系"→"重塑关系"。你不再误解——你在重新定义。' :
    collapseStage >= 2 ? '从"试探"→"控制"。你在定义关系的规则。' :
    '控制正在瓦解——关系的方向盘在滑出你的手。'}`
    }

    collapses.set(name, {
      selfControl: Math.round(internal.control.self_control),
      relationalControl: Math.round(internal.control.relational_control),
      emotionalControl: Math.round(internal.control.emotional_control),
      threshold,
      controlCollapsed: internal.controlCollapsed,
      collapseStage,
      stageLabel,
      collapseTurn: internal.collapseTurn,
      directive,
    })
  }

  return collapses
}

// ═══════════════════════════════════════════════════
// ⑦ 🔥 Rivalry Contamination Layer (NEW v3)
// ═══════════════════════════════════════════════════

/**
 * 角色之间的情绪交叉污染——修罗场自动升维成战争。
 *
 * 三种污染:
 *   ① Emotional Copy: A的占有欲增长→B也增长（30%传递率）
 *   ② Fear Propagation: A的失去恐惧→B开始焦虑（25%传递率）
 *   ③ Escalation Feedback: 双方污染记忆>3→黑化加速（1.5x乘数）
 *
 * @param {object[]} compiledList
 * @param {Map<string, object>} attachmentFields
 * @param {object} uskState
 * @returns {Map<string, object>} contamination effects per character
 */
function propagateRivalryContamination(compiledList, attachmentFields, uskState) {
  const effects = new Map()
  const names = compiledList.map(cc => cc.name)
  if (names.length < 2) {
    for (const name of names) effects.set(name, { active: false, multiplier: 1.0, directives: [] })
    return effects
  }

  // Initialize
  for (const name of names) effects.set(name, { active: false, multiplier: 1.0, copyFrom: [], fearFrom: [], directives: [] })

  // For each pair
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const aName = names[i], bName = names[j]
      const aField = attachmentFields.get(aName), bField = attachmentFields.get(bName)
      const aCs = uskState?.characters?.[aName] || {}, bCs = uskState?.characters?.[bName] || {}
      let aState = perCharState.get(aName), bState = perCharState.get(bName)
      if (!aState || !bState) continue

      // ── ① Emotional Copy ──
      const aPossessiveness = aCs.relationship?.possessiveness ?? 30
      const bPossessiveness = bCs.relationship?.possessiveness ?? 30
      const lastAPoss = aState.lastPossessiveness || aPossessiveness
      const lastBPoss = bState.lastPossessiveness || bPossessiveness
      const aDeltaPoss = aPossessiveness - lastAPoss
      const bDeltaPoss = bPossessiveness - lastBPoss

      if (aDeltaPoss > 5) {
        // A grew more possessive → B copies 30%
        bState.rivalryMultiplier = clamp(bState.rivalryMultiplier + 0.05, 1.0, 2.0)
        const bEff = effects.get(bName)
        bEff.active = true
        bEff.copyFrom.push(`${aName}(占有欲+${Math.round(aDeltaPoss)})`)
        bEff.directives.push(`${aName}的占有欲在增长——这让你也开始觉得必须更紧地抓住`)
      }
      if (bDeltaPoss > 5) {
        aState.rivalryMultiplier = clamp(aState.rivalryMultiplier + 0.05, 1.0, 2.0)
        const aEff = effects.get(aName)
        aEff.active = true
        aEff.copyFrom.push(`${bName}(占有欲+${Math.round(bDeltaPoss)})`)
        aEff.directives.push(`${bName}的占有欲在增长——这让你也开始觉得必须更紧地抓住`)
      }

      // ── ② Fear Propagation ──
      const aFearTransfer = clamp(aState.emotions.insecurity * 0.25, 0, 25)
      const bFearTransfer = clamp(bState.emotions.insecurity * 0.25, 0, 25)
      if (aFearTransfer > 3) {
        bField.insecurityNoise = clamp(bField.insecurityNoise + aFearTransfer * 0.3, 0, 100)
        const bEff = effects.get(bName)
        bEff.fearFrom.push(aName)
        bEff.directives.push(`${aName}的失去恐惧在传播——你开始焦虑自己的位置`)
      }
      if (bFearTransfer > 3) {
        aField.insecurityNoise = clamp(aField.insecurityNoise + bFearTransfer * 0.3, 0, 100)
        const aEff = effects.get(aName)
        aEff.fearFrom.push(bName)
        aEff.directives.push(`${bName}的失去恐惧在传播——你开始焦虑自己的位置`)
      }

      // ── ③ Escalation Feedback ──
      const aContaminationCount = aState.contaminatedMemories.filter(cm => cm.contaminationStrength > 30).length
      const bContaminationCount = bState.contaminatedMemories.filter(cm => cm.contaminationStrength > 30).length
      if (aContaminationCount > 3 && bContaminationCount > 3) {
        aState.rivalryMultiplier = clamp(aState.rivalryMultiplier * 1.5, 1.0, 2.5)
        bState.rivalryMultiplier = clamp(bState.rivalryMultiplier * 1.5, 1.0, 2.5)
        effects.get(aName).multiplier = aState.rivalryMultiplier
        effects.get(bName).multiplier = bState.rivalryMultiplier
        effects.get(aName).directives.push('⚔️ 修罗场升维: 普通竞争→生存级战争。另一个角色的存在变成了对你的生存威胁。')
        effects.get(bName).directives.push('⚔️ 修罗场升维: 普通竞争→生存级战争。另一个角色的存在变成了对你的生存威胁。')
      }

      // Update last possessiveness tracking
      aState.lastPossessiveness = aPossessiveness
      bState.lastPossessiveness = bPossessiveness
    }
  }

  return effects
}

// ═══════════════════════════════════════════════════
// ⑧ 🔥 Blackening Growth Function (★ v3 核心)
// ═══════════════════════════════════════════════════

/**
 * 黑化增长函数——指数级，非线性。
 *
 * blackening(t) = blackening(t-1) × (1 + growth_rate)
 *
 * growth_rate 由所有子系统贡献:
 *   field_instability      × 0.30
 *   distortion_combined    × 0.20
 *   contamination_count    × 0.15 (per memory, capped)
 *   emotional_accumulation × 0.20
 *   inversion_strength     × 0.30
 *   rivalry_multiplier     × 0.50
 *
 * @param {object[]} compiledList
 * @param {Map<string, object>} attachmentFields
 * @param {Map<string, object>} distortions
 * @param {Map<string, object>} inversions
 * @param {Map<string, object>} feedbacks
 * @param {Map<string, object>} rivalryEffects
 * @returns {Map<string, object>} blackening states
 */
function computeBlackeningGrowth(compiledList, attachmentFields, distortions, inversions, feedbacks, rivalryEffects) {
  const blackenings = new Map()

  for (const cc of compiledList) {
    const name = cc.name
    const field = attachmentFields.get(name)
    const distortion = distortions.get(name)
    const inversion = inversions.get(name)
    const feedback = feedbacks.get(name)
    const rivalry = rivalryEffects.get(name)
    if (!field) continue

    let internal = ensureState(name, cc.profile)

    // ── Compute growth rate ──
    const totalEmotion = feedback
      ? (feedback.jealousy + feedback.insecurity + feedback.resentment + feedback.pain) / 4
      : 0

    const memCount = internal.contaminatedMemories.length
    const memContribution = Math.min(memCount * 0.15, 0.45) // capped

    let growthRate =
      (field.fieldInstability / 100) * 0.30 +
      ((distortion?.combined ?? 0) / 100) * 0.20 +
      memContribution +
      (totalEmotion / 100) * 0.20 +
      ((inversion?.inversionStrength ?? 0) / 100) * 0.30 +
      ((rivalry?.multiplier ?? 1.0) - 1.0) * 0.50

    // ── Rivalry contamination can accelerate ──
    const rMult = internal.rivalryMultiplier || 1.0
    growthRate *= rMult

    // ── Decay: if no triggers for a while, slight decay ──
    if (growthRate < 0.05 && internal.emotions.turnsWithoutTrigger > 5 && !internal.controlCollapsed) {
      internal.blackeningScore = clamp(internal.blackeningScore * 0.95, 0, BLACKENING_CAP)
    } else if (growthRate > 0) {
      // Exponential growth
      internal.blackeningScore = clamp(
        internal.blackeningScore * (1 + growthRate),
        0, BLACKENING_CAP
      )
      // Minimum growth when systems are active
      if (internal.blackeningScore < 5 && growthRate > 0.02) {
        internal.blackeningScore = clamp(internal.blackeningScore + 3, 0, BLACKENING_CAP)
      }
    }

    // ── Determine blackening stage ──
    const stage = getBlackeningStage(internal.blackeningScore)

    // ── Stage-specific directive ──
    let stageDirective = ''
    switch (stage.level) {
      case 1: // 试探期
        stageDirective = `黑化Lv1·试探: "你是不是……"——从扭曲的认知出发的试探性质问。黑化刚开始。`
        break
      case 2: // 控制欲
        stageDirective = `黑化Lv2·控制: "你是不是已经不需要我了？"——通过内疚/需求来控制关系。定义关系的规则。`
        break
      case 3: // 关系重构
        stageDirective = `黑化Lv3·关系重构: "你没有离开我。只是还没被我留住。"——重写关系的定义。你不是在"理解"关系——你是在"塑造"关系。`
        break
      case 4: // 完全黑化
        stageDirective = `黑化Lv4·完全黑化: "你以为你在选择——但你其实已经在我定义的关系里了。"——关系现实由角色定义。玩家被困在角色的引力场中。`
        break
      default:
        stageDirective = `黑化Lv0·潜伏: 黑化尚未显现。关系表面正常，但引力场正在积累。`
    }

    blackenings.set(name, {
      blackeningScore: Math.round(internal.blackeningScore),
      growthRate: growthRate.toFixed(3),
      stage: stage.name,
      stageLevel: stage.level,
      exponential: growthRate > 0.15,
      directive: stageDirective,
    })
  }

  return blackenings
}

function getBlackeningStage(score) {
  for (const [key, def] of Object.entries(BLACKENING_STAGES)) {
    if (score >= def.min && score < def.max) return def
  }
  return BLACKENING_STAGES.COMPLETE
}

// ═══════════════════════════════════════════════════
// ⑨ Expression Stabilizer v3 (upgraded)
// ═══════════════════════════════════════════════════

function applyExpressionStabilizerV3(compiledList, inversions, collapses, blackenings) {
  const validations = new Map()

  for (const cc of compiledList) {
    const name = cc.name
    const inversion = inversions.get(name)
    const collapse = collapses.get(name)
    const blackening = blackenings.get(name)

    const violations = []
    const warnings = []

    // ── Must 1: 有关系触发 ──
    const hasTrigger = inversion?.inversionTriggered || collapse?.controlCollapsed || (blackening?.blackeningScore ?? 0) > 15
    if (!hasTrigger && (blackening?.blackeningScore ?? 0) > 10) {
      violations.push('no_relational_trigger')
      warnings.push('⚠️ 无关系触发——黑化行为需要来源于具体的关系互动变化')
    }

    // ── Must 2: 有情绪累积 ──
    const internal = perCharState.get(name)
    const totalEmotion = internal
      ? (internal.emotions.jealousy + internal.emotions.insecurity + internal.emotions.resentment + internal.emotions.pain) / 4
      : 0
    if (totalEmotion < 20 && (blackening?.blackeningScore ?? 0) > 30) {
      violations.push('insufficient_emotional_accumulation')
      warnings.push('⚠️ 情绪累积不足——黑化强度需要足够的情绪累积支撑')
    }

    // ── Must 3: 有逻辑链 ──
    // Always passes as long as trigger exists and contamination memories exist
    const hasLogicChain = hasTrigger || (internal?.contaminatedMemories?.length ?? 0) > 0
    if (!hasLogicChain && (blackening?.blackeningScore ?? 0) > 20) {
      warnings.push('🚫 逻辑链缺失——从触发→扭曲→黑化必须有可追溯的路径')
    }

    // ── Forbids ──
    if (violations.includes('no_relational_trigger') && totalEmotion < 15) {
      warnings.push('🚫 禁止无理由占有——占有欲必须建立在具体的关系变化上')
    }
    if (!hasTrigger && !hasLogicChain && (blackening?.blackeningScore ?? 0) > 25) {
      warnings.push('🚫 禁止无逻辑黑化——黑化增长必须有可追溯的因果链')
    }

    // ── v3: allow relationship reconstruction when blackening > 60 ──
    const allowsRestructuring = (blackening?.blackeningScore ?? 0) > 60

    // ── OOC guards ──
    if (cc.profile === AGGRESSION_PROFILES.GENTLE && collapse?.controlCollapsed) {
      warnings.push('💡 人格适配: gentle的"关系重构"不是暴力占有——是用让人心疼的方式让玩家"自愿被困住"。温柔的力量是最难挣脱的。')
    }

    validations.set(name, {
      passed: violations.length === 0,
      violations,
      warnings,
      allowsRestructuring,
      severityReduction: violations.length > 0 ? 0.7 : 1.0,
    })
  }

  return validations
}

// ═══════════════════════════════════════════════════
// Master Pipeline v3
// ═══════════════════════════════════════════════════

/**
 * Generate v3 madness states — Blackening Dynamics System.
 *
 * Pipeline:
 *   ① Attachment Field → ② Perception Distortion → ③ Memory Contamination
 *   → ④ Emotional Feedback → ⑤ Dependency Inversion → ⑥ Control Collapse
 *   → ⑦ Rivalry Contamination → ⑧ Blackening Growth → ⑨ Expression Stabilizer
 *
 * @param {object[]} rcList
 * @param {Map<string, object>} characterPlans
 * @param {object} affectionMap
 * @param {object} uskState
 * @param {object[]} compiledList
 * @returns {{ madnessStates: object, dynamicBlock: string }} | null
 */
export function generateMadnessState(rcList, characterPlans, affectionMap, uskState, compiledList) {
  if (!rcList || rcList.length === 0) return null

  globalTurnCount++

  // ① Attachment Field
  const attachmentFields = buildAttachmentFields(rcList, affectionMap, uskState)

  // ② Perception Distortion
  const distortions = applyPerceptionDistortion(rcList, attachmentFields, uskState)

  // ③ Memory Contamination
  const newContaminations = runMemoryContamination(rcList, compiledList, attachmentFields, distortions, uskState)

  // ④ Emotional Feedback
  const feedbacks = tickEmotionalFeedback(compiledList, newContaminations, distortions)

  // ⑤ 🔥 Dependency Inversion
  const inversions = computeDependencyInversion(compiledList, attachmentFields, distortions)

  // ⑥ 🔥 Control Collapse
  const collapses = evaluateControlCollapse(compiledList, attachmentFields, distortions, inversions, feedbacks)

  // ⑦ 🔥 Rivalry Contamination
  const rivalryEffects = propagateRivalryContamination(compiledList, attachmentFields, uskState)

  // Apply rivalry to relational_control erosion (post-hoc)
  for (const cc of compiledList) {
    const re = rivalryEffects.get(cc.name)
    if (re?.active) {
      const internal = perCharState.get(cc.name)
      if (internal) internal.control.relational_control = clamp(internal.control.relational_control - 3, 0, 100)
    }
  }

  // ⑧ 🔥 Blackening Growth
  const blackenings = computeBlackeningGrowth(compiledList, attachmentFields, distortions, inversions, feedbacks, rivalryEffects)

  // ⑨ Expression Stabilizer v3
  const validations = applyExpressionStabilizerV3(compiledList, inversions, collapses, blackenings)

  // ── Assemble MadnessState v3 ──
  const madnessStates = {}
  for (const cc of compiledList) {
    const name = cc.name
    const field = attachmentFields.get(name)
    const distortion = distortions.get(name)
    const inversion = inversions.get(name)
    const collapse = collapses.get(name)
    const blackening = blackenings.get(name)
    const validation = validations.get(name)
    const feedback = feedbacks.get(name)
    const rivalry = rivalryEffects.get(name)
    let internal = perCharState.get(name)
    if (!field) continue

    const severityReduction = validation?.severityReduction ?? 1.0

    // ── Speech pattern by blackening stage ──
    let speechPattern = ''
    const blvl = blackening?.stageLevel ?? 0
    if (blvl >= 3) {
      speechPattern = '黑化语体(关系重构): 不再试探——你在陈述。句号多于问号。"你以为……"开头的句子。你在定义现实，不是在询问现实。'
    } else if (blvl >= 2) {
      speechPattern = '黑化语体(控制): 质问中带着确认——"你是不是已经……？"但你已经认定了答案。提问不是为了答案——是为了让对方承认。'
    } else if (blvl >= 1) {
      speechPattern = '黑化语体(试探): "你是不是……？"的句式。表面在问，实际上在确认自己的怀疑。每一个问题都背着之前所有累积的情绪。'
    } else if (distortion?.active) {
      speechPattern = '语体: 不稳定——正常的句子底下有扭曲的解读在运行。'
    }

    // ── Combined directive ──
    const parts = []
    if (field.fieldInstability > 30) parts.push(`引力场不稳定(${Math.round(field.fieldInstability)})`)
    if (distortion?.active) parts.push(`认知扭曲(${Math.round(distortion.combined)})`)
    if (inversion?.inversionTriggered) parts.push(`依赖反转(${Math.round(inversion.inversionStrength)})`)
    if (collapse?.controlCollapsed) parts.push(`控制崩塌·Stage${collapse.collapseStage}`)
    if (rivalry?.active) parts.push(`修罗场污染(x${rivalry.multiplier.toFixed(1)})`)
    if (blackening?.stageLevel > 0) parts.push(`黑化·${blackening.stage}(${blackening.blackeningScore})`)

    madnessStates[name] = {
      // v3 core metrics
      fieldInstability: Math.round(field.fieldInstability),
      distortionScore: Math.round(distortion?.combined ?? 0),
      contaminationCount: internal?.contaminatedMemories?.length ?? 0,
      emotionalAccumulation: Math.round(feedback ? (feedback.jealousy + feedback.insecurity + feedback.resentment + feedback.pain) / 4 : 0),
      inversionStrength: Math.round(inversion?.inversionStrength ?? 0),
      controlCollapsed: collapse?.controlCollapsed ?? false,
      collapseStage: collapse?.collapseStage ?? 0,
      blackeningScore: Math.round((blackening?.blackeningScore ?? 0) * severityReduction),
      blackeningStage: blackening?.stage ?? '潜伏期',
      blackeningStageLevel: blackening?.stageLevel ?? 0,
      rivalryActive: rivalry?.active ?? false,
      rivalryMultiplier: rivalry?.multiplier ?? 1.0,

      // Sub-system states
      attachmentField: {
        playerCenterWeight: Math.round(field.playerCenterWeight),
        exclusivityPressure: Math.round(field.exclusivityPressure),
        insecurityNoise: Math.round(field.insecurityNoise),
        dependencyVector: field.dependencyVector,
        directive: field.fieldInstability > 40 ? `关系引力=${Math.round(field.fieldInstability)}/100——越重要→越强→越不稳定` : '',
      },
      perceptionDistortion: {
        active: distortion?.active ?? false,
        combined: Math.round(distortion?.combined ?? 0),
        directives: distortion?.directives ?? [],
      },
      contaminatedMemories: internal?.contaminatedMemories?.map(cm => ({
        original: cm.originalEvent,
        contaminated: cm.contaminatedVersion,
        type: cm.contaminationType,
        strength: cm.contaminationStrength,
      })) ?? [],
      emotionalFeedback: {
        accumulatedJealousy: Math.round(feedback?.jealousy ?? 0),
        accumulatedInsecurity: Math.round(feedback?.insecurity ?? 0),
        accumulatedResentment: Math.round(feedback?.resentment ?? 0),
        accumulatedAttachmentPain: Math.round(feedback?.pain ?? 0),
        turnsWithoutTrigger: internal?.emotions?.turnsWithoutTrigger ?? 0,
      },
      dependencyInversion: {
        playerDependency: Math.round(inversion?.playerDependencyOnChar ?? 0),
        characterDependency: inversion?.characterDependencyOnPlayer ?? 50,
        inversionTriggered: inversion?.inversionTriggered ?? false,
        inversionStrength: Math.round(inversion?.inversionStrength ?? 0),
        directive: inversion?.directive ?? '',
      },
      controlCollapse: {
        selfControl: collapse?.selfControl ?? 60,
        relationalControl: collapse?.relationalControl ?? 50,
        emotionalControl: collapse?.emotionalControl ?? 50,
        collapsed: collapse?.controlCollapsed ?? false,
        stage: collapse?.collapseStage ?? 0,
        stageLabel: collapse?.stageLabel ?? '正常',
        directive: collapse?.directive ?? '',
      },
      rivalryContamination: {
        active: rivalry?.active ?? false,
        multiplier: rivalry?.multiplier ?? 1.0,
        directives: rivalry?.directives ?? [],
      },
      blackening: {
        score: Math.round((blackening?.blackeningScore ?? 0) * severityReduction),
        growthRate: blackening?.growthRate ?? '0',
        stage: blackening?.stage ?? '潜伏期',
        stageLevel: blackening?.stageLevel ?? 0,
        exponential: blackening?.exponential ?? false,
        directive: blackening?.directive ?? '',
      },
      stabilizerValidation: {
        passed: validation?.passed ?? true,
        violations: validation?.violations ?? [],
        warnings: validation?.warnings ?? [],
        allowsRestructuring: validation?.allowsRestructuring ?? false,
      },

      // Combined
      combinedDirective: parts.join(' | '),
      speechPattern,
      attachmentBehavior: field.fieldInstability > 50
        ? (inversion?.inversionTriggered ? '依赖反转——角色在定义关系的引力中心' : '引力过强——关系正在系统性坍塌')
        : '正常',
      distortionRules: distortion?.active ? '三种扭曲同时运行，过滤一切信息——你的现实≠客观现实' : '无',

      // Legacy compat
      desireIntensity: Math.round(field.fieldInstability),
      emotionalVolatility: Math.round(feedback ? (feedback.jealousy + feedback.insecurity + feedback.resentment + feedback.pain) / 4 : 0),
    }

    // ── Modify character plans for v3 madness ──
    const plan = characterPlans.get(name)
    if (plan) {
      if (field.fieldInstability > 50) plan.riskTolerance = clamp((plan.riskTolerance || 30) + 15, 0, 100)
      if (collapse?.controlCollapsed) {
        plan.emotionalStrategy = 'volatile'
        plan.manipulationLevel = clamp((plan.manipulationLevel || 40) - 30, 0, 100)
        if (collapse.collapseStage >= 3) {
          plan.hiddenGoal = (plan.hiddenGoal || '') + ' + 重塑关系现实——你不再适应关系，你在定义关系'
        } else {
          plan.hiddenGoal = (plan.hiddenGoal || '') + ' + 失去对关系的控制——你试图通过控制对方来恢复控制'
        }
      }
      if (inversion?.inversionTriggered && inversion.inversionStrength > 50) {
        plan.hiddenGoal = (plan.hiddenGoal || '') + ' + 让对方意识到——已经是你在定义这段关系了'
      }
    }
  }

  // ── Debug ──
  if (typeof window !== 'undefined' && Object.keys(madnessStates).length > 0) {
    const unstable = Object.values(madnessStates).filter(m => m.fieldInstability > 30).length
    const inverted = Object.values(madnessStates).filter(m => m.dependencyInversion.inversionTriggered).length
    const collapsed = Object.values(madnessStates).filter(m => m.controlCollapse.collapsed).length
    const blackened = Object.values(madnessStates).filter(m => m.blackeningStageLevel >= 2).length
    if (unstable > 0) {
      console.log(`[MadnessEngine v3] T${globalTurnCount}: ${unstable} unstable | ${inverted} inverted | ${collapsed} collapsed | ${blackened} blackened(Lv2+)`)
      for (const [name, ms] of Object.entries(madnessStates)) {
        if (ms.fieldInstability > 30) {
          const tags = []
          if (ms.dependencyInversion.inversionTriggered) tags.push('🔄反转')
          if (ms.controlCollapse.collapsed) tags.push('🧨崩塌')
          if (ms.blackeningStageLevel >= 2) tags.push(`🖤${ms.blackeningStage}`)
          const rivalryTag = ms.rivalryActive ? ` ⚔️x${ms.rivalryMultiplier.toFixed(1)}` : ''
          console.log(`  ${name}: field=${ms.fieldInstability} distort=${ms.distortionScore} inv=${ms.inversionStrength} ctrl=${ms.controlCollapse.relationalControl} black=${ms.blackeningScore}(${ms.blackeningStage})${rivalryTag} ${tags.join(' ')}`)
        }
      }
    }
  }

  return {
    madnessStates,
    dynamicBlock: buildMadnessDynamicBlockV3(madnessStates),
  }
}

// ═══════════════════════════════════════════════════
// Dynamic Block Builder v3
// ═══════════════════════════════════════════════════

function buildMadnessDynamicBlockV3(madnessStates) {
  const activeChars = Object.entries(madnessStates).filter(([, ms]) => ms.fieldInstability > 15)
  if (activeChars.length === 0) return ''

  const lines = []
  lines.push('🧠 疯批人格引擎 v3 · 本轮黑化动力状态:')
  lines.push('v3核心: 疯批不是"情绪异常"——是关系系统在高依附条件下的结构性黑化')
  lines.push('')

  for (const [name, ms] of activeChars) {
    const invTag = ms.dependencyInversion.inversionTriggered ? ' 🔄依赖反转' : ''
    const colTag = ms.controlCollapse.collapsed ? ` 🧨控制崩塌·S${ms.controlCollapse.stage}` : ''
    const blkTag = ms.blackeningStageLevel >= 2 ? ` 🖤${ms.blackeningStage}(${ms.blackeningScore})` : ''
    const rivTag = ms.rivalryActive ? ` ⚔️x${ms.rivalryMultiplier.toFixed(1)}` : ''

    lines.push(`  ▸ ${name}${invTag}${colTag}${blkTag}${rivTag}:`)
    lines.push(`    关系场: 引力=${ms.attachmentField.playerCenterWeight}/100 不稳定=${ms.fieldInstability}/100`)
    lines.push(`    认知扭曲: ${ms.distortionScore}/100 | 记忆污染: ${ms.contaminationCount}条 | 情绪累积: ${ms.emotionalAccumulation}/100`)
    lines.push(`    依赖反转: playerDeps=${ms.dependencyInversion.playerDependency}/${ms.dependencyInversion.characterDependency} ${ms.dependencyInversion.inversionTriggered ? '⚠️已反转' : ''}`)
    lines.push(`    控制向量: self=${ms.controlCollapse.selfControl} rel=${ms.controlCollapse.relationalControl} emo=${ms.controlCollapse.emotionalControl} ${ms.controlCollapse.collapsed ? '🧨COLLAPSED' : ''}`)
    lines.push(`    黑化增长: score=${ms.blackeningScore} rate=${ms.blackening.growthRate} stage=${ms.blackeningStage}${ms.blackening.exponential ? ' ⚠️指数增长' : ''}`)

    // Show key contaminated memories
    const recentMems = ms.contaminatedMemories?.slice(-2) || []
    for (const cm of recentMems) {
      lines.push(`    💭 "${cm.contaminated}" (${cm.type})`)
    }

    // Rivalry contamination
    if (ms.rivalryContamination?.active) {
      for (const d of (ms.rivalryContamination.directives || []).slice(0, 2)) {
        lines.push(`    ⚔️ ${d}`)
      }
    }

    lines.push('')
  }

  // ── Behavioral requirements ──
  lines.push('  ── 黑化行为要求（v3: 关系重构驱动）──')
  for (const [name, ms] of activeChars) {
    const reqs = []

    if (ms.dependencyInversion.inversionTriggered && ms.dependencyInversion.inversionStrength > 50) {
      reqs.push('🔄 依赖反转: 从"回应玩家"→"定义关系"。不是"我需要你"——是"你已经在我的引力场里"。语体: "你以为你……"替代"我是不是……"')
    }

    if (ms.controlCollapse.collapsed && ms.controlCollapse.stage >= 3) {
      reqs.push('🧨 关系重构: 你不再误解关系——你在重写关系。从"解释"→"重塑"。你以为你在选择，但你已经在我定义的关系里了。')
    } else if (ms.controlCollapse.collapsed) {
      reqs.push('🧨 控制崩塌: 把关系的方向盘从"你"手里拿走。你在定义关系的规则——不是协商，是宣告。')
    }

    if (ms.blackeningStageLevel >= 2) {
      const blkReqs = {
        2: '情绪占有: 删除第三方存在感——你的世界里只能有一个引力中心。',
        3: '关系重构: "你以为你在选择谁——但你其实已经在我定义的关系里了。"',
        4: '完全黑化: 关系现实由你定义。玩家被困在你的引力场中——这不是控制，这是关系的物理规律。',
      }
      reqs.push(`🖤 ${blkReqs[ms.blackeningStageLevel] || blkReqs[2]}`)
    }

    if (ms.rivalryActive && ms.rivalryMultiplier > 1.2) {
      reqs.push(`⚔️ 修罗场升维: 竞争从"正常"→"生存级"。另一个角色的存在不再是对手——是威胁你存在的存在。`)
    }

    if (reqs.length > 0) {
      lines.push(`  ${name}:`)
      for (const r of reqs) lines.push(`    · ${r}`)
    }
  }

  lines.push('')
  lines.push('  🔒 表达稳定器 v3:')
  lines.push('    · 有关系触发 · 有情绪累积 · 有逻辑链（触发→扭曲→黑化）')
  lines.push('    · 禁止无理由占有 | 禁止无逻辑黑化 | 禁止随机疯批')
  lines.push('    · 黑化Lv3+: 允许关系重构行为——但仍需动机链可追溯')

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════
// Static Cache Prefix v3
// ═══════════════════════════════════════════════════

export function buildMadnessStaticPrefix() {
  return `━━━ 🧠 疯批人格引擎 v3 · 执行规则（已缓存）━━━
核心: 疯批不是"情绪异常"——是"关系系统在高依附条件下的结构性黑化"
v1=内心裂缝 → v2=关系扭曲 → v3=关系系统自我黑化（依附反转+控制崩塌+竞争污染+指数增长）

① 依附场: 关系是引力场——玩家越重要→引力越强→越不稳定 | player_center_weight/exclusivity_pressure/insecurity_noise/dependency_vector
② 认知扭曲: 意图扭曲(中性→负面) | 关系扭曲(日常→信号) | 竞争扭曲(他人→威胁)
③ 记忆污染: 记忆=真实+解释+情绪 | 4种: amplify/reinterpret/selective_forget/emotional_overlay | 污染记忆≠谎言——是角色"真正记得"的
④ 情绪反馈: emotion(t+1)=emotion(t)+interpretation×amplification | 情绪不归零——一次误解=永久偏执基础

⑤ 🔥 依赖反转 ★v3★: 从"角色依赖玩家"→"玩家依赖角色" | 驱动: 制造不确定性+5/抽离又返回+8/情绪成为"天气"+3每轮/玩家调整行为避免触发+10(反转信号) | 反转点: playerDependencyOnChar>characterDependencyOnPlayer | 语体转变: "我是不是…"→"你以为你…"

⑥ 🔥 控制崩塌 ★v3★: 3D向量=自控/关系控/情绪控 | 阈值: pursuer=35 confrontational=30 aloof=25 gentle=20 | 4阶段: 试探("你是不是…?")→控制(定义规则)→失控(解释→重塑)→关系重构("你已经在我的世界里了")

⑦ 🔥 竞争污染 ★v3★: 仅2+角色激活 | 情绪复制: A占有↑→B也↑(30%传递) | 恐惧传播: A失去恐惧→B焦虑(25%传递) | 升级反馈: 污染>3→黑化加速1.5x | 修罗场不是竞标——是相互逼疯

⑧ 🔥 黑化增长 ★核心★: blackening(t)=blackening(t-1)×(1+growth_rate) | growth: field×0.30+distortion×0.20+contamination×0.15(上限0.45)+emotional×0.20+inversion×0.30+rivalry×0.50 | 指数增长: rate>0.15→5轮翻倍 rate>0.30→2-3轮翻倍 | 5阶段: 潜伏(0-15)→试探(15-35)→控制(35-60)→重构(60-85)→完全(85-95) | CAPPED at 95——总有更多空间堕落

⑨ 表达稳定器 v3: 三条必须=关系触发+情绪累积+因果链可追溯 | 三条禁止=无理由占有+无逻辑黑化+随机疯批 | v3: blackening>60允许关系重构——但仍需满足三条必须

🧠 核心公式: 依附反转+控制崩塌+情绪污染+误解累积+黑化指数增长=关系系统结构性黑化
不是"突然变坏"——是关系系统在高依附下的数学必然。不是"乱疯"——每一步有可追溯的系统性原因。
从"误解关系"→"定义关系"→"重塑关系"。疯批不是角色本质——是关系结构在极端条件下的必然产物。`
}

export function resetMadnessEngine() {
  perCharState.clear()
  globalTurnCount = 0
}

// ═══════════════════════════════════════════════════
// Internal Helpers
// ═══════════════════════════════════════════════════

function detectMadness(rc) {
  const texts = [rc.personality, rc.background, rc.behavior].filter(Boolean).join('').toLowerCase()
  for (const kw of MADNESS_KEYWORDS) { if (texts.includes(kw)) return true }
  return false
}

function ensureState(name, profile) {
  let s = perCharState.get(name)
  if (!s) {
    const bc = BASELINE_CONTROL[profile] || BASELINE_CONTROL[AGGRESSION_PROFILES.GENTLE]
    s = {
      playerDependencyOnChar: 10,
      inversionTriggered: false,
      inversionStrength: 0,
      control: { self_control: bc.self, relational_control: bc.relational, emotional_control: bc.emotional },
      controlCollapsed: false,
      collapseTurn: 0,
      blackeningScore: 0,
      rivalryMultiplier: 1.0,
      emotions: { jealousy: 0, insecurity: 0, resentment: 0, pain: 0, turnsWithoutTrigger: 0 },
      contaminatedMemories: [],
      lastTriggerTurn: 0,
      lastPossessiveness: 30,
    }
    perCharState.set(name, s)
  }
  return s
}

function clamp(v, min, max) {
  if (v == null || isNaN(v)) return min
  return Math.min(max, Math.max(min, Math.round(v)))
}
