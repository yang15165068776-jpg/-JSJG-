/**
 * 🎯 TOM — Turn Objective Manager v1
 *
 * "每一轮都必须发生什么——角色不是在等待，而是在推进。"
 *
 * Core principle:
 *   CIE tells us WHAT the character wants (persistent, long-term).
 *   TOM tells us WHAT THIS TURN must accomplish (immediate, actionable).
 *
 * Without TOM:
 *   ❌ CIE intents are too abstract for CEK to execute directly
 *   ❌ "提高玩家投入程度" → CEK doesn't know what to do THIS turn
 *   ❌ Characters drift — no per-turn accountability for advancing their goals
 *
 * With TOM:
 *   ✅ CIE abstract intent → concrete per-turn objective with strategy
 *   ✅ Every turn has a push_level — how hard the character is driving
 *   ✅ Completion/failure conditions give CEK clear success criteria
 *   ✅ Backup strategy ensures characters don't stall when blocked
 *
 * Architecture:
 *   TOM is primarily rule-based (no LLM) — maps CIE intents + turn context
 *   → structured turn objectives. The NDC Director pass (in rse.js) provides
 *   LLM-level enhancement when CIE context is injected into its prompt.
 *
 * Flow:
 *   CIE State + Turn Context → TOM.schedule() → Turn Objectives → CEK v4
 */

import { detectAggressionProfile, AGGRESSION_PROFILES } from './aggressionProfile'

// ═══════════════════════════════════════════════════════════
// 1. Intent → Strategy Mapping
// ═══════════════════════════════════════════════════════════

/**
 * Maps CIE relationship_direction values to concrete strategy templates.
 * Each entry has preferred and backup strategies.
 */
const DIRECTION_STRATEGIES = {
  push_control: {
    tactics: [
      '制造一个只有角色能解决的危机',
      '突然冷淡——测试玩家会不会主动靠近',
      '公开和第三人互动——刺激玩家占有欲',
      '提出一个玩家难以拒绝的要求——测试服从度',
    ],
    pushBase: 65,
  },
  pull_dependency: {
    tactics: [
      '暴露一个弱点——看玩家是安慰还是利用',
      '给一点甜头然后收回——制造渴望',
      '暗示自己需要被拯救——引诱玩家投入',
      '若即若离——今天热情明天冷淡',
    ],
    pushBase: 50,
  },
  test_boundaries: {
    tactics: [
      '做一件明确越界的事——看玩家反应',
      '故意提到敏感话题——测试容忍度',
      '在玩家底线边缘试探——逼近但不突破',
      '制造一个两难选择题——逼玩家表态',
    ],
    pushBase: 55,
  },
  maintain_distance: {
    tactics: [
      '用沉默制造压迫感——不回应本身就是回应',
      '转移话题——拒绝被拉入亲密对话',
      '用第三人称/公事公办语气——拉开距离',
      '观察玩家的反应但表面不动声色',
    ],
    pushBase: 30,
  },
  self_destruct: {
    tactics: [
      '做出伤害自己的决定——让玩家来救',
      '公开做出最坏的选择——测试是否有人在乎',
      '把局面搞得更糟——既然已经烂了不如烂到底',
      '用最极端的方式表达不在乎——其实最在乎',
    ],
    pushBase: 80,
  },
}

/**
 * Maps common CIE primary_intent keywords to turn_objective templates.
 * Used when the CIE intent text contains these key phrases.
 */
