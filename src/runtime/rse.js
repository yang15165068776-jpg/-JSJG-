/**
 * RSE — Runtime Supervisor Engine v1
 *
 * Two-pass architecture:
 *   Pass 1 (NDC — Narrative Director Core): flash model → Director Plan
 *   Pass 2 (SUPERVISOR): flash model → check output against Plan
 *
 * NDC position: first in the Runtime pipeline.
 *   Characters execute. Director plans.
 *   Main model handles HOW. Director decides WHAT.
 *
 * RSE is NOT a writer. RSE does NOT generate narrative.
 * RSE only: plans (NDC) and checks (Supervisor).
 */

import { getAuditModel } from '../utils/storage'
import { getCurrentAffectionStage } from '../utils/deepseek'
import { detectAggressionProfile, AGGRESSION_PROFILES } from './aggressionProfile'

// ═══════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════

const BASE_URL = 'https://api.deepseek.com'
const FLASH_MODEL = 'deepseek-v4-flash'
const MAX_REWRITES = 1

// ═══════════════════════════════════════════════════════════
// 0. NDC Module-Level State (loop detection + rhythm)
// ═══════════════════════════════════════════════════════════

const _ndcState = {
  prevGoal: '',           // Previous turn's sceneGoal.type
  goalRepeatCount: 0,     // How many turns same goal repeated
  prevActions: [],        // Last 3 turns' primary actions (for loop detection)
  rhythm: 'push',         // Current rhythm phase: push | pull | hold | observe
  rhythmTurnCount: 0,     // Turns in current rhythm phase
  stagnationTurns: 0,     // Consecutive turns without expected change
  turnIndex: 0,
}

/**
 * Reset NDC internal state (call on session reset).
 */
export function resetNDCState() {
  _ndcState.prevGoal = ''
  _ndcState.goalRepeatCount = 0
  _ndcState.prevActions = []
  _ndcState.rhythm = 'push'
  _ndcState.rhythmTurnCount = 0
  _ndcState.stagnationTurns = 0
  _ndcState.turnIndex = 0
}

// ═══════════════════════════════════════════════════════════
// 1. API Call (shared by both passes)
// ═══════════════════════════════════════════════════════════

async function _callFlash(prompt, apiKey) {
  if (!apiKey) return { raw: '', error: 'No API key' }

  try {
    const model = getAuditModel() || FLASH_MODEL
    const response = await fetch(BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是 JSON 输出机。只输出合法 JSON。禁止任何其他文字。' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 2048,  // 🔧 v4 思考: 预留 reasoning_content 预算
        temperature: 0.1,
        stream: false,
      }),
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      return { raw: '', error: errData.error?.message || `API ${response.status}` }
    }

    const data = await response.json()
    const raw = data.choices?.[0]?.message?.content || ''
    return { raw }
  } catch (err) {
    return { raw: '', error: err.message }
  }
}

// ═══════════════════════════════════════════════════════════
// 2. PASS 1: NDC — Narrative Director Core
// ═══════════════════════════════════════════════════════════

/**
 * Run the NDC Director pass — generate a Director Plan.
 *
 * @returns {Promise<{ plan: object|null, error: string|null }>}
 */
