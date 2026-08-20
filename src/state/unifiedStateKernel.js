/**
 * Unified State Kernel v1 (USK) — Single Source of Truth for ALL relationship state
 *
 * Architecture:
 *   Persona Core → USK → Mode Interpreter → Output
 *
 * NOT:
 *   Persona → Mode → State → Output  (old, broken)
 *
 * Four state layers:
 *   Layer 1: Long-term relationship (changes slowly, months scale)
 *   Layer 2: Current emotion (changes fast, per-turn scale)
 *   Layer 3: Relationship tension (structural, cross-mode)
 *   Layer 4: Life state (daily mode driver, initiative engine fuel)
 *
 * Plus:
 *   · Event memory (structured, not compressed dialogue)
 *   · Initiative score (computed from layers, drives active messaging)
 *   · Cross-mode sync (drama events update daily state, and vice versa)
 *
 * Storage: localStorage key = jsjg_usk_<characterId>  (legacy)
 *          localStorage key = jsjg_folder_usk_<folderId>  (v6 folder-scoped)
 */

const STORAGE_PREFIX = 'jsjg_usk_'
const FOLDER_USK_PREFIX = 'jsjg_folder_usk_'

// ═══════════════════════════════════════════════════════════
// State Schema
// ═══════════════════════════════════════════════════════════

/**
 * Create a fresh USK state for a character.
 *
 * @param {object} persona — UnifiedPersona
 * @param {object} options — { sourceMode: 'daily'|'story' }
 * @returns {object} fresh USK state
 */
export function createUSK(persona, options = {}) {
  const chars = (persona?.characters || []).filter(c => c.type === 'romance')
  const now = Date.now()

  // Build per-character state
  const characters = {}
  for (const char of chars) {
    characters[char.name] = {
      // Layer 1: Long-term relationship
      relationship: {
        affection: char.affectionInitial ?? 50,
        trust: 30,
        dependency: 30,
        respect: 40,
        fear: 30,
        possessiveness: 30,
      },

      // Layer 2: Current emotion
      emotion: {
        anger: 5,
        sadness: 5,
        jealousy: 5,
        anxiety: 10,
        curiosity: 30,
        excitement: 20,
      },

      // Layer 3: Relationship tension
      tension: {
        unresolved_conflicts: 0,
        emotional_pressure: 20,
        attraction_tension: 40,
        power_imbalance: 50,
      },

      // Layer 4: Life state
      life: {
        busy: 20,
        busyness: 20,          // v1.0 spec alias
        tired: 15,
        lonely: 40,
        loneliness: 40,        // v1.0 spec alias
        social_need: 30,
        mood: 60,
        initiative_score: 50,   // v1.0 spec: computed, stored in life
      },
    }
  }

  return {
    version: 1,
    characterId: persona?.id || 'unknown',
    characterName: persona?.name || 'unknown',
    createdAt: now,
    updatedAt: now,

    // ── v1.0 spec: meta ──
    meta: {
      last_update: new Date().toISOString(),
      active_mode: options.sourceMode === 'daily' ? 'DAILY' : 'DRAMA',
    },

    // ── Per-character state ──
    characters,

    // ── Global mode state ──
    global: {
      currentMode: options.sourceMode === 'daily' ? 'daily' : 'drama',
      lastModeSwitch: null,
      turnCount: 0,
      lastInteractionAt: now,
    },

    // ── Global state (v6 folder-level) ──
    global_state: {
      world_tension: 30,       // 世界整体张力 0-100
      folder_mood: 50,         // 世界整体情绪氛围 0-100
    },

    // ── Event memory (append-only, structured) ──
    event_memory: [],

    // ── Initiative engine state ──
    initiative: {
      score: 50,              // 0-100, computed
      lastActiveMessageAt: null,
      consecutivePassiveTurns: 0,
    },

    // ── Migration flags ──
    _migration: {
      fromMemoryGraph: false,
      fromArchive: false,
      migratedAt: null,
    },
  }
}

// ═══════════════════════════════════════════════════════════
// Layer 1: Long-term Relationship (read/write)
// ═══════════════════════════════════════════════════════════

/**
 * Get a relationship value. Returns 0 if character or field doesn't exist.
 */
export function getRelationship(usk, charName, field) {
  return usk?.characters?.[charName]?.relationship?.[field] ?? 0
}

/**
 * Set a relationship value. Clamped 0-100.
 */
export function setRelationship(usk, charName, field, value) {
  if (!usk?.characters?.[charName]) return usk
  if (!usk.characters[charName].relationship) {
    usk.characters[charName].relationship = {}
  }
  usk.characters[charName].relationship[field] = clamp(value, 0, 100)
  usk.updatedAt = Date.now()
  return usk
}

