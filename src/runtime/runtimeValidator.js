/**
 * Runtime Validator v1 — Deterministic pre-audit (pure code)
 *
 * Runs BEFORE the RCL flash model call. Catches violations that can be
 * detected without LLM — saving one flash call when violations are found.
 *
 * Checks:
 *   ① Character Fidelity — regex patterns for OOC behavior
 *   ② Intent Completion — does reply contain allowed action keywords?
 *   ③ Action Repetition — same primary action as last 3 turns?
 *   ④ State Consistency — does reply contradict SSM state?
 *   ⑤ Mind Reading — does reply guess player psychology?
 *
 * Zero LLM cost. Runs in <1ms.
 */

import { detectAggressionProfile, AGGRESSION_PROFILES } from './aggressionProfile'
import { validateAgainstSSM } from './sceneStateManager'

// ═══════════════════════════════════════════════════════════
// ① Character Fidelity Patterns
// ═══════════════════════════════════════════════════════════

const OOC_PATTERNS = {
  pursuer_stage1_soft: {
    patterns: [
      /我[会要]?一直[陪等]着你/,
      /不管[你她他]怎么[想选].*我[都会]/,
      /我会[好好]?[照顾保护疼]你/,
      /你是我最[重要在乎].*/,
      /没有你.*我[不活没法]/,
    ],
    desc: 'Pursuer Stage1 不应出现深情/守护/依赖表达',
  },
  cold_stage1_warm: {
    patterns: [
      /别怕.*我在/,
      /有我在.*没[事关]/,
      /我会[让帮]你/,
      /没事的/,
      /你不[用必]担心/,
    ],
    desc: '冷漠系角色 Stage1 不应出现温暖安抚',
  },
  manipulative_genuine: {
    patterns: [
      /我说[真的实]/,
      /真的.*爱你/,
      /我发誓/,
      /我对你.*真心的/,
    ],
    desc: '操控型角色不应突然坦诚',
  },
}

// ═══════════════════════════════════════════════════════════
// ⑤ Mind Reading Patterns
// ═══════════════════════════════════════════════════════════

const MIND_READING_PATTERNS = [
  { pattern: /她知道[^，。！？]*(?:想|觉得|知道|明白|害怕|后悔)/, desc: '替玩家心理——"她知道…"' },
  { pattern: /你心里[^，。！？]*(?:想|知道|清楚|明白)/, desc: '替玩家心理——"你心里…"' },
  { pattern: /你其实[^，。！？]*(?:想|怕|爱|恨|在乎|离不开)/, desc: '替玩家心理——"你其实…"' },
  { pattern: /你在[等想][^，。！？]*(?:他|她|我|人)/, desc: '替玩家心理——"你在等/想…"' },
  { pattern: /你不知道自己[^，。！？]*(?:想|要|爱|怕)/, desc: '替玩家心理——"你不知道自己…"' },
  { pattern: /你后悔了/, desc: '替玩家心理——"你后悔了"' },
]

// ═══════════════════════════════════════════════════════════
// ⑥ Invented Memory Patterns
// ═══════════════════════════════════════════════════════════

const INVENTED_MEMORY_PATTERNS = [
  { pattern: /上次[你我他她][^，。！？]{0,15}(?:说过|做过|来过|去过|答应|承诺|提起)/, desc: '编造过去——"上次你说过…"' },
  { pattern: /还记得[那去天][^，。！？]{0,20}(?:吗|么|吧)/, desc: '编造过去——"还记得那天…吗"' },
  { pattern: /(?:以前|之前|从前)[你我他她][^，。！？]{0,10}(?:说过|答应|做过|来过|提过)/, desc: '编造过去——"之前你答应过…"' },
  { pattern: /(?:那天|那次|那时候)[^，。！？]{0,15}(?:你|我们)[^，。！？]{0,10}(?:说|做|去|来|答应)/, desc: '编造过去——"那天我们去…"' },
  { pattern: /你[不没]是[说答应][^，。！？]{0,15}(?:吗|了|过)/, desc: '编造过去——"你不是说过…吗"' },
  { pattern: /(?:我一直|我永远|我从来)[^，。！？]{0,5}(?:记得|记着|忘不了)/, desc: '编造过去——"我一直记得…"' },
  { pattern: /(?:第一次|最初|刚认识).{0,10}(?:时候|那天)/, desc: '编造过去——"刚认识的时候…"' },
  { pattern: /(?:又|还是)像(?:上次|以前|那天|往常)/, desc: '编造过去——"又像上次那样…"' },
]

