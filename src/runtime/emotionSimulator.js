/**
 * ES — Emotion Simulator v1
 *
 * Position: After LLM generation + affection scoring.
 *
 * ES simulates character emotions as a numerical state machine with inertia.
 * Instead of LLM "guessing" the character's mood each turn, ES maintains
 * a persistent emotion vector that carries momentum across turns.
 *
 * Zero extra LLM calls — pure numerical simulation:
 *   1. Event detection: keyword patterns in player input + AI reply
 *   2. Delta application: event → emotion delta based on personality
 *   3. Decay: emotions drift toward baseline each turn (emotional inertia)
 *   4. Prompt injection: current emotion state as context for CEK
 *
 * Architecture:
 *   Input → ES Event Detect → Delta Apply → Decay → Prompt Injection → LLM
 */

import { detectAggressionProfile, AGGRESSION_PROFILES } from './aggressionProfile'

// ═══════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════

const STORAGE_PREFIX = 'es_state_'

// Baseline values (emotions drift back toward these)
const BASELINE = {
  anger: 5,
  sadness: 5,
  jealousy: 5,
  anxiety: 10,
  curiosity: 15,
  excitement: 10,
  control: 50,
  attachment: null, // Computed from affection
}

// Decay rates per turn (multiplied each tick)
// Values < 1.0 = decay toward baseline, > 1.0 = recover toward baseline
const DECAY = {
  anger: 0.85,
  sadness: 0.90,
  jealousy: 0.80,
  anxiety: 0.88,
  curiosity: 0.92,
  excitement: 0.85,
  control: 1.05,  // Recovers toward baseline
  attachment: 0.98, // Very sticky
}

// Emotion labels for prompt
const EMOTION_LABELS = {
  anger: '愤怒',
  sadness: '悲伤',
  jealousy: '嫉妒',
  anxiety: '焦虑',
  curiosity: '好奇',
  excitement: '兴奋',
  control: '自控',
  attachment: '依恋',
}

const TRACKED_EMOTIONS = Object.keys(BASELINE)

// ═══════════════════════════════════════════════════════════
// 1. Event Detection (keyword-based, no LLM)
// ═══════════════════════════════════════════════════════════

/**
 * Event type → emotion deltas.
 * Each entry: { emotion: delta } applied when event is detected.
 */
const PLAYER_EVENT_PATTERNS = [
  {
    name: 'rejection',
    patterns: ['算了', '不用', '不必', '随便', '无所谓', '不关你事', '与你无关', '不重要', '不在乎', '不感兴趣', '不需要', '就这样'],
    deltas: { anger: 5, control: -3, attachment: 2, anxiety: 3, sadness: 2 },
  },
  {
    name: 'warmth',
    patterns: ['谢谢', '想你', '等你', '担心', '还好吗', '没事吧', '辛苦了', '想你', '在乎', '在意', '重要'],
    deltas: { anxiety: -5, control: 3, excitement: 3, curiosity: 2, sadness: -3 },
  },
  {
    name: 'silence_cold',
    patterns: ['嗯', '哦', '好', '行', '。', '…'],
    deltas: { jealousy: 4, anger: 3, sadness: 2, curiosity: 3 },
    requireShort: true, // Only trigger if input is very short (< 5 chars)
  },
  {
    name: 'provocation',
    patterns: ['你敢', '试试', '凭什么', '为什么不敢', '你能怎样', '你管我', '关你屁事', '少来', '别碰我'],
    deltas: { anger: 6, excitement: 5, control: -4, curiosity: 3 },
  },
  {
    name: 'vulnerability',
    patterns: ['我怕', '我害怕', '我不知道', '帮帮我', '好累', '撑不住', '对不起', '是我的错', '别走', '不要离开'],
    deltas: { attachment: 5, anxiety: -2, sadness: 3, control: 2, anger: -3 },
  },
  {
    name: 'jealousy_trigger',
    patterns: ['他', '她', '那个人', '别人', '上次那个', '你朋友', '你同事'],
    deltas: { jealousy: 10, anger: 5, control: -6, anxiety: 4, curiosity: 5 },
  },
]

