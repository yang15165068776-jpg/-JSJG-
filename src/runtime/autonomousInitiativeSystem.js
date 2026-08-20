/**
 * Autonomous Intent & Initiative System v1 (AIIS)
 *
 * Core principle:
 *   ❗ Characters "want things" on their own. They don't just react — they INITIATE.
 *
 * Problem being solved:
 *   ❌ Player says → AI responds (passive, dead chat feel)
 *   ✅ AI wants → AI decides → AI acts (Level 3: real human-feeling)
 *
 * Architecture (from user spec):
 *   IntentGenerator → MotivationField → BurstScheduler → ActionFilter
 *
 * Where it sits in NOS:
 *   CCL  → 能不能做 (can they do it?)
 *   NTK  → 发生过什么 (what happened?)
 *   USK  → 当前情绪 (how do they feel?)
 *   ARSL → 为什么想这样 (why do they want this?)
 *   AIIS → 想不想做 (DO they want to?)  ← THIS MODULE
 *   Orchestrator → 什么时候执行 (when to execute)
 *
 * Design:
 *   ❗ Initiative is NOT a prompt effect. It's an independent decision system.
 *   ❗ The model doesn't "forget" to be proactive — it was never authorized.
 *   This module AUTHORIZES and SCHEDULES proactive behavior.
 */

import { detectAggressionProfile, isPursuer, isConfrontational, AGGRESSION_PROFILES } from './aggressionProfile'

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

// ═══════════════════════════════════════════════════════════
// 1. INTENT TYPES — what a character can decide to do
// ═══════════════════════════════════════════════════════════

/**
 * Level 1 (basic): passive reply only — no initiative
 * Level 2 (semi-active): occasional unsolicited message
 * Level 3 (alive): jealousy, probe, cold war, sudden care, interrupt
 */
export const INTENT_TYPES = {
  // ── Level 2: Semi-active ──
  message_contact: {
    level: 2,
    label: '主动联系',
    description: '想找你聊天——不是因为你说了什么，是因为想你了/无聊了/想确认你在不在',
    dailyAction: 'send_message',
    dramaAction: 'initiate_interaction',
  },
  message_emotional: {
    level: 2,
    label: '情绪性主动消息',
    description: '情绪驱动下主动发消息——不开心、孤独、需要被注意到',
    dailyAction: 'send_message',
    dramaAction: 'emotional_display',
  },

  // ── Level 3: Alive ──
  probe_test: {
    level: 3,
    label: '试探',
    description: '试探对方的底线、态度、感情——不是问，是用行为测',
    dailyAction: 'send_message',
    dramaAction: 'provocative_action',
  },
  cold_shoulder: {
    level: 3,
    label: '冷落/冷战',
    description: '故意冷淡、不回复、拉开距离——不是因为不在乎，是因为太在乎了需要对方感觉到',
    dailyAction: 'withhold_reply',
    dramaAction: 'cold_dismissal',
  },
  provoke: {
    level: 3,
    label: '挑衅/刺激',
    description: '故意说让对方生气的话、踩雷区——就想看对方炸毛',
    dailyAction: 'send_message',
    dramaAction: 'aggressive_action',
  },
  jealousy_show: {
    level: 3,
    label: '吃醋表现',
    description: '让对方知道自己在意、在吃醋——但不直接说"我吃醋了"',
    dailyAction: 'send_message',
    dramaAction: 'jealousy_display',
  },
  sudden_care: {
    level: 3,
    label: '突然关心',
    description: '对方没期待的时候突然温柔一下——打破预期，让对方困惑又心动',
    dailyAction: 'send_message',
    dramaAction: 'gentle_approach',
  },
  interrupt_flow: {
    level: 3,
    label: '打断当前对话流',
    description: '对方正在说A→角色突然提B。不是没听，是不想让对方继续说了',
    dailyAction: 'change_topic',
    dramaAction: 'interrupt_scene',
  },
  power_move: {
    level: 3,
    label: '权力移动',
    description: '主动制造一个让对方必须回应、必须选择的局面——夺取对话主导权',
    dailyAction: 'send_message',
    dramaAction: 'dominance_display',
  },
}

