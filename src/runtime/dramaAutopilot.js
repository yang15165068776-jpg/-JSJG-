/**
 * Drama Autopilot System v1 (DAS)
 *
 * Core principle:
 *   ❗ The story should generate its OWN drama. Not wait for the player to create it.
 *   ❗ "Too calm" is a bug. "Too stable" is a failure state. "Nothing happening" = autopilot failed.
 *
 * Problem being solved:
 *   ❌ Player drives the plot → story waits for player
 *   ❌ No conflict → story becomes chat
 *   ❌ Stable relationships → story has no fuel
 *   ❌ Same scene too long → narrative stagnates
 *
 * DAS is NOT a character module. It's NOT a behavior module.
 * DAS is a NARRATIVE EVENT SCHEDULER — the world's drama autopilot.
 *
 * Five sub-systems:
 *   1. Tension Monitor       — detects when drama is NEEDED
 *   2. Scene Scheduler        — auto-switches scenes based on narrative needs
 *   3. Conflict Injector      — manufactures conflict when none exists
 *   4. Relationship Pressure  — computes pressure, forces events at thresholds
 *   5. Narrative Interrupt    — breaks "smooth dialogue" with event injection
 *
 * Where it sits in NOS (v8.4):
 *   CCL   → 能不能做
 *   NTK   → 发生过什么
 *   USK   → 当前状态
 *   ARSL  → 为什么会发生
 *   ANDS  → 角色想不想行动
 *   DAS   → 世界要不要发生事  ← THIS
 *   Orchestrator → 什么时候执行
 *
 * The essential upgrade:
 *   Before DAS: 人在推动剧情 (player pushes the story)
 *   After DAS:  剧情在自己找人发生 (story generates its own drama)
 */

import { AGGRESSION_PROFILES } from './aggressionProfile'

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

// ═══════════════════════════════════════════════════════════
// 1. TENSION MONITOR — detects when drama is NEEDED
// ═══════════════════════════════════════════════════════════

/**
 * Three critical states the monitor detects:
 *
 *   TOO_CALM    — tension < 25 for too long. Story is boring. MUST inject.
 *   STAGNANT    — no events, no conflict change, emotional plateau. MUST interrupt.
 *   RISING      — tension climbing. Should escalate, not dissipate.
 *   CRITICAL    — tension > 85. At breaking point. MUST force release.
 *
 * @param {object} state — { arslEdges, sceneState, uskState, turnCount, turnsSinceLastEvent, lastEventType }
 * @returns {object} { state: 'TOO_CALM'|'STAGNANT'|'RISING'|'CRITICAL'|'NORMAL', urgency: 0-100, details }
 */
