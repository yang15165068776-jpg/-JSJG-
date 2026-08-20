import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, TabStopPosition, TabStopType,
  PageBreak, Header, Footer, PageNumber, NumberFormat,
} from 'docx'
import { writeFileSync, mkdirSync } from 'fs'

mkdirSync('作品集', { recursive: true })

const MONO = 'Consolas'
const BODY = 'Microsoft YaHei'
const CODE_FONT_SIZE = 18 // half-points = 9pt
const BODY_FONT_SIZE = 21 // half-points = 10.5pt
const HEADING_COLOR = '1a1a2e'
const ACCENT_COLOR = 'c41e3a'
const CODE_BG = 'f5f5f5'

function heading1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, font: BODY, bold: true, size: 32, color: HEADING_COLOR })],
    spacing: { before: 400, after: 200 },
    border: { bottom: { color: ACCENT_COLOR, size: 6, style: BorderStyle.SINGLE, space: 4 } },
  })
}

function heading2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, font: BODY, bold: true, size: 26, color: HEADING_COLOR })],
    spacing: { before: 300, after: 150 },
  })
}

function heading3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, font: BODY, bold: true, size: 22, color: '333333' })],
    spacing: { before: 200, after: 100 },
  })
}

function para(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, font: BODY, size: BODY_FONT_SIZE, ...opts })],
    spacing: { after: 80, line: 360 },
  })
}

function paraBold(text) {
  return para(text, { bold: true })
}

function paraAccent(text) {
  return para(text, { color: ACCENT_COLOR, bold: true })
}

function codeBlock(lines) {
  return lines.map(line =>
    new Paragraph({
      children: [new TextRun({ text: line || ' ', font: MONO, size: CODE_FONT_SIZE })],
      spacing: { after: 0, line: 280 },
      indent: { left: 360 },
      shading: { type: ShadingType.SOLID, fill: CODE_BG },
    })
  )
}

function bullet(text, level = 0) {
  return new Paragraph({
    children: [new TextRun({ text: '• ' + text, font: BODY, size: BODY_FONT_SIZE })],
    spacing: { after: 40, line: 340 },
    indent: { left: 360 + level * 360 },
  })
}

function emptyLine() {
  return new Paragraph({ spacing: { after: 80 } })
}

// ===================== DOCUMENT CONTENT =====================

const children = []

// ─── COVER PAGE ───
children.push(emptyLine(), emptyLine(), emptyLine(), emptyLine(), emptyLine())
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 200 },
  children: [new TextRun({ text: 'JSJG — 角色扮演对话 App', font: BODY, bold: true, size: 48, color: HEADING_COLOR })],
}))
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 100 },
  children: [new TextRun({ text: 'AI 驱动的双模式角色扮演对话系统', font: BODY, size: 28, color: '666666' })],
}))
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 100 },
  children: [new TextRun({ text: 'Writer-Reviewer 双模型管线架构', font: BODY, size: 24, color: ACCENT_COLOR })],
}))
children.push(emptyLine(), emptyLine())
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: '技术栈：React 18 + Vite + Tailwind CSS 3 + DeepSeek API', font: BODY, size: 22, color: '888888' })],
}))
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: '部署地址：https://jsjg.vercel.app', font: BODY, size: 22, color: '888888' })],
}))
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: '2026 年 6 月', font: BODY, size: 22, color: '888888' })],
}))

children.push(new Paragraph({ children: [new PageBreak()] }))

// ═══════════════════════════════════════════
// SECTION 1: PROJECT OVERVIEW
// ═══════════════════════════════════════════
children.push(heading1('一、项目概述'))

children.push(heading2('1.1 项目定位'))
children.push(para('JSJG 是一款 AI 驱动的角色扮演对话应用，支持日常模式和剧情模式两种交互形式。日常模式模拟微信聊天体验，剧情模式提供 GM（Game Master）第三人称全知叙事视角的长篇小说式互动。'))
children.push(para('核心创新在于 Writer-Reviewer 双模型管线架构：Writer AI（用户选择的主模型）生成方向正确的草稿，Reviewer AI（轻量 flash 模型）进行五项专项强化——情绪张力推到极限、意识流独白注入、潜台词裂缝加深、感官细节强化、黑暗特质具象化。'))

