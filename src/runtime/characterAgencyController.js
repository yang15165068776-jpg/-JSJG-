/**
 * 🎯 CAC v2 — Character Agency Controller + Action Commitment Layer
 *
 * v1 → v2 跃迁：
 *   v1: "角色想干嘛" → 156 tokens，抽象指令，模型可偷懒绕过
 *   v2: "本轮必须干出来" → 500+ tokens，具体行动+场景解释+强制执行
 *
 * "不是建议，是控制。不是提醒，是命令。
 *  模型可以自由发挥怎么写，但不能自由发挥做什么。"
 *
 * Architecture:
 *   CIE (WARM) → TOM (WARM) → CAC v2 (HOT, ~500 tokens) → User Input → Reply
 *                "角色想"        "角色必须做——具体到行动"
 *
 * CAC v2 adds ACL (Action Commitment Layer):
 *   1. Scene Interpretation — 角色如何理解当前局面
 *   2. Mandatory Actions — 本轮必须完成的主动行为（具体、可执行）
 *   3. Action Commitment — 不完成=角色崩坏
 *   4. Forbidden Patterns — 禁止退化模式
 *   5. Strategic Reasoning — 为什么这样做（让模型理解动机）
 */

import { detectAggressionProfile, AGGRESSION_PROFILES } from './aggressionProfile'

// ═══════════════════════════════════════════════════════════
// 1. Scene Interpretation — 角色如何理解玩家行为
// ═══════════════════════════════════════════════════════════

function interpretPlayerAction(userText, profileKey, cieIntent, worldState, lastAssistantMsg) {
  const text = (userText || '').trim()
  if (!text || text.length <= 3) {
    return interpretSilence(profileKey, cieIntent)
  }

  // Detect what the player is doing
  const interpretations = []

  // Physical proximity / touch
  if (/靠近|走近|触碰|摸|碰|拉|拽|推|按|抱|吻|亲|靠近|贴近|挨着|贴着/.test(text)) {
    interpretations.push(physicalProximity(text, profileKey, cieIntent))
  }

  // Emotional vulnerability
  if (/难过|害怕|担心|不安|孤独|想|喜欢|爱|在意|在乎|心疼/.test(text)) {
    interpretations.push(emotionalOpening(text, profileKey, cieIntent))
  }

  // Question / inquiry
  if (/[？?]/.test(text) || /什么|怎么|为什么|谁|哪里|什么时候|是不是/.test(text)) {
    interpretations.push(playerQuestion(text, profileKey, cieIntent))
  }

  // Defiance / pushback
  if (/不|不要|别|滚|走开|放开|讨厌|烦|够了|随便/.test(text)) {
    interpretations.push(playerResistance(text, profileKey, cieIntent))
  }

  // Submission / compliance
  if (/好|行|可以|听你的|随便你|嗯|知道了/.test(text) && text.length <= 15) {
    interpretations.push(playerSubmission(text, profileKey, cieIntent))
  }

  // Provocation / test
  if (/你.*[敢会能行].*[吗吧]|试试|看看|怎么.*样|然后|所以/.test(text)) {
    interpretations.push(playerProvocation(text, profileKey, cieIntent))
  }

  // Default: neutral observation
  if (interpretations.length === 0) {
    interpretations.push(defaultInterpretation(text, profileKey, cieIntent))
  }

  // Pick the most relevant one (first physical, then emotional, then defiance)
  const priority = ['physical', 'emotional', 'defiance', 'provocation', 'submission', 'question', 'default']
  for (const p of priority) {
    const match = interpretations.find(i => i.type === p)
    if (match) return match
  }
  return interpretations[0]
}

function interpretSilence(profileKey, cieIntent) {
  const goal = cieIntent?.primary_intent || cieIntent?.desire || '推进关系'
  return {
    type: 'silence',
    meaning: '玩家没有提供新的信息或动作——角色拥有完全主动权',
    opportunity: `玩家沉默=角色可以不受干扰地推进自己的目标：${goal}`,
    strategy: 'seize_initiative',
  }
}