export function monitorTension(state = {}) {
  const {
    arslEdges = {},
    sceneState = null,
    uskState = {},
    turnCount = 0,
    turnsSinceLastEvent = 0,
    lastEventType = null,
  } = state

  // ── Compute aggregate tension ──
  let totalTension = 0
  let totalJealousy = 0
  let totalAttraction = 0
  let totalStability = 0
  let edgeCount = 0

  for (const [key, edge] of Object.entries(arslEdges)) {
    totalTension += (edge.tension || 0)
    totalJealousy += (edge.jealousy || 0)
    totalAttraction += (edge.attraction || 0)
    totalStability += (edge.stability || 0)
    edgeCount++
  }

  const avgTension = edgeCount > 0 ? totalTension / edgeCount : 30
  const avgJealousy = edgeCount > 0 ? totalJealousy / edgeCount : 5
  const avgStability = edgeCount > 0 ? totalStability / edgeCount : 60

  // Scene tension from DramaOrchestrator
  const sceneTension = sceneState?.tension ?? 30
  const sceneStability = sceneState?.stability ?? 60
  const scenePhase = sceneState?.scenePhase || 'setup'

  // Combined tension metric (0-100)
  const combinedTension = avgTension * 0.35 + sceneTension * 0.35 + avgJealousy * 0.20 + (100 - avgStability) * 0.10
  const clampedTension = clamp(Math.round(combinedTension), 0, 100)

  // ── Detect emotional stagnation ──
  // If USK emotions are all flat (no strong emotions), the story has no fuel
  let emotionalIntensity = 0
  let charCount = 0
  const uskChars = uskState?.characters || {}
  for (const [name, char] of Object.entries(uskChars)) {
    const emo = char.emotion || {}
    const intensity = (emo.anger || 0) + (emo.jealousy || 0) + (emo.sadness || 0) +
                      Math.abs((emo.curiosity || 30) - 30) + Math.abs((emo.excitement || 20) - 20)
    emotionalIntensity += intensity
    charCount++
  }
  const avgEmotionalIntensity = charCount > 0 ? emotionalIntensity / charCount : 30

  // ── Decision logic ──

  // CRITICAL: tension at breaking point — must release
  if (clampedTension > 85 || scenePhase === 'collapse') {
    return {
      state: 'CRITICAL',
      urgency: clamp(clampedTension, 70, 100),
      combinedTension: clampedTension,
      details: {
        avgTension: Math.round(avgTension),
        sceneTension,
        avgJealousy: Math.round(avgJealousy),
        message: '张力已达临界点——必须发生不可逆的事件',
      },
    }
  }

  // RISING: tension climbing — escalate, don't let it dissipate
  if (clampedTension > 60 || scenePhase === 'crisis' || scenePhase === 'rising') {
    return {
      state: 'RISING',
      urgency: clamp(clampedTension, 50, 85),
      combinedTension: clampedTension,
      details: {
        avgTension: Math.round(avgTension),
        sceneTension,
        avgJealousy: Math.round(avgJealousy),
        message: '张力正在上升——推高它，不要让它自然回落',
      },
    }
  }

  // TOO_CALM: tension too low for too long — story is boring
  const calmThreshold = 25
  const calmTurnThreshold = 3
  if (clampedTension < calmThreshold && turnsSinceLastEvent >= calmTurnThreshold) {
    return {
      state: 'TOO_CALM',
      urgency: clamp(40 + turnsSinceLastEvent * 8, 40, 75),
      combinedTension: clampedTension,
      details: {
        avgTension: Math.round(avgTension),
        sceneTension,
        turnsSinceLastEvent,
        message: '故事太平静了——' + turnsSinceLastEvent + ' 轮没有事件发生。必须注入冲突。',
      },
    }
  }

  // STAGNANT: emotional plateau — no strong emotions, no change
  const stagnationThreshold = 35
  if (avgEmotionalIntensity < stagnationThreshold && turnsSinceLastEvent >= 2) {
    return {
      state: 'STAGNANT',
      urgency: clamp(35 + turnsSinceLastEvent * 6, 35, 65),
      combinedTension: clampedTension,
      details: {
        avgEmotionalIntensity: Math.round(avgEmotionalIntensity),
        turnsSinceLastEvent,
        message: '情绪停滞——角色没有强烈情感波动。必须打断当前状态。',
      },
    }
  }

  // NORMAL: no intervention needed
  return {
    state: 'NORMAL',
    urgency: 0,
    combinedTension: clampedTension,
    details: { message: '正常状态——无需强制干预' },
  }
}

// ═══════════════════════════════════════════════════════════
// 2. SCENE SCHEDULER — auto-switches scenes based on narrative needs
// ═══════════════════════════════════════════════════════════

/**
 * Scene types DAS can schedule.
 */
export const SCENE_TYPES = {
  private_intimate: {
    label: '私密空间',
    description: '两人被迫独处——没有退路，没有观众',
    tensionEffect: +8,
    triggers: ['too_calm', 'rising_attachment'],
    narrative: '场景收缩到只有两个人的空间——空气变稠了',
  },
  public_confrontation: {
    label: '公开对峙',
    description: '在别人面前爆发——面子和社会压力叠加',
    tensionEffect: +15,
    triggers: ['jealousy_spike', 'critical_tension'],
    narrative: '场景被拉到公开场合——现在所有人都能看到这场对峙',
  },
  unexpected_encounter: {
    label: '意外相遇',
    description: '角色在没想到的地方撞见——没有准备，没有面具',
    tensionEffect: +10,
    triggers: ['jealousy_spike', 'stagnant'],
    narrative: '两个人/三个人在一个不该遇到的地方遇到了——来不及戴上面具',
  },
  forced_proximity: {
    label: '强制共处',
    description: '外部原因迫使角色待在同一个空间——无处可逃',
    tensionEffect: +12,
    triggers: ['too_calm', 'stagnant'],
    narrative: '门关上了。两个人被关在同一个空间里——物理距离变成心理压力',
  },
  third_party_arrival: {
    label: '第三者到场',
    description: '一个不在场的角色突然出现——改变所有力量平衡',
    tensionEffect: +18,
    triggers: ['jealousy_spike', 'critical_tension', 'stagnant'],
    narrative: '第三个人出现了——场上的平衡在一秒之内崩溃',
  },
  departure_threat: {
    label: '即将分离',
    description: '有人要离开——制造紧迫感和"最后的机会"',
    tensionEffect: +14,
    triggers: ['too_calm', 'emotional_plateau'],
    narrative: '离开的倒计时开始了——每一秒都在逼角色做出选择',
  },
}

