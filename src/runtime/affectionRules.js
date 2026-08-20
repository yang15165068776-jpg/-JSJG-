/**
 * Affection Rules v4 — LLM-primary, rules-fallback scoring.
 *
 * v4 回归旧系统思路：LLM 裁判为主（理解上下文、判断自然），
 * 规则为辅（仅在无 API Key 或硬锁场景下兜底）。
 *
 * Rule priority (first match wins):
 *   1. Anchor suppression → 0 (hard lock, no LLM needed)
 *   2. Every 3rd round → needs LLM (comprehensive)
 *   3. High signal keywords → needs LLM
 *   4. Keyword rule matches → needs LLM
 *   5. Default → 0, skip LLM (avoid burning API on neutral turns)
 */

import { shouldTriggerAffectionJudge } from './affectionTrigger'

/**
 * @returns {{ delta: number, needsLLM: boolean, reason: string }}
 */
export function scoreAffection(userInput, aiReply, agentState, roundCounter) {
  // Rule 1: Anchor suppression — hard lock, never changes
  if (agentState.anchorSuppression && userInput) {
    const suppressionTerms = agentState.anchorSuppression
      .split(/[，,、\n]/)
      .map(s => s.trim())
      .filter(Boolean)
    const matched = suppressionTerms.some(term =>
      userInput.includes(term) || (aiReply || '').includes(term)
    )
    if (matched) {
      return { delta: 0, needsLLM: false, reason: '锚点压制场景，锁死好感度' }
    }
  }

  // Rule 2: Every 3rd round → get LLM comprehensive evaluation
  if (roundCounter % 3 === 0) {
    return { delta: 0, needsLLM: true, reason: '第' + roundCounter + '轮定期LLM裁决' }
  }

  // Rule 3: High signal keywords → needs LLM for nuanced judgment
  const triggerResult = shouldTriggerAffectionJudge(userInput, aiReply, roundCounter, 99)
  if (triggerResult.trigger) {
    return { delta: 0, needsLLM: true, reason: '高信号互动，LLM裁决: ' + triggerResult.reason }
  }

  // Rule 4: Custom affection up/down rules → needs LLM
  if (agentState.affectionUpRules && userInput) {
    const upTerms = extractKeywords(agentState.affectionUpRules)
    if (upTerms.some(t => userInput.includes(t) || (aiReply || '').includes(t))) {
      return { delta: 0, needsLLM: true, reason: '匹配上涨条件关键词，LLM裁决' }
    }
  }
  if (agentState.affectionDownRules && userInput) {
    const downTerms = extractKeywords(agentState.affectionDownRules)
    if (downTerms.some(t => userInput.includes(t) || (aiReply || '').includes(t))) {
      return { delta: 0, needsLLM: true, reason: '匹配下跌条件关键词，LLM裁决' }
    }
  }

  // Rule 5: Conflict/expectation keywords → needs LLM
  const conflictKeywords = ['为什么', '你到底', '你从来', '你总是', '我不明白', '凭什么',
    '你变了', '以前你', '记得那天', '你答应过']
  const hasConflict = conflictKeywords.some(kw => (userInput || '').includes(kw))
  if (hasConflict) {
    return { delta: 0, needsLLM: true, reason: '潜在冲突/预期打破，LLM裁决' }
  }

  // Default: neutral turn, no change, skip LLM
  return { delta: 0, needsLLM: false, reason: '中性回合，跳过' }
}

/**
 * Apply scored affection deltas to all active characters.
 *
 * @param {object} world — World Engine state
 * @param {string} userInput
 * @param {string} aiReply
 * @param {number} roundCounter
 * @returns {{ deltas: object, needsLLM: string[], events: object[] }}
 */
export function scoreAllAffections(world, userInput, aiReply, roundCounter) {
  const deltas = {}
  const needsLLM = []
  const events = []

  for (const [name, agent] of Object.entries(world.characters)) {
    if (!agent.affectionEnabled) continue
    if (!agent.present) continue

    const result = scoreAffection(userInput, aiReply, agent, roundCounter)

    if (result.needsLLM) {
      needsLLM.push(name)
    } else if (result.delta !== 0) {
      deltas[name] = result.delta
      events.push({
        type: 'RELATIONSHIP_CHANGE',
        timestamp: Date.now(),
        data: { source: name, target: 'player', delta: result.delta, trigger: result.reason },
      })
    }
  }

  return { deltas, needsLLM, events }
}

// ─── Helpers ────────────────────────────────────────────

function extractKeywords(ruleText) {
  if (!ruleText) return []
  return ruleText
    .split(/[：:，,、。\n+→\d\-]/)
    .map(s => s.trim())
    .filter(s => s.length >= 2 && s.length <= 10)
}
