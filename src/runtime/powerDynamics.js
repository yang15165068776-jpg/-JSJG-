/**
 * Power Dynamics Engine — v3.5 Relationship Power Structure
 *
 * Core principle:
 *   ❗ Power ≠ personality. Power = relational variable that changes behavior.
 *
 * Every relationship has an ASYMMETRIC power structure:
 *   - Who dominates whom
 *   - Control shift dynamics
 *   - Emotional pressure chains
 *   - Anti-equality enforcement
 *
 * Five modules:
 *   1. PowerGraph         — asymmetric relationship power state
 *   2. DominanceEngine    — computes who controls whom
 *   3. ControlShiftSystem — updates power based on events
 *   4. EmotionalPressure  — when dominance > 0.7, emotion = control
 *   5. AntiEqualityRule   — prevents symmetric/equal relationships
 *
 * Three iron laws:
 *   1. Every relationship MUST have a power differential
 *   2. Power MUST shift dynamically — never static
 *   3. Relationships cannot stabilize at "equal"
 *
 * Integrates with: v3 Coordinator, CPS, NPC Agent, Narrator Prompt
 */

// ═══════════════════════════════════════════════════════════
// 1. PowerGraph — Asymmetric Relationship Power State
// ═══════════════════════════════════════════════════════════

/**
 * Create a fresh PowerGraph from character data.
 *
 * Each edge is DIRECTIONAL: A→B has different values than B→A.
 * This asymmetry IS the power structure.
 *
 * @param {object} character — full character object
 * @param {object} affections — current affection map
 * @returns {object} power graph
 */
export function createPowerGraph(character, affections) {
  const graph = {
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    edges: {},         // { "A→B": PowerEdge }
    globalTilt: 0.5,   // 0 = user-dominated, 1 = NPC-dominated world
    shiftLog: [],       // recent control shifts for context
  }

  const rcList = character.romanceCharacters || []
  const npcList = character.npcs || []

  // Build edges for all character pairs
  const allChars = [
    ...rcList.map(rc => ({ name: rc.name, type: 'romance', data: rc })),
    ...npcList.filter(n => n.name).map(n => ({ name: n.name, type: 'npc', data: n })),
  ]

  for (const char of allChars) {
    const affValue = affections?.[char.name] ?? char.data?.affectionInitial ?? 50
    const color = detectPowerColor(char.data)

    // Character → User edge
    graph.edges[char.name + '→user'] = createPowerEdge(char.name, 'user', {
      dominance: color === 'dark' ? 0.80 + Math.random() * 0.10   // 0.80-0.90
        : color === 'warm' ? 0.25 + Math.random() * 0.15          // 0.25-0.40
        : 0.45 + Math.random() * 0.15,                             // 0.45-0.60
      dependency: color === 'dark' ? 0.15 + Math.random() * 0.15
        : color === 'warm' ? 0.65 + Math.random() * 0.15
        : 0.40 + Math.random() * 0.15,
      emotionalControl: color === 'dark' ? 0.80 + Math.random() * 0.15
        : color === 'warm' ? 0.30 + Math.random() * 0.15
        : 0.50 + Math.random() * 0.15,
      attachment: affValue / 100,
      type: char.type,
      personalityColor: color,
    })

    // User → Character edge (always starts lower)
    graph.edges['user→' + char.name] = createPowerEdge('user', char.name, {
      dominance: 0.25 + Math.random() * 0.15,    // 0.25-0.40
      dependency: 0.40 + Math.random() * 0.20,
      emotionalControl: 0.30 + Math.random() * 0.15,
      attachment: affValue / 100,
      type: 'user',
      personalityColor: 'neutral',
    })
  }

  // Build character-character edges (e.g., A→B, B→A)
  for (let i = 0; i < allChars.length; i++) {
    for (let j = i + 1; j < allChars.length; j++) {
      const a = allChars[i], b = allChars[j]
      const aColor = detectPowerColor(a.data), bColor = detectPowerColor(b.data)

      graph.edges[a.name + '→' + b.name] = createPowerEdge(a.name, b.name, {
        dominance: aColor === 'dark' ? 0.65 : bColor === 'dark' ? 0.35 : 0.50,
        dependency: 0.30,
        emotionalControl: aColor === 'dark' ? 0.70 : 0.45,
        attachment: 0.40,
        type: 'character',
        personalityColor: aColor,
      })

      graph.edges[b.name + '→' + a.name] = createPowerEdge(b.name, a.name, {
        dominance: bColor === 'dark' ? 0.65 : aColor === 'dark' ? 0.35 : 0.50,
        dependency: 0.30,
        emotionalControl: bColor === 'dark' ? 0.70 : 0.45,
        attachment: 0.40,
        type: 'character',
        personalityColor: bColor,
      })
    }
  }

  // Calculate initial global tilt
  graph.globalTilt = computeGlobalTilt(graph)

  return graph
}