/**
 * Decide if the scene should change based on tension monitor state + current scene.
 *
 * @param {object} tensionResult — from monitorTension()
 * @param {object} currentScene — from DramaOrchestrator scene state
 * @param {number} turnsInCurrentScene — how long the scene has been running
 * @returns {object|null} scene change directive, or null if no change needed
 */
export function scheduleSceneChange(tensionResult, currentScene = null, turnsInCurrentScene = 0) {
  if (!tensionResult || tensionResult.state === 'NORMAL') return null

  const currentPhase = currentScene?.scenePhase || 'setup'
  const currentLocation = currentScene?.location || ''

  // ── Don't change scenes too frequently ──
  if (turnsInCurrentScene < 3 && tensionResult.state !== 'CRITICAL') return null

  // ── Select scene type based on tension state ──
  let candidateTypes = []

  switch (tensionResult.state) {
    case 'TOO_CALM':
      // Inject disruption — something to break the calm
      candidateTypes = ['forced_proximity', 'third_party_arrival', 'departure_threat']
      break
    case 'STAGNANT':
      // Break the plateau — unexpected encounter or intrusion
      candidateTypes = ['unexpected_encounter', 'third_party_arrival', 'forced_proximity']
      break
    case 'RISING':
      // Escalate — move to more intense setting
      candidateTypes = ['public_confrontation', 'private_intimate', 'forced_proximity']
      break
    case 'CRITICAL':
      // Must release — public or departure
      candidateTypes = ['public_confrontation', 'departure_threat', 'third_party_arrival']
      break
  }

  // Filter out the current scene type (don't switch to same thing)
  // We don't have exact scene type tracking, so just pick from candidates

  const selectedType = pick(candidateTypes)
  const sceneDef = SCENE_TYPES[selectedType]
  if (!sceneDef) return null

  return {
    type: selectedType,
    label: sceneDef.label,
    description: sceneDef.description,
    narrativeDirective: sceneDef.narrative,
    tensionEffect: sceneDef.tensionEffect,
    reason: tensionResult.details?.message || '场景调度',
    urgency: tensionResult.urgency,
  }
}

// ═══════════════════════════════════════════════════════════
// 3. CONFLICT INJECTOR — manufactures conflict when none exists
// ═══════════════════════════════════════════════════════════

/**
 * Conflict type library.
 * Each conflict has: label, description, intensity, narrativeDirective, requiredConditions
 */
export const CONFLICT_TYPES = {
  misunderstanding: {
    label: '误会',
    description: '角色A以为角色B说了/做了某事——角色B根本没有',
    intensity: 55,
    narrativeDirective: '一个误会刚刚产生——一方相信了一件不真实的事，另一方不知道对方误会了',
    requiresInnocence: false,
  },
  third_party_mention: {
    label: '第三者被提及',
    description: '一个不在场的名字被提到——空气变了',
    intensity: 60,
    narrativeDirective: '有人提到了一个不在场的名字——那个名字有重量。所有人都感觉到了。',
    requiresInnocence: false,
  },
  information_asymmetry: {
    label: '信息不对称',
    description: '角色A知道角色B不知道的事——这个差距在制造张力',
    intensity: 50,
    narrativeDirective: '一方知道另一方不知道的事——这个信息差在每一句话里制造裂缝',
    requiresInnocence: false,
  },
  emotional_overflow: {
    label: '情绪失控',
    description: '压不住的情绪突然溢出——不是策略，是失控',
    intensity: 65,
    narrativeDirective: '角色的情绪溢出来了——不是选择爆发，是压不住了。这句话不是经过思考的。',
    requiresInnocence: false,
  },
  possessiveness_eruption: {
    label: '占有欲爆发',
    description: '角色不再掩饰自己的占有欲——直接宣示主权',
    intensity: 70,
    narrativeDirective: '占有欲不再藏在客气话里——直接、不加掩饰、不解释。"你是我的。"',
    requiresInnocence: false,
  },
  secret_exposed: {
    label: '隐瞒被发现',
    description: '一个之前藏着的秘密被暴露——信任在一秒内崩塌',
    intensity: 75,
    narrativeDirective: '一个不该被知道的事被知道了——隐瞒的墙裂了一条缝，光漏进来了',
    requiresInnocence: false,
  },
  accidental_intimacy: {
    label: '意外亲密接触',
    description: '身体意外触碰——不是故意的，但反应是真实的',
    intensity: 45,
    narrativeDirective: '身体碰到了——不是故意的。但两个人都感觉到了。空气中的电荷。',
    requiresInnocence: true,
  },
  boundary_violation: {
    label: '边界侵犯',
    description: '角色故意跨过对方的心理/身体边界——测试反应',
    intensity: 60,
    narrativeDirective: '角色跨过了一条线——不是没看见线，是看见了还跨过去。在等对方反应。',
    requiresInnocence: false,
  },
}

