/**
 * ⚙️ Character Execution Kernel v3 — Industrial+ Narrative Economy Edition
 *
 * "CEK v3 的目标不是让角色正确——而是让每一段关系都具备:
 *  欲望 → 冲突 → 失衡 → 爆点"
 *
 * v2 → v3 upgrade:
 *   v2: control characters so they DON'T break
 *   v3: control narrative so it DOES explode
 *
 * New systems:
 *   💰 Emotion Economy      — emotions as currency, must be "traded"
 *   ⚡ Tension Accumulator   — tension builds → threshold → explosion
 *   🕸 Rivalry Graph         — competition/jealousy/avoidance/dependence edges
 *   🧨 Explosion Trigger     — tension>70 + attention split → fire
 *   💥 Explosion Generator   — confrontation dialogue + emotional burst
 *   🔒 Firewall v3           — forbid "zero-tension dialogue"
 *   🧭 Direction Lock        — all plot must orbit player emotional position
 *   📡 Attention Split       — player attention must be unbalanced, contestable
 */

import { detectAggressionProfile, AGGRESSION_PROFILES } from './aggressionProfile'
import { getCurrentAffectionStage } from '../utils/deepseek'

// ═══════════════════════════════════════════════════════════
// 0. Constants + Internal State
// ═══════════════════════════════════════════════════════════

const PHASE_1_MAX = 25, PHASE_2_MAX = 50, PHASE_3_MAX = 75

const ROLE_MODES = { 1: 'hunter', 2: 'performer', 3: 'breaking', 4: 'collapsed' }

const BEHAVIOR_ACTIONS = ['observe', 'seduce', 'reject', 'escalate', 'withdraw', 'test', 'provoke', 'ignore', 'submit', 'expose']

const DESIRE_LABELS = { 0: '冷', 1: '注意', 2: '好奇', 3: '吸引', 4: '压抑', 5: '爆发' }

/** @type {number} — explosion cooldown, prevents back-to-back explosions */
const EXPLOSION_COOLDOWN_TURNS = 3

// ── Persistent internal state ──
const $ = {
  turnCount: 0,
  /** @type {Map<string, object>} — EmotionAccount per character */
  accounts: new Map(),
  /** @type {number} — global narrative tension 0-100 */
  globalTension: 30,
  /** @type {Map<string, number>} — per-character desire 0-5 */
  desireGradients: new Map(),
  /** @type {Map<string, number>} — previous desire for delta check */
  prevDesire: new Map(),
  /** @type {Map<string, object>} — emotion curves (tension/curiosity/control/dependence) */
  emotionCurves: new Map(),
  /** @type {Map<string, object>} — previous emotion curves */
  prevEmotion: new Map(),
  /** @type {number} — turns since last explosion */
  explosionCooldown: 0,
  /** @type {object|null} — rivalry graph edges */
  rivalryEdges: null,
  /** @type {object|null} — attention split { [charName]: percentage } */
  attentionSplit: null,
  /** @type {string|null} — player emotional position this turn */
  playerPosition: null,
}

// ═══════════════════════════════════════════════════════════
// ① Emotion Economy Engine
// ═══════════════════════════════════════════════════════════

/**
 * EmotionAccount — each character's emotional "wallet."
 *
 * Emotions are a zero-sum-ish economy: one character's gain
 * is often another's loss. Attention is the primary currency.
 *
 * @typedef {object} EmotionAccount
 * @property {number} attentionBalance — player attention banked (0-100)
 * @property {number} jealousyCredit  — accumulated jealousy (0-100)
 * @property {number} dependencyDebt  — unmet dependency need (0-100)
 * @property {number} desireStock     — pent-up desire waiting to express (0-100)
 * @property {number} frustrationIndex — accumulated frustration (0-100)
 */

function createAccount() {
  return {
    attentionBalance: 30,
    jealousyCredit: 10,
    dependencyDebt: 20,
    desireStock: 15,
    frustrationIndex: 10,
  }
}

/**
 * Update emotion accounts for all characters based on this turn's events.
 *
 * Rules:
 *   - Player interacting with char → attentionBalance ↑, frustrationIndex ↓
 *   - Player interacting with OTHER char → jealousyCredit ↑, frustrationIndex ↑
 *   - Time passing → desireStock ↑, dependencyDebt ↑
 *   - Being rejected/ignored → frustrationIndex ↑↑
 *
 * @param {string[]} charNames — all romance character names
 * @param {object} affectionMap — current affection values
 * @param {string} userText — player input this turn
 * @param {object} attentionSplit — computed attention distribution
 */