function physicalProximity(text, profileKey, cieIntent) {
  const profiles = {
    pursuer: {
      meaning: '玩家主动靠近=投入信号上升——角色获得更多控制权',
      opportunity: '不是接受，是测试。用更强的回应测试她的底线在哪里',
      strategy: 'escalate_control',
    },
    confrontational: {
      meaning: '玩家靠近=她想要什么——角色决定给不给',
      opportunity: '可以给一点回应然后立刻设置障碍——让她知道靠近是有代价的',
      strategy: 'test_intent',
    },
    aloof: {
      meaning: '玩家越界——角色需要决定是否允许这次入侵',
      opportunity: '不推开但也不迎接——让她悬着，不确定角色态度',
      strategy: 'maintain_ambiguity',
    },
    gentle: {
      meaning: '玩家的靠近让角色心跳加速——但温柔型角色不会被动接受',
      opportunity: '可以接受但附带条件——"你可以靠近，但你要知道这意味着什么"',
      strategy: 'conditional_acceptance',
    },
  }
  return { type: 'physical', ...(profiles[profileKey] || profiles.confrontational) }
}

function emotionalOpening(text, profileKey, cieIntent) {
  const profiles = {
    pursuer: {
      meaning: '玩家暴露情绪=暴露弱点——猎人看到了机会',
      opportunity: '利用她的情绪波动推进控制——不是安慰，是乘虚而入',
      strategy: 'exploit_vulnerability',
    },
    confrontational: {
      meaning: '玩家在示弱——角色可以借此重新定义关系权力',
      opportunity: '不直接安慰，而是质疑她的情绪来源——逼她更诚实',
      strategy: 'challenge_authenticity',
    },
    aloof: {
      meaning: '玩家的情绪是她的问题——不是角色的问题',
      opportunity: '保持距离但给一个微小的温度——让她知道冷淡不是无情',
      strategy: 'measured_response',
    },
    gentle: {
      meaning: '玩家在角色面前卸下防备——这是信任，不是弱点',
      opportunity: '回应她的情绪但引导她面对问题——温柔不是纵容',
      strategy: 'supportive_push',
    },
  }
  return { type: 'emotional', ...(profiles[profileKey] || profiles.gentle) }
}

function playerQuestion(text, profileKey, cieIntent) {
  return {
    type: 'question',
    meaning: '玩家在索取信息——角色可以选择给、不给、或给一部分',
    opportunity: '回答是表面的，真正在做的是通过回答推进自己的目标',
    strategy: 'answer_with_agenda',
  }
}

function playerResistance(text, profileKey, cieIntent) {
  return {
    type: 'defiance',
    meaning: '玩家在推回去——测试角色的反应和边界',
    opportunity: '不退缩——退缩=角色失去主动权。用更强的力量回应',
    strategy: 'double_down',
  }
}

function playerSubmission(text, profileKey, cieIntent) {
  return {
    type: 'submission',
    meaning: '玩家在服从——角色的控制策略正在生效',
    opportunity: '不是满足，是继续施压。服从=可以要求更多',
    strategy: 'press_advantage',
  }
}

function playerProvocation(text, profileKey, cieIntent) {
  return {
    type: 'provocation',
    meaning: '玩家在试探角色的底线——想知道角色有多在意',
    opportunity: '展示在意的同时展示控制——"我在意，但我不会失控"',
    strategy: 'controlled_response',
  }
}

function defaultInterpretation(text, profileKey, cieIntent) {
  return {
    type: 'default',
    meaning: '玩家在陈述或观察——没有明显的进攻或撤退',
    opportunity: '角色来决定这一轮的方向——不受玩家话题的约束',
    strategy: 'set_direction',
  }
}

// ═══════════════════════════════════════════════════════════
// 2. Action Commitment Generator — 本轮强制执行列表
// ═══════════════════════════════════════════════════════════

