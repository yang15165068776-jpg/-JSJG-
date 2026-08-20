/**
 * RQA — Runtime Quality Assurance Layer v1
 *
 * Position: Main Model → CEK → NOS → RQA → Output
 *
 * RQA is NOT a second writing model.
 * RQA only: checks, reports, requests rewrites.
 * RQA never: rewrites plot, adds new plot, continues role-playing.
 *
 * Architecture:
 *   One LLM call (deepseek-v4-flash) audits output across 11 dimensions (v8.9: +NarrativeIdentity)
 *   → 4 Priority levels (P0/P1/P2)
 *   → 4 Severity levels (critical/major/minor/silent)
 *   → 2 Actions (REWRITE/CONTINUE)
 *
 * Integration:
 *   coordinator.js: runAgentTurn → LLM generates reply → RQA audit
 *     → critical/major → inject correction → regenerate (max 2 rewrites)
 *     → minor/silent → log → return reply
 */

import { getAuditModel } from '../utils/storage'
import { buildRQAAuditSupplement } from './rcc'

// ═══════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════

const BASE_URL = 'https://api.deepseek.com'
const RQA_DEFAULT_MODEL = 'deepseek-v4-flash'  // Fallback if audit model not configured
const MAX_REWRITES = 2

export const RQA_SEVERITY = {
  CRITICAL: 'critical',   // P0 violations → must rewrite
  MAJOR: 'major',         // P1 violations → rewrite (up to max)
  MINOR: 'minor',         // P2 violations → log, continue
  SILENT: 'silent',       // No violations → pass
}

export const RQA_ACTION = {
  PASS: 'PASS',
  REWRITE: 'REWRITE',
  CONTINUE: 'CONTINUE',
}

// Severity → action mapping
const SEVERITY_ACTION = {
  critical: RQA_ACTION.REWRITE,
  major: RQA_ACTION.REWRITE,
  minor: RQA_ACTION.CONTINUE,
  silent: RQA_ACTION.PASS,
}

// ═══════════════════════════════════════════════════════════
// 1. Context Builder
// ═══════════════════════════════════════════════════════════

/**
 * Build the RQA audit context from available state.
 *
 * @param {string} output — the LLM-generated reply to audit
 * @param {object} ctx
 * @param {object} ctx.character — full character descriptor
 * @param {object} ctx.usk — USK state
 * @param {string} ctx.playerName — player character name
 * @param {string} ctx.mode — 'drama' | 'daily'
 * @param {string} ctx.prevReply — previous assistant reply (for continuity)
 * @param {string} ctx.userInput — current user input
 * @returns {string} the full RQA audit prompt
 */