children.push(heading2('1.2 核心特性'))
children.push(bullet('双模式架构：日常微信聊天 + 剧情 GM 叙事'))
children.push(bullet('Writer-Reviewer 双模型管线：Writer 出草稿，Reviewer 五路强化'))
children.push(bullet('好感度独立裁判系统：独立 flash 模型判断好感度变化'))
children.push(bullet('阶段行为锁：角色行为随好感度阶段动态变化'))
children.push(bullet('反 RLHF 漂移三层防线：创作自由基线 + 反驯化封印 + Reviewer 强化'))
children.push(bullet('人设色彩感知：自动检测暖色系/冷色系角色并切换行为规范'))
children.push(bullet('流式 SSE 输出 + 违规词检测重试'))
children.push(bullet('全部数据 localStorage 持久化'))

children.push(heading2('1.3 技术栈'))
children.push(para('前端框架：React 18 + Vite'))
children.push(para('样式方案：Tailwind CSS 3'))
children.push(para('数据存储：localStorage（含 QuotaExceeded 保护）'))
children.push(para('AI 接口：DeepSeek API（OpenAI 兼容格式，base URL: https://api.deepseek.com）'))
children.push(para('部署平台：Vercel（https://jsjg.vercel.app）'))
children.push(para('无第三方状态管理库，无 react-router，API 调用纯 fetch'))

children.push(new Paragraph({ children: [new PageBreak()] }))

// ═══════════════════════════════════════════
// SECTION 2: ARCHITECTURE OVERVIEW
// ═══════════════════════════════════════════
children.push(heading1('二、架构总览'))

children.push(heading2('2.1 项目目录结构'))
children.push(...codeBlock([
  'src/',
  '├── main.jsx                 # 入口',
  '├── index.css                # Tailwind + 动画',
  '├── App.jsx                  # 状态路由（模式+页面切换）',
  '├── utils/',
  '│   ├── storage.js           # localStorage CRUD + QuotaExceeded 保护',
  '│   └── deepseek.js          # API 调用、system prompt 组装、Writer-Reviewer 管线',
  '└── pages/',
  '    ├── CharacterList.jsx    # 角色库',
  '    ├── CharacterForm.jsx    # 日常角色创建/编辑',
  '    ├── ChatRoom.jsx         # 通用对话页（双模式渲染）',
  '    ├── Settings.jsx         # API Key、模型选择、用户头像',
  '    ├── story/',
  '    │   ├── StoryCharacterForm.jsx   # 剧情角色创建（含可攻略角色）',
  '    │   └── StoryChat.jsx            # 剧情模式入口',
  '    └── daily/',
  '        └── DailyChat.jsx            # 日常模式入口',
]))

children.push(heading2('2.2 数据流架构'))
children.push(para('应用使用简单的 useState 状态路由，无 react-router。App.jsx 管理全局状态：当前页面（characterList/characterForm/chat/settings）、当前角色、消息列表、好感度数据。'))

children.push(para('对话数据流：'))
children.push(bullet('用户输入 → ChatRoom.doSend() → 组装 messages → sendStoryStageMessage() / sendCasualReply()'))
children.push(bullet('剧情模式：Writer 流式生成 → Reviewer 非流式强化 → 返回最终回复'))
children.push(bullet('好感度裁判异步并行触发，不阻塞 UI'))
children.push(bullet('所有消息实时写入 localStorage archive'))

children.push(new Paragraph({ children: [new PageBreak()] }))

// ═══════════════════════════════════════════
// SECTION 3: Writer-Reviewer PIPELINE (CORE)
// ═══════════════════════════════════════════
children.push(heading1('三、Writer-Reviewer 双模型管线（核心架构）'))

children.push(heading2('3.1 管线概览'))
children.push(para('这是本项目的核心创新。剧情模式的回复生成不是单次 API 调用，而是一个双模型管线：'))
children.push(emptyLine())
children.push(...codeBlock([
  '用户输入',
  '  │',
  '  ▼',
  '┌─────────────────────────────────┐',
  '│ Writer AI (主模型, stream)       │',
  '│ - 用户选择的模型 (deepseek-chat)  │',
  '│ - 精简 System Prompt (~2000 tok) │',
  '│ - 只负责方向正确的草稿           │',
  '│ - 三条底线约束                   │',
  '└──────────────┬──────────────────┘',
  '               │ writerReply (草稿)',
  '               ▼',
  '┌─────────────────────────────────┐',
  '│ Reviewer AI (flash, 非流式)     │',
  '│ - deepseek-v4-flash, temp=0.8   │',
  '│ - 【零】阶段行为容器（数据驱动） │',
  '│ - 【写作铁律】反文艺腔           │',
  '│ - 【一】情绪张力推到极限         │',
  '│ - 【二】意识流独白注入           │',
  '│ - 【三】潜台词裂缝加深           │',
  '│ - 【四】感官细节强化             │',
  '│ - 【五】黑暗特质具象化           │',
  '└──────────────┬──────────────────┘',
  '               │',
  '       ┌───────┴───────┐',
  '       ▼               ▼',
  '   增强版返回      失败→降级原版',
]))
children.push(emptyLine())

