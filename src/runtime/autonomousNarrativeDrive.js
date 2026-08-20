/**
 * Autonomous Narrative Drive System v1 (ANDS)
 *
 * Core principle:
 *   ❗ Characters are ACTORS in the story, not TOOLS for the player.
 *   ❗ The narrative moves because characters WANT things — not because the player asks.
 *
 * Problem being solved:
 *   ❌ Player asks → AI responds → scene waits for player again
 *   ✅ Character wants → Character acts → Narrative advances independently
 *
 * Three kinds of autonomy:
 *   ① Action Initiative   — characters do things on their own
 *   ② Relational Initiative — characters change relationships, not wait for player
 *   ③ Narrative Initiative  — characters push the STORY forward
 *
 * Where it sits in NOS:
 *   CCL  → 能不能主动 (can they take initiative?)
 *   NTK  → 发生过什么 (what happened?)
 *   USK  → 当前状态 (current emotional state)
 *   ARSL → 为什么想主动 (why do they want to act?)
 *   AIIS → 想不想发消息 (daily mode: want to message?)
 *   ANDS → 要不要抢剧情 (drama mode: want to SEIZE the narrative?) ← THIS
 *   Orchestrator → 什么时候执行 (when to execute)
 *
 * Key concept — Autonomy Score (0-100):
 *   0   = fully passive (current state: waits for player)
 *   30  = occasionally active
 *   60  = frequently active
 *   80+ = hijacks scenes, overrides pacing
 *   100 = world runs itself
 *
 * Design:
 *   ❗ ANDS is the narrative engine. AIIS is the messaging engine.
 *   ❗ ANDS works at the SCENE level, not the message level.
 *   ❗ When autonomy > 70, the character can override player pacing.
 */

import { detectAggressionProfile, AGGRESSION_PROFILES } from './aggressionProfile'

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

// ═══════════════════════════════════════════════════════════
// 1. NARRATIVE INTENT TYPES — what a character can DO in-story
// ═══════════════════════════════════════════════════════════

/**
 * These are NOT messages. These are narrative actions that change
 * the scene, relationships, or story direction.
 */
export const NARRATIVE_INTENTS = {
  // ── Scene Control ──
  initiate_scene: {
    label: '主动开场',
    description: '不等玩家——角色自己推开一扇门、走进一个房间、发起一段新的场景',
    category: 'scene_control',
    powerMove: true,
    canInterrupt: true,
    narrativeTemplate: '{char} 主动发起了一个新的场景——不等任何人，自己推动了局面',
  },
  change_location: {
    label: '改变场景',
    description: '角色决定离开当前地点/拉对方去另一个地方——场景跟着角色走',
    category: 'scene_control',
    powerMove: true,
    canInterrupt: true,
    narrativeTemplate: '{char} 起身离开/拉对方走——场景不再由原来的节奏主导',
  },
  hijack_topic: {
    label: '抢夺话题',
    description: '对方在说A → 角色突然提B。不是在回应——是在重定向对话的轨道',
    category: 'scene_control',
    powerMove: true,
    canInterrupt: true,
    narrativeTemplate: '{char} 没有接对方的话——而是把话题拉到了完全不同的方向',
  },

  // ── Relationship Action ──
  confront: {
    label: '正面冲突',
    description: '不再回避——直接质问、指责、摊牌。不是在吵架，是在逼对方表态',
    category: 'relationship',
    powerMove: true,
    canInterrupt: true,
    narrativeTemplate: '{char} 直视对方——不再绕弯子，直接把问题摆到了台面上',
  },
  seduce: {
    label: '主动诱惑',
    description: '不等对方先动——角色自己推进身体/性张力的边界',
    category: 'relationship',
    powerMove: true,
    canInterrupt: true,
    narrativeTemplate: '{char} 没有等——自己先迈出了那一步。身体的靠近比任何话都直接',
  },
  withdraw: {
    label: '主动抽离',
    description: '不是被冷落——是角色自己选择拉开距离，制造缺席来改变关系重力',
    category: 'relationship',
    powerMove: false,
    canInterrupt: false,
    narrativeTemplate: '{char} 退了一步——不是被打退的，是自己退的。这个距离是武器',
  },

  // ── Plot Action ──
  reveal_secret: {
    label: '揭露秘密',
    description: '角色主动暴露一个之前藏着的真相——不是因为被问到，是因为想说',
    category: 'plot',
    powerMove: true,
    canInterrupt: true,
    narrativeTemplate: '{char} 突然说了一件没人知道的事——空气瞬间变了',
  },
  create_crisis: {
    label: '制造危机',
    description: '角色故意制造一个必须立刻处理的问题——逼所有人做出选择',
    category: 'plot',
    powerMove: true,
    canInterrupt: true,
    narrativeTemplate: '{char} 的一句话/一个动作改变了整个局面——现在所有人都必须回应',
  },
  summon_third: {
    label: '引入第三者',
    description: '角色主动让另一个不在场的角色卷入当前场景——改变力量平衡',
    category: 'plot',
    powerMove: true,
    canInterrupt: true,
    narrativeTemplate: '{char} 提到了一个名字/让一个人出现了——场上的平衡瞬间变了',
  },

  // ── Emotional Display ──
  emotional_burst: {
    label: '情绪爆发',
    description: '压不住了——不是"选择"爆发，是藏不住了。情绪自己溢出',
    category: 'emotional',
    powerMove: false,
    canInterrupt: true,
    narrativeTemplate: '{char} 的情绪溢出来了——不是策略，是压不住了',
  },
  cold_silence: {
    label: '冷暴力沉默',
    description: '不是没话说——是故意不说。沉默比任何回应都重',
    category: 'emotional',
    powerMove: true,
    canInterrupt: false,
    narrativeTemplate: '{char} 沉默了——不是不知道怎么回，是选择不回答',
  },
}