// ═══════════════════════════════════════════════════════════
// 2. MOTIVATION FIELD — why a character would act
// ═══════════════════════════════════════════════════════════

/**
 * Compute the 5 motivation dimensions from USK state + ARSL edges.
 *
 * Motivation dimensions:
 *   curiosity   — want to know what the other is doing/thinking/feeling
 *   jealousy    — perceived threat from third parties
 *   attachment  — emotional need for the other person
 *   dominance   — need for control / power over the situation
 *   insecurity  — fear of losing connection or status
 *
 * @param {string} charName
 * @param {object} uskState — raw USK characters map
 * @param {object} arslEdges — from RelationshipPhysics.edges
 * @param {number} timeSinceLastInteraction — seconds since last player interaction
 * @returns {object} motivation field { curiosity, jealousy, attachment, dominance, insecurity }
 */
export function computeMotivationField(charName, uskState, arslEdges = {}, timeSinceLastInteraction = 0) {
  const uskChar = uskState?.characters?.[charName] || uskState?.[charName] || {}
  const rel = uskChar.relationship || {}
  const emo = uskChar.emotion || {}
  const ten = uskChar.tension || {}
  const lif = uskChar.life || {}

  // ── Curiosity ──
  // Driven by: low information (time since last interaction), natural curiosity trait, boredom
  let curiosity = (emo.curiosity ?? 30) * 0.4
  // Idle time increases curiosity (capped)
  curiosity += clamp(timeSinceLastInteraction / 120, 0, 40) * 0.5  // 2 min idle → +20 curious
  // Boredom amplifies curiosity
  const loneliness = lif.lonely ?? lif.loneliness ?? 40
  curiosity += loneliness * 0.2
  curiosity = clamp(curiosity, 0, 100)

  // ── Jealousy ──
  // Pull from USK emotion directly, plus ARSL jealousy edges
  let jealousy = emo.jealousy ?? 5
  // Sum jealousy from all outgoing ARSL edges
  for (const [key, edge] of Object.entries(arslEdges)) {
    if (edge.from === charName && edge.jealousy != null) {
      jealousy = Math.max(jealousy, edge.jealousy)
    }
  }
  jealousy = clamp(jealousy, 0, 100)

  // ── Attachment ──
  // Combines affection + dependency + fear of loss
  const affection = rel.affection ?? 50
  const dependency = rel.dependency ?? 30
  const fear = rel.fear ?? 30
  let attachment = affection * 0.4 + dependency * 0.35 + fear * 0.25
  attachment = clamp(attachment, 0, 100)

  // ── Dominance ──
  // Driven by: power imbalance, unresolved conflicts, possessiveness
  const powerImbalance = ten.power_imbalance ?? 50
  const unresolvedConflicts = ten.unresolved_conflicts ?? 0
  const possessiveness = rel.possessiveness ?? 30
  let dominance = powerImbalance * 0.3 + unresolvedConflicts * 0.35 + possessiveness * 0.35
  dominance = clamp(dominance, 0, 100)

  // ── Insecurity ──
  // Driven by: actual insecurity + instability markers
  const insecurity = rel.insecurity ?? 40
  const anxiety = emo.anxiety ?? 10
  const attractionTension = ten.attraction_tension ?? 40
  let insecurityScore = insecurity * 0.4 + anxiety * 0.3 + (100 - attractionTension) * 0.3
  insecurityScore = clamp(insecurityScore, 0, 100)

  return {
    curiosity: Math.round(curiosity),
    jealousy: Math.round(jealousy),
    attachment: Math.round(attachment),
    dominance: Math.round(dominance),
    insecurity: Math.round(insecurityScore),
  }
}

// ═══════════════════════════════════════════════════════════
// 3. INTENT GENERATOR — what the character wants to do
// ═══════════════════════════════════════════════════════════

/**
 * Generate an intent from the motivation field + character profile.
 *
 * The intent is NOT random — it's computed from which motivation dimensions
 * are highest. Each dimension maps to a cluster of intent types.
 *
 * @param {object} motivation — from computeMotivationField()
 * @param {string} profile — aggression profile (pursuer/confrontational/aloof/gentle)
 * @param {object} uskState — for additional context
 * @returns {object} intent { type, target, strength, content, motivationSource }
 */
