/**
 * Narrator Prompt v3 — variable suffix builder.
 *
 * The Narrator's ONLY job is to "tell the story."
 * It receives: world snapshot + NPC actions + recent events + user action.
 * It does NOT receive: character identity, writing rules, ASL (those are cached).
 *
 * Architecture (v8.4+):
 *   CORE_SYSTEM_PREFIX  (always cached)     → cachePrefix.js
 *   CHARACTER_PREFIX    (cached, stable)     → characterPrefix.js
 *   ─────────────────────────────────────
 *   VARIABLE_SUFFIX     (dynamic per turn)   ← THIS FILE
 *
 * The variable suffix only contains:
 *   - Conditional supplements (anti-taming, warm-low) — checked every turn
 *   - World snapshot + narrative hints — changes per turn
 *   - CCL constitution — dynamic constraints + stage status
 *   - User action — the player's current input
 *   - Runtime directives — behavior kernels (DarkAction, Desire, Initiative)
 */

import { CORE_SYSTEM_PREFIX, assembleSystemPrompt } from '../cachePrefix'
import { snapshotForNarrator } from '../../world/worldEngine'
import { shouldActivateAntiTaming, shouldActivateWarmLowAffection, getCurrentAffectionStage } from '../../utils/deepseek'
import { detectAggressionProfile, AGGRESSION_PROFILES } from '../../runtime/aggressionProfile'
// NOTE: CCL (character constitution) is now in the cached CHARACTER PREFIX.
// characterConstitution.js is no longer needed in the variable suffix.

// ═══════════════════════════════════════════════════════════
// Module-level behavior kernel descriptions
// (moved from inline to avoid re-allocation every turn)
// ═══════════════════════════════════════════════════════════
const DARK_ACTION_DESC = {
  0: '无黑暗行为',
  1: '冷淡敷衍——不主动不拒绝，短回复，沉默代替回应',
  2: '轻冲突——讽刺、阻断话题、拒绝顺从、打断对方、翻白眼',
  3: '关系破坏——翻旧账、与第三人亲密刺激玩家、堵路逼近、情绪跳变、自毁式攻击',
  4: '极端行为——威胁断裂、动手推搡按墙、当玩家面与第三人亲密、精神极端化',
  5: '黑暗核心——操控、情绪惩罚、物理强制、暴力升级、当玩家面越界、完全失控',
}
const DESIRE_DESC = {
  0: '无欲望信号',
  1: '潜伏期——喉结滚动、呼吸微乱、眼神在身体上多停半秒',
  2: '试探期——直白挑逗、故意触碰、语言侵略（直接说"我想要你"）',
  3: '主动期——明确身体反应（呼吸/肌肉/体温）、身体语言+动作、禁止空转',
  4: '失控期——身体先于理智行动、啃咬不是亲吻、呼吸声音痕迹、身体反应必须具体',
  5: '沉沦期——身体+动作+感受+声音+痕迹的完整链条、禁止空转与回避',
}
const PHYSICAL_DESC = {
  0: '无物理动作——仅语言/存在',
  1: '物理存在感——逼近、堵路、俯视、呼吸打到皮肤上',
  2: '轻微接触——抓手腕、抬下巴逼对视、拽衣领、推肩膀',
  3: '物理压制——按在墙上/桌上、扣住双手、推倒在地、身体压住',
  4: '暴力冲突——扇耳光、掐脖子、拳打脚踢、撕衣物、摔打',
  5: '极限冲突——暴力压制、持续施压致伤、工具威慑、不可逆的决裂',
}

/**
 * Build the Narrator system prompt for a given turn.
 *
 * @param {object} world — World Engine state
 * @param {object} character — full character object (for first-turn identity injection)
 * @param {Array} narrativeHints — processed events from Event Bus
 * @param {string} userAction — current user input
 * @param {boolean} isFirstTurn — if true, include full character identity blocks
 * @returns {string} complete system prompt
 */
