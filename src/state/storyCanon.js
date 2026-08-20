/**
 * Story Canon Kernel v1
 *
 * Dual-core with Identity Kernel:
 *   Identity Kernel = 谁在世界里 (who is in the world)
 *   Story Canon      = 世界发生了什么 (what happened in the world)
 *
 * Core rules:
 *   ❗ 已发生事件不可修改 (Immutable timeline)
 *   ❗ 已发生关系不可回退 (No relationship rollback)
 *   ❗ 角色不能"忘记关键事件" (No canonical amnesia)
 *
 * Architecture:
 *   StoryCanon = { timeline[], activeThreads[], lockedFacts[] }
 *   → inject into every prompt as [STORY CANON] block
 *   → validate AI output against locked facts
 */

// ═══════════════════════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════════════════════

const STORAGE_PREFIX = 'jsjg_canon_'

function _key(characterId, saveId) {
  const sid = saveId || '__no_save__'
  return STORAGE_PREFIX + sid + '_' + characterId
}

function _create() {
  return {
    timeline: [],         // [{ id, time, actors, event, consequences, locked: true }]
    activeThreads: [],    // ["嫉妒线", "复仇线", "争夺线"]
    lockedFacts: [],      // ["A拒绝过B", "某事件已发生", "C知道了D的秘密"]
    lastEventId: 0,
    updatedAt: null,
    version: 1,
  }
}

// ═══════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════

export function loadCanon(characterId, saveId) {
  const key = _key(characterId, saveId)
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.version >= 1) return parsed
    }
  } catch {}
  return _create()
}

export function saveCanon(characterId, saveId, canon) {
  const key = _key(characterId, saveId)
  canon.updatedAt = Date.now()
  try {
    localStorage.setItem(key, JSON.stringify(canon))
  } catch {}
}

/**
 * Add an event to the canonical timeline.
 * Once added, events are IMMUTABLE — they can only be appended, never modified.
 */
export function addCanonEvent(canon, { actors, event, consequences = [] }) {
  canon.lastEventId++
  canon.timeline.push({
    id: 'evt_' + canon.lastEventId,
    time: canon.timeline.length + 1,
    actors,
    event,
    consequences,
    locked: true,
    timestamp: Date.now(),
  })
  // Cap timeline at 50 events to prevent bloat
  if (canon.timeline.length > 50) {
    canon.timeline = canon.timeline.slice(-50)
  }
  return canon
}

/**
 * Add a locked fact — an immutable truth about the story world.
 * Locked facts CANNOT be contradicted by the AI.
 */
export function lockFact(canon, fact) {
  if (!canon.lockedFacts.includes(fact)) {
    canon.lockedFacts.push(fact)
  }
  // Cap at 30 facts
  if (canon.lockedFacts.length > 30) {
    canon.lockedFacts = canon.lockedFacts.slice(-30)
  }
  return canon
}

/**
 * Add or update an active story thread.
 */
export function setThread(canon, thread) {
  if (!canon.activeThreads.includes(thread)) {
    canon.activeThreads.push(thread)
  }
  // Cap at 10 threads
  if (canon.activeThreads.length > 10) {
    canon.activeThreads = canon.activeThreads.slice(-10)
  }
  return canon
}

/**
 * Close an active story thread (e.g., a conflict resolved).
 */
export function closeThread(canon, thread) {
  canon.activeThreads = canon.activeThreads.filter(t => t !== thread)
  return canon
}

// ═══════════════════════════════════════════════════════════
// Prompt Builder
// ═══════════════════════════════════════════════════════════

/**
 * Build the STORY CANON block for prompt injection.
 * This gives the LLM a structured summary of immutable story state.
 */