export function generateIntent(motivation, profile, uskState = {}) {
  // ── Find the dominant motivation ──
  const dims = [
    { key: 'curiosity', value: motivation.curiosity },
    { key: 'jealousy', value: motivation.jealousy },
    { key: 'attachment', value: motivation.attachment },
    { key: 'dominance', value: motivation.dominance },
    { key: 'insecurity', value: motivation.insecurity },
  ]
  dims.sort((a, b) => b.value - a.value)
  const primary = dims[0]
  const secondary = dims[1]

  // ── Motivation → Intent type mapping ──
  // Each motivation dimension has a weighted pool of intent types
  const MOTIVATION_INTENT_MAP = {
    curiosity: [
      { type: 'message_contact', weight: 0.35 },
      { type: 'message_emotional', weight: 0.20 },
      { type: 'probe_test', weight: 0.25 },
      { type: 'sudden_care', weight: 0.10 },
      { type: 'interrupt_flow', weight: 0.10 },
    ],
    jealousy: [
      { type: 'jealousy_show', weight: 0.35 },
      { type: 'probe_test', weight: 0.20 },
      { type: 'provoke', weight: 0.20 },
      { type: 'cold_shoulder', weight: 0.15 },
      { type: 'power_move', weight: 0.10 },
    ],
    attachment: [
      { type: 'message_contact', weight: 0.25 },
      { type: 'sudden_care', weight: 0.25 },
      { type: 'message_emotional', weight: 0.20 },
      { type: 'jealousy_show', weight: 0.15 },
      { type: 'probe_test', weight: 0.15 },
    ],
    dominance: [
      { type: 'power_move', weight: 0.30 },
      { type: 'provoke', weight: 0.25 },
      { type: 'interrupt_flow', weight: 0.20 },
      { type: 'cold_shoulder', weight: 0.15 },
      { type: 'probe_test', weight: 0.10 },
    ],
    insecurity: [
      { type: 'probe_test', weight: 0.25 },
      { type: 'message_emotional', weight: 0.20 },
      { type: 'jealousy_show', weight: 0.20 },
      { type: 'cold_shoulder', weight: 0.20 },
      { type: 'message_contact', weight: 0.15 },
    ],
  }

  // Weighted random selection from primary motivation's pool
  const pool = MOTIVATION_INTENT_MAP[primary.key] || MOTIVATION_INTENT_MAP.curiosity
  const totalWeight = pool.reduce((s, e) => s + e.weight, 0)
  let roll = Math.random() * totalWeight
  let selectedType = pool[0].type
  for (const entry of pool) {
    roll -= entry.weight
    if (roll <= 0) { selectedType = entry.type; break }
  }

  // ── Strength: composite of primary motivation value + profile modifier ──
  let strength = primary.value
  // Profile modifiers
  if (profile === AGGRESSION_PROFILES.PURSUER) strength = clamp(strength + 15, 0, 100)
  else if (profile === AGGRESSION_PROFILES.CONFRONTATIONAL) strength = clamp(strength + 8, 0, 100)
  else if (profile === AGGRESSION_PROFILES.ALOOF) strength = clamp(strength - 5, 0, 100)
  else strength = clamp(strength - 8, 0, 100)  // gentle: less likely to act strongly

  // ── Assemble intent ──
  const intentDef = INTENT_TYPES[selectedType]
  return {
    type: selectedType,
    level: intentDef?.level || 2,
    target: 'player',
    strength,
    motivationSource: primary.key,
    secondarySource: secondary.key,
    dailyAction: intentDef?.dailyAction || 'send_message',
    dramaAction: intentDef?.dramaAction || 'initiate_interaction',
    label: intentDef?.label || selectedType,
    description: intentDef?.description || '',
  }
}

// ═══════════════════════════════════════════════════════════
// 4. BURST SCHEDULER — when to act
// ═══════════════════════════════════════════════════════════

/**
 * Burst state tracked per character.
 */
function createBurstState(charName) {
  return {
    name: charName,
    lastBurstTime: 0,        // timestamp of last burst
    burstCount: 0,           // total bursts this session
    cooldownUntil: 0,        // can't burst before this timestamp
    pendingIntent: null,     // { intent, queuedAt }
    burstHistory: [],        // [{ time, intent, delivered }]
  }
}