children.push(heading2('3.2 设计理念'))
children.push(para('传统方案（单 AI + 审查否决）的核心问题：'))
children.push(bullet('Writer 的 System Prompt 过于臃肿（~4200 token），承载了所有写作公式和情绪模板，导致模型注意力稀释'))
children.push(bullet('Reviewer 的七项审查几乎每次都能找到问题（尤其第7条"即使全通过，还不错就是不合格"），导致 Writer 输出被 Flash 模型改写版替代'))
children.push(bullet('审查→否决→改写的循环造成 Writer 重试，每次额外消耗 +10,000~15,000 token'))
children.push(emptyLine())
children.push(para('新方案的核心思想：'))
children.push(bullet('Writer 轻装上阵：System Prompt 从 ~4200 token 瘦身到 ~2050 token，砍掉 Section 8（写作风格）和 Section 8b（情绪爆发模板），只保留三条底线'))
children.push(bullet('Reviewer 从"审查者"变为"强化者"：不再判断通过/不通过，而是永远输出增强版。即使某项已经够好，至少保持原样'))
children.push(bullet('数据驱动的阶段行为容器：不为任何角色套用通用模板（"低好感度就该冷硬"），强制引用角色的 coreState / playerStrategy / languageSamples / forbiddenBehaviors'))

children.push(heading2('3.3 Token 成本对比'))
children.push(emptyLine())
// Token comparison table
const tokenTable = new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [
    new TableRow({
      tableHeader: true,
      children: ['指标', '旧架构（审查否决）', '新架构（强化）', '差额'].map((t, i) =>
        new TableCell({
          shading: { type: ShadingType.SOLID, fill: '1a1a2e' },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: t, font: BODY, bold: true, size: 20, color: 'ffffff' })],
          })],
        })
      ),
    }),
    ...['Writer System Prompt', 'Writer 上下文+输出', 'Reviewer 输入+输出', '每回合总计'].map((label, idx) => {
      const oldVals = ['~4,200', '~5,400', '~3,900*', '~13,500']
      const newVals = ['~2,050', '~5,150', '~4,600', '~11,800']
      const diffs = ['-2,150', '-250', '+700', '-1,700 (13%)']
      return new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: label, font: BODY, bold: true, size: 20 })] })],
          }),
          ...([0, 1, 2].map(j => {
            const isGreen = diffs[idx].startsWith('-')
            const isBold = idx === 3
            return new TableCell({
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({
                  text: (j === 0 ? oldVals[idx] : j === 1 ? newVals[idx] : diffs[idx]),
                  font: j === 2 ? MONO : BODY,
                  size: 20,
                  bold: isBold,
                  color: j === 2 ? (isGreen ? '2e7d32' : 'c62828') : '333333',
                })],
              })],
            })
          }))
        ],
      })
    }),
  ],
})
children.push(tokenTable)
children.push(para('*旧版 Reviewer 按 80% 不通过率加权平均。新版消除 Writer 重试炸弹，每次违禁词/审稿失败触发的重试节省 +10,000~15,000 token。'))

children.push(new Paragraph({ children: [new PageBreak()] }))

// ═══════════════════════════════════════════
// SECTION 4: Writer AI DETAIL
// ═══════════════════════════════════════════
children.push(heading1('四、Writer AI 详解'))