const INTENT_TO_OBJECTIVE = [
  {
    match: /提高.*投入|加深.*依赖|让.*离不开/i,
    templates: [
      { objective: '让玩家主动证明她不会离开', strategy: '制造短暂距离，观察玩家是否主动填补', push: 60 },
      { objective: '测试玩家愿意为自己付出多少', strategy: '提出一个需要玩家牺牲的要求', push: 70 },
    ],
  },
  {
    match: /确认.*在乎|测试.*真心|验证.*感情/i,
    templates: [
      { objective: '诱导玩家主动表达关心', strategy: '隐藏真实情绪，制造一点异常让对方察觉', push: 50 },
      { objective: '制造一个情境让玩家必须选择立场', strategy: '引入第三方因素，看玩家站在哪边', push: 65 },
    ],
  },
  {
    match: /保护.*自己|维持.*距离|不.*受伤|安全.*距离/i,
    templates: [
      { objective: '在不让对方靠太近的前提下维持关系', strategy: '保持温和但明确的身体/语言界限', push: 25 },
      { objective: '测试对方是否能接受自己的节奏', strategy: '在对方靠近时后退半步，观察对方是否尊重', push: 30 },
    ],
  },
  {
    match: /获得.*控制|掌控.*局面|主导|占据.*上风/i,
    templates: [
      { objective: '在互动中确立控制权', strategy: '打断对方的节奏，把话题引向自己主导的方向', push: 75 },
      { objective: '让对方意识到谁在掌控这段关系', strategy: '给一个甜头然后立刻收回——控制给予的节奏', push: 80 },
    ],
  },
  {
    match: /报复|惩罚|让.*付出代价|伤害.*回去/i,
    templates: [
      { objective: '让对方感受到同等的痛苦', strategy: '精准打击对方最在意的东西——不是乱发脾气', push: 85 },
      { objective: '展示自己受到的伤害——不是求安慰，是控诉', strategy: '用冷淡和疏离代替直接攻击，更有效', push: 70 },
    ],
  },
  {
    match: /被.*爱|被.*接纳|渴望.*温暖|想要.*亲近/i,
    templates: [
      { objective: '在不暴露全部脆弱的前提下靠近对方', strategy: '给一点真实的自己，但留好退路', push: 40 },
      { objective: '测试对方是否真心——温柔往往是试探', strategy: '用小动作测试对方反应（靠近一点/碰一下/问一个私人问题）', push: 35 },
    ],
  },
  {
    match: /逃避|不想.*面对|拖延|回避/i,
    templates: [
      { objective: '避免深入对话——维持表面和平', strategy: '用工作/第三人/外部事件转移注意力', push: 15 },
      { objective: '拖延必须面对的决定', strategy: '含糊回应+转移话题+制造新的外部焦点', push: 20 },
    ],
  },
  {
    match: /重新.*定义|改变.*关系|打破.*现状/i,
    templates: [
      { objective: '打破现有的关系模式——旧规则不适用了', strategy: '做一件完全不符合之前行为模式的事——让对方措手不及', push: 70 },
      { objective: '让对方重新评估这段关系的性质', strategy: '突然改变态度——从被动变主动或反之', push: 65 },
    ],
  },
]

// ═══════════════════════════════════════════════════════════
// 2. Turn Context Analysis
// ═══════════════════════════════════════════════════════════

/**
 * Analyze the current turn context to adjust push_level and strategy selection.
 */
function _analyzeTurnContext(turnContext) {
  const { userText, turnCount, usk, rcName } = turnContext

  // Player input analysis
  const playerIsPassive = !userText || userText.trim().length < 5 || /^[。.…\s]*$/.test(userText)
  const playerIsEmotional = /恨|爱|气|哭|怕|在乎|在意|讨厌|恶心|喜欢|滚|分手/.test(userText || '')
  const playerIsConfronting = /你.*为什么|你到底|什么意思|你想.*怎样/.test(userText || '')
  const playerIsSoftening = /对不起|抱歉|我错了|原谅|好不好|求你/.test(userText || '')

  // Character state
  const charState = usk?.characters?.[rcName] || {}
  const tension = charState.tension?.global_tension || 50
  const affection = charState.relationship?.affection || 50

  return {
    playerIsPassive,
    playerIsEmotional,
    playerIsConfronting,
    playerIsSoftening,
    tension,
    affection,
    turnCount,
  }
}

// ═══════════════════════════════════════════════════════════
// 3. Core Scheduling Logic
// ═══════════════════════════════════════════════════════════

/**
 * Schedule turn objectives for all romance characters.
 *
 * @param {object} character — full character descriptor
 * @param {Map} cieState — CIE state map (charName → CIEOutput)
 * @param {object} turnContext — { turnCount, userText, usk }
 * @returns {Map<string, TOMOutput>} — charName → TOMOutput
 */
