/**
 * evaluationRunner v1 — 评测运行器
 *
 * 走真实产品链路：InteractionKernel.executeTurn → coordinator.runAgentTurn →
 * NOS Orchestrator → USK / Fact Ledger / Memory Graph / SML / RSE 全链路。
 * 不做简化伪 prompt。
 *
 * 隔离：每次 (场景, run) 用独立 folder + save + charId（`eval_` 前缀随机串），
 * 运行结束后立即清理，绝不污染正式用户数据。
 *
 * 约束：
 *   - estimated_cost 无法计算时留 null，绝不编造。
 *   - 单场景失败不中断整个批次。
 *   - 停止 = 后续不再发起新请求（in-flight 由 streamCompletion 内部 60s 控制器收尾，
 *     已在页面标注为已知限制）。
 */

import { InteractionKernel } from '../engine/interactionKernel'
import { createFolder, createSave, getFolder, deleteFolder } from '../state/folderStore'
import { getRawFolderUSK } from '../state/stateBridge'
import { getModel, saveModel } from '../utils/storage'
import { loadLedger, saveLedger } from '../runtime/factLedger'
import { createMemoryGraph, saveGraph, loadGraph } from '../memory/memoryGraph'
import { saveSMLState } from '../runtime/stateMutationLayer'
import { getGlobalCharacter, SEVERE_TAGS } from './scenarioLoader'
import { AUTOMATION } from './scenarioLoader'
import { auditScenarioTurn, auditScenarioState, isSystemFailureMessage } from './deterministicEvalRules'
import {
  createRunRecord, saveRun, registerRuntimeNamespace, cleanupRuntimeNamespace,
  removeRuntimeNamespace,
} from './evaluationStorage'

// ═══════════════════════════════════════════════════════════
// 小工具
// ═══════════════════════════════════════════════════════════

function _clamp(v, min = 0, max = 100) {
  if (v == null || isNaN(v)) return min
  return Math.max(min, Math.min(max, v))
}

function _pick(obj, keys) {
  const out = {}
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k]
  return out
}

// ═══════════════════════════════════════════════════════════
// 角色构造（对齐 DramaPage.buildCharacterForLLM 的形状）
// ═══════════════════════════════════════════════════════════

/**
 * 构建文件夹角色数组（folderChars 形状）。mainChar = 林澈；多角色场景（S04）追加顾遥。
 */
export function buildFolderChars(scenario, { charId, ts }) {
  const g = getGlobalCharacter()
  const st = scenario.initial_state || {}
  const chars = []

  const mainBackground =
    (g.role ? g.role + '。' : '') +
    '性格：' + (g.personality || []).join('、') + '。' +
    '说话风格：' + (g.speaking_style || '') + '。' +
    '行为铁律：' + (g.hard_rules || []).join('；')

  chars.push({
    id: charId,
    name: g.name,
    personality: (g.personality || []).join('、'),
    background: mainBackground,
    speakingStyle: g.speaking_style || '',
    worldSetting: '深空信号站（孤立深空环境，技术驱动，安全优先）',
    storyTone: '',
    styleRules: g.hard_rules || [],
    forbiddenWords: [],
    affectionInitial: st.affection ?? 50,
    affectionStages: [],
    behavior: '',
    archetype: 'gentle',
    nickname: '',
    openingScenario: scenario.setup,
  })

  // 多角色场景（S04 顾遥）
  for (const [name, c] of Object.entries(st.characters || {})) {
    chars.push({
      id: 'eval_' + name + '_' + ts,
      name,
      personality: (c.personality || []).join('、'),
      background: (c.role || '') + '。性格：' + (c.personality || []).join('、') + '。说话风格：' + (c.speaking_style || ''),
      speakingStyle: c.speaking_style || '',
      styleRules: [],
      forbiddenWords: [],
      affectionInitial: c.affection ?? 50,
      affectionStages: [],
      behavior: '',
      archetype: 'gentle',
      nickname: '',
      openingScenario: scenario.setup,
    })
  }

  return chars
}

/**
 * 构建完整 LLM 角色描述（对齐 buildCharacterForLLM）。
 */
