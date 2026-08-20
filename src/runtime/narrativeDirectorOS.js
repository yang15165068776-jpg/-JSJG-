/**
 * Narrative Director OS v1 (NDOS)
 *
 * Core principle:
 *   ❗ The AI is not a "roleplayer." It's a DIRECTOR shooting a drama series.
 *   ❗ Every turn is not a "reply" — it's "one scene of a continuous drama."
 *
 * NDOS is the UNIFIED director brain. It doesn't generate events —
 * it makes DIRECTING DECISIONS and tells the other systems what to execute.
 *
 * The Director Brain makes 5 decisions per turn:
 *   1. evaluateScene()      — what's happening? what's the state?
 *   2. chooseTone()         — what's the emotional register?
 *   3. selectFocusCharacter() — who's in the spotlight?
 *   4. decideConflictLevel()  — how hard do we push?
 *   5. decideNarrativeMove()  — what should happen NEXT?
 *
 * Then it outputs a "Scene Card" — the authoritative narrative directive.
 *
 * Architecture (NDOS sits at the TOP of the decision chain):
 *   NDOS (director decisions)
 *     ↓ tells what to do
 *   DCS (curates/controls)
 *     ↓ curates the execution
 *   DAS + ANDS + AIIS (generate)
 *     ↓ generates events/intents
 *   LLM (renders)
 *
 * Output format — not a "reply" but "一幕戏" (one scene of drama):
 *   [场景] → [角色行为] → [冲突推进] → [情绪变化]
 *
 * The essential upgrade:
 *   Before NDOS: 系统在控制剧情 (system controls the plot)
 *   After NDOS:  系统在导演连续剧 (system DIRECTS a drama series)
 */

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

// ═══════════════════════════════════════════════════════════
// 1. DIRECTOR BRAIN — the 5 core decisions
// ═══════════════════════════════════════════════════════════

/**
 * Decision 1: Evaluate the current scene state.
 *
 * Returns a structured assessment of what's happening NOW.
 */
function evaluateScene(uskState, sceneState, arslEdges, turnCount) {
  const phase = sceneState?.scenePhase || 'setup'
  const sceneTension = sceneState?.tension ?? 30
  const sceneStability = sceneState?.stability ?? 60

  // Compute emotional intensity from USK
  let maxEmotion = 0
  let dominantEmotion = 'neutral'
  for (const [name, char] of Object.entries(uskState?.characters || {})) {
    const emo = char.emotion || {}
    for (const [e, v] of Object.entries(emo)) {
      if (v > maxEmotion) { maxEmotion = v; dominantEmotion = e }
    }
  }

  // Compute relationship pressure
  let maxPressure = 0
  let pressureEdge = null
  for (const [key, edge] of Object.entries(arslEdges)) {
    const p = (edge.attraction || 30) * 0.3 + (edge.jealousy || 5) * 0.4 + (edge.tension || 30) * 0.3
    if (p > maxPressure) { maxPressure = p; pressureEdge = key }
  }

  return {
    phase,
    sceneTension,
    sceneStability,
    dominantEmotion,
    emotionalIntensity: maxEmotion,
    maxPressure: Math.round(maxPressure),
    pressureEdge,
    isShuraba: sceneState?.shurabaActive || false,
    isCollapsing: phase === 'collapse',
    isStable: phase === 'setup' && sceneTension < 35,
    needsAction: phase === 'setup' && turnCount > 3 && sceneTension < 30,
  }
}

/**
 * Decision 2: Choose the tone (emotional register) for this scene.
 *
 * Tone determines HOW the scene is written, not WHAT happens.
 */