/**
 * Apply a delta to a relationship field.
 */
export function adjustRelationship(usk, charName, field, delta) {
  const current = getRelationship(usk, charName, field)
  return setRelationship(usk, charName, field, current + delta)
}

/**
 * Get the full relationship object for a character.
 */
export function getFullRelationship(usk, charName) {
  if (!usk?.characters?.[charName]?.relationship) {
    return { affection: 50, trust: 30, dependency: 30, respect: 40, fear: 30, possessiveness: 30 }
  }
  return { ...usk.characters[charName].relationship }
}

// ═══════════════════════════════════════════════════════════
// Layer 2: Current Emotion (fast-changing, per-turn)
// ═══════════════════════════════════════════════════════════

export function getEmotion(usk, charName, field) {
  return usk?.characters?.[charName]?.emotion?.[field] ?? 0
}

export function setEmotion(usk, charName, field, value) {
  if (!usk?.characters?.[charName]) return usk
  if (!usk.characters[charName].emotion) {
    usk.characters[charName].emotion = { anger: 5, sadness: 5, jealousy: 5, anxiety: 10, curiosity: 30, excitement: 20 }
  }
  usk.characters[charName].emotion[field] = clamp(value, 0, 100)
  usk.updatedAt = Date.now()
  return usk
}

export function adjustEmotion(usk, charName, field, delta) {
  const current = getEmotion(usk, charName, field)
  return setEmotion(usk, charName, field, current + delta)
}

/**
 * Decay emotions toward baseline. Called once per turn.
 * Strong emotions (anger, jealousy) decay faster than mild ones.
 */
export function decayEmotions(usk, charName) {
  if (!usk?.characters?.[charName]?.emotion) return usk
  const e = usk.characters[charName].emotion

  const decayRates = {
    anger: 0.15,      // anger fades moderately fast
    sadness: 0.10,    // sadness lingers
    jealousy: 0.12,   // jealousy lingers
    anxiety: 0.08,    // anxiety is sticky
    curiosity: 0.05,  // curiosity fades slowly
    excitement: 0.10, // excitement decays
  }

  for (const [field, rate] of Object.entries(decayRates)) {
    e[field] = clamp(Math.round(e[field] * (1 - rate)), 0, 100)
  }

  usk.updatedAt = Date.now()
  return usk
}

// ═══════════════════════════════════════════════════════════
// Layer 3: Relationship Tension (structural)
// ═══════════════════════════════════════════════════════════

export function getTension(usk, charName, field) {
  return usk?.characters?.[charName]?.tension?.[field] ?? 0
}

export function setTension(usk, charName, field, value) {
  if (!usk?.characters?.[charName]) return usk
  if (!usk.characters[charName].tension) {
    usk.characters[charName].tension = { unresolved_conflicts: 0, emotional_pressure: 20, attraction_tension: 40, power_imbalance: 50 }
  }
  usk.characters[charName].tension[field] = clamp(value, 0, 100)
  usk.updatedAt = Date.now()
  return usk
}

export function adjustTension(usk, charName, field, delta) {
  const current = getTension(usk, charName, field)
  return setTension(usk, charName, field, current + delta)
}

// ═══════════════════════════════════════════════════════════
// Layer 4: Life State (daily mode driver)
// ═══════════════════════════════════════════════════════════

export function getLife(usk, charName, field) {
  return usk?.characters?.[charName]?.life?.[field] ?? 0
}

export function setLife(usk, charName, field, value) {
  if (!usk?.characters?.[charName]) return usk
  if (!usk.characters[charName].life) {
    usk.characters[charName].life = { busy: 20, tired: 15, lonely: 40, social_need: 30, mood: 60 }
  }
  usk.characters[charName].life[field] = clamp(value, 0, 100)
  usk.updatedAt = Date.now()
  return usk
}

/**
 * Advance life state by one tick (per turn or per time interval).
 * Simulates natural daily rhythms.
 */
export function advanceLifeState(usk, charName, minutesSinceLastInteraction) {
  if (!usk?.characters?.[charName]?.life) return usk
  const l = usk.characters[charName].life

  // Time-based changes
  const hours = minutesSinceLastInteraction / 60

  // Loneliness increases with time alone
  l.lonely = clamp(Math.round(l.lonely + hours * 2), 0, 100)

  // Social need increases with isolation
  l.social_need = clamp(Math.round(l.social_need + hours * 1.5), 0, 100)

  // Tiredness fluctuates
  l.tired = clamp(Math.round(l.tired + (Math.random() - 0.5) * 5), 0, 100)

  // Busy level randomizes slightly
  l.busy = clamp(Math.round(l.busy + (Math.random() - 0.5) * 8), 0, 100)

  // Mood trends toward baseline (50) with some noise
  l.mood = clamp(Math.round(l.mood + (50 - l.mood) * 0.05 + (Math.random() - 0.5) * 5), 0, 100)

  usk.updatedAt = Date.now()
  return usk
}

