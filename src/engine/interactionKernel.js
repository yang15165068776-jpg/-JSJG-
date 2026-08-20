/**
 * Interaction Kernel v1 — 剧情交互内核
 *
 * 统一管理：
 *   1. 剧情状态 — messages[], opening scene, branching context
 *   2. 好感系统 — 自动变化 + 手动 ±2 + AI 反馈写入 USK
 *   3. 消息系统 — add / edit / delete / rollback / compress
 *   4. 行为系统 — token usage, event triggers, AI decision hooks
 *
 * 设计原则：
 *   - Singleton object（与 NavigationEngine / HydrationEngine 一致）
 *   - 不依赖 React，返回 state snapshot
 *   - 通过 stateBridge 操作 USK（不绕过桥接层）
 *   - 通过 folderStore 持久化消息
 *   - 通过 HydrationEngine 缓存导航恢复
 */

import {
  initBridgeForFolder,
  getFolderUIState,
  getRawFolderUSK,
  dramaTurnEnd,
  dailyTurnEnd,
} from '../state/stateBridge'
import {
  getFolder,
  getOrCreateDefaultSave,
  getSaveMessages,
  saveSaveMessages,
  getSaveStats,
  saveSaveStats,
} from '../state/folderStore'
import { HydrationEngine } from './hydrationEngine'
import { AgentDecisionLayer } from './agentDecisionLayer'
import { AntiSmoothingV2 } from '../runtime/antiSmoothingV2'
import { runAgentTurn, resetAgentTurn } from '../agents/coordinator'
import { judgeAffectionDelta } from '../utils/deepseek'
import { shouldTriggerAffectionJudge } from '../runtime/affectionTrigger'
import { StabilityCompiler } from '../runtime/stabilityCompiler'
import { MemoryInterpreter, DualViewMemory } from '../memory/memoryInterpreter'
import { CausalEngine } from '../runtime/causalEngine'
import { DramaOrchestrator, syncConflictGraph } from '../runtime/dramaOrchestrator'
import { decideDarkActionLevel, trackLevel, getAntiAveragingOverride } from '../runtime/darkActionKernel'
import { decideDesireLevel, trackDesireLevel, getDesireAntiAveragingOverride } from '../runtime/desireKernel'
import { AgencyEngine } from '../runtime/agencyEngine'
import { RelationshipPhysics } from '../runtime/relationshipPhysics'
import { AutonomousWorldEngine } from '../runtime/autonomousWorldEngine'
import { loadLedger, saveLedger, seedIdentityFacts, extractTurnFacts, buildLedgerBlock, enforceSceneContinuity, reconstructSceneStateFromMessages } from '../runtime/factLedger'
import { buildConstitution } from '../runtime/characterConstitution'
import { EventGraph } from '../runtime/eventGraph'
import { RuntimeOrchestrator } from '../runtime/runtimeOrchestrator'
import { ensureCharacterPrefix } from '../prompt/characterPrefix'

function _detectDarkColor(character) {
  if (!character) return false
  const texts = []
  if (character.background) texts.push(character.background)
  if (character.personality) texts.push(character.personality)
  if (character.storyTone) texts.push(character.storyTone)
  const rcList = character.romanceCharacters || []
  for (const rc of rcList) {
    if (rc.background) texts.push(rc.background)
    if (rc.personality) texts.push(rc.personality)
  }
  const combined = texts.join(' ').toLowerCase()
  const darkKw = ['傲娇', '毒舌', '清冷', '偏执', '疯批', '恶劣', '堕落', '花心', '城府深', '报复', '冷漠', '腹黑', '霸道', '强势', '冷酷', '邪魅', '病娇', '阴郁', '暴戾', '放荡', '高冷', '玩世不恭', '纨绔', '无情', '嗜血', '残忍', '阴沉', '孤僻', '控制欲', '占有欲强']
  const warmKw = ['温柔', '善良', '阳光', '单纯', '软萌', '小天使', '体贴', '治愈', '温暖', '乖巧', '可爱', '纯真', '柔和', '和善', '暖心', '元气', '开朗', '天真', '温润', '谦和', '正直', '赤诚', '热心']
  const darkHits = darkKw.filter(kw => combined.includes(kw)).length
  const warmHits = warmKw.filter(kw => combined.includes(kw)).length
  return darkHits > 0 && warmHits === 0
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function generateMsgId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
}

// ═══════════════════════════════════════════════════════════
// Interaction Kernel
// ═══════════════════════════════════════════════════════════