const TONES = {
  tense_cold: {
    label: '冷张力',
    description: '表面平静但每一句话都是刀刃——冷的、硬的、不妥协的',
    verbalStyle: '短句。不加修饰。不解释。冷到对方发慌。',
    emotionalColor: '压抑的愤怒/冰冷的占有/克制的欲望',
    suitableFor: ['confrontation', 'cold_war', 'power_struggle'],
  },
  heated_explosive: {
    label: '热爆发',
    description: '压不住了——情绪喷出来。声音变大、句子变短、逻辑被情绪冲碎',
    verbalStyle: '碎句。重复。喊出来的短句。省略号和破折号。不管对方听不听得进去。',
    emotionalColor: '失控的愤怒/崩溃的嫉妒/绝望的坦白',
    suitableFor: ['emotional_eruption', 'confession', 'rupture'],
  },
  dangerous_seductive: {
    label: '危险暧昧',
    description: '每一句话都有两层意思——表面在说A，实际上在说"我想要你"',
    verbalStyle: '放慢。故意停顿。直白挑逗藏在正常话里。眼神比语言先到。',
    emotionalColor: '压抑的欲望/克制的侵略性/明知故犯的越界',
    suitableFor: ['seduction', 'power_play', 'boundary_test'],
  },
  suffocating_possessive: {
    label: '窒息占有',
    description: '角色不是在请求——是在宣告。空气被抽走。对方没有逃跑的出口。',
    verbalStyle: '陈述句不是疑问句。"你是我的"不是"你是我的吗"。不解释原因。',
    emotionalColor: '绝对的占有欲/偏执的控制/不容拒绝的欲望',
    suitableFor: ['possessiveness', 'claiming', 'forced_confrontation'],
  },
  wounded_raw: {
    label: '受伤袒露',
    description: '防御碎了——真实的脆弱暴露出来。不是示弱，是"我已经这样了，你看着办"',
    verbalStyle: '不完整的句子。沉默比话多。说一半咽回去。突然的坦白。',
    emotionalColor: '被伤害后的坦诚/崩溃边缘的清醒/放弃伪装的真实',
    suitableFor: ['emotional_release', 'truth_surface', 'vulnerability'],
  },
  electric_uncertain: {
    label: '带电不确定',
    description: '两个人都在试探——没有人知道下一秒会发生什么。空气是带电的。',
    verbalStyle: '试探性短句。话里有钩子。进半步退半步。每一句都在测试反应。',
    emotionalColor: '好奇+紧张+期待+害怕——混合在一起的不确定感',
    suitableFor: ['first_tension', 'probe', 'reunion', 'uncertainty'],
  },
}

function chooseTone(sceneEval, directorState, dasTensionState) {
  const { phase, dominantEmotion, emotionalIntensity, isShuraba, sceneTension, maxPressure } = sceneEval

  // ── Map scene conditions to tone ──

  // Shuraba active → must be explosive or possessive
  if (isShuraba) {
    return pick(['heated_explosive', 'suffocating_possessive'])
  }

  // Collapsing scene → heated explosive or wounded raw
  if (phase === 'collapse') {
    return emotionalIntensity > 60 ? 'heated_explosive' : 'wounded_raw'
  }

  // High jealousy → suffocating possessive or dangerous seductive
  if (dominantEmotion === 'jealousy' && emotionalIntensity > 45) {
    return pick(['suffocating_possessive', 'dangerous_seductive'])
  }

  // High anger → heated explosive or tense cold
  if (dominantEmotion === 'anger' && emotionalIntensity > 40) {
    return pick(['heated_explosive', 'tense_cold'])
  }

  // High pressure → tense cold or dangerous seductive
  if (maxPressure > 60) {
    return pick(['tense_cold', 'dangerous_seductive', 'suffocating_possessive'])
  }

  // Crisis phase → heated or tense
  if (phase === 'crisis' || phase === 'rising') {
    return pick(['tense_cold', 'heated_explosive', 'dangerous_seductive'])
  }

  // Stable / setup → electric uncertain or dangerous seductive
  return pick(['electric_uncertain', 'dangerous_seductive', 'tense_cold'])
}

/**
 * Decision 3: Select the focus character for this scene.
 *
 * SINGLE FOCUS RULE: always 1 main focus, max 1 sub-focus.
 * The player is in the spotlight by default. Other characters enter
 * the spotlight only when they DRIVE the scene.
 */