// ═══════════════════════════════════════════════════════════
// Global State (v6 — Folder-level / World-level)
// ═══════════════════════════════════════════════════════════

/**
 * Get a global_state field value.
 * @param {object} usk
 * @param {string} field — 'world_tension' | 'folder_mood'
 * @returns {number} 0-100
 */
export function getGlobalState(usk, field) {
  return usk?.global_state?.[field] ?? (field === 'folder_mood' ? 50 : 30)
}

/**
 * Set a global_state field value. Clamped 0-100.
 * @returns {object} usk
 */
export function setGlobalState(usk, field, value) {
  if (!usk) return usk
  if (!usk.global_state) {
    usk.global_state = { world_tension: 30, folder_mood: 50 }
  }
  usk.global_state[field] = clamp(value, 0, 100)
  usk.updatedAt = Date.now()
  return usk
}

/**
 * Adjust a global_state field by delta.
 */
export function adjustGlobalState(usk, field, delta) {
  const current = getGlobalState(usk, field)
  return setGlobalState(usk, field, current + delta)
}

/**
 * Get the full global_state object.
 * @returns {{ world_tension: number, folder_mood: number }}
 */
export function getFullGlobalState(usk) {
  if (!usk?.global_state) {
    return { world_tension: 30, folder_mood: 50 }
  }
  return { ...usk.global_state }
}

// ═══════════════════════════════════════════════════════════
// Initiative Score Engine
// ═══════════════════════════════════════════════════════════

/**
 * Compute the initiative score for a character.
 *
 * Formula:
 *   initiative = lonely + affection + dependency + curiosity - busy
 *
 * High score (>70): character is likely to message first
 * Low score (<30): character will wait for user to initiate
 *
 * @returns {number} 0-100
 */
export function computeInitiativeScore(usk, charName) {
  if (!usk?.characters?.[charName]) return 30

  const rel = usk.characters[charName].relationship || {}
  const emo = usk.characters[charName].emotion || {}
  const life = usk.characters[charName].life || {}

  // USK v1.0 spec formula
  const loneliness = life.loneliness || life.lonely || 40
  const busyness = life.busyness || life.busy || 20

  const raw =
    loneliness * 0.4 +
    (rel.affection || 50) * 0.3 +
    (emo.curiosity || 30) * 0.2 +
    (rel.dependency || 30) * 0.1 -
    busyness

  const score = clamp(Math.round(raw), 0, 100)

  // Sync to life object
  if (usk.characters?.[charName]?.life) {
    usk.characters[charName].life.initiative_score = score
  }

  return score
}

/**
 * Update the initiative score and related state.
 * Call after any state change that could affect initiative.
 */
export function updateInitiative(usk, charName) {
  if (!usk?.characters?.[charName]) return usk

  const score = computeInitiativeScore(usk, charName)

  if (!usk.initiative) {
    usk.initiative = { score: 50, lastActiveMessageAt: null, consecutivePassiveTurns: 0 }
  }

  usk.initiative.score = score

  // Track passive turns (for autonomous message triggering)
  if (score > 70) {
    usk.initiative.consecutivePassiveTurns++
  } else {
    usk.initiative.consecutivePassiveTurns = Math.max(0, usk.initiative.consecutivePassiveTurns - 1)
  }

  usk.updatedAt = Date.now()
  return usk
}

/**
 * Check if the character should send an autonomous message.
 *
 * @returns {{ shouldSend: boolean, reason: string, urgency: number }}
 */
export function shouldSendAutonomousMessage(usk, charName) {
  if (!usk?.characters?.[charName]) return { shouldSend: false, reason: '', urgency: 0 }

  const score = computeInitiativeScore(usk, charName)
  const turns = usk.initiative?.consecutivePassiveTurns || 0

  // High initiative + many passive turns = strong trigger
  if (score > 85 && turns >= 3) {
    return { shouldSend: true, reason: '高主动意愿+多轮未互动', urgency: 0.9 }
  }

  if (score > 75 && turns >= 5) {
    return { shouldSend: true, reason: '中高主动意愿+长时间沉默', urgency: 0.7 }
  }

  if (score > 65 && turns >= 8) {
    return { shouldSend: true, reason: '社交需求积累', urgency: 0.5 }
  }

  // Special case: very lonely
  const lonely = getLife(usk, charName, 'lonely')
  if (lonely > 85) {
    return { shouldSend: true, reason: '极度孤独', urgency: 0.95 }
  }

  // Special case: high jealousy
  const jealousy = getEmotion(usk, charName, 'jealousy')
  if (jealousy > 80) {
    return { shouldSend: true, reason: '强烈嫉妒驱动', urgency: 0.85 }
  }

  return { shouldSend: false, reason: '', urgency: 0 }
}

