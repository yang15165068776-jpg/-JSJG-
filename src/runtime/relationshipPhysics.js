/**
 * Autonomous Relationship Simulation Layer v1 (ARSL)
 *
 * Core principle:
 *   ❗ Relationships are not numbers. They are a PHYSICS SYSTEM that evolves itself.
 *
 * Old model:
 *   A → B: { affection: 80, trust: 60 }  ← static, only changes on LLM judge
 *
 * ARSL model:
 *   A → B: { attraction, tension, dependency, insecurity, dominance, jealousy, stability }
 *   B → A: { ... }  ← ASYMMETRIC — A's feelings ≠ B's feelings
 *
 * Every turn, all edges auto-evolve. Tension thresholds trigger events.
 * "花心" isn't a character trait — it's multiple attraction edges rising naturally.
 */

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

// ═══════════════════════════════════════════════════════════
// 1. Edge Structure
// ═══════════════════════════════════════════════════════════

/**
 * Create a relationship edge from `from` to `to`.
 * All values 0-100 unless noted.
 *
 * @param {string} from — character name (the one who FEELS)
 * @param {string} to   — character name (the TARGET of those feelings)
 * @param {object} opts — { initialAffection?, personality? }
 */
function createEdge(from, to, opts = {}) {
  const baseAttraction = opts.initialAffection ?? 30

  // Personality modifiers
  let impulsiveness = 50
  let riskTolerance = 50
  const personality = opts.personality || ''
  if (/轻浮|风流|花心|放荡/.test(personality)) {
    impulsiveness += 25; riskTolerance += 20
  }
  if (/偏执|占有欲强|控制欲|病娇/.test(personality)) {
    impulsiveness += 15; riskTolerance += 10
  }
  if (/腹黑|城府深/.test(personality)) {
    riskTolerance += 30
  }
  if (/温柔|善良|单纯/.test(personality)) {
    impulsiveness -= 20; riskTolerance -= 20
  }

  return {
    from,
    to,
    // ── Core relationship dimensions ──
    attraction: clamp(baseAttraction, 0, 100),   // 吸引力 — how drawn they are
    tension: clamp(baseAttraction * 0.4, 0, 100), // 压力 — emotional charge between them
    dependency: clamp(30, 0, 100),                 // 情感依赖 — need for the other
    insecurity: clamp(40, 0, 100),                 // 不安全感 — fear of losing / uncertainty
    dominance: clamp(40 + Math.random() * 20, 0, 100), // 控制欲 — need to control
    jealousy: clamp(10, 0, 100),                   // 嫉妒 — triggered by third-party interactions
    stability: clamp(60, 0, 100),                   // 稳定性 — how resilient the bond is
    // ── Meta ──
    impulsiveness,
    riskTolerance,
    interactionCount: 0,     // How many times from→to has interacted
    lastInteractionTurn: -1, // Turn number of last direct interaction
    phase: 'stable',         // stable | rising_tension | crisis | rupture | repair
  }
}

// ═══════════════════════════════════════════════════════════
// 2. Evolution Engine — the physics core
// ═══════════════════════════════════════════════════════════

/**
 * Evolve a single edge for one turn tick.
 * Mutates the edge in place and returns any triggered events.
 *
 * @param {object} edge — the edge to evolve
 * @param {object} world — world context
 * @param {number} world.turnCount
 * @param {object} world.allEdges — all edges in the system (for jealousy detection)
 * @param {string[]} world.recentInteractions — who interacted with whom this turn
 * @returns {object[]} triggered events
 */
