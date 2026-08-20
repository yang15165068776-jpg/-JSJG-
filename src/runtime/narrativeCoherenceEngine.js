/**
 * NCE — Narrative Coherence Engine v1
 *
 * Position: After LLM generation, before RQA audit.
 *
 * NCE tracks physical state per character to prevent continuity errors
 * like "coat already off → unbuttoning again" or "standing at window →
 * suddenly entering from door."
 *
 * Zero extra LLM calls — pure state machine:
 *   1. Prompt injection: current physical state as hard constraints
 *   2. Hidden marker: LLM appends <!--NCE:...--> at end of reply
 *   3. Post-processing: regex-extract → update state → strip marker
 *   4. Persistence: localStorage per save, same tier as CPS/PowerGraph
 *
 * Architecture:
 *   Input → NCE Constraint Block (prompt) → LLM → NCE Extract → State Update → Output
 */

// ═══════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════

const STORAGE_PREFIX = 'nce_state_'
const STALE_TURN_THRESHOLD = 5  // Fields not updated for 5+ turns → stale

const TRACKED_FIELDS = ['position', 'posture', 'clothes', 'holding', 'contact', 'scene']

// Human-readable labels for prompt injection
const FIELD_LABELS = {
  position: '位置',
  posture: '姿态',
  clothes: '衣着',
  holding: '手持',
  contact: '接触',
  scene: '场景',
}

// ═══════════════════════════════════════════════════════════
// 1. State Management
// ═══════════════════════════════════════════════════════════

/**
 * Create a fresh NCE state object.
 * @returns {object} { characters: {} }
 */
export function createNCEState() {
  return { characters: {} }
}

/**
 * Initialize or get the default state for a character.
 * @param {object} nceState
 * @param {string} charName
 * @returns {object} character's NCE state slice
 */
function _ensureChar(nceState, charName) {
  if (!nceState.characters[charName]) {
    nceState.characters[charName] = { _lastTurn: 0 }
  }
  return nceState.characters[charName]
}

// ═══════════════════════════════════════════════════════════
// 2. Prompt Constraint Builder
// ═══════════════════════════════════════════════════════════

/**
 * Build the NCE physical state constraint block for prompt injection.
 * Injected as a system message for hard continuity enforcement.
 *
 * @param {object} nceState — current NCE state
 * @param {Array} rcList — romanceCharacters array
 * @param {number} currentTurn — current turn index (for staleness check)
 * @returns {string} constraint block, or '' if no state to inject
 */