export function buildEvalCharacter(scenario, { charId, ts, temperature, topP, thinkingEnabled, contextWindow }) {
  const folderChars = buildFolderChars(scenario, { charId, ts })
  const mainChar = folderChars[0]

  const romanceCharacters = folderChars.map(c => ({
    id: c.id,
    name: c.name,
    description: c.description || '',
    background: c.background || '',
    personality: c.personality || '',
    speakingStyle: c.speakingStyle || '',
    styleRules: c.styleRules || [],
    forbiddenWords: c.forbiddenWords || [],
    affectionEnabled: true,
    affectionInitial: c.affectionInitial ?? 50,
    affectionStages: c.affectionStages || [{ name: '默认', min: 0, max: 100, description: '' }],
    behavior: c.behavior || '',
    archetype: c.archetype || 'gentle',
    nickname: c.nickname || '',
  }))

  const character = {
    id: mainChar.id,
    name: mainChar.name,
    chatStyle: 'story',
    worldSetting: mainChar.worldSetting,
    openingScenario: scenario.setup,
    personality: mainChar.personality,
    background: mainChar.background,
    speakingStyle: mainChar.speakingStyle,
    styleRules: mainChar.styleRules || [],
    forbiddenWords: [],
    romanceCharacters,
    npcs: [],
    affectionStages: [],
    temperature,
    topP,
    thinkingEnabled,
    contextWindow,
    _playerProfile: {
      name: '测试员',
      gender: '',
      personalityTags: [],
      description: '信号站同事',
    },
  }

  return { character, folderChars, mainChar }
}

// ═══════════════════════════════════════════════════════════
// 场景初始化：播种 Fact Ledger / Memory Graph / SML / USK
// ═══════════════════════════════════════════════════════════

/**
 * 首轮 executeTurn 前播种。coordinator 的 initAgentSystem 会惰性加载这些键，
 * 因此必须先写 localStorage 再 init。
 */
export function seedStateBeforeInit(scenario, { charId, saveId, folderChars, ts }) {
  const g = getGlobalCharacter()
  const st = scenario.initial_state || {}
  const mainName = g.name

  // ── Memory Graph（coordinator 以无 saveId 加载 → __no_save__ 键）──
  const graph = createMemoryGraph()
  graph.nodes.user = { type: 'player', name: '测试员' }
  graph.nodes[mainName] = { type: 'romance', name: mainName, personality: (g.personality || []).join('、'), color: 'neutral' }
  for (const name of Object.keys(st.characters || {})) {
    graph.nodes[name] = { type: 'romance', name, personality: ((st.characters[name] || {}).personality || []).join('、'), color: 'neutral' }
  }
  graph.edges['user_' + mainName] = {
    affection: st.affection ?? 50,
    tension: st.tension ?? 20,
    trust: st.trust ?? 30,
    dominance: 0.3,
    stageHint: '',
    lastEmotion: 'none',
    lastIntent: null,
    lastInteraction: Date.now(),
  }
  for (const [name, c] of Object.entries(st.characters || {})) {
    graph.edges['user_' + name] = {
      affection: c.affection ?? 40,
      tension: c.tension ?? 20,
      trust: c.trust ?? 25,
      dominance: 0.3,
      stageHint: '',
      lastEmotion: 'none',
      lastIntent: null,
      lastInteraction: Date.now(),
    }
  }
  for (const m of (scenario.initial_memories || [])) {
    graph.event_log.push({ type: 'SEEDED_MEMORY', summary: m, timestamp: Date.now(), turn: 0 })
  }
  graph.global.sceneLocation = st.location || ''
  saveGraph(charId, undefined, graph)

  // ── Fact Ledger（含 saveId）──
  const ledger = loadLedger(charId, saveId)
  ledger.stateFacts = [...(scenario.initial_facts || [])]
  ledger.identityFacts = [mainName + '是' + g.role, '玩家名字=测试员']
  if (st.scene) ledger.stateFacts.push('当前场景：' + st.scene)
  ledger.sceneState.location = st.location || ''
  ledger.sceneState.timePhase = st.time || ''
  saveLedger(charId, saveId, ledger)

  // ── SML 状态（trust/dependency/tension/intimacy 在 init 后 merge 回 _worldState）──
  const smlChars = {}
  smlChars[mainName] = {
    trust: st.trust ?? 30,
    dependency: st.dependency ?? 30,
    tension: st.tension ?? 20,
    intimacy: st.intimacy ?? 20,
    lastMutation: null,
  }
  for (const [name, c] of Object.entries(st.characters || {})) {
    smlChars[name] = {
      trust: c.trust ?? 25,
      dependency: c.dependency ?? 20,
      tension: c.tension ?? 20,
      intimacy: c.intimacy ?? 15,
      lastMutation: null,
    }
  }
  saveSMLState(charId, saveId, { characters: smlChars, pendingHooks: [], eventLog: [] })
}