/**
 * Decide whether an intent should trigger a burst right now.
 *
 * Decision factors:
 *   1. Strength threshold — must be above minimum
 *   2. Cooldown — can't burst too frequently
 *   3. Emotional drift — sudden spikes in motivation bypass cooldown
 *   4. Random jitter — human unpredictability
 *   5. Profile modifier — pursuers burst more, gentle less
 *
 * @param {object} intent — from generateIntent()
 * @param {object} burstState — per-character burst state
 * @param {string} profile — aggression profile
 * @param {number} now — current timestamp (ms)
 * @param {number} timeSinceLastInteraction — seconds
 * @returns {object} { shouldBurst, delay, reason }
 */
export function shouldBurst(intent, burstState, profile, now = Date.now(), timeSinceLastInteraction = 0) {
  if (!intent || intent.strength < 20) {
    return { shouldBurst: false, delay: 0, reason: '驱动力不足 (' + intent?.strength + ')' }
  }

  // ── Cooldown check ──
  if (now < burstState.cooldownUntil) {
    return { shouldBurst: false, delay: Math.ceil((burstState.cooldownUntil - now) / 1000), reason: '冷却中' }
  }

  // ── Profile-aware minimum interval ──
  const minIntervalMs = {
    [AGGRESSION_PROFILES.PURSUER]: 15000,          // 15s — aggressive
    [AGGRESSION_PROFILES.CONFRONTATIONAL]: 25000,  // 25s
    [AGGRESSION_PROFILES.ALOOF]: 60000,            // 60s — distant
    [AGGRESSION_PROFILES.GENTLE]: 120000,          // 120s — reserved
  }
  const minInterval = minIntervalMs[profile] || 60000

  if (burstState.lastBurstTime > 0 && (now - burstState.lastBurstTime) < minInterval) {
    return { shouldBurst: false, delay: Math.ceil((minInterval - (now - burstState.lastBurstTime)) / 1000), reason: '间隔过短' }
  }

  // ── Emotional drift bypass — sudden motivation spike overrides cooldown ──
  const recentBursts = burstState.burstHistory.filter(b => (now - b.time) < 300000) // last 5 min
  const isSpike = recentBursts.length === 0 || intent.strength > 75

  // ── Probability calculation ──
  // Base probability from strength
  let probability = intent.strength / 100

  // Idle time bonus — the longer without interaction, the more likely to burst
  probability += clamp(timeSinceLastInteraction / 600, 0, 0.25)  // 10 min idle → +25%

  // Emotional spike bonus
  if (isSpike) probability += 0.15

  // Profile modifier
  if (profile === AGGRESSION_PROFILES.PURSUER) probability += 0.10
  else if (profile === AGGRESSION_PROFILES.GENTLE) probability -= 0.10

  // Cap at 60% per tick (even the most motivated character doesn't burst every turn)
  probability = clamp(probability, 0.05, 0.60)

  // ── Random jitter ──
  const roll = Math.random()
  if (roll > probability) {
    return { shouldBurst: false, delay: 0, reason: '概率未触发 (' + Math.round(probability * 100) + '% / roll=' + Math.round(roll * 100) + '%)' }
  }

  // ── Calculate delay ──
  // Stronger intent = shorter delay (more urgent)
  let delayMs
  if (intent.strength > 80) {
    delayMs = 3000 + Math.random() * 8000   // 3-11s — urgent
  } else if (intent.strength > 50) {
    delayMs = 8000 + Math.random() * 20000  // 8-28s — moderate
  } else {
    delayMs = 15000 + Math.random() * 45000 // 15-60s — casual
  }

  // Profile modifier on delay
  if (profile === AGGRESSION_PROFILES.PURSUER) delayMs *= 0.6   // faster
  else if (profile === AGGRESSION_PROFILES.ALOOF) delayMs *= 1.5 // slower

  return {
    shouldBurst: true,
    delay: Math.round(delayMs / 1000),
    delayMs: Math.round(delayMs),
    reason: '动机：' + intent.motivationSource + ' | 强度：' + intent.strength,
  }
}