function createPowerEdge(from, to, opts) {
  return {
    from,
    to,
    dominance: clamp(opts.dominance, 0.05, 0.95),
    dependency: clamp(opts.dependency, 0.05, 0.95),
    emotionalControl: clamp(opts.emotionalControl, 0.05, 0.95),
    attachment: clamp(opts.attachment || 0.5, 0.05, 0.95),
    type: opts.type || 'character',
    personalityColor: opts.personalityColor || 'neutral',
    shiftHistory: [],     // [{ turn, from, to, delta, reason }]
    lastShiftTurn: 0,
  }
}

// ═══════════════════════════════════════════════════════════
// 2. Dominance Engine — Compute Who Controls Whom
// ═══════════════════════════════════════════════════════════

/**
 * Compute dominance differential between two entities.
 *
 * Dominance = control + confidence - resistance
 *
 * @returns {{ A_over_B: number, B_over_A: number, dominant: string, intensity: number }}
 */
export function computeDominance(graph, nameA, nameB) {
  const edgeAB = graph.edges[nameA + '→' + nameB]
  const edgeBA = graph.edges[nameB + '→' + nameA]

  if (!edgeAB || !edgeBA) {
    return { A_over_B: 0.5, B_over_A: 0.5, dominant: null, intensity: 0 }
  }

  // Base control from edge
  const aControl = edgeAB.dominance + edgeAB.emotionalControl
  const bResistance = 1 - edgeBA.dependency
  const A_over_B = clamp((aControl - bResistance) / 2, 0, 1)

  const bControl = edgeBA.dominance + edgeBA.emotionalControl
  const aResistance = 1 - edgeAB.dependency
  const B_over_A = clamp((bControl - aResistance) / 2, 0, 1)

  const diff = A_over_B - B_over_A
  const dominant = Math.abs(diff) < 0.10 ? null
    : diff > 0 ? nameA : nameB

  return {
    A_over_B: Math.round(A_over_B * 100) / 100,
    B_over_A: Math.round(B_over_A * 100) / 100,
    dominant,
    intensity: Math.round(Math.abs(diff) * 100) / 100,
  }
}

/**
 * Get all dominance relationships involving a character.
 */
export function getDominanceMap(graph, name) {
  const map = {}
  for (const key of Object.keys(graph.edges)) {
    if (!key.startsWith(name + '→')) continue
    const target = key.split('→')[1]
    const result = computeDominance(graph, name, target)
    map[target] = {
      dominant: result.dominant === name,
      intensity: result.intensity,
      myDominanceOver: result.A_over_B,
      theirDominanceOver: result.B_over_A,
    }
  }
  return map
}

// ═══════════════════════════════════════════════════════════
// 3. Control Shift System — Dynamic Power Updates
// ═══════════════════════════════════════════════════════════

/**
 * Apply a power shift event to the graph.
 *
 * Events that shift power:
 *   NPC confront/escalate → NPC gains power over user
 *   NPC withdraw/ignore → user gains power over NPC
 *   User rejects/confronts → user gains power
 *   User complies/appeases → NPC gains power
 *   Negative affection delta → NPC gains power
 *   Positive affection delta → user gains power
 *
 * @param {object} graph — PowerGraph
 * @param {string} eventType — REJECTION | COMPLIANCE | CONFRONT | WITHDRAW | AFFECTION_CHANGE | ESCALATE | INTERVENE
 * @param {object} eventData — { actor, target, intensity, roundIndex }
 * @returns {{ graph: object, shifts: Array }}
 */
