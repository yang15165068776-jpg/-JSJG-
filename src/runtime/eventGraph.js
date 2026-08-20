/**
 * Event Graph v1 — Structured Event Nodes + Causal Trace (NTK v2)
 *
 * Core principle:
 *   ❗ Every plot event is a NODE. Every node has a CAUSE. The LLM can only
 *      extend existing chains — not invent new ones from nothing.
 *
 * v1 (Fact Ledger):  "Don't make things up"        ← preventing fabrication
 * v2 (Event Graph):  "Everything traces back"       ← structural causality
 *
 * Architecture:
 *   EventNode { id, type, actors, content, timestamp, source }
 *   CausalEdge { from: eventId, to: eventId, reason }
 *   CausalTrace: ordered chain of connected events
 *
 * The graph is built FROM existing data sources:
 *   - Fact Ledger actionFacts → events
 *   - Story Canon timeline → events
 *   - World Engine eventHistory → events
 *   - Current turn user/assistant actions → events
 *
 * Injected into prompt as: "当前事件链: e1→e2→e3。你的回复是e4，因果连接到e3。"
 */

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function uid() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }

// ═══════════════════════════════════════════════════════════
// 1. Event Node
// ═══════════════════════════════════════════════════════════

function createEvent(type, content, opts = {}) {
  return {
    id: opts.id || uid(),
    type,                    // 'player_action' | 'character_action' | 'conflict' | 'intimacy' | 'rejection' | 'jealousy' | 'autonomous' | 'world_event' | 'state_change'
    actors: opts.actors || [],   // Who was involved
    content,                     // What happened (1 sentence)
    timestamp: opts.timestamp || Date.now(),
    turn: opts.turn || 0,
    source: opts.source || 'system',  // 'player' | 'character' | 'autonomous' | 'world'
    // ── Causal links ──
    causedBy: opts.causedBy || [],   // [eventId] — what events caused this one
    causes: opts.causes || [],       // [eventId] — what events this one caused
    // ── Meta ──
    intensity: opts.intensity || 50,  // 0-100 how significant
    locked: true,                     // Once written, immutable
  }
}

// ═══════════════════════════════════════════════════════════
// 2. Causal Trace
// ═══════════════════════════════════════════════════════════

/**
 * Find the most likely cause for a new event by scanning recent events.
 * Heuristic: the most recent event involving overlapping actors is the likely cause.
 */
function findLikelyCause(newEvent, recentEvents) {
  if (recentEvents.length === 0) return null

  // Score each recent event as a potential cause
  const scores = recentEvents.map(evt => {
    let score = 0

    // Recent events score higher (recency)
    const recencyBoost = Math.max(0, 10 - (recentEvents.length - recentEvents.indexOf(evt)) * 0.5)
    score += recencyBoost

    // Actor overlap
    const overlap = (newEvent.actors || []).filter(a => (evt.actors || []).includes(a)).length
    score += overlap * 5

    // Same type → stronger link
    if (evt.type === newEvent.type) score += 3

    // Emotional intensity
    score += (evt.intensity || 50) / 20

    return { event: evt, score }
  })

  scores.sort((a, b) => b.score - a.score)

  // Only link if score is high enough
  if (scores[0].score > 5) {
    return scores[0].event
  }
  return null
}

/**
 * Build a causal trace chain from an event backwards.
 * Follows causedBy links until reaching an event with no cause.
 */
function traceBackwards(eventId, eventMap) {
  const chain = []
  const visited = new Set()
  let current = eventMap[eventId]

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    chain.unshift(current) // Add to front (we're going backwards)
    // Follow the first cause (primary causal link)
    const causeId = current.causedBy?.[0]
    current = causeId ? eventMap[causeId] : null
  }

  return chain
}

// ═══════════════════════════════════════════════════════════
// 3. Main Engine API
// ═══════════════════════════════════════════════════════════