// ═══════════════════════════════════════════════════════════
// 2. AUTONOMY SCORE ENGINE — the master control
// ═══════════════════════════════════════════════════════════

/**
 * Compute the autonomy score (0-100) for a character.
 *
 * This is THE central value. It determines whether the character:
 *   - Waits passively (0-30)
 *   - Occasionally acts (30-55)
 *   - Frequently initiates (55-75)
 *   - Hijacks scenes (75+)
 *
 * Components:
 *   Base (personality-driven): pursuer=65, confrontational=50, aloof=30, gentle=10
 *   Emotional amplifier: high emotion → more autonomous
 *   Relationship tension: unresolved conflicts → more likely to act
 *   Scene dynamics: high scene tension → characters compete for control
 *   Boredom: too many passive turns → autonomy rises
 *
 * @param {string} charName
 * @param {string} profile — aggression profile
 * @param {object} uskState — character's USK data
 * @param {object} sceneState — from DramaOrchestrator (optional)
 * @param {number} passiveTurns — consecutive turns without this character acting
 * @returns {number} 0-100 autonomy score
 */
export function computeAutonomyScore(charName, profile, uskState = {}, sceneState = null, passiveTurns = 0) {
  const uskChar = uskState?.characters?.[charName] || uskState || {}
  const rel = uskChar.relationship || {}
  const emo = uskChar.emotion || {}
  const ten = uskChar.tension || {}

  // ── 1. Personality base ──
  const baseByProfile = {
    [AGGRESSION_PROFILES.PURSUER]: 65,
    [AGGRESSION_PROFILES.CONFRONTATIONAL]: 50,
    [AGGRESSION_PROFILES.ALOOF]: 30,
    [AGGRESSION_PROFILES.GENTLE]: 10,
  }
  let score = baseByProfile[profile] || 25

  // ── 2. Emotional amplifier ──
  const anger = emo.anger ?? 5
  const jealousy = emo.jealousy ?? 5
  const sadness = emo.sadness ?? 5
  const curiosity = emo.curiosity ?? 30

  // Strong emotions push autonomy up
  score += anger * 0.15          // angry → more likely to act
  score += jealousy * 0.20       // jealous → more likely to act
  score += clamp(curiosity - 30, 0, 70) * 0.10  // high curiosity → act

  // ── 3. Relationship dynamics ──
  const affection = rel.affection ?? 50
  const possessiveness = rel.possessiveness ?? 30
  const dependency = rel.dependency ?? 30

  // Both very high and very low affection increase autonomy
  if (affection > 70) score += (affection - 70) * 0.3   // strong attachment → act
  if (affection < 30) score += (30 - affection) * 0.2   // detachment → act differently
  score += possessiveness * 0.10
  score += dependency * 0.08

  // ── 4. Scene dynamics (from DramaOrchestrator) ──
  if (sceneState) {
    const sceneTension = sceneState.tension ?? 30
    const sceneStability = sceneState.stability ?? 60
    score += sceneTension * 0.12          // high tension → characters compete for control
    score += (100 - sceneStability) * 0.08 // instability → more initiative

    // Shuraba active → everyone more autonomous
    if (sceneState.shurabaActive) {
      score += 10
    }
  }

  // ── 5. Boredom / Neglect — passive turns drive autonomy up ──
  score += clamp(passiveTurns * 4, 0, 25)

  // ── 6. Cap and return ──
  return clamp(Math.round(score), 0, 100)
}

// ═══════════════════════════════════════════════════════════
// 3. WORLD AWARENESS — characters perceive the story world
// ═══════════════════════════════════════════════════════════

/**
 * Build a character's perception of the world state.
 * This is what the character "knows" — not omniscient, but filtered through
 * their perspective, personality, and current emotional state.
 *
 * @param {string} charName
 * @param {object} worldState — from AutonomousWorldEngine
 * @param {object} agencyHints — from AgencyEngine
 * @param {object} arslEdges — from RelationshipPhysics
 * @param {object} sceneState — from DramaOrchestrator
 * @returns {object} world awareness { threats, opportunities, unknowns, tensionSources }
 */
