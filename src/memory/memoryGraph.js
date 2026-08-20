/**
 * Memory Graph — v2.2 Event-Native Memory Engine
 *
 * The central store for the relationship graph. Replaces chat history
 * as the source of truth for character state.
 *
 * Core principle:
 *   ❌ Do NOT store chat messages
 *   ✅ Store relationship graph + event log
 *
 * Structure:
 *   nodes: { characterName: { traits, lastSeen } }
 *   edges: { user_characterName: { affection, tension, trust, dominance } }
 *   event_log: [ structured events ]
 *   global: { sceneLocation, activeConflicts, flags }
 *
 * Persisted to localStorage alongside messages.
 */

const STORAGE_KEY_PREFIX = 'jsjg_memory_graph_'

// ── localStorage helpers (inline to avoid circular deps) ──

function safeGetItem(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      console.warn('[MemoryGraph] Storage full, graph not saved')
    }
    return false
  }
}

/**
 * Create a new, empty memory graph.
 */
export function createMemoryGraph() {
  return {
    version: 2,
    createdAt: Date.now(),
    updatedAt: Date.now(),

    nodes: {},
    edges: {},
    event_log: [],

    global: {
      sceneLocation: '',
      sceneMood: '',
      presentCharacters: [],
      activeConflicts: [],
      flags: [],
      turnCount: 0,
      lastTurnTime: null,
    },
  }
}

/**
 * Initialize the memory graph from character data.
 * Creates nodes for all romance characters and edges to user.
 *
 * @param {object} character - full character object
 * @param {object} affections - { name: value } map
 * @returns {object} initialized memory graph
 */
export function initGraphFromCharacter(character, affections) {
  const graph = createMemoryGraph()

  // User node
  graph.nodes.user = {
    type: 'player',
    name: (character._playerProfile?.name) || '__user__',
  }

  // Romance character nodes + edges
  const rcList = character.romanceCharacters || []
  for (const rc of rcList) {
    if (!rc.name) continue

    // Node
    graph.nodes[rc.name] = {
      type: 'romance',
      name: rc.name,
      personality: rc.personality || '',
      color: detectColor(rc),
    }

    // Edge: user ↔ character
    const edgeKey = 'user_' + rc.name
    const affValue = affections?.[rc.name] ?? rc.affectionInitial ?? 50

    graph.edges[edgeKey] = {
      affection: affValue,
      tension: graph.nodes[rc.name].color === 'dark' ? 70 : 30,
      trust: graph.nodes[rc.name].color === 'dark' ? 30 : 60,
      dominance: graph.nodes[rc.name].color === 'dark' ? 0.75 : 0.3,
      stageHint: '',
      lastEmotion: 'none',
      lastIntent: null,
      lastInteraction: Date.now(),
    }
  }

  // NPC nodes
  const npcs = character.npcs || []
  for (const npc of npcs) {
    if (!npc.name) continue
    graph.nodes[npc.name] = {
      type: 'npc',
      name: npc.name,
      personality: npc.personality || '',
      relationship: npc.relationship || '',
    }
    // NPC edges to user
    const edgeKey = 'user_' + npc.name
    graph.edges[edgeKey] = {
      affection: 50,
      tension: 30,
      trust: 50,
      dominance: 0.5,
      stageHint: '',
      lastEmotion: 'none',
      lastIntent: null,
      lastInteraction: Date.now(),
    }
  }

  // Scene location
  if (character.worldSetting) {
    graph.global.sceneLocation = '初始场景'
  }

  return graph
}

/**
 * Load the memory graph from localStorage.
 * Falls back to creating a new one on failure.
 *
 * @param {string} characterId - character UUID
 * @returns {object} memory graph
 */
export function loadGraph(characterId, saveId) {
  const sid = saveId || '__no_save__'
  const key = STORAGE_KEY_PREFIX + sid + '_' + characterId
  try {
    const raw = safeGetItem(key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.version >= 1) {
        return parsed
      }
    }
  } catch (err) {
    console.warn('[MemoryGraph] Load failed, creating new graph:', err.message)
  }
  return null
}

/**
 * Save the memory graph to localStorage.
 *
 * @param {string} characterId - character UUID
 * @param {object} graph - memory graph to save
 */
export function saveGraph(characterId, saveId, graph) {
  // 兼容旧式 2 参调用 saveGraph(characterId, graph)：第 2 参是图对象而非 saveId
  if (graph === undefined && saveId && typeof saveId === 'object') {
    graph = saveId
    saveId = undefined
  }
  if (!graph || typeof graph !== 'object') {
    console.warn('[MemoryGraph] saveGraph: graph 为空，跳过保存', { characterId, saveId })
    return
  }
  const sid = saveId || '__no_save__'
  const key = STORAGE_KEY_PREFIX + sid + '_' + characterId
  graph.updatedAt = Date.now()
  try {
    safeSetItem(key, JSON.stringify(graph))
  } catch (err) {
    console.error('[MemoryGraph] Save failed:', err.message)
  }
}