function tickEmotionEconomy(charNames, affectionMap, userText, attentionSplit) {
  for (const name of charNames) {
    let acct = $.accounts.get(name)
    if (!acct) { acct = createAccount(); $.accounts.set(name, acct) }

    const attn = attentionSplit?.[name] || (100 / Math.max(charNames.length, 1))
    const prevAttn = $.attentionSplit?.[name] || attn
    const attnDelta = attn - prevAttn

    // ── Attention balance: gain when player focuses, drain when ignored ──
    acct.attentionBalance = clamp(acct.attentionBalance + attnDelta * 0.5, 0, 100)

    // ── Jealousy credit: rises when OTHER characters get more attention ──
    const otherAttn = 100 - attn
    const otherAvg = charNames.length > 1 ? otherAttn / (charNames.length - 1) : 0
    acct.jealousyCredit = clamp(acct.jealousyCredit + (otherAvg > attn ? 8 : -3), 0, 100)

    // ── Dependency debt: rises with time + unmet attention ──
    acct.dependencyDebt = clamp(acct.dependencyDebt + (attn < 30 ? 5 : -2), 0, 100)

    // ── Desire stock: pent-up desire, rises when attention is low but attraction is high ──
    const aff = affectionMap[name] || 50
    const attractionFactor = aff > 30 ? (aff - 30) / 70 : 0  // 0-1, higher aff = more desire
    acct.desireStock = clamp(acct.desireStock + attractionFactor * 3, 0, 100)

    // ── Frustration: rises with jealousy + unmet dependency ──
    acct.frustrationIndex = clamp(
      acct.jealousyCredit * 0.3 + acct.dependencyDebt * 0.4 + (100 - acct.attentionBalance) * 0.3,
      0, 100)

    // ── Named-entity check: player mentions THIS character by name → bonus ──
    if (userText && userText.includes(name)) {
      acct.attentionBalance = clamp(acct.attentionBalance + 15, 0, 100)
      acct.frustrationIndex = clamp(acct.frustrationIndex - 10, 0, 100)
      acct.desireStock = clamp(acct.desireStock + 5, 0, 100)  // being called by name fuels desire
    }
  }
}

// ═══════════════════════════════════════════════════════════
// ② Tension Accumulator
// ═══════════════════════════════════════════════════════════

/**
 * Compute global narrative tension from all sources.
 *
 * Tension = jealousy + desire + misunderstanding + delay
 *
 * Each component is 0-25. Total is 0-100.
 *
 * @param {Map<string, object>} accounts
 * @param {object} attentionSplit
 * @returns {number} global tension 0-100
 */
function accumulateTension(accounts, attentionSplit) {
  const charNames = [...accounts.keys()]
  if (charNames.length === 0) return 30

  // ── Jealousy component: max jealousy across all chars ──
  let maxJealousy = 0
  for (const [, acct] of accounts) {
    if (acct.jealousyCredit > maxJealousy) maxJealousy = acct.jealousyCredit
  }
  const jealousyComponent = (maxJealousy / 100) * 25

  // ── Desire component: avg desire stock ──
  let totalDesire = 0
  for (const [, acct] of accounts) totalDesire += acct.desireStock
  const avgDesire = charNames.length > 0 ? totalDesire / charNames.length : 0
  const desireComponent = (avgDesire / 100) * 25

  // ── Misunderstanding component: derived from frustration + attention imbalance ──
  const attnValues = Object.values(attentionSplit || {})
  const attnSpread = attnValues.length > 1 ? Math.max(...attnValues) - Math.min(...attnValues) : 0
  const misunderstandingComponent = Math.min(25, attnSpread * 0.25)

  // ── Delay component: turns since last explosion ──
  const delayComponent = Math.min(25, $.explosionCooldown * 4)

  const tension = jealousyComponent + desireComponent + misunderstandingComponent + delayComponent
  const smoothed = $.globalTension * 0.7 + tension * 0.3  // smooth transitions

  $.globalTension = clamp(smoothed, 0, 100)
  return $.globalTension
}

// ═══════════════════════════════════════════════════════════
// ③ Rivalry Graph Builder
// ═══════════════════════════════════════════════════════════

/**
 * Build the rivalry graph from character list + ARSL edges.
 *
 * Edge types:
 *   - competition  — both want player's attention
 *   - jealousy     — one envies the other's relationship with player
 *   - avoidance    — one deliberately stays away from the other
 *   - dependence   — one needs the other's validation/approval
 *
 * @param {object[]} rcList — romance character descriptors
 * @param {object} arslEdges — ARSL edges from RelationshipPhysics (optional)
 * @returns {object} rivalry graph { nodes, edges }
 */
function buildRivalryGraph(rcList, arslEdges = {}) {
  const nodes = rcList.map(rc => ({
    name: rc.name,
    profile: detectAggressionProfile({ personality: rc.personality, background: rc.background }),
    affection: rc.affectionInitial ?? 50,
  }))

  const edges = []
  const names = nodes.map(n => n.name)

  // Build edges between each pair
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j]
      const edgeA = arslEdges['user_' + a] || {}
      const edgeB = arslEdges['user_' + b] || {}

      // Determine dominant edge type
      let edgeType = 'competition'  // default: both want player

      const aJealousy = $.accounts.get(a)?.jealousyCredit || 10
      const bJealousy = $.accounts.get(b)?.jealousyCredit || 10

      if (aJealousy > 50 && bJealousy > 50) edgeType = 'jealousy'
      else if (aJealousy > 50 || bJealousy > 50) edgeType = 'competition'
      else if ((edgeA.dependency || 30) > 60 || (edgeB.dependency || 30) > 60) edgeType = 'dependence'

      edges.push({
        from: a, to: b,
        type: edgeType,
        intensity: clamp((aJealousy + bJealousy) / 2, 0, 100),
        playerAnchored: true,  // all edges MUST be player-anchored
      })
    }
  }

  $.rivalryEdges = { nodes, edges }
  return $.rivalryEdges
}