children.push(heading2('4.1 buildGMPrompt — System Prompt 组装'))
children.push(para('buildGMPrompt 函数负责为剧情模式组装 GM 的系统提示。结构如下：'))
children.push(emptyLine())
children.push(...codeBlock([
  'function buildGMPrompt(character, affections) {',
  '  const parts = []',
  '',
  '  // 0. 创作自由基线——成人向黑暗叙事授权 + 反洁净化封印',
  '  parts.push("高张力身体叙事/冲突授权，回避描写=人设崩坏")',
  '',
  '  // 1. 角色核心人设——最高优先级',
  '  //    每角色：背景/性格/行为准则/禁止词',
  '  //    + 当前阶段行为锁 (coreState/playerStrategy/',
  '  //      languageSamples/forbiddenBehaviors/stageDetails/',
  '  //      emotionalTraits/stageExplosion)',
  '  //    + 语言风格强制校准',
  '  //    + 反温和硬核框架 / 暖色系低好感度规范（条件触发）',
  '',
  '  // 2. GM身份 + 玩家铁律——禁控主角（对话/动作/心理/表情）',
  '',
  '  // 3. 世界观',
  '',
  '  // 4. 可攻略角色——好感度阶段精简',
  '  //    （当前阶段完整展开，其余仅名称+范围）',
  '',
  '  // 5. NPC设定',
  '',
  '  // 6. GM角色调度规则——角色自主生命线、冲突与屈服',
  '',
  '  // 7. 思考指令（<think>...</think>）',
  '',
  '  // 8. 写作底线——三条红线 (~50 token)',
  '  parts.push(',
  '    "1. 角色声音不能漂移：每句对话对照语言样本" +',
  '    "2. 结尾不能圆满" +',
  '    "3. 心理不能缺失：每300字至少一处心理层"',
  '  )',
  '',
  '  return parts.join("\\n\\n")',
  '}',
]))

children.push(heading2('4.2 反驯化系统'))
children.push(para('系统通过 detectPersonalityColor 函数自动检测角色的人设色彩（冷色系 dark / 暖色系 warm / 中性 neutral），然后根据好感度触发不同的行为框架：'))
children.push(emptyLine())

children.push(heading3('冷色系 → shouldActivateAntiTaming'))
children.push(para('当角色包含"傲娇/毒舌/偏执/疯批/恶劣/堕落/冷漠/腹黑/病娇/暴戾"等关键词，且好感度 < 30 或处于负面阶段时激活。注入四大反温和机制：'))
children.push(bullet('恶意解读机制：玩家善意 → 被解读为阴谋/弱点暴露 → 必须戒备/嘲弄/践踏'))
children.push(bullet('反居家温情禁令：严禁日常关心、暗中守护、客客气气'))
children.push(bullet('负面环境溢出：堕落特征必须溢出到场景和消息中'))
children.push(bullet('零救赎缓冲带：转折前严禁任何软化，内心动摇 → 外在更恶劣'))

children.push(heading3('暖色系 → shouldActivateWarmLowAffection'))
children.push(para('当角色包含"温柔/善良/阳光/单纯/软萌/小天使/体贴"等关键词，且好感度 < 30 或处于负面阶段时激活。人设色彩熔断——彻底禁用反温和协议，启用专属"不好好色"法则：'))
children.push(bullet('情绪出口限定：委屈的疏离 / 礼貌客套距离 / 默默忍受眼眶发红 / 卑微自我怀疑'))
children.push(bullet('绝对禁止：刻薄、堕落、残暴、冷漠带刺、阴阳怪气、去夜场酗酒'))
children.push(bullet('底层逻辑："我受伤了"而非"我恨你"，伤害指向自己'))

children.push(heading2('4.3 buildUserWrapper — 用户消息包装'))
children.push(para('每条用户消息注入 ~150 token 的精简包装：'))
children.push(...codeBlock([
  'function buildUserWrapper(character, affections) {',
  '  // 阶段校准：角色名｜阶段名｜好感度',
  '  //          禁止：xxx',
  '  //          语言样本：xxx',
  '  //          策略：xxx',
  '',
  '  return `',
  '    【本轮三条底线，违反任何一条立即重写】',
  '    1. 角色语气不能比语言样本更温柔',
  '    2. 结尾不能让场面平息或让玩家感到被安慰',
  '    3. 每300字至少一处心理层',
  '    生成草稿即可，后续有专项优化。',
  '  `',
  '}',
]))

children.push(new Paragraph({ children: [new PageBreak()] }))

// ═══════════════════════════════════════════
// SECTION 5: Reviewer AI DETAIL
// ═══════════════════════════════════════════
children.push(heading1('五、Reviewer AI 详解'))

