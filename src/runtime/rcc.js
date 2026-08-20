/**
 * RCC — Role Constitution Compiler v1
 *
 * Position: Character Creation → RCC Compile → Store → Runtime Use
 *
 * RCC takes a character's full markdown/personality data (5000-20000 chars)
 * and compiles it into three structured outputs:
 *
 *   1. Constitution    — 10-20 unbreakable rules (P0/P1/P2) → RQA audit standard
 *   2. Runtime Guide   — behavioral preferences + strategies → CEK execution
 *   3. Hidden Psychology — subconscious drives → CEK/NOS narrative direction
 *
 * RCC runs ONCE at character save time, not every turn.
 * Runtime simply reads the pre-compiled rules — no per-turn LLM cost.
 *
 * Architecture:
 *   Character Data → RCC Prompt → LLM (user model) → JSON.parse → character._rcc
 *                                                          ↓
 *   Runtime: constitution → prompt injection (characterConstitution.js)
 *            runtimeGuide → CEK behavior decisions
 *            hiddenPsychology → CEK/NOS narrative strategy (NOT injected in prompt)
 */

import { getAuditModel } from '../utils/storage'

// ═══════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════

const BASE_URL = 'https://api.deepseek.com'

// ═══════════════════════════════════════════════════════════
// 1. Character Data Extractor
// ═══════════════════════════════════════════════════════════

/**
 * Extract a condensed character profile from the full character object.
 * Limits text length to keep the RCC prompt manageable.
 *
 * @param {object} character — full character descriptor
 * @returns {string} condensed markdown profile for RCC
 */
export function extractCharacterProfile(character) {
  if (!character) return ''

  const sections = []

  // ── Story header ──
  sections.push('# 故事设定')
  sections.push('故事名称：' + (character.name || '未命名'))
  if (character.worldSetting) sections.push('世界观：' + character.worldSetting.slice(0, 500))
  if (character.storyTone) sections.push('故事基调：' + character.storyTone)
  if (character.openingScenario) sections.push('开场场景：' + character.openingScenario.slice(0, 500))
  sections.push('')

  // ── Protagonist ──
  if (character.protagonistName) {
    sections.push('# 主角（玩家）')
    sections.push('名字：' + character.protagonistName)
    if (character.protagonistGender) sections.push('性别：' + character.protagonistGender)
    if (character.protagonistBackground) sections.push('背景：' + character.protagonistBackground.slice(0, 400))
    if (character.protagonistPersonality) sections.push('性格：' + character.protagonistPersonality.slice(0, 300))
    sections.push('')
  }

  // ── Romance Characters ──
  const rcList = character.romanceCharacters || []
  for (let i = 0; i < rcList.length; i++) {
    const rc = rcList[i]
    if (!rc.name) continue

    sections.push('# 可攻略角色 ' + (i + 1) + '：' + rc.name)
    if (rc.background) sections.push('背景：' + rc.background.slice(0, 800))
    if (rc.personality) sections.push('性格：' + rc.personality.slice(0, 600))
    if (rc.speakingStyle) sections.push('说话风格：' + rc.speakingStyle.slice(0, 300))

    // Style rules
    if (rc.styleRules?.length > 0) {
      const rules = rc.styleRules.filter(r => r.trim()).slice(0, 15)
      if (rules.length > 0) sections.push('行为规则：\n' + rules.map(r => '  - ' + r.trim()).join('\n'))
    }

    // Forbidden words
    if (rc.forbiddenWords?.length > 0) {
      const words = rc.forbiddenWords.filter(w => w.trim()).join('、')
      sections.push('禁止词汇：' + words)
    }

    // Affection stages
    if (rc.affectionEnabled && rc.affectionStages?.length > 0) {
      sections.push('## 好感度阶段')
      for (const stage of rc.affectionStages) {
        if (!stage.name) continue
        sections.push('### ' + stage.name + '（' + (stage.min ?? 0) + ' ~ ' + (stage.max ?? 100) + '）')
        if (stage.coreState) sections.push('核心状态：' + stage.coreState.slice(0, 400))
        if (stage.playerStrategy) sections.push('玩家策略：' + stage.playerStrategy.slice(0, 300))
        const fbArr = Array.isArray(stage.forbiddenBehaviors)
          ? stage.forbiddenBehaviors
          : String(stage.forbiddenBehaviors || '').split('\n')
        if (fbArr.length > 0) {
          const fbs = fbArr.filter(b => b.trim()).slice(0, 10)
          if (fbs.length > 0) sections.push('禁止行为：\n' + fbs.map(b => '  - ' + b.trim()).join('\n'))
        }
        const lsArr = Array.isArray(stage.languageSamples)
          ? stage.languageSamples
          : String(stage.languageSamples || '').split('\n')
        if (lsArr.length > 0) {
          const samples = lsArr.filter(s => s.trim()).slice(0, 5)
          if (samples.length > 0) sections.push('语言样例：' + samples.join(' / '))
        }
        if (stage.selfDriveBehaviors?.length > 0) {
          const drives = stage.selfDriveBehaviors.filter(d => d.description?.trim()).slice(0, 5)
          if (drives.length > 0) sections.push('自主行为：\n' + drives.map(d => '  - ' + d.description.trim()).join('\n'))
        }
        if (stage.riseCondition) sections.push('升级条件：' + stage.riseCondition.slice(0, 200))
        if (stage.emotionalTraits) sections.push('情绪特征：' + stage.emotionalTraits.slice(0, 200))
        if (stage.stageExplosion) sections.push('阶段爆发：' + stage.stageExplosion.slice(0, 200))
      }
    }

    // Key moments
    if (rc.erosionCondition) sections.push('反向侵蚀条件：' + rc.erosionCondition.slice(0, 300))
    if (rc.irreversibleMoment) sections.push('不可逆时刻：' + rc.irreversibleMoment.slice(0, 300))
    if (rc.transitionTriggers?.length > 0) {
      const triggers = rc.transitionTriggers.filter(t => t.trim()).slice(0, 10)
      if (triggers.length > 0) sections.push('阶段转换触发：\n' + triggers.map(t => '  - ' + t.trim()).join('\n'))
    }

    sections.push('')
  }

  // ── NPCs ──
  const npcs = character.npcs || []
  if (npcs.length > 0) {
    sections.push('# 世界中的 NPC')
    for (const npc of npcs) {
      if (!npc.name) continue
      const parts = [npc.name]
      if (npc.identity) parts.push('（' + npc.identity + '）')
      if (npc.personality) parts.push('— ' + npc.personality.slice(0, 100))
      sections.push('- ' + parts.join(' '))
    }
    sections.push('')
  }

  // ── Additional settings ──
  if (character.autonomyBehavior) {
    sections.push('# 角色自主性设定')
    sections.push(character.autonomyBehavior.slice(0, 500))
    sections.push('')
  }

  if (character.npcStyleLimit) {
    sections.push('# NPC风格限制')
    sections.push(character.npcStyleLimit.slice(0, 200))
    sections.push('')
  }

  return sections.join('\n')
}