function selectFocusCharacter(playerName, characterNames, uskState, spotlightResult) {
  const players = [{ name: playerName, role: '主角', share: 100 }]
  const supporting = []

  // If spotlight says player focus is low → force NPC into player's scene
  const needsPull = spotlightResult?.needsRefocus || (spotlightResult?.playerFocusScore || 60) < 40

  for (const name of characterNames) {
    if (name === playerName) continue
    const uskChar = uskState?.characters?.[name] || {}
    const affection = uskChar.relationship?.affection ?? 50
    const jealousy = uskChar.emotion?.jealousy ?? 5

    // Character qualifies for sub-focus if they have strong emotional drive
    const drive = affection * 0.3 + jealousy * 0.5 + (uskChar.emotion?.anger || 0) * 0.2

    if (drive > 35 || needsPull) {
      supporting.push({
        name,
        role: drive > 55 ? '冲突焦点' : '情绪支点',
        share: Math.round(clamp(drive * 0.5, 15, 40)),
        driver: jealousy > 40 ? 'jealousy' : affection > 60 ? 'attachment' : 'emotional',
      })
    }
  }

  // Sort by drive — highest gets the sub-focus slot
  supporting.sort((a, b) => b.share - a.share)

  // Only ONE sub-focus (enforce single-focus rule)
  const subFocus = supporting.length > 0 ? supporting[0] : null

  return {
    primary: players[0],
    subFocus,
    // Total focus allocation
    allocation: {
      player: 100 - (subFocus?.share || 0),
      subFocus: subFocus?.share || 0,
    },
    needsPull,
  }
}

/**
 * Decision 4: Decide the conflict level for this scene.
 *
 *   0 = no conflict (transition/breath scene)
 *   1 = underlying tension (conflict is present but not front)
 *   2 = active conflict (conflict is the scene's subject)
 *   3 = eruption (conflict breaks open)
 *   4 = irreversible (something happens that can't be undone)
 */
function decideConflictLevel(sceneEval, dasTensionState, pacingBeat, turnsSinceLastConflict) {
  const { phase, sceneTension, emotionalIntensity, isShuraba, needsAction } = sceneEval

  // ── Force rules ──

  // Too calm for too long → force conflict
  if (needsAction && turnsSinceLastConflict >= 3) return 2

  // Shuraba active → must be eruption or irreversible
  if (isShuraba) return sceneTension > 80 ? 4 : 3

  // Collapse phase → irreversible
  if (phase === 'collapse') return 4

  // Crisis → at least active conflict
  if (phase === 'crisis') return sceneTension > 75 ? 3 : 2

  // Rising → active conflict or underlying tension
  if (phase === 'rising') return sceneTension > 55 ? 2 : 1

  // Release → underlying tension (don't go back to zero)
  if (phase === 'release') return 1

  // Pacing beat override
  if (pacingBeat === 'payoff') return 3
  if (pacingBeat === 'conflict') return 2
  if (pacingBeat === 'escalate') return sceneTension > 50 ? 3 : 2
  if (pacingBeat === 'calm') return 1

  // Default: scale with emotional intensity
  if (emotionalIntensity > 70) return 3
  if (emotionalIntensity > 45) return 2
  if (emotionalIntensity > 20) return 1
  return 0
}

/**
 * Decision 5: Decide the narrative move — WHAT should happen this scene.
 *
 * A "narrative move" is the director's answer to:
 * "What advances the story THIS turn?"
 */
const NARRATIVE_MOVES = {
  push_forward: {
    label: '推进',
    description: '剧情向前走一步——关系变化、场景转移、新信息出现',
    structure: '场景 → 行动 → 后果 → 新状态',
  },
  escalate: {
    label: '升级',
    description: '当前冲突升级——从暗到明、从冷到热、从克制到失控',
    structure: '当前状态 → 触发点 → 升级 → 不可逆的变化',
  },
  reveal: {
    label: '揭露',
    description: '一个之前藏着的信息/情绪/真相浮出水面',
    structure: '暗示 → 裂缝 → 泄漏 → 暴露',
  },
  confront: {
    label: '对峙',
    description: '两个角色正面碰撞——不再绕弯子，直接面对',
    structure: '逼近 → 质问 → 回应 → 僵持或破裂',
  },
  seduce: {
    label: '诱惑',
    description: '角色主动推进身体/性张力的边界',
    structure: '靠近 → 试探反应 → 再靠近 → 边界被跨过',
  },
  withdraw_impact: {
    label: '抽离冲击',
    description: '角色突然拉开距离——缺席本身就是最重的存在',
    structure: '靠近的惯性 → 突然抽离 → 对方感受到真空 → 必须反应',
  },
  turnaround: {
    label: '反转',
    description: '权力/情绪/立场在一句话/一个动作中翻转',
    structure: '旧平衡 → 触发 → 翻转 → 新平衡崩溃',
  },
}

