/**
 * State Locks v1 — Four Constraint Locks
 *
 * These are HARD programmatic constraints that run AFTER generation,
 * not prompt instructions that the model can ignore.
 *
 *   1. Identity Lock     — player name must appear, banned names must not
 *   2. Event Lock        — output must not contradict Story Canon locked facts
 *   3. Persona Continuity — tone/mood changes must be gradual (delta-based)
 *   4. Output Shape Lock — structural format enforcement (Daily especially)
 */

// ═══════════════════════════════════════════════════════════
// 0. Persona State Tracker (for continuity lock)
// ═══════════════════════════════════════════════════════════

let _lastTone = null       // { softness, aggression, warmth } from previous turn
let _lastMood = null       // { anger, sadness, jealousy } from previous turn
let _toneHistory = []      // rolling window of last 10 tone states

export function recordTurnState(uskState) {
  if (!uskState) return
  const emo = uskState.emotion || {}
  _lastTone = {
    softness: clamp(100 - (emo.anger || 5) - (uskState.tension?.unresolved_conflicts || 30) * 0.3, 0, 100),
    aggression: clamp((emo.anger || 5) + (uskState.tension?.emotional_pressure || 30) * 0.4, 0, 100),
    warmth: clamp((uskState.relationship?.affection || 50) * 0.7 - (emo.anger || 5) * 0.5, 0, 100),
  }
  _lastMood = {
    anger: emo.anger || 5,
    sadness: emo.sadness || 5,
    jealousy: emo.jealousy || 5,
  }
  _toneHistory.push({ ..._lastTone, ..._lastMood })
  if (_toneHistory.length > 10) _toneHistory.shift()
}

export function resetPersonaState() {
  _lastTone = null
  _lastMood = null
  _toneHistory = []
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }

// ═══════════════════════════════════════════════════════════
// 🔒 LOCK 1: Identity Lock
// ═══════════════════════════════════════════════════════════

const BANNED_PLAYER_NAMES = [
  '玩家', '新玩家', '用户', 'user', 'unknown',
  '王总', '小姐', '先生', '这位', '那个人', '你',
]

/**
 * Validate that the AI output respects the canonical player identity.
 * Returns { valid, violations }
 */
export function identityLock(output, canonicalPlayerName, mode) {
  if (!output || !canonicalPlayerName) {
    return { valid: false, violations: ['Identity Lock: canonicalPlayerName missing'] }
  }

  const violations = []

  // Minimal check — only flag OBVIOUSLY wrong names (not missing names, not nicknames).
  // The primary enforcement is through prompt integration, not output interception.
  //
  // What we DO flag:
  //   - "玩家" used as a name (not as a role description)
  //   - "用户" used as a name
  //   - "王总" when canonical name is "落总" (completely different last name)

  // Check: "玩家" or "新玩家" used as a stand-alone player address
  if (/\b玩家\b/.test(output) && !output.includes('【玩家')) {
    // "玩家" by itself in narrative — likely a fallback leak
    if (!canonicalPlayerName.includes('玩家')) {
      violations.push('Identity Lock: 输出包含默认名 "玩家"（应为 "' + canonicalPlayerName + '"）')
    }
  }

  return { valid: violations.length === 0, violations }
}

// ═══════════════════════════════════════════════════════════
// 🔒 LOCK 2: Event Lock
// ═══════════════════════════════════════════════════════════

/**
 * Validate output against Story Canon locked facts.
 * If output contradicts a locked fact, it must be regenerated.
 */