function evolve(edge, world) {
  const events = []
  const turnCount = world.turnCount || 0

  // ── 1. Attraction: amplified by interaction frequency ──
  const turnsSinceLastInteraction = turnCount - (edge.lastInteractionTurn || 0)
  const interactedThisTurn = (world.recentInteractions || []).some(
    i => (i.from === edge.from && i.to === edge.to) ||
         (i.from === edge.to && i.to === edge.from)
  )

  if (interactedThisTurn) {
    // Direct interaction → attraction grows (diminishing returns at high values)
    const attractionGain = edge.attraction < 60 ? 3 : edge.attraction < 80 ? 2 : 0.5
    edge.attraction = clamp(edge.attraction + attractionGain, 0, 100)
    edge.interactionCount++
    edge.lastInteractionTurn = turnCount
    // Stability increases with consistent interaction
    edge.stability = clamp(edge.stability + 2, 0, 100)
  } else {
    // No interaction → slight decay (absence makes the heart grow fonder... or forget)
    if (turnsSinceLastInteraction > 5) {
      edge.attraction = clamp(edge.attraction - 0.5, 0, 100)
      edge.stability = clamp(edge.stability - 1, 0, 100)
    }
    // Dependency decays with absence
    if (turnsSinceLastInteraction > 3) {
      edge.dependency = clamp(edge.dependency - 1, 0, 100)
    }
  }

  // ── 2. Jealousy: triggered by FROM seeing TO interact with OTHERS ──
  // If TO interacted with someone else (not FROM), FROM gets jealous
  const toInteractedWithOthers = (world.recentInteractions || []).filter(
    i => (i.from === edge.to || i.to === edge.to) &&
         i.from !== edge.from && i.to !== edge.from
  )
  if (toInteractedWithOthers.length > 0 && edge.attraction > 30) {
    const jealousySpike = 5 + edge.insecurity * 0.1
    edge.jealousy = clamp(edge.jealousy + jealousySpike, 0, 100)
    edge.insecurity = clamp(edge.insecurity + 3, 0, 100)
    edge.stability = clamp(edge.stability - 3, 0, 100)
  } else {
    // No jealousy trigger → slow decay
    edge.jealousy = clamp(edge.jealousy - 2, 0, 100)
  }

  // ── 3. Tension = attraction × jealousy × insecurity ──
  const rawTension =
    edge.attraction * 0.3 +
    edge.jealousy * 0.35 +
    edge.insecurity * 0.25 +
    edge.dominance * 0.1
  edge.tension = clamp(Math.round(rawTension), 0, 100)

  // ── 4. High tension erodes stability ──
  if (edge.tension > 50) {
    edge.stability = clamp(edge.stability - (edge.tension - 50) * 0.1, 0, 100)
  }

  // ── 5. Dominance: high-attraction characters with control tendencies escalate ──
  if (edge.attraction > 60 && edge.dominance > 60 && edge.impulsiveness > 50) {
    edge.dominance = clamp(edge.dominance + 1, 0, 100)
  }

  // ── 6. Phase transitions ──
  if (edge.tension > 70 && edge.stability < 40) {
    if (edge.phase !== 'crisis') {
      edge.phase = 'crisis'
      events.push({
        type: 'relationship_crisis',
        from: edge.from,
        to: edge.to,
        tension: edge.tension,
        stability: edge.stability,
        description: edge.from + '对' + edge.to + '的关系进入危机——张力' + edge.tension + '，稳定' + edge.stability,
      })
    }
  } else if (edge.tension > 50 && edge.stability < 50) {
    edge.phase = 'rising_tension'
  } else if (edge.stability < 20) {
    edge.phase = 'rupture'
    events.push({
      type: 'relationship_rupture',
      from: edge.from,
      to: edge.to,
      tension: edge.tension,
      stability: edge.stability,
      description: edge.from + '与' + edge.to + '的关系接近断裂——稳定度仅' + edge.stability,
    })
  } else if (edge.tension < 30 && edge.stability > 60) {
    edge.phase = 'stable'
  }

  return events
}

// ═══════════════════════════════════════════════════════════
// 3. Event Generation — what happens when physics triggers
// ═══════════════════════════════════════════════════════════