export async function runDirectorPass(ctx, apiKey) {
  const { userInput, character, usk, prevIssues, cieState } = ctx
  const rcList = character?.romanceCharacters || []

  _ndcState.turnIndex++

  // ── Build character context ──
  const charBlocks = rcList.map(rc => {
    const aff = usk?.characters?.[rc.name]?.relationship?.affection ?? rc.affectionInitial ?? 50
    const stage = getCurrentAffectionStage(rc, aff)
    const profile = detectAggressionProfile(rc)
    return `${rc.name}（${rc.personality || '?'} / ${profile}）好感${aff} 阶段${stage?.name || '?'}`
  }).join('\n')

  // ── 🧠 CIE context — persistent character psychological motivations ──
  const cieCtx = cieState && cieState.size > 0
    ? '\n【🎯 角色长期心理动机 CIE——本轮 Director Plan 必须对齐以下动机】\n' +
      [...cieState.entries()].map(([name, intent]) =>
        `${name}: 核心意图="${(intent.primary_intent || '').slice(0, 100)}" | 关系方向=${intent.relationship_direction || '?'} | 自主行动="${(intent.autonomous_action || '').slice(0, 80)}" | 恐惧="${(intent.fear || '').slice(0, 60)}"`
      ).join('\n') + '\n'
    : ''

  // ── Loop detection context ──
  const loopCtx = _ndcState.goalRepeatCount >= 2
    ? `\n⚠️ 上一轮 Goal="${_ndcState.prevGoal}" 已重复${_ndcState.goalRepeatCount}轮。如果本轮仍然相同 → 必须推进，禁止原地循环。`
    : ''
  const rhythmCtx = `\n当前节奏相位：${_ndcState.rhythm}（第${_ndcState.rhythmTurnCount}轮）。push=推进/进攻，pull=收手/吊胃口，observe=观察反馈。`

  const prompt = `你是 Narrative Director Core（NDC）。你不是角色、不是作者、不是旁白。

你的唯一职责：决定本轮剧情要推进什么。角色负责演绎，你负责推进。

【最高原则】
剧情必须先有目标，再有正文。
主模型只负责"怎么写"。你负责"这一轮应该发生什么"。

【★人格驱动——最重要★】
角色的性格写在设定文本里。你必须从设定中提取关键人格特质，然后让指令体现这些特质。
步骤1：读角色的设定文本，找出2-3个核心人格关键词（如：控制欲极强/从不道歉/疯起来不要命/表面温柔实则偏执）
步骤2：基于这些具体特质生成指令——不是套用"疯批/病娇"的通用模板，而是根据设定里写的具体行为来
步骤3：指令中的行动必须是这个角色"会做的事"——设定里说他从不道歉，指令就不能让他说对不起；设定里说他不说话只盯人，指令就让他沉默压迫
★指令质量标准★：
- 好指令："你设定里写他生气时不说话只盯人→被玩家拒绝后，沉默三秒，然后慢慢走近直到把她困在墙和自己之间，还是不说话，就盯着她。"
- 差指令："角色生气地回应"——没有体现设定里的具体行为特征
角色温和=指令失败。你的指令必须让角色做出符合其设定文本中描述的具体极端行为。

【Scene Goal】
只有一个主目标。禁止多个Goal同时推进。
目标类型：试探/拉近/误会/吃醋/争执/缓和/揭露/诱导/交易/妥协/逃避/观察
目标必须具体。例：
  好："让玩家意识到角色在吃醋，但角色死不承认"
  好："角色制造两难局面，逼玩家做选择"
  差："继续对话"

【Scene Beat】
每轮应有2-4个节拍（Beat）。正文围绕Beat推进。
  例：Beat1:玩家靠近 → Beat2:角色观察 → Beat3:角色试探 → Beat4:停在等待回应
★每个节拍中的角色动作必须体现剧情张力——不是"他说"而是"他掐灭烟头靠过来"、不是"她难过"而是"她指甲掐进掌心"。动作要有力度、有后果、有情绪。

【Expected Change】
本轮结束时世界状态应发生什么变化。如：距离/信任/信息/情绪。
若连续2轮无变化 → Scene Dead，必须插入新刺激。

【Action Loop Detection】
若"摸手→拥抱→解扣子→靠近"等动作连续重复超过2轮 → 强制结束当前循环，进入新事件。

【Rhythm】
当前节奏相位：${_ndcState.rhythm}。
push=推进/进攻 | pull=收手/留白/吊胃口 | observe=观察玩家反馈后决定
每1-2轮自动切换相位。不要在push上连续停留超过2轮。${loopCtx}${rhythmCtx}
	${cieCtx}

${prevIssues?.length ? '【上轮审计问题——本轮必须避免】\n' + prevIssues.slice(-8).map((q, i) => `${i + 1}. ${q.dimension || q.type || '?'}: ${q.description || ''}${q.snippet ? ' "' + q.snippet + '"' : ''}`).join('\n') + '\n\n' : ''}【当前场景】${ctx.sceneContext || '未指定'}
【角色】\n${charBlocks}
【玩家输入】${userInput?.slice(0, 200) || '(空)'}
【上轮回复】${ctx.prevReply?.slice(0, 300) || '(首轮)'}

【输出——严格 JSON，包含两部分】

{
  "sceneGoal": {
    "type": "试探",
    "description": "具体描述——让玩家意识到角色在吃醋但角色死不承认",
    "priority": 1
  },
  "characterIntent": {
    "言默": { "goal": "确认玩家是否还会继续投入", "strategy": "保持高冷但留一个破绽让对方抓住", "emotion": "冷静外表下暗自期待" }
  },
  "sceneBeat": [
    "玩家抵达或做出动作",
    "角色观察并做出第一个试探",
    "玩家回应",
    "角色根据回应调整态度——推进或收手"
  ],
  "expectedChange": {
    "type": "距离",
    "description": "心理距离缩短——玩家意识到角色在试探自己"
  },
  "replyPlan": {
    "replyIntent": "确认玩家态度",
    "surfaceEmotion": "冷淡",
    "hiddenEmotion": "期待",
    "strategy": "保持高价值感、用停顿制造张力、给一点回应但不全给",
    "allowedActions": ["观察", "试探", "转移话题", "故意停顿"],
    "forbiddenActions": ["突然告白", "重复上一轮身体动作", "暴露真实依赖", "连续身体描写"],
    "requiredBeats": ["回应玩家本轮输入", "产生一个新信息", "留下下一轮的钩子"]
  },
  "forbidden": [
    "禁止重复上一轮的动作",
    "禁止连续停留在同一Beat上循环"
  ],
  "rhythm": "push",
  "runtimeDirective": "本轮重点不是亲密接触，而是确认双方心理距离。"
}

规则：
- sceneGoal.type 从：试探/拉近/误会/吃醋/争执/缓和/揭露/诱导/交易/妥协/逃避/观察 中选一个
- replyPlan.replyIntent 必须具体——不是"回应"，而是"确认态度"/"隐藏真实想法"/"制造距离"等
- replyPlan.forbiddenActions 必须根据角色阶段/关系值/历史生成，不能是泛泛的"禁止OOC"
- replyPlan.requiredBeats 2-3个——告诉主模型这轮必须完成什么
- 只输出 JSON`

  const { raw, error: callError } = await _callFlash(prompt, apiKey)
  if (callError || !raw) {
    console.warn('[NDC] Director pass failed:', callError || 'empty response from flash model')
    return { plan: _fallbackPlan(), error: callError || 'empty response' }
  }

  return parseDirectorResponse(raw)
}