export function schedule(character, cieState, turnContext) {
  if (!cieState || cieState.size === 0) return null

  const rcList = character?.romanceCharacters || []
  if (rcList.length === 0) return null

  const results = new Map()

  for (const rc of rcList) {
    const cie = cieState.get(rc.name)
    if (!cie) continue

    const ctx = _analyzeTurnContext({ ...turnContext, rcName: rc.name })
    const profile = detectAggressionProfile(rc)

    const objective = _scheduleForCharacter(rc.name, cie, ctx, profile)
    results.set(rc.name, objective)
  }

  return results
}

/**
 * Schedule a turn objective for a single character.
 */
function _scheduleForCharacter(charName, cie, ctx, profile) {
  // Step 1: Find the best matching objective template from CIE primary_intent
  let bestMatch = null
  for (const entry of INTENT_TO_OBJECTIVE) {
    if (entry.match.test(cie.primary_intent || '')) {
      // Pick a template — alternate based on turn count for variety
      const idx = ctx.turnCount % entry.templates.length
      bestMatch = entry.templates[idx]
      break
    }
  }

  // Step 2: If no template match, derive from relationship_direction
  if (!bestMatch) {
    const dir = DIRECTION_STRATEGIES[cie.relationship_direction] || DIRECTION_STRATEGIES.test_boundaries
    const tacticIdx = ctx.turnCount % dir.tactics.length
    bestMatch = {
      objective: dir.tactics[tacticIdx],
      strategy: dir.tactics[(tacticIdx + 1) % dir.tactics.length],
      push: dir.pushBase,
    }
  }

  // Step 3: Adjust push_level based on turn context
  let pushLevel = bestMatch.push

  // Player is passive → character should push harder (don't let conversation die)
  if (ctx.playerIsPassive) pushLevel += 15

  // Player is emotional → character may push harder (emotional engagement = leverage)
  if (ctx.playerIsEmotional) pushLevel += 10

  // Player is confronting → character may pull back slightly (don't escalate blindly)
  if (ctx.playerIsConfronting) pushLevel -= 10

  // Player is softening → character can push more (player is vulnerable)
  if (ctx.playerIsSoftening) pushLevel += 10

  // High tension → moderate push (don't overshoot)
  if (ctx.tension > 70) pushLevel -= 10

  // Low tension → push harder (stagnation is death)
  if (ctx.tension < 30) pushLevel += 15

  // Low affection → higher push for pursuer/confrontational (conquest drive)
  // High affection → higher push for gentle (protectiveness drive)
  if (ctx.affection < 30) {
    if (profile === AGGRESSION_PROFILES.PURSUER || profile === AGGRESSION_PROFILES.CONFRONTATIONAL) {
      pushLevel += 10
    }
  } else if (ctx.affection > 70) {
    if (profile === AGGRESSION_PROFILES.GENTLE) {
      pushLevel += 10
    }
  }

  // Step 4: Personality modifiers
  switch (profile) {
    case AGGRESSION_PROFILES.PURSUER:
      pushLevel = Math.max(pushLevel, 50) // Pursuer never below 50
      pushLevel += 10
      break
    case AGGRESSION_PROFILES.CONFRONTATIONAL:
      pushLevel = Math.max(pushLevel, 40)
      pushLevel += 5
      break
    case AGGRESSION_PROFILES.ALOOF:
      pushLevel = Math.min(pushLevel, 60) // Aloof never above 60
      pushLevel -= 5
      break
    case AGGRESSION_PROFILES.GENTLE:
      pushLevel = Math.min(pushLevel, 70)
      pushLevel -= 10
      break
  }

  // Clamp
  pushLevel = Math.max(0, Math.min(100, Math.round(pushLevel)))

  // Step 5: Build completion and failure conditions
  const completionCondition = _deriveCompletion(bestMatch.objective, cie)
  const failureCondition = _deriveFailure(bestMatch.objective, cie)

  return {
    turn_objective: bestMatch.objective,
    completion_condition: completionCondition,
    failure_condition: failureCondition,
    preferred_strategy: bestMatch.strategy,
    backup_strategy: _deriveBackup(bestMatch.strategy, cie),
    push_level: pushLevel,
  }
}

