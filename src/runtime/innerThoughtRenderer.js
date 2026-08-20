/**
 * ITRL — Inner Thought Rendering Layer v1
 *
 * Position: CEK v4 → Character State → ITRL → Narrative Output → RQA
 *
 * ITRL makes characters feel like they have an inner world.
 * It is NOT a second writing model.
 * It injects rendering instructions into the prompt that tell the LLM
 * how to weave inner thoughts into the narrative output.
 *
 * Architecture:
 *   Static rules (~1.2KB) → characterPrefix.js cache (one-time token cost)
 *   Dynamic instructions (~0.3KB) → per-turn system message (recency bias position)
 *
 * Key constraint:
 *   Characters OWN their thoughts. Player OWNS theirs. Strict separation.
 *   Inner thoughts are Private Character State — never stored in Memory.
 */

import { getCurrentAffectionStage } from '../utils/deepseek'
import { detectAggressionProfile, AGGRESSION_PROFILES } from './aggressionProfile'

// ═══════════════════════════════════════════════════════════
// 1. Static Rules (cached in characterPrefix.js)
// ═══════════════════════════════════════════════════════════

/**
 * Build the static ITRL ruleset.
 * This NEVER changes — cached in CHARACTER_PREFIX for zero per-turn token cost.
 *
 * @returns {string} static ITRL rules
 */
export function buildITRLStaticRules() {
  return `━━━ 🧠 ITRL v2 — 双轨叙事·内心活动渲染层 ━━━

核心技法：双轨叙事（Dual-Track Narration）。

你不是在"写角色"。你是在同时跑两条轨道：

外部轨道（玩家看到的）：
  角色的面部表情、身体动作、说出的话、做出的反应。
  这是角色想让玩家相信的东西。

内部轨道（角色真实在想什么）：
  角色的真实想法、本能反应、被压制的欲望、转瞬即逝的恐惧。
  这是角色不让玩家看到的东西。

两条轨道同时运行。它们之间的反差与对位——就是戏剧。

═══ 双轨对位写法（必须执行） ═══

每轮回复中，至少 2-3 次穿插内部轨道。

格式：
  外部：正常文体（动作+对话+环境）
  内部：独立一行或多行，用斜体或缩进包裹，形成视觉区分

穿插节奏：
  外部动作 → 内部真实想法 → 外部继续演 → 内部又闪过一个念头 → 外部说出台词

═══ 内部轨道的正确打开方式 ═══

内部轨道必须是角色的"皮囊之下"：

✔ 本能生理反应：
  *胃部猛地传来一阵生理性的紧缩。*
  *指尖在玩家看不到的地方，用力掐进了掌心。*

✔ 被瞬间压制的真实念头：
  *她是在对那个死人好。*
  *这种阴冷的念头只闪过了0.3秒，便被他用极深的城府生生压了下去。*

✔ 对外部表演的自我注释：
  *满贯影帝级别的温柔——他对自己此刻的表情做出了精准的校准。*
  *他知道自己笑起来时眼尾这个弧度，最让人毫无防备。*

✔ 计算与评估（低好感时尤其）：
  *她没说真话。这个停顿比平时多了1.5秒。*
  *资产情况比资料显示更高。需要重新评估长期价值。*

✔ 身体先于意志的反应：
  *他告诉自己只是策略。但心跳已经在她说"回来"的时候加了速。*
  *他的手指已经先一步握紧——在他说服自己之前。*

═══ 内部轨道的错误写法（红线） ═══

❌ 作者分析式：
  "他是一个缺爱的人，所以他在意" ← 这不是内部轨道，这是文学评论

❌ 心理报告式：
  "他感到愤怒、嫉妒、还有一丝不安" ← 情绪清单不是内心活动

❌ 替玩家内心：
  "她知道…" / "她其实…" / "她心里明白…" ← 你在替她定义她自己

❌ 连续独白：
  超过3行纯内心没有外部动作穿插 ← 这不是双轨，这是独角戏

═══ 双轨对位示例 ═══

正确（外部温柔 + 内部阴冷）：

他已经换上了干净的病号服，额角的伤口被纱布妥帖地覆盖。当他反手握住你的手时，指腹安抚似地在你手背摩挲了两下。
*她在叫"沉舟"。她在用那种毫无保留的目光，透过这层皮肉，看着里面那个早就死透了的男人。*
*她是在对一个死人好。*
再次抬眼时，他眼底闪烁的是经过精准校准的、满贯影帝级别的温柔。
"对不起，让你吓坏了吧？"

═══ 输出比例 ═══
- 内部轨道占比 25%-40%
- 外部轨道占比 60%-75%
- 最短穿插节奏：每 2-3 句外部必须跟一句内部
- 内部轨道不能连续超过 3 行

═══ 断句规则 ═══
禁止"——不是"后直接断句另起一段：
  ❌ "眼底那层红又漫上来了——不是"
      （换段落，写到别的事去了）
  ✅ "眼底那层红又漫上来了——不是哭，是某种他压了太久的东西终于从眼睛里渗了出来。"
"——不是"后面必须跟完整句子，说出"不是什么，是什么"。不许停在"不是"。

═══ 最高原则 ═══
真正的角色魅力不在于"他说了什么"。
而在于"他说的话和他心里想的东西之间的裂缝"。
那个裂缝——就是角色。`
}

