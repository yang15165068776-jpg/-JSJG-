/**
 * Affection Trigger — lightweight keyword heuristic for deciding when
 * to call the LLM affection judge.
 *
 * Reduces judge API calls by ~50% while catching high-signal interactions.
 *
 * Strategy:
 *   1. Round 1 ALWAYS triggers (first impression baseline)
 *   2. User input containing HIGH_SIGNAL keywords → trigger immediately
 *   3. User input is trivial (only low-signal words, very short) → skip
 *   4. Backstop: trigger every forceInterval turns regardless
 */

const HIGH_SIGNAL_KEYWORDS = [
  '亲密', '冲突', '拒绝', '依赖', '爱', '恨', '离开',
  '拥抱', '牵手', '接吻', '亲吻', '推开', '冷战', '沉默',
  '温柔', '冷漠', '靠近', '疏远', '信任', '背叛', '原谅',
  '保护', '伤害', '安慰', '在意', '不在乎',
  '我喜欢你', '我爱你', '讨厌你', '别走', '留下', '想你了',
  '心疼', '吃醋', '嫉妒', '在乎', '担心', '害怕',
  '你是不是', '你到底', '你从来', '你总是',
]

const NEGATIVE_SIGNAL_KEYWORDS = [
  '算了', '没什么', '不用', '随便', '无所谓', '没事',
  '嗯', '哦', '好', '行', '可以',
]

const TRIVIAL_MAX_LENGTH = 10 // characters: shorter than this → likely trivial

/**
 * Decide whether to trigger the affection judge this round.
 *
 * @param {string} userInput - the current user input
 * @param {string} aiReply - the AI's reply (from previous round, for context)
 * @param {number} roundCounter - current round index (1-based)
 * @param {number} forceInterval - backstop interval (default 3)
 * @returns {{ trigger: boolean, reason: string }}
 */
export function shouldTriggerAffectionJudge(userInput, aiReply, roundCounter, forceInterval = 3) {
  // Rule 1: Always trigger on first interaction
  if (roundCounter <= 1) {
    return { trigger: true, reason: '首轮基线判定' }
  }

  // Rule 2: Backstop — force trigger every N rounds
  if (roundCounter % forceInterval === 0) {
    return { trigger: true, reason: `保底触发（第${roundCounter}轮）` }
  }

  const input = (userInput || '').trim()
  const inputLower = input.toLowerCase()

  // Rule 3: Trivial input → skip
  if (input.length <= TRIVIAL_MAX_LENGTH &&
      NEGATIVE_SIGNAL_KEYWORDS.some(kw => inputLower.includes(kw))) {
    return { trigger: false, reason: '输入过于简短或低信号，跳过' }
  }

  // Rule 4: High-signal keyword → trigger
  const hitKeywords = HIGH_SIGNAL_KEYWORDS.filter(kw => inputLower.includes(kw))
  if (hitKeywords.length > 0) {
    return {
      trigger: true,
      reason: '检测到高信号关键词：' + hitKeywords.slice(0, 3).join('、'),
    }
  }

  // Rule 5: Check AI reply for emotional content (reply to short neutral input
  //          might still carry emotional weight worth evaluating)
  const reply = (aiReply || '').toLowerCase()
  if (reply.length > 100 &&
      HIGH_SIGNAL_KEYWORDS.some(kw => reply.includes(kw))) {
    return {
      trigger: true,
      reason: 'AI回复含情感内容，判定',
    }
  }

  // Default: skip
  return { trigger: false, reason: '无显著情感信号，跳过' }
}