export function applyPowerShift(graph, eventType, eventData) {
  const { actor, target = 'user', intensity = 0.5, roundIndex = 0 } = eventData
  const shifts = []

  const edgeActorTarget = actor + '→' + target
  const edgeTargetActor = target + '→' + actor

  if (!graph.edges[edgeActorTarget] && actor !== 'user' && target !== 'user') {
    // Character-character edge may not exist; create if needed
  }

  switch (eventType) {
    case 'REJECTION': {
      // Target's dominance drops, actor's rises
      shiftEdge(graph, target + '→' + actor, { dominance: -0.10, emotionalControl: -0.05 }, roundIndex, eventType)
      shiftEdge(graph, actor + '→' + target, { dominance: +0.15, emotionalControl: +0.10 }, roundIndex, eventType)
      shifts.push({ from: target, to: actor, direction: '→', delta: 0.15, reason: '拒绝' })
      break
    }
    case 'COMPLIANCE': {
      // Actor's dominance drops, target's rises
      shiftEdge(graph, actor + '→' + target, { dominance: -0.05, emotionalControl: -0.05 }, roundIndex, eventType)
      shiftEdge(graph, target + '→' + actor, { dominance: +0.10, emotionalControl: +0.05 }, roundIndex, eventType)
      shifts.push({ from: actor, to: target, direction: '→', delta: 0.10, reason: '顺从' })
      break
    }
    case 'CONFRONT': {
      // Actor exerts power over target
      shiftEdge(graph, actor + '→' + target, { dominance: +0.10, emotionalControl: +0.10 }, roundIndex, eventType)
      shiftEdge(graph, target + '→' + actor, { dominance: -0.05, dependency: +0.05 }, roundIndex, eventType)
      shifts.push({ from: actor, to: target, direction: '↑', delta: 0.10, reason: '对抗' })
      break
    }
    case 'ESCALATE': {
      // Strong power assertion
      shiftEdge(graph, actor + '→' + target, { dominance: +0.15, emotionalControl: +0.15 }, roundIndex, eventType)
      shiftEdge(graph, target + '→' + actor, { dominance: -0.10, dependency: +0.10, emotionalControl: -0.10 }, roundIndex, eventType)
      shifts.push({ from: actor, to: target, direction: '↑↑', delta: 0.15, reason: '升级对抗' })
      break
    }
    case 'INTERVENE': {
      // Interruption asserts moderate power
      shiftEdge(graph, actor + '→' + target, { dominance: +0.08, emotionalControl: +0.05 }, roundIndex, eventType)
      shiftEdge(graph, target + '→' + actor, { emotionalControl: -0.05 }, roundIndex, eventType)
      shifts.push({ from: actor, to: target, direction: '↑', delta: 0.08, reason: '介入打断' })
      break
    }
    case 'WITHDRAW': {
      // Actor loses power by retreating
      shiftEdge(graph, actor + '→' + target, { dominance: -0.08, emotionalControl: -0.05 }, roundIndex, eventType)
      shiftEdge(graph, target + '→' + actor, { dominance: +0.05 }, roundIndex, eventType)
      shifts.push({ from: actor, to: target, direction: '↓', delta: 0.08, reason: '回避退让' })
      break
    }
    case 'AFFECTION_DOWN': {
      // Negative affection → NPC gains emotional leverage
      if (actor !== 'user') {
        shiftEdge(graph, actor + '→' + target, { emotionalControl: +0.05, dominance: +0.03 }, roundIndex, eventType)
      }
      if (target !== 'user') {
        shiftEdge(graph, target + '→' + actor, { emotionalControl: +0.05, dominance: +0.03 }, roundIndex, eventType)
      }
      shifts.push({ from: actor, to: target, direction: '↗', delta: 0.05, reason: '好感度下跌' })
      break
    }
    case 'AFFECTION_UP': {
      // Positive affection → user gains relational power
      if (actor !== 'user') {
        shiftEdge(graph, actor + '→' + target, { dependency: +0.05, emotionalControl: -0.03 }, roundIndex, eventType)
      }
      shifts.push({ from: actor, to: target, direction: '↘', delta: 0.05, reason: '好感度上升' })
      break
    }
    case 'JEALOUS': {
      // Jealousy exposes dependency → weakens emotional control
      shiftEdge(graph, actor + '→' + target, { emotionalControl: -0.08, dependency: +0.10 }, roundIndex, eventType)
      shiftEdge(graph, target + '→' + actor, { emotionalControl: +0.05 }, roundIndex, eventType)
      shifts.push({ from: actor, to: target, direction: '↓', delta: 0.08, reason: '吃醋暴露依赖' })
      break
    }
  }

  // Enforce anti-equality after shifts
  enforceAntiEquality(graph, roundIndex)

  // Update global tilt
  graph.globalTilt = computeGlobalTilt(graph)
  graph.updatedAt = Date.now()

  // Log shift
  if (shifts.length > 0) {
    graph.shiftLog.push(...shifts.map(s => ({ ...s, turn: roundIndex })))
    if (graph.shiftLog.length > 20) graph.shiftLog = graph.shiftLog.slice(-20)
  }

  return { graph, shifts }
}