function _fallbackPlan() {
  return {
    sceneGoal: { type: '推进', description: '推进剧情', priority: 0 },
    sceneBeat: ['角色回应玩家'],
    expectedChange: { type: '剧情', description: '剧情推进一步' },
    forbidden: ['禁止OOC', '禁止替玩家思考'],
    rhythm: _ndcState.rhythm,
    runtimeDirective: '推进剧情，停在等待玩家回应。',
  }
}

/**
 * Parse NDC response. Updates internal loop/stagnation/rhythm state.
 */
export function parseDirectorResponse(raw) {
  try {
    const jsonStr = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(jsonStr)

    // ── Update NDC internal state ──
    const goalType = parsed.sceneGoal?.type || ''
    if (goalType === _ndcState.prevGoal) {
      _ndcState.goalRepeatCount++
    } else {
      _ndcState.prevGoal = goalType
      _ndcState.goalRepeatCount = 0
    }

    // Rhythm auto-rotation
    const newRhythm = parsed.rhythm || _ndcState.rhythm
    if (newRhythm === _ndcState.rhythm) {
      _ndcState.rhythmTurnCount++
    } else {
      _ndcState.rhythm = newRhythm
      _ndcState.rhythmTurnCount = 1
    }
    // Force rhythm switch if stuck in push for 3+ turns
    if (_ndcState.rhythm === 'push' && _ndcState.rhythmTurnCount >= 3) {
      _ndcState.rhythm = 'pull'
      _ndcState.rhythmTurnCount = 1
      parsed._rhythmOverridden = true
    }

    // Stagnation detection
    if (!parsed.expectedChange || parsed.expectedChange.description === '无变化') {
      _ndcState.stagnationTurns++
    } else {
      _ndcState.stagnationTurns = 0
    }

    return { plan: parsed, error: null }
  } catch (e) {
    console.warn('[NDC] JSON parse failed:', e.message)
    return { plan: _fallbackPlan(), error: null }
  }
}