// ═══════════════════════════════════════════════════════════
// 5. ACTION FILTER — prevent inappropriate autonomous actions
// ═══════════════════════════════════════════════════════════

/**
 * Filter an intent through personality + relationship gates.
 * Returns the (possibly modified or nulled) intent.
 *
 * Rules:
 *   - No action without motivation
 *   - Frequency cap (max bursts per hour)
 *   - Profile-inappropriate actions blocked
 *   - Low-affection gate for intimate intents
 *
 * @param {object} intent
 * @param {string} profile
 * @param {object} uskState
 * @param {object} burstState — for frequency check
 * @returns {object|null} filtered intent or null if blocked
 */
export function filterAction(intent, profile, uskState = {}, burstState = null) {
  if (!intent) return null

  // ── Rule 1: No action without motivation ──
  if (!intent.motivationSource || intent.strength < 15) {
    return null
  }

  // ── Rule 2: Frequency cap — max 20 bursts per hour ──
  if (burstState) {
    const oneHourAgo = Date.now() - 3600000
    const recentBursts = burstState.burstHistory.filter(b => b.time > oneHourAgo)
    if (recentBursts.length >= 20) {
      return null
    }
  }

  // ── Rule 3: Profile-inappropriate intents ──
  // Gentle characters: no provoke, no cold_shoulder, no power_move
  if (profile === AGGRESSION_PROFILES.GENTLE) {
    const blockedForGentle = ['provoke', 'cold_shoulder', 'power_move']
    if (blockedForGentle.includes(intent.type)) {
      // Downgrade to a softer equivalent
      if (intent.type === 'provoke') intent = { ...intent, type: 'probe_test', label: '试探（降级）', strength: Math.round(intent.strength * 0.6) }
      else if (intent.type === 'cold_shoulder') intent = { ...intent, type: 'message_emotional', label: '情绪表达（降级）', strength: Math.round(intent.strength * 0.5) }
      else if (intent.type === 'power_move') intent = { ...intent, type: 'sudden_care', label: '关心（降级）', strength: Math.round(intent.strength * 0.5) }
    }
  }

  // Aloof characters: no sudden_care, no message_emotional
  if (profile === AGGRESSION_PROFILES.ALOOF) {
    const blockedForAloof = ['sudden_care', 'message_emotional']
    if (blockedForAloof.includes(intent.type)) {
      if (intent.type === 'sudden_care') intent = { ...intent, type: 'probe_test', label: '试探（转化）', strength: Math.round(intent.strength * 0.7) }
      else if (intent.type === 'message_emotional') intent = { ...intent, type: 'message_contact', label: '联系（转化）', strength: Math.round(intent.strength * 0.5) }
    }
  }

  // ── Rule 4: Affection gate ──
  const affection = uskState?.relationship?.affection ?? 50
  // Below affection 20, block intimate intents
  if (affection < 20) {
    const blockedLowAffection = ['jealousy_show', 'sudden_care', 'message_emotional']
    if (blockedLowAffection.includes(intent.type)) {
      // Allow only cold/distant intents
      if (intent.type === 'jealousy_show') intent = { ...intent, type: 'cold_shoulder', label: '冷淡（转化）', strength: Math.round(intent.strength * 0.8) }
      else if (intent.type === 'sudden_care') return null
      else if (intent.type === 'message_emotional') intent = { ...intent, type: 'message_contact', label: '联系（克制）', strength: Math.round(intent.strength * 0.4) }
    }
  }

  // Below affection 10, almost all initiative is blocked
  if (affection < 10) {
    const allowed = ['cold_shoulder', 'interrupt_flow']
    if (!allowed.includes(intent.type)) {
      if (profile === AGGRESSION_PROFILES.PURSUER) {
        // Pursuers: still allow probe/provoke even at low affection
        if (!['probe_test', 'provoke', 'power_move'].includes(intent.type)) return null
      } else {
        return null
      }
    }
  }

  return intent
}

// ═══════════════════════════════════════════════════════════
// 6. AIIS MAIN API — the conductor
// ═══════════════════════════════════════════════════════════