export const InteractionKernel = {

  // ── State ──────────────────────────────────────────

  state: {
    folderId: null,
    mode: null,
    saveId: null,
    messages: [],
    affection: 50,
    affections: {},
    affectionFlash: null,
    tension: 30,
    compiledPersona: null,
    scene: null,           // DramaOrchestrator scene state
    lifecycle: {
      turnCount: 0,
      passiveTurns: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCacheHitTokens: 0,
      totalCacheMissTokens: 0,
    },
    _initialized: false,
    _nrs: null,  // NRS instance — created lazily on first turn
  },

  // ═══════════════════════════════════════════════════
  // 1. Lifecycle
  // ═══════════════════════════════════════════════════

  /**
   * Initialize the kernel for a folder session.
   *
   * Priority:
   *   1. HydrationEngine cache (back-navigation recovery)
   *   2. folderStore save (localStorage persistence)
   *   3. Opening scene injection (fresh start)
   *
   * @param {string} folderId
   * @param {object[]} characters — folderChars for this session
   * @param {'drama'|'daily'} mode
   * @param {object|null} hydrateData — cached { messages, usk } from HydrationEngine
   * @returns {object} state snapshot { messages, affection, tension, saveId, affections }
   */
  init(folderId, characters, mode, hydrateData, saveId) {
    this.reset()
    // Reset coordinator world state so old folder's affection doesn't leak in
    resetAgentTurn()
    this.state.folderId = folderId
    this.state.mode = mode

    // ── Resolve saveId BEFORE loading cache/USK ──
    const activeSaveId = saveId || (getOrCreateDefaultSave(folderId)?.id)
    this.state.saveId = activeSaveId || null

    // ── Load messages (save-isolated cache key: folderId + saveId + mode) ──
    const cached = hydrateData || HydrationEngine.get(folderId, activeSaveId, mode)
    let messages = []

    if (cached && cached.messages && cached.messages.length > 0) {
      messages = cached.messages
    } else if (activeSaveId) {
      messages = getSaveMessages(activeSaveId, folderId, mode === 'drama' ? 'drama' : 'daily')
      }

    // v9: No opening message injection — DramaPage auto-triggers first turn

    this.state.messages = messages

    // ── Load per-save lifecycle stats (turn count + token usage) ──
    if (activeSaveId) {
      const savedStats = getSaveStats(activeSaveId, folderId, mode === 'drama' ? 'drama' : 'daily')
      if (savedStats) {
        this.state.lifecycle.turnCount = savedStats.turnCount || 0
        this.state.lifecycle.totalPromptTokens = savedStats.promptTokens || 0
        this.state.lifecycle.totalCompletionTokens = savedStats.completionTokens || 0
        this.state.lifecycle.totalCacheHitTokens = savedStats.cacheHitTokens || 0
        this.state.lifecycle.totalCacheMissTokens = savedStats.cacheMissTokens || 0
      }
    }

    // ── Init USK ──
    const charsForUSK = (characters || []).map(c => ({
      id: c.name || c.id,
      name: c.name || '',
      affectionInitial: c.affectionInitial ?? 50,
    }))
    initBridgeForFolder(folderId, charsForUSK, mode, this.state.saveId)

    // ── Fresh session: override USK with character's affectionInitial ──
    // If no messages exist (beyond opening), the user's character settings
    // should take priority over stale USK values from previous sessions.
    const hasOnlyOpening = messages.every(m => m.isOpening)
    if (messages.length === 0 || hasOnlyOpening) {
      for (const c of characters) {
        const name = c.name || c.id
        if (name && c.affectionInitial != null) {
          const charState = getFolderUIState(name)
          if (charState && charState.relationship) {
            // Write the character's configured initial affection into USK
            const currentUSK = getRawFolderUSK()
            if (currentUSK?.characters?.[name]) {
              currentUSK.characters[name].relationship.affection = c.affectionInitial
            }
          }
        }
      }
    }

    // ── Sync affection / tension from USK ──
    const mainChar = characters[0]
    if (mainChar) {
      const lookupKey = mainChar.name || mainChar.id
      const uiState = getFolderUIState(lookupKey)
      if (uiState) {
        const rawAff = uiState.relationship?.affection
        // 0 is a valid value, but null/undefined/NaN means uninitialized
        this.state.affection = (rawAff != null && !isNaN(rawAff)) ? rawAff : (mainChar.affectionInitial ?? 50)
        this.state.tension = uiState.tension?.unresolved_conflicts ?? 30
      } else {
        // Character not found in USK — fall back to character config
        this.state.affection = mainChar.affectionInitial ?? 50
        console.warn('[init] ⚠️ 角色「' + (lookupKey || '(无名)') + '」在 USK 中未找到，好感度使用配置默认值：' + this.state.affection)
      }
    }

    // ── Build initial affections map ──
    const affMap = {}
    for (const c of characters) {
      const name = c.name || c.id
      if (name) {
        const charState = getFolderUIState(name)
        const rawAff = charState?.relationship?.affection
        affMap[name] = (rawAff != null && !isNaN(rawAff)) ? rawAff : (c.affectionInitial ?? 50)
      }
    }
    this.state.affections = affMap

    // ── Compile character personality ──
    if (mainChar) {
      this.state.compiledPersona = StabilityCompiler.compile(mainChar)
    }

    // ── Drama Orchestrator v1: init scene state ──
    if (mode === 'drama' && mainChar) {
      const folderData = getFolder(folderId)
      this.state.scene = DramaOrchestrator.initScene(mainChar, folderData)
    }

    // ── 🌍 Autonomous World Engine v1: init world + all sub-engines ──
    if (mode === 'drama' && mainChar) {
      AutonomousWorldEngine.init(mainChar, this.state.affections)
    }

    // ── 🔒 Fact Ledger v2: load + seed identity facts ──
    const charId = mainChar?.id || mainChar?.name || folderId
    this.state._ledger = loadLedger(charId, this.state.saveId)
    if (mainChar) {
      seedIdentityFacts(this.state._ledger, mainChar, mainChar._playerProfile)
      // 🔥 v9 fix: Reconstruct scene state from message history on re-entry
      // This ensures physical state (e.g. naked/clothed) survives save reload
      if (messages.length > 0) {
        const charNames = characters.map(c => c.name || c.id).filter(Boolean)
        reconstructSceneStateFromMessages(this.state._ledger, messages, charNames)
      }
      saveLedger(charId, this.state.saveId, this.state._ledger)
    }

    // ── 📊 Event Graph v1: init structured event nodes ──
    if (mode === 'drama' && mainChar) {
      EventGraph.init(mainChar)
    }

    this.state._initialized = true
    return this.getState()
  },

  /**
   * Reset all kernel state to defaults.
   */
  reset() {
    this.state.folderId = null
    this.state.mode = null
    this.state.saveId = null
    this.state.messages = []
    this.state.affection = 50
    this.state.affections = {}
    this.state.affectionFlash = null
    this.state.tension = 30
    this.state.compiledPersona = null
    this.state._ledger = null
    this.state._initialized = false
    this.state.lifecycle = {
      turnCount: 0,
      passiveTurns: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCacheHitTokens: 0,
      totalCacheMissTokens: 0,
    }
    // 🔒 Reset all in-memory engines — prevents cross-save state leak
    try { AutonomousWorldEngine.reset() } catch {}
    try { EventGraph.reset() } catch {}
    try { AgencyEngine.reset() } catch {}
    try { RelationshipPhysics.reset() } catch {}
  },

  // ═══════════════════════════════════════════════════
  // 2. Message System
  // ═══════════════════════════════════════════════════

  /**
   * Append a user message and auto-save.
   * @returns {object[]} updated messages array
   */
  addUserMessage(content) {
    const msg = {
      id: generateMsgId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    this.state.messages.push(msg)
    this._autoSave()
    return this.state.messages
  },

  /**
   * Append an assistant message, track token usage, auto-save.
   * @returns {object[]} updated messages array
   */
  addAssistantMessage(reply, reasoningContent, usage) {
    const msg = {
      id: generateMsgId(),
      role: 'assistant',
      content: reply,
      reasoningContent: reasoningContent || null,
      usage: usage || null,
      timestamp: Date.now(),
    }
    this.state.messages.push(msg)
    if (usage) this._trackUsage(usage)
    this._autoSave()
    return this.state.messages
  },

  /**
   * Find the index of the last user message.
   * @returns {number} index or -1
   */
  _lastUserIndex() {
    for (let i = this.state.messages.length - 1; i >= 0; i--) {
      if (this.state.messages[i].role === 'user') return i
    }
    return -1
  },

  /**
   * Get the last user message with its index (for edit flow).
   * @returns {{ content: string, _index: number } | null}
   */
  getLastUserMessage() {
    const idx = this._lastUserIndex()
    if (idx === -1) return null
    return {
      content: this.state.messages[idx].content,
      _index: idx,
    }
  },

  /**
   * Truncate messages to remove everything from the last user message onward.
   * Used before edit: truncates the last user msg + assistant response,
   * then caller prompts for new text and re-sends.
   * @returns {object[]} truncated messages (before the last user message)
   */
  truncateBeforeLastUser() {
    const idx = this._lastUserIndex()
    if (idx === -1) return this.state.messages
    this.state.messages = this.state.messages.slice(0, idx)
    this._autoSave()
    return this.state.messages
  },

  /**
   * Delete the last user+assistant pair.
   * @returns {object[]} updated messages
   */
  deleteLastPair() {
    const idx = this._lastUserIndex()
    if (idx === -1) return this.state.messages
    this.state.messages = this.state.messages.slice(0, idx)
    this._autoSave()
    return this.state.messages
  },

  /**
   * Rollback messages to a specific index (inclusive).
   * @param {number} index — truncate at this position (keep messages before it)
   * @returns {object[]} updated messages
   */
  rollbackTo(index) {
    if (index < 0) {
      this.state.messages = []
    } else {
      this.state.messages = this.state.messages.slice(0, index + 1)
    }
    this._autoSave()
    return this.state.messages
  },

  /**
   * Edit a specific message by ID.
   * Immutable messages (opening scene) cannot be edited.
   * @param {string} id
   * @param {string} newContent
   * @returns {boolean} success
   */
  editMessage(id, newContent) {
    const msg = this.state.messages.find(m => m.id === id)
    if (!msg || msg.immutable) return false
    msg.content = newContent
    this._autoSave()
    return true
  },

  /**
   * Delete a specific message by ID.
   * Immutable messages cannot be deleted.
   * @param {string} id
   * @returns {boolean} success
   */
  deleteMessage(id) {
    const msg = this.state.messages.find(m => m.id === id)
    if (msg && msg.immutable) return false
    this.state.messages = this.state.messages.filter(m => m.id !== id)
    this._autoSave()
    return true
  },

  /**
   * Edit a message at a specific array index.
   * @param {number} idx
   * @param {string} newContent
   * @returns {boolean} success
   */
  editMessageAtIndex(idx, newContent) {
    if (idx < 0 || idx >= this.state.messages.length) return false
    const msg = this.state.messages[idx]
    if (msg.immutable) return false
    msg.content = newContent
    this._autoSave()
    return true
  },

  /**
   * Delete a message at a specific array index.
   * @param {number} idx
   * @returns {object[]} updated messages
   */
  deleteMessageAtIndex(idx) {
    if (idx < 0 || idx >= this.state.messages.length) return this.state.messages
    const msg = this.state.messages[idx]
    if (msg.immutable) return false
    this.state.messages.splice(idx, 1)
    this._autoSave()
    return this.state.messages
  },

  /**
   * Find the user message that precedes an assistant message at the given index.
   * Used for "regenerate" — find what the user said to re-trigger the AI.
   * @param {number} assistantIdx
   * @returns {{ content: string, _index: number } | null}
   */
  getUserMsgBefore(assistantIdx) {
    for (let i = assistantIdx - 1; i >= 0; i--) {
      if (this.state.messages[i].role === 'user') {
        return { content: this.state.messages[i].content, _index: i }
      }
    }
    return null
  },

  /**
   * Rollback the last message only.
   */
  rollbackLast() {
    this.state.messages.pop()
    this._autoSave()
    return this.state.messages
  },

  // ═══════════════════════════════════════════════════
  // 3. Compress System (v1 placeholder)
  // ═══════════════════════════════════════════════════

  /**
   * Compress messages into a summary.
   * v1: simple truncation summary. v1.1+: full summarization.
   * @returns {{ summary: string }}
   */
  compressMessages() {
    const allText = this.state.messages
      .map(m => (m.role === 'user' ? '主角' : '角色') + '：' + (m.content || '').slice(0, 100))
      .join('\n')

    return {
      summary: allText.slice(0, 500),
    }
  },

  // ═══════════════════════════════════════════════════
  // 4. Affection System
  // ═══════════════════════════════════════════════════

  /**
   * Apply affection delta (AI-driven, auto-clamped).
   * @param {number} delta
   * @param {object} usk — raw USK reference
   * @returns {number} new affection value
   */
  updateAffection(delta, usk) {
    this.state.affection += delta
    this.state.affection = clamp(this.state.affection, -100, 100)
    return this.state.affection
  },

  /**
   * Manual affection adjust (±2 per user action).
   * Writes through stateBridge to USK for persistence.
   * @param {string} charName
   * @param {number} delta — typically +2 or -2
   * @returns {number} new affection value for this character
   */
  manualAffectionAdjust(charName, delta) {
    const current = this.state.affections[charName] ?? 50
    const newVal = clamp(current + delta, -100, 100)
    this.state.affections[charName] = newVal

    // Write to USK via the existing dramaTurnEnd path
    dramaTurnEnd(charName, {
      turnReport: {
        affectionDeltas: { [charName]: delta },
        npcActions: [],
      },
    })

    // Sync main char affection if applicable
    const mainCharName = Object.keys(this.state.affections)[0]
    if (charName === mainCharName) {
      this.state.affection = newVal
    }

    return newVal
  },

  /**
   * Get affection for a character.
   * @param {string} [charName] — omit for main character scalar
   * @returns {number}
   */
  getAffection(charName) {
    if (!charName) return this.state.affection
    return this.state.affections[charName] ?? 50
  },

  /**
   * Get the full affections map (shallow copy).
   * @returns {object}
   */
  getAffections() {
    return { ...this.state.affections }
  },

  /**
   * @private — take a flat USK snapshot for causal diffing
   */
  _snapshotUSK(charName) {
    const state = getFolderUIState(charName)
    if (!state) return null
    return {
      affection: state.relationship?.affection ?? 50,
      tension: state.tension?.unresolved_conflicts ?? 30,
      dependency: state.relationship?.dependency ?? 30,
      anger: state.emotion?.anger ?? 5,
      jealousy: state.emotion?.jealousy ?? 5,
      trust: state.relationship?.trust ?? 30,
    }
  },

  // ═══════════════════════════════════════════════════
  // 4.5. Agent Decision Layer Bridge
  // ═══════════════════════════════════════════════════

  /**
   * Get the agent's autonomous decision for the current state.
   * Called by UI to know what the character "wants" to do.
   *
   * @returns {object} decision { type, intensity, burst, emotion, reason, urgency }
   */
  getDecision() {
    if (!this.state._initialized) return null
    const mainCharName = Object.keys(this.state.affections)[0]
    if (!mainCharName) return null

    return AgentDecisionLayer.decideFromFolder(
      mainCharName,
      this.state.messages,
      this.state.mode || 'drama',
      this.state.lifecycle.turnCount,
      this.state.lifecycle.passiveTurns,
    )
  },

  /**
   * Increment passive turns counter (called on idle / no user input).
   */
  incrementPassiveTurns() {
    this.state.lifecycle.passiveTurns++
  },

  // ═══════════════════════════════════════════════════
  // 5. Turn Execution (core integration point)
  // ═══════════════════════════════════════════════════

  /**
   * Execute a full turn: user message → AI response → state update → persist.
   *
   * This is the primary integration surface. DramaPage calls this instead of
   * manually orchestrating runAgentTurn + dramaTurnEnd + state sync.
   *
   * @param {string} userText — player input
   * @param {string} apiKey — DeepSeek API key
   * @param {function} onStreamToken — (token, fullText, reset) => void for streaming UI
   * @param {object} character — built LLM character descriptor
   * @param {object} folder — raw folder object (for worldview/story_intro merge context)
   * @returns {Promise<object>} result {
   *   reply, reasoningContent, usage, error,
   *   messages, updatedAffections, affectionFlash,
   *   affection, tension, decision, turnReport, worldState,
   * }
   */
  async executeTurn(userText, apiKey, onStreamToken, character, folder) {
    if (!this.state._initialized) {
      return { error: new Error('InteractionKernel not initialized. Call init() first.') }
    }

    try {
      // 1. Add user message
      const userMsg = {
        id: generateMsgId(),
        role: 'user',
        content: userText,
        timestamp: Date.now(),
      }
      this.state.messages.push(userMsg)
      this.state.lifecycle.turnCount++

      // 2. Get USK snapshot for coordinator + pre-turn state for causal engine
      const usk = getRawFolderUSK()
      const mainCharName = character.name
      const uskBefore = mainCharName
        ? this._snapshotUSK(mainCharName)
        : null

      // 2.5. Run agent decision layer
      const decision = mainCharName
        ? AgentDecisionLayer.decideFromFolder(
            mainCharName,
            this.state.messages,
            this.state.mode || 'drama',
            this.state.lifecycle.turnCount,
            this.state.lifecycle.passiveTurns,
          )
        : null

      // 2.6. Decision-driven behavior
      // SILENT: character refuses to respond → inject system message, skip LLM
      if (decision && decision.type === 'silent') {
        const silentMsg = {
          id: generateMsgId(),
          role: 'system',
          content: `【${mainCharName} 选择了沉默】`,
          silent: true,
          duration: decision.duration || 1,
          timestamp: Date.now(),
        }
        this.state.messages.push(silentMsg)
        this.state.lifecycle.passiveTurns++
        this._autoSave()
        this._saveToHydration()
        return {
          reply: null,
          reasoningContent: null,
          usage: null,
          error: null,
          messages: [...this.state.messages],
          updatedAffections: { ...this.state.affections },
          affectionFlash: null,
          affection: this.state.affection,
          tension: this.state.tension,
          decision,
          silent: true,
          turnReport: null,
          worldState: null,
        }
      }

      // INTERRUPT / EMOTIONAL_BURST: inject pre-turn context
      if (decision && (decision.type === 'interrupt' || decision.type === 'emotional_burst')) {
        const emotionLabel = decision.emotion === 'anger' ? '愤怒' :
                             decision.emotion === 'jealousy' ? '嫉妒' : '激动'
        const interruptCtx = {
          id: generateMsgId(),
          role: 'system',
          content: `【${mainCharName} 情绪${emotionLabel}，${decision.reason}】`,
          interruptCtx: true,
          timestamp: Date.now(),
        }
        this.state.messages.push(interruptCtx)
      }

      // 2.7. Drama Orchestrator v3 — sync conflict graph + advance + director prompt
      if (this.state.scene && this.state.mode === 'drama') {
        const uskState = getFolderUIState(mainCharName)
        const rawUSK = getRawFolderUSK()

        // v3: Sync Conflict Graph from USK before advancing
        if (this.state.scene.conflictGraph && rawUSK?.characters) {
          syncConflictGraph(this.state.scene.conflictGraph, rawUSK.characters, this.state.affections)
        }

        const interactionType = decision?.type === 'emotional_burst' ? 'conflict' :
                               decision?.type === 'silent' ? 'rejection' : null
        const { scene, event } = DramaOrchestrator.advance(this.state.scene, uskState, interactionType)
        this.state.scene = scene
        if (scene) {
          character._sceneContext = DramaOrchestrator.buildDirectorPrompt(scene)
          character._sceneEvent = event
        }
      }

      // 2.8. Stability Compiler — inject compiled constraints into character
      if (this.state.compiledPersona) {
        character._compiledConstraints = StabilityCompiler.buildPromptInjection(this.state.compiledPersona)
        // Validate runtime state against compiled constraints
        const validation = StabilityCompiler.validate(
          {
            softness: (100 - (this.state.tension || 30)) / 100,
            compliance: (50 + (this.state.affection || 50) - (this.state.tension || 30)) / 100,
            conflict: (this.state.tension || 30) / 100,
          },
          this.state.compiledPersona,
        )
        if (!validation.valid) {
          character._stabilityCorrections = validation.corrections
        }
      }

      // 2.X.0. 🧠 Character Prefix — cached identity + stage behavior data
      //   Injected before variable suffix, cached by DeepSeek.
      //   Regenerated only when a character's affection stage changes.
      if (this.state.mode === 'drama') {
        const rawUSK = getRawFolderUSK()
        const uskState = mainCharName ? getFolderUIState(mainCharName) : {}

        // Build affection map from USK for stage detection
        const _affectionMap = {}
        for (const rc of character.romanceCharacters || []) {
          _affectionMap[rc.name] = rawUSK?.characters?.[rc.name]?.relationship?.affection
            ?? rc.affectionInitial ?? 50
        }
        character._characterPrefix = ensureCharacterPrefix(character, _affectionMap)

        // 2.X. 🚀 NOS Runtime Orchestrator — run pre-generation pipeline
        //   INPUT → CCL → NTK → USK → ARSL → EVENTS → CAUSAL → BUILD → RENDER
        RuntimeOrchestrator.runPreGeneration({
          userText,
          character,
          usk: rawUSK,
          uskState,
          ledger: this.state._ledger,
          messages: this.state.messages,
          turnCount: this.state.lifecycle.turnCount,
          decision,
          mainCharName,
          sceneState: this.state.scene,                  // v8.4: ANDS needs scene awareness
          lifecyclePassiveTurns: this.state.lifecycle.passiveTurns,  // v8.4: ANDS needs passivity tracking
        })
      }

      // 2.XX. Call agent coordinator
      const result = await runAgentTurn(
        userText,
        character,
        { ...this.state.affections },
        this.state.messages,
        apiKey,
        onStreamToken,
        usk,
      )

      // 4. Handle error
      if (result.error || !result.reply) {
        this.state.messages.pop()
        return {
          error: result.error || new Error('No reply from coordinator'),
          messages: this.state.messages,
        }
      }

      // 5. Clean reply — strip <affection> XML tags
      let cleanReply = result.reply
      if (typeof cleanReply === 'string') {
        cleanReply = cleanReply.replace(/<affection>[\s\S]*?<\/affection>/g, '').trim()
      }

      // 5.5. Anti-Smoothing v2 — post-process to prevent personality collapse
      if (cleanReply && mainCharName) {
        const uskState = getFolderUIState(mainCharName)
        cleanReply = AntiSmoothingV2.apply(cleanReply, {
          uskState,
          character,
        })
      }

      // 5.6. 🔥 v8.0.1: LLM judge AFTER reply — evaluates the actual interaction
      const turnReport = result.turnReport || {}
      turnReport.affectionDeltas = turnReport.affectionDeltas || {}
      let needsLLM = turnReport.affectionLLMNeeded || []

      // 🔥 v8.5.4 fix: Post-reply trigger — the pre-reply trigger only sees user input.
      // If the AI reply has high-signal emotional content, also run the judge even
      // if the pre-reply trigger didn't fire.
      if (needsLLM.length === 0 && cleanReply && apiKey) {
        const replyTrigger = shouldTriggerAffectionJudge('', cleanReply, this.state.lifecycle.turnCount, 99)
        if (replyTrigger.trigger) {
          needsLLM = Object.keys(this.state.affections).filter(name => {
            const enabled = character.romanceCharacters?.find(rc => rc.name === name)?.affectionEnabled !== false
            return enabled
          })
          if (needsLLM.length > 0) {
            console.log('[executeTurn] Post-reply trigger: AI reply has emotional content, running judge for:', needsLLM.join(', '))
          }
        }
      }

      if (needsLLM.length > 0 && apiKey && cleanReply) {
        console.log('[executeTurn] Post-reply LLM judge needed for:', needsLLM.join(', '))
        try {
          const { changes, error: judgeErr } = await judgeAffectionDelta(
            character, { ...this.state.affections }, userText, cleanReply, apiKey
          )
          let judgeReport = ''
          if (!judgeErr && changes && changes.length > 0) {
            for (const { name, delta } of changes) {
              if (delta !== 0) {
                const before = this.state.affections[name] ?? 50
                this.state.affections[name] = clamp(before + delta, -100, 100)
                turnReport.affectionDeltas[name] = (turnReport.affectionDeltas[name] || 0) + delta
                judgeReport += name + ': ' + (delta > 0 ? '+' : '') + delta + ' (' + before + '→' + this.state.affections[name] + ')\n'
                console.log('[executeTurn] LLM judge delta:', name, delta)
              } else {
                judgeReport += name + ': 0 (不变)\n'
              }
            }
            if (judgeReport) {
              console.log('📊 好感度裁判 · 第' + (turnReport.round || '?') + '轮\n' +
                '裁决角色: ' + needsLLM.join(', ') + '\n\n' + judgeReport)
            }
          } else if (judgeErr) {
            console.warn('❌ 好感度裁判失败\n' + judgeErr)
          } else {
            console.log('📊 好感度裁判 · 第' + (turnReport.round || '?') + '轮\n' +
              '裁决角色: ' + needsLLM.join(', ') + '\n\n所有角色: 0 (不变)')
          }
          if (!result.turnReport) result.turnReport = turnReport
        } catch (judgeErr) {
          console.error('❌ 好感度裁判异常\n' + (judgeErr?.message || judgeErr))
        }
      }

      // 6. Add assistant message + reset passive turns
      const assistantMsg = {
        id: generateMsgId(),
        role: 'assistant',
        content: cleanReply,
        reasoningContent: result.reasoningContent || null,
        usage: result.usage || null,
        timestamp: Date.now(),
      }
      this.state.messages.push(assistantMsg)
      // Character has interacted — reset passive turns
      this.state.lifecycle.passiveTurns = 0

      // 7. Track token usage
      if (result.usage) {
        this._trackUsage(result.usage)
      }

      // 8. Sync affections: start from coordinator base, then merge judge deltas.
      // (Judge deltas were already applied in step 5.6 above.)
      // coordinator's updatedAffections = base affections (no judge since v8.0.1)
      if (result.updatedAffections) {
        for (const [name, val] of Object.entries(result.updatedAffections)) {
          // Only set if not already modified by judge (step 5.6)
          if (!(name in turnReport.affectionDeltas)) {
            this.state.affections[name] = val
          }
        }
      }

      // 9. Build affectionFlash for UI animation
      let affectionFlash = null
      // turnReport already declared above (step 5.6)
      if (turnReport.affectionDeltas) {
        const deltas = {}
        for (const [name, delta] of Object.entries(turnReport.affectionDeltas)) {
          if (delta !== 0) deltas[name] = delta
        }
        if (Object.keys(deltas).length > 0) {
          affectionFlash = deltas
          this.state.affectionFlash = deltas
        }
      }

      // 10. Write affection deltas + NPC actions to USK via stateBridge
      if (mainCharName) {
        dramaTurnEnd(mainCharName, result)
      }

      // 11. Sync affection / tension from USK back into kernel (all chars)
      if (mainCharName) {
        const uiState = getFolderUIState(mainCharName)
        if (uiState) {
          const rawAff = uiState.relationship?.affection
          if (rawAff != null && !isNaN(rawAff)) {
            this.state.affection = rawAff
          }
          this.state.tension = uiState.tension?.unresolved_conflicts ?? this.state.tension
        }
        // Also re-sync all character affections from USK (SSOT)
        for (const charName of Object.keys(this.state.affections)) {
          const charState = getFolderUIState(charName)
          if (charState?.relationship?.affection != null && !isNaN(charState.relationship.affection)) {
            this.state.affections[charName] = charState.relationship.affection
          }
        }
      }

      // 11.5. Causal Narrative Engine — explain WHY changes happened
      const mode = this.state.mode || 'drama'
      const uskAfter = mainCharName ? this._snapshotUSK(mainCharName) : null
      const causalAnalysis = (uskBefore && uskAfter)
        ? CausalEngine.analyze(uskBefore, uskAfter, mode, { characterName: mainCharName, userText })
        : null

      // 11.6. Memory Interpretation — record + dual-view
      const uskContext = mainCharName ? getFolderUIState(mainCharName) : null
      const interpretation = MemoryInterpreter.interpretTurn(
        { role: 'user', content: userText },
        { role: 'assistant', content: cleanReply },
        mode,
        { uskState: uskContext, turnCount: this.state.lifecycle.turnCount, character },
      )
      // Store in dual-view memory for cross-mode consistency
      DualViewMemory.record(
        { role: 'user', content: userText },
        { role: 'assistant', content: cleanReply },
        { uskState: uskContext, turnCount: this.state.lifecycle.turnCount, character },
      )

      // 12. 📊 Event Graph — record turn events into structured nodes
      EventGraph.processTurn(userText, cleanReply, {
        characterNames: Object.keys(this.state.affections),
      })

      // 13. 🔒 Fact Ledger — extract new facts from this turn
      if (this.state._ledger && cleanReply) {
        // Must match the charId used in init() for loadLedger:
        // init uses mainChar?.id || mainChar?.name || folderId
        const charId = (character && (character.id || character.name)) || this.state.folderId
        extractTurnFacts(this.state._ledger, userText, cleanReply, {
          playerName: mainCharName || '玩家',
          characterNames: Object.keys(this.state.affections),
        })
        saveLedger(charId, this.state.saveId, this.state._ledger)
      }

      // 14. Persist
      this._autoSave()
      this._saveToHydration()

      // 13. Return result snapshot
      return {
        reply: cleanReply,
        reasoningContent: result.reasoningContent || null,
        usage: result.usage || null,
        error: null,
        messages: [...this.state.messages],
        updatedAffections: { ...this.state.affections },
        affectionFlash,
        affection: this.state.affection,
        tension: this.state.tension,
        decision,
        interpretation,
        causalAnalysis,
        silent: false,
        turnReport: result.turnReport || null,
        worldState: result.worldState || null,
        qualityIssues: result.qualityIssues || [],
        systemErrors: result.systemErrors || [],
      }
    } catch (err) {
      // Remove orphaned user message on exception
      const lastMsg = this.state.messages[this.state.messages.length - 1]
      if (lastMsg && lastMsg.role === 'user' && lastMsg.content === userText) {
        this.state.messages.pop()
      }
      return {
        error: err,
        messages: [...this.state.messages],
      }
    }
  },

  // ═══════════════════════════════════════════════════
  // 6. Token Tracking
  // ═══════════════════════════════════════════════════

  /** @private */
  _trackUsage(usage) {
    if (!usage) return
    this.state.lifecycle.totalPromptTokens += usage.prompt_tokens || 0
    this.state.lifecycle.totalCompletionTokens += usage.completion_tokens || 0
    this.state.lifecycle.totalCacheHitTokens += usage.prompt_cache_hit_tokens || 0
    this.state.lifecycle.totalCacheMissTokens += usage.prompt_cache_miss_tokens || 0
  },

  /**
   * Set token usage explicitly (e.g., from external source).
   */
  setTokenUsage(usage) {
    if (!usage) return
    this.state.lifecycle.totalPromptTokens = usage.prompt_tokens || 0
    this.state.lifecycle.totalCompletionTokens = usage.completion_tokens || 0
  },

  /**
   * Get accumulated token usage stats.
   * @returns {{ promptTokens, completionTokens, totalTokens, cacheHitTokens, cacheMissTokens, cacheHitRate, turnCount }}
   */
  getTokenUsage() {
    const lc = this.state.lifecycle
    const cacheTotal = lc.totalCacheHitTokens + lc.totalCacheMissTokens
    return {
      promptTokens: lc.totalPromptTokens,
      completionTokens: lc.totalCompletionTokens,
      totalTokens: lc.totalPromptTokens + lc.totalCompletionTokens,
      cacheHitTokens: lc.totalCacheHitTokens,
      cacheMissTokens: lc.totalCacheMissTokens,
      cacheHitRate: cacheTotal > 0 ? (lc.totalCacheHitTokens / cacheTotal * 100).toFixed(1) + '%' : 'N/A',
      turnCount: lc.turnCount,
    }
  },

  // ═══════════════════════════════════════════════════
  // 7. USK Sync
  // ═══════════════════════════════════════════════════

  /**
   * Sync the kernel's internal state to a USK object.
   * @param {object} usk — USK object to stamp lastInteraction on
   * @returns {object} updated USK
   */
  syncUSK(usk) {
    if (!usk) return usk
    usk.lastInteractionAt = Date.now()
    if (usk.global) {
      usk.global.lastInteractionAt = Date.now()
    }
    return usk
  },

  // ═══════════════════════════════════════════════════
  // 8. Persistence (internal)
  // ═══════════════════════════════════════════════════

  /** @private */
  _autoSave() {
    if (!this.state.saveId || !this.state.folderId) return
    const modeKey = this.state.mode === 'drama' ? 'drama' : 'daily'

    // Persist messages
    saveSaveMessages(this.state.saveId, this.state.folderId, modeKey, this.state.messages)

    // Persist accumulated stats (survives page navigation)
    const lc = this.state.lifecycle
    saveSaveStats(this.state.saveId, this.state.folderId, modeKey, {
      turnCount: lc.turnCount,
      promptTokens: lc.totalPromptTokens,
      completionTokens: lc.totalCompletionTokens,
      cacheHitTokens: lc.totalCacheHitTokens,
      cacheMissTokens: lc.totalCacheMissTokens,
    })

    // Also sync hydration cache so edit/delete/rollback don't create cache staleness
    const usk = getRawFolderUSK()
    HydrationEngine.save(this.state.folderId, this.state.saveId, this.state.mode || 'drama', this.state.messages, usk)
  },

  /** @private */
  _saveToHydration() {
    if (!this.state.folderId) return
    const usk = getRawFolderUSK()
    HydrationEngine.save(this.state.folderId, this.state.saveId, this.state.mode || 'drama', this.state.messages, usk)
  },

  /**
   * Public API: persist current messages to folderStore.
   */
  persistMessages() {
    this._autoSave()
  },

  /**
   * Load messages from a different save slot.
   * @param {string} saveId
   * @returns {object[]} loaded messages
   */
  loadSave(saveId) {
    if (!this.state.folderId) return []
    this.state.saveId = saveId
    const modeKey = this.state.mode === 'drama' ? 'drama' : 'daily'
    this.state.messages = getSaveMessages(saveId, this.state.folderId, modeKey)
    return this.state.messages
  },

  // ═══════════════════════════════════════════════════
  // 9. State Access
  // ═══════════════════════════════════════════════════

  /**
   * Get a full state snapshot (shallow copy of messages/affections).
   * @returns {object} { folderId, mode, saveId, messages, affection, affections,
   *                     affectionFlash, tension, lifecycle, initialized }
   */
  getState() {
    return {
      folderId: this.state.folderId,
      mode: this.state.mode,
      saveId: this.state.saveId,
      messages: [...this.state.messages],
      affection: this.state.affection,
      affections: { ...this.state.affections },
      affectionFlash: this.state.affectionFlash,
      tension: this.state.tension,
      lifecycle: { ...this.state.lifecycle },
      initialized: this.state._initialized,
    }
  },
}