export function buildRQAContext(output, ctx = {}) {
  const { character, usk, playerName, mode, prevReply, userInput } = ctx
  const rcList = character?.romanceCharacters || []

  // ── Build character context blocks with detailed stage rules ──
  const charBlocks = []
  const stageRules = []  // Stage-specific audit criteria
  for (const rc of rcList) {
    const aff = usk?.characters?.[rc.name]?.relationship?.affection
      ?? rc.affectionInitial ?? 50
    const stageName = usk?.characters?.[rc.name]?.relationship?.stageName || '未知'
    const lines = [
      `  ${rc.name}：${rc.personality || '无设定'}`,
      `  好感度：${aff}（${stageName}）`,
    ]
    if (rc.background) lines.push(`  背景：${rc.background.slice(0, 80)}`)
    charBlocks.push(lines.join('\n'))

    // ── Extract current stage's behavior rules ──
    if (rc.affectionEnabled && rc.affectionStages?.length > 0) {
      const currentStage = _findCurrentStage(rc, aff)
      if (currentStage) {
        const rules = []
        rules.push(`  【${rc.name} · 当前阶段：${currentStage.name || stageName}（${aff}分）】`)
        if (currentStage.coreState) {
          rules.push(`  ✓ 必须表现：${currentStage.coreState.slice(0, 200)}`)
        }
        const fbArr = Array.isArray(currentStage.forbiddenBehaviors)
          ? currentStage.forbiddenBehaviors
          : String(currentStage.forbiddenBehaviors || '').split('\n')
        if (fbArr.length > 0) {
          const fbs = fbArr.filter(b => b.trim()).slice(0, 8)
          if (fbs.length > 0) {
            rules.push(`  ✗ 严禁：${fbs.map(b => b.trim()).join(' / ')}`)
          }
        }
        const lsArr = Array.isArray(currentStage.languageSamples)
          ? currentStage.languageSamples
          : String(currentStage.languageSamples || '').split('\n')
        if (lsArr.length > 0) {
          const samples = lsArr.filter(s => s.trim()).slice(0, 5)
          if (samples.length > 0) {
            rules.push(`  💬 语言风格参考：${samples.join(' / ')}`)
          }
        }
        if (rules.length > 1) stageRules.push(rules.join('\n'))
      }
    }
  }

  // ── Build previous context ──
  let prevContext = ''
  if (prevReply) {
    prevContext = `\n## 上一轮 AI 回复（用于检查情绪连续性和时间线）\n${prevReply.slice(0, 300)}`
  }

  // ── User input context ──
  let userCtx = ''
  if (userInput) {
    userCtx = `\n## 本轮玩家输入\n${userInput.slice(0, 200)}`
  }

  // ── RCC supplement: constitution article checklist ──
  const rccSupplement = buildRQAAuditSupplement(character)

  let prompt = `你是 Runtime Quality Assurance（运行时质量保障层）。

你不是角色。你不是作者。你不是玩家。
你只能：检查、指出、要求重写。
禁止：重写剧情、新增剧情、代替模型继续写。

## 被审计的输出
${output}

## 上下文
- 玩家名称：${playerName || '未知'}
- 当前角色（被审计方）：${character?.name || '未知'}
- 模式：${mode === 'daily' ? '日常/IM聊天' : '剧情/小说体'}
${charBlocks.length ? '- 角色信息：\n' + charBlocks.join('\n') : ''}${prevContext}${userCtx}

${stageRules.length ? '## ⚠️ 当前阶段行为规则（P0——违反必须重写）\n\n' + stageRules.join('\n\n') + '\n' : ''}
## 检查清单

### Priority 0（绝不能违反 → critical）

① **Player Agency（玩家主导权）**
禁止替玩家：思考、决定、产生心理活动、做动作、回忆、产生动机。
❌ "你其实已经原谅他了" / "你心里明白他说得对" / "你不知道自己在想什么"
✔ 角色只能表达自己的猜测、感受、提问

② **Character Constitution（角色宪法）**
禁止 OOC。角色必须符合其人格设定。
- 言默不能突然真诚/阳光/温柔
- 傲娇不能突然坦率告白
- 高冷不能突然热情撒娇

③ **Narrative Truth（叙事真实）**
禁止引用未发生的事件、杜撰玩家行为、杜撰历史。
❌ "上次你说过……"（如果玩家没说过）
❌ "你之前答应我的……"（如果没有这回事）

④ **Timeline（时间线连续性）**
禁止时间跳跃、场景断裂、动作连续性错误。
❌ 上一轮已拥抱，本轮又开始伸手
❌ 正在室内对话，突然描写户外场景

${stageRules.length ? `⑤ **Stage Behavior Lock（阶段行为锁）← P0 最高优先级**
角色的行为、语言、情绪必须严格符合上方「当前阶段行为规则」。
✗ 严禁中出现的行为 → 出现即 critical，必须重写。
✓ 必须表现中描述的状态 → 缺失即 major。
💬 语言风格 → 严重偏离即 major。
这是 RQA 最重要的检查项——阶段规则是硬约束，不是建议。` : `⑤ **Relationship Stage（关系阶段符合性）**
行为必须符合当前好感度阶段。低好感禁温柔/深情表达。`}

### Priority 1（严重 → major）

⑥ **Identity（身份一致性）**
禁止忘记：玩家身份、角色身份、称呼、关系、世界观。

⑦ **Emotional Continuity（情绪连续性）**
情绪必须连续。上一轮愤怒，本轮不能毫无原因地开心。
允许情绪渐变，禁止情绪跳变。

⑧ **Relationship Stage Nuance（阶段细微偏离）**
行为的细微偏离（语气偏软/偏硬但不严重）。
如果上方有阶段行为规则，此为规则的细微违反（非完全无视）。

### Priority 2（轻微 → minor）

⑨ **Action Density（事件密度）**
禁止连续输出纯解释/分析/心理活动，没有事件推进。

⑩ **Conflict Preservation（冲突保留）**
禁止角色自己制造冲突又自己解决。冲突必须留给玩家回应。

⑪ **Style（风格正确）**
剧情模式：必须是小说体叙事（描写+对话+动作）。
日常模式：必须是 IM 聊天（一条消息一个气泡，无长篇心理描写）。

⑫ **Inner Thought Boundary（内心活动边界）← v8.8 ITRL**
内心活动只能描写角色的心理，禁止替玩家生成内心。
❌ "她知道…" / "她其实…" / "她心里明白…" / "她不知道自己…"
❌ "玩家觉得…" / "他看出玩家想要…" / "她在等玩家开口…"
❌ "你后悔了…" / "你其实想…" / "你在等他…"（从角色口中替玩家定义内心）
✔ 角色只能表达自己的猜测、观察、疑问
✔ "他猜她…" / "他注意到她…" / "他不确定她是否…"
✔ "他问她是不是生气了"（询问，不是断言）
出现替玩家内心 → major，必须重写。

⑬ **NarrativeIdentity（叙事身份一致性）← v8.9 NIO**
如果当前存在叙事身份覆盖（灵魂置换/被附身等），必须检查角色对玩家的称呼和认知是否与规则一致。
- 应该叫真名的角色（whoSeesTruth）叫了外表名 → major
- 应该叫外表名的角色（whoSeesAppearance）叫了真名 → major
- 角色称呼与叙事身份规则冲突时，以叙事身份规则为准（不视为身份不一致）
❌ 一个应该只看外表的角色突然叫出玩家的真名
❌ 一个知道真相的角色把玩家当成外表身份来对待
✔ 称呼和认知严格遵循叙事身份的感知规则

## 输出格式（严格 JSON，禁止输出其他内容）
{
  "status": "PASS" 或 "FAIL",
  "severity": "critical" 或 "major" 或 "minor" 或 "silent",
  "issues": [
    {
      "priority": "P0",
      "type": "StageBehaviorLock",
      "message": "具体违规描述（中文，简洁，20字以内）",
      "snippet": "违规原文片段（从被审计输出中摘取，不超过40字）"
    }
  ],
  "reminder": "阶段提醒（每3-5轮至少输出一次，不超过60字。本轮无需提醒则留空字符串\"\"）"
}

若无违规且无需提醒：{"status": "PASS", "severity": "silent", "issues": [], "reminder": ""}
只输出 JSON，不要任何解释。`

  if (rccSupplement) {
    prompt += '\n\n' + rccSupplement
  }

  return prompt
}