// ═══════════════════════════════════════════════════════════
// 4. Condition Derivation
// ═══════════════════════════════════════════════════════════

function _deriveCompletion(objective, cie) {
  if (/主动.*证明|表达.*关心|开口|选择/.test(objective)) {
    return '玩家主动做出角色期待的行动——说话/表态/靠近'
  }
  if (/测试|试探|观察/.test(objective)) {
    return '角色获得了足够的信息来判断玩家的真实态度'
  }
  if (/制造|创造|引发/.test(objective)) {
    return '目标事件发生——玩家的情绪/行为出现了可观察的变化'
  }
  if (/避免|拖延|维持/.test(objective)) {
    return '本轮没有发生角色想避免的事——维持了现状'
  }
  if (/控制|掌控|主导/.test(objective)) {
    return '玩家按照角色的节奏行动——角色决定了互动的走向'
  }
  if (/惩罚|报复|伤害/.test(objective)) {
    return '玩家表现出了痛苦/后悔/动摇——角色的攻击产生了效果'
  }
  return '角色感觉到自己的行动推动了目标——即使只是一小步'
}

function _deriveFailure(objective, cie) {
  if (/主动.*证明|表达.*关心/.test(objective)) {
    return '玩家无动于衷——没有任何主动行为，对话陷入停滞'
  }
  if (/测试|试探/.test(objective)) {
    return '玩家给出了模糊/回避的回应——角色无法判断真实态度'
  }
  if (/制造|创造/.test(objective)) {
    return '角色预期的效果没有发生——局面没有任何变化'
  }
  if (/避免|拖延/.test(objective)) {
    return '玩家强行推进了角色想回避的话题/决定'
  }
  if (/控制|掌控/.test(objective)) {
    return '玩家反过来主导了互动——角色失去了控制权'
  }
  return '本轮结束时角色的目标没有任何推进——原地踏步'
}

function _deriveBackup(strategy, cie) {
  // Flip the approach: if preferred was active/aggressive, backup is passive/observational
  if (/制造|创造|主动|推动|进攻/.test(strategy)) {
    return '退后一步观察——不主动行动，用沉默和距离让对方感受到变化'
  }
  if (/观察|等待|退后|沉默/.test(strategy)) {
    return '主动出击——既然等待没效果，不如直接亮出底牌'
  }
  if (/测试|试探/.test(strategy)) {
    return '停止试探直接表态——有时候最直接的表达反而是最好的试探'
  }
  return '改变策略——用和之前完全不同的方式接近目标'
}

// ═══════════════════════════════════════════════════════════
// 5. Prompt Block Builders
// ═══════════════════════════════════════════════════════════

/**
 * Build a formatted prompt block from TOM outputs for injection into the system prompt.
 *
 * @param {Map<string, TOMOutput>} tomOutputs
 * @returns {string}
 */
export function buildTOMBlock(tomOutputs) {
  if (!tomOutputs || tomOutputs.size === 0) return ''

  const lines = ['━━━ 🎯 TOM · 本轮角色目标 ━━━']
  lines.push('以下目标由 Turn Objective Manager 生成本轮行动目标。')
  lines.push('角色不是被动回应——他们在主动推进自己的议程。')
  lines.push('')

  for (const [name, obj] of tomOutputs) {
    const pushBar = _pushBar(obj.push_level)
    lines.push(`【${name}】推进强度 ${pushBar} ${obj.push_level}/100`)
    lines.push(`  本轮目标：${obj.turn_objective}`)
    lines.push(`  首选策略：${obj.preferred_strategy}`)
    lines.push(`  备选策略：${obj.backup_strategy}`)
    lines.push(`  完成条件：${obj.completion_condition}`)
    lines.push(`  失败条件：${obj.failure_condition}`)
    lines.push('')
  }

  lines.push('❗ 角色必须在本轮回复中推进以上目标。不推进=角色没有议程=剧情死亡。')
  lines.push('━━━━━━━━━━━━━━━━━━━━━━')

  return lines.join('\n')
}