const PHYSICS_EVENTS = {
  relationship_crisis: {
    label: '关系危机',
    hints: [
      '角色 {from} 对 {to} 的情绪已经压不住了——张力 {tension}，随时可能爆发',
      '角色 {from} 今天对 {to} 说话的语气变了——表面平静，底下全是裂痕',
      '角色 {from} 和 {to} 之间的空气已经重到其他人都感觉到了',
      '角色 {from} 的手指在发抖——不是因为冷，是因为和 {to} 之间还没说出口的话',
    ],
  },
  relationship_rupture: {
    label: '关系断裂',
    hints: [
      '角色 {from} 和 {to} 之间的绳索已经绷到极限——下一秒就可能断',
      '角色 {from} 最近开始回避 {to}——不是因为不爱，是因为太累了',
      '有人问 {from} "你和 {to} 怎么了"——{from} 没有回答',
      '角色 {from} 对 {to} 的沉默已经不再是"冷战"——是"放弃"',
    ],
  },
  jealousy_explosion: {
    label: '嫉妒爆发',
    hints: [
      '角色 {from} 看到 {to} 和别人互动——胸腔里的火瞬间烧到了喉咙',
      '角色 {from} 今天格外安静——因为刚才看到的那一幕还在脑子里烧',
      '{from} 的手指关节捏得发白——{to} 和那个人说话的距离太近了',
    ],
  },
  multi_attraction: {
    label: '多线吸引',
    hints: [
      '角色 {from} 的注意力在 {targets} 之间游移——ta 自己都没意识到',
      '角色 {from} 对 {targets} 的态度都带着暧昧——不是刻意的，是藏不住',
      '有人注意到 {from} 看 {targets} 的眼神——那不是"朋友"的眼神',
    ],
  },
}

function generatePhysicsEvent(edge, eventType, extra = {}) {
  const templates = PHYSICS_EVENTS[eventType]
  if (!templates) return null

  const hint = pick(templates.hints)
    .replace(/\{from\}/g, edge.from)
    .replace(/\{to\}/g, edge.to)
    .replace(/\{tension\}/g, String(edge.tension))
    .replace(/\{stability\}/g, String(edge.stability))

  if (extra.targets) {
    return hint.replace(/\{targets\}/g, extra.targets)
  }

  return hint
}

// ═══════════════════════════════════════════════════════════
// 4. Main Engine API
// ═══════════════════════════════════════════════════════════