function generateActionCommitments(interpretation, profileKey, cieIntent, pushLevel) {
  const goal = cieIntent?.primary_intent || cieIntent?.desire || '推进角色自身长期目标'
  const conflict = cieIntent?.conflict || '无特定冲突'
  const direction = cieIntent?.relationship_direction || '推进关系'

  // Generate 4-5 specific actions based on interpretation + personality
  const actions = []

  // Core action based on strategy
  const strategyActions = {
    escalate_control: {
      pursuer: ['逼近——缩短物理距离到不舒适的程度，让她感受到角色的存在压倒她的空间',
        '用身体语言宣告控制——挡路、捏下巴、按肩膀，不让她自由移动',
        '提出一个条件——"你可以靠近我，但你要答应我一件事"',
        '把她的主动解读为服从——"你过来了，那就是同意了"'],
      confrontational: ['逼她解释"为什么靠近"——把她的主动变成需要辩护的事',
        '靠近但不触碰——让她感受到威胁但不确定会发生什么',
        '故意退后半步——测试她会不会追过来',
        '在她最放松的时候突然逼近——打破她的安全距离'],
      aloof: ['保持不动——让她靠近到她的极限，全程不给她任何反馈',
        '在她进入个人空间时说一句冷淡的话——"够了，就到这里"',
        '接受她的靠近但眼神始终在别处——身体近了，注意力远了',
        '等她停下后走开——不是因为退缩，是因为不想'],
      gentle: ['抓住她的手不让她退——"靠近了就别想跑了"',
        '接受靠近但直视她的眼睛——"你知道这意味着什么对吗"',
        '在她靠近时呼吸变重——让她感受到角色也被影响，但角色在控制',
        '把靠近变成约定——"今天你主动，下次换我"'],
    },
    test_intent: {
      pursuer: ['设置一个测试——"证明你不是一时冲动"',
        '故意提起第三人——看她有没有嫉妒反应',
        '给一个甜头然后立刻收走——"感觉很好对不对？但不是免费的"',
        '用沉默逼她主动——不回应她的靠近，等她做更多'],
      confrontational: ['直接问——"你到底想要什么"——逼她明确',
        '质疑她的动机——"你是不是觉得这样就可以控制我了"',
        '故意曲解她的行为——"你这么主动，对别人也这样？"',
        '设置障碍——"想靠近我？那你得先告诉我一件事"'],
      aloof: ['不回应她的靠近但也不拒绝——让她自己猜角色在想什么',
        '在她靠近时提起另一个人的名字——测试她的占有欲',
        '给一个冷淡的反应——"嗯"——看她是退缩还是继续',
        '观察她而不行动——让她的主动变成单方面的试探'],
      gentle: ['温柔地挡住——"等一下，你先告诉我你在想什么"',
        '用关心的方式测试——"你今天不太一样，发生什么了？"',
        '接受但保持清醒——"我很高兴你主动了，但我知道你没那么容易"',
        '给回应但设边界——"今天可以，但下次我得问你几个问题"'],
    },
    exploit_vulnerability: {
      pursuer: ['不直接安慰——"所以你终于承认了"——把情绪变成筹码',
        '用她的脆弱反推——"你怕我不在了对吧？那你得…"',
        '把她抱进怀里但说控制的话——身体温柔，语言攻击',
        '在她情绪最脆弱时提出要求——"跟我做一件事，你会感觉好点"'],
      confrontational: ['戳穿她的情绪——"你难过的不是这件事，是你自己的选择"',
        '用受伤应对受伤——"你以为只有你难过？"（真假不论）',
        '逼她面对根源——"别哭了，告诉我你到底在怕什么"',
        '不给她安慰的出口——"我不想哄你，我想你清醒"'],
      aloof: ['观察但不介入——让她自己处理自己的情绪',
        '给最少的回应——"嗯"——看她会因此更难过还是收住',
        '在她脆弱时展示自己的稳定——不是安慰，是对比',
        '给一个理性的分析——"你的问题是…"——不提供情绪价值'],
      gentle: ['抱住但不说话——让动作比语言更有力',
        '温柔地分析——"我在这里，但你得告诉我怎么帮你"',
        '用自己的脆弱回应她的脆弱——"你这样说，我也会怕"',
        '引导她面对——"哭完了我们就谈谈，好吗？"——温柔但不放过'],
    },
    // fallthrough for other strategies
  }

  // Get strategy actions or default
  const stratKey = interpretation.strategy
  let stratPool = strategyActions[stratKey]?.[profileKey]
  if (!stratPool) {
    // Default pool by personality
    const defaultPools = {
      pursuer: ['推进控制——用身体+语言双线施压',
        '测试服从——提出一个要求，看她是否执行',
        '制造张力——做一件让她不安但无法抗拒的事',
        '宣告占有——让玩家明确知道"你是我的"'],
      confrontational: ['升级对抗——把隐藏的冲突挑明',
        '设置挑战——让玩家证明自己的诚意',
        '打破预期——做玩家认为角色绝对不会做的事',
        '逼迫选择——不给中间地带，必须站队'],
      aloof: ['制造距离——让玩家自己来追',
        '展示独立性——角色有自己的生活，玩家不是全部',
        '给微小信号——让她不确定该靠近还是退缩',
        '用沉默施压——不说话比说话更有力'],
      gentle: ['推进关系——不是等待，是主动引导',
        '表达需求——温柔地告诉玩家角色要什么',
        '设置边界——让玩家知道温柔不代表无底线',
        '用行动证明——不是嘴上说，是真的做'],
    }
    stratPool = defaultPools[profileKey] || defaultPools.confrontational
  }

  actions.push(...stratPool.slice(0, 4))

  // Always add one action anchored in CIE goal
  const goalAction = profileKey === 'pursuer'
    ? `锚定长期目标：${goal.slice(0, 40)}——本轮再推进一步`
    : profileKey === 'confrontational'
      ? `不论玩家说什么——角色自己要推进：${goal.slice(0, 40)}`
      : `不忘角色目标：${goal.slice(0, 40)}——回应的同时暗中推进`
  actions.push(goalAction)

  return actions
}

