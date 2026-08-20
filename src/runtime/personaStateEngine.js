/**
 * Persona State Engine v3 — 人格驱动聊天系统
 *
 * 核心思想：角色不是在回复消息，而是在"情绪状态驱动下泄露语言"。
 *
 * Modules:
 *   1. updatePersonaState — 根据交互更新人格状态
 *   2. decideBehavior — 人格状态 → 行为策略
 *   3. generateIntent — 人格状态 + 输入 → 回复意图
 *   4. composeBurst — 意图驱动的气泡拆分和延迟
 */

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }

// ═══════════════════════════════════════════════════════════
// 1. Persona State Engine
// ═══════════════════════════════════════════════════════════

export function updatePersonaState(state, interaction) {
  const next = { ...state }

  // Emotional drivers from interaction
  next.emotion = clamp(
    (next.emotion || 50) + (interaction.affectionDelta || 0) * 0.6 + (interaction.attachmentSignal || 0) * 0.3,
    -100, 100,
  )
  next.tension = clamp(
    (next.tension || 30) + (interaction.conflictDelta || 0) * 0.8,
    0, 100,
  )
  next.dependence = clamp(
    (next.dependence || 30) + (interaction.closenessDelta || 0) * 0.5 - (interaction.distanceSignal || 0) * 0.4,
    0, 100,
  )

  return next
}

/**
 * Build persona state from USK snapshot.
 */
export function buildPersonaFromUSK(uskState) {
  if (!uskState) return defaultPersona()
  const rel = uskState.relationship || {}
  const emo = uskState.emotion || {}
  const ten = uskState.tension || {}
  const lif = uskState.life || {}

  return {
    emotion: clamp(
      (rel.affection || 50) * 0.3 + (emo.curiosity || 30) * 0.3 + (lif.mood || 50) * 0.2 - (emo.sadness || 10) * 0.2,
      -100, 100,
    ),
    tension: clamp(ten.unresolved_conflicts || 30, 0, 100),
    dependence: clamp((rel.dependency || 30) * 0.5 + (rel.affection || 50) * 0.3 + (lif.lonely || 40) * 0.2, 0, 100),
    affection: rel.affection || 50,
    jealousy: emo.jealousy || 5,
    anger: emo.anger || 5,
    mood: lif.mood || 50,
  }
}

function defaultPersona() {
  return { emotion: 50, tension: 30, dependence: 30, affection: 50, jealousy: 5, anger: 5, mood: 50 }
}

// ═══════════════════════════════════════════════════════════
// 2. Behavior Policy Layer
// ═══════════════════════════════════════════════════════════

export function decideBehavior(persona) {
  if (!persona) return 'normal_chat'

  // 😡 High tension → cold, short, resistant
  if (persona.tension > 70) return 'cold_short_reply'
  if (persona.tension > 55 && persona.anger > 30) return 'resist_or_push_back'

  // 😶 Emotional suppression → delayed, single
  if (persona.emotion < -40) return 'delay_response'

  // 💞 High affection (without high tension) → warm, continuous
  if (persona.affection > 80 && persona.tension < 50) return 'long_continuous_chat'

  // ❤️ High dependence → clingy, multi-message
  if (persona.dependence > 60) return 'double_message_spam'

  // 💢 Jealousy spike
  if (persona.jealousy > 50) return 'jealous_probe'

  // 🙂 Good mood + decent affection → share
  if (persona.mood > 65 && persona.affection > 55) return 'share_emotion'

  return 'normal_chat'
}

// ═══════════════════════════════════════════════════════════
// 3. Message Intent Generator
// ═══════════════════════════════════════════════════════════

export function generateIntent(persona, userInput) {
  if (persona.tension > 70) return 'resist_or_push_back'
  if (persona.affection > 80) return 'share_emotion'
  if (persona.dependence > 60) return 'seek_contact'
  if (persona.jealousy > 50) return 'jealous_probe'
  if (persona.emotion < -40) return 'withdraw'
  return 'respond_neutral'
}

// ═══════════════════════════════════════════════════════════
// 4. Burst Composer v3 — intent-driven timing
// ═══════════════════════════════════════════════════════════

export function composeBurst(intent, segments) {
  if (!segments || segments.length === 0) return []

  const baseDelay = (
    intent === 'seek_contact' ? 250 :
    intent === 'resist_or_push_back' ? 1200 :
    intent === 'withdraw' ? 2000 :
    intent === 'jealous_probe' ? 600 :
    500
  )

  return segments.map((text, i) => ({
    text,
    delay: i === 0
      ? baseDelay + Math.random() * 400
      : baseDelay + Math.random() * 600,
  }))
}

// ═══════════════════════════════════════════════════════════
// 5. Persona-driven prompt suffix
// ═══════════════════════════════════════════════════════════

export function getPersonaPromptSuffix(persona, behavior) {
  if (!persona) return ''

  const suffix = {
    cold_short_reply: '\n⚠️ 你现在的状态：烦躁/冷淡。回复必须极简短——1到2句话，不超过10个字。不要主动开启话题。不要用表情。',
    resist_or_push_back: '\n⚠️ 你现在的状态：对抗/抵触。回复要有刺——不直接回答，反问回去，或直接说"不想说"。不要温柔。',
    delay_response: '\n⚠️ 你现在的状态：情绪低落/不想说话。只回复一条，短句。不说原因。',
    long_continuous_chat: '\n⚠️ 你现在的状态：心情好/想说话。可以用2-3条消息表达，语气轻快。',
    double_message_spam: '\n⚠️ 你现在的状态：很想对方。发2-3条连续消息，语气黏人但自然。可以追问。',
    jealous_probe: '\n⚠️ 你现在的状态：有点在意/吃醋。回复带试探性——表面平静但话里有话。',
    share_emotion: '\n⚠️ 你现在的状态：心情好，想分享。语气轻松自然，像跟亲近的人聊天。',
    normal_chat: '',
  }

  return suffix[behavior] || ''
}

// ═══════════════════════════════════════════════════════════
// 6. Stream Scheduler v3
// ═══════════════════════════════════════════════════════════

export function createPersonaStream(persona, burst) {
  return burst.map((b, i) => ({
    ...b,
    personaDelay: b.delay + (persona?.emotion || 0) * 5,
    style: persona?.tension > 60 ? 'tense' : persona?.affection > 70 ? 'warm' : 'neutral',
  }))
}