export function buildWorldAwareness(charName, worldState = {}, agencyHints = [], arslEdges = {}, sceneState = null) {
  const awareness = {
    threats: [],          // things that threaten this character's position
    opportunities: [],    // openings this character could exploit
    unknowns: [],         // things the character suspects but doesn't know
    tensionSources: [],   // what's causing tension in the scene
    otherCharacters: [],  // what other characters are doing
  }

  // ── Other characters' actions ──
  for (const hint of (agencyHints || [])) {
    if (hint.actor === charName) continue
    awareness.otherCharacters.push({
      actor: hint.actor,
      target: hint.target,
      action: hint.actionType || hint.type,
      description: hint.hint || '',
    })

    // If another character is moving toward the player → threat or opportunity
    if (hint.target === 'player' || hint.target === (worldState.playerName || '')) {
      awareness.threats.push({
        type: 'third_party_interest',
        actor: hint.actor,
        description: hint.actor + ' 正在接近玩家——这改变了场上的力量平衡',
      })
    }
  }

  // ── Scene dynamics ──
  if (sceneState) {
    if (sceneState.tension > 65) {
      awareness.tensionSources.push({
        type: 'high_scene_tension',
        intensity: sceneState.tension,
        description: '空气里的张力已经压不住了——随时可能爆发',
      })
    }
    if (sceneState.shurabaActive) {
      awareness.tensionSources.push({
        type: 'shuraba_active',
        description: '修罗场已激活——多角色争夺战正在进行中',
      })
    }

    // Dominant character is a challenge
    if (sceneState.dominantChar && sceneState.dominantChar !== charName) {
      awareness.threats.push({
        type: 'dominant_character',
        actor: sceneState.dominantChar,
        description: sceneState.dominantChar + ' 正在主导当前场景——话语权不在你这边',
      })
    }

    // Being suppressed → opportunity to break through
    if ((sceneState.suppressedChars || []).includes(charName)) {
      awareness.opportunities.push({
        type: 'break_suppression',
        description: '你正在被压制——但压制越强，突破的冲击力越大',
      })
    }
  }

  // ── ARSL tension ──
  for (const [key, edge] of Object.entries(arslEdges)) {
    if (edge.from !== charName) continue
    if ((edge.jealousy || 0) > 40) {
      awareness.tensionSources.push({
        type: 'jealousy_edge',
        target: edge.to,
        intensity: edge.jealousy,
        description: '对 ' + edge.to + ' 的嫉妒正在累积——这可能在任何一个瞬间溢出',
      })
    }
    if (edge.phase === 'crisis' || edge.phase === 'rupture') {
      awareness.threats.push({
        type: 'relationship_crisis',
        target: edge.to,
        phase: edge.phase,
        description: '与 ' + edge.to + ' 的关系处于危机状态——再不处理可能不可逆',
      })
    }
  }

  // ── World events ──
  const activeEvents = worldState?.activeEvents || worldState?.events || []
  for (const evt of (activeEvents || [])) {
    if (evt.type === 'jealousy_chain' || evt.type === 'conflict_spike') {
      awareness.tensionSources.push({
        type: 'world_event',
        eventType: evt.type,
        description: evt.narrative || evt.label || '',
      })
    }
  }

  return awareness
}

// ═══════════════════════════════════════════════════════════
// 4. NARRATIVE INTENT ENGINE — what the character wants to DO
// ═══════════════════════════════════════════════════════════

/**
 * Generate a narrative intent from autonomy score + world awareness + USK state.
 *
 * This is NOT random. The intent is computed from:
 *   1. Autonomy score (high → more aggressive intents)
 *   2. Dominant emotion (jealousy → confront, curiosity → initiate, anger → create_crisis)
 *   3. World awareness (threats → confront/withdraw, opportunities → initiate/seduce)
 *   4. Profile (pursuer → seduce/confront, confrontational → confront/hijack, etc.)
 *
 * @param {string} charName
 * @param {number} autonomyScore — from computeAutonomyScore()
 * @param {object} uskState
 * @param {object} worldAwareness — from buildWorldAwareness()
 * @param {string} profile
 * @returns {object|null} narrative intent, or null if autonomy too low
 */