// ═══════════════════════════════════════════════════════════
// Event Memory (structured, NOT compressed dialogue)
// ═══════════════════════════════════════════════════════════

/**
 * Record a structured event.
 *
 * @param {object} usk
 * @param {object} event — { type, summary, impact?: { trust, affection, anger, ... }, mode?: 'drama'|'daily' }
 * @returns {object} usk
 */
export function recordEvent(usk, event) {
  if (!usk) return usk

  const evt = {
    id: 'evt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    type: event.type || 'generic',
    summary: event.summary || '',
    impact: event.impact || {},
    mode: event.mode || usk.global?.currentMode || 'drama',
    turn: (usk.global?.turnCount || 0),
    timestamp: Date.now(),
  }

  usk.event_memory.push(evt)

  // Keep last 100 events (compact, structured — cheap to store)
  if (usk.event_memory.length > 100) {
    usk.event_memory = usk.event_memory.slice(-100)
  }

  // Apply impact to state
  if (event.impact) {
    applyEventImpact(usk, event.impact, event.actor)
  }

  usk.updatedAt = Date.now()
  return usk
}

/**
 * Apply an event's impact to the relevant state layers.
 * Impact can target any state field.
 */
function applyEventImpact(usk, impact, actorName) {
  if (!impact || !usk) return

  const targetName = actorName || Object.keys(usk.characters || {})[0]
  if (!targetName || !usk.characters?.[targetName]) return

  // Layer 1: Relationship changes
  const relFields = ['affection', 'trust', 'dependency', 'respect', 'fear', 'possessiveness']
  for (const field of relFields) {
    if (impact[field] != null) {
      adjustRelationship(usk, targetName, field, impact[field])
    }
  }

  // Layer 2: Emotion changes
  const emoFields = ['anger', 'sadness', 'jealousy', 'anxiety', 'curiosity', 'excitement']
  for (const field of emoFields) {
    if (impact[field] != null) {
      adjustEmotion(usk, targetName, field, impact[field])
    }
  }

  // Layer 3: Tension changes
  const tenFields = ['unresolved_conflicts', 'emotional_pressure', 'attraction_tension', 'power_imbalance']
  for (const field of tenFields) {
    if (impact[field] != null) {
      adjustTension(usk, targetName, field, impact[field])
    }
  }
}

/**
 * Get recent events for prompt injection.
 * Compact, structured format. NOT compressed dialogue.
 */
export function getRecentEvents(usk, maxEvents = 10) {
  if (!usk?.event_memory?.length) return ''
  const recent = usk.event_memory.slice(-maxEvents)

  return '【事件记忆——结构化】\n' + recent.map((e, i) => {
    const impactStr = Object.entries(e.impact || {})
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => k + (v > 0 ? '+' : '') + v)
      .join(' ')

    return (i + 1) + '. [' + e.mode + '] ' + e.summary +
      (impactStr ? ' [' + impactStr + ']' : '')
  }).join('\n')
}

// ═══════════════════════════════════════════════════════════
// Cross-Mode Sync
// ═══════════════════════════════════════════════════════════

/**
 * Apply cross-mode state transfer.
 * Called when switching modes. State is preserved — only the interpreter changes.
 *
 * Drama → Daily transfer:
 *   - High anger → shorter replies, colder tone
 *   - Low trust → reduced initiative
 *   - Unresolved conflicts → increased emotional_pressure in daily mode
 *
 * Daily → Drama transfer:
 *   - Increased trust/affection from chatting → drama mode relationships warm up
 *   - Life state resets (drama mode doesn't use life state)
 *
 * @param {object} usk
 * @param {string} fromMode
 * @param {string} toMode
 * @returns {object} usk
 */