const AI_REPLY_EVENT_PATTERNS = [
  {
    name: 'was_aggressive',
    patterns: ['吼', '砸', '摔', '按在墙', '推到', '逼近', '掐', '扇', '撕', '骂'],
    deltas: { control: -5, excitement: 3, anger: 2 },
  },
  {
    name: 'was_vulnerable',
    patterns: ['颤抖', '低头', '后退', '叹气', '半晌', '沉默', '闭眼', '轻声', '几乎听不清'],
    deltas: { anxiety: 3, attachment: 2, sadness: 2, control: -2 },
  },
  {
    name: 'was_cold',
    patterns: ['冷淡', '冷冷', '面无表情', '瞥', '移开视线', '转过身', '不再看'],
    deltas: { control: 3, sadness: 2, jealousy: 1 },
  },
  {
    name: 'was_intimate',
    patterns: ['吻', '抱', '亲', '靠近', '抚摸', '体温', '心跳'],
    deltas: { excitement: 5, anxiety: -3, attachment: 3, control: -4 },
  },
]

/**
 * Detect events from text using keyword matching.
 * Returns array of detected event names.
 */
function detectEvents(text, patterns) {
  if (!text) return []
  const detected = []
  const lower = text.toLowerCase()

  for (const evt of patterns) {
    if (evt.requireShort && text.length > 10) continue  // Skip short-only patterns for long text
    // Check for single-char patterns separately
    if (evt.patterns.some(p => p.length === 1)) {
      // Single char patterns (like "。") — only trigger if text IS that char
      if (evt.patterns.some(p => p.length === 1 && text.trim() === p)) {
        detected.push(evt)
        continue
      }
    }
    // Normal keyword matching
    if (evt.patterns.some(p => p.length > 1 && lower.includes(p.toLowerCase()))) {
      detected.push(evt)
    }
  }
  return detected
}

// ═══════════════════════════════════════════════════════════
// 2. State Management
// ═══════════════════════════════════════════════════════════

/**
 * Create a fresh ES state object.
 */
export function createESState() {
  return { characters: {} }
}

function _ensureChar(esState, charName, affectionInitial) {
  if (!esState.characters[charName]) {
    const baseline = { ...BASELINE }
    baseline.attachment = (affectionInitial ?? 50) * 0.5
    esState.characters[charName] = {
      ...baseline,
      _prev: { ...baseline }, // For delta display
      _turn: 0,
    }
  }
  return esState.characters[charName]
}

// ═══════════════════════════════════════════════════════════
// 3. Simulation Tick
// ═══════════════════════════════════════════════════════════

/**
 * Run one tick of the emotion simulator.
 *
 * @param {object} esState — current ES state (mutated in place)
 * @param {object} rc — romance character descriptor
 * @param {number} affection — current affection value
 * @param {string} playerInput — current player input
 * @param {string} aiReply — current AI reply
 * @param {number} affectionDelta — delta from affection scoring
 * @param {number} tension — global tension level (0-100)
 * @returns {object} { charName: { emotion: { prev, now, delta } } }
 */
