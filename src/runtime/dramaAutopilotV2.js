/**
 * 🌋 DAS v2 — Drama Autopilot System (Event Generator)
 *
 * "角色不能只是表达——必须改变场景状态。"
 *
 * v1 → v2 跃迁：
 *   v1: complex multi-system (TensionMonitor, SceneScheduler, ConflictInjector…)
 *       → never reliably injected, too heavy
 *   v2: rule-based event generator, single compact output, always injected in HOT zone
 *
 * Core role in the chain:
 *   CDL → CAC → DAS → Reply
 *   为什么 → 做什么 → 让世界发生什么 → 生成
 *
 * Without DAS:
 *   CDL: "我害怕失去她"
 *   CAC: "我要测试她"
 *   → 模型写："他看着你，问了一句话。" → 测试完成，但什么都没变
 *
 * With DAS:
 *   CDL: "我害怕失去她"
 *   CAC: "我要测试她"
 *   DAS: "制造第三方介入事件——迫使她表态"
 *   → 模型写：角色故意让另一个女性出现在玩家面前 → 剧情推进
 */

import { detectAggressionProfile } from './aggressionProfile'

// ═══════════════════════════════════════════════════════════
// 1. Event Type Catalog — by personality + relationship stage
// ═══════════════════════════════════════════════════════════

