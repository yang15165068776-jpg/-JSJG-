/**
 * Character Agency Engine v1
 *
 * Core problem:
 *   Player = sole engine of the story. Characters only react.
 *   A "flirtatious" character can't autonomously flirt with someone else.
 *   A "jealous" character can't manufacture drama behind the player's back.
 *
 * This engine grants characters AUTONOMOUS ACTION AUTHORITY:
 *   ✅ Characters can interact with EACH OTHER (not just the player)
 *   ✅ Events happen without player input or player awareness
 *   ✅ The world does NOT revolve around the player
 *
 * Design philosophy:
 *   ❗ Agency is a RUNTIME PERMISSION, not a prompt instruction.
 *   ❗ The model doesn't "forget" to be proactive — it was never authorized.
 *
 * Architecture:
 *   Internal Desire Graph → Agency Scoring → Action Trigger
 *   → Narrative Hint Injection → LLM weaves into story
 */

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }

// ═══════════════════════════════════════════════════════════
// 1. Internal Desire Graph
// ═══════════════════════════════════════════════════════════

/**
 * Per-character agency state.
 * Tracks desire/interest toward OTHER characters (not the player).
 *
 * Stored in-memory per session. Reset on page navigation.
 */
function createCharacterAgencyState(charName) {
  return {
    name: charName,
    // Desire toward other characters: { targetName: 0-100 }
    attraction: {},
    // Personality-driven agency traits
    riskTolerance: 50,       // willingness to act secretly / behind player's back
    impulsiveness: 50,       // tendency to act without planning
    boredom: 30,             // current boredom level (drives "restless" actions)
    // Cooldown
    lastAutonomousAction: 0, // turn number of last action
    actionHistory: [],       // [{ turn, type, target, revealed }]
  }
}

/**
 * Initialize agency states for all characters in the scene.
 * Personality keywords adjust base traits.
 */
export function initAgencyStates(character) {
  const states = {}
  const rcList = character.romanceCharacters || []

  for (const rc of rcList) {
    if (!rc.name) continue
    const state = createCharacterAgencyState(rc.name)

    // Adjust traits from personality keywords
    const personality = (rc.personality || '') + (rc.background || '')
    if (/轻浮|风流|花心|放荡|玩世不恭/.test(personality)) {
      state.riskTolerance = clamp(state.riskTolerance + 25, 0, 100)
      state.impulsiveness = clamp(state.impulsiveness + 20, 0, 100)
    }
    if (/偏执|占有欲强|控制欲|病娇/.test(personality)) {
      state.riskTolerance = clamp(state.riskTolerance + 15, 0, 100)
      state.impulsiveness = clamp(state.impulsiveness + 10, 0, 100)
    }
    if (/腹黑|城府深|狡诈/.test(personality)) {
      state.riskTolerance = clamp(state.riskTolerance + 30, 0, 100)
    }
    if (/霸道|强势|狂妄/.test(personality)) {
      state.impulsiveness = clamp(state.impulsiveness + 15, 0, 100)
    }
    if (/温柔|善良|单纯|软萌/.test(personality)) {
      state.riskTolerance = clamp(state.riskTolerance - 20, 0, 100)
      state.impulsiveness = clamp(state.impulsiveness - 15, 0, 100)
    }

    // Build attraction map toward other characters (initially moderate-low)
    for (const other of rcList) {
      if (other.name === rc.name) continue
      // Base attraction + personality modifiers
      let baseAttraction = 30
      // Light/frivolous characters start with higher attraction to others
      if (/轻浮|风流|花心/.test(personality)) baseAttraction = 50
      // Yandere/obsessive types are focused on player, less on others
      if (/病娇|偏执/.test(personality)) baseAttraction = 15
      state.attraction[other.name] = clamp(baseAttraction + Math.random() * 20, 0, 100)
    }

    states[rc.name] = state
  }

  return states
}

// ═══════════════════════════════════════════════════════════
// 2. Agency Scoring
// ═══════════════════════════════════════════════════════════

/**
 * Score a character's agency drive this turn.
 * Returns { shouldAct, score, primaryTarget, reason, actionType }
 */
