/**
 * PCL — Prompt Compression Layer v1
 *
 * Position: After RCC compile, before prompt assembly.
 *
 * PCL dynamically filters the RCC constitution to include only
 * the rules relevant to the CURRENT turn's context.
 *
 * Core principle:
 *   Don't send all 20 constitution articles every turn.
 *   Send only the ones the model actually needs THIS turn.
 *
 * Zero LLM cost — pure rule-based filtering.
 *
 * Inputs:
 *   - RCC output (constitution articles with priority + keywords)
 *   - Current scene context (from NDC/SSM)
 *   - Current affection stage
 *   - Current ISM state
 *
 * Output:
 *   - Filtered, compact prompt block (~300-800 tokens vs 1500+ full)
 */

// ═══════════════════════════════════════════════════════════
// Scene → Rule Category Mapping
// ═══════════════════════════════════════════════════════════

const SCENE_RULE_MAP = {
  conflict: ['Identity', 'Conflict', 'Defense', 'Boundary', 'Aggression', 'Power', 'Resistance'],
  argument: ['Identity', 'Conflict', 'Defense', 'Emotion', 'Control'],
  tension: ['Identity', 'Conflict', 'Emotion', 'Power', 'Boundary'],
  intimate: ['Identity', 'Vulnerability', 'Trust', 'Desire', 'Attachment', 'SelfDeception'],
  romantic: ['Identity', 'Vulnerability', 'Trust', 'Desire', 'Intimacy'],
  seduction: ['Identity', 'Desire', 'Power', 'Manipulation', 'Control'],
  negotiation: ['Identity', 'Interest', 'Calculation', 'Strategy', 'Power', 'Social'],
  public: ['Identity', 'Social', 'Reputation', 'Mask', 'Boundary'],
  danger: ['Identity', 'Survival', 'Defense', 'Fear', 'Aggression'],
  betrayal: ['Identity', 'Trust', 'Defense', 'Emotion', 'Revenge'],
  jealousy: ['Identity', 'Possessiveness', 'Emotion', 'Power', 'Control'],
  daily: ['Identity', 'Social', 'Routine', 'Boundary'],
}

// Keywords for each category (used when RCC articles have freeform categories)
const CATEGORY_KEYWORDS = {
  Identity: ['身份', '人格', '本质', '核心', 'identity', 'character'],
  Conflict: ['冲突', '对抗', '争执', '吵架', '对立', 'conflict', 'argument'],
  Defense: ['防御', '保护', '伪装', '面具', '防备', 'defense', 'guard'],
  Emotion: ['情绪', '情感', '愤怒', '悲伤', '嫉妒', '害怕', 'emotion', 'feeling'],
  Vulnerability: ['脆弱', '软弱', '暴露', '卸下', '真实', 'vulnerable', 'expose'],
  Trust: ['信任', '相信', '依赖', '依靠', 'trust', 'rely', 'depend'],
  Desire: ['欲望', '渴望', '想要', '占有', 'desire', 'want', 'possess'],
  Attachment: ['依恋', '依赖', '离不开', 'attachment', 'cling'],
  Power: ['权力', '控制', '支配', '主导', 'power', 'control', 'dominance'],
  Boundary: ['边界', '距离', '界限', '底线', 'boundary', 'limit', 'line'],
  Social: ['社交', '社会', '公共', '场合', 'social', 'public'],
  Interest: ['利益', '计算', '评估', '价值', 'interest', 'calculate', 'value'],
  Strategy: ['策略', '计划', '目的', '战略', 'strategy', 'plan', 'tactic'],
  Manipulation: ['操控', '利用', '玩弄', '操纵', 'manipulate', 'use', 'play'],
  SelfDeception: ['自我欺骗', '说服自己', '假装', '骗自己', 'self-deceive', 'pretend'],
  Fear: ['恐惧', '害怕', '担忧', 'fear', 'afraid', 'scared'],
  Aggression: ['攻击', '侵犯', '侵略', '暴力', 'aggression', 'violent'],
}

// ═══════════════════════════════════════════════════════════
// Main API
// ═══════════════════════════════════════════════════════════

/**
 * Build the compressed prompt block for this turn.
 *
 * @param {object} rcc — RCC output { constitution, runtimeGuide, hiddenPsychology }
 * @param {object} ctx — runtime context
 * @param {string} ctx.sceneGoalType — NDC sceneGoal.type (e.g., '试探', '冲突', '亲密')
 * @param {number} ctx.affection — current affection value
 * @param {object} ctx.ismState — ISM state (distance, touch, conversation, conflict)
 * @param {object} ctx.ndcPlan — NDC plan (forbidden, sceneBeat)
 * @returns {string} compact prompt block for injection
 */