// ═══════════════════════════════════════════════════════════
// 2. RCC Prompt Builder
// ═══════════════════════════════════════════════════════════

/**
 * Build the RCC compiler prompt.
 *
 * @param {string} characterProfile — condensed character profile from extractCharacterProfile()
 * @returns {string} RCC system + user prompt
 */
export function buildRCCPrompt(characterProfile) {
  return `你是 Role Constitution Compiler（角色宪法编译器）。

你不是角色。你不是作者。你不是聊天模型。

你的任务：将角色设定编译成机器可执行的运行规则。

# 输入
以下是完整的角色设定。请仔细阅读后编译。

${characterProfile}

# 输出要求

输出严格 JSON。分为三个部分：

## 1. constitution（角色宪法 — 10~20条不可违反的规则）

每条规则包含：
- article: 序号
- priority: "P0" | "P1" | "P2"
  - P0 = 违反必须重写（例：OOC、替玩家决定、编造历史）
  - P1 = 建议修正（例：情绪不连续、阶段越界）
  - P2 = 可忽略（例：描写密度、风格偏差）
- category: 分类 — Identity | Relationship | Personality | Behavior | Speech | Emotion | Desire | Conflict | Forbidden | Stage | Narrative
- rule: 具体规则（中文，简洁明确，一条规则只约束一件事）
- reason: 为什么存在这条规则（从角色设定推导的理由）
- violationExample: 违规例子（短）
- correctExample: 正确例子（短）

规则必须是：
✓ 可验证 — "角色是否违反了这条？"可以明确回答是/否
✓ 无歧义 — 不存在"视情况而定"
✓ 可运行 — 运行时模块能直接用
✗ 不是文学描述
✗ 不是角色介绍
✗ 不是写作建议

## 2. runtimeGuide（运行指南 — 给 CEK 执行引擎使用）

包含：
- speechPace: 说话节奏（快/慢/适中/沉默居多）
- speechStyle: 说话风格（直白/隐晦/讽刺/温柔/粗粝/简洁）
- verbalTics: 口头禅或习惯用语
- politenessLevel: 礼貌程度（粗鲁/随意/礼貌/恭敬）
- silenceTendency: 沉默倾向（高/中/低/只在特定情况下说话）
- conflictStrategy: 处理冲突的策略（正面攻击/冷暴力/讽刺/逃避/操控/沉默）
- emotionalExpression: 情绪表达方式（外放/压抑/间接/极端/冷淡）
- initiativeStrategy: 主动性策略（主动推进/等待对方/试探边界/制造危机）
- behavioralPreferences: 行为偏好（列出3-5条具体行为偏好）
- forbiddenActions: 绝对不能做的行为（列出3-5条）
- stageBehaviors: 各阶段的允许/禁止行为（如有好感度阶段设定）

## 3. hiddenPsychology（隐藏心理模型 — 给 CEK/NOS 使用，不注入 prompt）

角色的"源代码"——角色自己不知道的深层心理：
- trueGoal: 真正追求的目标（不是嘴上说的）
- hiddenFear: 隐藏的恐惧（最怕什么）
- selfWorthSource: 自我价值的来源（什么让角色觉得自己有价值）
- misinterpretationTendency: 误解倾向（容易把什么理解成什么）
- turningPoint: 关系转折点（什么情况会真正改变角色）
- unspokenDesire: 未说出口的渴望（对玩家/关系的真正渴望）
- internalConflict: 内部矛盾（角色内心的核心冲突）

# 重要提示
- 宁少勿滥。constitution 不超过 20 条。
- 每一条 constitution 必须能被动检检查。
- 不要编造设定中没有的内容。
- 只输出 JSON。不要任何解释或前缀。

输出格式（严格 JSON）：
{
  "constitution": [
    {
      "article": 1,
      "priority": "P0",
      "category": "Identity",
      "rule": "...",
      "reason": "...",
      "violationExample": "...",
      "correctExample": "..."
    }
  ],
  "runtimeGuide": {
    "speechPace": "...",
    "speechStyle": "...",
    "verbalTics": "...",
    "politenessLevel": "...",
    "silenceTendency": "...",
    "conflictStrategy": "...",
    "emotionalExpression": "...",
    "initiativeStrategy": "...",
    "behavioralPreferences": "...",
    "forbiddenActions": "...",
    "stageBehaviors": {}
  },
  "hiddenPsychology": {
    "trueGoal": "...",
    "hiddenFear": "...",
    "selfWorthSource": "...",
    "misinterpretationTendency": "...",
    "turningPoint": "...",
    "unspokenDesire": "...",
    "internalConflict": "..."
  }
}`
}