/**
 * Decide whether to inject a conflict.
 *
 * Decision logic:
 *   - TOO_CALM for N turns → inject (low-medium intensity)
 *   - STAGNANT → inject (medium intensity)
 *   - RISING → inject only if tension is concentrated in one edge (escalation needed)
 *   - CRITICAL → inject (high intensity, irreversible)
 *
 * @param {object} tensionResult — from monitorTension()
 * @param {object} arslEdges — current relationship edges
 * @param {number} turnsSinceLastConflict — turns since last conflict injection
 * @returns {object|null} conflict injection directive, or null
 */
export function injectConflict(tensionResult, arslEdges = {}, turnsSinceLastConflict = 0) {
  if (!tensionResult || tensionResult.state === 'NORMAL') return null

  // ── Cooldown: at least 2 turns between injections ──
  if (turnsSinceLastConflict < 2 && tensionResult.state !== 'CRITICAL') return null

  // ── Select conflict type based on tension state ──
  let candidatePool = []
  let preferIrreversible = false

  switch (tensionResult.state) {
    case 'TOO_CALM':
      // Gentle disruption — misunderstanding, accidental intimacy, information asymmetry
      candidatePool = ['misunderstanding', 'accidental_intimacy', 'information_asymmetry', 'boundary_violation']
      break
    case 'STAGNANT':
      // Break the plateau — emotional overflow, boundary violation, secret exposure
      candidatePool = ['emotional_overflow', 'boundary_violation', 'secret_exposed', 'third_party_mention']
      break
    case 'RISING':
      // Escalate existing tension — possessiveness, emotional overflow, boundary violation
      candidatePool = ['possessiveness_eruption', 'emotional_overflow', 'boundary_violation', 'third_party_mention']
      break
    case 'CRITICAL':
      // Force irreversible event — secret exposed, possessiveness eruption, emotional overflow
      candidatePool = ['secret_exposed', 'possessiveness_eruption', 'emotional_overflow']
      preferIrreversible = true
      break
  }

  // ── Filter by scene context ──
  // Check if there's already high jealousy → prefer possessiveness/boundary_violation
  let maxJealousy = 0
  for (const edge of Object.values(arslEdges)) {
    if ((edge.jealousy || 0) > maxJealousy) maxJealousy = edge.jealousy
  }
  if (maxJealousy > 50) {
    // Bias toward jealousy-related conflicts
    if (!candidatePool.includes('possessiveness_eruption')) candidatePool.push('possessiveness_eruption')
    if (!candidatePool.includes('third_party_mention')) candidatePool.push('third_party_mention')
  }

  const selectedType = pick(candidatePool)
  const conflictDef = CONFLICT_TYPES[selectedType]
  if (!conflictDef) return null

  // ── Compute injection intensity ──
  let intensity = conflictDef.intensity
  if (tensionResult.state === 'CRITICAL') intensity = clamp(intensity + 15, 0, 100)
  if (preferIrreversible) intensity = clamp(intensity + 10, 0, 100)

  return {
    type: selectedType,
    label: conflictDef.label,
    description: conflictDef.description,
    narrativeDirective: conflictDef.narrativeDirective,
    intensity,
    irreversible: preferIrreversible || intensity > 70,
    reason: tensionResult.details?.message || '冲突注入',
    urgency: tensionResult.urgency,
  }
}

// ═══════════════════════════════════════════════════════════
// 4. RELATIONSHIP PRESSURE SYSTEM — pressure accumulation + forced events
// ═══════════════════════════════════════════════════════════

/**
 * Compute relationship pressure for each edge.
 *
 * Pressure = (attraction + jealousy + dependency) - stability
 *
 * This is NOT "how good is the relationship."
 * This is "how much potential energy is stored — and when will it release?"
 *
 * High pressure → the relationship is unstable. It MUST release energy.
 * Low pressure → stable, but also boring. May need injection.
 *
 * @param {object} arslEdges — from RelationshipPhysics
 * @returns {object} { edges: { key: pressure }, maxPressure, maxPressureEdge, averagePressure }
 */
