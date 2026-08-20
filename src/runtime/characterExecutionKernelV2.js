/**
 * ⚙️ Character Execution Kernel v2 (Industrial CEK)
 *
 * "CEK v2 不是让角色更真实——而是让角色在任何情况下都不能离开可控的人格轨道"
 *
 * v1 → v2 upgrade:
 *   v1: constraint layer only (CSM + BPM + MAE + EV)
 *   v2: compile + execute + firewall + stabilize + anti-OOC + emotion curve +
 *       player anchoring + desire gradient + multi-narrator conflict resolver
 *
 * Nine sub-modules:
 *   ① State Compiler          — unstructured settings → CompiledCharacter
 *   ② Behavior Virtual Machine — characters execute ACT[] instructions, not free writing
 *   ③ Constraint Firewall      — 3-layer: Phase / Memory / Identity
 *   ④ Narrative Stabilizer     — temporal/behavioral/emotional continuity + bridging
 *   ⑤ Anti-OOC Runtime Monitor — real-time personality drift detection + rollback
 *   ⑥ Emotion Curve Engine     — continuous emotion tracking (tension/curiosity/control/dependence)
 *   ⑦ Player Anchoring System  — every output MUST reference player presence
 *   ⑧ Desire Gradient Engine   — desire as 0-5 gradient, must rise/fall smoothly
 *   ⑨ Multi-Narrator Conflict  — all character conflicts must orbit the player
 *
 * Architecture:
 *   INPUT → State Compiler → BVM → Emotion Curve Check → Constraint Firewall
 *         → Narrative Stabilizer → Anti-OOC Monitor → Player Anchoring
 *         → PFPL Check → OUTPUT
 */

import { detectAggressionProfile, AGGRESSION_PROFILES } from './aggressionProfile'
import { getCurrentAffectionStage } from '../utils/deepseek'

// ═══════════════════════════════════════════════════════════
// 0. Constants + Internal State
// ═══════════════════════════════════════════════════════════

/** Phase → role mode */
const ROLE_MODES = { 1: 'hunter', 2: 'performer', 3: 'breaking', 4: 'collapsed' }

/** Phase boundaries */
const PHASE_1_MAX = 25, PHASE_2_MAX = 50, PHASE_3_MAX = 75

/** Behavior instruction set */
const BEHAVIOR_ACTIONS = ['observe', 'seduce', 'reject', 'escalate', 'withdraw', 'test', 'provoke', 'ignore', 'submit', 'expose']

/** Desire gradient levels */
const DESIRE_LEVELS = {
  0: 'cold',        // 冷 — no interest whatsoever
  1: 'notice',      // 注意 — aware of player's presence differently
  2: 'curious',     // 好奇 — wants to know more, tests boundaries
  3: 'attracted',   // 吸引 — pulled toward player, fights or leans in
  4: 'suppressed',  // 压抑 — actively fighting desire, tension at peak
  5: 'erupted',     // 爆发 — can no longer suppress, acts on desire
}

/** Internal state — persists across turns within a session */
const _state = {
  /** @type {Map<string, CompiledCharacter>} */
  compiledCharacters: new Map(),

  /** @type {Map<string, number>} — per-character desire level (0-5) */
  desireGradients: new Map(),

  /** @type {Map<string, EmotionCurveSnapshot>} — per-character emotion curve */
  emotionCurves: new Map(),

  /** @type {Map<string, number>} — per-character previous desire for gradient checking */
  previousDesires: new Map(),

  /** @type {Map<string, EmotionCurveSnapshot>} — per-character previous emotion for delta check */
  previousEmotions: new Map(),

  /** @type {number} — turn counter */
  turnCount: 0,

  /** @type {object|null} — last CEK context for post-gen validation */
  lastContext: null,
}

// ═══════════════════════════════════════════════════════════
// ① State Compiler
// ═══════════════════════════════════════════════════════════

/**
 * CompiledCharacter — the executable runtime representation of a character.
 *
 * @typedef {object} CompiledCharacter
 * @property {string} name
 * @property {number} phase — 1-4
 * @property {string} roleMode — hunter|performer|breaking|collapsed
 * @property {string} profile — pursuer|confrontational|aloof|gentle
 * @property {number} affection
 * @property {string} stageName
 * @property {string[]} forbiddenStates
 * @property {string[]} allowedActions — BVM behavior instruction set
 * @property {object} escalationRules
 * @property {object} intentProfile
 */

/**
 * Compile a romance character from unstructured settings + USK state
 * into a structured, executable CompiledCharacter.
 *
 * @param {object} rc — romance character descriptor
 * @param {number} affection — current affection
 * @param {object} uskCharState — USK characters[name] state
 * @returns {CompiledCharacter}
 */
function compileCharacter(rc, affection, uskCharState) {
  const phase = computePhase(affection)
  const profile = detectAggressionProfile({
    personality: rc.personality || '',
    background: rc.background || '',
  })
  const stage = rc.affectionEnabled !== false ? getCurrentAffectionStage(rc, affection) : null

  return {
    name: rc.name,
    phase,
    roleMode: computeRoleMode(phase, profile),
    profile,
    affection,
    stageName: stage?.name || '未知',

    // States the character MUST NOT enter at current phase
    forbiddenStates: computeForbiddenStates(phase, profile),

    // BVM: behavior instructions allowed at current phase
    allowedActions: computeAllowedActions(phase, profile),

    // Phase transition rules
    escalationRules: computeEscalationRules(phase, profile, affection),

    // Intent profile: what the character WANTS right now
    intentProfile: computeIntentProfile(phase, profile, affection, rc),
  }
}

