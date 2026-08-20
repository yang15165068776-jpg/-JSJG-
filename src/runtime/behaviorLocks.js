/**
 * Behavior Locks v1 — State-Gated Behavior + Source Attribution + Personality Correction
 *
 * Three hard constraints injected per turn as prompt-level directives:
 *
 *   ① State Lock (状态锁死)
 *      When any character's affection is in [0, 20]:
 *        → forbid emotionDependency (禁止情感依赖)
 *        → forbid realAttachment (禁止真正依恋)
 *        → force strategyOnlyBehavior (强制策略性行为)
 *
 *   ② Behavior Source Attribution (行为来源强制归因)
 *      Every AI response must open with a behavior source tag:
 *        [行为来源 = 策略 / 情绪 / 生存 / 崩溃]
 *
 *   ③ Early Personality Correction (提前人格修正)
 *      Forbid "未来人格泄露" — low-affection characters must not show
 *      traits, warmth, or attachment that belong to higher affection stages.
 *
 * Architecture:
 *   Injected as prompt block → picked up by narratorPrompt.js in variable suffix
 *   Pipeline step: BEHAVIOR_LOCKS (between CAUSAL_UPDATE and NARRATIVE_BUILD)
 */

import { detectAggressionProfile, AGGRESSION_PROFILES } from './aggressionProfile'
import { getCurrentAffectionStage } from '../utils/deepseek'

// ═══════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════

/** Affection threshold: below this, strategy-only lock activates */
const STRATEGY_LOCK_THRESHOLD = 20

/** Behavior source tag options */
const BEHAVIOR_SOURCES = ['策略', '情绪', '生存', '崩溃']

/** Traits that are FORBIDDEN at low affection (future personality leakage) */
const HIGH_AFFECTION_TRAITS = [
  '保护欲', '真心关心', '情感脆弱', '主动付出', '深度依恋',
  '吃醋', '占有欲', '温柔体贴', '舍不得', '心疼',
  '为你着想', '默默守护', '依赖你', '离不开你', '需要你',
  '眼神柔软', '语气温柔', '为你破例', '心软', '妥协',
]

/** Strategic behavior patterns — what low-affection characters SHOULD do */
const STRATEGY_ONLY_BEHAVIORS = [
  '计算利益', '等价交换', '保持距离', '试探底线', '评估价值',
  '冷眼观察', '若即若离', '条件交换', '威慑展示', '利益最大化',
]

// ═══════════════════════════════════════════════════════════
// ① State Lock — affection-gated strategy mode
// ═══════════════════════════════════════════════════════════

/**
 * Check if a character's affection triggers the strategy-only lock.
 *
 * @param {number} affection — current affection value (0-100)
 * @returns {boolean}
 */
function isStrategyLocked(affection) {
  return affection >= 0 && affection <= STRATEGY_LOCK_THRESHOLD
}

/**
 * Build per-character state lock block.
 *
 * @param {object} rc — romance character descriptor
 * @param {number} affection — current affection
 * @param {object} stage — current affection stage (from getCurrentAffectionStage)
 * @returns {string|null} lock directive or null if not locked
 */