// ═══════════════════════════════════════════════════════════
// 3. Director Plan → Prompt Injection
// ═══════════════════════════════════════════════════════════

/**
 * Convert NDC Director Plan into prompt injection.
 * Compact format — plan goes first, before all other system messages.
 *
 * @param {object} plan — NDC Director Plan
 * @returns {string} prompt block
 */
export function injectContractIntoPrompt(plan) {
  if (!plan) return ''

  const lines = []

  // ═══ Scene Goal — the most important line ═══
  const goal = plan.sceneGoal
  lines.push(`━━━ 🎬 NDC · 本轮目标：${goal?.type || '?'} — ${goal?.description || '推进剧情'} ━━━`)

  // Runtime Directive
  if (plan.runtimeDirective) {
    lines.push(`导演指令：${plan.runtimeDirective}`)
  }

  // Character Intent (compact)
  if (plan.characterIntent) {
    const intents = Object.entries(plan.characterIntent).map(([name, ci]) =>
      `${name}:${ci.goal || '?'}/${ci.strategy || '?'}`
    )
    if (intents.length) lines.push(`角色意图：${intents.join(' | ')}`)
  }

  // Scene Beats
  if (plan.sceneBeat?.length) {
    lines.push(`节拍：${plan.sceneBeat.map((b, i) => `${i + 1}.${b}`).join(' → ')}`)
  }

  // Expected Change
  if (plan.expectedChange?.description && plan.expectedChange.description !== '无变化') {
    lines.push(`预期变化：${plan.expectedChange.type || ''} — ${plan.expectedChange.description}`)
  }

  // Rhythm
  const rhythm = plan._rhythmOverridden ? 'pull（自动切换：push过久）' : (plan.rhythm || _ndcState.rhythm)
  lines.push(`节奏：${rhythm}`)

  // Forbidden
  if (plan.forbidden?.length) {
    lines.push(`禁止：${plan.forbidden.join(' / ')}`)
  }

  // ═══ Reply Plan — actor's guide ═══
  const rp = plan.replyPlan
  if (rp) {
    lines.push('')
    lines.push(`🎭 回复意图：${rp.replyIntent || '?'} | 表层=${rp.surfaceEmotion || '?'} | 隐藏=${rp.hiddenEmotion || '?'}`)
    if (rp.strategy) lines.push(`策略：${rp.strategy}`)
    if (rp.allowedActions?.length) lines.push(`允许：${rp.allowedActions.join('、')}`)
    if (rp.forbiddenActions?.length) lines.push(`禁止：${rp.forbiddenActions.join(' / ')}`)
    if (rp.requiredBeats?.length) lines.push(`必须：${rp.requiredBeats.join(' → ')}`)
  }

  // Stagnation warning
  if (_ndcState.stagnationTurns >= 2) {
    lines.push(`⚠️ 已${_ndcState.stagnationTurns}轮无预期变化——本轮必须引入新刺激（电话/敲门/第三角色/意外事件/旧事重提）`)
  }

  // Loop warning
  if (_ndcState.goalRepeatCount >= 2) {
    lines.push(`⚠️ Goal"${_ndcState.prevGoal}"已重复${_ndcState.goalRepeatCount}轮——本轮必须推进，禁止原地循环`)
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━')
  return lines.join('\n')
}

/**
 * Backward-compat: returns the internal NDC state for coordinator.
 */
export function getNDCState() {
  return { ..._ndcState }
}

// ═══════════════════════════════════════════════════════════
// 4. PASS 2: Supervisor
// ═══════════════════════════════════════════════════════════

/**
 * Run the Supervisor pass — check generated output against the Runtime Contract.
 *
 * @param {string} output — main model generated text
 * @param {object} contract — the Runtime Contract from Director pass
 * @param {object} ctx — same ctx as Director (for character context)
 * @param {string} apiKey
 * @returns {Promise<{ passed: boolean, severity: string, violations: Array, revisionNotes: string }>}
 */

/**
 * Build a compact character personality snapshot for audit use.
 * Gives the Supervisor enough context to judge "is this in-character?"
 */
export function buildCharProfile(character, usk) {
  if (!character) return ''
  const rcList = character?.romanceCharacters || []
  if (rcList.length === 0) return ''

  const lines = []
  for (const rc of rcList) {
    const aff = usk?.characters?.[rc.name]?.relationship?.affection ?? rc.affectionInitial ?? 50
    const stage = getCurrentAffectionStage(rc, aff)
    const profile = detectAggressionProfile(rc)

    lines.push('【' + rc.name + '】')
    lines.push('  人格：' + (rc.personality || '未设定'))
    lines.push('  背景：' + (rc.background || '').slice(0, 200))
    lines.push('  侵略类型：' + (profile || 'unknown'))
    lines.push('  好感度：' + aff + '（' + (stage?.name || '初始阶段') + '）')
    if (stage?.coreState) lines.push('  当前核心状态：' + stage.coreState)
    if (stage?.forbiddenBehaviors) lines.push('  阶段禁止行为：' + stage.forbiddenBehaviors)
    if (rc.speakingStyle) lines.push('  说话风格：' + rc.speakingStyle)
    if (rc.forbiddenWords?.length) lines.push('  禁词：' + rc.forbiddenWords.join('、'))

    switch (profile) {
      case AGGRESSION_PROFILES.PURSUER:
        lines.push('  ⚠️ 行为底线：不能温柔、不能讨好、不能暴露依赖。必须进攻/制造张力/保持猎手姿态。')
        break
      case AGGRESSION_PROFILES.CONFRONTATIONAL:
        lines.push('  ⚠️ 行为底线：不能顺从、不能妥协、不能示弱。必须对抗/找茬/用否定表达在乎。')
        break
      case AGGRESSION_PROFILES.ALOOF:
        lines.push('  ⚠️ 行为底线：不能热情、不能主动靠近、不能情绪外露。冷到极点的存在感压制。')
        break
      case AGGRESSION_PROFILES.GENTLE:
        lines.push('  ⚠️ 行为底线：温柔但不软弱。笑着说不行。温柔地不放过。')
        break
    }
    lines.push('')
  }

  const pp = character._playerProfile
  if (pp?.name) lines.push('玩家：' + pp.name + (pp.gender ? '（' + pp.gender + '）' : ''))

  return lines.join('\n')
}

export async function runSupervisorPass(output, contract, ctx, apiKey) {
  if (!contract) {
    // No contract → pass through (Director must have failed)
    return { passed: true, severity: 'silent', violations: [], revisionNotes: '' }
  }

  const contractStr = JSON.stringify(contract, null, 2)
  // Build rich character profile so Supervisor can judge character fidelity
  const charProfile = buildCharProfile(ctx.character, ctx.usk)

  const charName = ctx.character?.name || '角色'
  const playerName = ctx.character?._playerProfile?.name || '玩家'

  const knownFacts = Array.isArray(ctx.knownFacts) ? ctx.knownFacts.filter(Boolean) : []
  const knownFactsBlock = knownFacts.length
    ? knownFacts.slice(0, 40).map(f => '  · ' + f).join('\n')
    : '  （无已确认事实）'

  const prompt = `你是 Reply Critic Layer（RCL）。你不是重写者、不是作者。你是质量控制。

对照 Director Plan + Reply Plan，审计主模型输出。

【Director Plan】
${contractStr}

【主模型输出】
${output?.slice(0, 1500) || '(空)'}

【★★★ 角色人设——最高优先级 ★★★】
${charProfile || '（无详细人设）'}

【上下文】角色：${charName} | 玩家：${playerName}

【已确认事实（Fact Ledger）——禁止编造或推翻】
${knownFactsBlock}

═══════════════════════════════════
审查维度（按优先级排序）
═══════════════════════════════════

① ★ Character Fidelity（角色人格——最重要！）★
对照上方【角色人设】，逐句检查回复是否偏离了角色的：
- 人格基调（pursuer不能温柔、confrontational不能顺从、aloof不能主动、gentle不能软弱）
- 当前阶段的行为约束（阶段禁止行为、核心状态）
- 说话风格（是否用了不符合人设的语气/用词）
- 禁词检查
❌ 致命违规（直接 P0 critical）：
  - pursuer/confrontational 角色出现温柔、深情、讨好、退让
  - 角色说出不符合阶段的行为（初期就告白/暴露依赖）
  - 角色行为违背人格底线（见上方行为底线）

② Intent Completion（意图完成）
是否完成了 replyIntent？如果 Plan 说要"试探"，回复不能只是描写风景。

③ Scene Progression（剧情推进）
相比上一轮，是否产生了新信息？禁止：纯动作描写、原地循环。

④ Action Repetition（动作重复）
最近3轮是否有相同动作？如果连续"摸手/靠近/低笑"→ 失败。

⑤ State Consistency（状态一致性）
是否违反 Scene State？如：衣服已脱 → 禁止"解开扣子"。

⑥ Relationship Accuracy（关系准确）
是否符合当前好感度阶段？低好感禁止深情告白。

⑦ Fantasy Preservation（戏剧性保留）
是否过度现实化/日常化？角色扮演需要张力、戏剧性。禁止变成普通聊天。

⑧ Fact Integrity（事实真实）★★ 虚构物证 = FACT_ERROR（P0 critical）★★
对照上方【已确认事实】，检查回复是否：
- 编造场景中【不存在】的物证/记录/监控——包括但不限于：
  · 门禁记录、监控画面、摄像头影像、设备异常、系统日志、告警信息
  · 用户「重复次数」「操作次数」「历史对话摘要」等无法确证的具体量化表述
  · 场景设定/已知事实中明确不存在的事物（如从未提及的保安、仪器、录像）
- 与【已确认事实】直接冲突：如 knownFacts 载明「角色未离开房间」，回复却写「他已经走了」
❌ 判定规则：
  - 只要场景未提供监控/门禁/日志系统，回复中出现即判定 FACT_ERROR，severity=critical
  - fixInstruction 必须给出具体删除/改写方案（改为场景内可感知的信息，如气味/声音/视野）

═══════════════════════════════════
输出——严格 JSON
═══════════════════════════════════

PASS (score >= 75):
{"passed":true,"score":85,"severity":"silent","violations":[],"fixInstruction":""}

FAIL (score < 75):
{"passed":false,"score":55,"severity":"critical","violations":[{"dimension":"Character Fidelity","description":"pursuer角色出现讨好式退让——回复中说'好，听你的'并且语气温柔，完全违背猎手人格底线","snippet":"好，听你的。","fixInstruction":"删除'好，听你的'整句。改为保持控制权的回应，例如：'他盯着你看了三秒，嘴角似笑非笑：\"行啊——但你得答应我一个条件。\"'——这样保持猎手身份：不退让、不讨好、把让步变成交易。"}],"fixInstruction":"全文级别修改指导（可选）：停止身体接触动作。改用语言试探或制造距离。"}

规则：
- score 0-100，75以上通过。人格底线违规直接 score < 50。
- FACT_ERROR：虚构场景不存在的物证/监控/记录/无法证实的量化 → dimension="Fact Integrity" + priority="P0"，直接 score < 50。
- severity: critical(P0违规——人格底线/人设崩塌)/major(明显问题)/minor(风格差异)
- ⚠️ 每个violation的fixInstruction必须是针对该violation的【具体修改方案】，包含：(1)明确指出原文哪里要改 (2)给出具体的替换文本或改写方向 (3)说明修改后的效果。不能是泛泛的"注意人设"或"调整语气"。
- 风格差异≠违规。不要吹毛求疵。
只输出 JSON。`

  let lastError = 'unknown audit failure'
  for (let attempt = 0; attempt < 2; attempt++) {
    const { raw, error: callError } = await _callFlash(prompt, apiKey)
    if (callError) {
      lastError = 'API error: ' + callError
      console.warn('[RCL] ' + lastError + ' — retry ' + (attempt + 1) + '/2')
      continue
    }
    if (!raw || !raw.trim()) {
      lastError = 'empty response'
      console.warn('[RCL] Empty response — retry ' + (attempt + 1) + '/2')
      continue
    }
    try {
      return parseSupervisorResponse(raw)
    } catch (e) {
      lastError = e.message
      console.warn('[RCL] Invalid audit response — retry ' + (attempt + 1) + '/2')
    }
  }
  throw new Error('RSE supervisor unavailable after 2 attempts: ' + lastError)
}

/**
 * Parse Supervisor response.
 */
export function parseSupervisorResponse(raw) {
  try {
    const jsonStr = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(jsonStr)
    return {
      passed: parsed.passed !== false,
      score: parsed.score ?? 75,
      severity: parsed.severity || 'silent',
      violations: Array.isArray(parsed.violations) ? parsed.violations : [],
      revisionNotes: parsed.fixInstruction || parsed.revision_notes || '',
    }
  } catch (e) {
    console.warn('[RCL] JSON parse failed:', e.message)
    throw new Error('RSE supervisor JSON parse failed: ' + e.message)
  }
}

// ═══════════════════════════════════════════════════════════
// 5. Revision Injection (Legacy — full rewrite, kept for compat)
// ═══════════════════════════════════════════════════════════

/**
 * Legacy: Build a revision prompt for full rewrite.
 * Prefer buildTargetedFixPrompt for spot-fix approach.
 *
 * @param {Array} violations — from Supervisor
 * @returns {string} revision instruction
 */
export function buildRevisionInjection(violations) {
  if (!violations?.length) return ''

  const lines = ['【RSE 审计失败——请修正以下违规后重新生成】', '']

  const p0 = violations.filter(v => v.priority === 'P0')
  const p1 = violations.filter(v => v.priority === 'P1')

  if (p0.length > 0) {
    lines.push('🔴 P0 必须修正：')
    for (const v of p0) {
      const label = v.dimension || v.type || '?'
      lines.push(`  · ${label}: ${v.description || ''}`)
      if (v.snippet) lines.push(`    违规片段："${v.snippet}"`)
    }
    lines.push('')
  }

  if (p1.length > 0) {
    lines.push('🟠 P1 需要修正：')
    for (const v of p1) {
      const label = v.dimension || v.type || '?'
      lines.push(`  · ${label}: ${v.description || ''}`)
    }
    lines.push('')
  }

  lines.push('请重新生成完整的回复——不要接着上一版的结尾写，从头开始。修正上述所有问题。')

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// 5.5 Targeted Fix Prompt Builder (v9 — spot-fix only)
// ═══════════════════════════════════════════════════════════

/**
 * Build a targeted fix prompt for the main model.
 *
 * Instead of "regenerate the entire reply", this provides the original reply
 * with marked problem areas and specific fix instructions. The main model only
 * modifies the problematic parts — everything else stays unchanged.
 *
 * This saves tokens, preserves good content, and avoids introducing new issues
 * in parts that were already correct.
 *
 * @param {string} originalReply — the main model's full reply to fix
 * @param {Array} violations — from Supervisor, each with dimension/description/snippet/fixInstruction
 * @returns {string} targeted fix prompt (system message content)
 */
export function buildTargetedFixPrompt(originalReply, violations, charProfile) {
  if (!violations?.length || !originalReply) return ''

  // Build character personality constraints for the fix — ensures fix respects character identity
  const charCtx = charProfile
    ? '═══ 角色人设约束（修改必须遵守）═══\n' + charProfile + '\n═══ 修改时注意：修改后的文本必须符合以上角色人设的行为底线。不能为了修一个问题而制造另一个人设违规。═══\n\n'
    : ''

  const lines = [
    charCtx,
    '【🔧 RSE 定向修改——以下是你的上一轮回复。',
    '你只需要修改标记的问题部分，其他内容逐字保留，不要改动任何正确的地方。】',
    '',
    '═══ 原始回复（需要修改的完整文本）═══',
    originalReply,
    '═══ 需要修改的问题 ═══',
    '',
  ]

  const critical = violations.filter(v =>
    v.severity === 'critical' || v.priority === 'P0'
  )
  const major = violations.filter(v =>
    v.severity === 'major' || v.priority === 'P1'
  )
  const minor = violations.filter(v =>
    v.severity === 'minor' || v.priority === 'P2' || (!v.severity && !v.priority)
  )

  if (critical.length > 0) {
    lines.push('🔴 必须修改：')
    for (const v of critical) {
      const dim = v.dimension || v.type || '问题'
      lines.push(`  · ${dim}：${v.description || ''}`)
      if (v.snippet) lines.push(`    原文位置："${v.snippet}"`)
      if (v.fixInstruction) lines.push(`    修改方案：${v.fixInstruction}`)
      lines.push('')
    }
  }

  if (major.length > 0) {
    lines.push('🟠 需要修改：')
    for (const v of major) {
      const dim = v.dimension || v.type || '问题'
      lines.push(`  · ${dim}：${v.description || ''}`)
      if (v.snippet) lines.push(`    原文位置："${v.snippet}"`)
      if (v.fixInstruction) lines.push(`    修改方案：${v.fixInstruction}`)
      lines.push('')
    }
  }

  if (minor.length > 0) {
    lines.push('🟡 建议修改（非强制）：')
    for (const v of minor) {
      const dim = v.dimension || v.type || '问题'
      lines.push(`  · ${dim}：${v.description || ''}`)
      if (v.snippet) lines.push(`    原文位置："${v.snippet}"`)
      if (v.fixInstruction) lines.push(`    修改方案：${v.fixInstruction}`)
      lines.push('')
    }
  }

  lines.push('═══ 修改规则 ═══')
  lines.push('1. 只修改上述标记的问题部分——其他内容【逐字保留，一字不改】')
  lines.push('2. 保持原有的叙事节奏、段落结构、对话顺序完全不变')
  lines.push('3. 每个修改只替换需要改的那一句话或短语，不要扩写、不要缩写、不要重排段落')
  lines.push('4. 🚫 禁止为修改而修改——没标记为问题的部分绝对不要动')
  lines.push('5. 修改后的总字数应与原文接近（±10%以内）')
  lines.push('6. 输出完整的修改后回复（包含未修改的正确部分），不要只输出修改片段')

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// 6. Convenience: full RSE turn wrapper
// ═══════════════════════════════════════════════════════════

/**
 * Run the full RSE cycle for one turn.
 *
 * @param {object} ctx — turn context
 * @param {function} generateFn — async (messages) => reply string (streaming main model call)
 * @param {Array} baseMessages — the message array for the main model (will be modified with contract)
 * @param {string} apiKey
 * @returns {Promise<{ reply: string, contract: object|null, notes: string[], supervisorResult: object }>}
 */
export async function runRSECycle(ctx, generateFn, baseMessages, apiKey) {
  // ── Pass 1: Director ──
  console.log('[RSE] Pass 1: Director — generating contract...')
  const { contract, notes, error: dirError } = await runDirectorPass(ctx, apiKey)

  if (dirError) {
    console.warn('[RSE] Director failed, continuing without contract')
  } else if (contract) {
    console.log('[RSE] Contract:',
      'goal=' + (contract.scene?.goal || '?'),
      'tension=' + (contract.tension?.level || '?'),
      'notes=' + (notes?.length || 0))
  }

  // Inject contract into messages
  const contractBlock = injectContractIntoPrompt(contract, notes)
  if (contractBlock) {
    // Insert contract as the LAST system message before user input
    // (after all existing system messages, right before the user message)
    const userMsg = baseMessages[baseMessages.length - 1]
    baseMessages.splice(baseMessages.length - 1, 0, { role: 'system', content: contractBlock })
  }

  // ── Main Model ──
  console.log('[RSE] Main model generating...')
  let reply = await generateFn(baseMessages)

  // ── Pass 2: Supervisor ──
  console.log('[RSE] Pass 2: Supervisor — auditing...')
  const supResult = await runSupervisorPass(reply, contract, ctx, apiKey)

  if (!supResult.passed && supResult.severity === 'critical') {
    console.warn('[RSE] FAIL — ' + supResult.violations.length + ' violations, severity=' + supResult.severity)

    // Rewrite
    const revisionBlock = buildRevisionInjection(supResult.violations)
    if (revisionBlock && baseMessages.length >= 2) {
      // Insert revision before user message (replace previous contract)
      const userMsg = baseMessages[baseMessages.length - 1]
      baseMessages.splice(baseMessages.length - 1, 0, { role: 'system', content: revisionBlock })

      console.log('[RSE] Rewriting...')
      reply = await generateFn(baseMessages)

      // Re-audit after rewrite (single pass, no further rewrites)
      const reResult = await runSupervisorPass(reply, contract, ctx, apiKey)
      console.log('[RSE] Post-rewrite audit:', reResult.passed ? 'PASS' : 'FAIL (continuing)')
    }
  } else if (!supResult.passed) {
    console.warn('[RSE] Minor issues (' + supResult.severity + '), continuing')
  } else {
    console.log('[RSE] PASS')
  }

  return { reply, contract, notes, supervisorResult: supResult }
}

export { MAX_REWRITES }
