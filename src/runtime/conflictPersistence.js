/**
 * Conflict Persistence System v1 (CPS)
 *
 * The fundamental problem: conflicts are "settled" by the model immediately
 * after they're generated. The default pipeline is:
 *
 *   Conflict → Explanation → Understanding → Softening → Tension gone
 *
 * CPS breaks this pipeline. Core principle:
 *
 *   ❗ Conflict is not an EVENT. Conflict is a persistent STATE.
 *
 * Five modules:
 *   1. ConflictStateEngine   — stateful tracker of active conflicts
 *   2. PersistenceLockLayer  — enforces minimum lifespan (N turns)
 *   3. ConflictMemoryLock    — prevents natural decay / forgetting
 *   4. BehaviorOverride      — forces behavior when conflict is active
 *   5. TensionFloor          — world never fully calm (min 0.65)
 *
 * Three iron laws:
 *   1. Conflict has INERTIA — cannot be resolved instantly
 *   2. Conflict cannot be dissolved by EXPLANATION — no rational resolution
 *   3. Conflict must PERSIST across turns — persistence > narrative closure
 */

// ═══════════════════════════════════════════════════════════
// 1. Conflict State Engine
// ═══════════════════════════════════════════════════════════

/**
 * The Conflict State Engine tracks all active conflicts as persistent
 * states, not one-time events. Each conflict has a minimum lifespan,
 * an intensity, and a lock flag.
 */