export function applyModeTransition(usk, fromMode, toMode) {
  if (!usk) return usk

  usk.global.currentMode = toMode
  usk.global.lastModeSwitch = Date.now()
  usk.meta.active_mode = toMode === 'drama' ? 'DRAMA' : 'DAILY'
  usk.meta.last_update = new Date().toISOString()

  for (const [charName, charState] of Object.entries(usk.characters || {})) {
    // Drama → Daily: carry emotional baggage into daily behavior
    if (fromMode === 'drama' && toMode === 'daily') {
      // High anger → life mood penalty
      if (charState.emotion?.anger > 60) {
        charState.life.mood = clamp(charState.life.mood - 20, 0, 100)
      }
      // Unresolved conflicts → loneliness (drama conflict = social isolation in daily)
      if (charState.tension?.unresolved_conflicts > 0) {
        charState.life.lonely = clamp(charState.life.lonely + 15, 0, 100)
      }
    }

    // Daily → Drama: accumulated warmth transfers
    if (fromMode === 'daily' && toMode === 'drama') {
      // Reset life state (not relevant in drama mode)
      // Keep relationship changes from daily mode (trust built through chatting)
      // Nothing to "reset" — the relationship IS the bridge
    }
  }

  // Record the transition
  recordEvent(usk, {
    type: 'mode_switch',
    summary: '模式切换：' + fromMode + ' → ' + toMode,
    mode: toMode,
  })

  usk.updatedAt = Date.now()
  return usk
}

// ═══════════════════════════════════════════════════════════
// USK v1.0: Event-driven state update (spec)
// ═══════════════════════════════════════════════════════════

/**
 * The canonical event-driven state updater.
 * All modes (DRAMA / DAILY) must route state changes through this function.
 *
 * Event types and their impacts:
 *   conflict  → tension↑, trust↓
 *   intimacy  → affection↑, dependency↑
 *   rejection → trust↓, anger↑, power_imbalance↑
 *   absence   → loneliness↑, initiative_score↑
 *   rupture   → trust↓↓, unresolved_conflict↑↑, fear↑
 *   daily_chat → affection↑ (light), curiosity↓ (satisfied)
 */
export function updateUSK(event, usk, charName) {
  if (!usk || !charName) return usk

  const target = usk.characters?.[charName]
  if (!target) return usk

  const rel = target.relationship || {}
  const emo = target.emotion || {}
  const ten = target.tension || {}
  const lif = target.life || {}

  switch (event.type) {
    case 'conflict':
      // 🔥 v8.0.1 fix: let applyEventImpact handle affection (via impact.affection).
      // The switch case only manages secondary tension effects.
      ten.unresolved_conflict = clamp((ten.unresolved_conflict ?? 0) + 10, 0, 100)
      rel.trust = clamp((rel.trust ?? 30) - 5, 0, 100)
      emo.anger = clamp((emo.anger ?? 5) + 15, 0, 100)
      ten.emotional_pressure = clamp((ten.emotional_pressure ?? 20) + 8, 0, 100)
      break

    case 'intimacy':
      // 🔥 v8.0.1 fix: let applyEventImpact handle affection (via impact.affection).
      // The switch case only manages secondary effects — dependency, excitement, tension.
      rel.dependency = clamp((rel.dependency ?? 30) + 5, 0, 100)
      emo.excitement = clamp((emo.excitement ?? 20) + 10, 0, 100)
      ten.attraction_tension = clamp((ten.attraction_tension ?? 40) + 5, 0, 100)
      break

    case 'rejection':
      rel.trust = clamp((rel.trust ?? 30) - 10, 0, 100)
      emo.anger = clamp((emo.anger ?? 5) + 15, 0, 100)
      emo.sadness = clamp((emo.sadness ?? 5) + 10, 0, 100)
      ten.power_imbalance = clamp((ten.power_imbalance ?? 50) + 10, 0, 100)
      break

    case 'absence':
      lif.loneliness = clamp((lif.loneliness ?? lif.lonely ?? 40) + 10, 0, 100)
      lif.lonely = lif.loneliness  // sync alias
      lif.initiative_score = clamp((lif.initiative_score ?? 50) + 5, 0, 100)
      emo.anxiety = clamp((emo.anxiety ?? 10) + 8, 0, 100)
      break

    case 'rupture':
      rel.trust = clamp((rel.trust ?? 30) - 20, 0, 100)
      ten.unresolved_conflict = clamp((ten.unresolved_conflict ?? 0) + 20, 0, 100)
      rel.fear = clamp((rel.fear ?? 30) + 15, 0, 100)
      emo.anger = clamp((emo.anger ?? 5) + 25, 0, 100)
      emo.sadness = clamp((emo.sadness ?? 5) + 20, 0, 100)
      break

    case 'daily_chat':
      // ── Daily v4: LLM-provided deltas → daily subspace only ──
      const relDelta = event.relationship_delta ?? 0
      const emoDelta = event.emotion_delta ?? 0
      // Relationship: LLM judge delta only — no hardcoded fallback
      // (relDelta defaults to 0 via ?? above, so 0 = no change)
      rel.affection = clamp((rel.affection ?? 50) + relDelta, 0, 100)
      // Life: emotion delta drives mood change
      lif.mood = clamp((lif.mood ?? 50) + emoDelta * 0.8, 0, 100)
      // Social need satisfied by any chat
      lif.loneliness = clamp((lif.loneliness ?? lif.lonely ?? 40) - 3, 0, 100)
      lif.lonely = lif.loneliness  // sync alias
      // Curiosity slightly satisfied
      emo.curiosity = clamp((emo.curiosity ?? 30) - Math.abs(emoDelta) * 0.3 - 2, 0, 100)
      // ⚠️ Daily v4: do NOT write tension — that's drama-only territory
      break

    default:
      // Unknown event type — apply impact if provided
      if (event.impact) {
        applyEventImpact(usk, event.impact, charName)
      }
      break
  }

  // Update meta
  usk.meta.last_update = new Date().toISOString()
  usk.updatedAt = Date.now()

  // Recompute initiative
  const score = computeInitiativeScore(usk, charName)
  if (target.life) target.life.initiative_score = score
  if (usk.initiative) usk.initiative.score = score  // backward compat

  return usk
}