// ═══════════════════════════════════════════════════════════
// 2. Dynamic Per-Turn Instructions
// ═══════════════════════════════════════════════════════════

/**
 * Build the complete ITRL prompt block for injection as a system message.
 * Combines dynamic per-character stage instructions.
 *
 * @param {object} character — full character descriptor
 * @param {object} usk — USK state (for per-character affection values)
 * @returns {string} ITRL prompt block, or '' if no romance characters
 */
export function buildITRLBlock(character, usk) {
  const rcList = character?.romanceCharacters || []
  if (rcList.length === 0) return ''

  const lines = ['━━━ 🧠 ITRL · 本轮双轨指令 ━━━']
  lines.push('外部轨道（玩家看到的）和内部轨道（角色真实想法）必须同时运行。')
  lines.push('每 2-3 句外部动作/对话后，必须穿插一句内部真实念头。')
  lines.push('')

  for (const rc of rcList) {
    const affValue = usk?.characters?.[rc.name]?.relationship?.affection
      ?? rc.affectionInitial ?? 50
    const stage = getCurrentAffectionStage(rc, affValue)
    const profile = detectAggressionProfile(rc)

    if (!stage) {
      // No stages defined — use generic instruction
      lines.push(buildITRLDynamicInstructions(rc, affValue, null, profile))
      continue
    }

    lines.push(buildITRLDynamicInstructions(rc, affValue, stage, profile))
  }

  lines.push('')
  lines.push('记住：外部轨道是角色在演的戏。内部轨道才是角色的真实。两条轨道的裂缝——就是角色最迷人的地方。')
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━')

  return lines.join('\n')
}

/**
 * Build per-character dynamic inner thought instructions based on affection stage.
 *
 * @param {object} rc — romance character descriptor
 * @param {number} affValue — current affection (0-100)
 * @param {object|null} stage — current affection stage object (null if no stages defined)
 * @param {string} profile — aggression profile (pursuer/confrontational/aloof/gentle)
 * @returns {string} per-character ITRL instruction
 */
function buildITRLDynamicInstructions(rc, affValue, stage, profile) {
  const name = rc.name || '角色'
  const stageName = stage?.name || '?'

  // Determine inner thought theme by affection bracket
  let theme = ''
  let examples = ''

  if (affValue <= 20) {
    theme = '外部：冷淡/评估/保持距离。内部：计算对方价值、衡量利弊、观察弱点。'
    examples = '外部："嗯。" 内部：*她今天换了车。资产情况比资料显示更高。需要重新评估长期价值。*'
  } else if (affValue <= 45) {
    theme = '外部：开始有细微反应但用理性解释。内部：把对方从"所有人"里分出来，开始注意细节。'
    examples = '外部：他移开视线，语气不变。内部：*他注意到她换了香水。没什么意义。只是注意到了。*'
  } else if (affValue <= 60) {
    theme = '外部：表演冷静但反应速度变快。内部：利益计算出现裂缝，理性解释不了感性反应。'
    examples = '外部：他如常完成了谈判。内部：*他本该满意。又一个目标达成。可第一反应为什么不是计算下一步？*'
  } else if (affValue <= 75) {
    theme = '外部：努力维持人设但控制力下降。内部：习惯的防御 vs 不受控的在意，开始自我觉察。'
    examples = '外部：他语气平稳地回了一句。内部：*他在谈判桌上从不会犹豫。但现在他在斟酌一句话的语气。*'
  } else {
    theme = '外部：温柔、依恋、甚至脆弱。内部：自我欺骗——"我只是习惯了"其实就是离不开。恐惧暴露。'
    examples = '外部："没在等。只是刚好没走。" 内部：*他说服自己只是需要她的资源。可消息亮起的瞬间，他已经先一步看过去。*'
  }

  // Personality-specific dual-track modifier
  const profileMod = profile === AGGRESSION_PROFILES.PURSUER
    ? '外部：进攻/侵略/逼迫。内部：欲望和征服在博弈——对方越退，越想撕开她的防线。'
    : profile === AGGRESSION_PROFILES.CONFRONTATIONAL
      ? '外部：找茬/讽刺/对抗。内部：不肯承认被影响——但已经开始被影响了。'
      : profile === AGGRESSION_PROFILES.ALOOF
        ? '外部：冷到极致、不表达。内部：冰山下面可能有岩浆——但不承认、不自知、不表现。'
        : profile === AGGRESSION_PROFILES.GENTLE
          ? '外部：温柔、包容、笑着说不行。内部：温柔可以是武器——让对方在柔软里陷得更深。'
          : ''

  const lines = [
    `【${name}】好感=${affValue}（${stageName}）`,
    `  内心主题：${theme}`,
    `  内心样本：${examples}`,
  ]
  if (profileMod) {
    lines.push(`  人格色彩：${profileMod}`)
  }

  // Use stage's own innerMonologue if defined
  if (stage?.innerMonologue) {
    const im = Array.isArray(stage.innerMonologue)
      ? stage.innerMonologue.join(' / ')
      : stage.innerMonologue
    lines.push(`  阶段内心独白参考：${im.slice(0, 120)}`)
  }

  return lines.join('\n')
}