export const ConflictStateEngine = {
  /**
   * Create a fresh conflict state.
   */
  create() {
    return {
      activeConflicts: [],
      conflictHistory: [],    // resolved/expired conflicts for reference
      tensionLevel: 0.60,    // global tension 0-1
      tensionFloor: 0.60,    // never drops below this
      turnCount: 0,
      lastUpdated: Date.now(),
    }
  },

  /**
   * Register a new conflict event.
   * Conflicts auto-initialize with a minimum lifespan.
   *
   * @param {object} state - current conflict state
   * @param {object} event - the triggering event
   * @param {object} opts - { minLifespan: 3, intensity: 0.7, locked: true }
   */
  register(state, event, opts = {}) {
    const { minLifespan = 3, intensity = 0.7, locked = true } = opts

    // Determine conflict type from event
    const conflictType = mapEventToConflictType(event)

    // Determine intensity boost
    const intensityBoost = conflictType === 'BETRAYAL' ? 0.4
      : conflictType === 'CONFRONTATION' ? 0.25
      : conflictType === 'JEALOUSY_TRIGGER' ? 0.20
      : conflictType === 'CONTROL_CLASH' ? 0.20
      : conflictType === 'EMOTIONAL_EXPLOSION' ? 0.35
      : 0.15

    const conflict = {
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      type: conflictType,
      sourceEvent: event.summary || event.type || '未命名冲突',
      actor: event.actor || '角色',
      target: event.target || 'user',
      intensity: clamp(intensity, 0.3, 1.0),
      intensityBoost,
      lifespan: {
        remaining: minLifespan,     // turns remaining before can resolve
        initial: minLifespan,
      },
      locked,                        // if true, cannot be auto-resolved
      createdAt: state.turnCount,
      escalatedAt: null,             // turn when escalated
      deescalatedAt: null,           // turn when de-escalated (but not resolved)
      emotion: event.emotion || 'anger',
      resolutionBlocked: true,       // cannot be resolved by model
    }

    state.activeConflicts.push(conflict)
    state.tensionLevel = clamp(state.tensionLevel + intensityBoost, 0, 1.0)

    return conflict
  },

  /**
   * Advance the conflict state by one turn.
   * Decrements remaining lifespans. Enforces tension floor.
   * Resolves conflicts that have expired their lifespan AND are unlocked.
   *
   * @returns {object} { changed: boolean, resolved: Array, escalated: Array }
   */
  advance(state) {
    state.turnCount++
    const resolved = []
    const escalated = []

    for (const c of state.activeConflicts) {
      c.lifespan.remaining--

      // Check for auto-escalation: conflict that's been active > 5 turns
      // without de-escalation should intensify, not fade
      const age = state.turnCount - c.createdAt
      if (age >= 5 && !c.escalatedAt && c.intensity < 0.9) {
        c.intensity = clamp(c.intensity + 0.10, 0, 1.0)
        c.escalatedAt = state.turnCount
        escalated.push(c)
      }
    }

    // Auto-resolve ONLY if: lifespan expired AND not locked
    // AND tension is well above floor (don't resolve if it would drop below floor)
    const toResolve = state.activeConflicts.filter(c =>
      c.lifespan.remaining <= 0 && !c.locked
    )

    for (const c of toResolve) {
      // Check: would resolving this drop tension below floor?
      const tensionAfterResolve = state.tensionLevel - c.intensityBoost
      if (tensionAfterResolve >= state.tensionFloor) {
        state.tensionLevel = clamp(tensionAfterResolve, 0, 1.0)
        c.resolvedAt = state.turnCount
        resolved.push(c)
        state.conflictHistory.push(c)
      }
      // else: keep it alive even though lifespan expired — tension floor protects it
    }

    // Remove resolved from active
    state.activeConflicts = state.activeConflicts.filter(c => !c.resolvedAt)

    // Enforce tension floor
    this.enforceFloor(state)

    state.lastUpdated = Date.now()
    return {
      changed: resolved.length > 0 || escalated.length > 0,
      resolved,
      escalated,
    }
  },

  /**
   * Enforce the tension floor. If tension drops below minimum,
   * inject a latent conflict to keep the world unstable.
   */
  enforceFloor(state) {
    if (state.tensionLevel < state.tensionFloor) {
      // Inject latent tension — the world remembers
      state.tensionLevel = state.tensionFloor

      // Add a latent conflict if none are active
      if (state.activeConflicts.length === 0) {
        state.activeConflicts.push({
          id: 'c_latent_' + Date.now(),
          type: 'LATENT_TENSION',
          sourceEvent: '底层关系张力',
          actor: 'system',
          target: 'user',
          intensity: state.tensionFloor,
          intensityBoost: 0.10,
          lifespan: { remaining: 999, initial: 999 },
          locked: true,
          createdAt: state.turnCount,
          escalatedAt: null,
          deescalatedAt: null,
          emotion: 'cold',
          resolutionBlocked: true,
          isLatent: true,
        })
      }
    }
  },

  /**
   * Attempt to resolve a specific conflict.
   * ONLY allowed if:
   *   - lifespan has expired (remaining <= 0)
   *   - NOT locked
   *   - resolution won't drop tension below floor
   *   - user explicitly pushed for resolution
   *
   * @returns {boolean} whether resolution was allowed
   */
  tryResolve(state, conflictId) {
    const c = state.activeConflicts.find(c => c.id === conflictId)
    if (!c) return false

    // Block resolution if still locked or lifespan not expired
    if (c.locked || c.lifespan.remaining > 0) {
      return false
    }

    // Check tension floor
    const tensionAfter = state.tensionLevel - c.intensityBoost
    if (tensionAfter < state.tensionFloor) {
      // Cannot resolve — must introduce new conflict first
      return false
    }

    state.tensionLevel = clamp(tensionAfter, 0, 1.0)
    c.resolvedAt = state.turnCount
    state.conflictHistory.push(c)
    state.activeConflicts = state.activeConflicts.filter(x => x.id !== conflictId)

    // Enforce floor after resolution
    this.enforceFloor(state)

    return true
  },

  /**
   * Escalate a conflict — increase its intensity and reset its lifespan.
   */
  escalate(state, conflictId) {
    const c = state.activeConflicts.find(c => c.id === conflictId)
    if (!c) return false

    c.intensity = clamp(c.intensity + 0.15, 0, 1.0)
    c.lifespan.remaining = Math.max(c.lifespan.remaining, c.lifespan.initial)
    c.escalatedAt = state.turnCount
    state.tensionLevel = clamp(state.tensionLevel + 0.10, 0, 1.0)

    return true
  },

  /**
   * Check if any conflict is actively blocking resolution.
   */
  hasActiveConflicts(state) {
    return state.activeConflicts.filter(c => c.resolutionBlocked).length > 0
  },

  /**
   * Get conflicts that MUST persist this turn (locked + lifespan > 0).
   */
  getPersistentConflicts(state) {
    return state.activeConflicts.filter(c => c.locked || c.lifespan.remaining > 0)
  },

  /**
   * Get summary for prompt injection.
   */
  summary(state) {
    if (state.activeConflicts.length === 0) return null

    return {
      tensionLevel: state.tensionLevel,
      activeCount: state.activeConflicts.length,
      persistentCount: this.getPersistentConflicts(state).length,
      conflicts: state.activeConflicts.map(c => ({
        type: c.type,
        source: c.sourceEvent,
        intensity: c.intensity,
        turnsRemaining: c.lifespan.remaining,
        locked: c.locked,
        canResolve: c.lifespan.remaining <= 0 && !c.locked,
        age: state.turnCount - c.createdAt,
      })),
    }
  },
}

