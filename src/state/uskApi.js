/**
 * USK API v1 — Unified State Kernel Access Layer
 *
 * ALL modes (DRAMA / DAILY / future) MUST access state through this API.
 * Direct USK object access is FORBIDDEN.
 *
 * API surface:
 *   read(charName)        → current state snapshot for one character
 *   write(event, charName) → apply event-driven state update + log to memory
 *   patch(delta, charName) → batch state changes (advanced: scene结算, time passage)
 *   get_snapshot()         → deep clone of entire USK (for UI, debug, AI context)
 *   log_event(event)       → append event to memory without state change
 *
 * Rules:
 *   1. All modes MUST use USK_API, never touch USK directly
 *   2. State changes MUST go through write() or patch()
 *   3. memory ONLY accepts event writes
 */

import {
  loadOrCreateUSK,
  saveUSK,
  saveFolderUSK,
  getRelationship,
  getEmotion,
  getTension,
  getLife,
  updateUSK,
  recordEvent,
  buildStateSnapshot,
  getRecentEvents,
  computeInitiativeScore,
  advanceLifeState,
  applyModeTransition,
} from './unifiedStateKernel'

// ═══════════════════════════════════════════════════════════
// USK_API — the ONLY way to touch state
// ═══════════════════════════════════════════════════════════

let _usk = null       // Internal USK instance — NEVER expose directly
let _persona = null    // Cached persona reference
let _folderId = null   // v6: folder ID when in folder mode

/**
 * Initialize the API with a persona. Loads or creates USK.
 * MUST be called once before any other API method.
 *
 * @param {object} persona — UnifiedPersona
 * @param {object} options — { mode: 'drama'|'daily' }
 * @returns {object} state snapshot (not the raw USK)
 */
export function init(persona, options = {}) {
  _persona = persona
  const characterId = persona?.id || persona?.name || 'unknown'
  _usk = loadOrCreateUSK(characterId, persona, options)
  return snapshot()
}

/**
 * Read current state for a character.
 * Returns a FLAT snapshot — not a reference to internal USK.
 *
 * @param {string} charName — character name, or omit for first romance character
 * @returns {{ relationship, emotion, tension, life, meta }}
 */
export function read(charName) {
  if (!_usk) return null

  const name = charName || _persona?.characters?.find(c => c.type === 'romance')?.name
  if (!name) return null

  const char = _usk.characters?.[name]
  if (!char) return null

  return {
    character: name,
    relationship: { ...char.relationship },
    emotion: { ...char.emotion },
    tension: { ...char.tension },
    life: { ...char.life },
    meta: {
      active_mode: _usk.meta?.active_mode || 'DRAMA',
      last_update: _usk.meta?.last_update || '',
      turn_count: _usk.global?.turnCount || 0,
    },
  }
}

/**
 * Write an event through the state engine.
 * This is the ONLY way to change state.
 *
 * @param {object} event — { type, summary, impact?, mode? }
 * @param {string} charName — affected character
 * @returns {object} updated state snapshot
 */
export function write(event, charName) {
  if (!_usk) return null

  const name = charName || _persona?.characters?.find(c => c.type === 'romance')?.name
  if (!name) return null

  // Route through the canonical event-driven updater
  updateUSK(event, _usk, name)

  // Log to memory
  recordEvent(_usk, {
    ...event,
    mode: event.mode || (_usk.meta?.active_mode === 'DAILY' ? 'daily' : 'drama'),
    actor: name,
  })

  // Persist
  persist()

  return read(name)
}

/**
 * Patch state with a delta object. Batch changes.
 * Used for scene结算, time passage, mode transitions.
 *
 * @param {object} delta — { relationship?: {}, emotion?: {}, tension?: {}, life?: {} }
 * @param {string} charName
 * @returns {object} updated state snapshot
 */
export function patch(delta, charName) {
  if (!_usk) return null

  const name = charName || _persona?.characters?.find(c => c.type === 'romance')?.name
  if (!name) return null

  const char = _usk.characters?.[name]
  if (!char) return null

  // Apply each layer
  if (delta.relationship) {
    for (const [key, val] of Object.entries(delta.relationship)) {
      char.relationship[key] = clamp(char.relationship[key] + val, 0, 100)
    }
  }
  if (delta.emotion) {
    for (const [key, val] of Object.entries(delta.emotion)) {
      char.emotion[key] = clamp(char.emotion[key] + val, 0, 100)
    }
  }
  if (delta.tension) {
    for (const [key, val] of Object.entries(delta.tension)) {
      char.tension[key] = clamp(char.tension[key] + val, 0, 100)
    }
  }
  if (delta.life) {
    for (const [key, val] of Object.entries(delta.life)) {
      char.life[key] = clamp(char.life[key] + val, 0, 100)
    }
  }

  _usk.updatedAt = Date.now()
  _usk.meta.last_update = new Date().toISOString()

  // Recompute initiative
  const score = computeInitiativeScore(_usk, name)
  char.life.initiative_score = score

  persist()
  return read(name)
}

