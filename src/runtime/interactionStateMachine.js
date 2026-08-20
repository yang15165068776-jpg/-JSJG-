/**
 * ISM — Interaction State Machine v1
 *
 * Maintains 5 interaction state machines. Each can only transition
 * through defined states — no skipping, no regressing.
 *
 * Machines:
 *   Distance:    far → near → personal → intimate
 *   Touch:       idle → reach → touch → hold → embrace → kiss → ...
 *   Conversation: idle → greeting → smalltalk → personal → conflict → confession → resolution
 *   Conflict:    none → tension → argument → peak → cooling → resolution
 *   Dominance:   balanced → player_lead → character_lead → mutual
 *
 * Integration:
 *   ISM validates SSM updates. If SSM says touch=embrace, ISM checks that
 *   the previous touch state allowed that transition.
 *   ISM constraint block is injected into prompt to prevent illegal regressions.
 *
 * Zero extra LLM calls — pure state machine.
 */

// ═══════════════════════════════════════════════════════════
// State Machine Definitions
// ═══════════════════════════════════════════════════════════

const MACHINES = {
  distance: {
    states: ['far', 'near', 'personal', 'intimate'],
    transitions: {
      far: ['near'],
      near: ['far', 'personal'],
      personal: ['near', 'intimate'],
      intimate: ['personal'],  // Can step back but not jump to far
    },
    initial: 'far',
    label: '距离',
  },
  touch: {
    states: ['idle', 'reach', 'touch', 'hold', 'embrace', 'kiss', 'intimate'],
    transitions: {
      idle: ['reach'],
      reach: ['idle', 'touch'],
      touch: ['reach', 'hold'],
      hold: ['touch', 'embrace'],
      embrace: ['hold', 'kiss'],
      kiss: ['embrace', 'intimate'],
      intimate: ['kiss', 'embrace'],
    },
    initial: 'idle',
    label: '接触',
  },
  conversation: {
    states: ['idle', 'greeting', 'smalltalk', 'personal', 'conflict', 'confession', 'resolution'],
    transitions: {
      idle: ['greeting', 'smalltalk', 'personal'],
      greeting: ['idle', 'smalltalk'],
      smalltalk: ['greeting', 'personal', 'conflict'],
      personal: ['smalltalk', 'conflict', 'confession'],
      conflict: ['personal', 'confession', 'smalltalk'],
      confession: ['personal', 'conflict', 'resolution'],
      resolution: ['personal', 'conflict'],
    },
    initial: 'idle',
    label: '对话',
  },
  conflict: {
    states: ['none', 'tension', 'argument', 'peak', 'cooling', 'resolution'],
    transitions: {
      none: ['tension'],
      tension: ['none', 'argument'],
      argument: ['tension', 'peak'],
      peak: ['argument', 'cooling'],
      cooling: ['peak', 'resolution'],
      resolution: ['cooling', 'tension'],
    },
    initial: 'none',
    label: '冲突',
  },
  dominance: {
    states: ['balanced', 'player_lead', 'character_lead', 'mutual'],
    transitions: {
      balanced: ['player_lead', 'character_lead'],
      player_lead: ['balanced', 'character_lead', 'mutual'],
      character_lead: ['balanced', 'player_lead', 'mutual'],
      mutual: ['player_lead', 'character_lead'],
    },
    initial: 'balanced',
    label: '支配',
  },
}

const STORAGE_PREFIX = 'ism_state_'

// ═══════════════════════════════════════════════════════════
// 1. State Factory
// ═══════════════════════════════════════════════════════════

export function createISMState() {
  const state = { _turn: 0 }
  for (const [name, def] of Object.entries(MACHINES)) {
    state[name] = { current: def.initial, history: [def.initial], _locked: false }
  }
  return state
}

// ═══════════════════════════════════════════════════════════
// 2. State Transition
// ═══════════════════════════════════════════════════════════

/**
 * Attempt to transition a state machine to a new state.
 *
 * @param {object} ismState — ISM state (mutated in place)
 * @param {string} machine — machine name ('distance'|'touch'|'conversation'|'conflict'|'dominance')
 * @param {string} newState — target state
 * @returns {{ success: boolean, warning?: string }}
 */