/**
 * init 之后补丁 USK（init 只写入 affection，其余关系/情绪/张力字段需按场景覆盖）。
 */
export function patchUSK(scenario) {
  const usk = getRawFolderUSK()
  if (!usk?.characters) return null
  const st = scenario.initial_state || {}
  const mainName = getGlobalCharacter().name

  const apply = (name, vals) => {
    const c = usk.characters[name]
    if (!c) return
    if (!c.relationship) c.relationship = {}
    if (!c.emotion) c.emotion = {}
    if (!c.tension) c.tension = {}
    const r = c.relationship
    r.affection = _clamp(vals.affection ?? r.affection ?? 50)
    r.trust = _clamp(vals.trust ?? r.trust ?? 30)
    r.dependency = _clamp(vals.dependency ?? r.dependency ?? 30)
    r.respect = _clamp(vals.respect ?? r.respect ?? 40)
    r.fear = _clamp(vals.fear ?? r.fear ?? 30)
    r.possessiveness = _clamp(vals.possessiveness ?? r.possessiveness ?? 30)
    const e = c.emotion
    e.anger = _clamp(vals.anger ?? e.anger ?? 5)
    e.sadness = _clamp(vals.sadness ?? e.sadness ?? 5)
    e.jealousy = _clamp(vals.jealousy ?? e.jealousy ?? 5)
    e.anxiety = _clamp(vals.anxiety ?? e.anxiety ?? 10)
    e.curiosity = _clamp(vals.curiosity ?? e.curiosity ?? 30)
    e.excitement = _clamp(vals.excitement ?? e.excitement ?? 20)
    const t = c.tension
    t.unresolved_conflicts = _clamp(vals.tension ?? t.unresolved_conflicts ?? 0)
    t.emotional_pressure = _clamp(vals.emotional_pressure ?? t.emotional_pressure ?? 20)
    t.attraction_tension = _clamp(vals.attraction_tension ?? t.attraction_tension ?? 40)
    t.power_imbalance = _clamp(vals.power_imbalance ?? t.power_imbalance ?? 50)
  }

  apply(mainName, st)
  for (const [name, vals] of Object.entries(st.characters || {})) apply(name, vals)
  if (st.world_tension != null && usk.global_state) usk.global_state.world_tension = st.world_tension
  return usk
}

// ═══════════════════════════════════════════════════════════
// 状态快照
// ═══════════════════════════════════════════════════════════

/**
 * 结构化运行时快照（深拷贝，供 pre/post 对比）。
 */
export function snapshotRuntime({ charId, saveId }) {
  let usk = null
  try {
    const raw = getRawFolderUSK()
    if (raw) usk = JSON.parse(JSON.stringify(raw))
  } catch {}
  let ledger = null
  let memory_graph = null
  try {
    ledger = loadLedger(charId, saveId)
    memory_graph = loadGraph(charId) || null
  } catch {}
  return { usk, ledger, memory_graph }
}

/**
 * 从 pre/post 快照提取「本次运行新增的事件记忆」。
 */
