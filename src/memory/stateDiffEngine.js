/**
 * State Diff Engine — v2.2 Event-Native Memory Engine
 *
 * Takes a current relationship state + extracted events → computes the new state.
 * Pure function: no side effects, no API calls.
 *
 * Core principle:
 *   Memory is not text. It is "state change history."
 *   Events are deltas. State is the accumulated sum.
 */

/**
 * Apply a batch of events to the current state.
 *
 * @param {object} prevState - { affection, tension, trust, dominance, stageHint }
 * @param {Array} events - extracted events with delta fields
 * @returns {{ newState: object, diff: object, changed: boolean }}
 */
export function applyEvents(prevState, events) {
  const newState = structuredClone(prevState)

  for (const e of events) {
    if (!e || !e.delta) continue

    if (e.type === 'RELATIONSHIP_CHANGE' || e.type === 'CONFLICT_EVENT' ||
        e.type === 'CONTROL_ATTEMPT' || e.type === 'EMOTIONAL_SPIKE' ||
        e.type === 'REVELATION') {
      newState.affection = clamp(
        (newState.affection || 50) + (e.delta.affection || 0),
        0, 100
      )
      newState.tension = clamp(
        (newState.tension || 50) + (e.delta.tension || 0),
        0, 100
      )
      newState.trust = clamp(
        (newState.trust || 50) + (e.delta.trust || 0),
        0, 100
      )
    }

    // Dominance shifts: control attempts + emotional spikes affect dominance
    if (e.type === 'CONTROL_ATTEMPT') {
      newState.dominance = clamp(
        (newState.dominance || 0.5) + (e.intensity > 0.7 ? 0.05 : 0.02),
        0, 1
      )
    }

    // Update last interaction timestamp
    newState.lastInteraction = Date.now()
    newState.lastEmotion = e.emotion || newState.lastEmotion
    newState.lastIntent = e.intent || newState.lastIntent
  }

  // Compute diff
  const diff = {}
  for (const key of ['affection', 'tension', 'trust', 'dominance']) {
    const prev = prevState[key] ?? 0
    const next = newState[key] ?? 0
    if (prev !== next) {
      diff[key] = next - prev
    }
  }

  return {
    newState,
    diff,
    changed: Object.keys(diff).length > 0,
  }
}

/**
 * Create a default relationship state for a new edge.
 */
export function createDefaultState() {
  return {
    affection: 50,
    tension: 50,
    trust: 50,
    dominance: 0.5,
    stageHint: '',
    lastEmotion: 'none',
    lastIntent: null,
    lastInteraction: Date.now(),
  }
}

/**
 * Create initial state from character data.
 */
export function createStateFromCharacter(rc, affValue) {
  const state = createDefaultState()
  state.affection = affValue ?? rc.affectionInitial ?? 50

  // Infer initial tension/dominance from personality color
  const color = detectColor(rc)
  if (color === 'dark') {
    state.tension = 70
    state.dominance = 0.75
    state.trust = 30
  } else if (color === 'warm') {
    state.tension = 30
    state.dominance = 0.3
    state.trust = 60
  }

  return state
}

/**
 * Compute the global scene tension level from all edges.
 */
export function computeGlobalTension(edges) {
  if (!edges || Object.keys(edges).length === 0) return 0

  const tensions = Object.values(edges)
    .filter(e => e && e.tension != null)
    .map(e => e.tension)

  if (tensions.length === 0) return 0
  return Math.round(tensions.reduce((a, b) => a + b, 0) / tensions.length)
}

/**
 * Compute active conflicts from edge states.
 */
export function detectActiveConflicts(edges) {
  const conflicts = []
  for (const [key, edge] of Object.entries(edges)) {
    if (!edge) continue
    if (edge.tension >= 70) {
      conflicts.push(key + '关系高张力(' + edge.tension + '%)')
    }
    if (edge.trust <= 30) {
      conflicts.push(key + '信任危机(' + edge.trust + '%)')
    }
  }
  return conflicts
}

// ── Helpers ──

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function detectColor(rc) {
  const dark = ['傲娇', '毒舌', '清冷', '偏执', '疯批', '恶劣', '堕落', '冷漠', '腹黑', '霸道',
    '强势', '冷酷', '邪魅', '病娇', '阴郁', '暴戾', '高冷', '玩世不恭']
  const warm = ['温柔', '善良', '阳光', '单纯', '软萌', '体贴', '治愈', '温暖', '乖巧', '可爱',
    '柔和', '和善', '暖心', '元气', '开朗', '天真', '温润', '谦和', '正直', '赤诚']

  const combined = (rc.personality || '') + (rc.background || '') + (rc.speakingStyle || '')
  const darkHits = dark.filter(kw => combined.includes(kw)).length
  const warmHits = warm.filter(kw => combined.includes(kw)).length

  if (warmHits > 0 && darkHits === 0) return 'warm'
  if (darkHits > 0 && warmHits === 0) return 'dark'
  return 'neutral'
}