// ═══════════════════════════════════════════════════════════
// State Snapshot (for prompt injection)
// ═══════════════════════════════════════════════════════════

/**
 * Build a compact state summary for LLM prompt injection.
 *
 * @param {object} usk
 * @param {string} charName — specific character or null for all
 * @param {string} mode — 'drama' | 'daily'
 * @returns {string}
 */
export function buildStateSnapshot(usk, charName, mode) {
  if (!usk?.characters) return ''

  const names = charName ? [charName] : Object.keys(usk.characters)
  const lines = ['【USK 当前状态——' + mode + '模式】']

  for (const name of names) {
    const char = usk.characters[name]
    if (!char) continue

    const r = char.relationship || {}
    const e = char.emotion || {}
    const t = char.tension || {}
    const l = char.life || {}

    // Mode-specific presentation
    if (mode === 'drama') {
      lines.push(
        name + '：' +
        '好感' + (r.affection || 50) +
        ' 信任' + (r.trust || 30) +
        ' 依赖' + (r.dependency || 30) +
        ' 恐惧' + (r.fear || 30) +
        ' 占有' + (r.possessiveness || 30) +
        ' | 愤怒' + (e.anger || 5) +
        ' 嫉妒' + (e.jealousy || 5) +
        ' | 冲突' + (t.unresolved_conflicts || 0) +
        ' 情绪施压' + (t.emotional_pressure || 20) +
        ' 吸引力张力' + (t.attraction_tension || 40) +
        ' 权力失衡' + (t.power_imbalance || 50)
      )
    } else {
      // Daily mode: more compact, life-focused
      lines.push(
        name + '：' +
        '好感' + (r.affection || 50) +
        ' 信任' + (r.trust || 30) +
        ' | 好奇' + (e.curiosity || 30) +
        ' | 忙' + (l.busy || 20) +
        ' 累' + (l.tired || 15) +
        ' 孤独' + (l.lonely || 40) +
        ' 社交需求' + (l.social_need || 30) +
        ' 心情' + (l.mood || 60) +
        ' | 主动意愿' + (computeInitiativeScore(usk, name))
      )
    }
  }

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// Persistence
// ═══════════════════════════════════════════════════════════

/**
 * Save USK to localStorage.
 */
export function saveUSK(characterId, usk) {
  try {
    if (!characterId || !usk) return false
    const key = STORAGE_PREFIX + characterId
    localStorage.setItem(key, JSON.stringify(usk))
    return true
  } catch (e) {
    console.warn('[USK] Save failed:', e.message)
    return false
  }
}

/**
 * Load USK from localStorage.
 * @returns {object|null}
 */
export function loadUSK(characterId) {
  try {
    const key = STORAGE_PREFIX + characterId
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed.version !== 1) return null
    return parsed
  } catch (e) {
    console.warn('[USK] Load failed:', e.message)
    return null
  }
}

/**
 * Load or create USK. Handles migration from old sharedState if needed.
 */
