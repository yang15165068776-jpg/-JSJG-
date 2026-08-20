/**
 * Drama Control System v1 (DCS)
 *
 * Core principle:
 *   ❗ Generation is not enough. The story needs a DIRECTOR.
 *   ❗ DAS generates events. DCS decides WHICH events serve the player's experience.
 *
 * DCS is the CONTROL layer above the generation systems:
 *   AIIS → generates intents          }
 *   ANDS → generates narrative drives   }  these GENERATE
 *   DAS  → generates drama events      }
 *   DCS  → curates, directs, paces     }  this CONTROLS
 *
 * Five control systems:
 *   1. Tension Controller  — regulates tension, prevents overshoot/flatline
 *   2. Spotlight Engine    — ensures player is ALWAYS the narrative center
 *   3. Conflict Director   — curates conflicts toward "爽点" (satisfying payoff)
 *   4. Pacing Manager      — enforces rhythm: calm→conflict→payoff→release→escalate
 *   5. Branch Limiter      — max 1-2 active threads, prevents world-splitting
 *
 * Where it sits in NOS (v8.4):
 *   AIIS → ANDS → DAS → DCS → Orchestrator → Prompt
 *                          ↑
 *                     THE DIRECTOR
 *
 * The essential upgrade:
 *   Before DCS: 系统在制造事件 (system generates events)
 *   After DCS:  系统在导演剧情 (system DIRECTS the story)
 */

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }

// ═══════════════════════════════════════════════════════════
// 1. TENSION CONTROLLER — regulates narrative tension
// ═══════════════════════════════════════════════════════════

/**
 * Tension should oscillate in a controlled wave, not spike chaotically
 * or flatline into boredom. The controller enforces a target band.
 *
 * Target bands by narrative phase:
 *   setup:     25-40  (establish, build curiosity)
 *   rising:    40-65  (escalate, build pressure)
 *   crisis:    65-85  (peak conflict)
 *   collapse:  85-95  (breaking point)
 *   release:   45-60  (emotional release, not back to calm)
 *
 * @param {number} currentTension — combined tension from DAS
 * @param {string} scenePhase — from DramaOrchestrator
 * @param {number} turnsInPhase — how long the current phase has lasted
 * @returns {object} { targetBand, needsAdjustment, adjustment, directive }
 */
export function controlTension(currentTension, scenePhase = 'setup', turnsInPhase = 0) {
  const bands = {
    setup:    { min: 25, max: 40, maxTurns: 5 },
    rising:   { min: 40, max: 65, maxTurns: 6 },
    crisis:   { min: 65, max: 85, maxTurns: 4 },
    collapse: { min: 85, max: 95, maxTurns: 2 },
    release:  { min: 45, max: 60, maxTurns: 3 },
  }

  const band = bands[scenePhase] || bands.setup

  let needsAdjustment = false
  let adjustment = null
  let directive = ''

  // ── Below band → need to push tension up ──
  if (currentTension < band.min) {
    needsAdjustment = true
    adjustment = 'push_up'
    const deficit = band.min - currentTension
    directive = '张力低于' + scenePhase + '阶段目标（当前' + currentTension + '，需要≥' + band.min + '）。' +
                '本轮必须推高张力——冲突升级、情绪加压、或者制造新的不稳定因素。缺口：' + deficit + '点。'
  }

  // ── Above band → need to release (but not collapse to calm) ──
  if (currentTension > band.max && scenePhase !== 'collapse') {
    needsAdjustment = true
    adjustment = 'release_pressure'
    const excess = currentTension - band.max
    directive = '张力超过' + scenePhase + '阶段上限（当前' + currentTension + '，应≤' + band.max + '）。' +
                '本轮需要情绪释放——不是化解冲突，是让积累的压力找到一个出口。超出：' + excess + '点。'
  }

  // ── Been in this phase too long → force phase transition ──
  if (turnsInPhase > band.maxTurns) {
    needsAdjustment = true
    if (!adjustment) adjustment = 'force_transition'
    directive += ' 已在' + scenePhase + '阶段停留' + turnsInPhase + '轮（上限' + band.maxTurns + '轮）——需要推进到下一阶段。'
  }

  return {
    targetBand: band,
    currentTension,
    needsAdjustment,
    adjustment,
    directive: directive || '张力在目标区间内——维持当前节奏。',
    shouldForceTransition: turnsInPhase > band.maxTurns,
  }
}

