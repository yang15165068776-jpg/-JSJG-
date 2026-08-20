/**
 * Shared State Kernel — Unified Relationship State (Dual-Mode Single Persona v1)
 *
 * Wraps the existing MemoryGraph to provide a clean API for reading/writing
 * relationship state (affection, trust, tension, dominance) across modes.
 *
 * The MemoryGraph already uses character-based storage keys
 * (jsjg_memory_graph_<characterId>), making it the natural single source of truth.
 * This module adds helper functions and migration logic on top.
 *
 * Core principles:
 *   ❗ State cannot be reset by mode change
 *   ❗ State must persist across modes
 *   ❗ Single source of truth — no duplicate affection copies
 */

import { loadGraph, saveGraph, initGraphFromCharacter, createMemoryGraph } from '../memory/memoryGraph'
import { getArchive } from '../utils/storage'

const STORAGE_PREFIX = 'jsjg_shared_state_'

// ═══════════════════════════════════════════════════════════
// Load / Save
// ═══════════════════════════════════════════════════════════

/**
 * Load or create shared state for a character.
 * Falls back to MemoryGraph load, then to archive migration, then to fresh init.
 *
 * @param {string} characterId
 * @param {object} persona — UnifiedPersona (for initialization)
 * @param {object} options — { archiveId, mode } for migration
 * @returns {object} sharedState (MemoryGraph-shaped)
 */
export function loadSharedState(characterId, persona, options = {}) {
  // 1. Try loading MemoryGraph (already character-keyed)
  let state = loadGraph(characterId)

  // 2. If no graph, try initializing from persona
  if (!state || !state.edges || Object.keys(state.edges).length === 0) {
    if (persona) {
      state = initGraphFromPersona(persona)
      saveGraph(characterId, state)
    } else {
      state = createMemoryGraph()
    }
  }

  // 3. Migration from archive if needed
  if (options.archiveId && options.mode) {
    state = migrateFromArchive(state, options.archiveId, options.mode, characterId, persona)
  }

  return state
}

/**
 * Initialize a MemoryGraph from a UnifiedPersona.
 * Creates edges for all persona characters.
 */
export function initGraphFromPersona(persona) {
  if (!persona) return createMemoryGraph()

  const graph = createMemoryGraph()

  // Create edges for each romance character
  for (const char of persona.characters) {
    if (char.type !== 'romance') continue

    const edgeKey = 'user_' + char.name
    graph.edges[edgeKey] = {
      affection: char.affectionInitial ?? 50,
      tension: 50,
      trust: 30,
      dominance: 50,
      lastUpdated: Date.now(),
    }
  }

  graph.global = {
    sceneLocation: persona.worldSetting || '',
    sceneMood: '',
    presentCharacters: persona.characters.map(c => c.name),
    flags: [],
  }

  if (!graph._migrationFlags) graph._migrationFlags = {}
  graph._migrationFlags.initializedFromPersona = true
  graph._migrationFlags.initializedAt = Date.now()

  return graph
}

/**
 * Persist shared state to localStorage.
 */
export function saveSharedState(characterId, state) {
  if (!characterId || !state) return false
  return saveGraph(characterId, state)
}

// ═══════════════════════════════════════════════════════════
// Affection API (mode-agnostic)
// ═══════════════════════════════════════════════════════════

/**
 * Get affection value for a specific character.
 * @returns {number} 0-100
 */
export function getAffection(state, characterName) {
  if (!state || !characterName) return 50
  const edgeKey = 'user_' + characterName
  if (state.edges[edgeKey]) {
    return clampAffection(state.edges[edgeKey].affection ?? 50)
  }
  return 50
}

/**
 * Set affection value for a specific character.
 * @returns {object} updated state (mutated in place)
 */
export function setAffection(state, characterName, value) {
  if (!state || !characterName) return state
  const edgeKey = 'user_' + characterName
  if (!state.edges[edgeKey]) {
    state.edges[edgeKey] = { affection: 50, tension: 50, trust: 30, dominance: 50 }
  }
  state.edges[edgeKey].affection = clampAffection(value)
  state.edges[edgeKey].lastUpdated = Date.now()
  state.updatedAt = Date.now()
  return state
}

/**
 * Apply a delta to affection. Returns the new value.
 * @param {object} state
 * @param {string} characterName
 * @param {number} delta
 * @param {object} personaChar — for stage range clamping
 * @returns {number} new value
 */