export function buildCompressedBlock(rcc, ctx = {}) {
  if (!rcc?.constitution?.length) return ''

  const { sceneGoalType, affection, ismState, ndcPlan } = ctx

  // ── Step 1: Determine which categories are relevant ──
  const goalType = (sceneGoalType || '').toLowerCase()
  const relevantCategories = findRelevantCategories(goalType)

  // ── Step 2: Filter articles ──
  const filtered = rcc.constitution.filter(article => {
    // P0 articles always included
    if (article.priority === 'P0') return true

    // P1: include if category matches scene
    if (article.priority === 'P1') {
      const cat = article.category || ''
      return relevantCategories.some(rc => cat.includes(rc) || keywordMatch(article.rule, rc))
    }

    // P2: only include in late stages or if directly relevant
    if (article.priority === 'P2') {
      if ((affection ?? 50) < 50) return false // Early stage: skip P2
      const cat = article.category || ''
      return relevantCategories.some(rc => cat.includes(rc) || keywordMatch(article.rule, rc))
    }

    return false
  })

  // ── Step 3: Build compact output ──
  if (filtered.length === 0) return ''

  const lines = ['【角色宪法 · 本轮有效条款】']

  const p0 = filtered.filter(a => a.priority === 'P0')
  const p1 = filtered.filter(a => a.priority === 'P1')
  const p2 = filtered.filter(a => a.priority === 'P2')

  if (p0.length > 0) {
    lines.push('🔴 P0（不可违反）：')
    for (const a of p0) {
      lines.push(`  ${a.article}. ${a.rule}`)
    }
  }

  if (p1.length > 0) {
    lines.push('🟠 P1（当前场景相关）：')
    for (const a of p1) {
      lines.push(`  ${a.article}. ${a.rule}`)
    }
  }

  if (p2.length > 0) {
    lines.push('🟡 P2（仅供参考）：')
    for (const a of p2) {
      lines.push(`  ${a.article}. ${a.rule}`)
    }
  }

  // ── Step 4: Add runtime guide (compact) ──
  if (rcc.runtimeGuide) {
    const rg = rcc.runtimeGuide
    const guideParts = []
    if (rg.speechStyle) guideParts.push(`语气：${rg.speechStyle}`)
    if (rg.conflictStrategy) guideParts.push(`冲突策略：${rg.conflictStrategy}`)
    if (rg.emotionalExpression) guideParts.push(`情绪表达：${rg.emotionalExpression}`)
    if (rg.forbiddenActions) guideParts.push(`禁止：${rg.forbiddenActions}`)
    if (guideParts.length) lines.push('运行指南：' + guideParts.join(' | '))
  }

  // ── Step 5: Stage-specific forbidden actions (from NDC) ──
  if (ndcPlan?.replyPlan?.forbiddenActions?.length) {
    lines.push(`本轮禁止：${ndcPlan.replyPlan.forbiddenActions.join(' / ')}`)
  }

  return lines.join('\n')
}

/**
 * Find relevant rule categories based on scene goal type.
 */
function findRelevantCategories(goalType) {
  const goalMap = {
    '试探': ['Identity', 'Strategy', 'Boundary', 'Emotion'],
    '冲突': ['Identity', 'Conflict', 'Defense', 'Aggression', 'Power'],
    '争执': ['Identity', 'Conflict', 'Defense', 'Emotion', 'Control'],
    '吃醋': ['Identity', 'Possessiveness', 'Emotion', 'Power', 'Jealousy'],
    '亲密': ['Identity', 'Vulnerability', 'Desire', 'Trust', 'Attachment'],
    '缓和': ['Identity', 'Vulnerability', 'Trust', 'Emotion', 'Reconciliation'],
    '揭露': ['Identity', 'Vulnerability', 'Truth', 'Fear', 'SelfDeception'],
    '诱导': ['Identity', 'Strategy', 'Manipulation', 'Power', 'Interest'],
    '交易': ['Identity', 'Interest', 'Calculation', 'Strategy', 'Power'],
    '妥协': ['Identity', 'Boundary', 'Strategy', 'Social'],
    '逃避': ['Identity', 'Defense', 'Fear', 'Boundary', 'SelfDeception'],
    '观察': ['Identity', 'Strategy', 'Calculation', 'Boundary', 'Social'],
    '推进': ['Identity', 'Strategy', 'Power', 'Desire', 'Attachment'],
    '拉近': ['Identity', 'Vulnerability', 'Trust', 'Desire', 'Attachment'],
    '制造误会': ['Identity', 'Strategy', 'Manipulation', 'Conflict', 'Deception'],
    '增加危险感': ['Identity', 'Aggression', 'Power', 'Fear', 'Dominance'],
    '推进修罗场': ['Identity', 'Conflict', 'Jealousy', 'Power', 'Possessiveness'],
  }

  // Try exact match first
  if (goalMap[goalType]) return goalMap[goalType]

  // Try keyword match
  for (const [key, cats] of Object.entries(goalMap)) {
    if (goalType.includes(key)) return cats
  }

  // Fallback: scene keyword match
  for (const [scene, cats] of Object.entries(SCENE_RULE_MAP)) {
    if (goalType.includes(scene)) return cats
  }

  // Default: basic identity + strategy
  return ['Identity', 'Strategy', 'Boundary', 'Emotion']
}

/**
 * Check if rule text matches a category by keyword.
 */
function keywordMatch(ruleText, category) {
  const keywords = CATEGORY_KEYWORDS[category]
  if (!keywords) return false
  const lower = (ruleText || '').toLowerCase()
  return keywords.some(kw => lower.includes(kw.toLowerCase()))
}