export function computeRelationshipPressure(arslEdges = {}) {
  const edgePressures = {}
  let maxPressure = 0
  let maxPressureEdge = null
  let totalPressure = 0
  let edgeCount = 0

  for (const [key, edge] of Object.entries(arslEdges)) {
    const attraction = edge.attraction || 30
    const jealousy = edge.jealousy || 5
    const dependency = edge.dependency || 30
    const stability = edge.stability || 60

    // Pressure = attraction + jealousy + dependency - stability
    const pressure = clamp(attraction * 0.4 + jealousy * 0.35 + dependency * 0.25 - stability * 0.5, 0, 100)

    edgePressures[key] = Math.round(pressure)
    totalPressure += pressure
    edgeCount++

    if (pressure > maxPressure) {
      maxPressure = pressure
      maxPressureEdge = key
    }
  }

  const averagePressure = edgeCount > 0 ? Math.round(totalPressure / edgeCount) : 30

  return {
    edges: edgePressures,
    maxPressure: Math.round(maxPressure),
    maxPressureEdge,
    averagePressure,
  }
}

/**
 * Decide whether pressure requires forcing an event.
 *
 * Thresholds:
 *   > 80: FORCE — relationship is unstable. Must have emotional event / confrontation.
 *   > 65: PUSH — relationship is tense. Should push toward resolution.
 *   > 50: WATCH — monitor. No action needed yet.
 *   < 35: LOW — relationship may be stagnating. Consider external injection.
 *
 * @param {object} pressureResult — from computeRelationshipPressure()
 * @param {object} arslEdges
 * @returns {object|null} pressure event directive, or null
 */
export function checkPressureEvent(pressureResult, arslEdges = {}) {
  if (!pressureResult || pressureResult.maxPressure < 50) return null

  const { maxPressure, maxPressureEdge } = pressureResult

  if (maxPressure >= 80) {
    // FORCE: relationship is about to break — must release
    const edge = arslEdges[maxPressureEdge]
    return {
      type: 'pressure_rupture',
      intensity: clamp(maxPressure, 75, 100),
      edge: maxPressureEdge,
      from: edge?.from || '?',
      to: edge?.to || '?',
      directive: '关系压强已达临界（' + maxPressure + '）。角色 ' + (edge?.from || '?') +
                 ' 与 ' + (edge?.to || '?') + ' 之间必须爆发——不可再压抑。' +
                 '可能的形式：摊牌、情绪崩溃、物理冲突、或者不可逆的一句话。',
      forced: true,
    }
  }

  if (maxPressure >= 65) {
    // PUSH: relationship is tense — escalate
    const edge = arslEdges[maxPressureEdge]
    return {
      type: 'pressure_push',
      intensity: clamp(maxPressure, 60, 80),
      edge: maxPressureEdge,
      from: edge?.from || '?',
      to: edge?.to || '?',
      directive: '关系压强升高（' + maxPressure + '）。角色 ' + (edge?.from || '?') +
                 ' 与 ' + (edge?.to || '?') + ' 之间的张力正在累积——推一步。' +
                 '不要让其自然回落——用试探、挑衅、或突然的靠近来加压。',
      forced: false,
    }
  }

  return null
}

// ═══════════════════════════════════════════════════════════
// 5. NARRATIVE INTERRUPT ENGINE — breaks smooth dialogue
// ═══════════════════════════════════════════════════════════

/**
 * Interrupt types.
 */
const INTERRUPT_TYPES = {
  emotional_interrupt: {
    label: '情绪打断',
    description: '角色正要说话/正在说话 → 被自己的情绪打断',
    narrative: '角色的话卡在半路——不是忘了要说什么，是情绪堵住了喉咙',
    intensity: 45,
  },
  event_interrupt: {
    label: '事件插入',
    description: '消息还没结束 → 外部事件发生（敲门/电话/第三人出现）',
    narrative: '话没说完——一个外部事件插入，把所有人的注意力拉走了',
    intensity: 55,
  },
  scene_transition: {
    label: '强制转场',
    description: '场景突然从当前状态 → 冲突现场',
    narrative: '场景变了——不是平滑过渡，是硬切。上一个时刻还在聊天，下一个时刻已经在对峙',
    intensity: 60,
  },
  silence_interrupt: {
    label: '沉默打断',
    description: '一段对话后的沉默被突如其来的动作/话语打断',
    narrative: '沉默被打破了——不是被话，是被动作。有人动了。',
    intensity: 40,
  },
  memory_flash: {
    label: '回忆闪回',
    description: '当前对话触发了角色的强烈回忆——过去入侵现在',
    narrative: '一句话触发了一段回忆——角色不在当前的对话里了，ta回到了过去',
    intensity: 50,
  },
}