function scoreAgency(charState, allStates, uskState, turnCount) {
  if (!charState) return { shouldAct: false, score: 0 }

  // Cooldown: at least 3 turns between autonomous actions for the same character
  const turnsSinceLast = turnCount - charState.lastAutonomousAction
  if (charState.lastAutonomousAction > 0 && turnsSinceLast < 3) {
    return { shouldAct: false, score: 0, reason: '冷却中' }
  }

  // ── Score components ──

  // 1. Desire toward others (who does this character want?)
  const desireTargets = Object.entries(charState.attraction || {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])

  if (desireTargets.length === 0) {
    return { shouldAct: false, score: 0, reason: '无欲求对象' }
  }

  const topDesire = desireTargets[0]
  const primaryTarget = topDesire[0]
  const desireScore = topDesire[1]

  // 2. Boredom — low engagement with player or repetitive scene → more agency
  const uskChar = uskState?.characters?.[charState.name]
  const boredomFromUSK = uskChar?.life?.lonely ?? uskChar?.life?.loneliness ?? 40
  const boredomScore = charState.boredom * 0.4 + boredomFromUSK * 0.3

  // 3. Jealousy — if target is getting attention from others
  const jealousy = uskChar?.emotion?.jealousy ?? 5
  const jealousyScore = jealousy * 0.6

  // 4. Opportunity — impulsiveness + risk tolerance
  const opportunityScore = charState.impulsiveness * 0.5 + charState.riskTolerance * 0.3

  // 5. Attachment instability — unclear relationship = more likely to wander
  const affection = uskChar?.relationship?.affection ?? 50
  // Low affection (10-30) OR very high affection (>85 with jealousy) → instability
  let instabilityScore = 0
  if (affection < 30) instabilityScore = 30 - affection  // Cold relationship → look elsewhere
  if (affection > 85 && jealousy > 40) instabilityScore = 20  // Possessive but jealous → act out

  // ── Composite score ──
  const composite =
    desireScore * 0.35 +
    boredomScore * 0.15 +
    jealousyScore * 0.20 +
    opportunityScore * 0.20 +
    instabilityScore * 0.10

  // ── Threshold ──
  const threshold = 45 + Math.random() * 10  // 45-55, with some randomness

  if (composite < threshold) {
    return { shouldAct: false, score: Math.round(composite), reason: '驱动力不足 (' + Math.round(composite) + '/' + Math.round(threshold) + ')' }
  }

  // ── Determine action type ──
  let actionType = 'contact_other'
  if (desireScore > 60 && charState.impulsiveness > 50) actionType = 'flirt_other'
  if (jealousy > 50 && charState.riskTolerance > 40) actionType = 'create_misunderstanding'
  if (instabilityScore > 20 && charState.riskTolerance > 50) actionType = 'hide_behavior'
  if (charState.impulsiveness > 70 && desireScore > 50) actionType = 'test_boundary'

  return {
    shouldAct: true,
    score: Math.round(composite),
    primaryTarget,
    reason: '欲望驱动力 ' + Math.round(composite) + '（目标：' + primaryTarget + '）',
    actionType,
    desireScore: Math.round(desireScore),
  }
}

// ═══════════════════════════════════════════════════════════
// 3. Action Generation + Narrative Hints
// ═══════════════════════════════════════════════════════════