export function simulateEmotionTick(esState, rc, affection, playerInput, aiReply, affectionDelta, tension = 30) {
  if (!rc?.name) return {}

  const charName = rc.name
  const profile = detectAggressionProfile(rc)
  const cs = _ensureChar(esState, charName, affection)

  // Save previous state for delta display
  cs._prev = { ...cs }
  cs._turn = (cs._turn || 0) + 1

  // ── Step 1: Decay toward baseline ──
  const baseline = { ...BASELINE }
  baseline.attachment = affection * 0.5 // Attachment baseline tied to affection
  // Pursuer characters have higher baseline jealousy and excitement
  if (profile === AGGRESSION_PROFILES.PURSUER) {
    baseline.jealousy = 15
    baseline.excitement = 20
    baseline.curiosity = 25
  } else if (profile === AGGRESSION_PROFILES.CONFRONTATIONAL) {
    baseline.anger = 12
    baseline.jealousy = 10
  } else if (profile === AGGRESSION_PROFILES.ALOOF) {
    baseline.curiosity = 8
    baseline.excitement = 5
  }

  for (const emotion of TRACKED_EMOTIONS) {
    const current = cs[emotion] ?? baseline[emotion] ?? 50
    const base = baseline[emotion] ?? 50
    const rate = DECAY[emotion] ?? 0.9

    if (rate < 1.0) {
      // Decay toward baseline: move closer to baseline
      cs[emotion] = clamp(base + (current - base) * rate, 0, 100)
    } else {
      // Recover toward baseline: move closer to baseline (for control)
      cs[emotion] = clamp(base - (base - current) * (2 - rate), 0, 100)
    }
  }

  // ── Step 2: Apply event deltas ──
  const playerEvents = detectEvents(playerInput, PLAYER_EVENT_PATTERNS)
  const aiEvents = detectEvents(aiReply, AI_REPLY_EVENT_PATTERNS)

  for (const evt of playerEvents) {
    for (const [emotion, delta] of Object.entries(evt.deltas)) {
      if (cs[emotion] != null) {
        cs[emotion] = clamp(cs[emotion] + delta, 0, 100)
      }
    }
  }

  for (const evt of aiEvents) {
    for (const [emotion, delta] of Object.entries(evt.deltas)) {
      if (cs[emotion] != null) {
        cs[emotion] = clamp(cs[emotion] + delta, 0, 100)
      }
    }
  }

  // ── Step 3: Affection delta → emotion delta ──
  if (affectionDelta > 0) {
    cs.excitement = clamp((cs.excitement ?? 10) + Math.min(affectionDelta * 2, 10), 0, 100)
    cs.anxiety = clamp((cs.anxiety ?? 10) - Math.min(affectionDelta * 1.5, 8), 0, 100)
    cs.attachment = clamp((cs.attachment ?? 50) + Math.min(affectionDelta * 1.5, 8), 0, 100)
  } else if (affectionDelta < 0) {
    cs.anger = clamp((cs.anger ?? 5) + Math.min(Math.abs(affectionDelta) * 2, 12), 0, 100)
    cs.sadness = clamp((cs.sadness ?? 5) + Math.min(Math.abs(affectionDelta) * 1.5, 10), 0, 100)
    cs.control = clamp((cs.control ?? 50) - Math.min(Math.abs(affectionDelta) * 1.5, 10), 0, 100)
  }

  // ── Step 4: Global tension modifier ──
  if (tension > 60) {
    cs.anxiety = clamp((cs.anxiety ?? 10) + 3, 0, 100)
    cs.jealousy = clamp((cs.jealousy ?? 5) + 2, 0, 100)
    cs.control = clamp((cs.control ?? 50) - 2, 0, 100)
  }

  // ── Step 5: Attachment tracks affection slowly ──
  const targetAttachment = affection * 0.5
  cs.attachment = clamp(cs.attachment + (targetAttachment - cs.attachment) * 0.1, 0, 100)

  // Build result with deltas
  const result = {}
  const deltas = {}
  for (const emotion of TRACKED_EMOTIONS) {
    const prev = cs._prev[emotion] ?? baseline[emotion] ?? 50
    const now = cs[emotion] ?? baseline[emotion] ?? 50
    const delta = now - prev
    if (Math.abs(delta) >= 1) {
      deltas[emotion] = delta
    }
  }

  return {
    [charName]: {
      emotions: { ...cs },
      deltas,
      events: { player: playerEvents.map(e => e.name), ai: aiEvents.map(e => e.name) },
    },
  }
}

// ═══════════════════════════════════════════════════════════
// 4. Prompt Injection
// ═══════════════════════════════════════════════════════════

/**
 * Build the ES emotion state block for prompt injection.
 *
 * @param {object} esState — current ES state
 * @param {Array} rcList — romanceCharacters array
 * @returns {string} prompt block, or '' if no state
 */