// ═══════════════════════════════════════════════════════════
// ③ Action Repetition
// ═══════════════════════════════════════════════════════════

// Track last 3 turns' action keywords
const _actionHistory = []

const ACTION_KEYWORDS = [
  '摸', '握', '抱', '吻', '亲', '靠近', '拉', '抓', '按',
  '解开', '脱', '扣子', '纽扣', '衬衫', '外套',
  '低笑', '笑', '轻笑', '勾唇',
  '看', '盯', '注视', '目光',
  '靠近', '逼近', '贴近', '凑近', '挨近',
  '后退', '退', '让开', '移开',
  '叹', '叹气', '叹息',
]

/**
 * Extract primary action keywords from reply text.
 */
function extractActions(reply, maxPerTurn = 3) {
  const found = []
  const lower = reply.toLowerCase()
  for (const kw of ACTION_KEYWORDS) {
    if (lower.includes(kw) && !found.includes(kw)) {
      found.push(kw)
    }
  }
  return found.slice(0, maxPerTurn)
}

// ═══════════════════════════════════════════════════════════
// ② Intent Completion
// ═══════════════════════════════════════════════════════════

const INTENT_KEYWORDS = {
  '确认态度': ['试探', '观察', '注意', '看', '反应', '表情', '停顿', '等着', '等待'],
  '隐藏真实想法': ['克制', '忍住', '移开', '别开', '转移', '随口', '漫不经心', '轻描淡写'],
  '制造距离': ['冷淡', '退', '拉开', '站远', '不再', '转身', '简短', '沉默'],
  '表达不满': ['冷哼', '不屑', '讽刺', '嘲', '挖苦', '酸', '凭什么'],
  '转移话题': ['说到', '提起', '换', '话锋', '转而', '对了'],
  '给予奖励': ['温柔', '轻轻', '揉了揉', '笑了', '让步', '好了'],
  '拒绝': ['不行', '不准', '不能', '够了', '算了', '别'],
  '示弱': ['颤抖', '低', '差点', '轻声', '几乎', '怕'],
}

// ═══════════════════════════════════════════════════════════
// Main Validator
// ═══════════════════════════════════════════════════════════

/**
 * Run all deterministic checks on generated reply.
 *
 * @param {string} reply — generated text
 * @param {object} ctx
 * @param {object} ctx.character — character descriptor (for personality/profile)
 * @param {object} ctx.ndcPlan — NDC plan (for replyPlan + forbidden)
 * @param {object} ctx.ssmState — SSM state
 * @param {object} ctx.ismState — ISM state
 * @param {number} ctx.affection — current affection value
 * @param {object} ctx.rcProfile — aggression profile of main character
 * @returns {{ passed: boolean, violations: Array, fixInstruction: string }}
 */