// ═══════════════════════════════════════════════════════════
// 3. API Call
// ═══════════════════════════════════════════════════════════

/**
 * Call the RCC compiler LLM.
 * Uses the user's selected model for highest quality compilation.
 *
 * @param {string} prompt — the full RCC prompt
 * @param {string} apiKey — DeepSeek API key
 * @param {string} model — model to use (defaults to user setting)
 * @returns {Promise<{raw: string, error?: string, usage?: object}>}
 */
async function callRCCCompile(prompt, apiKey, model) {
  if (!apiKey) {
    return { raw: '', error: 'No API key' }
  }

  const compileModel = model || getAuditModel() || 'deepseek-v4-flash'

  try {
    const response = await fetch(BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: compileModel,
        messages: [
          {
            role: 'system',
            content: '你是 JSON 编译器。你只输出合法 JSON。你精通角色分析和规则提炼。任何输入你都能提取出结构化的运行规则。',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 4096,  // Constitution + runtime guide + hidden psychology
        temperature: 0.3,  // Low temp for consistent compilation
        stream: false,
      }),
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      return { raw: '', error: errData.error?.message || `API error: ${response.status}` }
    }

    const data = await response.json()
    const raw = data.choices?.[0]?.message?.content || ''
    const usage = data.usage || null

    if (usage) {
      console.log('[RCC] Compilation tokens — prompt:', usage.prompt_tokens,
        '| completion:', usage.completion_tokens,
        '| total:', usage.total_tokens)
    }

    return { raw, usage }
  } catch (err) {
    return { raw: '', error: err.message }
  }
}

// ═══════════════════════════════════════════════════════════
// 4. Response Parser + Validator
// ═══════════════════════════════════════════════════════════

/**
 * Parse and validate RCC output.
 *
 * @param {string} raw — raw LLM output
 * @returns {{ success: boolean, rcc?: object, error?: string }}
 */