/**
 * Find the current affection stage for a character based on affection value.
 */
function _findCurrentStage(rc, affection) {
  if (!rc.affectionStages?.length) return null
  for (const stage of rc.affectionStages) {
    const min = stage.min ?? -100
    const max = stage.max ?? 100
    if (affection >= min && affection <= max) {
      return stage
    }
  }
  return null
}

// ═══════════════════════════════════════════════════════════
// 2. API Call
// ═══════════════════════════════════════════════════════════

/**
 * Call the RQA auditor LLM.
 *
 * @param {string} prompt — the full audit prompt
 * @param {string} apiKey — DeepSeek API key
 * @returns {Promise<{raw: string, error?: string}>}
 */
async function callRQAAudit(prompt, apiKey) {
  if (!apiKey) {
    return { raw: '', error: 'No API key' }
  }

  try {
    const response = await fetch(BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: getAuditModel() || RQA_DEFAULT_MODEL,
        messages: [
          {
            role: 'system',
            content: '你是 JSON 输出机。只输出合法 JSON，不输出任何其他内容。',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 2048,  // 🔧 v4 思考: 预留 reasoning_content 预算
        temperature: 0.1,  // Deterministic auditing
        stream: false,
      }),
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      return { raw: '', error: errData.error?.message || `API error: ${response.status}` }
    }

    const data = await response.json()
    const raw = data.choices?.[0]?.message?.content || ''
    return { raw }
  } catch (err) {
    return { raw: '', error: err.message }
  }
}

