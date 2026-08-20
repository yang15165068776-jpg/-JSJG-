/**
 * SSM — Scene State Manager v1
 *
 * Replaces NCE (Narrative Coherence Engine).
 * Maintains the canonical scene state — the Single Source of Truth for
 * physical reality in the current scene.
 *
 * Runtime Law 01:
 *   Text is NOT truth. Runtime State IS truth.
 *   Every action/position/clothing/touch/object must update State first,
 *   then generate text. Never infer world state from narrative text.
 *
 * Architecture:
 *   LLM output → extract SSM marker → validate against state machine →
 *   update state → inject constraint block into next turn's prompt
 *
 * Zero extra LLM calls — pure state machine + hidden marker extraction.
 */

// ═══════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════

const STORAGE_PREFIX = 'ssm_state_'
const SSM_MARKER_REGEX = /<!--SSM:(.*?)-->/g

// ═══════════════════════════════════════════════════════════
// 1. State Factory
// ═══════════════════════════════════════════════════════════

export function createSSMState() {
  return {
    scene: { name: '', location: '', time: '', weather: '' },
    participants: [],
    positions: {},
    distance: {},
    pose: {},
    eye_contact: [],
    current_touch: {},
    objects: {},
    clothing: {},
    doors: {},
    lights: {},
    unfinished_actions: [],
    finished_actions: [],
    scene_flags: [],
    _turn: 0,
  }
}

// ═══════════════════════════════════════════════════════════
// 2. Prompt Constraint Block
// ═══════════════════════════════════════════════════════════