export function parseRCCOutput(raw) {
  if (!raw || !raw.trim()) {
    return { success: false, error: 'Empty RCC output' }
  }

  try {
    // Strip markdown code fences
    let jsonStr = raw.trim()
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim()
    }

    // Strip non-JSON prefix/suffix
    const braceStart = jsonStr.indexOf('{')
    const braceEnd = jsonStr.lastIndexOf('}')
    if (braceStart === -1 || braceEnd === -1 || braceEnd <= braceStart) {
      return { success: false, error: 'No JSON object found in RCC output' }
    }
    jsonStr = jsonStr.slice(braceStart, braceEnd + 1)

    const parsed = JSON.parse(jsonStr)

    // ── Validate constitution ──
    const constitution = Array.isArray(parsed.constitution) ? parsed.constitution : []
    const validConstitution = constitution.filter(article => {
      return article.rule && typeof article.rule === 'string' && article.rule.trim().length > 0
    }).map((article, i) => ({
      article: article.article || (i + 1),
      priority: ['P0', 'P1', 'P2'].includes(article.priority) ? article.priority : 'P1',
      category: article.category || 'Behavior',
      rule: article.rule.trim(),
      reason: article.reason || '',
      violationExample: article.violationExample || '',
      correctExample: article.correctExample || '',
    }))

    if (validConstitution.length === 0) {
      return { success: false, error: 'No valid constitution articles found' }
    }

    // ── Validate runtime guide ──
    const guide = parsed.runtimeGuide || {}
    const runtimeGuide = {
      speechPace: guide.speechPace || '',
      speechStyle: guide.speechStyle || '',
      verbalTics: guide.verbalTics || '',
      politenessLevel: guide.politenessLevel || '',
      silenceTendency: guide.silenceTendency || '',
      conflictStrategy: guide.conflictStrategy || '',
      emotionalExpression: guide.emotionalExpression || '',
      initiativeStrategy: guide.initiativeStrategy || '',
      behavioralPreferences: guide.behavioralPreferences || '',
      forbiddenActions: guide.forbiddenActions || '',
      stageBehaviors: guide.stageBehaviors || {},
    }

    // ── Validate hidden psychology ──
    const psych = parsed.hiddenPsychology || {}
    const hiddenPsychology = {
      trueGoal: psych.trueGoal || '',
      hiddenFear: psych.hiddenFear || '',
      selfWorthSource: psych.selfWorthSource || '',
      misinterpretationTendency: psych.misinterpretationTendency || '',
      turningPoint: psych.turningPoint || '',
      unspokenDesire: psych.unspokenDesire || '',
      internalConflict: psych.internalConflict || '',
    }

    return {
      success: true,
      rcc: {
        constitution: validConstitution,
        runtimeGuide,
        hiddenPsychology,
        compiledAt: Date.now(),
      },
    }
  } catch (e) {
    return { success: false, error: 'JSON parse failed: ' + e.message }
  }
}

// ═══════════════════════════════════════════════════════════
// 5. Main Entry Point
// ═══════════════════════════════════════════════════════════

/**
 * Compile a character into executable rules.
 * Runs ONCE at character save time.
 *
 * @param {object} character — full character descriptor
 * @param {string} apiKey — DeepSeek API key
 * @param {object} opts — options
 * @param {string} opts.model — override model (default: user setting)
 * @param {function} opts.onProgress — progress callback (phase: string)
 * @returns {Promise<{ success: boolean, rcc?: object, error?: string, usage?: object }>}
 */
export async function compileCharacter(character, apiKey, opts = {}) {
  if (!character) {
    return { success: false, error: 'No character data' }
  }

  if (!apiKey) {
    return { success: false, error: 'No API key — cannot compile character' }
  }

  // Step 1: Extract profile
  if (opts.onProgress) opts.onProgress('extracting')
  const profile = extractCharacterProfile(character)

  if (!profile || profile.length < 100) {
    return { success: false, error: 'Character profile too short to compile' }
  }

  // Step 2: Build prompt
  if (opts.onProgress) opts.onProgress('building')
  const prompt = buildRCCPrompt(profile)

  // Step 3: Compile
  if (opts.onProgress) opts.onProgress('compiling')
  const { raw, error, usage } = await callRCCCompile(prompt, apiKey, opts.model)

  if (error) {
    return { success: false, error, usage }
  }

  // Step 4: Parse
  if (opts.onProgress) opts.onProgress('parsing')
  const result = parseRCCOutput(raw)

  if (!result.success) {
    console.warn('[RCC] Parse failed:', result.error, '\nRaw output:', raw.slice(0, 500))
    return { success: false, error: result.error, usage }
  }

  console.log('[RCC] ✅ Compilation successful —',
    result.rcc.constitution.length, 'articles,',
    'guide fields:', Object.keys(result.rcc.runtimeGuide).filter(k => result.rcc.runtimeGuide[k]).length,
    'psych fields:', Object.keys(result.rcc.hiddenPsychology).filter(k => result.rcc.hiddenPsychology[k]).length)

  return { success: true, rcc: result.rcc, usage }
}