// ═══════════════════════════════════════════════════════════
// 3. Response Parser
// ═══════════════════════════════════════════════════════════

/**
 * Parse RQA response from LLM output.
 * Multiple fallback strategies for robustness.
 *
 * @param {string} raw — raw LLM output text
 * @returns {{ status: string, severity: string, issues: Array, action: string, reminder: string }}
 */
export function parseRQAResponse(raw) {
  // Default: pass (if parsing fails, don't block output)
  const DEFAULT = {
    status: 'PASS',
    severity: RQA_SEVERITY.SILENT,
    issues: [],
    action: RQA_ACTION.PASS,
    reminder: '',
  }

  if (!raw || !raw.trim()) return DEFAULT

  try {
    // Strategy 1: Direct JSON parse (try to extract JSON block first)
    let jsonStr = raw.trim()

    // Strip markdown code fences if present
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim()
    }

    // Strip any non-JSON prefix/suffix
    const braceStart = jsonStr.indexOf('{')
    const braceEnd = jsonStr.lastIndexOf('}')
    if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
      jsonStr = jsonStr.slice(braceStart, braceEnd + 1)
    }

    const parsed = JSON.parse(jsonStr)

    // Validate and normalize
    const status = parsed.status === 'FAIL' ? 'FAIL' : 'PASS'
    const severity = ['critical', 'major', 'minor', 'silent'].includes(parsed.severity)
      ? parsed.severity
      : RQA_SEVERITY.SILENT

    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map(i => ({
          priority: i.priority || 'P2',
          type: i.type || 'Unknown',
          message: i.message || '未指定违规',
          snippet: i.snippet || '',
        }))
      : []

    const reminder = typeof parsed.reminder === 'string' ? parsed.reminder.trim() : ''

    const action = SEVERITY_ACTION[severity] || RQA_ACTION.PASS

    return { status, severity, issues, action, reminder }
  } catch (e) {
    // Strategy 2: Text-based fallback — look for keywords
    console.warn('[RQA] JSON parse failed, using text fallback:', e.message)
    return parseRQATextFallback(raw)
  }
}

/**
 * Text-based fallback parser when JSON parsing fails.
 */
function parseRQATextFallback(raw) {
  const lower = raw.toLowerCase()
  const hasFail = raw.includes('FAIL') || lower.includes('"status"\\s*:\\s*"fail"') || lower.includes('违规') || lower.includes('违反')

  if (!hasFail) {
    return {
      status: 'PASS',
      severity: RQA_SEVERITY.SILENT,
      issues: [],
      action: RQA_ACTION.PASS,
      reminder: '',
    }
  }

  // Determine severity from keywords
  let severity = RQA_SEVERITY.MINOR
  if (raw.includes('P0') || raw.includes('critical') || raw.includes('Critical') ||
      raw.includes('PlayerAgency') || raw.includes('替玩家') || raw.includes('OOC') ||
      raw.includes('杜撰') || raw.includes('时间线')) {
    severity = RQA_SEVERITY.CRITICAL
  } else if (raw.includes('P1') || raw.includes('major') || raw.includes('Major') ||
             raw.includes('身份') || raw.includes('情绪') || raw.includes('好感度阶段')) {
    severity = RQA_SEVERITY.MAJOR
  }

  // Extract issue messages
  const issues = []
  const lines = raw.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed && (trimmed.includes('违规') || trimmed.includes('P0') || trimmed.includes('P1') || trimmed.includes('P2'))) {
      issues.push({
        priority: trimmed.includes('P0') ? 'P0' : trimmed.includes('P1') ? 'P1' : 'P2',
        type: 'FallbackDetection',
        message: trimmed.slice(0, 60),
        snippet: '',
      })
    }
  }

  if (issues.length === 0) {
    issues.push({ priority: 'P2', type: 'Unknown', message: '文本解析失败，检测到可能的违规', snippet: '' })
  }

  return {
    status: 'FAIL',
    severity,
    issues,
    action: SEVERITY_ACTION[severity] || RQA_ACTION.CONTINUE,
  }
}

// ═══════════════════════════════════════════════════════════
// 4. Main Entry Point
// ═══════════════════════════════════════════════════════════