// ═══════════════════════════════════════════════════════════
// 2. SPOTLIGHT ENGINE — player is always the center
// ═══════════════════════════════════════════════════════════

/**
 * The player MUST remain the narrative center. Every event, every conflict,
 * every character action must ultimately connect back to the player.
 *
 * This engine measures "player focus" and warns/collapses branches
 * that dilute the player's centrality.
 *
 * @param {string} playerName
 * @param {object} attentionMap — from AutonomousWorldEngine (who has attention)
 * @param {Array} pendingActions — from ANDS (character narrative actions)
 * @param {Array} pendingEvents — from DAS (world events)
 * @returns {object} { playerFocusScore, warnings, collapsedBranches, directive }
 */
export function runSpotlightCheck(playerName, attentionMap = {}, pendingActions = [], pendingEvents = []) {
  // ── Calculate player focus score (0-100) ──
  let playerAttention = 0
  let totalAttention = 0

  for (const [name, attn] of Object.entries(attentionMap)) {
    totalAttention += (attn.share || 0)
    if (name === playerName) playerAttention = attn.share || 0
  }

  // If no attention data, default to moderate focus
  const playerFocusScore = totalAttention > 0
    ? Math.round((playerAttention / totalAttention) * 100)
    : 60

  const warnings = []
  const collapsedBranches = []

  // ── Check: how many actions/events are NOT directed at the player? ──
  let nonPlayerActions = 0
  for (const action of (pendingActions || [])) {
    if (action.intent?.target !== 'player' && action.intent?.target !== playerName) {
      nonPlayerActions++
    }
  }

  // ── Branch dilution check ──
  // If > 2 non-player-directed narrative threads → collapse the weakest
  if (nonPlayerActions > 2) {
    warnings.push('⚠️ 叙事焦点分散：' + nonPlayerActions + ' 个非玩家导向的行为。角色们在玩家之外制造了太多独立剧情。')
    // Collapse: keep only the 2 highest-autonomy non-player actions
    collapsedBranches.push({
      reason: '焦点稀释——非玩家导向行为过多',
      collapsed: nonPlayerActions - 2,
    })
  }

  // ── Event dilution check ──
  let nonPlayerEvents = 0
  for (const event of (pendingEvents || [])) {
    // Events that don't reference or involve the player
    const text = (event.narrativeDirective || '') + (event.directive || '') + (event.description || '')
    if (text && !text.includes('玩家') && !text.includes(playerName) && event.source !== 'interrupt') {
      nonPlayerEvents++
    }
  }

  if (nonPlayerEvents > 1) {
    warnings.push('⚠️ 事件焦点分散：' + nonPlayerEvents + ' 个事件与玩家无直接关联。')
  }

  // ── Player focus below threshold → critical warning ──
  if (playerFocusScore < 30) {
    warnings.push('💀 严重警告：玩家注意力份额仅 ' + playerFocusScore + '%。故事正在脱离玩家——必须立即重新聚焦。')
  }

  // ── Build directive ──
  let directive = ''
  if (playerFocusScore >= 60) {
    directive = '玩家是当前场景的明确中心（焦点' + playerFocusScore + '%）。所有事件和角色行为都围绕玩家展开。保持这个聚焦。'
  } else if (playerFocusScore >= 30) {
    directive = '玩家焦点偏低（' + playerFocusScore + '%）。本轮回复必须将叙事重心拉回玩家。让角色关注玩家——不是玩家关注角色。'
  } else {
    directive = '⚠️ 玩家焦点严重不足（' + playerFocusScore + '%）。本轮回复的核心任务：重新确立玩家为叙事中心。让所有事件、所有角色的注意力都指向玩家。'
  }

  return {
    playerFocusScore,
    playerAttention,
    totalAttention,
    warnings,
    collapsedBranches,
    directive,
    needsRefocus: playerFocusScore < 40,
  }
}