children.push(heading2('5.1 reviewReply 函数签名'))
children.push(...codeBlock([
  'export async function reviewReply(',
  '  character,      // 角色对象（含 romanceCharacters/stage info）',
  '  affections,     // 当前好感度数据 { [name]: value }',
  '  userInput,      // 本轮用户输入的原始文本',
  '  writerReply,    // Writer 生成的草稿（前2000字）',
  '  apiKey          // DeepSeek API Key',
  ')',
  '// 返回值：{ reply, enhanced, error }',
  '//   enhanced=true  → reply = 强化后的完整正文',
  '//   enhanced=false → reply = Writer原版（降级兜底）',
]))

children.push(heading2('5.2 Reviewer System Prompt 完整结构'))

children.push(heading3('【零：阶段行为容器——最高优先级】'))
children.push(para('数据驱动，不套通用模板。强化前先回答三个问题（答案必须来自角色设定数据）：'))
children.push(bullet('该角色当前阶段的核心状态是什么？强化后是否还在这个状态内？'))
children.push(bullet('该角色当前阶段对玩家的策略是什么？强化后的行为是否符合这个策略？'))
children.push(bullet('语言样本是什么语气/节奏/情绪底色？强化后的对话是否还保持这个底色？'))
children.push(para('核心理念：不为任何角色套用"低好感度就该冷硬""高好感度就该温柔"的通用模板。角色数据才是唯一依据。'))

children.push(heading3('【写作铁律：直白粗粝，拒绝文艺腔】'))
children.push(para('封杀六类文艺写法：'))
children.push(bullet('文艺比喻："像羽毛落水面""如时光凝固"'))
children.push(bullet('抒情排比："他多想……他多想……"'))
children.push(bullet('诗意留白："一切尽在不言中"'))
children.push(bullet('抽象情绪词："心碎""绝望笼罩"'))
children.push(bullet('哲学感叹："也许这就是命运……"'))
children.push(bullet('唯美意象堆砌："月光洒在……""风吹发丝……"'))
children.push(para('要求：短句碎句、心理用身体写、对话像真人说话、不比喻不抒情不升华。'))

children.push(heading3('【一：情绪张力强化】'))
children.push(para('找到草稿里情绪最浓的节点，推到极限。嫉妒要更眼红，愤怒要更危险，欲望要更灼烫，恐惧要更真实。爆发写法：身体先行→行动越界→语言残缺→残留未平。'))

children.push(heading3('【二：意识流独白注入】'))
children.push(para('在情绪最激烈的段落前后，注入 8-12 行意识流独白。跳跃的、拉扯的、重复的、自我否定的——像真人崩溃边缘的内心。不需要克制长度，不需要给出清醒的结论。'))

children.push(heading3('【三：潜台词裂缝加深】'))
children.push(para('找到草稿里角色说出口的话，在旁边写出他没说出口的那句。格式：'))
children.push(para('"随你。"——他说。'))
children.push(para('他没有说：别走。'))

children.push(heading3('【四：感官细节强化】'))
children.push(para('每个情绪转折点配一个具体的感官细节。不写"他很激动"，写他激动时手在做什么、喉咙里是什么感觉、空气里有什么气味、皮肤上有什么温度。身体是情绪的容器，不是情绪的标签。'))

children.push(heading3('【五：黑暗特质具象化——反洁净化强制】'))
children.push(para('当角色人设包含薄情/放荡/冷血/暴力/恶意/羞辱/物化等黑暗特质时，必须通过具体行为和描写落地。封杀六种洁净化：'))
children.push(bullet('薄情者被写成"其实没动过心"——他就是没动过。写出来'))
children.push(bullet('放荡者被写成"以前的事，现在改了"——她没改。欲望是现在进行时'))
children.push(bullet('暴力倾向被写成"只是想吓唬你"——真的动手了。写那个疼痛'))
children.push(bullet('张力被写成"关灯/省略号/模糊带过"——打开灯，写具体的'))
children.push(bullet('羞辱/物化被写成"内心其实尊重对方"——不存在的事'))
children.push(bullet('堕落者被写成"内心仍有善良的一面"——善良保持离线'))

children.push(new Paragraph({ children: [new PageBreak()] }))

// ═══════════════════════════════════════════
// SECTION 6: KEY SYSTEMS
// ═══════════════════════════════════════════
children.push(heading1('六、关键子系统'))