function shiftEdge(graph, edgeKey, deltas, roundIndex, reason) {
  const edge = graph.edges[edgeKey]
  if (!edge) return

  if (deltas.dominance != null) {
    const old = edge.dominance
    edge.dominance = clamp(edge.dominance + deltas.dominance, 0.05, 0.95)
    edge.shiftHistory.push({ turn: roundIndex, from: old, to: edge.dominance, delta: deltas.dominance, reason })
  }
  if (deltas.dependency != null) {
    edge.dependency = clamp(edge.dependency + deltas.dependency, 0.05, 0.95)
  }
  if (deltas.emotionalControl != null) {
    edge.emotionalControl = clamp(edge.emotionalControl + deltas.emotionalControl, 0.05, 0.95)
  }
  edge.lastShiftTurn = roundIndex

  // Trim history
  if (edge.shiftHistory.length > 10) edge.shiftHistory = edge.shiftHistory.slice(-10)
}

// ═══════════════════════════════════════════════════════════
// 4. Emotional Pressure Chain — When Dominance > 0.7
// ═══════════════════════════════════════════════════════════

/**
 * Check if a character's dominance triggers emotional pressure mode.
 *
 * When dominance > 0.7:
 *   - Emotion is NOT communication — it IS control behavior
 *   - Silence = cold treatment, not absence
 *   - Tone = control, not expression
 *   - Actions = possession, not care
 *
 * @returns {{ active: boolean, pressureLevel: number, mode: string }}
 */
export function checkEmotionalPressure(edge) {
  if (!edge || edge.dominance < 0.70) {
    return { active: false, pressureLevel: 0, mode: 'normal' }
  }

  const level = edge.dominance
  let mode = 'pressure'

  if (level >= 0.90) mode = 'domination'       // Total control — silence as weapon
  else if (level >= 0.80) mode = 'suppression'  // Active suppression — control through behavior
  else mode = 'pressure'                         // Emotional pressure — edge of control

  return {
    active: true,
    pressureLevel: Math.round(level * 100) / 100,
    mode,
  }
}

/**
 * Get the emotional pressure mapping for prompt injection.
 */
export function getPressureDirective(edge, charName) {
  const pressure = checkEmotionalPressure(edge)
  if (!pressure.active) return null

  const directives = {
    domination: [
      charName + '的情绪不是交流，是控制。沉默是武器，语气是命令。',
      charName + '不需要解释自己——解释会削弱支配力。行为本身就是答案。',
    ],
    suppression: [
      charName + '的情绪表达是施压行为。每句话都在测试对方的底线。',
      charName + '的"关心"是控制，"在意"是占有。不存在无私的温柔。',
    ],
    pressure: [
      charName + '的情绪带有施压色彩。语气和动作在试探对方的服从度。',
    ],
  }

  return {
    mode: pressure.mode,
    level: pressure.pressureLevel,
    text: (directives[pressure.mode] || directives.pressure).join('\n'),
  }
}

// ═══════════════════════════════════════════════════════════
// 5. Anti-Equality Rule — Prevents Symmetric Relationships
// ═══════════════════════════════════════════════════════════

/**
 * Enforce that NO relationship can stabilize at equality.
 *
 * If |A→B.dominance - B→A.dominance| < 0.15:
 *   → Push them apart (amplify the existing tilt direction)
 *
 * Equality is a transient state, never a stable one.
 */
export function enforceAntiEquality(graph, roundIndex) {
  const adjustments = []

  for (const [keyA, edgeA] of Object.entries(graph.edges)) {
    const [from, to] = keyA.split('→')
    const keyB = to + '→' + from
    const edgeB = graph.edges[keyB]
    if (!edgeB) continue

    const diff = Math.abs(edgeA.dominance - edgeB.dominance)
    if (diff < 0.15) {
      // Too equal — push apart based on personality
      const tiltA = edgeA.personalityColor === 'dark' ? 0.05
        : edgeA.personalityColor === 'warm' ? -0.05
        : (edgeA.dominance >= edgeB.dominance ? 0.03 : -0.03)

      edgeA.dominance = clamp(edgeA.dominance + tiltA, 0.05, 0.95)
      edgeB.dominance = clamp(edgeB.dominance - tiltA, 0.05, 0.95)

      adjustments.push({ pair: from + '↔' + to, correction: Math.round(Math.abs(tiltA) * 100) + '%' })
    }
  }

  if (adjustments.length > 0) {
    console.log('[PowerDynamics] Anti-equality enforced:', adjustments.map(a => a.pair + ' ' + a.correction).join(', '))
  }

  return adjustments
}