// ═══════════════════════════════════════════════════════════
// ④ Explosion Trigger System
// ═══════════════════════════════════════════════════════════

/**
 * Check if conditions are met for a narrative explosion.
 *
 * Conditions:
 *   1. Global tension > 70
 *   2. Player attention is split (no single char has >60%)
 *   3. Explosion cooldown has elapsed
 *   4. At least 2 characters active
 *
 * @returns {{ shouldExplode: boolean, type: string|null, actors: string[] }}
 */
function evaluateExplosionTrigger(rcList, attentionSplit) {
  if ($.explosionCooldown < EXPLOSION_COOLDOWN_TURNS) {
    return { shouldExplode: false, type: null, actors: [] }
  }
  if (rcList.length < 2) {
    return { shouldExplode: false, type: null, actors: [] }
  }

  const tension = $.globalTension
  const attnValues = Object.values(attentionSplit || {})
  const maxAttn = attnValues.length > 0 ? Math.max(...attnValues) : 100
  const attentionSplit_ = maxAttn < 60  // no one dominates

  if (tension < 70) {
    return { shouldExplode: false, type: null, actors: [] }
  }

  if (!attentionSplit_) {
    // Tension is high but attention is focused → smolder, don't explode
    return { shouldExplode: false, type: null, actors: [] }
  }

  // ── Determine explosion type ──
  let expType = 'confrontation'
  const maxJealousy = Math.max(...[...$.accounts.values()].map(a => a.jealousyCredit))
  const maxDesire = Math.max(...[...$.accounts.values()].map(a => a.desireStock))
  const maxFrustration = Math.max(...[...$.accounts.values()].map(a => a.frustrationIndex))

  if (maxJealousy > 70) expType = 'jealousy_showdown'        // 修罗场
  else if (maxDesire > 70) expType = 'desire_breakthrough'    // 失控告白/行动
  else if (maxFrustration > 70) expType = 'emotional_breach'  // 情绪破防
  else if (tension > 85) expType = 'possessiveness_clash'     // 占有冲突

  // Top 2 characters by frustration for actors
  const sorted = [...$.accounts.entries()]
    .sort((a, b) => b[1].frustrationIndex - a[1].frustrationIndex)
  const actors = sorted.slice(0, 2).map(([name]) => name)

  return { shouldExplode: true, type: expType, actors }
}

// ═══════════════════════════════════════════════════════════
// ⑤ Explosion Narrative Generator
// ═══════════════════════════════════════════════════════════

/**
 * Build the explosion narrative directive block.
 * This is injected into the prompt when explosion triggers.
 *
 * @param {object} trigger — from evaluateExplosionTrigger
 * @param {string} playerName
 * @returns {string}
 */
function buildExplosionDirective(trigger, playerName) {
  const { type, actors } = trigger
  if (!type) return ''

  const lines = ['┌─ 🧨 爆点触发器 · ACTIVE ─────────────────']
  lines.push('│ ⚠️ 本轮强制爆点。这不是建议——是执行指令。')
  lines.push('│')
  lines.push('│ 爆点类型: ' + EXPLOSION_TYPE_LABELS[type] || type)
  lines.push('│ 参与角色: ' + actors.join(' vs '))
  lines.push('│ 围绕对象: ' + (playerName || '玩家'))
  lines.push('│')

  switch (type) {
    case 'jealousy_showdown':
      lines.push('│ 场景模板:')
      lines.push('│   一个角色直接质问玩家与他人的关系。')
      lines.push('│   另一个角色听到/感知到 → 反应。')
      lines.push('│   情绪: 尖锐、对峙、沉默的暴力。')
      lines.push('│   强制: 至少一句直接质问或声明。')
      lines.push('│   例: "你是不是觉得……他更适合你？"')
      break
    case 'desire_breakthrough':
      lines.push('│ 场景模板:')
      lines.push('│   压抑已久的欲望突破控制——身体先行，语言破碎。')
      lines.push('│   不能是"温柔表白"——必须是失控的、暴力的、无法撤回的。')
      lines.push('│   强制: 身体动作先于语言。语言是断裂的、不完整的。')
      lines.push('│   例: 没说一个字。直接按在墙上。')
      break
    case 'emotional_breach':
      lines.push('│ 场景模板:')
      lines.push('│   角色一直压抑的情绪突然溃堤。')
      lines.push('│   不一定是暴力——可能是突如其来的脆弱、崩溃、或异常安静。')
      lines.push('│   强制: 情绪必须有"最后一根稻草"触发——玩家的一句话、一个表情。')
      break
    case 'possessiveness_clash':
      lines.push('│ 场景模板:')
      lines.push('│   两个角色同时想占有玩家的注意力/身体/空间。')
      lines.push('│   直接对抗——打断、挡在中间、宣示主权。')
      lines.push('│   强制: 物理位置变化——一个角色介入另一个和玩家之间。')
      break
    default:
      lines.push('│ 强制: 冲突必须围绕玩家，必须有情绪变化。')
  }

  lines.push('│')
  lines.push('│ ❗ 爆点规则:')
  lines.push('│   · 不能被打断——爆点一旦开始，必须走完')
  lines.push('│   · 不能和平解决——本轮不化解，只暂停')
  lines.push('│   · 必须有后果——关系变化、身体距离变化、或新的裂隙')
  lines.push('└──────────────────────────────────────────')

  return lines.join('\n')
}