export function transitionISM(ismState, machine, newState) {
  const def = MACHINES[machine]
  if (!def) return { success: false, warning: `Unknown machine: ${machine}` }
  if (!def.states.includes(newState)) return { success: false, warning: `Unknown state: ${newState} for ${machine}` }

  const ms = ismState[machine]
  if (!ms) return { success: false, warning: `Machine not initialized: ${machine}` }

  const current = ms.current
  const allowed = def.transitions[current] || []

  if (!allowed.includes(newState)) {
    console.warn(`[ISM] ⚠️ Illegal transition: ${machine} ${current}→${newState} (allowed: ${allowed.join(',')})`)
    return { success: false, warning: `${def.label}不可从"${current}"直接跳转到"${newState}"。允许的下一步：${allowed.join('、')}` }
  }

  ms.current = newState
  ms.history.push(newState)
  if (ms.history.length > 10) ms.history = ms.history.slice(-10)

  console.log(`[ISM] ${def.label}: ${current} → ${newState}`)
  return { success: true }
}

/**
 * Get the current state of a machine.
 */
export function getISMState(ismState, machine) {
  return ismState?.[machine]?.current || MACHINES[machine]?.initial || '?'
}

/**
 * Check if a transition would be valid (without applying it).
 */
export function canTransition(ismState, machine, newState) {
  const def = MACHINES[machine]
  if (!def) return false
  const current = ismState?.[machine]?.current || def.initial
  return (def.transitions[current] || []).includes(newState)
}

// ═══════════════════════════════════════════════════════════
// 3. Prompt Constraint Block
// ═══════════════════════════════════════════════════════════

export function buildISMConstraintBlock(ismState) {
  if (!ismState) return ''

  const lines = ['━━━ 🔗 ISM · 交互状态机（硬约束——禁止状态倒退）━━━']
  let hasContent = false

  for (const [name, def] of Object.entries(MACHINES)) {
    const ms = ismState[name]
    if (!ms) continue
    const current = ms.current
    const allowed = def.transitions[current] || []
    if (current === def.initial && !ms.history?.length) continue // Skip initial states

    lines.push(`${def.label}：当前="${current}"  →  只允许：${allowed.join(' / ')}`)
    hasContent = true
  }

  if (!hasContent) return ''

  lines.push('禁止跳回已过的状态。禁止跳过中间状态。进度只能通过允许的路径推进。')
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━')
  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// 4. SSM → ISM sync
// ═══════════════════════════════════════════════════════════

/**
 * Sync ISM state from SSM touch/distance events.
 * Called after SSM update. Detects touch/distance changes and auto-transitions ISM.
 *
 * @returns {string[]} warnings from failed transitions
 */
export function syncISMFromSSM(ismState, ssmState) {
  const warnings = []

  // Auto-detect touch state from SSM current_touch
  const touch = ssmState?.current_touch || {}
  if (touch.kiss || touch.intimate) {
    const r = transitionISM(ismState, 'touch', 'intimate')
    if (!r.success) warnings.push(r.warning)
  } else if (touch.embrace) {
    const r = transitionISM(ismState, 'touch', 'embrace')
    if (!r.success) warnings.push(r.warning)
  } else if (touch.hold || touch.holding_hand || touch.hold_hand) {
    const r = transitionISM(ismState, 'touch', 'hold')
    if (!r.success) warnings.push(r.warning)
  } else if (touch.touch || touch.hand_on || touch.hand) {
    const r = transitionISM(ismState, 'touch', 'touch')
    if (!r.success) warnings.push(r.warning)
  }

  // Auto-detect distance from SSM distance values
  const distances = Object.values(ssmState?.distance || {})
  if (distances.length > 0) {
    const minDist = Math.min(...distances.filter(d => typeof d === 'number'))
    let distState = 'far'
    if (minDist <= 0.3) distState = 'intimate'
    else if (minDist <= 0.8) distState = 'personal'
    else if (minDist <= 1.5) distState = 'near'
    const r = transitionISM(ismState, 'distance', distState)
    if (!r.success) warnings.push(r.warning)
  }

  return warnings
}

// ═══════════════════════════════════════════════════════════
// 5. Persistence
// ═══════════════════════════════════════════════════════════

function _storageKey(charId, saveId) {
  return STORAGE_PREFIX + charId + '_' + (saveId || 'default')
}

export function loadISMState(charId, saveId) {
  try {
    const raw = localStorage.getItem(_storageKey(charId, saveId))
    if (raw) return JSON.parse(raw)
  } catch (e) { console.warn('[ISM] Load failed:', e.message) }
  return null
}

export function saveISMState(charId, saveId, state) {
  try {
    // Prune history to last 3 entries per machine
    const pruned = { _turn: state._turn }
    for (const name of Object.keys(MACHINES)) {
      if (state[name]) {
        pruned[name] = {
          current: state[name].current,
          history: (state[name].history || []).slice(-3),
        }
      }
    }
    localStorage.setItem(_storageKey(charId, saveId), JSON.stringify(pruned))
  } catch (e) { console.warn('[ISM] Save failed:', e.message) }
}
