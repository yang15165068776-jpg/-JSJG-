/**
 * ⚡ AEL — Action Enforcement Layer v1
 *
 * "DAS 制造事件。AEL 强制模型真的写出来。"
 *
 * Division of labor (v9.2.1 — de-duplicated):
 *   DAS v2  → "世界应该发生什么事件"（事件生成 + 动机锚定 + 人格差异化）
 *   AEL     → "回复文本不能是退化的"（只做回复自检 + 禁止被动模式）
 *
 * Before v9.2.1 AEL carried its own "本轮必须发生的变化" list, which
 * duplicated DAS's 剧情任务 in the HOT zone. That redundancy burned tokens
 * and diluted the actual signal. AEL is now a pure REPLY ENFORCEMENT layer:
 * it does not generate story, it rejects passive output.
 *
 * Position: DAS_V2 → AEL → USER_INPUT → Generation
 * Cost: zero LLM calls, pure rule-based
 * Size: ~150 tokens
 */

// ═══════════════════════════════════════════════════════════
// 1. Forbidden Passive Patterns — universal
// ═══════════════════════════════════════════════════════════

const FORBIDDEN_PASSIVE = [
  '只描写角色的情绪/内心活动而没有发生任何外部事件',
  '角色只是"回应"了玩家的话——玩家说X，角色说Y，剧情没有推进',
  '角色等待玩家下一步行动——没有自己发起任何事',
  '角色重复之前已经发生过的互动模式——没有新变化',
  '角色说了一句有张力的话——但说完就结束了，没有后续',
  '角色的行动只存在于"想""觉得""意识到"——没有外化为叙事事件',
]

// ═══════════════════════════════════════════════════════════
// 2. Pass/Fail Criteria
// ═══════════════════════════════════════════════════════════

const PASS_CRITERIA = [
  '回复中至少发生了一个外部可观察的变化（不是内心活动）',
  '变化改变了当前场景状态——下一轮世界和这一轮不同',
  '变化来源于角色动机——不是随机事件或玩家单方面推动',
]

// ═══════════════════════════════════════════════════════════
// 3. Main AEL Builder — reply self-check only
// ═══════════════════════════════════════════════════════════

/**
 * Build the AEL reply self-check block.
 *
 * @param {object} character — character descriptor
 * @param {number} turnIndex — current turn (for rotating forbidden patterns)
 * @returns {string} AEL enforcement block
 */
export function buildAELBlock(character, turnIndex = 0) {
  const rcList = character?.romanceCharacters || []
  if (!rcList.length) return ''

  const name = rcList[0].name || '角色'

  // Rotate forbidden patterns so the model isn't trained on a fixed subset
  const fbStart = (turnIndex || 0) % FORBIDDEN_PASSIVE.length
  const forbiddenSubset = [
    FORBIDDEN_PASSIVE[fbStart % FORBIDDEN_PASSIVE.length],
    FORBIDDEN_PASSIVE[(fbStart + 1) % FORBIDDEN_PASSIVE.length],
    FORBIDDEN_PASSIVE[(fbStart + 2) % FORBIDDEN_PASSIVE.length],
  ]

  const lines = [
    `━━━ ⚡ AEL · 回复自检 ━━━`,
    '',
    `【禁止的退化——以下任何一项出现=本轮不合格】`,
    ...forbiddenSubset.map((f, i) => `  ${i + 1}. ${f}`),
    '',
    `【执行标准】`,
    ...PASS_CRITERIA.map((c, i) => `  ${i + 1}. ${c}`),
    '',
    `【自检——生成回复后问自己】`,
    `"我的回复中，${name}做了一件什么事？这件事改变了什么？"`,
    `如果答案是"他表达了一个情绪"或"他回应了玩家" → 删除重写。`,
    `如果答案是"他做了X，导致Y发生了变化" → 合格。`,
  ]

  return lines.join('\n')
}

/**
 * Always return true — AEL should always be injected.
 */
export function shouldBuildAEL(character) {
  return (character?.romanceCharacters?.length || 0) > 0
}