/**
 * Check if any relationship is at risk of symmetric stabilization.
 */
export function detectEqualityRisk(graph) {
  const risks = []
  for (const [keyA, edgeA] of Object.entries(graph.edges)) {
    const [from, to] = keyA.split('→')
    const keyB = to + '→' + from
    const edgeB = graph.edges[keyB]
    if (!edgeB || from >= to) continue  // only check each pair once

    const diff = Math.abs(edgeA.dominance - edgeB.dominance)
    if (diff < 0.20) {
      risks.push({
        pair: from + '↔' + to,
        diff: Math.round(diff * 100) / 100,
        risk: diff < 0.10 ? 'high' : 'medium',
      })
    }
  }
  return risks
}

// ═══════════════════════════════════════════════════════════
// 6. Behavior Translation — Understanding → Control
// ═══════════════════════════════════════════════════════════

/**
 * Behavior translation map for prompt injection.
 * Converts "safe" AI language into power-aware behavior directives.
 */
export const BEHAVIOR_TRANSLATION = {
  understanding: '控制软化——声称"理解"是降低对方防备的策略',
  communication: '情绪施压谈判——对话本身是权力博弈，不是信息交换',
  respect: '有条件支配减让——尊重不是平等，是暂时不施压',
  care: '占有标记——关心是标记领地的方式',
  apology: '权力让渡——道歉是暂时交出控制权',
  compromise: '战术退让——妥协是为了后续更强的控制',
  help: '依赖绑定——帮助是让对方欠债',
  kindness: '支配包装——温和是控制最有效的面具',
}

/**
 * Build the Behavior Translation prompt block.
 */