export function loadOrCreateUSK(characterId, persona, options = {}) {
  // Try loading existing USK
  let usk = loadUSK(characterId)

  if (!usk) {
    // Try migrating from old MemoryGraph-based shared state
    usk = migrateFromSharedState(characterId, persona)
  }

  if (!usk) {
    // Fresh creation
    usk = createUSK(persona, { sourceMode: options.mode || 'drama' })
  }

  // Ensure all persona characters have state entries
  for (const char of (persona?.characters || [])) {
    if (char.type !== 'romance') continue
    if (!usk.characters[char.name]) {
      usk.characters[char.name] = createCharacterState(char)
    }
  }

  return usk
}

function createCharacterState(char) {
  return {
    relationship: { affection: char.affectionInitial ?? 50, trust: 30, dependency: 30, respect: 40, fear: 30, possessiveness: 30 },
    emotion: { anger: 5, sadness: 5, jealousy: 5, anxiety: 10, curiosity: 30, excitement: 20 },
    tension: { unresolved_conflicts: 0, emotional_pressure: 20, attraction_tension: 40, power_imbalance: 50 },
    life: { busy: 20, busyness: 20, tired: 15, lonely: 40, loneliness: 40, social_need: 30, mood: 60, initiative_score: 50 },
  }
}

/**
 * Migrate from old MemoryGraph-based shared state.
 */
function migrateFromSharedState(characterId, persona) {
  try {
    // Try the old shared state key
    const oldKey = 'jsjg_memory_graph_' + characterId
    const raw = localStorage.getItem(oldKey)
    if (!raw) return null

    const old = JSON.parse(raw)
    if (!old.edges) return null

    const usk = createUSK(persona)
    usk._migration.fromMemoryGraph = true
    usk._migration.migratedAt = Date.now()

    // Copy edge data to USK characters
    for (const [key, edge] of Object.entries(old.edges)) {
      if (!key.startsWith('user_')) continue
      const charName = key.replace('user_', '')
      if (usk.characters[charName]) {
        usk.characters[charName].relationship.affection = edge.affection ?? 50
        usk.characters[charName].relationship.trust = edge.trust ?? 30
        usk.characters[charName].tension.emotional_pressure = edge.tension ?? 50
        usk.characters[charName].tension.power_imbalance = edge.dominance ?? 50
      }
    }

    // Copy event log
    if (old.event_log?.length) {
      usk.event_memory = old.event_log.map(e => ({
        id: 'evt_mig_' + Math.random().toString(36).slice(2, 8),
        type: e.type || 'legacy',
        summary: e.summary || '',
        impact: {},
        mode: 'drama',
        turn: 0,
        timestamp: e.timestamp || Date.now(),
      })).slice(-100)
    }

    console.log('[USK] Migrated from MemoryGraph:', Object.keys(usk.characters).length, 'characters')
    return usk
  } catch (e) {
    console.warn('[USK] Migration from shared state failed:', e)
    return null
  }
}

// ═══════════════════════════════════════════════════════════
// Sync to coordinator (MemoryGraph edges)
// ═══════════════════════════════════════════════════════════

/**
 * Sync USK state to MemoryGraph edges for coordinator compatibility.
 * The coordinator reads MemoryGraph edges for relationship state.
 * This keeps the coordinator working without changes.
 *
 * @returns {object} MemoryGraph-compatible edges object
 */
export function syncToMemoryGraph(usk) {
  if (!usk?.characters) return {}

  const edges = {}
  for (const [name, char] of Object.entries(usk.characters)) {
    const edgeKey = 'user_' + name
    edges[edgeKey] = {
      affection: char.relationship?.affection ?? 50,
      trust: char.relationship?.trust ?? 30,
      tension: char.tension?.emotional_pressure ?? 50,
      dominance: char.tension?.power_imbalance ?? 50,
      dependency: char.relationship?.dependency ?? 30,
    }
  }

  return edges
}

// ═══════════════════════════════════════════════════════════
// Folder-Scoped USK (v6)
// ═══════════════════════════════════════════════════════════

/**
 * Create a folder-scoped USK with multiple characters.
 * This is the v6 canonical USK creation path.
 *
 * @param {string} folderId
 * @param {object[]} charactersData — array of { id, name, affectionInitial?, ... }
 * @param {object} options — { sourceMode: 'drama'|'daily' }
 * @returns {object} fresh folder-scoped USK
 */