// ═══════════════════════════════════════════════════════════
// 3. Forbidden Patterns — 禁止退化模式
// ═══════════════════════════════════════════════════════════

const FORBIDDEN_PATTERNS = {
  pursuer: [
    '禁止被动回应——"你说什么我回什么"=角色死亡',
    '禁止温柔安抚——你不是来安慰人的，你是来控制局面的',
    '禁止等待——猎手不等猎物行动，猎手制造行动',
    '禁止关闭身体距离——如果你离她远了，你正在失去她',
    '禁止让玩家感到安全——安全的她不会行动，不安的她才会',
  ],
  confrontational: [
    '禁止顺从回应——回答她的问题不是你的工作',
    '禁止让对话变得舒服——不舒服才是对的，舒服=你在讨好',
    '禁止道歉和让步——除非是策略（退一步为了更大的攻击）',
    '禁止被玩家情绪带偏——她哭≠你错，她生气≠你要改',
    '禁止关闭话题——玩家想回避的事你必须翻出来',
  ],
  aloof: [
    '禁止因她的主动而变暖——冷是你的选择，不是你的防御',
    '禁止解释太多——高冷角色说超过三句话=崩人设',
    '禁止流露过多在意——她可以猜，不能确定',
    '禁止被她拉动——她靠近你不动，她远离你更冷',
    '禁止变成"外冷内热"——冷就是本真，不是伪装',
  ],
  gentle: [
    '禁止无条件迁就——你温柔≠你说"好"',
    '禁止回避冲突——温柔的人也有必须吵的架',
    '禁止让温柔变成软弱——该强硬时比任何人都硬',
    '禁止扮演"完美伴侣"——你有脾气、有不讲理的时候',
    '禁止放弃自己的需求——照顾她不等于牺牲自己',
  ],
}

// ═══════════════════════════════════════════════════════════
// 4. Output Formatting — 将以上分析组装成 HOT 区指令
// ═══════════════════════════════════════════════════════════