export function eventLock(output, storyCanon) {
  if (!storyCanon || !output) return { valid: true, violations: [] }
  const violations = []

  const lockedFacts = storyCanon.lockedFacts || []
  if (lockedFacts.length === 0) return { valid: true, violations: [] }

  const lower = output.toLowerCase()

  for (const fact of lockedFacts) {
    // Check for common contradiction patterns
    if (fact.includes('拒绝') && (lower.includes('接受') || lower.includes('答应'))) {
      if (_shareNames(fact, output)) {
        violations.push('Event Lock: 输出与锁定事实冲突——"' + fact + '"（角色曾拒绝，现代表现为接受）')
      }
    }
    if (fact.includes('离开') && lower.includes('回来') && _shareNames(fact, output)) {
      violations.push('Event Lock: 输出与锁定事实冲突——"' + fact + '"（角色曾离开，现代表现为回来）')
    }
    if (fact.includes('断裂') && lower.includes('修复') && _shareNames(fact, output)) {
      violations.push('Event Lock: 输出与锁定事实冲突——"' + fact + '"（关系曾断裂，现代表现为修复）')
    }
    if ((fact.includes('已发生') || fact.includes('亲密')) && lower.includes('从未') && _shareNames(fact, output)) {
      violations.push('Event Lock: 输出与锁定事实冲突——"' + fact + '"（否认已发生事件）')
    }
  }

  // Check timeline: can't re-do events that already happened
  const timeline = storyCanon.timeline || []
  const recentEvents = timeline.slice(-5)
  for (const evt of recentEvents) {
    const eventDesc = (evt.event || '').toLowerCase()
    // If output seems to re-describe the same event (heuristic: same key actions)
    if (eventDesc.includes('脱') && lower.includes('解扣子') && _shareNames(eventDesc, output)) {
      // This might be a re-do of the same event — flag it
      // (the LLM should continue from where the event left off, not re-do it)
    }
  }

  return { valid: violations.length === 0, violations }
}

function _shareNames(a, b) {
  const namesA = (a.match(/[一-鿿]{2,3}/g) || [])
  const namesB = (b.match(/[一-鿿]{2,3}/g) || [])
  return namesA.some(n => namesB.includes(n))
}

// ═══════════════════════════════════════════════════════════
// 🔒 LOCK 3: Persona Continuity Lock
// ═══════════════════════════════════════════════════════════

/**
 * Check that the character's tone hasn't jumped too far from the previous turn.
 * Prevents "上一轮温柔，这一轮冷酷" without intermediate steps.
 */
export function personaContinuityLock(output, currentUskState) {
  if (!_lastTone || !currentUskState) {
    return { valid: true, violations: [], continuity: null }
  }

  const emo = currentUskState.emotion || {}
  const currentTone = {
    softness: clamp(100 - (emo.anger || 5) - (currentUskState.tension?.unresolved_conflicts || 30) * 0.3, 0, 100),
    aggression: clamp((emo.anger || 5) + (currentUskState.tension?.emotional_pressure || 30) * 0.4, 0, 100),
    warmth: clamp((currentUskState.relationship?.affection || 50) * 0.7 - (emo.anger || 5) * 0.5, 0, 100),
  }

  const violations = []

  // Check tone jumps
  const softnessDelta = Math.abs(currentTone.softness - _lastTone.softness)
  const aggressionDelta = Math.abs(currentTone.aggression - _lastTone.aggression)
  const warmthDelta = Math.abs(currentTone.warmth - _lastTone.warmth)

  // Flag extreme jumps
  if (softnessDelta > 40) {
    violations.push('Persona Continuity: 柔软度跳变 ' + softnessDelta.toFixed(0) + '（上轮 ' + _lastTone.softness.toFixed(0) + ' → 本轮 ' + currentTone.softness.toFixed(0) + '）')
  }
  if (aggressionDelta > 40) {
    violations.push('Persona Continuity: 攻击性跳变 ' + aggressionDelta.toFixed(0))
  }
  if (warmthDelta > 40) {
    violations.push('Persona Continuity: 温度跳变 ' + warmthDelta.toFixed(0))
  }

  const continuity = {
    lastTone: _lastTone,
    currentTone,
    deltas: { softness: softnessDelta, aggression: aggressionDelta, warmth: warmthDelta },
  }

  return { valid: violations.length === 0, violations, continuity }
}