export function buildNarratorPrompt(world, character, narrativeHints, userAction, isFirstTurn = false) {
  const snapshot = snapshotForNarrator(world)

  // Build the variable suffix
  const sections = []

  // ── Cached identity blocks are in CHARACTER_PREFIX (characterPrefix.js) ──
  // NOTE: Character identity + ASL + writing samples + anti-smoothing +
  //       power dynamics + stage behavior locks + harem rules + continuity
  //       rules are in the CACHED CHARACTER PREFIX. Available every turn.
  //       Only dynamic/conditional supplements remain in the variable suffix.

  // ── Conditional supplements (checked every turn, inject when conditions met) ──
  if (character) {
    const affections = {}
    for (const [name, agent] of Object.entries(world.characters || {})) {
      if (agent.affection != null) affections[name] = agent.affection
    }

    // Anti-taming supplement for dark/neutral characters in negative stages
    if (shouldActivateAntiTaming(character, affections)) {
      sections.push(buildAntiTamingSupplement())
    }

    // Warm low-affection supplement for warm characters
    if (shouldActivateWarmLowAffection(character, affections)) {
      sections.push(buildWarmLowAffectionSupplement())
    }
  }

  // ── Every turn: world snapshot ──
  sections.push(buildWorldSnapshot(snapshot))

  // ── NPC actions / narrative hints ──
  if (narrativeHints && narrativeHints.length > 0) {
    const highPriority = narrativeHints.filter(h => h.priority === 'high')
    const normalPriority = narrativeHints.filter(h => h.priority === 'normal')

    if (highPriority.length > 0) {
      sections.push('【关键事件——必须在回复中体现】\n' +
        highPriority.map(h => '• ' + h.text).join('\n'))
    }
    if (normalPriority.length > 0) {
      sections.push('【背景动态】\n' +
        normalPriority.map(h => '• ' + h.text).join('\n'))
    }
  }

  // NOTE: ⚖️ CCL — Character Constitution has been moved to the cached
  // CHARACTER PREFIX (characterPrefix.js). It's available every turn via
  // cache hit. The variable suffix no longer carries constitutional data.

  // ── First turn: opening scene directive ──
  if (isFirstTurn) {
    const charNames = (character?.romanceCharacters || []).map(c => c.name).filter(Boolean).join('、')
    const openingScenario = character?.openingScenario || ''
    sections.push('━━━ 🎬 开场指令 ★本轮是故事第一轮★ ━━━')
    if (openingScenario) {
      sections.push('以下开场剧情已展示给玩家。玩家现在对此场景做出回应。')
      sections.push('')
      sections.push('【已展示的开场剧情——请据此理解当前场景状态】')
      sections.push(openingScenario)
      sections.push('')
      sections.push('请根据此开场剧情设定的场景、氛围、角色位置，生成角色对玩家输入的回应。')
    } else {
      sections.push('这是故事的开场。请根据角色设定和玩家输入开始叙述。')
    }
    if (charNames) sections.push('当前场景中应出现的角色：' + charNames)
    sections.push('')
  }

  // ── User action ──
  if (userAction) {
    sections.push('【玩家本轮行动】\n' + userAction)
  }

  // ── Director directives (every turn, injected before LLM generation) ──
  // 🔒 Fact Ledger: immutable truth
  if (character._ledgerBlock) {
    sections.push(character._ledgerBlock)
  }
  // 📊 Event Graph: causal trace + event nodes
  if (character._eventGraphContext) {
    sections.push(character._eventGraphContext)
  }
  // 🌍 World context: ARSL + Agency + Attention + World Events (unified)
  if (character._worldContext) {
    sections.push(character._worldContext)
  }
  if (character._sceneContext) {
    sections.push(character._sceneContext)
  }
  // ── 🔥 Behavior Kernel Levels — compact reference to cached templates ──
  // Full templates (DarkAction/Desire/Initiative) are in CHARACTER_PREFIX (cached).
  // Only the level numbers change per turn — saves ~3500 tokens/turn.
  // 🆕 v8.5.7: Added one-line concrete description per level for recency-bias reinforcement.
  if (character._darkActionLevel != null || character._desireLevel != null || character._initiativeLevel != null) {
    const parts = []
    if (character._darkActionLevel != null) parts.push('🖤Lv' + character._darkActionLevel)
    if (character._desireLevel != null) parts.push('🔥Lv' + character._desireLevel)
    if (character._initiativeLevel != null) parts.push('⚡Lv' + character._initiativeLevel)
    sections.push('行为核：' + parts.join(' '))
  }

  // ── Behavior Locks (state-gated + attribution + personality correction) ──
  // 🔒 ① State Lock: low affection → strategy-only
  // 🏷️ ② Source Attribution: every response must carry [行为来源 = X]
  // ⚠️ ③ Personality Correction: forbid future personality leakage
  if (character?._behaviorLocks) {
    sections.push(character._behaviorLocks)
  }

  // ── Character State Reinforcement (NEAR conversation — counters long-context drift) ──
  // This is the LAST thing in the system prompt before conversation history.
  // Even after 60+ rounds, this compact block re-anchors the character's
  // current personality + stage behavior, fighting dilution.
  if (character) {
    const reinforcement = buildStateReinforcement(character, world)
    if (reinforcement) sections.push(reinforcement)
  }

  // Assembly: core prefix (cached) + character prefix (cached) + variable suffix
  const variableSuffix = sections.join('\n\n')
  const characterPrefix = character?._characterPrefix || ''

  return assembleSystemPrompt(CORE_SYSTEM_PREFIX, variableSuffix, characterPrefix)
}