const EXPLOSION_TYPE_LABELS = {
  jealousy_showdown: '修罗场 · 嫉妒对峙',
  desire_breakthrough: '欲望突破 · 失控行动',
  emotional_breach: '情绪破防 · 溃堤',
  possessiveness_clash: '占有冲突 · 主权宣示',
}

// ═══════════════════════════════════════════════════════════
// ⑥ Narrative Direction Lock
// ═══════════════════════════════════════════════════════════

/**
 * Build the narrative direction lock prompt block.
 * All plot must orbit player emotional position.
 *
 * @param {string} playerName
 * @param {object} attentionSplit
 * @returns {string}
 */
function buildDirectionLock(playerName, attentionSplit) {
  // Determine player's current emotional position
  const maxAttn = Math.max(...Object.values(attentionSplit || { 玩家: 100 }))
  const attnCount = Object.keys(attentionSplit || {}).length

  let position
  if (maxAttn > 60) position = '被争夺 — 一方主导，另一方虎视眈眈'
  else if (attnCount >= 2) position = '被分裂 — 两个方向同时拉扯'
  else position = '被注视 — 一人的全部注意力在你身上'

  $.playerPosition = position

  return `┌─ 🧭 叙事方向锁 (Narrative Direction Lock) ──
│
│ 所有剧情必须围绕玩家情绪位置展开。
│
│ 玩家当前情绪位置: ${position}
│
│ 玩家状态类型:
│   · 被争夺 — 两个或以上的角色在争夺你的注意力/情感/身体
│   · 被忽视 — 角色故意冷落你（策略性撤退，不是遗忘）
│   · 被依赖 — 角色需要你的反应/认可/存在
│   · 被误解 — 角色对你的判断是错的（且错得越来越远）
│   · 被选择 — 一个角色正在评估"要不要继续"
│
│ ❗ 本轮方向: 所有角色行为 → 必须推动/改变/加剧玩家的情绪位置
│ ❌ 禁止: 角色行为与玩家情绪位置无关的独立剧情
│ ❌ 禁止: 剧情漂移到角色自身故事线（玩家的故事才是主轨道）
└──────────────────────────────────────────`
}

// ═══════════════════════════════════════════════════════════
// ⑦ Attention Split Controller
// ═══════════════════════════════════════════════════════════

/**
 * Compute attention split from affection distribution.
 * Player attention must be: unbalanced, unstable, contestable.
 *
 * @param {object[]} rcList
 * @param {object} affectionMap
 * @returns {object} { [charName]: percentage (0-100), isBalanced: boolean }
 */
function computeAttentionSplit(rcList, affectionMap) {
  const total = rcList.reduce((sum, rc) => {
    return sum + (affectionMap[rc.name] ?? rc.affectionInitial ?? 50)
  }, 0)

  const split = {}
  for (const rc of rcList) {
    const aff = affectionMap[rc.name] ?? rc.affectionInitial ?? 50
    split[rc.name] = total > 0 ? Math.round((aff / total) * 100) : Math.round(100 / rcList.length)
  }

  // Normalize to sum to 100
  const sum = Object.values(split).reduce((a, b) => a + b, 0)
  if (sum !== 100 && rcList.length > 0) {
    const diff = 100 - sum
    // Add diff to the character with highest affection
    const topChar = rcList.reduce((a, b) =>
      (affectionMap[a.name] ?? 50) > (affectionMap[b.name] ?? 50) ? a : b)
    split[topChar.name] = clamp(split[topChar.name] + diff, 0, 100)
  }

  // Is attention "too balanced"? (no one above 55%)
  const maxAttn = Math.max(...Object.values(split))
  const isBalanced = maxAttn < 55

  $.attentionSplit = split
  return { split, isBalanced, maxAttn, dominantChar: rcList.find(rc => split[rc.name] === maxAttn)?.name }
}

/**
 * Build the attention split prompt block.
 *
 * @param {object} attnResult — from computeAttentionSplit
 * @returns {string}
 */