export function createFolderUSK(folderId, charactersData = [], options = {}) {
  const now = Date.now()

  const characters = {}
  for (const char of charactersData) {
    const key = char.id || char.name || 'unknown'
    characters[key] = {
      relationship: {
        affection: char.affectionInitial ?? 50,
        trust: 30,
        dependency: 30,
        respect: 40,
        fear: 30,
        possessiveness: 30,
      },
      emotion: {
        anger: 5,
        sadness: 5,
        jealousy: 5,
        anxiety: 10,
        curiosity: 30,
        excitement: 20,
      },
      tension: {
        unresolved_conflicts: 0,
        emotional_pressure: 20,
        attraction_tension: 40,
        power_imbalance: 50,
      },
      life: {
        busy: 20,
        busyness: 20,
        tired: 15,
        lonely: 40,
        loneliness: 40,
        social_need: 30,
        mood: 60,
        initiative_score: 50,
      },
    }
  }

  return {
    version: 1,
    folderId: folderId,
    createdAt: now,
    updatedAt: now,

    meta: {
      last_update: new Date().toISOString(),
      active_mode: options.sourceMode === 'daily' ? 'DAILY' : 'DRAMA',
    },

    // ── Per-character state ──
    characters,

    // ── Global mode state ──
    global: {
      currentMode: options.sourceMode === 'daily' ? 'daily' : 'drama',
      lastModeSwitch: null,
      turnCount: 0,
      lastInteractionAt: now,
    },

    // ── Global state (v6 folder-level) ──
    global_state: {
      world_tension: 30,        // 0-100，世界观层面的紧张程度
      folder_mood: 50,          // 0-100，世界氛围
      narrative_phase: 'setup', // setup | rising | crisis | resolution
      timeline_pointer: 0,      // 故事时间线位置（回合数）
    },

    // ── Event memory ──
    event_memory: [],

    // ── Initiative engine state ──
    initiative: {
      score: 50,
      lastActiveMessageAt: null,
      consecutivePassiveTurns: 0,
    },

    // ── Migration flags ──
    _migration: {
      fromMemoryGraph: false,
      fromArchive: false,
      migratedAt: null,
    },
  }
}

/**
 * Save folder-scoped USK to localStorage.
 * @param {string} folderId
 * @param {object} usk
 * @returns {boolean}
 */
export function saveFolderUSK(folderId, usk, saveId) {
  try {
    if (!folderId || !usk) return false
    const key = saveId ? FOLDER_USK_PREFIX + folderId + '_' + saveId : FOLDER_USK_PREFIX + folderId
    localStorage.setItem(key, JSON.stringify(usk))
    return true
  } catch (e) {
    console.warn('[USK] Folder save failed:', e.message)
    return false
  }
}

/**
 * Load folder-scoped USK from localStorage.
 * @param {string} folderId
 * @returns {object|null}
 */
export function loadFolderUSK(folderId, saveId) {
  try {
    const key = saveId ? FOLDER_USK_PREFIX + folderId + '_' + saveId : FOLDER_USK_PREFIX + folderId
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed.version !== 1) return null
    return parsed
  } catch (e) {
    console.warn('[USK] Folder load failed:', e.message)
    return null
  }
}

/**
 * Load or create folder-scoped USK.
 * @param {string} folderId
 * @param {object[]} charactersData
 * @param {object} options
 * @returns {object} USK
 */
export function loadOrCreateFolderUSK(folderId, charactersData = [], options = {}) {
  const saveId = options.saveId || ''
  let usk = null

  // v6.x: Per-save USK isolation — each save has its own USK
  if (saveId) {
    usk = loadFolderUSK(folderId, saveId)
    if (!usk) {
      // Migration: copy folder-level USK if it exists
      const folderUSK = loadFolderUSK(folderId)
      if (folderUSK) {
        usk = JSON.parse(JSON.stringify(folderUSK)) // deep clone
        usk.meta = usk.meta || {}
        usk.meta.saveId = saveId
        usk.meta.migratedFromFolder = true
        usk.meta.migratedAt = Date.now()
      }
    }
  }

  // Fallback: folder-level USK (backward compat)
  if (!usk) {
    usk = loadFolderUSK(folderId)
  }

  if (!usk) {
    usk = createFolderUSK(folderId, charactersData, options)
  }

  // Stamp saveId into meta for persist()
  if (saveId && usk.meta) {
    usk.meta.saveId = saveId
  }

  // Ensure all provided characters have state entries
  for (const char of charactersData) {
    const key = char.id || char.name
    if (key && !usk.characters[key]) {
      usk.characters[key] = createCharacterState(char)
    }
  }

  return usk
}

/**
 * Delete folder-scoped USK.
 * @param {string} folderId
 */
export function deleteFolderUSK(folderId) {
  try {
    localStorage.removeItem(FOLDER_USK_PREFIX + folderId)
    return true
  } catch {
    return false
  }
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function clamp(val, min, max) {
  if (val == null || isNaN(val)) return min
  return Math.min(max, Math.max(min, Math.round(val)))
}