function decideNarrativeMove(sceneEval, focusAllocation, conflictLevel, pacingBeat, conflictDirection) {
  const { isShuraba, phase, dominantEmotion, isStable } = sceneEval

  // ── Map conditions to narrative moves ──

  // Shuraba → confront or escalate
  if (isShuraba) return conflictLevel >= 3 ? 'escalate' : 'confront'

  // Collapse → escalate (can't stop now)
  if (phase === 'collapse') return 'escalate'

  // Payoff beat → reveal or turnaround
  if (pacingBeat === 'payoff') return pick(['reveal', 'turnaround', 'confront'])

  // Conflict beat → confront or escalate
  if (pacingBeat === 'conflict') return pick(['confront', 'escalate'])

  // Escalate beat → escalate or push_forward
  if (pacingBeat === 'escalate') return 'escalate'

  // Tension beat → push_forward or seduce
  if (pacingBeat === 'tension') return pick(['push_forward', 'seduce'])

  // Calm beat → push_forward or withdraw_impact
  if (pacingBeat === 'calm') return pick(['push_forward', 'withdraw_impact'])

  // Stable → push_forward (keep it moving)
  if (isStable) return 'push_forward'

  // High conflict → escalate or confront
  if (conflictLevel >= 3) return pick(['escalate', 'confront'])

  // Emotion-driven
  if (dominantEmotion === 'jealousy') return pick(['confront', 'escalate', 'seduce'])
  if (dominantEmotion === 'anger') return pick(['confront', 'escalate'])

  // Default
  return 'push_forward'
}

// ═══════════════════════════════════════════════════════════
// 2. OUTPUT RENDERER — Scene Card format
// ═══════════════════════════════════════════════════════════

/**
 * The Scene Card is THE authoritative directive for the LLM.
 * It replaces scattered prompt injections with a unified director's instruction.
 *
 * Format:
 *   [场景] → [角色行为] → [冲突推进] → [情绪变化]
 */