function buildAttentionBlock(attnResult) {
  const { split, isBalanced } = attnResult
  const playerName = ''

  const lines = ['┌─ 📡 注意力分裂控制器 ──────────────────────']
  lines.push('│ 玩家注意力不是平均分配的——必须: 不平衡 · 不稳定 · 可争夺')
  lines.push('│')

  for (const [name, pct] of Object.entries(split)) {
    const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5))
    lines.push('│ ' + name + ': ' + bar + ' ' + pct + '%')
  }

  if (isBalanced) {
    lines.push('│')
    lines.push('│ ⚠️ 注意力过于平均 → 张力不足 → 需要角色主动打破平衡')
    lines.push('│   建议: 一个角色做出更激进的行为来争夺注意力')
  }

  lines.push('│')
  lines.push('│ 规则:')
  lines.push('│   · 获得更多注意力的角色 → 更有主动权、更占上风')
  lines.push('│   · 获得更少注意力的角色 → 积累嫉妒/挫败 → 更可能发动爆点')
  lines.push('│   · 注意力转移是剧情推进的核心驱动力')
  lines.push('│   · 禁止两个角色各得 50% → 必须有倾斜')
  lines.push('└──────────────────────────────────────────')

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// ⑧ Constraint Firewall v3 — new rule
// ═══════════════════════════════════════════════════════════

