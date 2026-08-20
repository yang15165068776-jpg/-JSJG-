/**
 * Autonomous Drama World Engine v1 (ADWE)
 *
 * Core principle:
 *   ❗ The world generates its own events. The player is a participant, not the engine.
 *
 * Old model:
 *   Player input → Character response
 *
 * New model:
 *   World (multi-source) → Spontaneous events → Player is one perturbation among many
 *
 * ADWE is the CONDUCTOR — it coordinates all sub-engines:
 *   USK → ARSL → AgencyEngine → DarkAction → Desire → Attention → EventGen
 *
 * Architecture:
 *   ┌─────────────────────────────────────────────┐
 *   │           World State Kernel                │
 *   │  time · tension · instability · phase       │
 *   └──────────────────┬──────────────────────────┘
 *                      ↓
 *   ┌─────────────────────────────────────────────┐
 *   │  ARSL (Relationship Physics)                │
 *   │  Agency Engine (Autonomous Actions)         │
 *   │  DarkAction Kernel (Cold Violence)          │
 *   │  Desire Kernel (Physical Push)              │
 *   └──────────────────┬──────────────────────────┘
 *                      ↓
 *   ┌─────────────────────────────────────────────┐
 *   │  Attention System (Scarce Resource)         │
 *   │  Event Generator (Probabilistic)            │
 *   └──────────────────┬──────────────────────────┘
 *                      ↓
 *   ┌─────────────────────────────────────────────┐
 *   │  Narrative Injector → Prompt                │
 *   └─────────────────────────────────────────────┘
 */

import { RelationshipPhysics } from './relationshipPhysics'
import { AgencyEngine } from './agencyEngine'
import { decideDarkActionLevel, trackLevel, getAntiAveragingOverride } from './darkActionKernel'
import { decideDesireLevel, trackDesireLevel, getDesireAntiAveragingOverride } from './desireKernel'

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

// ═══════════════════════════════════════════════════════════
// 1. World State Kernel
// ═══════════════════════════════════════════════════════════

function createWorldState() {
  return {
    time: 'day',              // day | night | dawn | dusk
    timePhase: 'afternoon',   // morning | afternoon | evening | midnight
    tension: 30,              // 0-100 global world tension
    instability: 30,          // 0-100 how unstable the world feels
    phase: 'setup',           // setup | rising | crisis | collapse | release
    activeEvents: [],         // Events visible to the narrative
    hiddenEvents: [],         // Events happening behind the scenes
    turnCount: 0,
    eventHistory: [],         // All past events (capped)
  }
}

// ═══════════════════════════════════════════════════════════
// 2. Attention System — attention is a SCARCE RESOURCE
// ═══════════════════════════════════════════════════════════

/**
 * Attention is not evenly distributed. Characters COMPETE for it.
 * The player is one node among many — attention flows between all nodes.
 *
 * Each turn, the attention system:
 *   1. Calculates who has attention (from player and from each other)
 *   2. Detects attention starvation → triggers compensatory behaviors
 *   3. Detects attention hoarding → triggers jealousy in others
 */
function allocateAttention(characters, arslEdges, playerName) {
  const attention = {}
  const totalAttention = 100 // Total attention "budget" per turn

  // Base attention: player gets 30% of total attention budget
  const playerShare = 30
  const remainingShare = totalAttention - playerShare

  // Remaining attention distributed by attraction weight
  let totalAttraction = 0
  const charAttraction = {}

  for (const name of characters) {
    if (name === playerName) continue
    // Sum of all attractions FROM this character TO others (including player)
    let sum = 0
    for (const [key, edge] of Object.entries(arslEdges)) {
      if (edge.from === name) sum += edge.attraction
    }
    charAttraction[name] = sum
    totalAttraction += sum
  }

  for (const name of characters) {
    if (name === playerName) {
      attention[name] = { share: playerShare, role: '玩家', starved: false }
      continue
    }

    const weight = totalAttraction > 0 ? charAttraction[name] / totalAttraction : 0
    const share = Math.round(remainingShare * weight)

    // Attention starvation: < 5% share → character feels ignored
    const starved = share < 5

    // Determine role
    let role = '参与者'
    if (share > 20) role = '注意力焦点'
    else if (starved) role = '被忽略——可能爆发情绪或采取极端行动'

    attention[name] = { share, role, starved }
  }

  return attention
}

// ═══════════════════════════════════════════════════════════
// 3. Probabilistic Event Generator
// ═══════════════════════════════════════════════════════════