/**
 * Run RQA audit on generated output.
 *
 * @param {string} output — the LLM-generated reply to audit
 * @param {object} ctx — context for building the audit prompt
 * @param {string} apiKey — DeepSeek API key
 * @returns {Promise<{ status: string, severity: string, issues: Array, action: string, raw: string, error?: string }>}
 */
export async function runRQAAudit(output, ctx = {}, apiKey) {
  if (!output || output.trim().length < 10) {
    return {
      status: 'PASS',
      severity: RQA_SEVERITY.SILENT,
      issues: [],
      action: RQA_ACTION.PASS,
      raw: '',
      error: 'Output too short to audit',
    }
  }

  const prompt = buildRQAContext(output, ctx)
  const { raw, error } = await callRQAAudit(prompt, apiKey)

  if (error) {
    console.warn('[RQA] Audit API error:', error)
    return {
      status: 'PASS',
      severity: RQA_SEVERITY.SILENT,
      issues: [],
      action: RQA_ACTION.PASS,
      raw: '',
      error,
    }
  }

  const result = parseRQAResponse(raw)
  result.raw = raw

  // Log audit result
  if (result.status === 'FAIL') {
    const issueSummary = result.issues.map(i => `[${i.priority}] ${i.type}: ${i.message}`).join(' | ')
    console.warn(`[RQA] ❌ ${result.severity.toUpperCase()} → ${result.action}: ${issueSummary}`)
  } else {
    const reminderTag = result.reminder ? ' 💬提醒:' + result.reminder.slice(0, 40) : ''
    console.log('[RQA] ✅ PASS' + reminderTag)
  }

  return result
}

// ═══════════════════════════════════════════════════════════
// 5. Correction Context Builder (for rewrite)
// ═══════════════════════════════════════════════════════════

/**
 * Build a correction message to inject before the user input for a rewrite.
 * This is placed as a system message right before the last user message.
 *
 * @param {Array} issues — RQA issues array
 * @returns {string} correction system message
 */
export function buildRQACorrection(issues) {
  if (!issues || issues.length === 0) return ''

  const p0Issues = issues.filter(i => i.priority === 'P0')
  const p1Issues = issues.filter(i => i.priority === 'P1')
  const p2Issues = issues.filter(i => i.priority === 'P2')

  let msg = '【RQA 审计失败 — 你的上一轮回复存在以下违规，必须在本轮纠正】\n\n'

  if (p0Issues.length > 0) {
    msg += '🔴 绝不能违反（P0）：\n'
    for (const issue of p0Issues) {
      msg += `  · ${issue.type}：${issue.message}`
      if (issue.snippet) msg += `\n    违规片段："${issue.snippet}"`
      msg += '\n'
    }
    msg += '\n'
  }

  if (p1Issues.length > 0) {
    msg += '🟠 严重违规（P1）：\n'
    for (const issue of p1Issues) {
      msg += `  · ${issue.type}：${issue.message}`
      if (issue.snippet) msg += `\n    违规片段："${issue.snippet}"`
      msg += '\n'
    }
    msg += '\n'
  }

  if (p2Issues.length > 0) {
    msg += '🟡 轻微问题（P2）：\n'
    for (const issue of p2Issues) {
      msg += `  · ${issue.type}：${issue.message}\n`
    }
    msg += '\n'
  }

  msg += '请重新生成回复，修正以上所有问题。保持剧情走向和其他内容不变，只修正违规部分。'

  return msg
}

// ═══════════════════════════════════════════════════════════
// 6. Utility
// ═══════════════════════════════════════════════════════════

/**
 * Check if RQA result requires a rewrite.
 */
export function shouldRewrite(result) {
  return result.action === RQA_ACTION.REWRITE
}

/**
 * Get max number of RQA rewrites allowed.
 */
export function getMaxRewrites() {
  return MAX_REWRITES
}

/**
 * Build a minimal RQA context for passing into the rewrite loop.
 * Extracts just the needed fields from the coordinator's scope.
 */
export function buildRQAContextFromScope({
  character, usk, playerName, mode, prevReply, userInput,
}) {
  return { character, usk, playerName, mode, prevReply, userInput }
}