export const RelationshipPhysics = {

  /** @type {object} all edges keyed by "from->to" */
  edges: {},

  /** @type {string[]} character names in the scene */
  characters: [],

  /** @type {number} turn counter */
  turnCount: 0,

  /** @type {string[]} events triggered this turn for prompt injection */
  pendingEvents: [],

  /** @type {object[]} interaction log for this turn */
  recentInteractions: [],

  // ── Init ──────────────────────────────────────────

  /**
   * Initialize the relationship physics engine.
   * Creates edges between all pairs of characters.
   *
   * @param {object} character — full LLM character descriptor
   * @param {object} affections — current affection map from USK
   */
  init(character, affections = {}) {
    this.edges = {}
    this.characters = []
    this.turnCount = 0
    this.pendingEvents = []
    this.recentInteractions = []

    const rcList = character.romanceCharacters || []
    const names = rcList.map(rc => rc.name).filter(Boolean)

    // Add player as a node
    const playerName = character._playerProfile?.name || '玩家'
    if (playerName && playerName !== '玩家' && playerName !== '新玩家') {
      names.push(playerName)
    }

    this.characters = names

    // Create edges: both directions for every pair
    for (const a of names) {
      for (const b of names) {
        if (a === b) continue
        const key = a + '->' + b

        // Find character personality for edge initialization
        const rcA = rcList.find(rc => rc.name === a)
        const personalityA = rcA ? ((rcA.personality || '') + (rcA.background || '')) : ''

        // Initial affection: from USK if available, otherwise from character data
        const initialAff = affections[a] ?? affections[b] ?? rcA?.affectionInitial ?? 30

        this.edges[key] = createEdge(a, b, {
          initialAffection: a === playerName ? (affections[b] ?? 50) : initialAff,
          personality: personalityA,
        })
      }
    }
  },

  /**
   * Reset all state.
   */
  reset() {
    this.edges = {}
    this.characters = []
    this.turnCount = 0
    this.pendingEvents = []
    this.recentInteractions = []
  },

  // ── Turn Tick ─────────────────────────────────────

  /**
   * Advance the physics simulation by one turn.
   * Evolves ALL edges and generates events.
   *
   * Call this ONCE per turn, before the LLM call.
   *
   * @param {object} uskState — current USK state (for syncing)
   * @returns {object[]} events triggered this turn
   */
  tick(uskState) {
    this.turnCount++
    this.pendingEvents = []

    // Sync edge values from USK (affection changes from LLM judge)
    this._syncFromUSK(uskState)

    // Detect interactions this turn (who interacted with whom)
    this._detectInteractions(uskState)

    // Evolve all edges
    for (const [key, edge] of Object.entries(this.edges)) {
      const events = evolve(edge, {
        turnCount: this.turnCount,
        allEdges: this.edges,
        recentInteractions: this.recentInteractions,
      })
      for (const evt of events) {
        const hint = generatePhysicsEvent(edge, evt.type, evt)
        if (hint) {
          this.pendingEvents.push({ type: evt.type, from: edge.from, to: edge.to, hint, edge: { ...edge } })
        }
      }
    }

    // ── Multi-attraction detection (花心 physics) ──
    this._detectMultiAttraction()

    // ── Jealousy explosion detection ──
    this._detectJealousyExplosion()

    // ── Asymmetric relationship detection ──
    this._detectAsymmetry()

    // Clear interaction log for next turn
    this.recentInteractions = []

    return this.pendingEvents
  },

  // ── Private: Detection Methods ────────────────────

  /** Sync edge attraction values from USK affection changes */
  _syncFromUSK(uskState) {
    if (!uskState?.characters) return
    for (const [name, char] of Object.entries(uskState.characters)) {
      const affection = char.relationship?.affection
      if (affection == null) continue
      // Update all edges from this character to the player
      const playerName = this.characters.find(n => n !== name && !this.characters.some(
        c => c !== name && c !== n
      ))
      // Actually, just update all edges FROM this character
      for (const [key, edge] of Object.entries(this.edges)) {
        if (edge.from === name) {
          // Blend USK affection into attraction (weighted: 70% USK, 30% existing)
          edge.attraction = clamp(affection * 0.7 + edge.attraction * 0.3, 0, 100)
          // Sync other USK values
          edge.dependency = clamp((char.relationship?.dependency ?? 30) * 0.5 + edge.dependency * 0.5, 0, 100)
          edge.jealousy = clamp((char.emotion?.jealousy ?? 5) * 0.5 + edge.jealousy * 0.5, 0, 100)
          edge.insecurity = clamp((100 - (char.relationship?.trust ?? 30)) * 0.5 + edge.insecurity * 0.5, 0, 100)
        }
      }
    }
  },

  /** Detect who interacted with whom this turn */
  _detectInteractions(uskState) {
    // Interactions come from:
    // 1. Player message → all characters present (player interacts with everyone)
    // 2. Agency Engine actions (character→character contact)
    // 3. Recent LLM output (who spoke to whom in the narrative)

    const playerName = this.characters.find(
      n => n !== Object.keys(this.edges).find(k => k.endsWith('->' + n))?.split('->')[0]
    )

    // Simple heuristic: if the player sent a message this turn, they interacted with all characters
    // (We know there was a turn because tick() was called)
    for (const name of this.characters) {
      // Player interacts with all characters present
      if (name !== playerName && uskState) {
        this.recentInteractions.push({ from: playerName, to: name, type: 'chat' })
      }
    }

    // Agency Engine interactions
    if (uskState?._agencyActions) {
      for (const action of uskState._agencyActions) {
        this.recentInteractions.push({
          from: action.actor,
          to: action.target,
          type: action.type || 'contact',
        })
      }
    }
  },

  /** Detect characters with multiple high-attraction edges (花心) */
  _detectMultiAttraction() {
    for (const name of this.characters) {
      const outgoing = Object.entries(this.edges)
        .filter(([key, edge]) => edge.from === name && edge.attraction > 50)
        .sort((a, b) => b[1].attraction - a[1].attraction)

      if (outgoing.length >= 2) {
        const targets = outgoing.map(([, e]) => e.to)
        this.pendingEvents.push({
          type: 'multi_attraction',
          from: name,
          hint: generatePhysicsEvent(
            { from: name, attraction: outgoing[0][1].attraction },
            'multi_attraction',
            { targets: targets.join('和') }
          ),
        })
      }
    }
  },

  /** Detect jealousy explosions — A's jealousy toward B is critically high */
  _detectJealousyExplosion() {
    for (const [key, edge] of Object.entries(this.edges)) {
      if (edge.jealousy > 70 && edge.attraction > 50) {
        this.pendingEvents.push({
          type: 'jealousy_explosion',
          from: edge.from,
          to: edge.to,
          hint: generatePhysicsEvent(edge, 'jealousy_explosion'),
        })
      }
    }
  },

  /** Detect highly asymmetric relationships */
  _detectAsymmetry() {
    for (const a of this.characters) {
      for (const b of this.characters) {
        if (a === b) continue
        const forward = this.edges[a + '->' + b]
        const backward = this.edges[b + '->' + a]
        if (!forward || !backward) continue

        const attractionGap = Math.abs(forward.attraction - backward.attraction)
        if (attractionGap > 30) {
          const moreInto = forward.attraction > backward.attraction ? a : b
          const lessInto = forward.attraction > backward.attraction ? b : a
          this.pendingEvents.push({
            type: 'asymmetric_attraction',
            from: moreInto,
            to: lessInto,
            hint: moreInto + '对' + lessInto + '的感情明显更深（差距' + Math.round(attractionGap) + '）——单向执念正在形成',
          })
        }
      }
    }
  },

  // ── Prompt Context Builder ────────────────────────

  /**
   * Build the relationship physics context block for prompt injection.
   * Gives the LLM a structured view of the relationship force field.
   */
  buildContext() {
    const lines = ['【关系力场——角色之间真实的关系动力学】', '']

    // ── Edge summary ──
    const playerName = this.characters.find(
      n => !this.edges[n + '->' + this.characters.find(c => c !== n)] // heuristic for finding non-player chars
    )
    // Simpler: list all non-trivial edges
    lines.push('━━━ 当前关系边 ━━━')

    let hasEdges = false
    for (const [key, edge] of Object.entries(this.edges)) {
      // Skip very weak edges
      if (edge.attraction < 20 && edge.tension < 20) continue
      hasEdges = true
      const phaseIcon = edge.phase === 'crisis' ? '🔴' :
                        edge.phase === 'rising_tension' ? '🟡' :
                        edge.phase === 'rupture' ? '💀' : '🟢'
      lines.push(
        phaseIcon + ' ' + edge.from + ' → ' + edge.to + '：' +
        '吸引力' + Math.round(edge.attraction) +
        ' 张力' + Math.round(edge.tension) +
        ' 嫉妒' + Math.round(edge.jealousy) +
        ' 依赖' + Math.round(edge.dependency) +
        ' 稳定' + Math.round(edge.stability) +
        ' [' + edge.phase + ']'
      )
    }

    if (!hasEdges) {
      lines.push('  （关系力场尚未形成——多互动几轮后开始演化）')
    }

    // ── Events this turn ──
    const uniqueEvents = this.pendingEvents.filter(
      (e, i, arr) => arr.findIndex(x => x.hint === e.hint) === i
    ).slice(0, 5) // Cap at 5 to avoid overwhelming the prompt

    if (uniqueEvents.length > 0) {
      lines.push('')
      lines.push('━━━ 本轮关系事件（正在发生——织入叙事）━━━')
      for (const evt of uniqueEvents) {
        lines.push('· ' + evt.hint)
      }
    }

    // ── Asymmetries ──
    const asymmetries = []
    for (const a of this.characters) {
      for (const b of this.characters) {
        if (a === b) continue
        const fwd = this.edges[a + '->' + b]
        const bwd = this.edges[b + '->' + a]
        if (!fwd || !bwd) continue
        const gap = Math.abs(fwd.attraction - bwd.attraction)
        if (gap > 25) {
          asymmetries.push({
            more: fwd.attraction > bwd.attraction ? a : b,
            less: fwd.attraction > bwd.attraction ? b : a,
            gap: Math.round(gap),
          })
        }
      }
    }

    if (asymmetries.length > 0) {
      lines.push('')
      lines.push('━━━ ⚠️ 非对称关系（单向执念/误解根源）━━━')
      for (const asym of asymmetries.slice(0, 3)) {
        lines.push('· ' + asym.more + ' 对 ' + asym.less + ' 的感情明显更深（差距' + asym.gap + '）')
      }
      lines.push('· 这些非对称是剧情张力的核心来源——不要消解它们')
    }

    // ── Multi-attraction (花心) ──
    const multiAttractions = this.pendingEvents.filter(e => e.type === 'multi_attraction')
    if (multiAttractions.length > 0) {
      lines.push('')
      lines.push('━━━ 🔥 多线吸引（花心/修罗场驱动）━━━')
      for (const evt of multiAttractions) {
        lines.push('· ' + evt.hint)
      }
      lines.push('· 以上多线关系是剧情张力的燃料——角色在这些线之间的拉扯本身就是故事')
    }

    lines.push('')
    lines.push('━━━ ARSL 铁律 ━━━')
    lines.push('· 关系不是数值——是力场。每个角色对每个其他角色有不同的吸引力和张力。')
    lines.push('· 角色不需要"决定"喜欢谁——力场推着他们做出自己也解释不了的事。')
    lines.push('· 高张力不能在本轮被化解——暂停可以，消散不行。')
    lines.push('· 非对称关系是叙事的核心动力——不要"对称化"，让单向执念烧。')

    return lines.join('\n')
  },

  // ── State Access ──────────────────────────────────

  /**
   * Get the full edge state (for debugging).
   */
  getEdges() {
    return { ...this.edges }
  },

  /**
   * Manually apply a relationship event (e.g., from LLM judge or player action).
   */
  applyEvent(from, to, impact = {}) {
    const key = from + '->' + to
    const edge = this.edges[key]
    if (!edge) return

    if (impact.attraction != null) edge.attraction = clamp(edge.attraction + impact.attraction, 0, 100)
    if (impact.tension != null) edge.tension = clamp(edge.tension + impact.tension, 0, 100)
    if (impact.jealousy != null) edge.jealousy = clamp(edge.jealousy + impact.jealousy, 0, 100)
    if (impact.dependency != null) edge.dependency = clamp(edge.dependency + impact.dependency, 0, 100)
    if (impact.insecurity != null) edge.insecurity = clamp(edge.insecurity + impact.insecurity, 0, 100)
    if (impact.trust != null) edge.insecurity = clamp(100 - impact.trust, 0, 100) // trust → inverse insecurity
    if (impact.stability != null) edge.stability = clamp(edge.stability + impact.stability, 0, 100)

    // Recalculate tension
    edge.tension = clamp(Math.round(
      edge.attraction * 0.3 + edge.jealousy * 0.35 +
      edge.insecurity * 0.25 + edge.dominance * 0.1
    ), 0, 100)
  },

  /**
   * Apply player interaction boost to all character→player edges.
   */
  applyPlayerInteraction(playerName) {
    for (const [key, edge] of Object.entries(this.edges)) {
      if (edge.to === playerName) {
        edge.attraction = clamp(edge.attraction + 1, 0, 100)
        edge.interactionCount++
        edge.lastInteractionTurn = this.turnCount
        edge.stability = clamp(edge.stability + 1, 0, 100)
      }
    }
  },
}