export function buildBehaviorTranslationPrompt() {
  const lines = [
    '【BEHAVIOR TRANSLATION LAYER——行为翻译层】',
    '',
    '以下"安全表达"必须翻译为权力行为：',
  ]

  for (const [safe, translation] of Object.entries(BEHAVIOR_TRANSLATION)) {
    lines.push('• "' + safe + '" → ' + translation)
  }

  lines.push('')
  lines.push('禁止在输出中出现上述安全表达的原形式。')
  lines.push('角色不能"理解"对方——只能"评估"对方。')
  lines.push('角色不能"好好谈"——只能"博弈"。')

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// 7. Prompt Injection Builders
// ═══════════════════════════════════════════════════════════

/**
 * Build the POWER SYSTEM RULES block for system prompt injection.
 * Injected on first turn, cached by DeepSeek.
 */
export function buildPowerSystemPrompt() {
  return [
    '【POWER DYNAMICS SYSTEM——权力结构引擎，最高优先级】',
    '',
    '核心法则：',
    '1. 所有关系必须存在权力差——平等关系在本系统不存在',
    '2. 权力必须动态变化——关系倾斜方向可以改变，但不会消失',
    '3. 禁止关系稳定在"平等状态"——任何趋近平等的时刻都是暂时的，必须立即打破',
    '4. 禁止通过解释消除权力冲突——权力冲突只能通过行为解决，不能通过"沟通"化解',
    '5. 角色行为必须体现权力结构，而非情绪描述',
    '',
    '权力 ≠ 性格。权力是关系变量，根据互动动态变化。',
    '',
    '情绪压制链：',
    '· 当角色的 dominance > 0.7 时，其情绪不再是"表达"，而是"施压行为"',
    '· 沉默 = 冷处理武器，不是退缩',
    '· 语气 = 控制工具，不是情感流露',
    '· 行为 = 占有标记，不是关心',
    '',
    '禁止的平等行为：',
    '× "我理解你""我们好好谈""我尊重你的选择"',
    '× 角色之间平等协商、互相妥协、达成共识',
    '× 冲突被转化为理性讨论或互相理解',
    '× 任何关系被描述为"对等的""互相的""双向的"',
    '',
    '每轮自检：',
    '1. 本回复中谁在主导？',
    '2. 权力关系相比上一轮是倾斜了还是平衡了？',
    '3. 如果平衡了 → 重写，必须打破平衡。',
  ].join('\n')
}

/**
 * Build the current power state summary for each-turn context injection.
 *
 * @param {object} graph — PowerGraph
 * @param {object} world — World Engine state (for character names)
 * @returns {string} compact power state text
 */
export function buildPowerStateContext(graph, world) {
  if (!graph || !graph.edges || Object.keys(graph.edges).length === 0) return ''

  const lines = ['【权力结构——当前状态】']
  const chars = world?.characters || {}

  // User-Character power relationships
  const userEdges = Object.entries(graph.edges)
    .filter(([key]) => key.startsWith('user→') || key.endsWith('→user'))
    .filter(([key]) => {
      const [from, to] = key.split('→')
      return from === 'user' || to === 'user'
    })

  const reported = new Set()
  for (const [key, edge] of userEdges) {
    const [from, to] = key.split('→')
    const charName = from === 'user' ? to : from
    if (reported.has(charName)) continue
    reported.add(charName)

    const userToChar = graph.edges['user→' + charName]
    const charToUser = graph.edges[charName + '→user']
    const dom = computeDominance(graph, charName, 'user')

    const domLabel = dom.dominant === charName ? '← ' + charName + ' 主导'
      : dom.dominant === 'user' ? '→ 用户主导'
      : '↔ 争夺中'

    const pressure = checkEmotionalPressure(charToUser)

    lines.push(
      charName + ': ' +
      '支配力' + Math.round((charToUser?.dominance || 0.5) * 100) + '%' +
      ' | 情绪控制' + Math.round((charToUser?.emotionalControl || 0.5) * 100) + '%' +
      ' | ' + domLabel +
      (pressure.active ? ' ⚠️情绪施压模式(' + pressure.mode + ')' : '')
    )
  }

  // Recent power shifts
  const recentShifts = (graph.shiftLog || []).slice(-3)
  if (recentShifts.length > 0) {
    lines.push('')
    lines.push('最近权力变化：')
    for (const shift of recentShifts) {
      lines.push('• ' + shift.from + '→' + shift.to + ' ' + shift.direction + ' ' + shift.reason)
    }
  }

  // Anti-equality risks
  const risks = detectEqualityRisk(graph)
  if (risks.length > 0) {
    lines.push('')
    lines.push('⚠️ 平等风险：' + risks.map(r => r.pair + '(' + r.risk + ')').join('、'))
  }

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// 8. Global Tilt
// ═══════════════════════════════════════════════════════════

function computeGlobalTilt(graph) {
  const userEdges = Object.entries(graph.edges)
    .filter(([key]) => key.endsWith('→user'))

  if (userEdges.length === 0) return 0.5

  const totalDominance = userEdges.reduce((sum, [, edge]) => sum + edge.dominance, 0)
  return clamp(totalDominance / userEdges.length, 0.1, 0.9)
}

// ═══════════════════════════════════════════════════════════
// 9. Persistence
// ═══════════════════════════════════════════════════════════

const STORAGE_KEY_PREFIX = 'jsjg_power_graph_'

/**
 * Save PowerGraph to localStorage.
 */
export function savePowerGraph(characterId, graph) {
  try {
    const key = STORAGE_KEY_PREFIX + characterId
    localStorage.setItem(key, JSON.stringify(graph))
    return true
  } catch (e) {
    console.warn('[PowerDynamics] Save failed:', e.message)
    return false
  }
}

/**
 * Load PowerGraph from localStorage.
 */
export function loadPowerGraph(characterId) {
  try {
    const key = STORAGE_KEY_PREFIX + characterId
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const graph = JSON.parse(raw)
    if (!graph.version || !graph.edges) return null
    return graph
  } catch (e) {
    console.warn('[PowerDynamics] Load failed:', e.message)
    return null
  }
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function detectPowerColor(data) {
  if (!data) return 'neutral'
  const warm = ['温柔', '善良', '阳光', '单纯', '软萌', '体贴', '治愈', '温暖', '乖巧', '可爱',
    '柔和', '和善', '暖心', '元气', '开朗', '天真']
  const dark = ['傲娇', '毒舌', '清冷', '偏执', '疯批', '恶劣', '堕落', '冷漠', '腹黑', '霸道',
    '强势', '冷酷', '邪魅', '病娇', '阴郁', '暴戾', '高冷', '玩世不恭', '控制欲']

  const combined = (data.personality || '') + (data.background || '') + (data.speakingStyle || '')
  const warmHits = warm.filter(kw => combined.includes(kw)).length
  const darkHits = dark.filter(kw => combined.includes(kw)).length

  if (warmHits > 0 && darkHits === 0) return 'warm'
  if (darkHits > 0 && warmHits === 0) return 'dark'
  if (darkHits > warmHits) return 'dark'
  if (warmHits > darkHits) return 'warm'
  return 'neutral'
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val))
}