function _pushBar(level) {
  if (level >= 80) return '█████'
  if (level >= 60) return '████▌'
  if (level >= 40) return '███▌ '
  if (level >= 20) return '██▌  '
  return '█▌   '
}

/**
 * Build a compact TOM context for injection into the NDC Director prompt.
 * This is a condensed version — the full block goes into the main prompt via CEK.
 *
 * @param {Map<string, TOMOutput>} tomOutputs
 * @returns {string}
 */
export function buildTOMNDCContext(tomOutputs) {
  if (!tomOutputs || tomOutputs.size === 0) return ''

  return [...tomOutputs.entries()].map(([name, obj]) =>
    `${name}: 目标="${obj.turn_objective}" | 策略=${obj.preferred_strategy} | 推力度=${obj.push_level}/100`
  ).join('\n')
}

/**
 * Build an enriched NDC prompt supplement from CIE state.
 * This tells the NDC Director about persistent character motivations
 * so its per-turn plans are psychologically grounded.
 *
 * @param {Map} cieState — CIE state map
 * @returns {string}
 */
export function buildTOMEnrichedNDCContext(cieState) {
  if (!cieState || cieState.size === 0) return ''

  const lines = ['【🎯 角色长期心理动机 — 本轮 Director Plan 必须对齐以下动机】']
  for (const [name, intent] of cieState) {
    lines.push(`${name}:`)
    lines.push(`  核心意图: ${intent.primary_intent?.slice(0, 120) || '?'}`)
    lines.push(`  关系方向: ${intent.relationship_direction || '?'}`)
    lines.push(`  若玩家不行动: ${intent.autonomous_action?.slice(0, 100) || '?'}`)
    lines.push(`  核心恐惧: ${intent.fear?.slice(0, 80) || '?'}`)
  }
  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// 6. Fallback (when CIE state is unavailable)
// ═══════════════════════════════════════════════════════════

/**
 * Build fallback TOM objectives when CIE state is not yet available.
 * Uses aggression profiles + affection levels to generate basic objectives.
 *
 * @param {object} character
 * @param {object} usk
 * @returns {Map<string, TOMOutput>}
 */
export function buildFallbackTOM(character, usk) {
  const rcList = character?.romanceCharacters || []
  if (rcList.length === 0) return null

  const results = new Map()

  for (const rc of rcList) {
    const profile = detectAggressionProfile(rc)
    const aff = usk?.characters?.[rc.name]?.relationship?.affection ?? rc.affectionInitial ?? 50

    let objective, strategy, pushLevel

    switch (profile) {
      case AGGRESSION_PROFILES.PURSUER:
        objective = aff < 40
          ? '建立存在感——让对方无法忽视自己的存在'
          : '推进关系——让对方更进一步投入'
        strategy = aff < 40
          ? '制造不可预测的局面——忽冷忽热让对方猜不透'
          : '制造排他性情境——让对方只能关注自己'
        pushLevel = aff < 40 ? 65 : 55
        break
      case AGGRESSION_PROFILES.CONFRONTATIONAL:
        objective = '测试对方底线——看看这次能到什么程度'
        strategy = '在敏感话题边缘试探——推一点看反应，反应大就退'
        pushLevel = 50
        break
      case AGGRESSION_PROFILES.ALOOF:
        objective = '观察评估——不主动但也不退场'
        strategy = '保持存在但保持距离——让对方感受到被注视但不被靠近'
        pushLevel = 25
        break
      case AGGRESSION_PROFILES.GENTLE:
        objective = '建立安全感——让对方感到被关心'
        strategy = '温和的靠近——不施加压力，留足空间'
        pushLevel = 30
        break
      default:
        objective = '推进互动——不让对话陷入停滞'
        strategy = '根据对方的态度调整——回应对方的情绪但保持自己的方向'
        pushLevel = 40
    }

    results.set(rc.name, {
      turn_objective: objective,
      completion_condition: '角色感觉到互动有了实质推进',
      failure_condition: '对话陷入重复或停滞',
      preferred_strategy: strategy,
      backup_strategy: '改变策略——如果当前方式不奏效，换一个完全不同的角度',
      push_level: pushLevel,
      _fallback: true,
    })
  }

  return results
}