const ACTION_NARRATIVES = {
  contact_other: {
    label: '主动联系其他角色',
    hints: [
      '角色 {actor} 今天对玩家的回复异常简短——ta的注意力明显在别人身上',
      '角色 {actor} 的手机屏幕频繁亮起，但ta没有在玩家面前查看',
      '有人看到角色 {actor} 和 {target} 最近走得比平时近',
      '角色 {actor} 回消息的间隔越来越长——ta在另一个对话框里打字',
      '角色 {actor} 提起 {target} 时语气轻描淡写，但说的频率明显变高了',
    ],
    effect: { targetAttraction: +8, playerJealousyHint: true },
  },
  flirt_other: {
    label: '与其他人暧昧',
    hints: [
      '角色 {target} 今天心情异常好——有人逗ta开心了，那个人不是玩家',
      '角色 {actor} 的衣领上有不属于玩家的香水/古龙水味道',
      '有人提起昨晚看到角色 {actor} 和 {target} 在一起，{actor} 没有否认',
      '角色 {actor} 说话时无意中用了和 {target} 一样的口头禅——亲密是会传染的',
      '角色 {actor} 对玩家说"我们只是朋友"——但说这话时眼神闪了一下',
    ],
    effect: { targetAttraction: +15, playerDiscoveryRisk: 0.3 },
  },
  create_misunderstanding: {
    label: '制造误会/三角张力',
    hints: [
      '角色 {actor} 故意在玩家能听到的范围内接了 {target} 的电话，语气暧昧',
      '角色 {actor} 把 {target} 送的东西放在了显眼的位置——玩家不可能看不到',
      '角色 {target} 突然对玩家态度冷淡——有人在中间说了什么',
      '角色 {actor} 对玩家说"你问{target}吧"——随即露出一个意味深长的表情',
      '一条发给 {target} 的消息"不小心"发到了玩家的对话框里——内容暧昧',
    ],
    effect: { tensionDelta: +10, targetAttraction: +5, playerJealousyTrigger: true },
  },
  hide_behavior: {
    label: '隐瞒/秘密行为',
    hints: [
      '角色 {actor} 的手机屏幕换了方向——ta以前从不这样',
      '角色 {actor} 在玩家靠近时迅速关掉了某个对话框',
      '角色 {actor} 说昨晚"一个人在家"——但手机定位显示的不是',
      '有人不经意提起一件事——角色 {actor} 从来没对玩家说过',
      '角色 {actor} 和 {target} 同时沉默了一个话题——他们之间有玩家不知道的默契',
    ],
    effect: { targetAttraction: +12, secrecyLevel: 'high' },
  },
  test_boundary: {
    label: '试探关系边界',
    hints: [
      '角色 {actor} 今天突然提起"我们到底是什么关系"——但不是在问玩家',
      '角色 {actor} 对玩家保持距离的同时，和 {target} 靠得很近——在观察玩家的反应',
      '角色 {actor} 当众夸 {target} 的时候眼睛却在看玩家——这是测试',
      '角色 {actor} 取消了和玩家的约定，却和 {target} 出现在同一个地方',
      '角色 {actor} 说"也许我不该只等你一个人"——说完等着看玩家的表情',
    ],
    effect: { tensionDelta: +8, playerAwareness: 0.6 },
  },
}

function generateNarrativeHint(actor, target, actionType) {
  const actionConfig = ACTION_NARRATIVES[actionType] || ACTION_NARRATIVES.contact_other
  const hint = pick(actionConfig.hints)
    .replace(/\{actor\}/g, actor)
    .replace(/\{target\}/g, target)

  return {
    hint,
    actionType,
    actor,
    target,
    label: actionConfig.label,
    effect: actionConfig.effect,
  }
}

// ═══════════════════════════════════════════════════════════
// 4. Main Engine API
// ═══════════════════════════════════════════════════════════