const WORLD_EVENTS = {
  // ── High tension events ──
  conflict_spike: {
    condition: w => w.tension > 60 && Math.random() < 0.30,
    generate: w => ({
      type: 'conflict_spike',
      label: '冲突升级',
      narrative: '世界的张力已经压不住了——空气里全是火药味。下一句话可能就是导火索。',
      effect: { tension: +5, instability: +5 },
    }),
  },
  jealousy_chain: {
    condition: w => w.tension > 55 && Math.random() < 0.20,
    generate: w => ({
      type: 'jealousy_chain',
      label: '嫉妒连锁',
      narrative: '一个角色看了另一个角色一眼——那眼神里有不该有的东西。其他人注意到了。',
      effect: { tension: +3, instability: +3 },
    }),
  },
  hidden_meeting: {
    condition: w => w.tension > 50 && Math.random() < 0.20,
    generate: w => ({
      type: 'hidden_meeting',
      label: '私下接触',
      narrative: '有人看到不该看到的事——两个角色在没有人知道的情况下待在一起。',
      effect: { instability: +8 },
      hidden: true,
    }),
  },

  // ── Instability events ──
  information_error: {
    condition: w => w.instability > 50 && Math.random() < 0.25,
    generate: w => ({
      type: 'information_error',
      label: '信息误差',
      narrative: '一句话传了三个人就变了味道。角色A以为角色B说了什么——角色B根本没说过。',
      effect: { tension: +5, instability: +3 },
    }),
  },
  third_party_intrusion: {
    condition: w => w.instability > 55 && Math.random() < 0.20,
    generate: w => ({
      type: 'third_party_intrusion',
      label: '第三者介入',
      narrative: '一个不在当前场景中的角色突然出现/发消息/被提及——场上的平衡瞬间变了。',
      effect: { tension: +8, instability: +5 },
    }),
  },

  // ── Desire-cluster events ──
  desire_overflow: {
    condition: w => w.tension > 45 && w.instability > 40 && Math.random() < 0.25,
    generate: w => ({
      type: 'desire_overflow',
      label: '欲望溢出',
      narrative: '角色做了自己都解释不了的事——不是因为想了，是因为藏不住了。',
      effect: { tension: +5, instability: +3 },
    }),
  },
  cold_shoulder: {
    condition: w => Math.random() < 0.15,
    generate: w => ({
      type: 'cold_shoulder',
      label: '突然冷落',
      narrative: '一个角色突然不回复了——不是忙，是故意的。沉默比任何话都重。',
      effect: { tension: +3, instability: +5 },
    }),
  },

  // ── Attention-driven events ──
  attention_seek: {
    condition: w => w.instability > 45 && Math.random() < 0.20,
    generate: w => ({
      type: 'attention_seek',
      label: '注意力争夺',
      narrative: '两个角色在用不同的方式抢同一个人的注意力——一个在说话，一个在用沉默。两种都是武器。',
      effect: { tension: +4, instability: +3 },
    }),
  },

  // ── Low probability wildcard ──
  wildcard: {
    condition: () => Math.random() < 0.08,
    generate: () => ({
      type: 'wildcard',
      label: '意外事件',
      narrative: pick([
        '一条消息发错了人——撤回已经来不及了。对方已经看到了。',
        '有人推开了一扇不该推开的门——看到了不该看到的事。',
        '雨突然下大了——困在同一个屋檐下的两个人之间，空气变得黏稠。',
        '停电了。黑暗里只剩下呼吸声和手机屏幕的光——两个人的距离比平时近了。',
      ]),
      effect: { tension: +2, instability: +3 },
    }),
  },
}

function generateWorldEvents(worldState) {
  const events = []

  for (const [name, evtDef] of Object.entries(WORLD_EVENTS)) {
    if (evtDef.condition(worldState)) {
      const evt = evtDef.generate(worldState)
      events.push(evt)

      // Apply effects
      if (evt.effect) {
        worldState.tension = clamp(worldState.tension + (evt.effect.tension || 0), 0, 100)
        worldState.instability = clamp(worldState.instability + (evt.effect.instability || 0), 0, 100)
      }

      // Cap at 3 events per tick
      if (events.length >= 3) break
    }
  }

  return events
}

// ═══════════════════════════════════════════════════════════
// 4. World Phase Evolution
// ═══════════════════════════════════════════════════════════

const PHASE_ORDER = ['setup', 'rising', 'crisis', 'collapse', 'release']

function evolveWorldPhase(worldState) {
  const idx = PHASE_ORDER.indexOf(worldState.phase)

  // Phase transition conditions
  if (worldState.phase === 'setup' && worldState.tension > 40 && worldState.turnCount > 2) {
    worldState.phase = 'rising'
  } else if (worldState.phase === 'rising' && worldState.tension > 65 && worldState.instability > 50) {
    worldState.phase = 'crisis'
  } else if (worldState.phase === 'crisis' && worldState.tension > 85 && worldState.turnCount % 3 === 0) {
    worldState.phase = 'collapse'
  } else if (worldState.phase === 'collapse' && worldState.turnCount % 5 === 0) {
    worldState.phase = 'release'
  } else if (worldState.phase === 'release' && worldState.tension < 50) {
    worldState.phase = 'rising' // Cyclic — release never lasts
  }

  return worldState.phase
}