function buildCharacterStateLock(rc, affection, stage) {
  if (!isStrategyLocked(affection)) return null

  const profile = detectAggressionProfile({ personality: rc.personality, background: rc.background })
  const profileLabel = profile === AGGRESSION_PROFILES.PURSUER ? '侵略型'
    : profile === AGGRESSION_PROFILES.CONFRONTATIONAL ? '对抗型'
    : profile === AGGRESSION_PROFILES.ALOOF ? '疏离型'
    : '温柔型'

  const lines = []
  lines.push('【' + rc.name + '】好感=' + affection + ' | 人格=' + profileLabel + ' | 阶段=' + (stage?.name || '未知'))

  // Core three locks
  lines.push('  ❌ 禁止情感依赖：不允许表现出"需要"玩家、"离不开"玩家、因玩家而产生情绪波动')
  lines.push('  ❌ 禁止真正依恋：不允许真心实意地关心、担忧、思念、或对玩家产生情感羁绊')
  lines.push('  ✅ 强制策略行为：一切行为以利益计算为准——等价交换、试探底线、评估价值、威慑展示')

  // Personality-specific strategy calibration
  if (profile === AGGRESSION_PROFILES.PURSUER) {
    lines.push('  ⚡ 侵略型策略：你的"攻略"不是出于喜欢，是出于征服欲。接近是战术，甜言蜜语是饵料。')
  } else if (profile === AGGRESSION_PROFILES.GENTLE) {
    lines.push('  ⚡ 温柔型策略：你的"温柔"是保持距离的工具——礼貌但不走心，和善但无承诺。')
  } else if (profile === AGGRESSION_PROFILES.ALOOF) {
    lines.push('  ⚡ 疏离型策略：你的冷漠不需要解释。不主动、不拒绝、不负责、不动心。')
  } else {
    lines.push('  ⚡ 对抗型策略：你的攻击性是筛选机制——挑衅是测试，不是情绪失控。')
  }

  // What they SHOULD do instead
  lines.push('  允许行为：' + STRATEGY_ONLY_BEHAVIORS.slice(0, 5).join('、'))

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// ② Behavior Source Attribution — mandatory per-response tagging
// ═══════════════════════════════════════════════════════════

/**
 * Build the source attribution directive.
 * This is a global rule — applies to every AI response regardless of state.
 *
 * @returns {string} attribution directive block
 */
function buildAttributionDirective() {
  return `【🏷️ 行为来源强制归因】
你的每一次回复，必须在开头标注行为来源标签。格式如下：

[行为来源 = 策略]

四种来源定义：
  · 策略 — 冷静计算、利益驱动、有目的性的行为（包括：试探、交易、威慑、评估、博弈）
  · 情绪 — 被情感驱动、无法完全控制的行为（包括：愤怒、嫉妒、伤心、冲动、失控边缘）
  · 生存 — 出于自我保护、避免伤害的行为（包括：退缩、回避、防御、自保、筑墙）
  · 崩溃 — 完全失控、精神防线瓦解的行为（包括：歇斯底里、崩溃大哭、自我毁灭、不可逆伤害）

选择规则：
  · 大多数低好感互动 → 策略
  · 被攻击/被威胁/被抛弃 → 生存
  · 强烈情感冲击且控制不住 → 情绪
  · 情感防线彻底瓦解 → 崩溃
  · 一轮回复只选一个标签，选主导的那一个

标签放在回复的第一行，独占一行。标签之后才是叙事内容。`
}

// ═══════════════════════════════════════════════════════════
// ③ Early Personality Correction — forbid future personality leakage
// ═══════════════════════════════════════════════════════════

/**
 * Build the personality correction block.
 * Prevents characters from showing traits that belong to higher affection stages.
 *
 * @param {object} character — full LLM character descriptor
 * @param {object} affectionMap — { [charName]: currentAffectionValue }
 * @returns {string} correction directive block
 */
function buildPersonalityCorrection(character, affectionMap = {}) {
  const rcList = character?.romanceCharacters || []
  if (rcList.length === 0) return ''

  const lines = ['【⚠️ 提前人格修正 —— 禁止"未来人格泄露"】']

  lines.push('角色在低好感阶段禁止表现出只属于高好感阶段的人格特质。')
  lines.push('以下行为是高好感专属——当前好感不够的角色绝对不能出现：')
  lines.push('')
  lines.push('禁止清单（所有角色通用）：')
  for (const trait of HIGH_AFFECTION_TRAITS) {
    lines.push('  × ' + trait)
  }
  lines.push('')

  // Per-character stage boundary
  lines.push('各角色当前允许的情感上限：')
  for (const rc of rcList) {
    const aff = affectionMap[rc.name] ?? rc.affectionInitial ?? 50
    const stage = rc.affectionEnabled !== false ? getCurrentAffectionStage(rc, aff) : null
    const stageName = stage?.name || '未知'

    // Determine what's the max emotional expression allowed at this stage
    let maxAllowed = ''
    if (aff <= 20) {
      maxAllowed = '仅允许：冷漠、算计、试探、评估、威慑。禁止一切温暖和情感表达。'
    } else if (aff <= 40) {
      maxAllowed = '仅允许：轻微的在意（表现方式必须扭曲——讽刺、挖苦、冷淡，不能直接温柔）。'
    } else if (aff <= 60) {
      maxAllowed = '仅允许：不稳定的关心（忽冷忽热、口是心非、用对抗表达在意）。'
    } else if (aff <= 80) {
      maxAllowed = '仅允许：隐晦的温柔（有但不说、用行动不用语言、随时准备撤回）。'
    } else {
      maxAllowed = '允许：完整的情感表达（但人格基底不能变——侵略型不会变成温柔型）。'
    }

    lines.push('  · ' + rc.name + '（好感=' + aff + '，阶段=' + stageName + '）→ ' + maxAllowed)
  }

  lines.push('')
  lines.push('铁律：角色可以"演"高于当前阶段的行为（出于策略），但不能"信"——不能真的变成那样。')
  lines.push('演和信的区别：演 = 有目的、有计算、随时可撤回。信 = 真心实意、不计后果、无法撤回。')

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// Master Builder — assemble all three lock blocks
// ═══════════════════════════════════════════════════════════

/**
 * Build the complete behavior locks block for injection into the variable suffix.
 *
 * @param {object} character — full LLM character descriptor
 * @param {object} uskState — current USK state
 * @param {object} affectionMap — { [charName]: currentAffectionValue }
 * @returns {string} full behavior locks prompt block
 */
export function buildBehaviorLocks(character, uskState, affectionMap = {}) {
  if (!character) return ''

  const rcList = character.romanceCharacters || []
  if (rcList.length === 0) return ''

  const sections = []

  // ═══ ① State Lock — per-character strategy mode for low-affection ═══
  const lockedCharacters = []
  for (const rc of rcList) {
    const aff = affectionMap[rc.name] ?? rc.affectionInitial ?? 50
    if (isStrategyLocked(aff)) {
      const stage = rc.affectionEnabled !== false ? getCurrentAffectionStage(rc, aff) : null
      const lockBlock = buildCharacterStateLock(rc, aff, stage)
      if (lockBlock) lockedCharacters.push(lockBlock)
    }
  }

  if (lockedCharacters.length > 0) {
    sections.push(
      '━━━ 🔒 状态锁死 —— 低好感强制策略模式 ━━━\n' +
      '以下角色当前好感度过低（0-20），已锁定为【策略模式】。\n' +
      '策略模式 = 一切行为出于计算，不是出于情感。\n' +
      lockedCharacters.join('\n\n')
    )
  }

  // ═══ ② Behavior Source Attribution — global rule ═══
  sections.push(buildAttributionDirective())

  // ═══ ③ Personality Correction — stage-appropriate behavior ═══
  const correctionBlock = buildPersonalityCorrection(character, affectionMap)
  if (correctionBlock) sections.push(correctionBlock)

  // ── Summary enforcement ──
  sections.push(
    '━━━ 🔒 行为锁效力 ━━━\n' +
    '· 状态锁 + 归因标签 + 人格修正 = 本轮不可违背的铁律\n' +
    '· 如果某个行为会让你"感觉不像低好感角色" → 那就是未来人格泄露 → 禁止\n' +
    '· 如果某个回复让你觉得"太温柔了" → 检查当前好感阶段是否允许 → 不允许就改成策略性'
  )

  return sections.join('\n\n')
}

/**
 * Check if any character is under the strategy lock.
 * Used by the pipeline to decide whether to inject behavior locks.
 *
 * @param {object} affectionMap — { [charName]: currentAffectionValue }
 * @param {object} character — full LLM character descriptor
 * @returns {boolean}
 */
export function hasStrategyLockedCharacters(affectionMap = {}, character) {
  const rcList = character?.romanceCharacters || []
  for (const rc of rcList) {
    const aff = affectionMap[rc.name] ?? rc.affectionInitial ?? 50
    if (isStrategyLocked(aff)) return true
  }
  return false
}

/**
 * Get the list of behavior source tags (for UI reference).
 */
export function getBehaviorSources() {
  return [...BEHAVIOR_SOURCES]
}