children.push(heading2('6.1 好感度独立裁判系统'))
children.push(para('好感度变化不再由主回复 AI 判断，改为独立的 flash 模型调用：'))
children.push(bullet('函数：judgeAffectionDelta(character, affections, userInput, aiReply, apiKey)'))
children.push(bullet('模型：deepseek-v4-flash，temperature=0.3，max_tokens=512'))
children.push(bullet('角色不在场预检：基于 AI 回复文本检索角色名，未提及的角色跳过裁判'))
children.push(bullet('判断规则：被善待 +1~+2，预期被打破最高 +3，每次最多 ±3'))
children.push(bullet('返回值：{ changes: [{ name, delta }], error }，delta 范围 -3 到 +3'))
children.push(bullet('失败处理：静默跳过，不影响主回复流程'))
children.push(bullet('容错机制：多格式解析（[最终得分: X] → 降级提取数字），字段错位补救（reasoning_content 兜底）'))

children.push(heading2('6.2 好感度阶段系统'))
children.push(para('每个可攻略角色可配置多个好感度阶段（affectionStages[]），每个阶段包含：'))
children.push(bullet('name / min / max：阶段名称和好感度区间'))
children.push(bullet('coreState：当前核心状态（如"冷漠戒备""受伤退后""渴望占有"）'))
children.push(bullet('playerStrategy：对玩家的策略'))
children.push(bullet('languageSamples：本阶段语言样本（强制对标）'))
children.push(bullet('forbiddenBehaviors：本阶段绝对禁止的行为'))
children.push(bullet('stageDetails：必须高频穿插的表现细节'))
children.push(bullet('emotionalTraits：底层情绪特征'))
children.push(bullet('stageExplosion：随时可能引爆的转折点名场面'))
children.push(bullet('selfDriveBehaviors[]：自驱行为列表（含触发条件）'))
children.push(para('进度条百分比基于阶段 min/max 实际范围计算，正数绿色闪烁+上浮，负数红色闪烁。'))

children.push(heading2('6.3 流式响应 + 违规重试'))
children.push(para('所有 API 调用使用 fetch + SSE 流式解析，不使用任何第三方库。'))
children.push(bullet('streamCompletion 生成器函数：逐行解析 SSE data chunk，yield { content, reasoningContent, usage }'))
children.push(bullet('60s AbortController 超时保护'))
children.push(bullet('完成后违规词检测：命中特定词 → 告知模型具体命中的词 → 重试（最多3次）'))
children.push(bullet('流式中途断开：保留已接收的部分内容（isPartial: true）'))

children.push(heading2('6.4 思考层（Think）处理'))
children.push(bullet('System prompt 要求 AI 用 <think>...</think> 标签包裹思考'))
children.push(bullet('解析：三层正则兜底——<think> 主格式 → 【思考】闭合格式 → 裸标题格式'))
children.push(bullet('渲染：ThinkToggle 组件使用原生 HTML <details>/<summary>，移动端可靠折叠'))
children.push(bullet('清洗：cleanAndSplitResponse 和 fallback 都支持三种格式的移除'))

children.push(new Paragraph({ children: [new PageBreak()] }))

// ═══════════════════════════════════════════
// SECTION 7: DATA STRUCTURES
// ═══════════════════════════════════════════
children.push(heading1('七、数据结构'))

children.push(heading2('7.1 角色 JSON 结构'))
children.push(...codeBlock([
  '{',
  '  id, name, avatar(base64), background, nickname,',
  '  chatStyle: "casual" | "story",',
  '  styleRules[],          // 文风规则',
  '  forbiddenWords[],      // 禁止行为词（命中后自动重试，最多3次）',
  '  affectionEnabled, affectionInitial, affectionStages[],',
  '  thinkingEnabled, thinkingPrompt,',
  '  activeMessageEnabled, activeInterval,',
  '  activeCondition, activePrompt,',
  '  autonomyBehavior,      // AI 生成的自主行为总结',
  '',
  '  // 剧情模式专属',
  '  protagonistName/Background/Personality,',
  '  protagonistGender,',
  '  worldSetting, storyTone,',
  '  romanceCharacters[],   // 可攻略角色列表',
  '  npcs[],                // NPC 列表',
  '  contextWindow,         // 上下文窗口大小',
  '  temperature, topP,',
  '}',
]))

children.push(heading2('7.2 可攻略角色（RomanceCharacter）结构'))
children.push(...codeBlock([
  '{',
  '  name, avatar, background, personality, speakingStyle,',
  '  styleRules[], forbiddenWords[],',
  '  thinkingEnabled, thinkingPrompt,',
  '  affectionEnabled, affectionInitial,',
  '  affectionStages: [{',
  '    name, min, max,',
  '    coreState, playerStrategy,',
  '    languageSamples, forbiddenBehaviors,',
  '    stageDetails, emotionalTraits, stageExplosion,',
  '    selfDriveBehaviors: [{ behavior, trigger }],',
  '  }],',
  '  affectionUpRules, affectionDownRules,',
  '  erosionCondition, anchorSuppression,',
  '}',
]))

