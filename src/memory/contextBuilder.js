/**
 * Context Builder — v2.2 Event-Native Memory Engine
 *
 * Takes the Memory Graph and produces clean, prompt-ready context.
 * This is the ONLY function that generates text for LLM injection.
 *
 * Core principle:
 *   ❌ Do NOT store or inject raw dialogue text
 *   ✅ Generate structured context from the graph
 *
 * Three-layer output:
 *   [STATE]    — relationship values + tension levels
 *   [EVENTS]   — recent event descriptions
 *   [ACTIVE]   — current conflicts + scene info
 */

import { getRecentEvents, getAllEdgeStates } from './memoryGraph'
import { detectActiveConflicts } from './stateDiffEngine'

/**
 * Build clean context text for LLM prompt injection.
 *
 * @param {object} graph - memory graph
 * @param {object} options - { maxEvents: 10, includeScene: true, compact: false }
 * @returns {string} prompt-ready context text
 */
export function buildContext(graph, options = {}) {
  if (!graph) return ''

  const { maxEvents = 12, includeScene = true, compact = false } = options

  const sections = []

  // ── Layer 1: STATE ──
  const stateText = buildStateLayer(graph, compact)
  if (stateText) sections.push(stateText)

  // ── Layer 2: EVENTS ──
  const eventsText = buildEventLayer(graph, maxEvents, compact)
  if (eventsText) sections.push(eventsText)

  // ── Layer 3: ACTIVE (conflicts + scene) ──
  const activeText = buildActiveLayer(graph, includeScene, compact)
  if (activeText) sections.push(activeText)

  if (sections.length === 0) return ''

  return '【事件记忆——已结构化】\n' + sections.join('\n\n')
}

/**
 * Layer 1: Relationship state snapshot.
 *
 * Output format:
 *   林晚：好感72 张力88 信任40 主导75% | 敌对阶段
 */
function buildStateLayer(graph, compact) {
  const edges = getAllEdgeStates(graph)
  if (!edges || Object.keys(edges).length === 0) return ''

  const stateLines = Object.entries(edges).map(([key, edge]) => {
    if (!edge) return null
    const name = key.replace('user_', '')
    const parts = []

    if (edge.affection != null) parts.push('好感' + edge.affection)
    if (edge.tension != null) parts.push('张力' + edge.tension)
    if (edge.trust != null) parts.push('信任' + edge.trust)
    if (edge.dominance != null) parts.push('主导' + Math.round(edge.dominance * 100) + '%')

    if (edge.lastEmotion && edge.lastEmotion !== 'none') {
      const emojiMap = {
        anger: '怒', hurt: '伤', jealousy: '妒', fear: '惧',
        cold: '冷', longing: '念', warmth: '暖', despair: '绝望',
        triumph: '得胜', guilt: '内疚',
      }
      parts.push(emojiMap[edge.lastEmotion] || edge.lastEmotion)
    }

    if (edge.stageHint) parts.push(edge.stageHint)

    if (parts.length === 0) return null
    return name + '：' + parts.join('，')
  }).filter(Boolean)

  if (stateLines.length === 0) return ''

  return '【关系状态】\n' + stateLines.join('\n')
}

/**
 * Layer 2: Recent events (narrative, not code).
 *
 * Output format:
 *   林晚对玩家发怒——逼问昨晚行踪
 */
function buildEventLayer(graph, maxEvents, compact) {
  const recentEvents = getRecentEvents(graph, maxEvents)
  if (!recentEvents || recentEvents.length === 0) return ''

  const eventDescs = recentEvents.map(e => {
    const actor = e.actor === 'user' ? '玩家' : (e.actor || '角色')
    const target = e.target === 'user' ? '玩家' : (e.target || '')

    let desc = actor
    if (target && target !== actor) desc += '→' + target

    // Intent/type as action verb
    const actionVerb = intentToVerb(e.intent || e.type)
    if (actionVerb) desc += actionVerb

    // Summary
    if (e.summary) desc += '——' + e.summary

    // Compact: include intensity only for high-intensity events
    if (!compact && e.intensity >= 0.7) {
      desc += ' [' + Math.round(e.intensity * 100) + '%]'
    }

    return desc
  })

  return '【最近事件】\n' + eventDescs.join('\n')
}