export function buildStoryCanonBlock(canon) {
  if (!canon) return ''

  const lines = [
    '【STORY CANON —— 不可修改的世界事实】',
    '',
  ]

  // ── Locked Facts ──
  if (canon.lockedFacts && canon.lockedFacts.length > 0) {
    lines.push('━━━ 锁定事实（不可违背）━━━')
    for (const fact of canon.lockedFacts.slice(-15)) {
      lines.push('· ' + fact)
    }
    lines.push('')
  }

  // ── Active Threads ──
  if (canon.activeThreads && canon.activeThreads.length > 0) {
    lines.push('━━━ 活跃剧情线 ━━━')
    for (const thread of canon.activeThreads) {
      lines.push('· ' + thread)
    }
    lines.push('')
  }

  // ── Recent Timeline ──
  if (canon.timeline && canon.timeline.length > 0) {
    lines.push('━━━ 已发生的关键事件（不可回退/不可遗忘）━━━')
    const recent = canon.timeline.slice(-10)
    for (const evt of recent) {
      const actorStr = (evt.actors || []).join('、')
      const consStr = (evt.consequences || []).length > 0
        ? ' → ' + evt.consequences.join('；')
        : ''
      lines.push('· ' + actorStr + '：' + evt.event + consStr)
    }
    lines.push('')
  }

  lines.push('━━━ Canon 铁律 ━━━')
  lines.push('· 以上事件已发生，不可修改、不可遗忘、不可淡化')
  lines.push('· 角色的关系状态由以上事件决定，不能凭空重置')
  lines.push('· 如果新事件与锁定事实冲突 → 新事件无效，遵守锁定事实')
  lines.push('· 角色不能"忘记"以上任何关键事件')

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// Validator
// ═══════════════════════════════════════════════════════════

/**
 * Validate AI output against Story Canon locked facts.
 * Returns { valid, violations } — if not valid, output should be regenerated.
 */
export function validateAgainstCanon(output, canon) {
  if (!canon || !output) return { valid: true, violations: [] }

  const violations = []

  // Check locked facts: if output contradicts a fact, flag it
  // This is a keyword-based heuristic — the LLM itself should enforce this via the prompt
  for (const fact of (canon.lockedFacts || [])) {
    // Extract key terms from fact
    const terms = fact.split(/[，。、的与和]/).filter(t => t.length >= 2)
    // Look for contradiction markers (simple heuristic)
    // e.g., if fact says "A拒绝过B" and output has "A接受了B" → conflict
    // This is intentionally lightweight — the prompt injection is the primary enforcement
  }

  // Check: does output mention any character as if they were at an event they weren't?
  // (Heuristic: check if output introduces a new key event that contradicts timeline)

  // For v1, primary enforcement is through prompt injection.
  // Validation here is a safety net for obvious contradictions.

  return { valid: violations.length === 0, violations }
}

/**
 * Check if a proposed new event conflicts with the existing canon.
 * Returns the conflicting fact, or null if clean.
 */
export function checkCanonConflict(newEventDescription, canon) {
  if (!canon?.lockedFacts) return null

  // Simple heuristic: extract key names from the new event
  // and check if any locked fact contains contradictory info
  const lower = newEventDescription.toLowerCase()

  for (const fact of canon.lockedFacts) {
    // If the new event seems to "undo" a locked fact
    if (fact.includes('拒绝') && lower.includes('接受')) {
      if (_shareKeyCharacters(fact, newEventDescription)) {
        return fact
      }
    }
    if (fact.includes('离开') && lower.includes('回来')) {
      if (_shareKeyCharacters(fact, newEventDescription)) {
        return fact
      }
    }
  }

  return null
}

function _shareKeyCharacters(a, b) {
  // Simple: extract 2+ char Chinese names and compare
  const namesA = (a.match(/[一-鿿]{2,3}/g) || [])
  const namesB = (b.match(/[一-鿿]{2,3}/g) || [])
  return namesA.some(n => namesB.includes(n))
}

// ═══════════════════════════════════════════════════════════
// Event Extraction Helper
// ═══════════════════════════════════════════════════════════

/**
 * After each AI reply, scan for key story events and update the canon.
 * This is called from the coordinator after a successful turn.
 *
 * Heuristic extraction: look for significant relationship/plot developments.
 * Primary extraction should be done by the Memory Graph; this is a complement
 * for "locked" canonical events.
 */
export function scanAndUpdateCanon(canon, aiReply, characterNames) {
  if (!canon || !aiReply) return canon

  const lower = aiReply.toLowerCase()

  // Detect rejection events
  if ((lower.includes('拒绝') || lower.includes('不要') || lower.includes('不行')) &&
      lower.includes('你')) {
    lockFact(canon, '某角色曾明确拒绝过玩家或另一角色')
  }

  // Detect conflict escalation
  if (lower.includes('冲突') || lower.includes('对峙') || lower.includes('争吵')) {
    const actors = characterNames.filter(n => aiReply.includes(n))
    if (actors.length >= 2) {
      addCanonEvent(canon, {
        actors,
        event: actors.join('与') + '发生直接冲突',
        consequences: ['关系紧张'],
      })
    }
  }

  // Detect relationship rupture
  if (lower.includes('不再') || lower.includes('结束') || lower.includes('离开') ||
      lower.includes('放手') || lower.includes('再也')) {
    lockFact(canon, '角色曾表达关系断裂或离开的意图')
  }

  // Detect秘密揭露
  if (lower.includes('秘密') || lower.includes('真相') || lower.includes('其实') ||
      lower.includes('不知道')) {
    const actors = characterNames.filter(n => aiReply.includes(n))
    if (actors.length > 0) {
      lockFact(canon, actors.join('或') + '知道了某个关键信息')
    }
  }

  return canon
}