// ═══════════════════════════════════════════════════════════
// 3. CONFLICT DIRECTOR — curates conflicts for "爽点"
// ═══════════════════════════════════════════════════════════

/**
 * Not all conflicts are equal. Some serve the player's experience ("爽点"),
 * others are noise. The director maps the current state to the most
 * satisfying conflict type.
 *
 * 爽点 conflict types (player-experience-optimized):
 *   jealousy_rivalry     — 吃醋/抢人 → player feels desired
 *   forced_confrontation — 强制对峙 → player is challenged
 *   misunderstanding_escalation — 误会升级 → player must act
 *   emotional_eruption   — 情绪爆发 → player witnesses raw emotion
 *   power_reversal       — 权力反转 → player gains/loses control
 *   hidden_truth_surface — 真相浮出 → player discovers
 *   possessiveness_claim — 占有宣示 → player is claimed
 *
 * @param {object} state — { uskState, arslEdges, dasTensionState, pendingEvents, turnCount }
 * @returns {object} { recommendedConflict, reason, directive }
 */
export function directConflict(state = {}) {
  const {
    uskState = {},
    arslEdges = {},
    dasTensionState = 'NORMAL',
    pendingEvents = [],
    turnCount = 0,
  } = state

  // ── Analyze current state to find the best conflict angle ──

  // Check jealousy levels
  let maxJealousy = 0
  let maxJealousyFrom = ''
  for (const [key, edge] of Object.entries(arslEdges)) {
    if ((edge.jealousy || 0) > maxJealousy) {
      maxJealousy = edge.jealousy
      maxJealousyFrom = edge.from
    }
  }

  // Check affection distribution (multiple characters with high affection = rivalry)
  let highAffectionChars = []
  for (const [name, char] of Object.entries(uskState?.characters || {})) {
    if ((char.relationship?.affection || 0) > 55) {
      highAffectionChars.push(name)
    }
  }

  // Check unresolved conflicts
  let maxConflicts = 0
  for (const [name, char] of Object.entries(uskState?.characters || {})) {
    const uc = char.tension?.unresolved_conflicts || 0
    if (uc > maxConflicts) maxConflicts = uc
  }

  // Check for secrets/hidden info (from DAS events)
  const hasSecretExposed = pendingEvents.some(e => e.type === 'secret_exposed')

  // ── Map state to 爽点 conflict ──

  let recommendedConflict = null
  let reason = ''

  // Priority 1: Jealousy rivalry (highest 爽点 value)
  if (maxJealousy > 45 && highAffectionChars.length >= 2) {
    recommendedConflict = 'jealousy_rivalry'
    reason = '两个角色都在争夺玩家的注意力——这是最高爽点的冲突类型。让对峙公开化。'
  }
  // Priority 2: Possessiveness claim
  else if (maxJealousy > 55) {
    recommendedConflict = 'possessiveness_claim'
    reason = maxJealousyFrom + ' 的嫉妒已达 ' + maxJealousy + '——需要一次占有宣示。让对方/玩家明确感受到"你是我的"。'
  }
  // Priority 3: Forced confrontation (rising/critical tension)
  else if (dasTensionState === 'RISING' || dasTensionState === 'CRITICAL') {
    recommendedConflict = 'forced_confrontation'
    reason = '张力处于' + dasTensionState + '状态——需要一个强制对峙来让积累的情绪找到出口。'
  }
  // Priority 4: Power reversal
  else if (maxConflicts > 60 && turnCount % 3 === 0) {
    recommendedConflict = 'power_reversal'
    reason = '未解决冲突累积（' + maxConflicts + '）——需要一次权力反转来打破僵局。谁强谁弱可以在一句话里翻转。'
  }
  // Priority 5: Hidden truth surface
  else if (hasSecretExposed || dasTensionState === 'STAGNANT') {
    recommendedConflict = 'hidden_truth_surface'
    reason = '有隐藏信息或故事停滞——让一个真相浮出水面来推动剧情。'
  }
  // Priority 6: Misunderstanding escalation (safe but effective)
  else if (dasTensionState === 'TOO_CALM') {
    recommendedConflict = 'misunderstanding_escalation'
    reason = '故事过于平静——一个轻微的误会可以快速制造张力，且不需要复杂铺垫。'
  }
  // Default: emotional eruption (always works)
  else {
    recommendedConflict = 'emotional_eruption'
    reason = '情绪爆发是最通用的爽点——角色压不住的情绪总是有戏剧性的。'
  }

  // ── Build directive ──
  const CONFLICT_DIRECTIVES = {
    jealousy_rivalry: '🔥 爽点冲突：吃醋/竞争。两个角色用不同的方式争夺玩家——一个进攻，一个防守。让玩家感受到被争夺的快感。',
    forced_confrontation: '⚔️ 爽点冲突：强制对峙。不再绕弯子——角色直接面对对方。问题是直接的，回答必须也是。',
    possessiveness_claim: '🔒 爽点冲突：占有宣示。角色明确表达"你是我的"——不是请求，是宣告。让对方感受到被占有的重量。',
    misunderstanding_escalation: '🌀 爽点冲突：误会升级。一个小的误解在发酵——一方相信了错误的事，另一方不知道发生了什么。张力在信息差中累积。',
    emotional_eruption: '💥 爽点冲突：情绪爆发。角色压不住情绪了——这不是策略，是失控。真实的情感在失控中反而更有力量。',
    power_reversal: '🔄 爽点冲突：权力反转。刚才还占上风的人突然发现自己在防守。一句话、一个动作、一个眼神——权力换了方向。',
    hidden_truth_surface: '🔓 爽点冲突：真相浮出。一个之前被藏住的真相浮出水面。不是全部——只是一角。但这一角足以改变一切。',
  }

  return {
    recommendedConflict,
    reason,
    directive: CONFLICT_DIRECTIVES[recommendedConflict] || '',
    shouldOverrideDAS: recommendedConflict === 'jealousy_rivalry' || recommendedConflict === 'possessiveness_claim',
  }
}