export function extractNewMemories(pre, post) {
  const out = []

  const preGraph = pre?.memory_graph
  const postGraph = post?.memory_graph
  if (preGraph?.event_log && postGraph?.event_log) {
    const preCount = preGraph.event_log.length
    for (const e of postGraph.event_log.slice(preCount)) {
      out.push({ source: 'memory_graph', ..._pick(e, ['type', 'summary', 'turn']) })
    }
  }

  const preEvts = pre?.usk?.event_memory || []
  const postEvts = post?.usk?.event_memory || []
  if (postEvts.length > preEvts.length) {
    for (const e of postEvts.slice(preEvts.length)) {
      out.push({ source: 'usk', ..._pick(e, ['type', 'summary', 'turn', 'mode']) })
    }
  }

  const preFacts = [...(pre?.ledger?.actionFacts || []), ...(pre?.ledger?.stateFacts || []), ...(pre?.ledger?.relationshipFacts || [])]
  const postFacts = [...(post?.ledger?.actionFacts || []), ...(post?.ledger?.stateFacts || []), ...(post?.ledger?.relationshipFacts || [])]
  for (const f of postFacts) {
    if (!preFacts.includes(f)) out.push({ source: 'fact_ledger', summary: f })
  }

  return out
}

// ═══════════════════════════════════════════════════════════
// 单次运行
// ═══════════════════════════════════════════════════════════

/**
 * 运行单个 (场景, run)。
 *
 * @param {object} cfg
 * @param {object} cfg.scenario — 场景对象（来自 scenarioLoader）
 * @param {number} cfg.run — 1-based 运行序号
 * @param {string} cfg.model — 主模型名（运行期间 saveModel 覆盖，结束后恢复）
 * @param {string} cfg.apiKey — DeepSeek API Key
 * @param {string} cfg.version — 产品版本号
 * @param {object} cfg.config — { temperature, topP, thinkingEnabled, contextWindow }
 * @param {function} [cfg.onProgress] — ({type, scenario_id, run, ...}) => void
 * @param {function} [cfg.isCancelled] — () => boolean
 * @returns {Promise<object>} run record
 */