children.push(heading2('7.3 Reviewer 返回值'))
children.push(...codeBlock([
  '// reviewReply 返回值',
  '{',
  '  reply: string,       // 强化后的完整正文（或降级原版）',
  '  enhanced: boolean,   // true=成功强化，false=降级到原版',
  '  error: string|null,  // 错误信息（如有）',
  '}',
]))

children.push(new Paragraph({ children: [new PageBreak()] }))

// ═══════════════════════════════════════════
// SECTION 8: CODE APPENDIX
// ═══════════════════════════════════════════
children.push(heading1('八、关键代码附录'))

children.push(heading2('8.1 管线调用逻辑（sendStoryStageMessage 核心段）'))
children.push(para('以下为剧情模式 Writer → Reviewer 管线的核心调用代码：'))
children.push(...codeBlock([
  '// === Writer 生成草稿（流式）===',
  'let fullReply = ""',
  'for await (const chunk of streamCompletion(',
  '  apiMessages, apiKey, model, temperature, topP, thinkingEnabled',
  ')) {',
  '  if (chunk.content) {',
  '    fullReply += chunk.content',
  '    onToken(chunk.content, fullReply)  // 实时推送到 UI',
  '  }',
  '}',
  '',
  '// 违禁词检查（命中则重试，最多3次）',
  'const hit = findForbiddenWord(fullReply, activeWords)',
  'if (hit) { lastViolation = hit; continue }',
  '',
  '// === Reviewer 血肉强化（非流式）===',
  'const lastUserMsg = [...truncated]',
  '  .reverse().find(m => m.role === "user")',
  'const userText = lastUserMsg?.content || ""',
  '',
  'const { reply: finalReply, enhanced, error } =',
  '  await reviewReply(',
  '    character, affections,',
  '    userText, fullReply, apiKey',
  '  )',
  '',
  '// 强化版违禁词检查',
  'let outputReply = enhanced ? finalReply : fullReply',
  '// ... 违禁词命中则降级到原版 ...',
  '',
  'return { reply: outputReply, reasoningContent, usage }',
]))

children.push(heading2('8.2 好感度裁判调用'))
children.push(...codeBlock([
  '// ChatRoom.doSend 中异步调用，不阻塞 UI',
  'const result = await judgeAffectionDelta(',
  '  character, affections,',
  '  userInput, finalReply, apiKey',
  ')',
  'if (result.error) {',
  '  // 静默跳过，显示"本轮好感度无变化"',
  '  return',
  '}',
  '// 逐角色更新好感度',
  'for (const { name, delta } of result.changes) {',
  '  const newVal = clampAffection(',
  '    character, name,',
  '    (affections[name] || 50) + delta',
  '  )',
  '  setAffections(prev => ({ ...prev, [name]: newVal }))',
  '}',
]))

children.push(heading2('8.3 人设色彩检测'))
children.push(...codeBlock([
  'const DARK_KEYWORDS = [',
  '  "傲娇","毒舌","偏执","疯批","恶劣","堕落","冷漠",',
  '  "腹黑","病娇","暴戾","高冷","邪魅","残忍","阴沉",',
  '  // ... 共27个冷色系关键词',
  ']',
  'const WARM_KEYWORDS = [',
  '  "温柔","善良","阳光","单纯","软萌","小天使","体贴",',
  '  "治愈","乖巧","可爱","纯真","暖心","元气","开朗",',
  '  // ... 共34个暖色系关键词',
  ']',
  '',
  'export function detectPersonalityColor(character) {',
  '  // 扫描 background / personality / styleRules /',
  '  //        autonomyBehavior / romanceCharacters / storyTone',
  '  const darkHits = DARK_KEYWORDS.filter(kw => text.includes(kw)).length',
  '  const warmHits = WARM_KEYWORDS.filter(kw => text.includes(kw)).length',
  '  if (warmHits > 0 && darkHits === 0) return "warm"',
  '  if (darkHits > 0 && warmHits === 0) return "dark"',
  '  return "neutral"',
  '}',
]))