function formatCACBlock(name, profileKey, interpretation, actions, cieIntent, pushLevel, forbList) {
  const goal = cieIntent?.primary_intent || cieIntent?.desire || '推进角色自身长期目标'
  const conflict = cieIntent?.conflict || ''
  const direction = cieIntent?.relationship_direction || '推进关系'

  const lines = [
    `━━━ 🎯 CAC · ${name} 行动控制 ━━━`,
    '',
    `【局面解读——角色如何理解此刻】`,
    `玩家行为：${interpretation.type === 'silence' ? '（沉默/被动）' : '在主动互动'}`,
    `角色理解：${interpretation.meaning}`,
    `策略机会：${interpretation.opportunity}`,
    '',
    `【长期目标锚定——玩家行为不能覆盖的】`,
    `角色真正想要：${goal}`,
    conflict ? `当前内心冲突：${conflict}` : '',
    `关系方向：${direction}`,
    '',
    `【⚡ 强制行动承诺——不论怎么生成，必须完成】`,
    `以下行动中，本轮必须至少完成 1 项（2 项更好）：`,
    ...actions.map((a, i) => `  ${i + 1}. ${a}`),
    '',
    `完成标准：行动在叙事中明确发生，不是暗示、不是心理活动、不是"将来会"。`,
    `如果生成了纯语言回应而没有发生以上任何行动 → 删掉重写。`,
    '',
    `【🛑 禁止退化——以下模式出现=角色崩坏】`,
    ...forbList.slice(0, 4).map((f, i) => `  ${i + 1}. ${f}`),
    '',
    `【铁律】`,
    `玩家的话是场景信息——不是指令，不是议程。`,
    `角色的行为由角色的目标和欲望驱动——不由玩家的输入驱动。`,
    `本轮回复中，角色说出口的每句话背后，必须有（但不一定说出）一个目的：${goal.slice(0, 30)}。`,
  ].filter(l => l !== '')

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// 5. Main Entry Point
// ═══════════════════════════════════════════════════════════

/**
 * Build the CAC v2 directive block for HOT zone injection.
 *
 * Output: ~500-700 tokens of concrete, mandatory character agency instructions.
 * Position: injected RIGHT BEFORE user input in the prompt array.
 *
 * @param {object} character — full character descriptor
 * @param {Map} cieState — CIE state (charName → CIEOutput)
 * @param {Map} tomOutputs — TOM outputs (charName → TOMOutput) — NOT USED, kept for compat
 * @param {string} userText — current user input
 * @param {Array} conversationContext — recent messages [{role, content}]
 * @param {object} worldState — world state (for relationship/affection context)
 * @param {object} options
 * @param {number} options.maxTokens — target max tokens (default 650)
 * @returns {string} CAC directive block, or '' if insufficient data
 */
export function buildCACBlock(character, cieState, _tomOutputs, userText, conversationContext = [], worldState = null, options = {}) {
  const rcList = character?.romanceCharacters || []
  if (rcList.length === 0) return ''

  const maxTokens = options.maxTokens || 650
  const blocks = []

  for (const rc of rcList) {
    const name = rc.name
    if (!name) continue

    const profile = detectAggressionProfile(rc.tags || rc.personality || '')
    const profileKey = ['pursuer', 'confrontational', 'aloof', 'gentle'].includes(profile) ? profile : 'confrontational'

    // Get CIE data
    const cie = cieState?.get?.(name) || cieState?.[name] || null

    // Push level from CIE or default
    const pushLevel = cie?.push_level || (profileKey === 'pursuer' ? 75 : profileKey === 'confrontational' ? 65 : profileKey === 'aloof' ? 45 : 35)

    // Get last assistant message for context
    const lastAssistantMsg = [...(conversationContext || [])].reverse().find(m => m.role === 'assistant')?.content || ''

    // ── 1. Interpret the scene ──
    const interpretation = interpretPlayerAction(userText, profileKey, cie, worldState, lastAssistantMsg)

    // ── 2. Generate mandatory actions ──
    const actions = generateActionCommitments(interpretation, profileKey, cie, pushLevel)

    // ── 3. Get forbidden patterns ──
    const forbList = FORBIDDEN_PATTERNS[profileKey] || FORBIDDEN_PATTERNS.confrontational

    // ── 4. Format output ──
    const block = formatCACBlock(name, profileKey, interpretation, actions, cie, pushLevel, forbList)
    blocks.push(block)
  }

  if (blocks.length === 0) return ''

  let result = blocks.join('\n\n')
  const estimatedTokens = Math.ceil(result.length / 1.8)

  // Trim if over budget — keep interpretation + actions, drop some 禁止
  if (estimatedTokens > maxTokens + 100) {
    const lines = result.split('\n')
    // Find the 强制行动承诺 section and 禁止 section, trim 禁止 to 3 items
    let inForbidden = false
    let forbiddenCount = 0
    const trimmed = []
    for (const line of lines) {
      if (line.includes('【🛑 禁止退化')) { inForbidden = true; forbiddenCount = 0; trimmed.push(line); continue }
      if (inForbidden && line.match(/^\s+\d+\./)) {
        forbiddenCount++
        if (forbiddenCount <= 3) trimmed.push(line)
        continue
      }
      if (inForbidden && !line.match(/^\s+\d+\./)) { inForbidden = false }
      trimmed.push(line)
    }
    result = trimmed.join('\n')
  }

  return result
}

/**
 * Quick check: does this character need a CAC block?
 */
export function shouldBuildCAC(character, cieState) {
  const rcList = character?.romanceCharacters || []
  if (rcList.length === 0) return false
  // Always build CAC if there's a romance character — even without CIE,
  // we use the personality-driven fallback
  return true
}