// ═══════════════════════════════════════════════════════════
// 6. Runtime Accessors
// ═══════════════════════════════════════════════════════════

/**
 * Check if a character has compiled RCC data.
 */
export function hasRCC(character) {
  return !!(character?._rcc?.constitution?.length > 0)
}

/**
 * Get the constitution articles for prompt injection.
 *
 * @returns {string} formatted constitution block for prompt
 */
export function getConstitutionBlock(character) {
  const rcc = character?._rcc
  if (!rcc?.constitution?.length) return ''

  const lines = ['━━━ ⚖️ CHARACTER CONSTITUTION（RCC 编译）━━━']

  for (const article of rcc.constitution) {
    const priorityMark = article.priority === 'P0' ? '🔴' : article.priority === 'P1' ? '🟠' : '🟡'
    lines.push(
      `${priorityMark} Article ${article.article} [${article.priority}] [${article.category}] ${article.rule}`
    )
  }

  lines.push('· 以上宪法规则不可违背。P0 规则违反必须重写。')
  return lines.join('\n')
}

/**
 * Get the runtime guide for CEK execution.
 *
 * @returns {object|null} runtime guide or null
 */
export function getRuntimeGuide(character) {
  return character?._rcc?.runtimeGuide || null
}

/**
 * Get the hidden psychology model for CEK/NOS.
 * This is NOT injected into the prompt — only CEK/NOS use it internally.
 *
 * @returns {object|null} hidden psychology or null
 */
export function getHiddenPsychology(character) {
  return character?._rcc?.hiddenPsychology || null
}

/**
 * Build a CEK strategy block from the runtime guide + hidden psychology.
 * This is a narrative directive for CEK, NOT a prompt injection.
 *
 * @returns {string} CEK strategy context
 */
export function buildCEKStrategyContext(character) {
  const guide = getRuntimeGuide(character)
  const psych = getHiddenPsychology(character)

  if (!guide && !psych) return ''

  const parts = []

  if (guide) {
    parts.push('【RCC 行为策略】')
    if (guide.conflictStrategy) parts.push('冲突策略：' + guide.conflictStrategy)
    if (guide.initiativeStrategy) parts.push('主动策略：' + guide.initiativeStrategy)
    if (guide.emotionalExpression) parts.push('情绪表达：' + guide.emotionalExpression)
    if (guide.speechPace) parts.push('说话节奏：' + guide.speechPace)
    if (guide.behavioralPreferences) parts.push('行为偏好：' + guide.behavioralPreferences)
    if (guide.forbiddenActions) parts.push('禁止行为：' + guide.forbiddenActions)
  }

  if (psych) {
    parts.push('')
    parts.push('【RCC 隐藏心理 — CEK 内部使用，不注入 prompt】')
    if (psych.trueGoal) parts.push('真实目标：' + psych.trueGoal)
    if (psych.hiddenFear) parts.push('隐藏恐惧：' + psych.hiddenFear)
    if (psych.misinterpretationTendency) parts.push('误解倾向：' + psych.misinterpretationTendency)
    if (psych.internalConflict) parts.push('内部矛盾：' + psych.internalConflict)
  }

  return parts.join('\n')
}

/**
 * Build RCC-enhanced RQA audit context.
 * Adds constitution article checklist to the RQA prompt.
 *
 * @returns {string} RQA audit supplement
 */
export function buildRQAAuditSupplement(character) {
  const rcc = character?._rcc
  if (!rcc?.constitution?.length) return ''

  const lines = ['## 角色宪法（RCC 编译 — 逐条对照检查）', '']

  for (const article of rcc.constitution) {
    lines.push(`Article ${article.article} [${article.priority}]：${article.rule}`)
    if (article.violationExample) {
      lines.push(`  违规例：${article.violationExample}`)
    }
  }

  lines.push('')
  lines.push('在 issues 数组中，如果违规涉及上述 Article，请在 type 字段中标注 "ArticleXX"（如 "Article03"）。')

  return lines.join('\n')
}