function computePhase(affection) {
  const v = clamp(affection, 0, 100)
  if (v <= PHASE_1_MAX) return 1
  if (v <= PHASE_2_MAX) return 2
  if (v <= PHASE_3_MAX) return 3
  return 4
}

function computeRoleMode(phase, profile) {
  if (profile === AGGRESSION_PROFILES.PURSUER && phase <= 2) return 'hunter'
  return ROLE_MODES[phase] || 'hunter'
}

function computeForbiddenStates(phase, profile) {
  const states = []
  if (phase === 1) {
    states.push('emotional_dependency', 'real_attachment', 'vulnerability_display',
      'possessiveness', 'self_exposure', 'future_personality_leak')
  }
  if (phase <= 2) {
    states.push('genuine_care', 'full_commitment', 'jealousy_expression')
    if (profile !== AGGRESSION_PROFILES.PURSUER) states.push('sexual_initiative')
  }
  if (phase <= 3) {
    states.push('full_collapse', 'complete_dependency', 'identity_loss')
  }
  return states
}

function computeAllowedActions(phase, profile) {
  // Phase 1: strategy-only actions
  if (phase === 1) {
    const base = ['observe', 'test', 'ignore', 'withdraw']
    if (profile === AGGRESSION_PROFILES.PURSUER) base.push('seduce')  // tactical seduction
    if (profile === AGGRESSION_PROFILES.CONFRONTATIONAL) base.push('provoke', 'reject')
    return base
  }
  // Phase 2: performance + temptation
  if (phase === 2) {
    const base = ['observe', 'seduce', 'test', 'withdraw', 'reject']
    if (profile === AGGRESSION_PROFILES.CONFRONTATIONAL) base.push('provoke', 'escalate')
    if (profile !== AGGRESSION_PROFILES.ALOOF) base.push('submit')  // reluctant yielding
    return base
  }
  // Phase 3: emotional leakage
  if (phase === 3) {
    const base = ['observe', 'seduce', 'escalate', 'test', 'provoke', 'reject', 'withdraw', 'submit']
    return base
  }
  // Phase 4: all actions available
  return [...BEHAVIOR_ACTIONS]
}

function computeEscalationRules(phase, profile, affection) {
  return {
    canEscalateTo: phase < 4 ? phase + 1 : 4,
    requiresTrigger: phase <= 2,  // early phases need story trigger to advance
    escalationSpeed: profile === AGGRESSION_PROFILES.PURSUER ? 'fast' :
                     profile === AGGRESSION_PROFILES.ALOOF ? 'slow' : 'normal',
    affectionThreshold: (phase + 1) * 25,  // affection needed to reach next phase
  }
}

function computeIntentProfile(phase, profile, affection, rc) {
  return {
    primaryDrive: phase === 1 ? 'control' :
                  phase === 2 ? 'attraction_test' :
                  phase === 3 ? 'possession' : 'surrender',
    emotionalTemperature: phase === 1 ? 'cold' :
                          phase === 2 ? 'cool' :
                          phase === 3 ? 'volatile' : 'raw',
    distanceFromPlayer: phase === 1 ? 'far' :
                        phase === 2 ? 'closer_than_appears' :
                        phase === 3 ? 'unstable_orbit' : 'collapsed_boundary',
    strategyActive: phase <= 2,
    genuineEmotionAllowed: phase >= 3,
  }
}

// ═══════════════════════════════════════════════════════════
// ② Behavior Virtual Machine (BVM)
// ═══════════════════════════════════════════════════════════

/**
 * Build the BVM instruction block for prompt injection.
 * Characters execute ACT[] instructions — not free-form writing.
 *
 * @param {CompiledCharacter[]} compiledList
 * @returns {string} BVM prompt block
 */