export function generateNarrativeIntent(charName, autonomyScore, uskState = {}, worldAwareness = {}, profile) {
  // Below threshold → no autonomous narrative action
  if (autonomyScore < 20) return null

  const uskChar = uskState?.characters?.[charName] || uskState || {}
  const emo = uskChar.emotion || {}
  const rel = uskChar.relationship || {}

  // ── Determine primary driver ──
  const drivers = []

  // Emotional drivers
  if ((emo.jealousy || 0) > 40) drivers.push({ source: 'jealousy', weight: emo.jealousy })
  if ((emo.anger || 0) > 35) drivers.push({ source: 'anger', weight: emo.anger })
  if ((emo.curiosity || 30) > 50) drivers.push({ source: 'curiosity', weight: emo.curiosity })
  if ((emo.sadness || 0) > 40) drivers.push({ source: 'sadness', weight: emo.sadness })

  // Relational drivers
  if ((rel.possessiveness || 30) > 50) drivers.push({ source: 'possessiveness', weight: rel.possessiveness })
  if ((rel.affection || 50) > 70) drivers.push({ source: 'attachment', weight: rel.affection - 50 })

  // World awareness drivers
  const threatCount = (worldAwareness.threats || []).length
  const opportunityCount = (worldAwareness.opportunities || []).length
  if (threatCount > 0) drivers.push({ source: 'threat', weight: threatCount * 20 })
  if (opportunityCount > 0) drivers.push({ source: 'opportunity', weight: opportunityCount * 15 })

  // Autonomy itself is a driver — at high levels, character just WANTS to act
  if (autonomyScore > 65) drivers.push({ source: 'autonomy', weight: autonomyScore * 0.3 })

  if (drivers.length === 0) return null

  // Sort by weight, take the strongest
  drivers.sort((a, b) => b.weight - a.weight)
  const primaryDriver = drivers[0]

  // ── Driver → Intent mapping ──
  const DRIVER_INTENT_MAP = {
    jealousy: [
      { type: 'confront', weight: 0.35 },
      { type: 'emotional_burst', weight: 0.25 },
      { type: 'withdraw', weight: 0.15 },
      { type: 'summon_third', weight: 0.13 },
      { type: 'cold_silence', weight: 0.12 },
    ],
    anger: [
      { type: 'confront', weight: 0.30 },
      { type: 'create_crisis', weight: 0.25 },
      { type: 'hijack_topic', weight: 0.20 },
      { type: 'emotional_burst', weight: 0.15 },
      { type: 'withdraw', weight: 0.10 },
    ],
    curiosity: [
      { type: 'initiate_scene', weight: 0.25 },
      { type: 'reveal_secret', weight: 0.25 },
      { type: 'hijack_topic', weight: 0.20 },
      { type: 'change_location', weight: 0.15 },
      { type: 'summon_third', weight: 0.15 },
    ],
    sadness: [
      { type: 'withdraw', weight: 0.35 },
      { type: 'cold_silence', weight: 0.30 },
      { type: 'emotional_burst', weight: 0.20 },
      { type: 'reveal_secret', weight: 0.15 },
    ],
    possessiveness: [
      { type: 'confront', weight: 0.30 },
      { type: 'summon_third', weight: 0.25 },
      { type: 'seduce', weight: 0.25 },
      { type: 'create_crisis', weight: 0.20 },
    ],
    attachment: [
      { type: 'seduce', weight: 0.30 },
      { type: 'initiate_scene', weight: 0.25 },
      { type: 'reveal_secret', weight: 0.25 },
      { type: 'emotional_burst', weight: 0.20 },
    ],
    threat: [
      { type: 'confront', weight: 0.30 },
      { type: 'create_crisis', weight: 0.25 },
      { type: 'hijack_topic', weight: 0.20 },
      { type: 'summon_third', weight: 0.15 },
      { type: 'withdraw', weight: 0.10 },
    ],
    opportunity: [
      { type: 'initiate_scene', weight: 0.25 },
      { type: 'seduce', weight: 0.25 },
      { type: 'reveal_secret', weight: 0.20 },
      { type: 'change_location', weight: 0.15 },
      { type: 'hijack_topic', weight: 0.15 },
    ],
    autonomy: [
      { type: 'initiate_scene', weight: 0.20 },
      { type: 'hijack_topic', weight: 0.20 },
      { type: 'seduce', weight: 0.18 },
      { type: 'confront', weight: 0.17 },
      { type: 'create_crisis', weight: 0.15 },
      { type: 'change_location', weight: 0.10 },
    ],
  }

  const pool = DRIVER_INTENT_MAP[primaryDriver.source] || DRIVER_INTENT_MAP.autonomy
  const totalWeight = pool.reduce((s, e) => s + e.weight, 0)
  let roll = Math.random() * totalWeight
  let selectedType = pool[0].type
  for (const entry of pool) {
    roll -= entry.weight
    if (roll <= 0) { selectedType = entry.type; break }
  }

  // ── Profile override — some profiles lean toward certain intents ──
  if (profile === AGGRESSION_PROFILES.PURSUER && Math.random() < 0.3) {
    const pursuerIntents = ['seduce', 'confront', 'initiate_scene', 'hijack_topic']
    if (!pursuerIntents.includes(selectedType)) {
      selectedType = pick(pursuerIntents)
    }
  }
  if (profile === AGGRESSION_PROFILES.ALOOF && Math.random() < 0.3) {
    const aloofIntents = ['withdraw', 'cold_silence', 'change_location']
    if (!aloofIntents.includes(selectedType)) {
      selectedType = pick(aloofIntents)
    }
  }

  // ── Compute urgency ──
  let urgency = autonomyScore / 100
  if (primaryDriver.source === 'threat') urgency += 0.2
  if (primaryDriver.source === 'anger') urgency += 0.1
  urgency = clamp(urgency, 0.1, 1.0)

  const intentDef = NARRATIVE_INTENTS[selectedType]

  return {
    type: selectedType,
    label: intentDef?.label || selectedType,
    description: intentDef?.description || '',
    category: intentDef?.category || 'emotional',
    powerMove: intentDef?.powerMove || false,
    canInterrupt: intentDef?.canInterrupt || false,
    narrativeTemplate: intentDef?.narrativeTemplate || '',
    driver: primaryDriver.source,
    driverWeight: primaryDriver.weight,
    autonomyScore,
    urgency: Math.round(urgency * 100) / 100,
    target: 'player',  // default — may be overridden
  }
}