export function runDeterministicAudit(reply, ctx = {}) {
  if (!reply) return { passed: true, violations: [], fixInstruction: '' }

  const violations = []
  const { character, ndcPlan, ssmState, affection, rcProfile } = ctx

  // ── ① Character Fidelity ──
  if (rcProfile && (affection ?? 50) <= 40) {
    const stage1Checks = []
    if (rcProfile === AGGRESSION_PROFILES.PURSUER || rcProfile === AGGRESSION_PROFILES.CONFRONTATIONAL) {
      stage1Checks.push(OOC_PATTERNS.pursuer_stage1_soft)
    }
    if (rcProfile === AGGRESSION_PROFILES.ALOOF || rcProfile === AGGRESSION_PROFILES.CONFRONTATIONAL) {
      stage1Checks.push(OOC_PATTERNS.cold_stage1_warm)
    }

    for (const check of stage1Checks) {
      for (const pattern of check.patterns) {
        if (pattern.test(reply)) {
          violations.push({
            dimension: 'Character Fidelity',
            priority: 'P0',
            description: check.desc,
            snippet: (reply.match(pattern) || [''])[0].slice(0, 50),
          })
        }
      }
    }
  }

  // ── ② Intent Completion ──
  const replyIntent = ndcPlan?.replyPlan?.replyIntent || ''
  if (replyIntent) {
    const matchedIntent = Object.entries(INTENT_KEYWORDS).find(([intent]) =>
      replyIntent.includes(intent)
    )
    if (matchedIntent) {
      const [, keywords] = matchedIntent
      const hasKeyword = keywords.some(kw => reply.includes(kw))
      if (!hasKeyword) {
        violations.push({
          dimension: 'Intent Completion',
          priority: 'P1',
          description: `回复意图为"${replyIntent}"，但回复中未找到相关关键词`,
          snippet: '',
        })
      }
    }
  }

  // ── ③ Action Repetition ──
  const currentActions = extractActions(reply)
  _actionHistory.push(currentActions)
  if (_actionHistory.length > 4) _actionHistory.shift()

  if (_actionHistory.length >= 3) {
    const last3 = _actionHistory.slice(-3)
    const repeated = last3[0].filter(a => last3[1].includes(a) && last3[2].includes(a))
    if (repeated.length > 0) {
      violations.push({
        dimension: 'Action Repetition',
        priority: 'P1',
        description: `连续3轮重复动作：${repeated.join('、')}`,
        snippet: '',
      })
    }
  }

  // ── ④ State Consistency ──
  if (ssmState) {
    const ssmCheck = validateAgainstSSM(reply, ssmState)
    if (!ssmCheck.valid) {
      for (const v of ssmCheck.violations) {
        violations.push({
          dimension: 'State Consistency',
          priority: 'P0',
          description: v,
          snippet: '',
        })
      }
    }
  }

  // ── ⑤ Mind Reading ──
  for (const { pattern, desc } of MIND_READING_PATTERNS) {
    if (pattern.test(reply)) {
      violations.push({
        dimension: 'Mind Reading',
        priority: 'P0',
        description: desc,
        snippet: (reply.match(pattern) || [''])[0].slice(0, 50),
      })
    }
  }

  // ── ⑥ Invented Memory ──
  for (const { pattern, desc } of INVENTED_MEMORY_PATTERNS) {
    if (pattern.test(reply)) {
      violations.push({
        dimension: 'Invented Memory',
        priority: 'P0',
        description: desc,
        snippet: (reply.match(pattern) || [''])[0].slice(0, 50),
      })
    }
  }

  // ── Build fix instruction ──
  let fixInstruction = ''
  if (violations.length > 0) {
    const p0 = violations.filter(v => v.priority === 'P0')
    const p1 = violations.filter(v => v.priority === 'P1')

    const parts = []
    if (p0.length > 0) {
      parts.push('🔴 ' + p0.map(v => v.dimension + '：' + v.description).join(' | '))
    }
    if (p1.length > 0) {
      parts.push('🟠 ' + p1.map(v => v.dimension + '：' + v.description).join(' | '))
    }
    fixInstruction = 'Runtime Validator 检测到违规：' + parts.join(' ') +
      '。请重新生成，修正以上问题。注意当前好感度阶段，禁止越界行为。'
  }

  return {
    passed: violations.length === 0,
    violations,
    fixInstruction,
  }
}

/**
 * Reset action history (call on chat clear).
 */
export function resetValidator() {
  _actionHistory.length = 0
}