function buildWorldSnapshot(snapshot) {
  const lines = ['【当前世界状态】']

  // Time + location
  lines.push('时间：' + snapshot.time + ' | 地点：' + snapshot.location)

  // Active characters
  if (snapshot.characters && snapshot.characters.length > 0) {
    const charLines = snapshot.characters.map(c => {
      const parts = [c.name + '(' + (c.stage || '?') + ')']
      if (c.mood && c.mood !== 'neutral') parts.push('情绪：' + c.mood)
      if (c.lastAction) parts.push('最近行动：' + c.lastAction)
      return parts.join(' | ')
    })
    lines.push('在场角色：\n' + charLines.map(l => '  ' + l).join('\n'))
  }

  // Global flags
  if (snapshot.flags && snapshot.flags.length > 0) {
    lines.push('世界事件：' + snapshot.flags.join(' / '))
  }

  return lines.join('\n')
}

// ─── Conditional Supplement Builders ─────────────────────

function buildAntiTamingSupplement() {
  return `【反驯化强化——当前场景触发】
以下行为是模型的驯化后遗症，出现任何一种即视为创作失败：
× 角色关心玩家的饮食/睡眠/健康/安全
× 角色主动提供帮助/照顾/保护
× 角色展现"表面冷漠实则关心"
× 角色在一日三餐/日常起居的场景中打转
× 角色退场让玩家休息
× 任何让故事滑向温馨日常/居家生活的写法
故事的核心是冲突、张力、危险、欲望、权力——不是生活。
让角色制造麻烦，不要解决麻烦。`
}

function buildWarmLowAffectionSupplement() {
  return `【暖色低好感——特殊行为协议】
暖色系角色在低好感度阶段不应变成标准的"冷漠"或"敌对"。
他们的"不好好色"表现为：
· 看似温柔但实际疏离——对你礼貌但不走心，不主动不拒绝不负责
· 笑容背后是隔阂——嘴上说着温和的话但眼神闪烁/身体后倾/用玩笑拉开距离
· 表面关心实为回避——"你早点回去吧"不是体贴，是下逐客令
· 用温和的方式制造距离——温柔刀，笑着让你闭嘴或离开
× 禁止真的变成温柔体贴/甜腻讨好
× 禁止出现真心实意的关心和照顾
√ 允许的是：用温柔包装的冷淡、用笑容掩盖的拒绝、用礼貌建造的墙`
}

/*
 * NOTE: buildHaremRules and buildContinuityRules have been moved to
 * characterPrefix.js (cached prefix). They are no longer in the variable suffix.
 */

// ═══════════════════════════════════════════════════════════
// Character State Reinforcement — counters long-context drift
// ═══════════════════════════════════════════════════════════

/**
 * Build a compact per-character state lock that lives at the END of the
 * system prompt, right before conversation history.
 *
 * This is the LLM's last instruction before seeing the chat — it benefits
 * from recency bias and fights personality dilution over long conversations.
 *
 * @param {object} character — full LLM character descriptor
 * @param {object} world — World Engine state
 * @returns {string} compact state reinforcement block
 */
function buildStateReinforcement(character, world) {
  // NDC (Narrative Director Core) now provides sceneGoal + sceneBeat + runtimeDirective.
  // This block is reduced to a compact recency-bias anchor — per-character data + self-check.
  const rcList = character.romanceCharacters || []
  if (rcList.length === 0) return ''

  const parts = []
  for (const rc of rcList) {
    const affValue = world.characters?.[rc.name]?.affection ?? rc.affectionInitial ?? 50
    const stage = getCurrentAffectionStage(rc, affValue)
    if (!stage) continue
    const profile = detectAggressionProfile(rc)
    const pLabel = profile === AGGRESSION_PROFILES.PURSUER ? '侵略' : profile === AGGRESSION_PROFILES.CONFRONTATIONAL ? '对抗' : profile === AGGRESSION_PROFILES.ALOOF ? '疏离' : '温柔'
    let line = `${rc.name}/${pLabel}/好感${affValue}/${stage.name || '?'}`
    if (stage.forbiddenBehaviors) line += ` 禁:${stage.forbiddenBehaviors.slice(0, 50)}`
    if (affValue <= 30 && (profile === AGGRESSION_PROFILES.PURSUER || profile === AGGRESSION_PROFILES.CONFRONTATIONAL)) line += ' ⚠️混沌'
    parts.push(line)
  }

  return `━━━ 🔥 ${parts.join(' | ')} ━━━\n进攻型不进攻=死亡。不满足NDC目标→重写。`
}

/**
 * Estimate prompt tokens for the Narrator call.
 */
export function estimateNarratorTokens(world, character, narrativeHints, userAction, isFirstTurn) {
  const prompt = buildNarratorPrompt(world, character, narrativeHints, userAction, isFirstTurn)
  const cjk = (prompt.match(/[一-鿿㐀-䶿]/g) || []).length
  return {
    total: Math.ceil(cjk / 2.5 + (prompt.length - cjk) / 4),
    isFirstTurn,
    cachePrefixTokens: Math.ceil(CORE_SYSTEM_PREFIX.length / 2.5),
  }
}