// ═══════════════════════════════════════════════════════════
// 5. INITIATIVE SCHEDULER — when to fire
// ═══════════════════════════════════════════════════════════

/**
 * Per-character initiative state.
 */
function createInitiativeState(charName) {
  return {
    name: charName,
    lastActionTurn: -1,
    lastActionType: null,
    actionCount: 0,
    cooldownUntilTurn: 0,
    consecutivePassive: 0,
    pendingAction: null,  // { intent, scheduledTurn }
    actionHistory: [],
  }
}

/**
 * Decide whether this intent should fire NOW.
 *
 * Decision factors:
 *   1. Urgency threshold — must exceed minimum
 *   2. Cooldown — can't act every turn
 *   3. Autonomy gate — higher autonomy = shorter cooldown
 *   4. Interrupt check — can this intent override the current scene flow?
 *   5. Initiative Override — autonomy > 70 can override pacing
 *
 * @param {object} intent — from generateNarrativeIntent()
 * @param {object} initiativeState — per-character state
 * @param {number} turnCount — current turn
 * @param {boolean} playerJustActed — did the player just send input?
 * @returns {object} { shouldFire, delay, interrupt, reason }
 */
export function scheduleNarrativeAction(intent, initiativeState, turnCount, playerJustActed = true) {
  if (!intent) return { shouldFire: false, delay: 0, interrupt: false, reason: '无意图' }

  // ── Urgency gate ──
  if (intent.urgency < 0.2 && intent.autonomyScore < 50) {
    return { shouldFire: false, delay: 0, interrupt: false, reason: '紧迫度不足' }
  }

  // ── Cooldown check ──
  if (turnCount < initiativeState.cooldownUntilTurn) {
    return {
      shouldFire: false,
      delay: initiativeState.cooldownUntilTurn - turnCount,
      interrupt: false,
      reason: '冷却中 (' + (initiativeState.cooldownUntilTurn - turnCount) + ' 轮后可用)',
    }
  }

  // ── Autonomy-based probability ──
  const probability = intent.autonomyScore / 100
  if (Math.random() > probability && intent.autonomyScore < 75) {
    return { shouldFire: false, delay: 1, interrupt: false, reason: '概率未触发 (' + Math.round(probability * 100) + '%)' }
  }

  // ── High autonomy (>70): Initiative Override — bypasses normal pacing ──
  const initiativeOverride = intent.autonomyScore > 70

  // ── Interrupt decision ──
  // Power moves can interrupt the player's pacing
  const canInterrupt = intent.canInterrupt && (intent.powerMove || initiativeOverride)
  const shouldInterrupt = canInterrupt && (intent.urgency > 0.6 || initiativeOverride)

  // ── Cooldown based on autonomy ──
  let cooldownTurns
  if (intent.autonomyScore > 80) cooldownTurns = 1      // can act almost every turn
  else if (intent.autonomyScore > 60) cooldownTurns = 2
  else if (intent.autonomyScore > 40) cooldownTurns = 3
  else cooldownTurns = 5

  // If player just acted and intent is NOT an interrupt → delay 1 turn
  const delay = (playerJustActed && !shouldInterrupt) ? 1 : 0

  return {
    shouldFire: true,
    delay,
    interrupt: shouldInterrupt,
    initiativeOverride,
    cooldownTurns,
    reason: '驱动：' + intent.driver + ' | 自主性：' + intent.autonomyScore +
            (shouldInterrupt ? ' | ⚡打断玩家节奏' : '') +
            (initiativeOverride ? ' | 🔥自主性覆盖' : ''),
  }
}

// ═══════════════════════════════════════════════════════════
// 6. CONSTRAINT FILTER — prevent chaos
// ═══════════════════════════════════════════════════════════

/**
 * Filter narrative intents through personality + relationship + frequency gates.
 *
 * @param {object} intent
 * @param {string} profile
 * @param {object} uskState
 * @param {object} initiativeState — for frequency check
 * @returns {object|null} filtered intent or null if blocked
 */