export function buildNCEConstraintBlock(nceState, rcList, currentTurn = 0) {
  if (!nceState?.characters || !rcList?.length) return ''

  const lines = ['━━━ 📐 NCE · 物理状态硬约束（违反即连续性错误）━━━']

  let hasState = false
  for (const rc of rcList) {
    const name = rc.name
    const cs = nceState.characters[name]
    if (!cs) continue

    const parts = []
    for (const field of TRACKED_FIELDS) {
      const val = cs[field]
      if (val == null || val === '') continue
      // Check staleness
      if (cs._lastTurn && currentTurn - cs._lastTurn > STALE_TURN_THRESHOLD) continue
      parts.push(FIELD_LABELS[field] + '：' + val)
    }

    if (parts.length > 0) {
      hasState = true
      lines.push(`【${name}】${parts.join(' | ')}`)
    }
  }

  if (!hasState) return ''

  lines.push('角色必须从上述物理状态出发。场景未切换则禁止改变位置。衣着状态不可回退。')
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━')

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// 3. Extraction & Parsing
// ═══════════════════════════════════════════════════════════

const NCE_MARKER_REGEX = /<!--NCE:(.*?)-->/g

/**
 * Extract NCE state updates from LLM reply and strip markers.
 *
 * Marker format (one marker covering all characters):
 *   <!--NCE:言默:position=leaning_window|clothes=coat_off 沈砚:holding=phone-->
 *
 * Special marker:
 *   <!--NCE:nochange--> — no physical state change this turn
 *
 * @param {string} reply — raw LLM output
 * @returns {{ cleanReply: string, updates: object|null }}
 *   updates = { charName: { field: value, ... }, ... } or null if no marker found
 */
export function extractNCEUpdate(reply) {
  if (!reply) return { cleanReply: reply, updates: null }

  const markers = []
  let match
  NCE_MARKER_REGEX.lastIndex = 0
  while ((match = NCE_MARKER_REGEX.exec(reply)) !== null) {
    markers.push({ full: match[0], content: match[1].trim(), index: match.index })
  }

  if (markers.length === 0) return { cleanReply: reply, updates: null }

  // Strip all markers from the reply
  let cleanReply = reply
  for (const m of markers) {
    cleanReply = cleanReply.replace(m.full, '')
  }
  // Clean up trailing whitespace / empty lines left by marker removal
  cleanReply = cleanReply.replace(/\n\s*\n\s*$/, '\n').trimEnd()

  // Parse markers
  const updates = {}
  for (const m of markers) {
    const content = m.content
    if (content === 'nochange') continue

    // Split by character: "言默:field=val|field=val 沈砚:field=val"
    // Character name is everything before the first ':field=' pattern
    const charSegments = content.split(/\s+(?=\S+?:)/)
    for (const seg of charSegments) {
      const colonIdx = seg.indexOf(':')
      if (colonIdx === -1) continue
      const charName = seg.slice(0, colonIdx).trim()
      const fieldsStr = seg.slice(colonIdx + 1).trim()
      if (!charName || !fieldsStr) continue

      const charUpdates = {}
      const pairs = fieldsStr.split('|')
      for (const pair of pairs) {
        const eqIdx = pair.indexOf('=')
        if (eqIdx === -1) continue
        const key = pair.slice(0, eqIdx).trim()
        const val = pair.slice(eqIdx + 1).trim()
        if (TRACKED_FIELDS.includes(key) && val) {
          charUpdates[key] = val
        }
      }

      if (Object.keys(charUpdates).length > 0) {
        updates[charName] = charUpdates
      }
    }
  }

  return {
    cleanReply,
    updates: Object.keys(updates).length > 0 ? updates : null,
  }
}

// ═══════════════════════════════════════════════════════════
// 4. State Update
// ═══════════════════════════════════════════════════════════

/**
 * Apply extracted updates to NCE state (delta merge).
 * Only overwrites fields that are present in the update; preserves unmentioned fields.
 *
 * @param {object} nceState — current NCE state (mutated in place)
 * @param {object} updates — { charName: { field: value, ... } }
 * @param {number} currentTurn — current turn index
 * @returns {object} the mutated nceState
 */
export function applyNCEUpdate(nceState, updates, currentTurn = 0) {
  if (!updates || !nceState) return nceState

  for (const [charName, fields] of Object.entries(updates)) {
    const cs = _ensureChar(nceState, charName)
    for (const [key, val] of Object.entries(fields)) {
      if (val != null && val !== '') {
        cs[key] = val
      }
    }
    cs._lastTurn = currentTurn
  }

  return nceState
}

// ═══════════════════════════════════════════════════════════
// 5. Persistence (localStorage)
// ═══════════════════════════════════════════════════════════

/**
 * Build the storage key for a character + save combination.
 */
function _storageKey(characterId, saveId) {
  const sid = saveId || 'default'
  return STORAGE_PREFIX + characterId + '_' + sid
}

/**
 * Load NCE state from localStorage.
 *
 * @param {string} characterId
 * @param {string} saveId
 * @returns {object|null} parsed NCE state, or null if not found
 */
export function loadNCEState(characterId, saveId) {
  try {
    const raw = localStorage.getItem(_storageKey(characterId, saveId))
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        return parsed
      }
    }
  } catch (e) {
    console.warn('[NCE] Failed to load state:', e.message)
  }
  return null
}

/**
 * Save NCE state to localStorage.
 *
 * @param {string} characterId
 * @param {string} saveId
 * @param {object} nceState
 */
export function saveNCEState(characterId, saveId, nceState) {
  try {
    const key = _storageKey(characterId, saveId)
    // Prune characters with no tracked fields before saving
    const pruned = { characters: {} }
    for (const [name, cs] of Object.entries(nceState.characters || {})) {
      const tracked = {}
      let hasFields = false
      for (const field of TRACKED_FIELDS) {
        if (cs[field] != null && cs[field] !== '') {
          tracked[field] = cs[field]
          hasFields = true
        }
      }
      if (hasFields) {
        tracked._lastTurn = cs._lastTurn ?? 0
        pruned.characters[name] = tracked
      }
    }
    localStorage.setItem(key, JSON.stringify(pruned))
  } catch (e) {
    console.warn('[NCE] Failed to save state:', e.message)
  }
}