/**
 * Layer 3: Active conflicts + scene info.
 */
function buildActiveLayer(graph, includeScene, compact) {
  const lines = []

  // Active conflicts
  const conflicts = graph.global?.activeConflicts || []
  if (conflicts.length > 0) {
    lines.push('【活跃冲突】' + conflicts.join(' | '))
  }

  // Unresolved flags
  const flags = graph.global?.flags || []
  if (flags.length > 0) {
    lines.push('【全局旗标】' + flags.join(' | '))
  }

  // Scene info
  if (includeScene) {
    const sceneParts = []
    if (graph.global?.sceneLocation) {
      sceneParts.push('地点：' + graph.global.sceneLocation)
    }
    const present = (graph.global?.presentCharacters || []).filter(n => n !== 'user')
    if (present.length > 0) {
      sceneParts.push('在场：' + present.join('、'))
    }
    if (graph.global?.sceneMood) {
      sceneParts.push('氛围：' + graph.global.sceneMood)
    }
    if (sceneParts.length > 0) {
      lines.push('【当前场景】' + sceneParts.join(' | '))
    }
  }

  if (graph.global?.turnCount > 0) {
    lines.push('已进行' + graph.global.turnCount + '轮对话')
  }

  return lines.length > 0 ? lines.join('\n') : ''
}

/**
 * Map intent/event type to Chinese action verb.
 */
function intentToVerb(intentOrType) {
  const map = {
    accusation: '质问',
    withdrawal: '退后',
    control: '试图控制',
    confession: '坦白',
    provocation: '挑衅',
    interrogation: '逼问',
    dismissal: '打发',
    threat: '威胁',
    seduction: '撩拨',
    mockery: '嘲讽',
    challenge: '挑战',
    appeal: '恳求',
    silence_as_weapon: '以沉默施压',
    territory_marking: '宣示领地',
    ultimatum: '下通牒',
    confrontation: '正面对抗',

    RELATIONSHIP_CHANGE: '',
    CONFLICT_EVENT: '发生冲突',
    SCENE_SHIFT: '场景变化',
    NPC_ACTION: '行动',
    REVELATION: '曝出秘密',
    CONTROL_ATTEMPT: '试图控制',
    EMOTIONAL_SPIKE: '情绪爆发',
    DIALOGUE_INTENT: '',
  }
  return map[intentOrType] || ''
}

/**
 * Build a minimal context for token-constrained situations.
 * Only includes the absolute essentials.
 */
export function buildMinimalContext(graph) {
  return buildContext(graph, { maxEvents: 5, includeScene: true, compact: true })
}

/**
 * Estimate the token count of the generated context.
 */
export function estimateContextTokens(graph) {
  const text = buildContext(graph)
  const cjk = (text.match(/[一-鿿㐀-䶿]/g) || []).length
  return {
    total: Math.ceil(cjk / 2.5 + (text.length - cjk) / 4),
    text,
  }
}

/**
 * Build a structured summary for the Graph Store display (debug/UI).
 * NOT used for LLM prompt injection.
 */
export function buildGraphSummary(graph) {
  if (!graph) return '无记忆图谱'

  const lines = []

  lines.push('━━━ Memory Graph v2.2 ━━━')
  lines.push('节点：' + Object.keys(graph.nodes || {}).length + '个')
  lines.push('关系边：' + Object.keys(graph.edges || {}).length + '条')
  lines.push('事件日志：' + (graph.event_log || []).length + '条')
  lines.push('轮数：' + (graph.global?.turnCount || 0))

  const stateText = buildStateLayer(graph, false)
  if (stateText) {
    lines.push('\n' + stateText)
  }

  return lines.join('\n')
}