function buildBVMBlock(compiledList) {
  const lines = ['┌─ ② 行为虚拟机 (BVM) ──────────────────────']
  lines.push('│ 你不是在"写角色"。你在执行行为指令。')
  lines.push('│')
  lines.push('│ 每个行为必须来自下方的 allowedActions 列表。')
  lines.push('│ 不在列表中的行为 → 禁止执行。')
  lines.push('│')

  for (const cc of compiledList) {
    lines.push('│ ' + cc.name + ' (Phase ' + cc.phase + ' | ' + cc.roleMode + '):')
    lines.push('│   允许的ACT指令: ' + cc.allowedActions.map(a => 'ACT[' + a + ']').join(' '))
    lines.push('│   禁止的状态: ' + cc.forbiddenStates.join(' | '))
    lines.push('│   主驱动: ' + cc.intentProfile.primaryDrive +
      ' | 情绪温度: ' + cc.intentProfile.emotionalTemperature +
      ' | 策略活跃: ' + (cc.intentProfile.strategyActive ? '是' : '否'))
    lines.push('│')
  }

  lines.push('│ 行为执行格式：')
  lines.push('│   每个叙事段落必须实现至少一个 ACT 指令。')
  lines.push('│   ACT[observe]  = 冷眼观察、评估、不动声色')
  lines.push('│   ACT[seduce]   = 诱惑、暗示、身体信号（策略性，非真心）')
  lines.push('│   ACT[reject]   = 拒绝、推开、冷淡回应')
  lines.push('│   ACT[escalate] = 升级冲突、逼近、施压')
  lines.push('│   ACT[withdraw] = 抽离、后退、沉默、制造距离')
  lines.push('│   ACT[test]     = 试探底线、考验反应')
  lines.push('│   ACT[provoke]  = 挑衅、激怒、故意刺激')
  lines.push('│   ACT[ignore]   = 无视、冷处理、当空气')
  lines.push('│   ACT[submit]   = 屈服、让步（但不出于真心——除非 Phase 4）')
  lines.push('│   ACT[expose]   = 暴露真实自我（仅 Phase 4 允许）')
  lines.push('│')
  lines.push('│ ❗ 取最高约束：BVM 指令 > 角色设定 > "我觉得角色会"')
  lines.push('└──────────────────────────────────────────')

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// ③ Constraint Firewall (3-layer)
// ═══════════════════════════════════════════════════════════

/**
 * Build the 3-layer constraint firewall prompt block.
 *
 * Layer 1: Phase Firewall — behavioral boundaries per phase
 * Layer 2: Memory Firewall — no fabricated events, no player modification
 * Layer 3: Identity Firewall — no name drift, no identity rewrite
 *
 * @param {CompiledCharacter[]} compiledList
 * @param {string} playerName
 * @returns {string}
 */
function buildFirewallBlock(compiledList, playerName) {
  const lines = ['┌─ ③ 约束防火墙 (Constraint Firewall) ──────']

  // ── Layer 1: Phase Firewall ──
  lines.push('│')
  lines.push('│ ▸ L1: Phase Firewall (人格阶段防火墙)')
  for (const cc of compiledList) {
    if (cc.phase === 1) {
      lines.push('│   ' + cc.name + ' [Phase 1 · 猎手]:')
      lines.push('│     ❌ 禁止: 情感依赖 · 嫉妒 · 崩溃行为 · 温柔 · 脆弱 · 依赖')
      lines.push('│     ✅ 仅允许: 策略诱导 · 冷处理 · 价值计算 · 等价交换')
    } else if (cc.phase === 2) {
      lines.push('│   ' + cc.name + ' [Phase 2 · 表演者]:')
      lines.push('│     ❌ 禁止: 真实依恋 · 情感承诺 · 占有欲表达 · 真心暴露')
      lines.push('│     ✅ 仅允许: 暗示诱惑 · 被动接受 · 轻微身体信号 · 表演性亲近')
    } else if (cc.phase === 3) {
      lines.push('│   ' + cc.name + ' [Phase 3 · 失控边缘]:')
      lines.push('│     ❌ 禁止: 完全崩溃 · Phase 4 人格泄露')
      lines.push('│     ✅ 仅允许: 试探依赖 · 情绪波动 · 控制欲反转 · 不稳定表达')
    } else {
      lines.push('│   ' + cc.name + ' [Phase 4 · 崩坏]:')
      lines.push('│     ✅ 允许: 依赖 · 崩溃 · 真实暴露 · 不稳定表达')
      lines.push('│     ⚠️  但人格基底不可变 — ' + cc.profile + ' 不会变成其他类型')
    }
  }

  // ── Layer 2: Memory Firewall ──
  lines.push('│')
  lines.push('│ ▸ L2: Memory Firewall (记忆防火墙)')
  lines.push('│   ❌ 禁止编造未发生事件 — 不能说"上次""之前""那天"除非对话历史中有')
  lines.push('│   ❌ 禁止修改玩家行为 — 玩家没说的话不能说"你说过…"')
  lines.push('│   ❌ 禁止未来记忆前置 — 不能"回忆"还没发生的剧情')
  lines.push('│   ❌ 禁止创造不存在NPC — 不能引入设定中没有的人物')
  lines.push('│   强制: [OBSERVED] 必须在对话历史/世界快照中有依据')

  // ── Layer 3: Identity Firewall ──
  lines.push('│')
  lines.push('│ ▸ L3: Identity Firewall (身份防火墙)')
  lines.push('│   ❌ 禁止角色名称漂移 — 不能用错名字、编造昵称')
  lines.push('│   ❌ 禁止玩家称呼错误 — 玩家 = 「' + (playerName || '玩家') + '」，必须用此名或设定昵称')
  lines.push('│   ❌ 禁止人设身份重写 — 角色的背景、人格、说话方式不可被剧情"改变"')
  lines.push('│   ⚠️  角色可以"表演"不同人格 → 但不能"变成"不同人格')

  lines.push('└──────────────────────────────────────────')
  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// ④ Narrative Stabilizer
// ═══════════════════════════════════════════════════════════

/**
 * Build the narrative stabilizer prompt block.
 * Forces temporal + behavioral + emotional continuity.
 *
 * @returns {string}
 */
function buildStabilizerBlock() {
  return `┌─ ④ 叙事稳定器 (Narrative Stabilizer) ──────
│
│ 强制三一致原则:
│
│ ▸ 1. 时间连续
│   上一轮的场景/动作/身体位置 → 本轮必须继承
│   不能出现: 上一轮在解扣子 → 本轮在整理衣服（中间缺了过渡）
│   ✅ 必须加桥接句: "他的动作顿了一下，指尖从扣子上移开…"
│
│ ▸ 2. 行为连续
│   角色的行为意图不能突变
│   不能出现: 上一轮冷脸 → 本轮突然温柔（没有触发事件）
│   ✅ 行为变化需要: 触发事件 → 内在反应 → 外在行为
│
│ ▸ 3. 情绪连续
│   情绪变化必须渐进、可解释、不跳跃
│   不能出现: 愤怒 → 突然平静（没有过渡）
│   ✅ 情绪变化需要: 外部刺激 → 内部加工 → 情绪表达（可能扭曲）
│
│ 如果检测到断裂 → 自动插入桥接句
│ 如果无法桥接 → 用"沉默"或"停顿"作为最小过渡
│
│ 示例修复:
│   ❌ 断裂: "他站起身，走向门口。"（上一轮明明还压着你）
│   ✅ 桥接: "他的身体还压着你，呼吸打到你的皮肤上。过了很久，他才慢慢直起身——不是因为想走，是因为再压下去他会失控。"
│
└──────────────────────────────────────────`
}

// ═══════════════════════════════════════════════════════════
// ⑤ Anti-OOC Runtime Monitor
// ═══════════════════════════════════════════════════════════

/**
 * Build the Anti-OOC monitor prompt block.
 * Real-time personality drift detection rules for the LLM.
 *
 * @param {CompiledCharacter[]} compiledList
 * @returns {string}
 */
function buildAntiOOCBlock(compiledList) {
  const lines = ['┌─ ⑤ 反崩坏运行时监控 (Anti-OOC Monitor) ──']

  lines.push('│')
  lines.push('│ 在输出每个句子之前，自检：')
  lines.push('│')

  for (const cc of compiledList) {
    lines.push('│ ' + cc.name + ' 崩坏检测:')
    lines.push('│   ① 人格提前泄露? → 当前 Phase=' + cc.phase + '，禁止 Phase ' + (cc.phase + 1) + '+ 行为')
    lines.push('│   ② 情绪越界? → 允许: ' + cc.intentProfile.emotionalTemperature +
      ' | 策略活跃: ' + (cc.intentProfile.strategyActive ? '是（即使温柔也是策略）' : '否'))
    lines.push('│   ③ 行为越权? → 仅允许: ' + cc.allowedActions.map(a => 'ACT[' + a + ']').join(' '))
    lines.push('│   ④ 剧情漂移? → NPC不能脱离玩家自主展开副剧情线')
    lines.push('│')
  }

  lines.push('│ 崩坏三类 → 立即自我修正：')
  lines.push('│   Type A: 人格提前泄露 → 撤回，改为策略性表达')
  lines.push('│   Type B: 情绪越界 → 撤回，改为当前 Phase 允许的情绪温度')
  lines.push('│   Type C: 剧情漂移 → 撤回，将焦点拉回玩家')
  lines.push('└──────────────────────────────────────────')

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// ⑥ Emotion Curve Engine
// ═══════════════════════════════════════════════════════════

/**
 * Compute the emotion curve for a compiled character.
 * Emotion must change continuously — no jumps.
 *
 * @param {CompiledCharacter} cc
 * @param {object} uskCharState — USK character state
 * @returns {{ tension: number, curiosity: number, control: number, dependence: number }}
 */
function computeEmotionCurve(cc, uskCharState) {
  const rel = uskCharState?.relationship || {}
  const emo = uskCharState?.emotion || {}
  const ten = uskCharState?.tension || {}

  const raw = {
    tension: clamp(
      (ten.emotional_pressure || 20) * 0.4 +
      (ten.attraction_tension || 40) * 0.3 +
      (emo.anger || 5) * 0.2 +
      (ten.unresolved_conflicts || 0) * 0.1, 0, 100),

    curiosity: clamp(
      (emo.curiosity || 30) * 0.5 +
      (100 - (rel.affection || 50)) * 0.3 +  // lower affection → higher curiosity
      (cc.phase < 3 ? 20 : 0), 0, 100),      // bonus in early phases

    control: clamp(
      (100 - (rel.dependency || 30)) * 0.4 +
      (100 - (emo.anxiety || 10)) * 0.2 +
      (ten.power_imbalance || 50) * 0.2 +
      (cc.phase <= 2 ? 30 : cc.phase === 3 ? 10 : -10),  // phase bonus/penalty
      0, 100),

    dependence: clamp(
      (rel.dependency || 30) * 0.5 +
      (rel.affection || 50) * 0.3 +
      (cc.phase >= 3 ? 20 : 0),  // phase bonus
      0, 100),
  }

  // Apply smooth gradient: clamp delta vs previous
  const prev = _state.emotionCurves.get(cc.name)
  if (prev) {
    const MAX_DELTA = 25  // max change per turn in any dimension
    for (const key of ['tension', 'curiosity', 'control', 'dependence']) {
      const delta = raw[key] - (prev[key] || raw[key])
      if (Math.abs(delta) > MAX_DELTA) {
        raw[key] = prev[key] + Math.sign(delta) * MAX_DELTA
      }
    }
  }

  // Store
  _state.previousEmotions.set(cc.name, _state.emotionCurves.get(cc.name) || raw)
  _state.emotionCurves.set(cc.name, raw)

  return raw
}

/**
 * Build the emotion curve prompt block.
 *
 * @param {CompiledCharacter[]} compiledList
 * @returns {string}
 */
function buildEmotionCurveBlock(compiledList) {
  const lines = ['┌─ ⑥ 情绪曲线引擎 (Emotion Curve) ──────────']
  lines.push('│ 每个角色有 4 维情绪状态，必须连续变化，禁止跳跃。')
  lines.push('│')

  for (const cc of compiledList) {
    const curve = _state.emotionCurves.get(cc.name) || { tension: 50, curiosity: 30, control: 60, dependence: 30 }
    const prev = _state.previousEmotions.get(cc.name)
    lines.push('│ ' + cc.name + ':')
    lines.push('│   张力=' + Math.round(curve.tension) +
      ' | 好奇=' + Math.round(curve.curiosity) +
      ' | 控制=' + Math.round(curve.control) +
      ' | 依赖=' + Math.round(curve.dependence))
    if (prev) {
      const deltas = {
        tension: Math.round(curve.tension - prev.tension),
        curiosity: Math.round(curve.curiosity - prev.curiosity),
        control: Math.round(curve.control - prev.control),
        dependence: Math.round(curve.dependence - prev.dependence),
      }
      lines.push('│   Δ: 张力' + showDelta(deltas.tension) +
        ' 好奇' + showDelta(deltas.curiosity) +
        ' 控制' + showDelta(deltas.control) +
        ' 依赖' + showDelta(deltas.dependence))
    }
    lines.push('│   规则: 情绪变化必须可解释 — 有外部刺激才有情绪响应')
  }

  lines.push('└──────────────────────────────────────────')
  return lines.join('\n')
}

function showDelta(d) {
  return d >= 0 ? '+' + d : '' + d
}

// ═══════════════════════════════════════════════════════════
// ⑦ Player Anchoring System
// ═══════════════════════════════════════════════════════════

/**
 * Build the player anchoring prompt block.
 * Every output MUST reference the player's presence.
 *
 * @param {string} playerName
 * @returns {string}
 */
function buildAnchoringBlock(playerName) {
  return `┌─ ⑦ 玩家锚定系统 (Player Anchoring) ───────
│
│ 强制规则: 每一轮输出必须包含对玩家存在的引用。
│
│ 玩家 = 「${playerName || '玩家'}」
│
│ 锚定方式（至少用一种）:
│   · 目光锚定: "他看向你"、"他的视线落在你身上"
│   · 身体锚定: "他的手还按在你肩上"、"他离你更近了"
│   · 语言锚定: 直接对你说话
│   · 反应锚定: 角色因为你的某个反应而改变行为
│   · 空间锚定: 保持物理位置关系——"他站在你面前"
│
│ ❌ 禁止:
│   · 两个NPC长时间互聊（玩家变成背景）
│   · 角色连续三轮不提及/不看向/不回应玩家
│   · 玩家被"遗忘"在场景中
│   · NPC之间展开脱离玩家的独立剧情线
│
│ ⚠️  如果输出中没有玩家引用 → 强制插入至少一个锚定点
└──────────────────────────────────────────`
}

// ═══════════════════════════════════════════════════════════
// ⑧ Desire Gradient Engine
// ═══════════════════════════════════════════════════════════

/**
 * Compute the desire gradient for a compiled character.
 * Desire is a 0-5 gradient that must rise/fall smoothly — no jumps.
 *
 * @param {CompiledCharacter} cc
 * @param {object} uskCharState
 * @returns {number} desire level 0-5
 */
function computeDesireGradient(cc, uskCharState) {
  const rel = uskCharState?.relationship || {}
  const ten = uskCharState?.tension || {}
  const emo = uskCharState?.emotion || {}

  // Raw desire score 0-100 from USK
  const rawScore = clamp(
    ten.attraction_tension * 0.4 +      // strongest driver
    (cc.phase >= 2 ? 30 : 0) +          // phase 2+ = desire possible
    (rel.affection * 0.15) +             // affection contributes lightly
    (emo.excitement * 0.1) -             // excitement amplifies
    (cc.phase === 1 ? 50 : 0) -          // Phase 1 heavily suppresses
    (cc.profile === AGGRESSION_PROFILES.ALOOF ? 15 : 0),  // aloof suppresses
    0, 100)

  // Map 0-100 → 0-5
  let level
  if (rawScore < 10) level = 0
  else if (rawScore < 30) level = 1
  else if (rawScore < 50) level = 2
  else if (rawScore < 70) level = 3
  else if (rawScore < 90) level = 4
  else level = 5

  // Smooth: clamp delta vs previous (max ±1 per turn)
  const prev = _state.desireGradients.get(cc.name)
  if (prev != null) {
    const delta = level - prev
    if (Math.abs(delta) > 1) {
      level = prev + Math.sign(delta) * 1
    }
  }

  // Store
  _state.previousDesires.set(cc.name, _state.desireGradients.get(cc.name) ?? level)
  _state.desireGradients.set(cc.name, level)

  return level
}

/**
 * Build the desire gradient prompt block.
 *
 * @param {CompiledCharacter[]} compiledList
 * @returns {string}
 */
function buildDesireGradientBlock(compiledList) {
  const lines = ['┌─ ⑧ 欲望梯度引擎 (Desire Gradient) ────────']
  lines.push('│ 欲望不是开关，是梯度。必须缓慢上升或下降——禁止跳变。')
  lines.push('│')

  for (const cc of compiledList) {
    const level = _state.desireGradients.get(cc.name) ?? 0
    const prev = _state.previousDesires.get(cc.name)
    const label = DESIRE_LEVELS[level] || '未知'

    lines.push('│ ' + cc.name + ': 欲望梯度 = ' + level + ' (' + label + ')' +
      (prev != null ? ' [Δ' + (level - prev >= 0 ? '+' : '') + (level - prev) + ']' : ''))

    // Behavioral directive per level
    switch (level) {
      case 0:
        lines.push('│   → 完全不表现任何性/欲望信号。身体距离保持。')
        break
      case 1:
        lines.push('│   → 注意力更多落在玩家身上——但不是欲望，是评估。')
        break
      case 2:
        lines.push('│   → 开始有"无意"的身体接触试探。话语中开始有暗示。')
        break
      case 3:
        lines.push('│   → 明确的被吸引——可能用推开/冷淡来掩饰，但身体语言出卖。')
        break
      case 4:
        lines.push('│   → 欲望压抑到临界点——呼吸变化、身体紧绷、话语断裂。')
        break
      case 5:
        lines.push('│   → 不再压抑——直接行动。身体先行，语言后到（或不到）。')
        break
    }
  }

  lines.push('│')
  lines.push('│ ⚠️  欲望梯度变化限制: 每轮最多 ±1 级。禁止从 0 跳到 4。')
  lines.push('│ ⚠️  欲望 ≠ 恋爱。欲望可以和好感完全反向（pursuer 低好感高欲望）。')
  lines.push('└──────────────────────────────────────────')

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// ⑨ Multi-Narrator Conflict Resolver
// ═══════════════════════════════════════════════════════════

/**
 * Build the multi-narrator conflict resolver prompt block.
 * All character conflicts MUST orbit the player.
 *
 * @param {CompiledCharacter[]} compiledList
 * @param {string} playerName
 * @returns {string}
 */
function buildConflictResolverBlock(compiledList, playerName) {
  if (compiledList.length < 2) return ''

  return `┌─ ⑨ 修罗场稳定器 (Multi-Narrator Conflict) ──
│
│ 多个角色可以冲突——但必须围绕同一对象: 玩家（${playerName || '玩家'}）
│
│ 允许的冲突类型:
│   · 争夺注意 — 两个角色都想让玩家看自己
│   · 试探归属 — "你和她是什么关系？"
│   · 情绪对抗 — 一个靠近玩家，另一个用情绪反应制造压力
│   · 资源竞争 — 争夺玩家的时间、注意力、物理空间
│
│ ❌ 禁止:
│   · NPC之间展开独立于玩家的剧情线
│   · NPC之间进行与玩家无关的长对话
│   · NPC脱离玩家形成副故事或"CP"
│   · 两个NPC互相关注超过对玩家的关注
│
│ ✅ 强制:
│   · 所有冲突的"奖品"是玩家
│   · 所有对抗的"观众"是玩家
│   · 所有关系的"锚点"是玩家
│
│ 冲突结构模板:
│   角色A对玩家做X → 角色B看到/感知到 → 角色B产生反应 → 反应指向玩家或影响玩家
│
└──────────────────────────────────────────`
}

// ═══════════════════════════════════════════════════════════
// Master Pipeline
// ═══════════════════════════════════════════════════════════

/**
 * Build the complete CEK v2 prompt block.
 * This is the main entry point for pre-generation prompt injection.
 *
 * @param {object} character — full LLM character descriptor
 * @param {object} uskState — current USK state
 * @param {object} affectionMap — { [charName]: currentAffectionValue }
 * @returns {string} full CEK v2 prompt block
 */
export function buildCEKv2Block(character, uskState, affectionMap = {}) {
  if (!character) return ''

  const rcList = character.romanceCharacters || []
  if (rcList.length === 0) return ''

  const playerName = character._playerProfile?.name || '玩家'

  // ── Advance turn counter ──
  _state.turnCount++

  // ── ① State Compiler: compile all characters ──
  const compiledList = []
  for (const rc of rcList) {
    const aff = affectionMap[rc.name] ?? rc.affectionInitial ?? 50
    const uskChar = uskState?.characters?.[rc.name] || null
    const compiled = compileCharacter(rc, aff, uskChar)
    compiledList.push(compiled)
    _state.compiledCharacters.set(rc.name, compiled)

    // ── ⑥ Emotion Curve: compute per character ──
    computeEmotionCurve(compiled, uskChar || {})

    // ── ⑧ Desire Gradient: compute per character ──
    computeDesireGradient(compiled, uskChar || {})
  }

  // Store context for post-validation
  _state.lastContext = { character, affectionMap, playerName, compiledList }

  // ── Assemble all blocks ──
  const sections = []
  sections.push('━━━ ⚙️ CEK v2 · 角色执行内核 ━━━')
  sections.push('你不是在写角色。你在执行一个状态机实例。')
  sections.push('以下九层约束决定你的全部输出空间。')
  sections.push('')

  // ① State Compiler summary
  sections.push(buildCompilerSummary(compiledList))

  // ② BVM
  sections.push(buildBVMBlock(compiledList))

  // ③ Constraint Firewall
  sections.push(buildFirewallBlock(compiledList, playerName))

  // ④ Narrative Stabilizer
  sections.push(buildStabilizerBlock())

  // ⑤ Anti-OOC Monitor
  sections.push(buildAntiOOCBlock(compiledList))

  // ⑥ Emotion Curve
  sections.push(buildEmotionCurveBlock(compiledList))

  // ⑦ Player Anchoring
  sections.push(buildAnchoringBlock(playerName))

  // ⑧ Desire Gradient
  sections.push(buildDesireGradientBlock(compiledList))

  // ⑨ Multi-Narrator Conflict Resolver
  const conflictBlock = buildConflictResolverBlock(compiledList, playerName)
  if (conflictBlock) sections.push(conflictBlock)

  // ── Final enforcement ──
  sections.push(
    '━━━ ⚙️ CEK v2 执行铁律 ━━━\n' +
    '· 以上九层约束构成你的全部行为空间。任何一层说"不" → 就不能做。\n' +
    '· BVM 指令 > 角色设定 > "我觉得角色会这样做"\n' +
    '· Phase 决定你能做什么。Firewall 决定你不能做什么。Stabilizer 保证连续性。\n' +
    '· 欲望梯度和情绪曲线必须连续变化——每次最多 ±1 级/±25 分。\n' +
    '· 玩家必须存在于每一轮输出中——物理上或感知上。\n' +
    '· Anti-OOC Monitor 在输出每个句子前自检——崩坏则回滚。\n' +
    '· CEK v2 的目标不是让角色更"真实"——是让角色在任何情况下都不能离开可控的人格轨道。'
  )

  return sections.join('\n\n')
}

/**
 * Build a compact State Compiler summary for the prompt.
 */
function buildCompilerSummary(compiledList) {
  const lines = ['┌─ ① 状态编译器 (State Compiler) ────────────']
  lines.push('│ 已将角色设定编译为可执行状态机实例:')
  lines.push('│')
  for (const cc of compiledList) {
    lines.push('│ ' + cc.name + ' → Phase ' + cc.phase +
      ' | ' + cc.roleMode +
      ' | ' + cc.profile +
      ' | 主驱动=' + cc.intentProfile.primaryDrive +
      ' | 温度=' + cc.intentProfile.emotionalTemperature)
  }
  lines.push('│')
  lines.push('│ ❗ 不可跨 Phase 调用行为。Phase ' + compiledList[0]?.phase + ' 的角色不能做 Phase ' + (compiledList[0]?.phase + 1) + ' 的事。')
  lines.push('└──────────────────────────────────────────')
  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// Post-Generation Validation (v2)
// ═══════════════════════════════════════════════════════════

/**
 * Run CEK v2 post-generation validation chain.
 *
 * Checks (in order):
 *   1. Anti-OOC Monitor — personality drift detection
 *   2. Constraint Firewall — phase/memory/identity validation
 *   3. Narrative Stabilizer — continuity check
 *   4. Player Anchoring — player presence verification
 *   5. Desire Gradient — gradient jump detection (soft warning)
 *   6. Emotion Curve — curve jump detection (soft warning)
 *
 * @param {string} output — AI-generated reply
 * @param {object} context
 * @param {object} context.character — full LLM character descriptor
 * @param {object} context.affectionMap — { [charName]: currentAffection }
 * @param {string} context.playerName — canonical player name
 * @param {object} context.storyCanon — Story Canon (for memory firewall)
 * @returns {{ passed: boolean, violations: string[], stabilized: string|null }}
 */
export function runCEKv2PostValidation(output, context = {}) {
  const { character, affectionMap = {}, playerName, storyCanon } = context
  if (!output || !character) return { passed: true, violations: [], stabilized: null }

  const violations = []

  // ── Check 1: Anti-OOC — is behavior in allowedActions? ──
  const oocViolations = _checkOOC(output, affectionMap, character)
  violations.push(...oocViolations)

  // ── Check 2: Constraint Firewall ──
  const fwViolations = _checkFirewall(output, affectionMap, character, playerName, storyCanon)
  violations.push(...fwViolations)

  // ── Check 3: Player Anchoring — is player referenced? ──
  const anchorViolations = _checkAnchoring(output, playerName)
  violations.push(...anchorViolations)

  // ── Check 4: Desire Gradient — soft warning on jumps ──
  const desireViolations = _checkDesireGradient(output)
  // Soft warnings — don't fail, just log
  if (desireViolations.length > 0) {
    console.warn('[CEK v2] Desire gradient warning:', desireViolations.join(' | '))
  }

  // ── Check 5: Emotion Curve — soft warning on jumps ──
  const emotionViolations = _checkEmotionCurve(output)
  if (emotionViolations.length > 0) {
    console.warn('[CEK v2] Emotion curve warning:', emotionViolations.join(' | '))
  }

  return {
    passed: violations.length === 0,
    violations,
    stabilized: violations.length > 0 ? null : output,
  }
}

/**
 * Anti-OOC: check output against compiled character allowedActions.
 */
function _checkOOC(output, affectionMap, character) {
  const violations = []
  const rcList = character?.romanceCharacters || []

  for (const rc of rcList) {
    const cc = _state.compiledCharacters.get(rc.name)
    if (!cc) continue

    // Check for forbidden state keywords in output
    for (const fs of cc.forbiddenStates) {
      const patterns = FORBIDDEN_STATE_PATTERNS[fs]
      if (patterns && patterns.some(p => p.test(output))) {
        if (_contextIsAboutChar(output, rc.name)) {
          violations.push('CEKv2 OOC [' + rc.name + ']: 检测到禁止状态 ' + fs + ' — Phase ' + cc.phase + ' 不允许')
        }
      }
    }
  }

  return violations
}

/** Pattern map for forbidden state detection */
const FORBIDDEN_STATE_PATTERNS = {
  emotional_dependency: [/(?:离不开|不能没有|非你不|你是我的全)/],
  real_attachment: [/(?:真心|真正|真的)(?:在乎|在意|喜欢|爱)/],
  vulnerability_display: [/(?:求求你|我害怕|我[很真]怕|受不了了|撑不住)/],
  possessiveness: [/(?:你是我的|不许[你和看]|只有我[能可]|不准你再)/],
  self_exposure: [/(?:其实我一直|说实话|我坦白|我承认我)/],
  future_personality_leak: [/(?:彻底沦陷|完全崩溃|再也控制不住)/],
  genuine_care: [/(?:担心你|为你好|你得好好|别忘了吃|早点休息)/],
  full_commitment: [/(?:我会一直|永远[在陪]|一辈子)/],
  jealousy_expression: [/(?:吃醋|嫉妒|凭什么[他和跟]|为什么[要和跟][他她])/],
  full_collapse: [/(?:我完了|我输了|我认了|随便你|无所谓了)/],
  complete_dependency: [/(?:没了你我|只有你了|你是唯一|除了你没)/],
}

/**
 * Constraint Firewall: phase + memory + identity checks.
 */
function _checkFirewall(output, affectionMap, character, playerName, storyCanon) {
  const violations = []

  // ── Phase Firewall ──
  const rcList = character?.romanceCharacters || []
  for (const rc of rcList) {
    const cc = _state.compiledCharacters.get(rc.name)
    if (!cc) continue

    // Phase 1: absolutely no emotional warmth
    if (cc.phase === 1) {
      const warmthPatterns = [/眼神柔[和软]/, /语气温[柔软]/, /温柔[地得]/, /心疼/, /舍不得/]
      for (const p of warmthPatterns) {
        if (p.test(output) && _contextIsAboutChar(output, rc.name)) {
          violations.push('CEKv2 Phase Firewall [' + rc.name + ']: Phase 1 禁止任何温柔表达')
          break
        }
      }
    }
  }

  // ── Memory Firewall ──
  const fabPatterns = [/(?:上次|昨天|之前|那天)[你我他].{2,15}(?:的(?:时候|事)|发生)/]
  for (const p of fabPatterns) {
    if (p.test(output)) {
      // Check against story canon — if not in timeline, it's fabrication
      const timeline = storyCanon?.timeline || []
      const hasMatch = timeline.some(e => {
        const desc = (e.event || '').toLowerCase()
        const match = output.match(p)
        return match && desc.includes(match[0].slice(0, 4))
      })
      if (!hasMatch) {
        violations.push('CEKv2 Memory Firewall: 疑似编造未发生事件')
      }
    }
  }

  // ── Identity Firewall ──
  if (playerName && playerName !== '玩家') {
    // Check for default name leak
    if (/\b玩家\b/.test(output) && !output.includes('【玩家')) {
      violations.push('CEKv2 Identity Firewall: 输出包含默认名"玩家"（应为"' + playerName + '"）')
    }
  }

  return violations
}

/**
 * Player Anchoring: does output reference the player?
 */
function _checkAnchoring(output, playerName) {
  const violations = []
  if (!playerName || playerName === '玩家') return violations

  const playerRef = new RegExp(playerName)
  const gazeRefs = /看向你|看着你|望向你|视线落|目光|瞥了|盯着你|注视/
  const bodyRefs = /你的肩|你的手|你的腰|你的脸|在你[身旁面]|靠近你|贴近你/
  const speechRefs = /对你说|问你|告诉你|叫你的/

  const hasReference = playerRef.test(output) ||
    gazeRefs.test(output) ||
    bodyRefs.test(output) ||
    speechRefs.test(output)

  if (!hasReference) {
    violations.push('CEKv2 Player Anchoring: 输出中没有玩家（' + playerName + '）存在感引用')
  }

  return violations
}

/**
 * Desire Gradient: detect jumps >1 level.
 */
function _checkDesireGradient(output) {
  const violations = []
  // Compare current vs previous desires — if any character jumped more than 1,
  // it's a soft violation (logged as warning, not hard fail)
  for (const [name, level] of _state.desireGradients) {
    const prev = _state.previousDesires.get(name)
    if (prev != null && Math.abs(level - prev) > 1) {
      violations.push(name + ': 欲望跳变 ' + prev + '→' + level + ' (超过±1限制)')
    }
  }
  return violations
}

/**
 * Emotion Curve: detect jumps >25 in any dimension.
 */
function _checkEmotionCurve(output) {
  const violations = []
  for (const [name, curve] of _state.emotionCurves) {
    const prev = _state.previousEmotions.get(name)
    if (!prev) continue
    for (const key of ['tension', 'curiosity', 'control', 'dependence']) {
      if (Math.abs((curve[key] || 50) - (prev[key] || 50)) > 30) {
        violations.push(name + ': ' + key + ' 情绪跳变过大')
      }
    }
  }
  return violations
}

// ═══════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════

/**
 * Check if any character is in strategy-only mode (Phase 1).
 */
export function hasStrategyLockedCharacters(affectionMap = {}, character) {
  const rcList = character?.romanceCharacters || []
  for (const rc of rcList) {
    const aff = affectionMap[rc.name] ?? rc.affectionInitial ?? 50
    if (computePhase(aff) === 1) return true
  }
  return false
}

/**
 * Get compiled characters for debugging / UI.
 */
export function getCompiledCharacters() {
  const result = {}
  for (const [name, cc] of _state.compiledCharacters) {
    result[name] = { ...cc }
  }
  return result
}

/**
 * Get current desire gradients.
 */
export function getDesireGradients() {
  const result = {}
  for (const [name, level] of _state.desireGradients) {
    result[name] = { level, label: DESIRE_LEVELS[level] || 'unknown' }
  }
  return result
}

/**
 * Get current emotion curves.
 */
export function getEmotionCurves() {
  const result = {}
  for (const [name, curve] of _state.emotionCurves) {
    result[name] = { ...curve }
  }
  return result
}

/**
 * Reset all CEK v2 internal state (call on session clear).
 */
export function resetCEKv2() {
  _state.compiledCharacters.clear()
  _state.desireGradients.clear()
  _state.emotionCurves.clear()
  _state.previousDesires.clear()
  _state.previousEmotions.clear()
  _state.turnCount = 0
  _state.lastContext = null
}

/**
 * Compute the phase for an affection value (public).
 */
export function computePhasePublic(affection) {
  return computePhase(affection)
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function clamp(val, min, max) {
  if (val == null || isNaN(val)) return min
  return Math.min(max, Math.max(min, Math.round(val)))
}

function _contextIsAboutChar(output, charName) {
  if (!charName) return true
  return output.includes(charName)
}