// ═══════════════════════════════════════════════════════════
// 2. Persistence Lock Layer — prompt injection
// ═══════════════════════════════════════════════════════════

/**
 * Build the PERSISTENCE RULES prompt block.
 * This tells the LLM that conflicts have INERTIA and cannot be
 * dissolved instantly.
 */
export function buildPersistenceLockPrompt(conflictState) {
  if (!conflictState || conflictState.activeConflicts.length === 0) {
    return buildPersistenceLockBaseline()
  }

  const activeConflicts = ConflictStateEngine.getPersistentConflicts(conflictState)
  const tensionPct = Math.round(conflictState.tensionLevel * 100)

  const conflictLines = activeConflicts.map(c => {
    const age = conflictState.turnCount - c.createdAt
    const remaining = c.lifespan.remaining
    return (
      '• ' + c.sourceEvent +
      ' [强度' + Math.round(c.intensity * 100) + '%' +
      ' | 已持续' + age + '轮' +
      ' | 至少还需' + remaining + '轮才可考虑降级' +
      ' | ' + (c.locked ? '🔒锁定——不可在输出中解决' : '可降级但不可消失') +
      ']'
    )
  })

  return [
    '【PERSISTENCE LOCK LAYER——冲突持续锁，最高优先级】',
    '',
    '当前全局张力：' + tensionPct + '%（最低底线：' + Math.round(conflictState.tensionFloor * 100) + '%）',
    '活跃冲突数：' + activeConflicts.length + '个（其中' + activeConflicts.filter(c => c.locked).length + '个锁定）',
    '',
    '以下冲突处于 ACTIVE 状态，受持续性保护：',
    conflictLines.join('\n'),
    '',
    '━━━ 持续性铁律（违反 = 重写）━━━',
    '1. 上述冲突在本轮回复中不允许被解决、和解、翻篇、淡化',
    '2. 冲突只能通过"行为升级"或"用户主动介入"改变——不能通过角色解释/道歉/合理化来消解',
    '3. 锁定冲突（🔒）绝对不可在本轮被解除——角色甚至不能朝那个方向迈出一步',
    '4. 冲突强度不可在本轮降低——可以暂停（沉默/回避），但强度不变',
    '5. 每轮回复结束后，冲突状态必须与回复前相比：一样强或更强',
    '6. 如果输出中出现了任何"冲突缓解"的信号 → 重写',
    '',
    '━━━ 禁止的消解行为 ━━━',
    '× 角色主动道歉/示好/解释动机/寻求理解',
    '× 用现实原因（钱/时间/条件/为你好）软化冲突',
    '× 角色内心独白"其实我也不想这样""我也很难受"',
    '× 角色做出让步姿态（叹气/低头/语气放软/转移话题）',
    '× 场景气氛从紧张转向平静/温馨/日常',
    '× 角色单方面结束对峙（转身走/挂电话/睡觉/离开）',
  ].join('\n')
}

/**
 * Baseline persistence rules — used when no active conflicts.
 * Still enforces the general principle that tension shouldn't dissolve.
 */
function buildPersistenceLockBaseline() {
  return [
    '【PERSISTENCE LOCK LAYER——冲突持续锁，基线模式】',
    '',
    '当前无活跃锁定冲突，但持续性铁律仍然生效：',
    '',
    '1. 任何新产生的冲突必须至少持续 3 轮才可考虑降级',
    '2. 冲突不可被解释/道歉/合理化所消解',
    '3. 关系张力不可在本轮归零或接近归零',
    '4. 角色不可主动修复关系或寻求和解',
    '5. 如果上一轮有冲突，本轮冲突强度不可低于上一轮的 80%',
  ].join('\n')
}

// ═══════════════════════════════════════════════════════════
// 3. Conflict Memory Lock — prevents forgetting
// ═══════════════════════════════════════════════════════════

/**
 * Lock conflicts into the memory graph so they cannot be forgotten
 * or naturally decayed by the LLM's context window.
 *
 * This integrates with the Memory Graph to persist conflict state.
 */