/**
 * Get a deep snapshot of the entire USK.
 * For UI rendering, debugging, AI context.
 * Returns a CLONE — mutations do NOT affect the real USK.
 */
export function snapshot() {
  if (!_usk) return null
  try {
    return JSON.parse(JSON.stringify(_usk))
  } catch {
    return null
  }
}

/**
 * Log an event without state change.
 * For informational events (mode switch, system events).
 */
export function log_event(event) {
  if (!_usk) return
  recordEvent(_usk, {
    ...event,
    mode: event.mode || 'system',
  })
  persist()
}

/**
 * Reset mode metadata after mode switch.
 * Does NOT reset relationship state — only updates meta.active_mode.
 */
export function reset_mode_meta(newMode) {
  if (!_usk) return
  _usk.meta.active_mode = newMode === 'drama' ? 'DRAMA' : 'DAILY'
  _usk.meta.last_update = new Date().toISOString()
  persist()
}

// ═══════════════════════════════════════════════════════════
// Convenience: full turn cycle
// ═══════════════════════════════════════════════════════════

/**
 * Complete a full turn: advance life, decay emotions, update initiative.
 * Call once per turn, before any mode-specific logic.
 *
 * @param {string} charName
 * @param {number} minutesSinceLast — minutes since last interaction
 * @returns {object} updated state snapshot
 */
export function tick(charName, minutesSinceLast = 5) {
  if (!_usk) return null

  const name = charName || _persona?.characters?.find(c => c.type === 'romance')?.name
  if (!name) return null

  advanceLifeState(_usk, name, minutesSinceLast)
  const score = computeInitiativeScore(_usk, name)
  if (_usk.characters?.[name]?.life) {
    _usk.characters[name].life.initiative_score = score
  }
  _usk.global.turnCount = (_usk.global.turnCount || 0) + 1
  _usk.meta.last_update = new Date().toISOString()
  persist()

  return read(name)
}

/**
 * Switch mode without resetting state.
 * @param {string} toMode — 'drama' | 'daily'
 */
export function switchMode(toMode) {
  if (!_usk) return
  const fromMode = _usk.meta?.active_mode === 'DAILY' ? 'daily' : 'drama'
  applyModeTransition(_usk, fromMode, toMode)
  persist()
}

/**
 * Get the current persona (read-only).
 */
export function getPersona() {
  return _persona
}

/**
 * Get the raw USK reference. USE ONLY FOR COORDINATOR SYNC.
 * This is intentionally scary-looking to discourage casual use.
 */
export function _unsafe_getRawUSK() {
  return _usk
}

/**
 * v6: Set folder-scoped USK from StateBridge.
 * USE ONLY FROM StateBridge. Do NOT call from UI code.
 */
export function _unsafe_setFolderUSK(usk, folderId) {
  _usk = usk
  _folderId = folderId
  _persona = null
}

// ═══════════════════════════════════════════════════════════
// Prompt helpers
// ═══════════════════════════════════════════════════════════

/**
 * Get a prompt-ready state snapshot for the given mode.
 */
export function getPromptSnapshot(charName, mode) {
  if (!_usk) return ''
  const name = charName || _persona?.characters?.find(c => c.type === 'romance')?.name
  return buildStateSnapshot(_usk, name, mode)
}

/**
 * Get recent events for prompt injection.
 */
export function getPromptEvents(maxEvents = 10) {
  return getRecentEvents(_usk, maxEvents)
}

// ═══════════════════════════════════════════════════════════
// Internals
// ═══════════════════════════════════════════════════════════

function persist() {
  if (!_usk) return

  // v6: folder-scoped USK persistence (save-specific when available)
  if (_folderId) {
    const saveId = _usk.meta?.saveId || ''
    saveFolderUSK(_folderId, _usk, saveId)
    return
  }

  // Legacy: per-character USK persistence
  if (!_persona) return
  const id = _persona.id || _persona.name || 'unknown'
  saveUSK(id, _usk)
}

function clamp(val, min, max) {
  if (val == null || isNaN(val)) return min
  return Math.min(max, Math.max(min, Math.round(val)))
}