// ═══════════════════════════════════════════════════════════
// 4. PACING MANAGER — enforces narrative rhythm
// ═══════════════════════════════════════════════════════════

/**
 * Narrative rhythm pattern (manga/web-novel pacing):
 *
 *   平 → 小冲突 → 爽点 → 情绪释放 → 再升级
 *   calm → tension → payoff → release → escalate → repeat
 *
 * Each cycle = 4-6 turns. The pacing manager tracks where we are
 * in the cycle and enforces the next beat.
 */
const RHYTHM_CYCLE = [
  { beat: 'calm',       label: '平静',     minTurns: 0, maxTurns: 1, targetTension: '25-35', description: '短暂的平静——让读者/玩家喘一口气，但暗流仍在' },
  { beat: 'tension',    label: '张力积累', minTurns: 1, maxTurns: 2, targetTension: '35-55', description: '新的冲突种子被埋下——关系开始紧绷' },
  { beat: 'conflict',   label: '冲突爆发', minTurns: 1, maxTurns: 2, targetTension: '55-75', description: '冲突正面爆发——对峙、质问、情绪溢出' },
  { beat: 'payoff',     label: '爽点',     minTurns: 1, maxTurns: 1, targetTension: '65-85', description: '情绪的最高点——吃醋的摊牌了、隐藏的说出来了、压不住的爆发了' },
  { beat: 'release',    label: '情绪释放', minTurns: 1, maxTurns: 1, targetTension: '50-65', description: '释放后短暂的回落——但不回到平静。裂痕还在，余波未平' },
  { beat: 'escalate',   label: '再升级',   minTurns: 1, maxTurns: 2, targetTension: '60-80', description: '在余波之上叠加新的冲突——不让故事降回原点' },
]

/**
 * Determine the current rhythm beat and whether we need to advance.
 *
 * @param {number} turnsInCurrentBeat — turns spent in current beat
 * @param {string} currentBeat — current beat name
 * @param {number} currentTension — combined tension
 * @returns {object} { currentBeat, shouldAdvance, nextBeat, directive }
 */