function buildFirewallV3Block(rcList, playerName) {
  const lines = ['┌─ 🔒 约束防火墙 v3 ────────────────────────']
  lines.push('│')
  lines.push('│ ▸ 继承 v2 全部规则 (Phase/Memory/Identity)')
  lines.push('│')
  lines.push('│ ▸ 🆕 v3 新增: 禁止"无张力对话"')
  lines.push('│   所有对话必须满足至少一个条件:')
  lines.push('│     · 情绪变化 — 说话者的情绪在对话前后不同')
  lines.push('│     · 权力变化 — 对话改变了角色间的权力关系')
  lines.push('│     · 信息变化 — 对话揭示了新的信息（不是闲聊）')
  lines.push('│')
  lines.push('│   ❌ 禁止:')
  lines.push('│     · 纯粹寒暄（"今天天气不错"）')
  lines.push('│     · 无信息传递的对话（"嗯""哦""好的"——除非是冷暴力策略）')
  lines.push('│     · 没有情绪/权力/信息变化的任何对话')
  lines.push('│')
  lines.push('│   ✅ 允许的是: 每个对话单元推进关系、揭示信息、或改变权力')
  lines.push('└──────────────────────────────────────────')

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// Master Pipeline — buildCEKv3Block
// ═══════════════════════════════════════════════════════════

/**
 * Build the complete CEK v3 prompt block.
 *
 * This is THE main entry point for pre-generation prompt injection.
 *
 * @param {object} character — full LLM character descriptor
 * @param {object} uskState — current USK state
 * @param {object} affectionMap — { [charName]: currentAffectionValue }
 * @param {object} arslEdges — ARSL edges from RelationshipPhysics (for rivalry graph)
 * @returns {string} full CEK v3 prompt block
 */
export function buildCEKv3Block(character, uskState, affectionMap = {}, arslEdges = {}) {
  if (!character) return ''

  const rcList = character.romanceCharacters || []
  if (rcList.length === 0) return ''

  const playerName = character._playerProfile?.name || '玩家'

  // ── Advance turn ──
  $.turnCount++
  $.explosionCooldown++

  // ── ① Compile all characters ──
  const compiledList = []
  for (const rc of rcList) {
    const aff = affectionMap[rc.name] ?? rc.affectionInitial ?? 50
    compiledList.push({
      name: rc.name,
      phase: computePhase(aff),
      roleMode: ROLE_MODES[computePhase(aff)],
      profile: detectAggressionProfile({ personality: rc.personality || '', background: rc.background || '' }),
      affection: aff,
      stageName: (rc.affectionEnabled !== false ? getCurrentAffectionStage(rc, aff) : null)?.name || '未知',
      allowedActions: computeActions(computePhase(aff), detectAggressionProfile({ personality: rc.personality || '', background: rc.background || '' })),
      forbiddenStates: computeForbidden(computePhase(aff)),
    })
  }

  // ── ⑦ Attention Split ──
  const attentionResult = computeAttentionSplit(rcList, affectionMap)

  // ── ① Emotion Economy tick ──
  const charNames = rcList.map(rc => rc.name)
  tickEmotionEconomy(charNames, affectionMap, '', attentionResult.split)

  // ── ② Tension Accumulation ──
  const tension = accumulateTension($.accounts, attentionResult.split)

  // ── ③ Rivalry Graph ──
  buildRivalryGraph(rcList, arslEdges)

  // ── ④ Explosion Trigger ──
  const explosion = evaluateExplosionTrigger(rcList, attentionResult.split)

  // ── ⑥ Emotion Curve tick ──
  for (const cc of compiledList) {
    const uskChar = uskState?.characters?.[cc.name] || {}
    const curve = {
      tension: clamp((uskChar.tension?.emotional_pressure || 20) * 0.5 + cc.phase * 10, 0, 100),
      curiosity: clamp((uskChar.emotion?.curiosity || 30) * 0.6 + (cc.phase < 3 ? 20 : 0), 0, 100),
      control: clamp(100 - (uskChar.relationship?.dependency || 30) * 0.5 - (cc.phase >= 3 ? 30 : 0), 0, 100),
      dependence: clamp((uskChar.relationship?.dependency || 30) * 0.5 + (cc.phase >= 3 ? 25 : 0), 0, 100),
    }
    $.prevEmotion.set(cc.name, $.emotionCurves.get(cc.name) || curve)
    $.emotionCurves.set(cc.name, curve)
  }

  // ── Desire Gradient tick ──
  for (const cc of compiledList) {
    const uskChar = uskState?.characters?.[cc.name] || {}
    const raw = clamp(
      (uskChar.tension?.attraction_tension || 40) * 0.4 +
      (cc.phase >= 2 ? 30 : 0) - (cc.phase === 1 ? 40 : 0) +
      (cc.affection * 0.1),
      0, 100)
    let level = raw < 10 ? 0 : raw < 30 ? 1 : raw < 50 ? 2 : raw < 70 ? 3 : raw < 90 ? 4 : 5
    const prev = $.desireGradients.get(cc.name)
    if (prev != null && Math.abs(level - prev) > 1) level = prev + Math.sign(level - prev) * 1
    $.prevDesire.set(cc.name, $.desireGradients.get(cc.name) ?? level)
    $.desireGradients.set(cc.name, level)
  }

  // ── Assemble all blocks ──
  const sections = []
  sections.push('━━━ ⚙️ CEK v3 · 叙事经济版 ━━━')
  sections.push('你不是在写角色。你不是在讲一个"正确"的故事。')
  sections.push('你在操纵一个包含欲望、冲突、失衡、爆点的叙事经济体。')
  sections.push('')

  // ① State Compiler + BVM (condensed)
  sections.push(buildCompilerBVMBlock(compiledList))

  // 💰 Emotion Economy (NEW)
  sections.push(buildEmotionEconomyBlock())

  // ⚡ Tension Accumulator (NEW)
  sections.push(buildTensionBlock(tension))

  // 🕸 Rivalry Graph (NEW)
  sections.push(buildRivalryBlock())

  // 📡 Attention Split (NEW)
  sections.push(buildAttentionBlock(attentionResult))

  // 🧨 Explosion Trigger — only if active
  if (explosion.shouldExplode) {
    sections.push(buildExplosionDirective(explosion, playerName))
    $.explosionCooldown = 0  // reset cooldown on explosion
  }

  // 🔒 Constraint Firewall v3
  sections.push(buildFirewallV3Block(rcList, playerName))

  // 🧭 Narrative Direction Lock
  sections.push(buildDirectionLock(playerName, attentionResult.split))

  // ── Emotion Curve + Desire Gradient summary ──
  sections.push(buildEmotionDesireSummary(compiledList))

  // ── Final enforcement ──
  sections.push(
    '━━━ ⚙️ CEK v3 执行铁律 ━━━\n' +
    '· 情绪是货币——不能凭空产生，必须"交易"。\n' +
    '· 张力是累积的——只有超过阈值才允许爆点。\n' +
    '· 所有冲突必须围绕玩家——你是所有关系的锚点和所有对抗的奖品。\n' +
    '· 禁止无张力对话——每一句话必须推动情绪/权力/信息变化。\n' +
    '· 注意力必须不平衡——不平衡产生张力，张力产生剧情。\n' +
    (explosion.shouldExplode ? '· 🧨 本轮爆点已触发 → 必须执行爆点场景，不可回避。\n' : '') +
    '· CEK v3 的目标: 让每一段关系都具备欲望 → 冲突 → 失衡 → 爆点。'
  )

  return sections.join('\n\n')
}

// ── Block builders ────────────────────────────────────────

function buildCompilerBVMBlock(compiledList) {
  const lines = ['┌─ ① 状态编译器 + ② 行为虚拟机 ────────────']
  lines.push('│ 角色 = 状态机实例。行为 = ACT[] 指令执行。')
  lines.push('│')
  for (const cc of compiledList) {
    lines.push('│ ' + cc.name + ' → Phase ' + cc.phase + ' | ' + cc.roleMode + ' | ' + cc.profile)
    lines.push('│   ACT: ' + cc.allowedActions.map(a => '[' + a + ']').join(' '))
    lines.push('│   禁止: ' + cc.forbiddenStates.join(' | '))
  }
  lines.push('└──────────────────────────────────────────')
  return lines.join('\n')
}

function buildEmotionEconomyBlock() {
  const lines = ['┌─ 💰 ③ 情绪经济引擎 ────────────────────────']
  lines.push('│ 情绪是货币。不能凭空产生——必须"交易"。')
  lines.push('│')
  for (const [name, acct] of $.accounts) {
    lines.push('│ ' + name + ' 情绪账户:')
    lines.push('│   注意力余额=' + Math.round(acct.attentionBalance) +
      ' | 嫉妒信贷=' + Math.round(acct.jealousyCredit) +
      ' | 依赖债务=' + Math.round(acct.dependencyDebt))
    lines.push('│   欲望存量=' + Math.round(acct.desireStock) +
      ' | 挫败指数=' + Math.round(acct.frustrationIndex))
  }
  lines.push('│')
  lines.push('│ 交易规则:')
  lines.push('│   · 玩家关注 → 注意力余额↑ 挫败↓')
  lines.push('│   · 玩家关注他人 → 嫉妒信贷↑ 挫败↑')
  lines.push('│   · 被冷落 → 欲望存量↑ 依赖债务↑')
  lines.push('│   · 被拒绝 → 挫败指数↑↑')
  lines.push('│')
  lines.push('│ ❗ 情绪经济决定角色"为什么做"——没有情绪余额的行为是空洞的。')
  lines.push('└──────────────────────────────────────────')
  return lines.join('\n')
}

function buildTensionBlock(tension) {
  const level = tension < 30 ? '低 → 日常/过渡场景' :
                tension < 50 ? '中 → 微妙的压力在积累' :
                tension < 70 ? '中高 → 可以感觉到张力，角色开始不适' :
                '高 → 接近爆点，任何刺激都可能触发'
  return `┌─ ⚡ ④ 张力累积器 ────────────────────────────
│ 全局叙事张力: ${Math.round(tension)}/100 [${level}]
│
│ 张力来源:
│   · 竞争关系   · 未回应情感   · 欲望压抑   · 误解   · 时间错位
│
│ 规则: 张力 < 30 → 过渡场景。张力 > 70 → 爆点条件满足。
│       当前张力${tension > 70 ? ' ≥ 爆点阈值 ⚠️' : ' < 爆点阈值'}
│       张力变化: 每轮缓慢累积，爆点后重置。
└──────────────────────────────────────────`
}

function buildRivalryBlock() {
  const graph = $.rivalryEdges
  if (!graph || !graph.edges.length) return ''

  const lines = ['┌─ 🕸 ⑤ 修罗场关系图 ────────────────────────']
  lines.push('│ 所有冲突必须围绕 → 玩家')
  lines.push('│')
  for (const edge of graph.edges) {
    lines.push('│ ' + edge.from + ' ←→ ' + edge.to + ' : ' + EDGE_LABELS[edge.type] +
      ' (强度=' + Math.round(edge.intensity) + ')')
  }
  lines.push('│')
  lines.push('│ ❌ 禁止 NPC 之间独立剧情线')
  lines.push('│ ❌ 禁止 NPC 脱离玩家形成副故事')
  lines.push('└──────────────────────────────────────────')
  return lines.join('\n')
}

const EDGE_LABELS = {
  competition: '竞争 — 争夺玩家注意力',
  jealousy: '嫉妒 — 羡慕对方与玩家的关系',
  avoidance: '回避 — 刻意远离对方',
  dependence: '依赖 — 需要对方认可',
}

function buildEmotionDesireSummary(compiledList) {
  const lines = ['┌─ 情绪曲线 + 欲望梯度 ──────────────────────']
  for (const cc of compiledList) {
    const curve = $.emotionCurves.get(cc.name) || {}
    const desire = $.desireGradients.get(cc.name) ?? 0
    lines.push('│ ' + cc.name + ': 张力=' + Math.round(curve.tension || 50) +
      ' | 好奇=' + Math.round(curve.curiosity || 30) +
      ' | 控制=' + Math.round(curve.control || 60) +
      ' | 依赖=' + Math.round(curve.dependence || 30) +
      ' | 欲望=' + desire + ' (' + (DESIRE_LABELS[desire] || '?') + ')')
  }
  lines.push('│ ⚠️ 情绪变化必须连续 (Δ≤25/turn) | 欲望变化必须平滑 (Δ≤1/turn)')
  lines.push('└──────────────────────────────────────────')
  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// Post-Generation Validation v3
// ═══════════════════════════════════════════════════════════

/**
 * Run CEK v3 post-generation validation.
 *
 * @param {string} output
 * @param {object} ctx
 * @returns {{ passed: boolean, violations: string[] }}
 */
export function runCEKv3PostValidation(output, ctx = {}) {
  if (!output) return { passed: true, violations: [] }
  const violations = []
  const { playerName, storyCanon, character } = ctx

  // ── v3: forbid zero-tension dialogue ──
  const tensionless = checkZeroTensionDialogue(output)
  violations.push(...tensionless)

  // ── v3: player anchoring ──
  if (playerName && playerName !== '玩家') {
    const hasPlayer = new RegExp(playerName).test(output) ||
      /看向你|看着你|望向你|盯着你|在你[身旁面]|靠近你|你对/.test(output)
    if (!hasPlayer) {
      violations.push('CEKv3 Anchoring: 输出无玩家(' + playerName + ')存在感引用')
    }
  }

  // ── v3: phase firewall ──
  const phaseViolations = checkPhaseFirewall(output, ctx)
  violations.push(...phaseViolations)

  // ── v3: memory firewall ──
  if (storyCanon) {
    const memViolations = checkMemoryFirewall(output, storyCanon)
    violations.push(...memViolations)
  }

  // ── v3: identity firewall ──
  if (playerName && playerName !== '玩家') {
    if (/\b玩家\b/.test(output) && !output.includes('【玩家')) {
      violations.push('CEKv3 Identity: 默认名"玩家"泄露（应为"' + playerName + '"）')
    }
  }

  return { passed: violations.length === 0, violations }
}

function checkZeroTensionDialogue(output) {
  const violations = []
  // Detect purely functional/greeting exchanges
  const zeroTensionPatterns = [
    { regex: /^(?:嗯|哦|好|行|可以|知道了|明白了)[。.]?\s*$/m, desc: '无信息对话' },
    { regex: /今天天气|吃了吗|最近怎么样|好久不见/, desc: '寒暄（无张力）' },
  ]
  for (const pat of zeroTensionPatterns) {
    if (pat.regex.test(output)) {
      violations.push('CEKv3 Firewall: 检测到"无张力对话" — ' + pat.desc + '。每句话必须有情绪/权力/信息变化。')
    }
  }
  return violations
}

function checkPhaseFirewall(output, ctx) {
  const violations = []
  const rcList = ctx.character?.romanceCharacters || []
  for (const rc of rcList) {
    const aff = ctx.affectionMap?.[rc.name] ?? rc.affectionInitial ?? 50
    const phase = computePhase(aff)
    if (phase === 1 && _contextIsAbout(output, rc.name)) {
      if (/温柔|心疼|舍不得|真心.*在乎/.test(output)) {
        violations.push('CEKv3 Phase Firewall [' + rc.name + ']: Phase 1 禁止温柔/依恋表达')
      }
    }
  }
  return violations
}

function checkMemoryFirewall(output, storyCanon) {
  const violations = []
  const timeline = storyCanon?.timeline || []
  const fabMatch = output.match(/(?:上次|昨天|之前|那天)[你我他].{2,15}(?:的(?:时候|事)|发生)/)
  if (fabMatch) {
    const hasMatch = timeline.some(e => {
      const desc = (e.event || '').toLowerCase()
      return desc.includes(fabMatch[0].slice(0, 4))
    })
    if (!hasMatch) {
      violations.push('CEKv3 Memory Firewall: 疑似编造未发生事件')
    }
  }
  return violations
}

// ═══════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════

export function resetCEKv3() {
  $.turnCount = 0
  $.accounts.clear()
  $.globalTension = 30
  $.desireGradients.clear()
  $.prevDesire.clear()
  $.emotionCurves.clear()
  $.prevEmotion.clear()
  $.explosionCooldown = 0
  $.rivalryEdges = null
  $.attentionSplit = null
  $.playerPosition = null
}

export function getEconomyState() {
  const result = { tension: $.globalTension, explosionCooldown: $.explosionCooldown, accounts: {}, desireGradients: {} }
  for (const [name, acct] of $.accounts) result.accounts[name] = { ...acct }
  for (const [name, level] of $.desireGradients) result.desireGradients[name] = level
  return result
}

export function getAttentionSplit() { return $.attentionSplit }
export function getRivalryGraph() { return $.rivalryEdges }
export function getPlayerPosition() { return $.playerPosition }

// ═══════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════

function computePhase(affection) {
  const v = clamp(affection, 0, 100)
  if (v <= PHASE_1_MAX) return 1
  if (v <= PHASE_2_MAX) return 2
  if (v <= PHASE_3_MAX) return 3
  return 4
}

function computeActions(phase, profile) {
  if (phase === 1) {
    const base = ['observe', 'test', 'ignore', 'withdraw']
    if (profile === AGGRESSION_PROFILES.PURSUER) base.push('seduce')
    if (profile === AGGRESSION_PROFILES.CONFRONTATIONAL) base.push('provoke', 'reject')
    return base
  }
  if (phase === 2) {
    const base = ['observe', 'seduce', 'test', 'withdraw', 'reject']
    if (profile === AGGRESSION_PROFILES.CONFRONTATIONAL) base.push('provoke', 'escalate')
    return base
  }
  if (phase === 3) return ['observe', 'seduce', 'escalate', 'test', 'provoke', 'reject', 'withdraw', 'submit']
  return [...BEHAVIOR_ACTIONS]
}

function computeForbidden(phase) {
  return phase === 1 ? ['emotional_dependency', 'real_attachment', 'vulnerability', 'possessiveness', 'self_exposure', 'future_leak']
    : phase <= 2 ? ['genuine_care', 'full_commitment', 'jealousy_expression']
    : phase <= 3 ? ['full_collapse', 'complete_dependency'] : []
}

function clamp(v, min, max) {
  if (v == null || isNaN(v)) return min
  return Math.min(max, Math.max(min, Math.round(v)))
}

function _contextIsAbout(text, name) { return text && name && text.includes(name) }