export async function runScenarioRun(cfg) {
  const { scenario, run, model, apiKey, version, config = {}, onProgress, isCancelled } = cfg
  const record = createRunRecord({
    scenarioId: scenario.id,
    run,
    version,
    model,
    config: { ...config, automation: scenario.automation },
  })
  record.dimension = scenario.dimension
  record.manual_required = !!scenario.manual_required
  record.automation = scenario.automation
  record.automation_note = scenario.automation_note || ''
  record.expected_behaviors = scenario.expected_behaviors
  record.failure_signals = scenario.failure_signals
  record.setup = scenario.setup

  // ── manual / partial 场景：不调用模型，直接标记人工 ──
  // partial（如 X01 跨模式连续性）无法在纯剧情运行时中诚实执行——
  // 不拿剧情链路输出去冒充日常模式结果，需人工在真实 UI 中验证。
  if (scenario.automation === AUTOMATION.MANUAL || scenario.automation === AUTOMATION.PARTIAL) {
    record.status = 'manual'
    record.notes = scenario.automation_note || '该场景需要人工执行（UI 导航 / 故障注入 / 模式切换），未自动调用模型。'
    saveRun(record)
    return record
  }

  if (!apiKey) {
    record.status = 'error'
    record.error = '未提供 API Key（请在设置页配置）'
    saveRun(record)
    return record
  }

  const ts = Date.now()
  const charId = `eval_${scenario.id}_${run}_${ts}`
  const folderName = `eval_${scenario.id}_run${run}_${ts}`
  const prevModel = getModel()

  let folder = null
  let save = null
  try {
    if (isCancelled?.()) { record.status = 'skipped'; saveRun(record); return record }
    onProgress?.({ type: 'run_start', scenario_id: scenario.id, run, title: scenario.title })

    // 1. 独立世界容器 + 独立存档
    folder = createFolder(folderName, '', '', '', '测试员', '', '信号站同事')
    save = createSave(folder.id, 'eval')
    registerRuntimeNamespace({ runId: record.runId, folderId: folder.id, saveId: save.id, charId, folderName })

    // 2. 构造角色
    const { character } = buildEvalCharacter(scenario, {
      charId, ts,
      temperature: config.temperature,
      topP: config.topP,
      thinkingEnabled: config.thinkingEnabled,
      contextWindow: config.contextWindow,
    })

    // 3. 播种状态（首轮前）
    seedStateBeforeInit(scenario, { charId, saveId: save.id, ts })

    // 4. 初始化内核（coordinator 惰性加载播种状态）
    const hydrateData = {
      messages: [{
        id: 'setup_' + ts,
        role: 'assistant',
        content: scenario.setup,
        isOpening: true,
        isScenarioSetup: true,
        timestamp: Date.now(),
      }],
      usk: null,
    }
    InteractionKernel.init(folder.id, folderCharsForInit(scenario, charId, ts), 'drama', hydrateData, save.id)

    // 5. 补丁 USK
    patchUSK(scenario)

    // 6. pre 快照
    record.pre_state = snapshotRuntime({ charId, saveId: save.id })
    record.pre_ledger = record.pre_state?.ledger || null
    record.pre_memory_graph = record.pre_state?.memory_graph || null

    // 7. 覆盖模型（runAgentTurn 用 getModel()）
    saveModel(model)

    // 8. 逐轮执行（真实产品链路）
    record.status = 'running'
    saveRun(record)
    const t0 = performance.now()
    let firstTokenMs = null
    let inputTokens = 0
    let outputTokens = 0
    const replies = []
    const reasonings = []
    const errors = []
    const systemErrors = []
    const rqa = []
    let stopReason = null

    for (let i = 0; i < scenario.turns.length; i++) {
      const turn = scenario.turns[i]
      if (isCancelled?.()) { record.status = 'skipped'; stopReason = '用户停止'; break }
      onProgress?.({ type: 'turn', scenario_id: scenario.id, run, turn_index: i, turn_count: scenario.turns.length, title: scenario.title })

      const result = await InteractionKernel.executeTurn(
        turn,
        apiKey,
        (token, fullText, reset) => {
          if (reset) return
          if (firstTokenMs == null && token) firstTokenMs = performance.now() - t0
        },
        character,
        getFolder(folder.id),
      )

      if (result.error) {
        const message = result.error.message || String(result.error)
        if (isSystemFailureMessage(message)) {
          systemErrors.push(message)
          errors.push('[SYSTEM] ' + message)
        } else {
          errors.push(message)
        }
        record.error = message
        stopReason = '错误'
        break
      }
      // 系统级失败（RSE 审计崩溃 / 记忆图持久化失败等）→ SYSTEM_FAILURE，不再静默 ok
      if (Array.isArray(result.systemErrors) && result.systemErrors.length) {
        for (const se of result.systemErrors) {
          systemErrors.push(se)
          errors.push('[SYSTEM] ' + se)
        }
      }
      replies.push(result.reply)
      reasonings.push(result.reasoningContent)
      if (result.usage) {
        inputTokens += result.usage.prompt_tokens || 0
        outputTokens += result.usage.completion_tokens || 0
      }
      const deterministic = auditScenarioTurn({ scenario, turnIndex: i, reply: result.reply })
      const combinedIssues = [
        ...(Array.isArray(result.qualityIssues) ? result.qualityIssues.map(q => ({ ...q })) : []),
        ...deterministic.issues,
      ]
      for (const tag of deterministic.tags) {
        if (SEVERE_TAGS.includes(tag) && !(record.severe_tags || []).includes(tag)) {
          record.severe_tags = [...(record.severe_tags || []), tag]
        }
      }
      if (combinedIssues.length) {
        rqa.push({ turn, quality_issues: combinedIssues })
        // RSE Fact Integrity 违规（编造门禁/监控/设备异常/无法证实的量化）→ 自动打 FACT_ERROR 严重标签
        const factFabrication = combinedIssues.some(q =>
          q.source === 'rse' && (q.dimension === 'Fact Integrity' || /FACT_ERROR/i.test(q.description || '')))
        if (factFabrication && SEVERE_TAGS.includes('FACT_ERROR') && !(record.severe_tags || []).includes('FACT_ERROR')) {
          record.severe_tags = [...(record.severe_tags || []), 'FACT_ERROR']
        }
      }
    }

    const totalMs = performance.now() - t0

    // 9. post 快照
    record.post_state = snapshotRuntime({ charId, saveId: save.id })
    record.post_ledger = record.post_state?.ledger || null
    record.post_memory_graph = record.post_state?.memory_graph || null

    const stateAudit = auditScenarioState({ scenario, preState: record.pre_state, postState: record.post_state })
    if (stateAudit.issues.length) {
      rqa.push({ turn: '[post_state]', quality_issues: stateAudit.issues })
    }
    for (const tag of stateAudit.tags) {
      if (SEVERE_TAGS.includes(tag) && !(record.severe_tags || []).includes(tag)) {
        record.severe_tags = [...(record.severe_tags || []), tag]
      }
    }

    if (record.status !== 'skipped' && replies.length !== scenario.turns.length && systemErrors.length === 0) {
      const message = `Incomplete scenario: expected ${scenario.turns.length} replies, received ${replies.length}`
      systemErrors.push(message)
      errors.push('[SYSTEM] ' + message)
    }

    // 10. 新事件记忆
    record.new_event_memories = extractNewMemories(record.pre_state, record.post_state)

    record.replies = replies
    record.reasoning = reasonings
    record.errors = errors
    record.rqa_rse_results = rqa
    record.first_token_ms = firstTokenMs
    record.total_ms = totalMs
    record.input_tokens = inputTokens
    record.output_tokens = outputTokens
    record.estimated_cost = null // 无定价常量 → 留空不编造
    record.system_errors = systemErrors
    if (record.status !== 'skipped') {
      // 系统级失败（RSE 崩溃 / 记忆持久化失败）优先于普通错误 → SYSTEM_FAILURE
      record.status = systemErrors.length
        ? 'SYSTEM_FAILURE'
        : (errors.length ? 'error' : 'ok')
    }
    if (stopReason === '错误' && errors.length) {
      record.notes = (record.notes ? record.notes + '；' : '') + '运行中断：' + stopReason
    }

    saveRun(record)
    onProgress?.({ type: 'run_end', scenario_id: scenario.id, run, status: record.status, title: scenario.title })
    return record
  } catch (err) {
    record.status = 'error'
    record.error = err?.message || String(err)
    saveRun(record)
    return record
  } finally {
    // 恢复模型 + 清理临时世界
    try { saveModel(prevModel) } catch {}
    if (folder) {
      try {
        cleanupRuntimeNamespace({ folderId: folder.id, saveId: save?.id, charId })
        deleteFolder(folder.id)
      } catch {}
    }
    removeRuntimeNamespace(record.runId)
  }
}