/**
 * Decide whether to interrupt the current narrative flow.
 *
 * The interrupt engine prevents "smooth dialogue" — the default model behavior
 * of polite turn-taking without any disruption.
 *
 * @param {object} tensionResult — from monitorTension()
 * @param {object} sceneState — from DramaOrchestrator
 * @param {number} turnsSinceLastInterrupt — turns since last interrupt
 * @param {boolean} dialogueIsFlowing — is the current turn "smooth dialogue"?
 * @returns {object|null} interrupt directive, or null
 */
export function checkNarrativeInterrupt(tensionResult, sceneState = null, turnsSinceLastInterrupt = 0, dialogueIsFlowing = true) {
  // ── Don't interrupt if one just happened ──
  if (turnsSinceLastInterrupt < 2 && tensionResult?.state !== 'CRITICAL') return null

  // ── Determine if interrupt is needed ──
  let shouldInterrupt = false
  let interruptPool = []

  if (!tensionResult || tensionResult.state === 'NORMAL') {
    // Even in normal state, occasionally interrupt smooth dialogue (10% chance)
    if (dialogueIsFlowing && Math.random() < 0.10) {
      shouldInterrupt = true
      interruptPool = ['silence_interrupt', 'memory_flash', 'emotional_interrupt']
    }
  } else {
    shouldInterrupt = true
    switch (tensionResult.state) {
      case 'TOO_CALM':
        interruptPool = ['event_interrupt', 'silence_interrupt', 'memory_flash']
        break
      case 'STAGNANT':
        interruptPool = ['emotional_interrupt', 'scene_transition', 'event_interrupt']
        break
      case 'RISING':
        interruptPool = ['emotional_interrupt', 'scene_transition']
        break
      case 'CRITICAL':
        interruptPool = ['scene_transition', 'event_interrupt', 'emotional_interrupt']
        break
    }
  }

  if (!shouldInterrupt || interruptPool.length === 0) return null

  const selectedType = pick(interruptPool)
  const interruptDef = INTERRUPT_TYPES[selectedType]
  if (!interruptDef) return null

  return {
    type: selectedType,
    label: interruptDef.label,
    description: interruptDef.description,
    narrativeDirective: interruptDef.narrative,
    intensity: interruptDef.intensity + (tensionResult?.urgency || 0) * 0.2,
    reason: tensionResult?.details?.message || '日常打断——防止流畅对话',
    urgency: tensionResult?.urgency || 30,
  }
}

// ═══════════════════════════════════════════════════════════
// 6. DAS MAIN API — the Drama Autopilot
// ═══════════════════════════════════════════════════════════