export function adjustAffection(state, characterName, delta, personaChar) {
  const current = getAffection(state, characterName)
  const stages = personaChar?.affectionStages
  let newValue = current + delta

  // Clamp to stage range if available, otherwise 0-100
  if (stages && stages.length > 0) {
    const mins = stages.map(s => s.min != null ? Number(s.min) : 0)
    const maxs = stages.map(s => s.max != null ? Number(s.max) : 100)
    newValue = Math.min(Math.max(...maxs), Math.max(Math.min(...mins), newValue))
  } else {
    newValue = Math.min(100, Math.max(0, newValue))
  }

  setAffection(state, characterName, newValue)
  return newValue
}

/**
 * Get all relationship states as a simple map.
 * @returns {object} { characterName: { affection, trust, tension, dominance } }
 */
export function getAllRelationships(state) {
  if (!state || !state.edges) return {}
  const result = {}
  for (const [key, edge] of Object.entries(state.edges)) {
    if (!key.startsWith('user_')) continue
    const name = key.replace('user_', '')
    result[name] = {
      affection: edge.affection ?? 50,
      trust: edge.trust ?? 30,
      tension: edge.tension ?? 50,
      dominance: edge.dominance ?? 50,
    }
  }
  return result
}

/**
 * Get relationship state for a single character.
 */
export function getRelationship(state, characterName) {
  const all = getAllRelationships(state)
  return all[characterName] || { affection: 50, trust: 30, tension: 50, dominance: 50 }
}

/**
 * Get the primary affection value (first romance character with affection enabled).
 * Used by Mode Translator.
 */
export function getPrimaryAffection(state, persona) {
  if (!persona) return 50
  const romances = persona.characters.filter(c => c.type === 'romance' && c.affectionEnabled)
  if (romances.length === 0) return 50
  return getAffection(state, romances[0].name)
}

// ═══════════════════════════════════════════════════════════
// Migration (archive → shared state)
// ═══════════════════════════════════════════════════════════

/**
 * Migrate affection values from archive to shared state.
 * One-time migration per archive. Idempotent.
 *
 * @param {object} state — current shared state
 * @param {string} archiveId
 * @param {string} mode — 'daily' | 'story'
 * @param {string} characterId
 * @param {object} persona
 * @returns {object} state (may be mutated)
 */
export function migrateFromArchive(state, archiveId, mode, characterId, persona) {
  if (!state || !archiveId) return state

  // Check if already migrated
  if (state._migrationFlags?.archiveAffectionsMigrated) return state

  try {
    const archive = getArchive(archiveId, mode)
    if (!archive) return state

    // Daily mode: archive.affection → single persona character
    if (mode === 'daily' && archive.affection != null) {
      const mainChar = persona?.characters?.find(c => c.type === 'romance')
      if (mainChar) {
        setAffection(state, mainChar.name, archive.affection)
      }
    }

    // Story mode: archive.affections → persona characters
    if (mode === 'story' && archive.affections) {
      for (const [name, value] of Object.entries(archive.affections)) {
        if (value != null) {
          setAffection(state, name, value)
        }
      }
    }

    // Mark migrated
    if (!state._migrationFlags) state._migrationFlags = {}
    state._migrationFlags.archiveAffectionsMigrated = true
    state._migrationFlags.migratedFrom = mode
    state._migrationFlags.migratedAt = Date.now()

    saveSharedState(characterId, state)
    console.log('[SharedState] Migrated affection from', mode, 'archive:', archiveId)
  } catch (e) {
    console.warn('[SharedState] Migration failed:', e)
  }

  return state
}

/**
 * Check if shared state is initialized (has at least one edge).
 */
export function isStateInitialized(state) {
  return state && state.edges && Object.keys(state.edges).length > 0
}

// ═══════════════════════════════════════════════════════════
// Archive compatibility (write-only backward compat)
// ═══════════════════════════════════════════════════════════

/**
 * Produce a backward-compatible affection object for archive storage.
 * Kept as write-only shim — new code reads from shared state, not archive.
 *
 * @returns {{ affection: number|null, affections: object|null }}
 */
export function getArchiveAffectionSnapshot(state, persona) {
  if (!state || !persona) return { affection: null, affections: null }

  const romances = persona.characters.filter(c => c.type === 'romance')
  if (romances.length === 0) return { affection: null, affections: null }

  const affections = {}
  for (const char of romances) {
    affections[char.name] = getAffection(state, char.name)
  }

  return {
    affection: romances.length === 1 ? affections[romances[0].name] : null,
    affections: romances.length >= 1 ? affections : null,
  }
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function clampAffection(value) {
  if (value == null) return 50
  return Math.min(100, Math.max(0, Math.round(value)))
}