export function buildConflictMemoryLockPrompt(conflictState) {
  if (!conflictState || conflictState.conflictHistory.length === 0) return ''

  const historyLines = conflictState.conflictHistory.slice(-5).map(c =>
    '• ' + c.sourceEvent + '（' + c.type + '，已持续' +
    (c.resolvedAt - c.createdAt) + '轮后由用户推动解决）'
  )

  return [
    '【CONFLICT MEMORY LOCK——冲突记忆锁，禁止遗忘】',
    '',
    '以下冲突已经发生并成为角色关系的一部分。即使已解决，',
    '其影响仍在。角色的行为必须反映这些历史：',
    historyLines.join('\n'),
    '',
    '⚠️ 冲突的记忆不能被抹除。角色不能表现得"什么都没发生过"。',
    '已解决的冲突 → 留下疤痕、不信任、距离感。',
    '这些是角色的关系底色，不可忽略。',
  ].join('\n')
}

// ═══════════════════════════════════════════════════════════
// 4. Behavior Override — conflict-active mode
// ═══════════════════════════════════════════════════════════

/**
 * When conflicts are active, behavior MUST override explanation.
 * This is the prompt-level enforcement.
 */
export function buildBehaviorOverridePrompt(conflictState) {
  const hasActive = conflictState && ConflictStateEngine.hasActiveConflicts(conflictState)

  if (!hasActive) {
    // Light version — still blocks explanation in general
    return [
      '【BEHAVIOR OVERRIDE——行为优先模式】',
      '',
      '即使无活跃冲突：',
      '• 情绪通过行为表达，不通过语言解释',
      '• 身体动作 ≥ 心理描述',
      '• 任何"因为/其实/感到/觉得"引导的句子 → 删除，换行为',
    ].join('\n')
  }

  return [
    '【BEHAVIOR OVERRIDE——冲突状态下行为强制模式】',
    '',
    '⚠️ 当前有活跃冲突。以下规则覆盖所有叙事习惯：',
    '',
    '1. 禁止解释行为原因——不写"因为……""原因是……"',
    '2. 禁止缓和关系——不写"其实我……""我也不想……"',
    '3. 禁止情绪总结——不写"他感到……""她意识到……"',
    '4. 必须输出行为变化：',
    '   · 冷淡 → 不看/不应/擦肩而过当空气',
    '   · 控制 → 堵/拽/拦/下通牒/剥夺选择',
    '   · 回避 → 退后但不走/沉默但存在/已读不回',
    '   · 对抗 → 逼问/揭短/翻旧账/当众拆台',
    '5. 每一句心理描述 → 换成一个身体动作',
    '6. 每一段解释 → 换成一个互动行为',
    '',
    '自检：如果删掉所有"解释/心理/理由"句子，角色还做了什么？',
    '什么都没做 → 重写。',
  ].join('\n')
}

// ═══════════════════════════════════════════════════════════
// 5. Tension Floor System
// ═══════════════════════════════════════════════════════════

/**
 * The world must never be fully calm. There's always background tension.
 */
export const TensionFloor = {
  min: 0.60,          // Absolute minimum global tension
  defaultFloor: 0.60,

  /**
   * Enforce the tension floor on a conflict state.
   * If tension is below floor, inject latent conflict.
   */
  enforce(state) {
    if (!state) return
    ConflictStateEngine.enforceFloor(state)
  },

  /**
   * Build the tension floor prompt block.
   */
  buildPrompt(conflictState) {
    const currentTension = conflictState?.tensionLevel ?? 0.60
    const floor = conflictState?.tensionFloor ?? TensionFloor.min
    const tensionPct = Math.round(currentTension * 100)
    const floorPct = Math.round(floor * 100)

    return [
      '【TENSION FLOOR SYSTEM——张力底线系统】',
      '',
      '全局关系张力底线：' + floorPct + '%',
      '当前张力：' + tensionPct + '%' + (tensionPct < floorPct ? ' ⚠️ 低于底线！' : ''),
      '',
      '规则：',
      '• 世界永远不完全平静——底线以上的张力是必须维持的',
      '• 如果张力低于底线 → 必须通过角色行为（非语言）推高张力',
      '• 角色不能让场景气氛归于"平静/温馨/日常/正常"',
      '• 即使表面安静，底层暗流必须存在（谁在忍耐、谁在谋划、谁在等时机）',
      '• "他们度过了平静的一天" → 这种叙事在本系统是违规的',
    ].join('\n')
  },
}