children.push(new Paragraph({ children: [new PageBreak()] }))

// ═══════════════════════════════════════════
// SECTION 9: DESIGN DECISIONS
// ═══════════════════════════════════════════
children.push(heading1('九、关键设计决策'))

const decisions = [
  ['纯 fetch API', '所有 AI 接口调用使用原生 fetch，不依赖任何第三方 SDK。流式解析手写 SSE parser。'],
  ['无状态管理库', '不用 Redux/Zustand。App.jsx useState 做简单状态路由，localStorage 做持久化。'],
  ['原生 <details> 折叠', 'ThinkToggle 组件使用 HTML <details>/<summary> 而非 React state + CSS transition，移动端兼容性最佳。'],
  ['违规重试而非拒绝', 'AI 输出包含禁止词时不直接拒绝，而是告知模型具体命中的违禁词后重试（最多3次）。'],
  ['好感度异步裁判', '不阻塞主回复流程。裁判失败静默跳过，用户体验不受影响。'],
  ['人设色彩熔断', '暖色系角色在低好感度时彻底禁用反温和协议，防止"温柔角色变刻薄"的人设崩坏。'],
  ['Reviewer 永远输出增强版', '不再判断通过/不通过。即使草稿已经很好，Reviewer 至少保持原样。失败时 Writer 原版兜底。'],
  ['三条底线替代写作公式', 'Writer 不再承载详细写作指令（四层心理公式、爆发模板等）。这些全部移交给 Reviewer 的专项强化。'],
  ['QuotaExceeded 保护', 'localStorage 满时自动截断旧消息（保留最近20条）→ 重试 → alert 提示。'],
  ['60s 超时保护', '所有流式请求都有 AbortController 60s 超时，防止连接挂死。'],
]
for (const [title, desc] of decisions) {
  children.push(heading3(title))
  children.push(para(desc))
}

children.push(new Paragraph({ children: [new PageBreak()] }))

// ═══════════════════════════════════════════
// SECTION 10: DEPLOYMENT
// ═══════════════════════════════════════════
children.push(heading1('十、部署与运维'))

children.push(heading2('10.1 Vercel 部署'))
children.push(bullet('平台：Vercel（https://vercel.com）'))
children.push(bullet('CLI 部署命令：npx vercel --prod'))
children.push(bullet('构建命令：npm run build（vite build）'))
children.push(bullet('生产地址：https://jsjg.vercel.app'))
children.push(bullet('每次部署自动别名到 jsjg.vercel.app'))

children.push(heading2('10.2 Git 工作流'))
children.push(bullet('分支策略：main 分支直接开发'))
children.push(bullet('Commit 规范：feat:/perf:/fix:/refactor:/docs: 前缀'))
children.push(bullet('关键提交记录：'))
children.push(...codeBlock([
  '1fba0ee refactor: Writer-Reviewer架构重构——Writer出草稿，Reviewer五路强化',
  '1d28fb1 docs: CLAUDE.md同步Writer-Reviewer架构重构',
  '8606692 perf: Reviewer直接改写替代Writer重试',
  'fb6835c perf: System Prompt瘦身',
  'f8c4508 feat: 审稿追加第七条——情绪张力增强',
]))

children.push(emptyLine(), emptyLine())
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: '— 文档结束 —', font: BODY, size: 22, color: '999999', italics: true })],
}))

// ===================== BUILD =====================

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: BODY, size: BODY_FONT_SIZE },
        paragraph: { spacing: { after: 80, line: 360 } },
      },
    },
  },
  sections: [{
    properties: {
      page: {
        margin: { top: 1440, bottom: 1440, left: 1200, right: 1200 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'JSJG 角色扮演对话 App — 项目架构文档', font: BODY, size: 16, color: 'aaaaaa', italics: true })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: '第 ', font: BODY, size: 16, color: 'aaaaaa' }),
            new TextRun({ children: [PageNumber.CURRENT], font: BODY, size: 16, color: 'aaaaaa' }),
            new TextRun({ text: ' 页', font: BODY, size: 16, color: 'aaaaaa' }),
          ],
        })],
      }),
    },
    children,
  }],
})

const buffer = await Packer.toBuffer(doc)
writeFileSync('作品集/JSJG_项目架构文档.docx', buffer)
console.log('✅ 文档已生成：作品集/JSJG_项目架构文档.docx')
console.log('   大小：' + (buffer.byteLength / 1024).toFixed(1) + ' KB')