export const EventGraph = {

  /** @type {object} all events keyed by id */
  events: {},

  /** @type {string[]} ordered event IDs (timeline) */
  timeline: [],

  /** @type {string[]} character names */
  characters: [],

  /** @type {string} player name */
  playerName: '',

  /** @type {number} turn counter */
  turnCount: 0,

  // ── Init ──────────────────────────────────────────

  init(character, existingEvents = []) {
    this.events = {}
    this.timeline = []
    this.turnCount = 0

    const rcList = character.romanceCharacters || []
    this.characters = rcList.map(rc => rc.name).filter(Boolean)
    this.playerName = character._playerProfile?.name || '玩家'

    // Seed from existing event records (Story Canon timeline, Fact Ledger)
    for (const evt of existingEvents) {
      const node = createEvent(evt.type || 'legacy', evt.content || evt.summary || '', {
        id: evt.id,
        actors: evt.actors || [],
        turn: evt.turn || 0,
        source: evt.source || 'legacy',
        intensity: evt.intensity || 50,
      })
      this.events[node.id] = node
      this.timeline.push(node.id)
    }
  },

  reset() {
    this.events = {}
    this.timeline = []
    this.characters = []
    this.playerName = ''
    this.turnCount = 0
  },

  // ── Record Event ──────────────────────────────────

  /**
   * Record a new event in the graph.
   * Auto-links to the most likely cause from recent events.
   *
   * @returns {object} the created event node
   */
  record(type, content, opts = {}) {
    const node = createEvent(type, content, {
      ...opts,
      turn: opts.turn || this.turnCount,
    })

    // Auto-link to likely cause
    const recentEvents = this.timeline.slice(-10).map(id => this.events[id]).filter(Boolean)
    const cause = findLikelyCause(node, recentEvents)
    if (cause) {
      node.causedBy.push(cause.id)
      cause.causes.push(node.id)
    }

    this.events[node.id] = node
    this.timeline.push(node.id)

    // Cap at 200 events
    if (this.timeline.length > 200) {
      const oldIds = this.timeline.splice(0, this.timeline.length - 200)
      for (const id of oldIds) {
        delete this.events[id]
      }
    }

    return node
  },

  // ── Turn Processing ───────────────────────────────

  /**
   * Process one turn: extract events from player input + AI reply.
   * Called AFTER the LLM generates a reply.
   */
  processTurn(userInput, aiReply, opts = {}) {
    this.turnCount++

    const newEvents = []

    // 1. Player action event
    if (userInput && userInput.trim()) {
      const evt = this.record('player_action', this.playerName + '：' + userInput.slice(0, 100), {
        actors: [this.playerName],
        source: 'player',
        intensity: _estimateIntensity(userInput),
      })
      newEvents.push(evt)
    }

    // 2. Character action events from AI reply
    for (const name of this.characters) {
      if (!aiReply.includes(name)) continue

      let actionType = 'character_action'
      let content = ''

      // Detect action type from content
      if (/拒绝|不行|不要|不可以/.test(aiReply)) {
        actionType = 'rejection'
        content = name + '拒绝了某事'
      } else if (/吻|亲|舔|抱|压|按|推倒/.test(aiReply)) {
        actionType = 'intimacy'
        content = name + '有亲密行为'
      } else if (/冲突|对峙|争吵|冷战|翻脸/.test(aiReply)) {
        actionType = 'conflict'
        content = name + '参与冲突'
      } else if (/嫉妒|吃醋|在意|酸/.test(aiReply)) {
        actionType = 'jealousy'
        content = name + '表现出嫉妒'
      } else if (/离开|走|出去|消失|不见/.test(aiReply)) {
        actionType = 'character_action'
        content = name + '离开或退场'
      } else {
        // Default: character spoke/acted
        content = name + '回应了玩家'
      }

      const evt = this.record(actionType, content, {
        actors: [name],
        source: 'character',
        intensity: _estimateIntensity(aiReply),
      })
      newEvents.push(evt)
    }

    // 3. State change events (clothing, location, physical state)
    if (/脱[掉下了去]|解开/.test(aiReply)) {
      for (const name of this.characters) {
        if (aiReply.includes(name) && /脱/.test(aiReply)) {
          this.record('state_change', name + '的衣物被脱去——物理状态改变', {
            actors: [name],
            source: 'character',
            intensity: 80,
          })
        }
      }
    }

    return newEvents
  },

  // ── Causal Trace Query ────────────────────────────

  /**
   * Get the current causal chain leading to the latest event.
   * Returns the chain of connected events that explain "how we got here."
   */
  getCurrentTrace() {
    if (this.timeline.length === 0) return []

    const lastEventId = this.timeline[this.timeline.length - 1]
    return traceBackwards(lastEventId, this.events)
  },

  /**
   * Get all causal chains in the graph (for complex narrative display).
   */
  getAllChains() {
    // Find root events (no cause)
    const roots = Object.values(this.events).filter(e => !e.causedBy || e.causedBy.length === 0)

    const chains = roots.map(root => {
      const chain = [root]
      let current = root
      while (current.causes && current.causes.length > 0) {
        const nextId = current.causes[0] // Follow primary causal link
        current = this.events[nextId]
        if (!current) break
        chain.push(current)
      }
      return chain
    })

    return chains
  },

  // ── Prompt Context Builder ────────────────────────

  /**
   * Build the Event Graph + Causal Trace context for prompt injection.
   * Compact format — tells the LLM what happened and why.
   */
  buildContext() {
    if (this.timeline.length === 0) return ''

    const lines = ['【📊 事件图谱 —— 可追溯的剧情结构】']

    // ── Current causal trace ──
    const trace = this.getCurrentTrace()
    if (trace.length >= 2) {
      const chainStr = trace.map(e => {
        const icon = e.type === 'conflict' ? '⚡' :
                     e.type === 'intimacy' ? '💋' :
                     e.type === 'rejection' ? '🚫' :
                     e.type === 'jealousy' ? '👁' :
                     e.type === 'state_change' ? '🔵' :
                     e.type === 'player_action' ? '👤' : '💬'
        return icon + e.content.slice(0, 50)
      }).join(' → ')

      lines.push('')
      lines.push('━━━ 当前因果链（事件是怎么一步步走到现在的）━━━')
      lines.push(chainStr)
      lines.push('')
      lines.push('⚠ 你的回复必须是这条链的下一环——不能跳到无关事件，不能重写链上已有的事件。')
    }

    // ── Recent events (last 8) ──
    const recent = this.timeline.slice(-8).map(id => this.events[id]).filter(Boolean)
    if (recent.length > 0) {
      lines.push('')
      lines.push('━━━ 最近事件节点 ━━━')
      for (const evt of recent) {
        const causeStr = evt.causedBy?.length > 0
          ? ' ← ' + evt.causedBy.map(cid => {
              const c = this.events[cid]
              return c ? c.content.slice(0, 30) : cid
            }).join(', ')
          : ''
        lines.push('· [' + evt.type + '] ' + evt.content.slice(0, 80) + causeStr)
      }
    }

    // ── Next event hint ──
    const lastEvent = this.events[this.timeline[this.timeline.length - 1]]
    if (lastEvent) {
      lines.push('')
      lines.push('━━━ 下一节点 ━━━')
      lines.push('· 你的回复将成为新的事件节点，因果连接到：' + lastEvent.content.slice(0, 60))
      lines.push('· 新事件必须从这个事件出发——不能凭空跳到另一个场景、另一个话题、另一个情绪')
    }

    // ── Rules ──
    lines.push('')
    lines.push('━━━ 事件图谱铁律 ━━━')
    lines.push('· 每个事件必须有前因——不能凭空发生')
    lines.push('· 事件一旦写入图谱就不能修改——只能追加新事件来解释')
    lines.push('· 角色的情绪变化必须有事件驱动——不能突然转性')
    lines.push('· 你的回复 = 新节点。新节点 = 必须连接到上一节点。')

    return lines.join('\n')
  },

  // ── State Access ──────────────────────────────────

  getEvents() { return { ...this.events } },
  getTimeline() { return [...this.timeline] },
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function _estimateIntensity(text) {
  if (!text) return 30
  const highSignal = /恨|杀|死|滚|崩溃|失控|疯了|爆炸|撕|砸|摔|咬|出血|疼|窒息|要命/.test(text)
  const medSignal = /气|怒|哭|喊|叫|推|拉|抱|吻|脱|压|按|命令|拒绝|不要/.test(text)
  if (highSignal) return 75 + Math.random() * 20
  if (medSignal) return 45 + Math.random() * 25
  return 20 + Math.random() * 25
}