export function managePacing(turnsInCurrentBeat = 0, currentBeat = 'tension', currentTension = 30) {
  // Find current beat index
  let beatIndex = RHYTHM_CYCLE.findIndex(b => b.beat === currentBeat)
  if (beatIndex < 0) beatIndex = 1 // default to tension

  const beat = RHYTHM_CYCLE[beatIndex]

  let shouldAdvance = false
  let reason = ''

  // Advance if we've stayed in this beat too long
  if (turnsInCurrentBeat >= beat.maxTurns && beat.maxTurns > 0) {
    shouldAdvance = true
    reason = '已在' + beat.label + '阶段停留' + turnsInCurrentBeat + '轮（上限' + beat.maxTurns + '轮）'
  }

  // Advance if tension has moved well past this beat's range
  const [tMin, tMax] = (beat.targetTension || '0-100').split('-').map(Number)
  if (currentTension > tMax + 15) {
    shouldAdvance = true
    reason = '张力（' + currentTension + '）已远超' + beat.label + '阶段目标（' + beat.targetTension + '）'
  }

  // Don't advance too fast — minimum turns
  if (turnsInCurrentBeat < beat.minTurns) {
    shouldAdvance = false
  }

  // Next beat (cycle: escalate → calm → tension → ...)
  const nextIndex = (beatIndex + 1) % RHYTHM_CYCLE.length
  const nextBeat = RHYTHM_CYCLE[nextIndex]

  // Build directive
  let directive = ''
  if (shouldAdvance) {
    directive = '🎬 节奏推进：从【' + beat.label + '】→【' + nextBeat.label + '】。' +
                reason + '。' + nextBeat.description
  } else {
    directive = '🎬 当前节奏：维持在【' + beat.label + '】。' + beat.description +
                '。目标张力：' + beat.targetTension + '。'
  }

  return {
    currentBeat: beat.beat,
    currentBeatLabel: beat.label,
    shouldAdvance,
    nextBeat: shouldAdvance ? nextBeat.beat : null,
    nextBeatLabel: shouldAdvance ? nextBeat.label : null,
    directive,
    cyclePosition: beatIndex + '/' + (RHYTHM_CYCLE.length - 1),
  }
}

// ═══════════════════════════════════════════════════════════
// 5. BRANCH LIMITER — prevents world-splitting
// ═══════════════════════════════════════════════════════════

/**
 * The story must not split into too many parallel threads.
 * Max active branches: 1-2.
 *
 * A "branch" is a narrative thread with its own:
 *   - character(s) focus
 *   - conflict
 *   - emotional arc
 *
 * When a new branch tries to open while max is reached:
 *   → Collapse the oldest/lowest-priority branch
 *   → Or merge it into an existing branch
 *
 * @param {Array} activeBranches — current active narrative branches
 * @param {Array} newBranches — branches trying to open this turn
 * @param {number} maxBranches — cap (default 2)
 * @returns {object} { allowed, collapsed, merged, directive }
 */
export function limitBranches(activeBranches = [], newBranches = [], maxBranches = 2) {
  const collapsed = []
  const merged = []
  const allowed = []

  // Current open slots
  let openSlots = maxBranches - (activeBranches.length)

  for (const branch of newBranches) {
    if (openSlots > 0) {
      // Slot available → allow
      allowed.push(branch)
      openSlots--
    } else {
      // No slot → try to merge or collapse
      // Check if this branch can merge with an existing one (same character focus)
      const mergeTarget = activeBranches.find(
        ab => ab.charFocus === branch.charFocus || ab.conflictType === branch.conflictType
      )
      if (mergeTarget) {
        merged.push({ branch, mergedInto: mergeTarget })
      } else {
        // Collapse the oldest active branch to make room
        if (activeBranches.length > 0) {
          const oldest = activeBranches[0] // oldest is first
          collapsed.push({ collapsed: oldest, reason: '为新分支腾出空间：' + (branch.label || branch.type || '新剧情线') })
          activeBranches.shift()
          allowed.push(branch)
        }
      }
    }
  }

  // Build directive
  let directive = ''
  if (collapsed.length > 0) {
    directive += '⚠️ 分支限制：以下旧剧情线被折叠以保持叙事聚焦——'
    for (const c of collapsed) {
      directive += '「' + (c.collapsed?.label || c.collapsed?.type || '旧线') + '」'
    }
    directive += '。保持当前聚焦于核心冲突。'
  }
  if (merged.length > 0) {
    directive += '🔗 分支合并：以下新剧情线已合并到现有冲突中——'
    for (const m of merged) {
      directive += '「' + (m.branch?.label || m.branch?.type || '新线') + '」→「' + (m.mergedInto?.label || m.mergedInto?.type || '现有线') + '」'
    }
    directive += '。'
  }
  if (allowed.length > 0 && collapsed.length === 0 && merged.length === 0) {
    directive += '✅ 活跃分支：' + (activeBranches.length + allowed.length) + '/' + maxBranches + '。叙事聚焦良好。'
  }

  return {
    allowed,
    collapsed,
    merged,
    directive: directive || '✅ 分支数在限制内。',
    activeCount: activeBranches.length + allowed.length,
    maxBranches,
  }
}