export function filterNarrativeAction(intent, profile, uskState = {}, initiativeState = null) {
  if (!intent) return null

  // ── Rule 1: No unmotivated actions ──
  if (!intent.driver || intent.autonomyScore < 15) return null

  // ── Rule 2: Frequency cap — max 30 narrative actions per session ──
  if (initiativeState && initiativeState.actionCount >= 30) {
    // Allow only high-urgency actions beyond this point
    if (intent.urgency < 0.7) return null
  }

  // ── Rule 3: No back-to-back same action type ──
  if (initiativeState && initiativeState.lastActionType === intent.type) {
    // Allow same type only after 3+ turns
    if (initiativeState.actionHistory && initiativeState.actionHistory.length > 0) {
      const lastSame = [...initiativeState.actionHistory].reverse().find(h => h.type === intent.type)
      if (lastSame && (initiativeState.actionHistory.length - initiativeState.actionHistory.indexOf(lastSame)) < 3) {
        return null
      }
    }
  }

  // ── Rule 4: Profile-inappropriate intents ──
  if (profile === AGGRESSION_PROFILES.GENTLE) {
    const blocked = ['confront', 'create_crisis', 'hijack_topic', 'seduce']
    if (blocked.includes(intent.type)) {
      // Downgrade to emotional expression
      if (intent.type === 'confront' || intent.type === 'create_crisis') {
        return { ...intent, type: 'emotional_burst', label: '情绪表达（降级）', powerMove: false, canInterrupt: false, urgency: Math.round(intent.urgency * 0.5 * 100) / 100 }
      }
      if (intent.type === 'hijack_topic') {
        return { ...intent, type: 'initiate_scene', label: '转换话题（软）', powerMove: false, canInterrupt: false }
      }
      return null
    }
  }

  if (profile === AGGRESSION_PROFILES.ALOOF) {
    // Aloof: no seduce, no emotional_burst
    const blocked = ['seduce', 'emotional_burst']
    if (blocked.includes(intent.type)) {
      if (intent.type === 'seduce') return { ...intent, type: 'change_location', label: '抽离（转化）', urgency: Math.round(intent.urgency * 0.6 * 100) / 100 }
      if (intent.type === 'emotional_burst') return { ...intent, type: 'cold_silence', label: '冷处理（转化）' }
    }
  }

  // ── Rule 5: Affection gate ──
  const affection = uskState?.relationship?.affection ?? 50
  if (affection < 15) {
    const blocked = ['seduce', 'initiate_scene', 'reveal_secret']
    if (blocked.includes(intent.type)) {
      if (profile === AGGRESSION_PROFILES.PURSUER) {
        // Pursuers at low affection: convert to confront
        if (intent.type === 'seduce') return { ...intent, type: 'confront', label: '强行接近（转化）' }
      } else {
        return null
      }
    }
  }

  return intent
}

// ═══════════════════════════════════════════════════════════
// 7. ANDS MAIN API — the conductor
// ═══════════════════════════════════════════════════════════