// ═══════════════════════════════════════════════════════════
// 5. Main Engine API — the Conductor
// ═══════════════════════════════════════════════════════════

export const AutonomousWorldEngine = {

  /** @type {object} world state */
  world: null,

  /** @type {object} attention map */
  attention: {},

  /** @type {object[]} events generated this turn */
  turnEvents: [],

  /** @type {string[]} character names */
  characters: [],

  /** @type {string} player name */
  playerName: '',

  /** @type {object} cached character for sub-engine calls */
  _character: null,

  // ── Init ──────────────────────────────────────────

  /**
   * Initialize the autonomous world.
   * Sets up all sub-engines and world state.
   */
  init(character, affections = {}) {
    this.world = createWorldState()
    this.attention = {}
    this.turnEvents = []
    this._character = character

    // Extract character names
    const rcList = character.romanceCharacters || []
    this.characters = rcList.map(rc => rc.name).filter(Boolean)
    this.playerName = character._playerProfile?.name || '玩家'
    if (this.playerName && this.playerName !== '玩家' && this.playerName !== '新玩家') {
      this.characters.push(this.playerName)
    }

    // Init sub-engines
    RelationshipPhysics.init(character, affections)
    AgencyEngine.init(character, null)

    // Seed initial world tension from USK if available
    const maxTension = Math.max(...Object.values(affections).map(v => Math.abs(v - 50)), 0)
    this.world.tension = clamp(30 + maxTension * 0.3, 0, 100)
  },

  reset() {
    this.world = null
    this.attention = {}
    this.turnEvents = []
    this.characters = []
    this.playerName = ''
    this._character = null
    RelationshipPhysics.reset()
    AgencyEngine.reset()
  },

  // ── Tick — the main world cycle ───────────────────

  /**
   * Advance the world by one turn.
   * This is THE canonical turn cycle. All other engines tick inside here.
   *
   * @param {object} uskState — raw USK state
   * @param {string} playerInput — current player input text
   * @returns {object} world snapshot { tension, instability, phase, events, attention }
   */
  tick(uskState, playerInput = '') {
    if (!this.world) return null

    this.world.turnCount++
    this.turnEvents = []

    // ═══════════════════════════════════════════════════
    // Step 1: Evolve world time phase
    // ═══════════════════════════════════════════════════
    const hourOfDay = new Date().getHours()
    if (hourOfDay < 6) this.world.time = 'dawn'
    else if (hourOfDay < 12) this.world.time = 'morning-related...'
    // (Simplified — time tracking is complex; keeping it basic for v1)

    // ═══════════════════════════════════════════════════
    // Step 2: ARSL — relationship physics tick
    // ═══════════════════════════════════════════════════
    RelationshipPhysics.applyPlayerInteraction(this.playerName)
    const arslEvents = RelationshipPhysics.tick(uskState)
    for (const evt of arslEvents) {
      this.turnEvents.push({ source: 'ARSL', ...evt })
    }

    // ═══════════════════════════════════════════════════
    // Step 3: Agency Engine — autonomous character actions
    // ═══════════════════════════════════════════════════
    AgencyEngine.syncFromUSK(uskState)
    const agencyHint = AgencyEngine.check(this._character, uskState)
    if (agencyHint) {
      this.turnEvents.push({ source: 'Agency', ...agencyHint })
    }

    // ═══════════════════════════════════════════════════
    // Step 4: Attention System
    // ═══════════════════════════════════════════════════
    this.attention = allocateAttention(this.characters, RelationshipPhysics.edges, this.playerName)

    // Attention starvation → extra tension + possible events
    for (const [name, attn] of Object.entries(this.attention)) {
      if (attn.starved && name !== this.playerName) {
        this.world.tension = clamp(this.world.tension + 2, 0, 100)
        this.world.instability = clamp(this.world.instability + 2, 0, 100)
        this.turnEvents.push({
          source: 'Attention',
          type: 'attention_starvation',
          hint: name + '感到被忽视——这种被忽略的感觉正在累积，随时可能以某种方式爆发',
        })
      }
    }

    // ═══════════════════════════════════════════════════
    // Step 5: Probabilistic event generation
    // ═══════════════════════════════════════════════════
    const worldEvents = generateWorldEvents(this.world)
    for (const evt of worldEvents) {
      if (evt.hidden) {
        this.world.hiddenEvents.push(evt)
      } else {
        this.world.activeEvents.push(evt)
      }
      this.turnEvents.push({ source: 'World', ...evt })
    }

    // Cap event history
    if (this.world.activeEvents.length > 20) {
      this.world.activeEvents = this.world.activeEvents.slice(-20)
    }
    if (this.world.hiddenEvents.length > 20) {
      this.world.hiddenEvents = this.world.hiddenEvents.slice(-20)
    }

    // Record in event history
    for (const evt of this.turnEvents) {
      this.world.eventHistory.push({
        turn: this.world.turnCount,
        type: evt.type || evt.source,
        summary: evt.hint || evt.narrative || evt.label || '',
        timestamp: Date.now(),
      })
    }
    if (this.world.eventHistory.length > 100) {
      this.world.eventHistory = this.world.eventHistory.slice(-100)
    }

    // ═══════════════════════════════════════════════════
    // Step 6: Evolve world phase
    // ═══════════════════════════════════════════════════
    evolveWorldPhase(this.world)

    // ═══════════════════════════════════════════════════
    // Step 7: Natural tension decay (world doesn't stay at max forever)
    // ═══════════════════════════════════════════════════
    this.world.tension = clamp(this.world.tension - 1, 0, 100)
    this.world.instability = clamp(this.world.instability - 0.5, 0, 100)

    // Top up based on active/hidden events
    if (this.world.hiddenEvents.length > 3) {
      this.world.instability = clamp(this.world.instability + 3, 0, 100)
    }

    return {
      tension: this.world.tension,
      instability: this.world.instability,
      phase: this.world.phase,
      events: [...this.turnEvents],
      attention: { ...this.attention },
    }
  },

  // ── Narrative Context Builder ─────────────────────

  /**
   * Build the unified world narrative context for prompt injection.
   * This is THE single context block that replaces individual engine contexts.
   */
  buildNarrativeContext() {
    if (!this.world) return ''

    const lines = ['【🌍 世界引擎】']

    // ── World state + attention (compact, one line each) ──
    lines.push('张力' + this.world.tension + ' 不稳' + this.world.instability + ' 阶段:' + this.world.phase)

    // Attention (compact)
    const attnEntries = Object.entries(this.attention)
    if (attnEntries.length > 0) {
      const parts = attnEntries.map(([n, a]) => {
        const icon = a.starved && n !== this.playerName ? '⚫' : ''
        return icon + n + ':' + a.share + '%'
      })
      lines.push('注意力: ' + parts.join(' '))
    }

    // ── ARSL edges (compact — only non-trivial edges) ──
    const arslEdges = RelationshipPhysics.edges
    const edgeLines = []
    for (const [key, edge] of Object.entries(arslEdges)) {
      if (edge.attraction < 25 && edge.tension < 25) continue
      const icon = edge.phase === 'crisis' ? '🔴' : edge.phase === 'rupture' ? '💀' : edge.phase === 'rising_tension' ? '🟡' : ''
      edgeLines.push(icon + edge.from + '→' + edge.to + ':吸' + Math.round(edge.attraction) + '张' + Math.round(edge.tension) + '嫉' + Math.round(edge.jealousy))
    }
    if (edgeLines.length > 0) {
      lines.push('关系力场: ' + edgeLines.join(' | '))
    }

    // ── Events (combined active + hidden, compact) ──
    const allEvents = [
      ...this.world.activeEvents.slice(-3),
      ...this.world.hiddenEvents.slice(-2),
    ]
    // Also include turn events from ARSL + Agency
    const recentHints = this.turnEvents
      .filter(e => e.hint)
      .slice(-3)
      .map(e => e.hint)

    if (recentHints.length > 0) {
      lines.push('事件: ' + recentHints.join(' | '))
    }

    // ── Agency context (compact — only if there are hints) ──
    const agencyCtx = AgencyEngine.buildContext()
    if (agencyCtx) {
      // Strip the verbose formatting, keep only the hint lines
      const hintLines = agencyCtx.split('\n').filter(l => l.startsWith('📡'))
      if (hintLines.length > 0) {
        lines.push('幕后: ' + hintLines.map(l => l.replace('📡 ', '').replace(/（行为类型.*$/, '')).join(' | '))
      }
    }

    // ── Phase directive (one line) ──
    const phaseDir = {
      setup: '酝酿冲突种子',
      rising: '推高张力，角色失耐心',
      crisis: '不可挽回的话即将说出',
      collapse: '对话碎片化，行为极端化',
      release: '裂痕还在，余波未平',
    }
    lines.push('→ ' + (phaseDir[this.world.phase] || ''))

    return lines.join('\n')
  },

  // ── State Access ──────────────────────────────────

  getWorldState() {
    return this.world ? { ...this.world } : null
  },

  getAttention() {
    return { ...this.attention }
  },

  getTurnEvents() {
    return [...this.turnEvents]
  },
}