// ═══════════════════════════════════════════════════════════
// 6. Combined CPS Injection
// ═══════════════════════════════════════════════════════════

/**
 * Build the complete CPS prompt injection block.
 * This is the single function to call from buildGMPrompt / sendStoryStageMessage.
 *
 * @param {object} conflictState - from ConflictStateEngine.create()
 * @returns {string} complete CPS prompt block
 */
export function buildCPSInjection(conflictState) {
  const state = conflictState || ConflictStateEngine.create()

  return [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '【CONFLICT PERSISTENCE SYSTEM——冲突持续系统】',
    '核心原则：冲突不是事件，是持续状态。',
    '冲突有惯性 → 不可即时结算。',
    '冲突不可被解释消解 → 不可合理化。',
    '冲突必须跨轮存在 → 持续性 > 叙事闭合。',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    buildPersistenceLockPrompt(state),
    '',
    buildBehaviorOverridePrompt(state),
    '',
    TensionFloor.buildPrompt(state),
  ].join('\n')
}

// ═══════════════════════════════════════════════════════════
// 7. Integration helpers
// ═══════════════════════════════════════════════════════════

/**
 * Load or create a conflict state from localStorage.
 */
export function loadConflictState(characterId, saveId) {
  const key = 'jsjg_cps_' + (saveId ? saveId + '_' : '') + characterId
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.activeConflicts) {
        return parsed
      }
    }
  } catch {}
  return ConflictStateEngine.create()
}

/**
 * Save conflict state to localStorage.
 */
export function saveConflictState(characterId, saveId, state) {
  const key = 'jsjg_cps_' + (saveId ? saveId + '_' : '') + characterId
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {}
}

/**
 * Update conflict state from Memory Graph events.
 * Call this after extractEvents + updateGraph.
 *
 * @param {object} cpsState - conflict state from CPS
 * @param {Array} events - extracted events from eventExtractor
 * @param {object} options - { turnNumber }
 */
export function updateCPSFromEvents(cpsState, events, options = {}) {
  if (!cpsState || !events || events.length === 0) return cpsState

  for (const e of events) {
    // Register conflicts from relationship-changing events
    if (e.type === 'CONFLICT_EVENT' || e.type === 'CONTROL_ATTEMPT' ||
        e.type === 'EMOTIONAL_SPIKE' || e.type === 'REVELATION') {
      ConflictStateEngine.register(cpsState, e, {
        minLifespan: e.type === 'EMOTIONAL_SPIKE' ? 5 : e.type === 'REVELATION' ? 4 : 3,
        intensity: e.intensity || 0.7,
        locked: true,
      })
    }

    // RELATIONSHIP_CHANGE with negative affection also registers
    if (e.type === 'RELATIONSHIP_CHANGE' && e.delta?.affection < 0) {
      ConflictStateEngine.register(cpsState, e, {
        minLifespan: 2,
        intensity: 0.5 + Math.abs(e.delta.affection) * 0.1,
        locked: Math.abs(e.delta.affection) >= 2,
      })
    }
  }

  // Advance state by one turn
  ConflictStateEngine.advance(cpsState)

  return cpsState
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function mapEventToConflictType(event) {
  const type = event.type || ''
  const intent = event.intent || ''
  const emotion = event.emotion || ''

  if (type === 'CONFLICT_EVENT') {
    if (emotion === 'anger') return 'CONFRONTATION'
    return 'CONFLICT'
  }
  if (type === 'CONTROL_ATTEMPT') return 'CONTROL_CLASH'
  if (type === 'EMOTIONAL_SPIKE') return 'EMOTIONAL_EXPLOSION'
  if (type === 'REVELATION') return 'BETRAYAL'
  if (type === 'DIALOGUE_INTENT') {
    if (intent === 'interrogation' || intent === 'accusation') return 'CONFRONTATION'
    if (intent === 'threat' || intent === 'ultimatum') return 'CONTROL_CLASH'
    if (intent === 'provocation') return 'CONFRONTATION'
    if (intent === 'territory_marking') return 'JEALOUSY_TRIGGER'
  }
  if (type === 'RELATIONSHIP_CHANGE' && event.delta?.affection < 0) {
    return 'RELATIONSHIP_STRAIN'
  }
  return 'LATENT_TENSION'
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}