/**
 * Update the graph with new events.
 * Applies deltas to edges, appends to event log, updates global state.
 *
 * @param {object} graph - current memory graph
 * @param {Array} events - extracted events
 * @param {object} options - { turnNumber, userInput, aiReply }
 * @returns {object} updated graph (mutated in place for performance)
 */
export function updateGraph(graph, events, options = {}) {
  if (!graph || !events || events.length === 0) return graph

  for (const e of events) {
    // Find or create the relevant edge
    const edgeKey = findEdgeKey(graph, e.actor, e.target)
    if (!edgeKey) continue

    const edge = graph.edges[edgeKey]
    if (!edge) continue

    // Apply deltas
    if (e.delta) {
      edge.affection = clamp((edge.affection || 50) + (e.delta.affection || 0), 0, 100)
      edge.tension = clamp((edge.tension || 50) + (e.delta.tension || 0), 0, 100)
      edge.trust = clamp((edge.trust || 50) + (e.delta.trust || 0), 0, 100)
    }

    // Update dominance on control attempts
    if (e.type === 'CONTROL_ATTEMPT' && e.intensity > 0.7) {
      edge.dominance = clamp((edge.dominance || 0.5) + 0.03, 0, 1)
    }

    edge.lastEmotion = e.emotion || edge.lastEmotion
    edge.lastIntent = e.intent || edge.lastIntent
    edge.lastInteraction = Date.now()

    // Append to event log
    graph.event_log.push({
      ...e,
      timestamp: Date.now(),
      turn: options.turnNumber || graph.global.turnCount,
    })
  }

  // Trim event log (keep last 200 events)
  if (graph.event_log.length > 200) {
    graph.event_log = graph.event_log.slice(-200)
  }

  // Update global state
  graph.global.turnCount = (graph.global.turnCount || 0) + 1
  graph.global.lastTurnTime = Date.now()

  // Detect active conflicts
  graph.global.activeConflicts = detectActiveConflicts(graph.edges)

  // Update scene info from AI reply
  if (options.aiReply) {
    updateSceneFromReply(graph, options.aiReply)
  }

  graph.updatedAt = Date.now()
  return graph
}

/**
 * Get recent events for context building.
 */
export function getRecentEvents(graph, count = 15) {
  if (!graph || !graph.event_log) return []
  return graph.event_log.slice(-count)
}

/**
 * Get edge summary for a specific character.
 */
export function getEdgeState(graph, characterName) {
  if (!graph || !graph.edges) return null
  const key = 'user_' + characterName
  return graph.edges[key] || null
}

/**
 * Get all relationship summaries.
 */
export function getAllEdgeStates(graph) {
  if (!graph || !graph.edges) return {}
  return { ...graph.edges }
}

// ── Helpers ──

function findEdgeKey(graph, actor, target) {
  // Normalize: user is always the reference point
  const edgeKey1 = target + '_' + actor  // e.g. user_林晚
  const edgeKey2 = actor + '_' + target  // e.g. 林晚_user
  const edgeKey3 = 'user_' + actor
  const edgeKey4 = 'user_' + target

  if (graph.edges[edgeKey1]) return edgeKey1
  if (graph.edges[edgeKey2]) return edgeKey2
  if (graph.edges[edgeKey3]) return edgeKey3
  if (graph.edges[edgeKey4]) return edgeKey4

  // Fallback: try matching any edge containing the actor name
  for (const key of Object.keys(graph.edges)) {
    if (key.includes(actor) || key.includes(target)) return key
  }

  return null
}

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

function detectActiveConflicts(edges) {
  const conflicts = []
  for (const [key, edge] of Object.entries(edges)) {
    if (!edge) continue
    if (edge.tension >= 70) {
      const name = key.replace('user_', '')
      conflicts.push(name + '关系高张力(' + edge.tension + '%)')
    }
    if (edge.trust <= 30) {
      const name = key.replace('user_', '')
      conflicts.push(name + '信任危机(' + edge.trust + '%)')
    }
  }
  return conflicts
}

function updateSceneFromReply(graph, aiReply) {
  if (!aiReply) return

  // Extract location hints from AI reply
  const locMatch = aiReply.match(/【([^】]+)】/)
  if (locMatch) {
    // Character prefix, not location — skip
  }

  // Detect character presence
  for (const nodeName of Object.keys(graph.nodes)) {
    if (nodeName === 'user') continue
    if (aiReply.includes(nodeName) || aiReply.includes('【' + nodeName + '】')) {
      if (!graph.global.presentCharacters.includes(nodeName)) {
        graph.global.presentCharacters.push(nodeName)
      }
    }
  }
  // Keep only last 10 present characters
  if (graph.global.presentCharacters.length > 10) {
    graph.global.presentCharacters = graph.global.presentCharacters.slice(-10)
  }
}