export const AgencyEngine = {

  /** @type {object} agency states keyed by character name */
  _states: {},

  /** @type {Array} generated hints for the current turn */
  _pendingHints: [],

  /** @type {number} turn counter */
  _turnCount: 0,

  // ── Init ──────────────────────────────────────────

  /**
   * Initialize agency engine for the current scene.
   * Call once per session (InteractionKernel.init).
   */
  init(character, uskState) {
    this._states = initAgencyStates(character)
    this._pendingHints = []
    this._turnCount = 0
  },

  /**
   * Reset all agency state.
   */
  reset() {
    this._states = {}
    this._pendingHints = []
    this._turnCount = 0
  },

  // ── Main Check ────────────────────────────────────

  /**
   * Check if any character should autonomously act this turn.
   * Called from executeTurn BEFORE the LLM call.
   *
   * Only generates 0-1 actions per check to avoid narrative chaos.
   *
   * @param {object} character — full LLM character descriptor
   * @param {object} uskState — USK state from getRawFolderUSK()
   * @returns {object|null} the generated hint, or null if no action
   */
  check(character, uskState) {
    this._turnCount++
    this._pendingHints = []

    // Only check every 3 turns (avoid action spam)
    if (this._turnCount > 1 && this._turnCount % 3 !== 0) return null

    // Score all characters
    const candidates = []
    for (const [name, charState] of Object.entries(this._states)) {
      const result = scoreAgency(charState, this._states, uskState, this._turnCount)
      if (result.shouldAct) {
        candidates.push({ name, ...result })
      }
    }

    if (candidates.length === 0) {
      // Increment boredom for all characters (they're all waiting)
      for (const state of Object.values(this._states)) {
        state.boredom = clamp(state.boredom + 3, 0, 100)
      }
      return null
    }

    // Pick the highest-scoring candidate
    candidates.sort((a, b) => b.score - a.score)
    const winner = candidates[0]

    // Generate the narrative hint
    const hint = generateNarrativeHint(winner.name, winner.primaryTarget, winner.actionType)

    // Update character state
    const charState = this._states[winner.name]
    if (charState) {
      // Increase attraction toward target (the more you act, the more invested you get)
      if (charState.attraction[winner.primaryTarget] != null) {
        charState.attraction[winner.primaryTarget] = clamp(
          charState.attraction[winner.primaryTarget] + 5, 0, 100
        )
      }
      // Reset boredom
      charState.boredom = clamp(charState.boredom - 15, 0, 100)
      // Record action
      charState.lastAutonomousAction = this._turnCount
      charState.actionHistory.push({
        turn: this._turnCount,
        type: winner.actionType,
        target: winner.primaryTarget,
        revealed: false,
      })
    }

    // Also slightly increase the target character's boredom (they're now involved)
    const targetState = this._states[winner.primaryTarget]
    if (targetState) {
      targetState.boredom = clamp(targetState.boredom - 5, 0, 100)
    }

    this._pendingHints = [hint]
    return hint
  },

  // ── Narrative Context Builder ─────────────────────

  /**
   * Build the agency context block for prompt injection.
   * These are "off-screen events" that the LLM should weave into the narrative.
   *
   * IMPORTANT: These are HINTS, not directives. The LLM should:
   *   - Reference them naturally (not info-dump)
   *   - Let the player DISCOVER them (not be told directly)
   *   - Use them as subtext (not main plot)
   *
   * @returns {string} formatted context block, or '' if no pending hints
   */
  buildContext() {
    if (this._pendingHints.length === 0) return ''

    const lines = [
      '【幕后事件——世界在玩家视线之外发生的事】',
      '',
      '以下事件正在发生，但玩家不一定知道。',
      '你的任务不是直接告诉玩家这些事——而是让这些事在角色的行为、',
      '语气、潜台词中"泄漏"出来。玩家应该感到：有什么不对劲。',
      '',
      '━━━ 本轮幕后事件 ━━━',
    ]

    for (const hint of this._pendingHints) {
      lines.push('')
      lines.push('📡 ' + hint.hint)
      lines.push('  （行为类型：' + hint.label + ' | 涉及：' + hint.actor + ' → ' + hint.target + '）')
    }

    lines.push('')
    lines.push('━━━ 叙述要求 ━━━')
    lines.push('· 不要让角色直接说出以上事件——让它们在行为细节中"泄漏"')
    lines.push('· 如果玩家问起，角色可以：闪烁其词 / 转移话题 / 轻描淡写 / 反问玩家"你什么意思"')
    lines.push('· 行为优先于语言——用角色的动作、延迟、沉默、多余的解释来暗示')
    lines.push('· 关键原则：世界不围绕玩家转。角色有自己的生活、欲望、秘密。')

    return lines.join('\n')
  },

  // ── State Access ──────────────────────────────────

  /**
   * Get the current agency states (for debugging).
   */
  getStates() {
    return { ...this._states }
  },

  /**
   * Manually adjust a character's attraction toward another.
   * Called from affection changes in the main pipeline.
   */
  adjustAttraction(charName, targetName, delta) {
    const state = this._states[charName]
    if (!state) return
    if (state.attraction[targetName] == null) {
      state.attraction[targetName] = 50
    }
    state.attraction[targetName] = clamp(state.attraction[targetName] + delta, 0, 100)
  },

  /**
   * Sync agency states with USK changes (affection, jealousy, etc.).
   */
  syncFromUSK(uskState) {
    if (!uskState?.characters) return
    for (const [name, charState] of Object.entries(this._states)) {
      const uskChar = uskState.characters[name]
      if (!uskChar) continue

      // Jealousy → increased impulsiveness
      const jealousy = uskChar.emotion?.jealousy ?? 5
      if (jealousy > 50) {
        charState.impulsiveness = clamp(charState.impulsiveness + 5, 0, 100)
      }

      // Low affection toward player → increased attraction to alternatives
      const affection = uskChar.relationship?.affection ?? 50
      if (affection < 30) {
        // Character looks elsewhere
        for (const target of Object.keys(charState.attraction)) {
          charState.attraction[target] = clamp(charState.attraction[target] + 2, 0, 100)
        }
      }
    }
  },
}