export function buildESConstraintBlock(esState, rcList) {
  if (!esState?.characters || !rcList?.length) return ''

  const lines = ['━━━ 💭 ES · 角色当前情绪状态 ━━━']

  let hasState = false
  for (const rc of rcList) {
    const name = rc.name
    const cs = esState.characters[name]
    if (!cs) continue

    const parts = []
    for (const emotion of TRACKED_EMOTIONS) {
      const val = Math.round(cs[emotion] ?? BASELINE[emotion] ?? 50)
      const prev = Math.round(cs._prev?.[emotion] ?? val)
      const delta = val - prev
      const arrow = delta > 2 ? '↑' : delta < -2 ? '↓' : '→'
      parts.push(`${EMOTION_LABELS[emotion]}=${val}(${arrow})`)
    }

    if (parts.length > 0) {
      hasState = true
      lines.push(`【${name}】${parts.join(' | ')}`)
      // Add emotional summary
      const summary = _buildEmotionSummary(cs)
      if (summary) lines.push(`  情绪基调：${summary}`)
    }
  }

  if (!hasState) return ''

  lines.push('角色行为和对话必须从当前情绪出发。情绪不是装饰——它决定角色如何回应。')
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━')

  return lines.join('\n')
}

/**
 * Build a human-readable emotion summary from the state.
 */
function _buildEmotionSummary(cs) {
  const anger = cs.anger ?? 5
  const sadness = cs.sadness ?? 5
  const jealousy = cs.jealousy ?? 5
  const anxiety = cs.anxiety ?? 10
  const curiosity = cs.curiosity ?? 15
  const excitement = cs.excitement ?? 10
  const control = cs.control ?? 50
  const attachment = cs.attachment ?? 50

  const parts = []

  if (anger > 30) parts.push('愤怒')
  else if (anger > 15) parts.push('烦躁')

  if (jealousy > 30) parts.push('强烈嫉妒')
  else if (jealousy > 15) parts.push('隐隐吃醋')

  if (anxiety > 30) parts.push('不安')
  if (sadness > 25) parts.push('低落')

  if (curiosity > 40) parts.push('高度关注')
  else if (curiosity > 20) parts.push('在意')

  if (excitement > 30) parts.push('兴奋')

  if (control > 70) parts.push('强自控')
  else if (control < 30) parts.push('自控崩溃')

  if (attachment > 60) parts.push('深度依恋')
  else if (attachment > 35) parts.push('开始依赖')

  if (parts.length === 0) {
    // Default: based on dominant emotion
    if (curiosity > excitement) return '平静观察'
    return '情绪平稳'
  }

  return parts.join('、')
}

// ═══════════════════════════════════════════════════════════
// 5. Persistence
// ═══════════════════════════════════════════════════════════

function _storageKey(characterId, saveId) {
  return STORAGE_PREFIX + characterId + '_' + (saveId || 'default')
}

export function loadESState(characterId, saveId) {
  try {
    const raw = localStorage.getItem(_storageKey(characterId, saveId))
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') return parsed
    }
  } catch (e) {
    console.warn('[ES] Failed to load state:', e.message)
  }
  return null
}

export function saveESState(characterId, saveId, esState) {
  try {
    // Prune _prev (reconstructed each tick) and keep only essential fields
    const pruned = { characters: {} }
    for (const [name, cs] of Object.entries(esState.characters || {})) {
      const clean = { _turn: cs._turn ?? 0 }
      for (const emotion of TRACKED_EMOTIONS) {
        if (cs[emotion] != null) clean[emotion] = Math.round(cs[emotion])
      }
      pruned.characters[name] = clean
    }
    localStorage.setItem(_storageKey(characterId, saveId), JSON.stringify(pruned))
  } catch (e) {
    console.warn('[ES] Failed to save state:', e.message)
  }
}

// ═══════════════════════════════════════════════════════════
// 6. Utility
// ═══════════════════════════════════════════════════════════

function clamp(val, min, max) {
  if (val == null || isNaN(val)) return min
  return Math.max(min, Math.min(max, val))
}