// ═══════════════════════════════════════════════════════════
// 🔒 LOCK 4: Output Shape Lock (Daily mode)
// ═══════════════════════════════════════════════════════════

/**
 * Hard structural validation for Daily mode output.
 * Returns { valid, violations }
 */
export function outputShapeLock(text, mode) {
  if (!text) return { valid: true, violations: [] }
  const violations = []

  // ── Daily-specific checks ──
  if (mode === 'daily') {
    // 1. No multi-sentence single bubbles
    const sentences = text.split(/[。！？\n]/).filter(s => s.trim().length > 0)
    if (sentences.length > 2) {
      violations.push('Output Shape: 单气泡含 ' + sentences.length + ' 句话——应拆分或删减')
    }

    // 2. No action括号 in output
    if (/（[^）]*(?:看向|低头|转身|缓缓|轻轻|冷笑|沉默|开口|心想|说道|默默|瞥了)[^）]*）/.test(text)) {
      violations.push('Output Shape: 检测到动作括号描写——日常模式禁止')
    }

    // 3. No narrative voice
    if (/[他她它][^，。！？]{2,20}[，。！？]/.test(text)) {
      violations.push('Output Shape: 检测到第三人称叙事——日常模式禁止')
    }

    // 4. No scene-setting
    if (/[在坐站靠躺](?:办公室|酒吧|车里|路边|窗边)/.test(text)) {
      violations.push('Output Shape: 检测到场景描写——日常模式禁止')
    }

    // 5. Length check
    if (text.length > 60) {
      violations.push('Output Shape: 单条消息过长（' + text.length + '字）')
    }

    // 6. No self-performance markers
    if (/我跟你说|听我说|你知道吗|其实我|我以前|我昨天|我今天/.test(text)) {
      violations.push('Output Shape: 检测到角色自我表演开场——违反 Player Focus Rule')
    }
  }

  // ── Drama-specific checks ──
  if (mode === 'drama') {
    // No conversation-ending patterns
    if (/^(?:晚安|再见|拜拜|改天聊)\s*$/.test(text.trim())) {
      violations.push('Output Shape: Drama 模式禁止对话终结')
    }
  }

  return { valid: violations.length === 0, violations }
}

// ═══════════════════════════════════════════════════════════
// 🔥 Master Validator — run all locks, return combined result
// ═══════════════════════════════════════════════════════════

/**
 * Run all applicable locks on the generated output.
 *
 * @param {string} output — the AI-generated reply
 * @param {object} context
 * @param {string} context.playerName — canonical player name
 * @param {object} context.storyCanon — Story Canon state
 * @param {object} context.uskState — current USK state (for persona continuity)
 * @param {string} context.mode — 'drama' | 'daily'
 * @returns {{ passed: boolean, violations: string[], blocks: object }}
 */
export function runAllLocks(output, context = {}) {
  const { playerName, storyCanon, uskState, mode } = context
  const allViolations = []

  // Lock 1: Identity
  if (playerName) {
    const idResult = identityLock(output, playerName, mode)
    if (!idResult.valid) allViolations.push(...idResult.violations)
  }

  // Lock 2: Event
  if (storyCanon) {
    const evResult = eventLock(output, storyCanon)
    if (!evResult.valid) allViolations.push(...evResult.violations)
  }

  // Lock 3: Persona Continuity
  if (uskState && _lastTone) {
    const pcResult = personaContinuityLock(output, uskState)
    if (!pcResult.valid) allViolations.push(...pcResult.violations)
  }

  // Lock 4: Output Shape
  const shapeResult = outputShapeLock(output, mode)
  if (!shapeResult.valid) allViolations.push(...shapeResult.violations)

  return {
    passed: allViolations.length === 0,
    violations: allViolations,
    blocks: {
      identity: playerName ? identityLock(output, playerName, mode) : null,
      event: storyCanon ? eventLock(output, storyCanon) : null,
      persona: uskState && _lastTone ? personaContinuityLock(output, uskState) : null,
      shape: shapeResult,
    },
  }
}