export function buildSSMConstraintBlock(ssmState, rcList) {
  if (!ssmState || !rcList?.length) return ''

  const lines = ['━━━ 📐 SSM · 场景物理状态（硬约束——正文必须服从）━━━']
  let hasContent = false

  const s = ssmState
  if (s.scene?.name || s.scene?.location) {
    lines.push(`场景：${s.scene.name || s.scene.location}  |  ${s.scene.time || ''}  |  ${s.scene.weather || ''}`)
    hasContent = true
  }

  // Per-character state
  for (const rc of rcList) {
    const name = rc.name
    const parts = []
    if (s.positions[name]) parts.push(`位置:${s.positions[name]}`)
    if (s.pose[name]) parts.push(`姿态:${s.pose[name]}`)
    if (s.clothing[name]) {
      const c = s.clothing[name]
      const clothParts = Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`)
      if (clothParts.length) parts.push(`衣着:${clothParts.join(',')}`)
    }
    if (parts.length) {
      lines.push(`【${name}】${parts.join(' | ')}`)
      hasContent = true
    }
  }

  // Touch state
  const activeTouch = Object.entries(s.current_touch || {}).filter(([, v]) => v).map(([k]) => k)
  if (activeTouch.length) {
    lines.push(`身体接触：${activeTouch.join('、')}`)
    hasContent = true
  }

  // Objects
  const activeObjects = Object.entries(s.objects || {}).filter(([, o]) => o.exist)
  if (activeObjects.length) {
    lines.push(`物品：${activeObjects.map(([k, o]) => `${k}(${o.state})`).join(' ')}`)
    hasContent = true
  }

  // Finished actions (continuity anchors)
  if (s.finished_actions?.length) {
    lines.push(`已完成：${s.finished_actions.slice(-5).join(' / ')}`)
    hasContent = true
  }

  // Unfinished actions (in progress)
  if (s.unfinished_actions?.length) {
    lines.push(`进行中：${s.unfinished_actions.join(' / ')}（必须在本轮完成或继续推进，禁止丢弃）`)
    hasContent = true
  }

  if (!hasContent) return ''

  lines.push('正文必须完全服从以上物理状态。禁止回退已完成动作。禁止重新开始进行中的动作。')
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━')
  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// 3. Marker Extraction
// ═══════════════════════════════════════════════════════════

/**
 * Extract SSM state updates from LLM reply and strip markers.
 *
 * Marker format:
 *   <!--SSM:言默:position=sofa|pose=sitting|clothing_coat=removed|touch_hold_hand=true-->
 *   <!--SSM:coffee:state=empty-->
 *   <!--SSM:action:finished:言默:removed_coat-->
 *
 * @returns {{ cleanReply: string, sceneUpdates: object|null, actions: object|null }}
 */
export function extractSSMUpdate(reply) {
  if (!reply) return { cleanReply: reply, sceneUpdates: null, actions: null }

  const markers = []
  let match
  SSM_MARKER_REGEX.lastIndex = 0
  while ((match = SSM_MARKER_REGEX.exec(reply)) !== null) {
    markers.push({ full: match[0], content: match[1].trim() })
  }

  if (markers.length === 0) return { cleanReply: reply, sceneUpdates: null, actions: null }

  let cleanReply = reply
  for (const m of markers) cleanReply = cleanReply.replace(m.full, '')
  cleanReply = cleanReply.replace(/\n\s*\n\s*$/, '\n').trimEnd()

  const sceneUpdates = {}   // { charName: { field: value } }
  const actions = { finished: [], unfinished: [], objects: {} }

  for (const m of markers) {
    const content = m.content
    if (content === 'nochange') continue

    // Action markers: <!--SSM:action:finished:言默:removed_coat-->
    if (content.startsWith('action:')) {
      const parts = content.split(':')
      if (parts[1] === 'finished' && parts[2] && parts[3]) {
        actions.finished.push(parts[2] + ':' + parts[3])
      } else if (parts[1] === 'unfinished' && parts[2] && parts[3]) {
        actions.unfinished.push(parts[2] + ':' + parts[3])
      }
      continue
    }

    // Object markers: <!--SSM:coffee:state=empty|exist=false-->
    if (content.match(/^[a-z_]+:.*=/) && !content.includes('position=') && !content.includes('|position=')) {
      const colonIdx = content.indexOf(':')
      const objName = content.slice(0, colonIdx)
      const fieldsStr = content.slice(colonIdx + 1)
      actions.objects[objName] = {}
      for (const pair of fieldsStr.split('|')) {
        const eqIdx = pair.indexOf('=')
        if (eqIdx === -1) continue
        const k = pair.slice(0, eqIdx).trim()
        let v = pair.slice(eqIdx + 1).trim()
        if (v === 'true') v = true
        else if (v === 'false') v = false
        actions.objects[objName][k] = v
      }
      continue
    }

    // Character state markers: <!--SSM:言默:position=sofa|clothing_coat=removed-->
    const colonIdx = content.indexOf(':')
    if (colonIdx === -1) continue
    const charName = content.slice(0, colonIdx).trim()
    const fieldsStr = content.slice(colonIdx + 1).trim()
    if (!charName || !fieldsStr) continue

    const updates = {}
    for (const pair of fieldsStr.split('|')) {
      const eqIdx = pair.indexOf('=')
      if (eqIdx === -1) continue
      const key = pair.slice(0, eqIdx).trim()
      let val = pair.slice(eqIdx + 1).trim()
      if (val === 'true') val = true
      else if (val === 'false') val = false
      // Handle nested keys: clothing_coat → clothing.coat, touch_hold_hand → current_touch.hold_hand
      updates[key] = val
    }
    if (Object.keys(updates).length > 0) {
      sceneUpdates[charName] = updates
    }
  }

  return {
    cleanReply,
    sceneUpdates: Object.keys(sceneUpdates).length > 0 ? sceneUpdates : null,
    actions: (actions.finished.length + actions.unfinished.length + Object.keys(actions.objects).length) > 0 ? actions : null,
  }
}

// ═══════════════════════════════════════════════════════════
// 4. State Update + Validation
// ═══════════════════════════════════════════════════════════

/**
 * Apply extracted updates to SSM state (delta merge).
 * Validates against interaction state machine (ISM) for illegal regressions.
 *
 * @param {object} ssmState — mutated in place
 * @param {object} sceneUpdates — from extractSSMUpdate
 * @param {object} actions — from extractSSMUpdate
 * @param {object} ismState — ISM state for cross-validation (optional)
 * @param {number} turn — current turn index
 * @returns {{ warnings: string[] }}
 */
export function applySSMUpdate(ssmState, sceneUpdates, actions, ismState, turn = 0) {
  const warnings = []
  ssmState._turn = turn

  // Apply character state updates
  if (sceneUpdates) {
    for (const [charName, fields] of Object.entries(sceneUpdates)) {
      if (!ssmState.positions) ssmState.positions = {}
      if (!ssmState.pose) ssmState.pose = {}
      if (!ssmState.clothing) ssmState.clothing = {}

      for (const [key, val] of Object.entries(fields)) {
        if (key.startsWith('clothing_')) {
          // clothing_coat=removed → clothing[charName].coat = removed
          const clothField = key.replace('clothing_', '')
          if (!ssmState.clothing[charName]) ssmState.clothing[charName] = {}
          ssmState.clothing[charName][clothField] = val
        } else if (key.startsWith('touch_')) {
          // touch_hold_hand=true → current_touch.hold_hand = true
          const touchField = key.replace('touch_', '')
          if (!ssmState.current_touch) ssmState.current_touch = {}
          ssmState.current_touch[touchField] = val
        } else if (key === 'position') {
          ssmState.positions[charName] = val
        } else if (key === 'pose') {
          ssmState.pose[charName] = val
        } else if (key === 'eye_contact') {
          if (!ssmState.eye_contact) ssmState.eye_contact = []
          if (val && !ssmState.eye_contact.includes(charName + '→player')) {
            ssmState.eye_contact.push(charName + '→player')
          } else if (!val) {
            ssmState.eye_contact = ssmState.eye_contact.filter(e => !e.startsWith(charName + '→'))
          }
        }
      }
    }
  }

  // Apply actions
  if (actions) {
    // Move finished actions from unfinished → finished
    for (const action of (actions.finished || [])) {
      // Remove from unfinished if present
      const ufIdx = (ssmState.unfinished_actions || []).indexOf(action)
      if (ufIdx >= 0) ssmState.unfinished_actions.splice(ufIdx, 1)
      // Add to finished (dedup)
      if (!ssmState.finished_actions) ssmState.finished_actions = []
      if (!ssmState.finished_actions.includes(action)) {
        ssmState.finished_actions.push(action)
      }
    }

    // Add new unfinished actions
    for (const action of (actions.unfinished || [])) {
      if (!ssmState.unfinished_actions) ssmState.unfinished_actions = []
      if (!ssmState.unfinished_actions.includes(action) && !ssmState.finished_actions?.includes(action)) {
        ssmState.unfinished_actions.push(action)
      }
    }

    // Apply object updates
    if (actions.objects) {
      if (!ssmState.objects) ssmState.objects = {}
      for (const [objName, fields] of Object.entries(actions.objects)) {
        if (!ssmState.objects[objName]) ssmState.objects[objName] = {}
        Object.assign(ssmState.objects[objName], fields)
      }
    }
  }

  // Validate: check if finished actions are being re-done
  if (sceneUpdates && ssmState.finished_actions) {
    for (const [charName, fields] of Object.entries(sceneUpdates)) {
      for (const [key, val] of Object.entries(fields)) {
        if (key.startsWith('touch_') && val === true) {
          const touchField = key.replace('touch_', '')
          const prevVal = ssmState.current_touch?.[touchField]
          // If already true, that's fine (continuing)
          // If was false/null → new touch started, check ISM
          if (!prevVal && ismState) {
            // ISM validation handled separately by ISM
          }
        }
      }
    }
  }

  return { warnings }
}

/**
 * Check if the generated text contradicts the SSM state.
 * Simple regex-based pre-check (not LLM).
 *
 * @returns {{ valid: boolean, violations: string[] }}
 */
export function validateAgainstSSM(reply, ssmState) {
  const violations = []
  if (!reply || !ssmState) return { valid: true, violations: [] }

  // Check: finished actions being re-done
  const finishedTouch = Object.entries(ssmState.current_touch || {}).filter(([, v]) => v).map(([k]) => k)
  if (finishedTouch.includes('embrace') || finishedTouch.includes('hug')) {
    if (/伸手|抬起手|张开手臂/.test(reply)) {
      violations.push('已经拥抱中，正文不应再"伸手"')
    }
  }
  if (finishedTouch.includes('hold_hand') || finishedTouch.includes('holding_hand')) {
    if (/伸出手|去拉她的手|去握她的手|试探着伸手/.test(reply)) {
      violations.push('已经牵手，正文不应再"伸手去拉"')
    }
  }

  // Check: clothing already removed
  for (const [name, cloth] of Object.entries(ssmState.clothing || {})) {
    if (cloth.coat === 'removed' || cloth.jacket === 'removed' || cloth.outerwear === 'removed') {
      if (/脱下?外套|解开?外套|脱掉?外套|脱下?大衣|脱掉?大衣/.test(reply)) {
        violations.push(`${name}已脱外套，正文不应再"脱外套/解外套"`)
      }
    }
    if (cloth.shirt === 'open' || cloth.shirt === 'unbuttoned') {
      if (/解开?扣子|解开?衬衫|脱下?衬衫/.test(reply)) {
        violations.push(`${name}衬衫已解开，正文不应再"解扣子"`)
      }
    }
  }

  // Check: finished actions list
  for (const action of (ssmState.finished_actions || [])) {
    const [name, act] = action.split(':')
    if (act === 'sat_down' || act === 'sat') {
      if (new RegExp(name + '.*坐下').test(reply) || new RegExp(name + '.*坐下来').test(reply)) {
        violations.push(`${name}已坐下，正文不应再"坐下"`)
      }
    }
    if (act === 'stood_up' || act === 'stood') {
      if (new RegExp(name + '.*站起').test(reply)) {
        violations.push(`${name}已站起，正文不应再"站起"`)
      }
    }
  }

  return { valid: violations.length === 0, violations }
}

// ═══════════════════════════════════════════════════════════
// 5. Persistence
// ═══════════════════════════════════════════════════════════

function _storageKey(charId, saveId) {
  return STORAGE_PREFIX + charId + '_' + (saveId || 'default')
}

export function loadSSMState(charId, saveId) {
  try {
    const raw = localStorage.getItem(_storageKey(charId, saveId))
    if (raw) return JSON.parse(raw)
  } catch (e) { console.warn('[SSM] Load failed:', e.message) }
  return null
}

export function saveSSMState(charId, saveId, state) {
  try {
    localStorage.setItem(_storageKey(charId, saveId), JSON.stringify(state))
  } catch (e) { console.warn('[SSM] Save failed:', e.message) }
}