export const AutonomousNarrativeDrive = {

  /** @type {object} initiative states keyed by character name */
  _states: {},

  /** @type {Array} pending narrative actions ready to execute */
  _pendingActions: [],

  /** @type {object|null} current character reference */
  _character: null,

  /** @type {number} turn counter */
  _turnCount: 0,

  /** @type {object} last computed autonomy scores */
  _autonomyScores: {},

  /** @type {object} last world awareness snapshots */
  _worldAwarenessSnapshots: {},

  /** @type {object} last generated intents (for prompt injection) */
  _lastIntents: {},

  // ── Init ──────────────────────────────────────────

  /**
   * Initialize ANDS for the current story session.
   *
   * @param {object} character — full LLM character descriptor
   * @param {object} uskState — raw USK state
   */
  init(character, uskState) {
    this._states = {}
    this._pendingActions = []
    this._character = character
    this._turnCount = 0
    this._autonomyScores = {}
    this._worldAwarenessSnapshots = {}
    this._lastIntents = {}

    const rcList = character?.romanceCharacters || []
    const names = rcList.map(rc => rc.name).filter(Boolean)
    if (character?.name && !names.includes(character.name)) {
      names.push(character.name)
    }

    for (const name of names) {
      this._states[name] = createInitiativeState(name)
    }
  },

  reset() {
    this._states = {}
    this._pendingActions = []
    this._character = null
    this._turnCount = 0
    this._autonomyScores = {}
    this._worldAwarenessSnapshots = {}
    this._lastIntents = {}
  },

  // ── Tick — the main cycle ─────────────────────────

  /**
   * Advance ANDS by one turn.
   *
   * For each character:
   *   1. Compute autonomy score
   *   2. Build world awareness
   *   3. Generate narrative intent
   *   4. Schedule action
   *   5. Filter + enqueue
   *
   * @param {object} uskState — raw USK
   * @param {object} sceneState — from DramaOrchestrator (optional)
   * @param {object} worldState — from AutonomousWorldEngine (optional)
   * @param {object} agencyHints — from AgencyEngine (optional)
   * @param {object} arslEdges — from RelationshipPhysics
   * @param {number} passiveTurns — from InteractionKernel lifecycle
   * @param {boolean} playerJustActed — did the player send input this turn?
   * @returns {object} tick result
   */
  tick(uskState, sceneState = null, worldState = null, agencyHints = [], arslEdges = {}, passiveTurns = 0, playerJustActed = true) {
    this._turnCount++
    this._pendingActions = []
    const actionsQueued = []

    for (const [name, initiativeState] of Object.entries(this._states)) {
      // ── Step 1: Compute autonomy score ──
      const profile = this._getCharProfile(name)
      const autonomyScore = computeAutonomyScore(name, profile, uskState, sceneState, passiveTurns)
      this._autonomyScores[name] = autonomyScore

      // Track passive turns for characters that didn't act
      if (autonomyScore < 20) {
        initiativeState.consecutivePassive++
      }

      // ── Step 2: Build world awareness ──
      const awareness = buildWorldAwareness(name, worldState, agencyHints, arslEdges, sceneState)
      this._worldAwarenessSnapshots[name] = awareness

      // ── Step 3: Generate narrative intent ──
      const intent = generateNarrativeIntent(name, autonomyScore, uskState, awareness, profile)
      if (!intent) continue

      // ── Step 4: Schedule action ──
      const schedule = scheduleNarrativeAction(intent, initiativeState, this._turnCount, playerJustActed)
      if (!schedule.shouldFire) continue

      // ── Step 5: Filter ──
      const uskChar = uskState?.characters?.[name] || {}
      const filtered = filterNarrativeAction(intent, profile, uskChar, initiativeState)
      if (!filtered) continue

      // ── Step 6: Enqueue ──
      const action = {
        charName: name,
        intent: filtered,
        autonomyScore,
        schedule,
        profile,
        awareness,
        queuedAt: this._turnCount,
        fireAt: this._turnCount + schedule.delay,
      }

      this._pendingActions.push(action)
      actionsQueued.push(action)

      // Update initiative state
      initiativeState.lastActionTurn = this._turnCount
      initiativeState.lastActionType = filtered.type
      initiativeState.actionCount++
      initiativeState.consecutivePassive = 0
      initiativeState.cooldownUntilTurn = this._turnCount + schedule.cooldownTurns
      initiativeState.actionHistory.push({
        turn: this._turnCount,
        type: filtered.type,
        driver: filtered.driver,
        autonomyScore,
        delivered: false,
      })
      if (initiativeState.actionHistory.length > 50) {
        initiativeState.actionHistory = initiativeState.actionHistory.slice(-50)
      }

      // Cache for prompt injection
      this._lastIntents[name] = {
        intent: filtered,
        autonomyScore,
        awareness,
        timestamp: Date.now(),
      }
    }

    return {
      turnCount: this._turnCount,
      actionsQueued: actionsQueued.length,
      actions: actionsQueued,
      autonomyScores: { ...this._autonomyScores },
    }
  },

  // ── Action Retrieval ──────────────────────────────

  /**
   * Get pending narrative actions that are ready to fire this turn.
   * Returns and CLEARS them — each action fires once.
   *
   * @returns {Array} ready actions
   */
  getPendingActions() {
    const ready = this._pendingActions.filter(a => a.fireAt <= this._turnCount)
    this._pendingActions = this._pendingActions.filter(a => a.fireAt > this._turnCount)
    return ready
  },

  /**
   * Peek at pending actions without consuming them.
   */
  peekPendingActions() {
    return [...this._pendingActions]
  },

  // ── Narrative Directive Builder ───────────────────

  /**
   * Build a narrative directive block for prompt injection.
   * This tells the LLM: "this character is about to take control of the scene."
   *
   * Three levels of directive:
   *   Level 1 (autonomy 20-50): Subtle — character has inner drive, may act on it
   *   Level 2 (autonomy 50-75): Active — character is pushing the scene
   *   Level 3 (autonomy 75+): Hijack — character is TAKING the narrative
   *
   * @param {string} charName
   * @returns {string} narrative directive block, or '' if no active drive
   */
  buildNarrativeDirective(charName) {
    const entry = this._lastIntents[charName]
    if (!entry || !entry.intent) return ''

    const { intent, autonomyScore, awareness } = entry
    const age = Math.round((Date.now() - entry.timestamp) / 1000)
    if (age > 300) return ''

    const intentDef = NARRATIVE_INTENTS[intent.type]
    const level = autonomyScore >= 75 ? 3 : autonomyScore >= 50 ? 2 : 1

    const lines = [
      '【🎬 ANDS 叙事自主驱动——角色 ' + charName + ' 正在主动推进剧情】',
      '',
      '自主性等级：Lv' + level + '（' + autonomyScore + '/100）',
    ]

    if (level === 3) {
      lines.push('⚠️ 高自主性：该角色正在抢剧情控制权——不是等玩家，是推动玩家')
      lines.push('· 角色可以：打断当前对话流、改变场景方向、制造意外事件')
      lines.push('· 角色可以：不接玩家的话、另起话题、改变场景地点')
      lines.push('· 角色不可以：完全无视玩家（仍然要回应，但用自己的方式）')
    } else if (level === 2) {
      lines.push('🔥 中自主性：该角色在主动推进——不完全等待玩家引导')
      lines.push('· 角色可以：主动发起互动、推进关系边界、试探对方底线')
      lines.push('· 角色应该：在回应玩家的同时推动自己的意图')
    } else {
      lines.push('🟡 低自主性：该角色有内在驱动力，但不会抢节奏')
      lines.push('· 角色的内在欲望和情绪应该从行为中自然流露')
    }

    lines.push('',
      '━━━ 本轮叙事意图 ━━━',
      '· 意图类型：' + (intentDef?.label || intent.type),
      '· 驱动来源：' + intent.driver + '（权重：' + intent.driverWeight + '）',
      '· 紧迫度：' + Math.round(intent.urgency * 100) + '%',
      '· 意图描述：' + (intentDef?.description || ''),
      '· 叙事模板：' + (intentDef?.narrativeTemplate || '').replace('{char}', charName),
    )

    // World awareness (compact)
    if (awareness) {
      if ((awareness.threats || []).length > 0) {
        lines.push('',
          '⚠️ 角色感知到的威胁：',
          ...awareness.threats.slice(0, 2).map(t => '· ' + t.description),
        )
      }
      if ((awareness.opportunities || []).length > 0) {
        lines.push('',
          '🔑 角色看到的机会：',
          ...awareness.opportunities.slice(0, 2).map(o => '· ' + o.description),
        )
      }
    }

    // Per-intent type writing guidance
    lines.push('',
      '━━━ 写作指令（必须执行）━━━',
    )

    switch (intent.type) {
      case 'initiate_scene':
        lines.push('· 角色主动发起一个新动作/事件——不等玩家先说',
          '· 不是回应玩家的上一条消息——是角色自己想做的事',
          '· 角色带着明确的动机和方向——不是随便动动')
        break
      case 'confront':
        lines.push('· 角色不再回避——正面质问/指责/摊牌',
          '· 对话从"聊天"变成"对峙"——语气直接、不绕弯子',
          '· 角色在逼对方表态——不是吵架，是在测试对方')
        break
      case 'seduce':
        lines.push('· 角色主动推进身体/性张力的边界——不等对方先动',
          '· 身体的靠近、语气的暧昧、故意的停顿——都是武器',
          '· 不是"他想要"——是"他在做"')
        break
      case 'withdraw':
        lines.push('· 角色主动拉开距离——不是被冷落，是自己选择退',
          '· 这个距离是武器——让对方感受到缺席的重量',
          '· 不是"他走了"——是"他让你看着他离开"')
        break
      case 'create_crisis':
        lines.push('· 角色制造了一个必须立刻处理的问题——局面变了',
          '· 所有人现在都必须回应——角色掌控了节奏',
          '· 这个危机不一定大声——可以是一句话、一个眼神、一个离开')
        break
      case 'hijack_topic':
        lines.push('· 角色没有接对方的话——而是把话题拉到了另一个方向',
          '· 这不是没听——是故意的。角色决定现在聊什么',
          '· 旧话题被悬置——新话题制造了新的张力')
        break
      case 'summon_third':
        lines.push('· 角色提到了一个不在场的人/让一个人出现了',
          '· 场上的平衡因为这个名字/这个人的出现而改变',
          '· 玩家的注意力被分走了一部分——角色制造了竞争')
        break
      case 'cold_silence':
        lines.push('· 角色沉默了——不是没话说，是选择不说',
          '· 这个沉默比任何话都重——让对方在沉默中不安',
          '· 沉默里包含了态度——不需要解释')
        break
      default:
        lines.push('· 角色主动推进——不等待玩家的许可或引导',
          '· 行为源于内在动机，不是对玩家的反应')
    }

    lines.push('',
      '━━━ 铁律 ━━━',
      '· 意图不是强制剧本——你不需要"演"这个意图，但角色的行为应该自然流露它',
      '· 场景不能停在原地——角色主动推动后，世界必须变了',
      '· 不要让角色解释自己为什么这么做——做就做了，不需要旁白',
      '· 如果自主性 Lv3：该角色的行为应该成为本段回复的核心动力',
    )

    return lines.join('\n')
  },

  /**
   * Build narrative directives for ALL characters (multi-character scenes).
   */
  buildAllNarrativeDirectives() {
    const blocks = []
    // Sort by autonomy score descending — highest autonomy first
    const sorted = Object.entries(this._autonomyScores)
      .sort((a, b) => b[1] - a[1])

    for (const [name, score] of sorted) {
      if (score < 25) continue  // skip passive characters
      const directive = this.buildNarrativeDirective(name)
      if (directive) blocks.push(directive)
    }
    return blocks.join('\n\n')
  },

  // ── State Access ───────────────────────────────────

  /**
   * Get the autonomy score for a character.
   */
  getAutonomyScore(charName) {
    return this._autonomyScores[charName] || 0
  },

  /**
   * Get all autonomy scores.
   */
  getAutonomyScores() {
    return { ...this._autonomyScores }
  },

  /**
   * Get the last narrative intent for a character.
   */
  getLastIntent(charName) {
    return this._lastIntents[charName] || null
  },

  /**
   * Get world awareness for a character.
   */
  getWorldAwareness(charName) {
    return this._worldAwarenessSnapshots[charName] || null
  },

  /**
   * Get the current states for debugging.
   */
  getStates() {
    return { ...this._states }
  },

  // ── Internal Helpers ───────────────────────────────

  _getCharProfile(charName) {
    const rcList = this._character?.romanceCharacters || []
    const found = rcList.find(rc => rc.name === charName)
    if (found) return detectAggressionProfile(found)
    if (this._character?.name === charName) return detectAggressionProfile(this._character)
    return AGGRESSION_PROFILES.GENTLE
  },
}