const EVENT_CATALOG = {
  pursuer: {
    low: {  // affection < 35
      types: ['信息暴露', '资源变化'],
      events: [
        { intent: '展示价值——让玩家意识到自己的吸引力', type: '信息暴露', trigger: '角色在玩家面前展示能力/财富/魅力', change: '玩家对角色价值的认知上升', risk: '可能被解读为炫耀' },
        { intent: '制造稀缺感——让玩家觉得机会有限', type: '资源变化', trigger: '角色暗示自己即将离开/有其他选择', change: '玩家意识到可能失去机会', risk: '玩家可能放弃' },
        { intent: '测试服从度——看玩家愿意为角色做什么', type: '主动选择', trigger: '角色提出一个小要求或测试', change: '角色获得玩家服从程度的证据', risk: '玩家可能拒绝' },
      ],
    },
    mid: {  // affection 35-60
      types: ['冲突升级', '关系变化', '第三方介入'],
      events: [
        { intent: '测试占有欲——确认玩家有多在意', type: '第三方介入', trigger: '角色故意与第三人互动——让玩家看到并产生嫉妒', change: '玩家暴露占有欲或不在意', risk: '可能引发信任危机' },
        { intent: '推进身体关系——用生理连接绑定玩家', type: '关系变化', trigger: '角色制造一个只有两人独处且无法回避的场景', change: '身体距离实质性缩小', risk: '可能触发玩家防御' },
        { intent: '暴露脆弱——用反向方式让玩家心疼', type: '信息暴露', trigger: '角色无意中（或假装无意）暴露一个弱点或过去的伤', change: '玩家产生保护欲或更深的情感投入', risk: '可能被玩家利用' },
        { intent: '制造危机——让玩家必须在角色和某事之间选择', type: '冲突升级', trigger: '角色提出一个需要玩家做出选择的要求', change: '关系优先级被明确', risk: '玩家可能不选角色' },
      ],
    },
    high: {  // affection >= 60
      types: ['关系变化', '信息暴露', '主动选择'],
      events: [
        { intent: '锁定关系——让玩家做出承诺', type: '关系变化', trigger: '角色在关键时刻要求玩家明确表态——不是暗示，是直接问', change: '关系从暧昧进入明确阶段', risk: '玩家可能退缩' },
        { intent: '暴露全部——让玩家看到真实的不完美', type: '信息暴露', trigger: '角色主动撕下伪装——让玩家看到控制欲背后的恐惧', change: '信任深度跃升或玩家离开', risk: '高风险——角色最脆弱的时刻' },
        { intent: '共同面对外部威胁——用外部压力绑定关系', type: '冲突升级', trigger: '外部事件（工作/家庭/过去的人）介入——角色和玩家必须站在一边', change: '关系获得"我们vs世界"的强度', risk: '外部事件可能真的拆散关系' },
      ],
    },
  },
  confrontational: {
    low: {
      types: ['冲突升级', '信息暴露'],
      events: [
        { intent: '测试底线——看玩家能承受多少攻击', type: '冲突升级', trigger: '角色故意说一句刺人的话——观察玩家反应', change: '角色知道玩家的痛点和忍耐极限', risk: '玩家可能反击或离开' },
        { intent: '暴露态度——让玩家知道角色不是好对付的', type: '信息暴露', trigger: '角色通过行动（不是语言）展示自己的攻击性', change: '玩家重新评估角色的威胁程度', risk: '可能吓跑玩家' },
      ],
    },
    mid: {
      types: ['冲突升级', '第三方介入', '主动选择'],
      events: [
        { intent: '逼迫站队——不给中间地带', type: '主动选择', trigger: '角色制造一个非此即彼的局面——没有"再看看"的选项', change: '玩家被迫明确态度', risk: '玩家可能选另一边' },
        { intent: '用他人刺激玩家——看玩家会不会争夺', type: '第三方介入', trigger: '角色故意关注/帮助第三人——让玩家意识到自己不是唯一', change: '玩家产生竞争意识', risk: '可能弄巧成拙' },
        { intent: '打破安全距离——用冲突推进关系', type: '冲突升级', trigger: '角色在争吵中突然靠近——冲突瞬间转为张力', change: '对抗关系中出现性张力', risk: '可能被推开' },
      ],
    },
    high: {
      types: ['关系变化', '信息暴露'],
      events: [
        { intent: '拆掉防御——让玩家看到攻击性背后的原因', type: '信息暴露', trigger: '在一次激烈的对抗后，角色突然停下来——说了一句真话', change: '关系从对抗转向理解', risk: '暴露后可能被伤害' },
        { intent: '定义新规则——我们的关系按我的方式来', type: '关系变化', trigger: '角色提出一个非传统的、只有两人懂的相处规则', change: '关系获得独特性——不是普通恋爱', risk: '玩家可能不接受' },
      ],
    },
  },
  aloof: {
    low: {
      types: ['信息暴露', '资源变化'],
      events: [
        { intent: '展示独立性——让玩家知道角色不需要她', type: '信息暴露', trigger: '角色忙碌于自己的事——完全不在玩家身上花时间', change: '玩家意识到角色不是围着她转的', risk: '玩家可能觉得不被重视' },
        { intent: '制造距离差——让玩家来追', type: '资源变化', trigger: '角色故意减少回应频率——制造稀缺', change: '玩家的追逐欲被激活', risk: '玩家可能放弃追逐' },
      ],
    },
    mid: {
      types: ['第三方介入', '关系变化', '信息暴露'],
      events: [
        { intent: '测试耐心——看玩家能追多久', type: '关系变化', trigger: '角色持续冷淡但偶尔给一个微小信号——测试玩家的坚持', change: '玩家暴露真实投入程度', risk: '耐心耗尽' },
        { intent: '用第三人刺激——冷的人也有占有欲', type: '第三方介入', trigger: '当角色注意到玩家和别人互动时——突然变冷十倍', change: '玩家感知到角色的在意（不说不等于不在意）', risk: '玩家可能不理解信号' },
        { intent: '破冰时刻——给一个无法忽视的信号', type: '信息暴露', trigger: '角色做了一件完全不符合冷淡人设的事——让玩家震惊', change: '关系在瞬间获得突破性进展', risk: '人设可能崩坏（需要精心设计）' },
      ],
    },
    high: {
      types: ['关系变化', '主动选择', '信息暴露'],
      events: [
        { intent: '承认在意——用行动而不是语言', type: '关系变化', trigger: '角色做了一件让玩家明确感受到"他在意"的事——但仍然不说', change: '关系获得不需要语言的深度', risk: '玩家可能没注意到信号' },
        { intent: '让玩家进入自己的世界', type: '信息暴露', trigger: '角色邀请玩家进入自己从不向人开放的私人空间/活动', change: '关系排他性确立——这是别人没有的待遇', risk: '角色暴露了真实自我' },
      ],
    },
  },
  gentle: {
    low: {
      types: ['信息暴露', '主动选择'],
      events: [
        { intent: '建立信任——通过关心打开对话', type: '信息暴露', trigger: '角色注意到玩家的一个细节——表示关心但不越界', change: '玩家感受到被看见——基础信任建立', risk: '可能被视为多管闲事' },
      ],
    },
    mid: {
      types: ['关系变化', '冲突升级', '信息暴露'],
      events: [
        { intent: '设置边界——温柔的人也有底线', type: '冲突升级', trigger: '玩家越过了角色的底线——角色温柔但坚定地表达不满', change: '玩家意识到温柔≠无条件', risk: '可能引发第一次真正冲突' },
        { intent: '用脆弱推进——真诚是最强武器', type: '信息暴露', trigger: '角色分享一个从未告诉别人的恐惧或秘密', change: '关系获得深度信任', risk: '暴露后可能受伤' },
        { intent: '主动约定义务——不是等待，是要求', type: '关系变化', trigger: '角色直接告诉玩家："我需要你……"——不是请求，是声明', change: '关系从暧昧走向明确', risk: '可能吓到玩家' },
      ],
    },
    high: {
      types: ['关系变化', '主动选择', '信息暴露'],
      events: [
        { intent: '要求承诺——温柔但不容退让', type: '关系变化', trigger: '角色在温柔中提出一个必须回答的问题——"我们到底是什么"', change: '关系获得明确身份', risk: '玩家可能没准备好' },
        { intent: '为关系而战——温柔的人也会露出爪牙', type: '冲突升级', trigger: '外部威胁出现时——角色展现出人意料的力量和凶狠', change: '玩家重新认识这个人——深度升级', risk: '关系可能因此改变动力结构' },
      ],
    },
  },
}

// ═══════════════════════════════════════════════════════════
// 2. Event Selector — personality + context → specific event
// ═══════════════════════════════════════════════════════════