// ═══════════════════════════════════════════════════════════
// 6. DCS MAIN API — the Director
// ═══════════════════════════════════════════════════════════

export const DramaControlSystem = {

  /** @type {object} director state (rhythm tracking, branch tracking) */
  _state: {
    turnCount: 0,
    currentBeat: 'tension',
    turnsInCurrentBeat: 0,
    activeBranches: [],       // [{ id, charFocus, conflictType, label, openedAt }]
    playerFocusHistory: [],   // last N player focus scores
    tensionHistory: [],       // last N tension readings
  },

  /** @type {object} last director's cut (for prompt injection) */
  _lastDirectorCut: null,

  // ── Init ──────────────────────────────────────────

  init() {
    this._state = {
      turnCount: 0,
      currentBeat: 'tension',
      turnsInCurrentBeat: 0,
      activeBranches: [],
      playerFocusHistory: [],
      tensionHistory: [],
    }
    this._lastDirectorCut = null
  },

  reset() {
    this.init()
  },

  // ── Main Direct Cycle ──────────────────────────────

  /**
   * Run one director cycle.
   *
   * Inputs: raw events/intents from the generation systems
   * Outputs: curated "Director's Cut" for prompt injection
   *
   * @param {object} inputs
   * @param {object} inputs.character — full character descriptor (carries _aiisIntentContext, _andsNarrativeDirective, _dasNarrativeEvent)
   * @param {object} inputs.uskState — raw USK
   * @param {object} inputs.arslEdges — from RelationshipPhysics
   * @param {object} inputs.sceneState — from DramaOrchestrator
   * @param {object} inputs.attentionMap — from AutonomousWorldEngine
   * @param {string} inputs.playerName — player character name
   * @param {object} inputs.dasTickResult — from DAS tick
   * @param {object} inputs.andsTickResult — from ANDS tick
   * @returns {object} { directorCut, tensionControl, spotlight, conflictDirection, pacing, branchLimit }
   */
  direct(inputs = {}) {
    const {
      character = {},
      uskState = {},
      arslEdges = {},
      sceneState = null,
      attentionMap = {},
      playerName = '玩家',
      dasTickResult = null,
      andsTickResult = null,
    } = inputs

    this._state.turnCount++

    // ── Gather pending events/actions from generation systems ──
    const pendingEvents = dasTickResult?.events || []
    const pendingActions = andsTickResult?.actions || []
    const combinedTension = dasTickResult?.combinedTension || sceneState?.tension || 30

    // ── 1. Tension Control ──
    const tensionControl = controlTension(
      combinedTension,
      sceneState?.scenePhase || 'setup',
      this._state.turnsInCurrentBeat,
    )

    // Track tension history
    this._state.tensionHistory.push({ turn: this._state.turnCount, tension: combinedTension })
    if (this._state.tensionHistory.length > 30) this._state.tensionHistory = this._state.tensionHistory.slice(-30)

    // ── 2. Spotlight Check ──
    const spotlight = runSpotlightCheck(playerName, attentionMap, pendingActions, pendingEvents)

    // Track player focus history
    this._state.playerFocusHistory.push({ turn: this._state.turnCount, focus: spotlight.playerFocusScore })
    if (this._state.playerFocusHistory.length > 20) this._state.playerFocusHistory = this._state.playerFocusHistory.slice(-20)

    // ── 3. Conflict Direction ──
    const dasTensionState = dasTickResult?.tensionState || 'NORMAL'
    const conflictDirection = directConflict({
      uskState,
      arslEdges,
      dasTensionState,
      pendingEvents,
      turnCount: this._state.turnCount,
    })

    // ── 4. Pacing Management ──
    const pacing = managePacing(
      this._state.turnsInCurrentBeat,
      this._state.currentBeat,
      combinedTension,
    )

    // Advance beat if needed
    if (pacing.shouldAdvance && pacing.nextBeat) {
      this._state.currentBeat = pacing.nextBeat
      this._state.turnsInCurrentBeat = 0
    } else {
      this._state.turnsInCurrentBeat++
    }

    // ── 5. Branch Limiting ──
    // Identify new branches from pending events/actions
    const newBranches = []
    for (const event of pendingEvents) {
      if (event.source === 'conflict' || event.source === 'pressure') {
        newBranches.push({
          type: event.type,
          label: event.label,
          conflictType: event.type,
          source: event.source,
          priority: event.priority || 5,
        })
      }
    }
    for (const action of pendingActions) {
      if (action.intent?.powerMove) {
        newBranches.push({
          type: action.intent.type,
          label: action.intent.label,
          charFocus: action.charName,
          source: 'ands',
          priority: action.schedule?.initiativeOverride ? 2 : 4,
        })
      }
    }

    // Sort by priority (lower = more important)
    newBranches.sort((a, b) => (a.priority || 9) - (b.priority || 9))

    const branchLimit = limitBranches(this._state.activeBranches, newBranches)

    // Update active branches
    // Remove collapsed ones
    for (const c of branchLimit.collapsed) {
      this._state.activeBranches = this._state.activeBranches.filter(
        ab => ab !== c.collapsed
      )
    }
    // Add allowed ones
    for (const a of branchLimit.allowed) {
      this._state.activeBranches.push({
        ...a,
        id: 'br-' + this._state.turnCount + '-' + Math.random().toString(36).substr(2, 4),
        openedAt: this._state.turnCount,
      })
    }
    // Cap active branches at max
    while (this._state.activeBranches.length > branchLimit.maxBranches) {
      this._state.activeBranches.shift() // remove oldest
    }

    // ── Assemble Director's Cut ──
    const directorCut = this._assembleDirectorCut({
      tensionControl,
      spotlight,
      conflictDirection,
      pacing,
      branchLimit,
      combinedTension,
    })

    this._lastDirectorCut = {
      tensionControl,
      spotlight,
      conflictDirection,
      pacing,
      branchLimit,
      directorCut,
      timestamp: Date.now(),
    }

    return {
      directorCut,
      tensionControl,
      spotlight,
      conflictDirection,
      pacing,
      branchLimit,
    }
  },

  // ── Director's Cut Assembly ────────────────────────

  /**
   * Assemble the unified Director's Cut prompt block.
   * This is THE single narrative control block injected into the LLM prompt.
   * It tells the LLM what the director wants THIS TURN.
   */
  _assembleDirectorCut({ tensionControl, spotlight, conflictDirection, pacing, branchLimit, combinedTension }) {
    const lines = [
      '【🎬 DCS 导演系统——本轮剧情控制指令】',
      '',
    ]

    // ── Tension status (1 line) ──
    lines.push('📊 张力：' + combinedTension + '/100 | ' + tensionControl.directive)

    // ── Pacing (1 line) ──
    lines.push('🎵 节奏：' + pacing.currentBeatLabel + '（周期位置 ' + pacing.cyclePosition + '）| ' +
              (pacing.shouldAdvance ? '→ 即将进入【' + pacing.nextBeatLabel + '】' : '维持当前节拍'))

    // ── Spotlight (1 line) ──
    if (spotlight.needsRefocus || spotlight.warnings.length > 0) {
      lines.push('🔦 焦点：⚠️ ' + spotlight.directive)
    } else {
      lines.push('🔦 焦点：✅ ' + spotlight.directive)
    }

    // ── Conflict direction (key section) ──
    lines.push('',
      '━━━ 🎯 导演指定的冲突方向 ━━━',
      conflictDirection.directive,
      '原因：' + conflictDirection.reason,
    )

    // ── Branch status ──
    if (branchLimit.directive) {
      lines.push('',
        '━━━ 🌿 分支管理 ━━━',
        branchLimit.directive,
      )
    }

    // ── Warnings (if any) ──
    if (spotlight.warnings.length > 0) {
      lines.push('',
        '━━━ ⚠️ 导演警告 ━━━',
        ...spotlight.warnings.map(w => '· ' + w),
      )
    }

    // ── Per-beat writing guidance ──
    lines.push('',
      '━━━ 🎬 本轮导演指令（必须执行）━━━',
    )

    switch (pacing.currentBeat) {
      case 'calm':
        lines.push('· 短暂的平静——但不松懈。暗流在表面下涌动。',
          '· 用细节和潜台词制造"即将有事发生"的预感。',
          '· 不要让角色太舒服——平静是为了让下一步冲突更疼。')
        break
      case 'tension':
        lines.push('· 张力积累——关系开始紧绷。每个字都带着未说出的东西。',
          '· 试探、含沙射影、说一半的话——都是武器。',
          '· 让人感觉到：有什么东西正在逼近，但还没到。')
        break
      case 'conflict':
        lines.push('· 冲突正面爆发——不再绕弯子。',
          '· 直接质问、直接对峙、直接表达。',
          '· 这一刻不能回避——角色必须站在冲突里，不能退。')
        break
      case 'payoff':
        lines.push('· 🔥 爽点——本轮是情绪最高点。',
          '· 吃醋的必须摊牌。隐藏的必须说出口。压抑的必须爆发。',
          '· 这是读者/玩家等了四轮的那一刻——不能敷衍，不能省略，不能一笔带过。',
          '· 写细节：爆发时的表情、声音的变化、身体的反应。')
        break
      case 'release':
        lines.push('· 情绪释放——爆发后的余波。不回到平静，裂痕还在。',
          '· 角色在消化刚才发生的事。说出口的话收不回了。',
          '· 沉默中有重量。新的距离已经形成。')
        break
      case 'escalate':
        lines.push('· 再升级——在余波上叠加新的冲突。不让故事降回原点。',
          '· 刚释放完的情绪被新的刺激再次点燃。',
          '· 这一次比上一次更危险——因为防线已经被打开过一次了。')
        break
    }

    // ── Player focus enforcement ──
    if (spotlight.needsRefocus) {
      lines.push('',
        '· ⚠️ 玩家焦点不足。本轮所有事件的叙述必须最终落回玩家——',
        '  不是"角色们发生了什么事然后玩家看着"，而是"角色们做的事如何影响了玩家、',
        '  玩家如何反应、角色如何因为玩家的反应而进一步反应"。')
    }

    // ── Tension adjustment ──
    if (tensionControl.needsAdjustment) {
      lines.push('',
        '· ' + tensionControl.directive)
    }

    return lines.join('\n')
  },

  // ── Public Access ──────────────────────────────────

  /**
   * Get the last director's cut for prompt injection.
   * Called from coordinator.
   */
  getDirectorCut() {
    if (!this._lastDirectorCut) return ''
    const age = Math.round((Date.now() - this._lastDirectorCut.timestamp) / 1000)
    if (age > 300) return ''
    return this._lastDirectorCut.directorCut
  },

  /**
   * Get the full last director state (for debugging).
   */
  getLastDirectorState() {
    return this._lastDirectorCut ? { ...this._lastDirectorCut } : null
  },

  /**
   * Get current pacing state.
   */
  getPacingState() {
    return {
      currentBeat: this._state.currentBeat,
      turnsInCurrentBeat: this._state.turnsInCurrentBeat,
      activeBranches: this._state.activeBranches.length,
    }
  },

  /**
   * Manually force a beat change (for testing/debugging).
   */
  forceBeat(beatName) {
    const valid = RHYTHM_CYCLE.find(b => b.beat === beatName)
    if (valid) {
      this._state.currentBeat = beatName
      this._state.turnsInCurrentBeat = 0
    }
  },
}