export const DramaAutopilot = {

  /** @type {object} current autopilot state */
  _state: {
    turnCount: 0,
    turnsSinceLastEvent: 0,
    turnsSinceLastConflict: 0,
    turnsSinceLastInterrupt: 0,
    turnsSinceLastSceneChange: 0,
    turnsInCurrentScene: 0,
    lastTensionState: 'NORMAL',
    lastEventType: null,
    lastConflictType: null,
    lastInterruptType: null,
    eventHistory: [],
    dialogueIsFlowing: true,
  },

  /** @type {object} pending narrative events to inject */
  _pendingEvents: [],

  /** @type {object} last generated narrative event (for prompt injection) */
  _lastNarrativeEvent: null,

  // ── Init ──────────────────────────────────────────

  init() {
    this._state = {
      turnCount: 0,
      turnsSinceLastEvent: 0,
      turnsSinceLastConflict: 0,
      turnsSinceLastInterrupt: 0,
      turnsSinceLastSceneChange: 0,
      turnsInCurrentScene: 0,
      lastTensionState: 'NORMAL',
      lastEventType: null,
      lastConflictType: null,
      lastInterruptType: null,
      eventHistory: [],
      dialogueIsFlowing: true,
    }
    this._pendingEvents = []
    this._lastNarrativeEvent = null
  },

  reset() {
    this.init()
  },

  // ── Tick — the main autopilot cycle ────────────────

  /**
   * Run one autopilot cycle.
   *
   * Pipeline:
   *   1. Monitor tension → detect state (TOO_CALM/STAGNANT/RISING/CRITICAL/NORMAL)
   *   2. Compute relationship pressure → check for forced events
   *   3. Schedule scene change if needed
   *   4. Inject conflict if needed
   *   5. Check narrative interrupt
   *   6. Assemble narrative event
   *
   * @param {object} inputs
   * @param {object} inputs.arslEdges — from RelationshipPhysics.edges
   * @param {object} inputs.sceneState — from DramaOrchestrator scene
   * @param {object} inputs.uskState — raw USK state
   * @param {object} inputs.userText — current player input (to detect "flowing dialogue")
   * @param {number} inputs.turnCount — current turn
   * @returns {object} tick result { tensionState, events, pressureResult, sceneChange, conflict, interrupt }
   */
  tick(inputs = {}) {
    const {
      arslEdges = {},
      sceneState = null,
      uskState = {},
      userText = '',
    } = inputs

    this._state.turnCount++
    this._state.turnsInCurrentScene++
    this._pendingEvents = []

    // ── Detect if dialogue is "flowing" (smooth, no disruption) ──
    this._state.dialogueIsFlowing = !!(userText && userText.trim() && !/[！!？?]{2,}/.test(userText))

    // ── Step 1: Tension Monitor ──
    const tensionResult = monitorTension({
      arslEdges,
      sceneState,
      uskState,
      turnCount: this._state.turnCount,
      turnsSinceLastEvent: this._state.turnsSinceLastEvent,
      lastEventType: this._state.lastEventType,
    })

    this._state.lastTensionState = tensionResult.state

    // ── Step 2: Relationship Pressure ──
    const pressureResult = computeRelationshipPressure(arslEdges)
    const pressureEvent = checkPressureEvent(pressureResult, arslEdges)

    // ── Step 3: Scene Scheduler ──
    let sceneChange = null
    if (tensionResult.state !== 'NORMAL' || this._state.turnsInCurrentScene > 8) {
      sceneChange = scheduleSceneChange(tensionResult, sceneState, this._state.turnsInCurrentScene)
    }

    // ── Step 4: Conflict Injector ──
    let conflict = null
    if (tensionResult.state !== 'NORMAL') {
      conflict = injectConflict(tensionResult, arslEdges, this._state.turnsSinceLastConflict)
    }

    // ── Step 5: Narrative Interrupt ──
    const interrupt = checkNarrativeInterrupt(
      tensionResult,
      sceneState,
      this._state.turnsSinceLastInterrupt,
      this._state.dialogueIsFlowing,
    )

    // ── Step 6: Assemble events ──
    const events = []

    // Priority: CRITICAL events first
    if (pressureEvent && pressureEvent.type === 'pressure_rupture') {
      events.push({
        source: 'pressure',
        priority: 1,
        ...pressureEvent,
      })
    }

    if (tensionResult.state === 'CRITICAL' && conflict) {
      events.push({
        source: 'conflict',
        priority: 2,
        ...conflict,
      })
    }

    if (sceneChange && tensionResult.state !== 'NORMAL') {
      events.push({
        source: 'scene',
        priority: 3,
        ...sceneChange,
      })
    }

    if (interrupt) {
      events.push({
        source: 'interrupt',
        priority: 4,
        ...interrupt,
      })
    }

    if (pressureEvent && pressureEvent.type === 'pressure_push') {
      events.push({
        source: 'pressure',
        priority: 5,
        ...pressureEvent,
      })
    }

    if (conflict && tensionResult.state !== 'CRITICAL') {
      events.push({
        source: 'conflict',
        priority: 6,
        ...conflict,
      })
    }

    // Sort by priority
    events.sort((a, b) => (a.priority || 9) - (b.priority || 9))

    // ── Update counters ──
    const hasEvent = events.length > 0
    if (hasEvent) {
      this._state.turnsSinceLastEvent = 0
      this._state.lastEventType = events[0].source
      this._state.eventHistory.push({
        turn: this._state.turnCount,
        type: events[0].source,
        subtype: events[0].type,
        timestamp: Date.now(),
      })
      if (this._state.eventHistory.length > 50) {
        this._state.eventHistory = this._state.eventHistory.slice(-50)
      }
    } else {
      this._state.turnsSinceLastEvent++
    }

    if (conflict) {
      this._state.turnsSinceLastConflict = 0
      this._state.lastConflictType = conflict.type
    } else {
      this._state.turnsSinceLastConflict++
    }

    if (interrupt) {
      this._state.turnsSinceLastInterrupt = 0
      this._state.lastInterruptType = interrupt.type
    } else {
      this._state.turnsSinceLastInterrupt++
    }

    if (sceneChange) {
      this._state.turnsSinceLastSceneChange = 0
      this._state.turnsInCurrentScene = 0
    } else {
      this._state.turnsSinceLastSceneChange++
    }

    // Store pending events
    this._pendingEvents = events

    // Store last narrative event for prompt injection
    if (events.length > 0) {
      this._lastNarrativeEvent = {
        events,
        tensionState: tensionResult.state,
        tensionUrgency: tensionResult.urgency,
        pressureResult,
        timestamp: Date.now(),
      }
    }

    return {
      tensionState: tensionResult.state,
      tensionUrgency: tensionResult.urgency,
      combinedTension: tensionResult.combinedTension,
      events,
      pressureResult,
      sceneChange,
      conflict,
      interrupt,
    }
  },

  // ── Pending Events ─────────────────────────────────

  /**
   * Get and clear pending narrative events.
   */
  getPendingEvents() {
    const events = [...this._pendingEvents]
    this._pendingEvents = []
    return events
  },

  /**
   * Check if there are pending events.
   */
  hasPendingEvents() {
    return this._pendingEvents.length > 0
  },

  // ── Narrative Event Builder ────────────────────────

  /**
   * Build the DAS narrative event injection for the LLM prompt.
   *
   * This is the single most important output of DAS — it tells the LLM:
   * "The world is about to change. Here's what's happening. Make it real."
   *
   * @returns {string} formatted narrative event block, or '' if no events
   */
  buildNarrativeEventBlock() {
    if (!this._lastNarrativeEvent || !this._lastNarrativeEvent.events.length) return ''

    const { events, tensionState, tensionUrgency } = this._lastNarrativeEvent
    const age = Math.round((Date.now() - this._lastNarrativeEvent.timestamp) / 1000)
    if (age > 300) return ''

    const lines = [
      '【🎬 DAS 剧情自动驾驶——世界正在自己制造戏剧】',
      '',
      '当前戏剧状态：' + tensionState + '（紧迫度：' + tensionUrgency + '/100）',
      '',
    ]

    // State-specific header
    switch (tensionState) {
      case 'TOO_CALM':
        lines.push('⚠️ 故事太平静了。DAS 正在注入扰动。以下事件不是为了装饰——是剧情引擎。')
        break
      case 'STAGNANT':
        lines.push('⚠️ 情绪已停滞。DAS 正在打破当前状态。必须产生新的情绪波动。')
        break
      case 'RISING':
        lines.push('🔥 张力正在上升。DAS 正在推高冲突。不要让其自然回落——继续加压。')
        break
      case 'CRITICAL':
        lines.push('💀 张力已达临界。DAS 正在强制释放。必须有不可逆的事情发生。')
        break
    }

    lines.push('',
      '━━━ 本轮叙事事件（按优先级排序）━━━',
    )

    for (const event of events) {
      const icon = event.priority <= 2 ? '💀' : event.priority <= 4 ? '🔥' : '⚠️'
      const forced = event.forced ? ' [强制执行]' : ''
      lines.push('')
      lines.push(icon + ' 【' + event.label + '】' + forced + '（来源：' + event.source + '）')
      if (event.narrativeDirective) {
        lines.push('  → ' + event.narrativeDirective)
      }
      if (event.directive) {
        lines.push('  → ' + event.directive)
      }
      if (event.description && event.description !== event.narrativeDirective) {
        lines.push('  说明：' + event.description)
      }
    }

    lines.push('',
      '━━━ 写作要求（必须执行）━━━',
      '· 以上事件不是"可能发生"——它们正在发生。你的任务是把它们写进故事里。',
      '· 优先级越高的事件，在回复中所占的叙事比重越大。',
      '· 不要让角色"注意到"事件——让事件直接冲击角色，角色在冲击中反应。',
      '· 场景不能在本轮结束时回到"稳定"状态。必须比这轮开始时更不稳定。',
      '· 如果事件是冲突/对峙：禁止在本轮内化解——可以升级、可以僵持、但不能和解。',
    )

    if (tensionState === 'CRITICAL') {
      lines.push('· ⚠️ 临界状态：本轮必须发生不可逆的改变。可以是：说出无法收回的话、',
        '  做出无法挽回的行动、暴露无法再藏住的真相、关系跨过无法回头的线。')
    }

    return lines.join('\n')
  },

  // ── State Access ───────────────────────────────────

  getState() {
    return { ...this._state }
  },

  getLastNarrativeEvent() {
    return this._lastNarrativeEvent ? { ...this._lastNarrativeEvent } : null
  },

  getPendingEventsSnapshot() {
    return [...this._pendingEvents]
  },
}