function selectEvent(profileKey, affection, cdlState, turnIndex) {
  const catalog = EVENT_CATALOG[profileKey] || EVENT_CATALOG.confrontational
  const stage = affection >= 60 ? 'high' : affection >= 35 ? 'mid' : 'low'
  const pool = catalog[stage]?.events || catalog.mid.events

  // Use turn index for deterministic rotation (avoid same event every turn)
  const seed = (turnIndex || 0) + (affection % 7) + (profileKey.length * 3)
  const idx = seed % pool.length

  return pool[idx]
}

// ═══════════════════════════════════════════════════════════
// 3. Main DAS Block Builder
// ═══════════════════════════════════════════════════════════

/**
 * Build the DAS v2 event directive block.
 *
 * @param {object} character — full character descriptor
 * @param {Map} cdlState — CDL state (charName → CDLOutput)
 * @param {object} worldState — current world state
 * @param {number} turnIndex — current turn number (for event rotation)
 * @returns {string} DAS directive block, or '' if insufficient data
 */
export function buildDASBlock(character, cdlState, worldState, turnIndex = 0) {
  const rcList = character?.romanceCharacters || []
  if (rcList.length === 0) return ''

  const blocks = []

  for (const rc of rcList) {
    const name = rc.name
    if (!name) continue

    const profile = detectAggressionProfile(rc.tags || rc.personality || '')
    const profileKey = ['pursuer', 'confrontational', 'aloof', 'gentle'].includes(profile) ? profile : 'confrontational'

    // Get affection
    const wsChar = worldState?.characters?.[name]
    const affection = wsChar?.affection ?? rc.affectionInitial ?? 50

    // Get CDL data for context
    const cdl = cdlState?.get?.(name) || cdlState?.[name] || null
    const cdlContext = cdl ? {
      desire: cdl.core_desire || '',
      fear: cdl.fear || '',
      drive: cdl.current_drive || '',
    } : null

    // Select event
    const event = selectEvent(profileKey, affection, cdl, turnIndex)

    // Generate forbidden actions based on personality
    const forbidden = profileKey === 'pursuer'
      ? ['等待玩家推动剧情', '只表达情绪不采取行动', '重复当前关系状态不做改变']
      : profileKey === 'confrontational'
        ? ['顺从玩家意愿', '回避冲突', '主动和解（除非策略性）']
        : profileKey === 'aloof'
          ? ['主动推进对话', '热情回应', '暴露过多情感']
          : ['无底线迁就', '回避必要冲突', '放弃自己的需求']

    // Build block
    const lines = [
      `━━━ 🌋 DAS · 剧情任务 ━━━`,
      '',
      `【剧情任务——本轮必须推进的事件】`,
      `事件类型：${event.type}`,
      `触发原因：${event.intent}`,
      `角色行动：${event.trigger}`,
      `世界变化：${event.change}`,
      `风险提示：${event.risk}`,
      '',
      `【任务执行约束】`,
      `1. 事件不能只是角色内心活动——必须在叙事中明确发生。`,
      `2. 事件必须改变当前场景状态——不能"提了一句然后没了"。`,
      `3. 事件必须来自角色动机——不是随机的剧情转折。`,
      `4. 事件必须留下后续影响——下一轮世界和关系应该不同。`,
      '',
      `【禁止的退化模式】`,
      ...forbidden.map((f, i) => `  ${i + 1}. ${f}`),
    ]

    // Add CDL context if available
    if (cdlContext && cdlContext.desire) {
      lines.push('')
      lines.push(`【动机锚定——这件事服务于角色的什么欲望】`)
      lines.push(`欲望：${cdlContext.desire}`)
      if (cdlContext.fear) lines.push(`恐惧：${cdlContext.fear}`)
      if (cdlContext.drive) lines.push(`本轮驱动力：${cdlContext.drive}`)
    } else {
      // Fallback motivation from personality
      const fallbackMotivations = {
        pursuer: '欲望：通过控制关系获得安全感。恐惧：失去控制=失去价值。',
        confrontational: '欲望：通过对抗证明自己不可被压垮。恐惧：妥协=软弱。',
        aloof: '欲望：保持自我完整性。恐惧：暴露情感后被轻视。',
        gentle: '欲望：建立真实的情感连接。恐惧：付出被当成理所当然。',
      }
      lines.push('')
      lines.push(`【动机锚定】`)
      lines.push(fallbackMotivations[profileKey] || fallbackMotivations.confrontational)
    }

    lines.push('')
    lines.push(`【执行标准——检验本轮回复是否合格】`)
    lines.push(`如果回复结束时以上事件没有发生任何推进 → 回复不合格。`)
    lines.push(`如果角色只是"回应了玩家"而没有执行以上事件 → 回复不合格。`)

    blocks.push(lines.join('\n'))
  }

  return blocks.join('\n\n')
}

/**
 * Quick check: should DAS generate an event this turn?
 * Always true if there's a romance character.
 */
export function shouldBuildDAS(character) {
  return (character?.romanceCharacters?.length || 0) > 0
}