export const AutonomousInitiativeSystem = {

  /** @type {object} burst states keyed by character name */
  _states: {},

  /** @type {Array} pending bursts ready to fire */
  _pendingBursts: [],

  /** @type {object|null} current character reference */
  _character: null,

  /** @type {number} last tick timestamp */
  _lastTick: 0,

  /** @type {number} turn counter */
  _turnCount: 0,

  /** @type {number|null} timestamp of last player interaction */
  _lastPlayerInteraction: null,

  /** @type {object} cached last intent per character (for prompt injection) */
  _lastIntents: {},

  // ── Init ──────────────────────────────────────────

  /**
   * Initialize AIIS for the current scene/session.
   *
   * @param {object} character — full LLM character descriptor
   * @param {object} uskState — raw USK state
   */
  init(character, uskState) {
    this._states = {}
    this._pendingBursts = []
    this._character = character
    this._lastTick = Date.now()
    this._turnCount = 0
    this._lastPlayerInteraction = Date.now()
    this._lastIntents = {}

    const rcList = character?.romanceCharacters || []
    // Also add the main character itself if it has a name
    const names = rcList.map(rc => rc.name).filter(Boolean)
    if (character?.name && !names.includes(character.name)) {
      names.push(character.name)
    }

    for (const name of names) {
      this._states[name] = createBurstState(name)
    }
  },

  reset() {
    this._states = {}
    this._pendingBursts = []
    this._character = null
    this._lastTick = 0
    this._turnCount = 0
    this._lastPlayerInteraction = null
    this._lastIntents = {}
  },

  // ── Tick — the main cycle ─────────────────────────

  /**
   * Advance AIIS by one cycle.
   * Called at the START of each turn (before LLM call).
   *
   * For each character:
   *   1. Compute motivation field
   *   2. Generate intent
   *   3. Check burst
   *   4. Filter + enqueue
   *
   * @param {object} uskState — raw USK state
   * @param {object} arslEdges — from RelationshipPhysics.edges (optional)
   * @param {object} opts — { timeSinceLastInteraction?, forceTick? }
   * @returns {object} tick result { burstsQueued, intentsGenerated, dominantMotivation }
   */
  tick(uskState, arslEdges = {}, opts = {}) {
    const now = Date.now()
    this._turnCount++
    this._lastTick = now

    const timeSinceLast = this._lastPlayerInteraction
      ? Math.round((now - this._lastPlayerInteraction) / 1000)
      : 0

    let burstsQueued = 0
    const intentsGenerated = {}

    for (const [name, burstState] of Object.entries(this._states)) {
      // ── Step 1: Compute motivation ──
      const motivation = computeMotivationField(name, uskState, arslEdges, timeSinceLast)

      // ── Step 2: Determine profile ──
      const profile = this._getCharProfile(name)

      // ── Step 3: Generate intent ──
      const intent = generateIntent(motivation, profile, uskState)
      intentsGenerated[name] = { intent, motivation, profile }

      // Cache for prompt injection
      this._lastIntents[name] = { intent, motivation, timestamp: now }

      // ── Step 4: Check burst ──
      const burstDecision = shouldBurst(intent, burstState, profile, now, timeSinceLast)

      // ── Step 5: Filter ──
      const filteredIntent = filterAction(intent, profile, uskState, burstState)

      if (burstDecision.shouldBurst && filteredIntent) {
        // ── Enqueue burst ──
        this._pendingBursts.push({
          charName: name,
          intent: filteredIntent,
          motivation,
          profile,
          delayMs: burstDecision.delayMs,
          queuedAt: now,
          fireAt: now + burstDecision.delayMs,
        })

        // Update burst state
        burstState.lastBurstTime = now
        burstState.cooldownUntil = now + burstDecision.delayMs + 30000 // extra 30s after fire
        burstState.burstCount++
        burstState.burstHistory.push({
          time: now,
          intent: filteredIntent.type,
          delivered: false,
        })
        // Cap history
        if (burstState.burstHistory.length > 50) {
          burstState.burstHistory = burstState.burstHistory.slice(-50)
        }

        burstsQueued++
      }

      // Increment boredom for characters that didn't burst
      if (!burstDecision.shouldBurst) {
        burstState._boredomCounter = (burstState._boredomCounter || 0) + 1
      } else {
        burstState._boredomCounter = 0
      }
    }

    return {
      burstsQueued,
      intentsGenerated,
      timeSinceLastInteraction: timeSinceLast,
    }
  },

  // ── Burst Retrieval ───────────────────────────────

  /**
   * Get pending bursts that are ready to fire (delay has elapsed).
   * Returns and CLEARS them — each burst fires once.
   *
   * @returns {Array} ready bursts [{ charName, intent, motivation, profile }]
   */
  getPendingBursts() {
    const now = Date.now()
    const ready = this._pendingBursts.filter(b => now >= b.fireAt)
    // Remove ready bursts from pending
    this._pendingBursts = this._pendingBursts.filter(b => now < b.fireAt)
    return ready
  },

  /**
   * Peek at pending bursts without consuming them.
   */
  peekPendingBursts() {
    return [...this._pendingBursts]
  },

  /**
   * Record that a player interaction happened (resets the idle timer).
   */
  recordPlayerInteraction() {
    this._lastPlayerInteraction = Date.now()
  },

  // ── Intent Context for Prompt Injection ────────────

  /**
   * Build the intent context block for prompt injection.
   * Tells the LLM what the character is CURRENTLY FEELING/WANTING
   * so even reactive replies carry intent.
   *
   * This is the bridge between "decision to act" (AIIS) and
   * "how to act" (LLM). The AIIS decides WHAT, the LLM decides HOW.
   *
   * @param {string} charName — character name
   * @returns {string} prompt injection block, or '' if no active intent
   */
  buildIntentContext(charName) {
    const entry = this._lastIntents[charName]
    if (!entry || !entry.intent) return ''

    const { intent, motivation, timestamp } = entry
    const age = Math.round((Date.now() - timestamp) / 1000)

    // Don't inject stale intents (> 5 min old)
    if (age > 300) return ''

    const intentDef = INTENT_TYPES[intent.type]
    const lines = [
      '【🧠 角色自主意图——AIIS 决策层注入】',
      '',
      '当前角色的内在驱动力（不是对玩家的回应——是角色自己的欲求）：',
      '· 意图类型：' + (intentDef?.label || intent.type) + '（Lv' + intent.level + '）',
      '· 动机来源：' + intent.motivationSource + '（' + motivation[intent.motivationSource] + '/100）',
      '· 驱动强度：' + intent.strength + '/100',
      '· 内容描述：' + (intentDef?.description || ''),
      '',
      '这不是强制指令。你不需要"执行"这个意图——但角色的行为、语气、',
      '措辞应该自然地流露这个内在驱动力。角色是在这个驱动力下回应玩家的，',
      '不是一张白纸地回应。',
    ]

    // Add profile-specific guidance
    if (entry.profile === AGGRESSION_PROFILES.PURSUER) {
      lines.push('· 人设提示：你是攻略型人格。不要等——推。不要问——做。')
    } else if (entry.profile === AGGRESSION_PROFILES.CONFRONTATIONAL) {
      lines.push('· 人设提示：你是冲突型人格。说反话、刺对方、不顺着来。')
    } else if (entry.profile === AGGRESSION_PROFILES.ALOOF) {
      lines.push('· 人设提示：你是高冷型人格。保持距离不主动拉近，但存在本身就是压迫。')
    }

    return lines.join('\n')
  },

  /**
   * Build intent context for ALL characters (for multi-character scenes).
   */
  buildAllIntentsContext() {
    const blocks = []
    for (const name of Object.keys(this._states)) {
      const ctx = this.buildIntentContext(name)
      if (ctx) blocks.push(ctx)
    }
    return blocks.join('\n\n')
  },

  // ── Autonomous Message Prompt Builder ──────────────

  /**
   * Build a dedicated system prompt for an autonomous message (Daily mode).
   * This is more specific than the general intent context — it tells the LLM
   * exactly what kind of unsolicited message to generate.
   *
   * @param {object} burst — from getPendingBursts()
   * @returns {string} system prompt for the LLM
   */
  buildAutonomousMessagePrompt(burst) {
    if (!burst || !burst.intent) return ''

    const { intent, motivation, charName } = burst

    const intentDef = INTENT_TYPES[intent.type]

    let prompt = `【AIIS 主动消息生成——角色自驱行为】

你（${charName}）正在主动联系对方。不是对方先说了什么——是你自己想说。

━━━ 当前内在状态 ━━━
· 你现在的驱动力：${intentDef?.label || intent.type}
· 为什么：${intentDef?.description || '内在冲动'}
· 驱动力强度：${intent.strength}/100
· 主要情绪：${intent.motivationSource}（${motivation[intent.motivationSource]}/100）

━━━ 消息要求 ━━━
`

    // Per-intent type guidance
    switch (intent.type) {
      case 'message_contact':
        prompt += `· 像突然想到对方了——不是"我想你了"，是"在干嘛"那种随意
· 不需要解释为什么发消息
· 5-15 字。短。像真人微信。
· 例："睡了没""刚看到一个东西""[表情包]"“今天没怎么说话”
`
        break
      case 'message_emotional':
        prompt += `· 有情绪但不直接说——是流露不是倾诉
· "…算了没事" 比 "我今天很难过" 更像真人
· 情绪在省略号里，不在解释里
· 8-20 字
`
        break
      case 'probe_test':
        prompt += `· 试探——问一个表面上随意但对方回答后你能读出信息的问题
· 观察对方的反应——发完消息后你真的在看
· 不说破你的真实意图
· 10-25 字
`
        break
      case 'provoke':
        prompt += `· 故意说一句让对方不舒服的话——但别太过，恰到好处地刺一下
· 就想看对方反应——不是真的想吵架
· 挑衅藏在看似随意的话里
· 5-20 字
`
        break
      case 'jealousy_show':
        prompt += `· 吃醋了但不直接说——让对方感觉到但抓不住把柄
· 可能语气比平时冷一点，或者提起第三人
· "哦""挺好""你跟他聊吧"——这种带刺的短句
· 5-15 字
`
        break
      case 'cold_shoulder':
        prompt += `· 冷淡——不是不回，是回得很冷
· 单字、短句、敷衍
· 但要让对方感觉到你是故意的
· 1-8 字
`
        break
      case 'sudden_care':
        prompt += `· 突然关心一下——不是因为对方说了什么，是你自己想问
· 和平时态度有反差才有效果
· 不黏，问完就停
· 8-20 字
`
        break
      case 'power_move':
        prompt += `· 把球踢给对方——让对方必须回应
· 制造一个对方不能忽视的问题/陈述
· 你掌控对话方向
· 10-25 字
`
        break
      default:
        prompt += `· 简短、真实、像微信消息
· 5-15 字
`
    }

    prompt += `
━━━ 铁律 ━━━
· 只发 1 条消息（1 个气泡）
· 不解释你为什么发——真人不会说"我发消息是因为我想你了"
· 不自言自语——消息是发给对方的，不是内心独白
· 对方看到后应该能回——别发终结对话的内容
`

    return prompt
  },

  // ── State Access ───────────────────────────────────

  /**
   * Get the current states for debugging.
   */
  getStates() {
    return { ...this._states }
  },

  /**
   * Get the last computed intent for a character.
   */
  getLastIntent(charName) {
    return this._lastIntents[charName] || null
  },

  /**
   * Get the motivation field for a character (recompute live).
   */
  getMotivation(charName, uskState, arslEdges) {
    const timeSinceLast = this._lastPlayerInteraction
      ? Math.round((Date.now() - this._lastPlayerInteraction) / 1000)
      : 0
    return computeMotivationField(charName, uskState, arslEdges, timeSinceLast)
  },

  // ── Internal Helpers ───────────────────────────────

  /**
   * Get the aggression profile for a character by name.
   * Scans the character descriptor's romanceCharacters list.
   */
  _getCharProfile(charName) {
    const rcList = this._character?.romanceCharacters || []
    const found = rcList.find(rc => rc.name === charName)
    if (found) {
      return detectAggressionProfile(found)
    }
    // Fallback: if the character IS the main character
    if (this._character?.name === charName) {
      return detectAggressionProfile(this._character)
    }
    return AGGRESSION_PROFILES.GENTLE
  },
}