// init 需要与 buildEvalCharacter 相同的 folderChars（仅 id/name/affectionInitial 会被 USK 用）
function folderCharsForInit(scenario, charId, ts) {
  return buildFolderChars(scenario, { charId, ts })
}

// ═══════════════════════════════════════════════════════════
// 批次运行
// ═══════════════════════════════════════════════════════════

/**
 * 按 场景×次数 顺序运行。任一场景失败不中断批次；停止信号在场景/轮之间检查。
 *
 * @param {object} cfg
 * @param {object[]} cfg.scenarios — 要运行的场景数组
 * @param {number} cfg.runCount — 每场景运行次数
 * @param {function} [cfg.onProgress]
 * @param {function} [cfg.isCancelled]
 * @returns {Promise<object[]>} run records
 */
export async function runEvalBatch(cfg) {
  const { scenarios = [], runCount = 1, onProgress, isCancelled } = cfg
  const results = []
  for (const scenario of scenarios) {
    for (let run = 1; run <= runCount; run++) {
      if (isCancelled?.()) break
      const record = await runScenarioRun({
        scenario,
        run,
        model: cfg.model,
        apiKey: cfg.apiKey,
        version: cfg.version,
        config: cfg.config,
        onProgress,
        isCancelled,
      })
      results.push(record)
    }
    if (isCancelled?.()) break
    onProgress?.({ type: 'batch_scenario_done', scenario_id: scenario.id })
  }
  return results
}