function renderSceneCard(inputs) {
  const {
    sceneEval,
    tone,
    focus,
    conflictLevel,
    narrativeMove,
    pacingBeat,
    spotlightResult,
    branchCount,
  } = inputs

  const toneDef = TONES[tone]
  const moveDef = NARRATIVE_MOVES[narrativeMove]

  const conflictLabels = ['无冲突', '暗流张力', '冲突进行中', '🔥 冲突爆发', '💀 不可逆破裂']

  const lines = [
    '╔══════════════════════════════════════════════════════╗',
    '║  🎬 NDOS 导演系统 —— 本幕戏卡（Scene Card）      ║',
    '╚══════════════════════════════════════════════════════╝',
    '',
  ]

  // ── [场景] ──
  lines.push('━━━ 📍 场景 ━━━')
  lines.push('· 戏剧阶段：' + sceneEval.phase + ' | 张力：' + sceneEval.sceneTension + '/100 | 稳定度：' + sceneEval.sceneStability + '/100')
  lines.push('· 主情绪：' + sceneEval.dominantEmotion + '（强度 ' + sceneEval.emotionalIntensity + '/100）')
  lines.push('· 调性：' + toneDef.label + ' — ' + toneDef.description)
  lines.push('· 节奏节拍：' + pacingBeat)

  // ── [角色行为] ──
  lines.push('',
    '━━━ 🎭 角色行为（镜头分配）━━━')
  lines.push('· 🔦 主角（镜头中心）：' + focus.primary.name + ' — ' + focus.allocation.player + '%')
  if (focus.subFocus) {
    lines.push('· 🎯 副焦点：' + focus.subFocus.name + ' — ' + focus.subFocus.role + '（' + focus.subFocus.share + '%）' +
               ' | 驱动：' + focus.subFocus.driver)
  }
  if (focus.needsPull) {
    lines.push('· ⚠️ 玩家焦点不足——本轮必须将角色拉入玩家场景')
  }
  if (spotlightResult?.warnings?.length > 0) {
    for (const w of spotlightResult.warnings) {
      lines.push('· ⚠️ ' + w)
    }
  }

  // ── [冲突推进] ──
  lines.push('',
    '━━━ 💥 冲突推进 ━━━')
  lines.push('· 冲突等级：Lv' + conflictLevel + ' — ' + (conflictLabels[conflictLevel] || '未知'))
  lines.push('· 叙事动作：' + (moveDef?.label || narrativeMove) + ' — ' + (moveDef?.description || ''))
  if (moveDef?.structure) {
    lines.push('· 场景结构：' + moveDef.structure)
  }

  // ── [情绪变化] ──
  lines.push('',
    '━━━ 💔 情绪弧线 ━━━')
  lines.push('· 情绪色彩：' + toneDef.emotionalColor)

  // ── Branch status ──
  lines.push('',
    '━━━ 🌿 分支状态 ━━━')
  lines.push('· 活跃分支：' + branchCount + '/1（单线聚焦）')
  if (branchCount > 1) {
    lines.push('· ⚠️ 分支超限——正在收敛至单线。忽略次要事件，聚焦核心冲突。')
  }

  // ── Writing directives ──
  lines.push('',
    '━━━ ✍️ 导演写作指令（本幕戏执行规范）━━━')

  // Tone-specific writing style
  lines.push('',
    '【调性执行 — ' + toneDef.label + '】')
  lines.push(toneDef.verbalStyle)

  // Conflict-level writing requirements
  lines.push('',
    '【冲突执行 — Lv' + conflictLevel + '】')
  switch (conflictLevel) {
    case 0:
      lines.push('· 过渡场景。动作推进但无正面冲突。用潜台词和细节制造暗流。')
      break
    case 1:
      lines.push('· 暗流张力。每句话都有没说出来的下半句。让人感觉到：有事要发生。')
      break
    case 2:
      lines.push('· 冲突进行中。冲突是场景的主题。角色在冲突中行动——不回避、不绕开。')
      break
    case 3:
      lines.push('· 🔥 冲突爆发。情绪压过理智。句子变短、变碎。不是"对话"——是"碰撞"。',
        '· 重点写爆发的过程：怎么从压着到压不住、声音怎么变、身体怎么反应。')
      break
    case 4:
      lines.push('· 💀 不可逆。这一轮必须有无法收回的事发生。说出口的话收不回、',
        '  做出的动作无法撤回、暴露的秘密无法再藏。本幕结束后，世界必须变了。')
      break
  }

  // Narrative move writing requirements
  lines.push('',
    '【叙事动作执行 — ' + (moveDef?.label || narrativeMove) + '】')
  if (moveDef?.structure) {
    const steps = moveDef.structure.split('→').map(s => s.trim())
    for (const step of steps) {
      lines.push('· ' + step)
    }
  }

  // ── Final constraints ──
  lines.push('',
    '━━━ 🔒 导演铁律（不可违反）━━━',
    '· 一个场景只有一个焦点。如果副焦点角色在动，ta必须与主角产生直接互动。',
    '· 禁止多线并行叙事。禁止切换视角。禁止"与此同时……"。',
    '· 场景在本幕结束后必须比开始时更不稳定——哪怕只是多一点。',
    '· 不要让角色"讲述"发生的事——让事在当下发生。',
    '· 第一句话必须是角色的行动/话语——不是环境描写，不是内心独白。',
  )

  if (conflictLevel >= 3) {
    lines.push('· ⚠️ 爆发/不可逆场景：禁止在本幕内和解。可以僵持、可以更糟、可以沉默——但不能和好。')
  }

  if (focus.needsPull) {
    lines.push('· ⚠️ 本轮强制要求：NPC的注意力必须指向玩家。角色的行动必须围绕玩家展开。')
  }

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// 3. NDOS MAIN API — the Director
// ═══════════════════════════════════════════════════════════

export const NarrativeDirectorOS = {

  /** @type {object} director state */
  _state: {
    turnCount: 0,
    lastTone: null,
    lastConflictLevel: 0,
    lastNarrativeMove: null,
    lastFocusChar: null,
    pacingBeat: 'tension',
    turnsInCurrentBeat: 0,
    turnsSinceLastConflict: 0,
    sceneHistory: [],       // last N scene cards (for continuity)
  },

  /** @type {string|null} last rendered Scene Card */
  _lastSceneCard: null,

  // ── Init ──────────────────────────────────────────

  init() {
    this._state = {
      turnCount: 0,
      lastTone: null,
      lastConflictLevel: 0,
      lastNarrativeMove: null,
      lastFocusChar: null,
      pacingBeat: 'tension',
      turnsInCurrentBeat: 0,
      turnsSinceLastConflict: 0,
      sceneHistory: [],
    }
    this._lastSceneCard = null
  },

  reset() {
    this.init()
  },

  // ── Main Director Cycle ────────────────────────────

  /**
   * Run the full director cycle — ONE unified pass that makes all 5 decisions
   * and outputs a single Scene Card.
   *
   * @param {object} inputs
   * @param {object} inputs.character — full character descriptor (carries _aiis/_ands/_das/_dcs)
   * @param {object} inputs.uskState — raw USK
   * @param {object} inputs.arslEdges — from RelationshipPhysics
   * @param {object} inputs.sceneState — from DramaOrchestrator
   * @param {object} inputs.attentionMap — from AutonomousWorldEngine
   * @param {string} inputs.playerName
   * @param {object} inputs.dasTickResult — from DAS
   * @param {object} inputs.dcsResult — from DCS
   * @param {Array} inputs.characterNames — all character names
   * @returns {object} { sceneCard, decisions }
   */
  direct(inputs = {}) {
    const {
      uskState = {},
      arslEdges = {},
      sceneState = null,
      attentionMap = {},
      playerName = '玩家',
      dasTickResult = null,
      dcsResult = null,
      characterNames = [],
    } = inputs

    this._state.turnCount++

    // ── Decision 1: Evaluate scene ──
    const sceneEval = evaluateScene(uskState, sceneState, arslEdges, this._state.turnCount)

    // ── Decision 2: Choose tone ──
    const dasTensionState = dasTickResult?.tensionState || 'NORMAL'
    const tone = chooseTone(sceneEval, this._state, dasTensionState)

    // ── Decision 3: Select focus ──
    const spotlightResult = dcsResult?.spotlight || null
    const focus = selectFocusCharacter(playerName, characterNames, uskState, spotlightResult)

    // ── Decision 4: Decide conflict level ──
    // Get pacing beat from DCS or track internally
    const pacingBeat = dcsResult?.pacing?.currentBeat || this._state.pacingBeat
    const conflictLevel = decideConflictLevel(
      sceneEval, dasTensionState, pacingBeat, this._state.turnsSinceLastConflict,
    )

    // ── Decision 5: Decide narrative move ──
    const conflictDirection = dcsResult?.conflictDirection || null
    const narrativeMove = decideNarrativeMove(
      sceneEval, focus, conflictLevel, pacingBeat, conflictDirection,
    )

    // ── Update state ──
    this._state.lastTone = tone
    this._state.lastConflictLevel = conflictLevel
    this._state.lastNarrativeMove = narrativeMove
    this._state.lastFocusChar = focus.subFocus?.name || null
    this._state.pacingBeat = pacingBeat

    if (conflictLevel >= 2) {
      this._state.turnsSinceLastConflict = 0
    } else {
      this._state.turnsSinceLastConflict++
    }

    // ── Render Scene Card ──
    const branchCount = dcsResult?.branchLimit?.activeCount || 1
    const sceneCard = renderSceneCard({
      sceneEval,
      tone,
      focus,
      conflictLevel,
      narrativeMove,
      pacingBeat,
      spotlightResult,
      branchCount,
    })

    this._lastSceneCard = sceneCard

    // Track scene history
    this._state.sceneHistory.push({
      turn: this._state.turnCount,
      tone,
      conflictLevel,
      narrativeMove,
      focusChar: focus.subFocus?.name || playerName,
      timestamp: Date.now(),
    })
    if (this._state.sceneHistory.length > 30) {
      this._state.sceneHistory = this._state.sceneHistory.slice(-30)
    }

    return {
      sceneCard,
      decisions: {
        sceneEval,
        tone,
        toneLabel: TONES[tone]?.label || tone,
        focus,
        conflictLevel,
        narrativeMove,
        narrativeMoveLabel: NARRATIVE_MOVES[narrativeMove]?.label || narrativeMove,
        pacingBeat,
      },
    }
  },

  // ── Scene Card Access ──────────────────────────────

  /**
   * Get the last rendered Scene Card for prompt injection.
   */
  getSceneCard() {
    return this._lastSceneCard || ''
  },

  /**
   * Get the last director decisions (for debugging).
   */
  getLastDecisions() {
    return {
      tone: this._state.lastTone,
      conflictLevel: this._state.lastConflictLevel,
      narrativeMove: this._state.lastNarrativeMove,
      focusChar: this._state.lastFocusChar,
      pacingBeat: this._state.pacingBeat,
    }
  },

  /**
   * Get director state.
   */
  getState() {
    return { ...this._state }
  },
}
