/**
 * evaluationStorage v1 — 评测结果存储 + 运行时命名空间管理
 *
 * 隔离原则：
 *   - 所有评测数据存放在 `jsjg_eval_` 前缀下，与正式数据（jsjg_folders、
 *     jsjg_memory_graph_*、jsjg_fact_ledger_* 等）完全分离。
 *   - 每次运行的临时世界（folder/save/char）使用 `eval_` 前缀的随机 ID，
 *     通过注册表跟踪。清理只删除包含这些 ID 的键，绝不触碰正式数据。
 *   - storage 后端可注入（默认 window.localStorage），便于测试。
 */

// ═══════════════════════════════════════════════════════════
// 后端
// ═══════════════════════════════════════════════════════════

let _backend = null

export function getBackend() {
  if (_backend) return _backend
  if (typeof localStorage !== 'undefined') return localStorage
  return null
}

/** 注入测试后端（mock localStorage） */
export function setStorageBackend(backend) {
  _backend = backend
}

// ═══════════════════════════════════════════════════════════
// 键
// ═══════════════════════════════════════════════════════════

const INDEX_KEY = 'jsjg_eval_index'               // 运行索引（摘要）
const RUN_PREFIX = 'jsjg_eval_run_'               // 单条运行完整记录
const RUNTIME_KEY = 'jsjg_eval_runtime_runs'      // 临时世界命名空间注册表
const NAMESPACE_PREFIX = 'jsjg_eval_'

function _safeGet(key) {
  const b = getBackend()
  if (!b) return null
  try { return b.getItem(key) } catch { return null }
}

function _safeSet(key, value) {
  const b = getBackend()
  if (!b) return false
  try { b.setItem(key, value); return true } catch { return false }
}

function _safeRemove(key) {
  const b = getBackend()
  if (!b) return
  try { b.removeItem(key) } catch {}
}

function _readJSON(key, fallback) {
  const raw = _safeGet(key)
  if (!raw) return fallback
  try { return JSON.parse(raw) } catch { return fallback }
}

// ═══════════════════════════════════════════════════════════
// 运行记录
// ═══════════════════════════════════════════════════════════

export function generateRunId(scenarioId, run) {
  const ts = Date.now().toString(36)
  return 'eval_' + scenarioId + '_' + run + '_' + ts
}

/**
 * 创建一条运行记录骨架（不含结果）。
 * @returns {object} record
 */
export function createRunRecord({ scenarioId, run, version, model, config }) {
  return {
    runId: generateRunId(scenarioId, run),
    version,
    model,
    scenario_id: scenarioId,
    run,
    // 运行配置快照
    config: config ? { ...config } : null,
    // 结果字段（按任务要求记录，均初始为空）
    user_inputs: [],
    replies: [],
    reasoning: [],
    errors: [],
    pre_state: null,          // 首轮前状态快照
    post_state: null,         // 末轮后状态快照
    pre_ledger: null,
    post_ledger: null,
    pre_memory_graph: null,
    post_memory_graph: null,
    new_event_memories: [],   // 本次运行新增的事件记忆
    rqa_rse_results: [],      // RQA/RSE 结果（运行时质量审计），无则空数组
    first_token_ms: null,
    total_ms: null,
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost: null,     // 无法计算时保持 null（绝不编造）
    status: 'pending',        // pending | running | ok | error | manual | skipped
    error: null,
    score: null,              // 人工评分 0-4
    severe_tags: [],
    notes: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export function saveRun(record) {
  if (!record?.runId) return false
  record.updated_at = new Date().toISOString()
  _safeSet(RUN_PREFIX + record.runId, JSON.stringify(record))

  // 更新索引
  const index = _readJSON(INDEX_KEY, [])
  const idx = index.findIndex(r => r.runId === record.runId)
  const summary = {
    runId: record.runId,
    scenario_id: record.scenario_id,
    run: record.run,
    dimension: record.dimension || null,
    status: record.status,
    score: record.score,
    severe_tags: record.severe_tags || [],
    model: record.model,
    created_at: record.created_at,
    updated_at: record.updated_at,
  }
  if (idx >= 0) index[idx] = summary
  else index.push(summary)
  _safeSet(INDEX_KEY, JSON.stringify(index))
  return true
}

export function getRun(runId) {
  return _readJSON(RUN_PREFIX + runId, null)
}

export function deleteRunRecord(runId) {
  _safeRemove(RUN_PREFIX + runId)
  const index = _readJSON(INDEX_KEY, []).filter(r => r.runId !== runId)
  _safeSet(INDEX_KEY, JSON.stringify(index))
}

export function getAllRuns() {
  const index = _readJSON(INDEX_KEY, [])
  return index.map(s => getRun(s.runId)).filter(Boolean)
}

export function getRunSummaries() {
  return _readJSON(INDEX_KEY, [])
}

// ═══════════════════════════════════════════════════════════
// 运行时命名空间注册表（用于一键清理）
// ═══════════════════════════════════════════════════════════

/**
 * 注册一次运行的临时世界命名空间。
 * @param {object} ns — { runId, folderId, saveId, charId, folderName }
 */
export function registerRuntimeNamespace(ns) {
  if (!ns?.runId) return
  const list = _readJSON(RUNTIME_KEY, [])
  if (!list.find(x => x.runId === ns.runId)) {
    list.push(ns)
    _safeSet(RUNTIME_KEY, JSON.stringify(list))
  }
}

export function getRuntimeNamespaces() {
  return _readJSON(RUNTIME_KEY, [])
}

export function removeRuntimeNamespace(runId) {
  const list = _readJSON(RUNTIME_KEY, []).filter(x => x.runId !== runId)
  _safeSet(RUNTIME_KEY, JSON.stringify(list))
}

/**
 * 清理一次运行的临时世界数据。
 * 策略：遍历 localStorage 所有键，删除「包含 folderId / saveId / charId 之一」的键。
 * 由于这三个 ID 都是 `eval_` 前缀的随机串，正式用户数据不可能包含它们 → 永不误删。
 * @param {object} ns — { folderId, saveId, charId }
 */
export function cleanupRuntimeNamespace(ns) {
  const b = getBackend()
  if (!b || !ns) return { removed: 0 }
  const needles = [ns.folderId, ns.saveId, ns.charId].filter(Boolean)
  let removed = 0
  for (let i = b.length - 1; i >= 0; i--) {
    const key = b.key ? b.key(i) : null
    if (key && needles.some(n => n && key.includes(n))) {
      try { b.removeItem(key) } catch {}
      removed++
    }
  }
  return { removed }
}

/**
 * 一键清理：删除全部评测数据（结果 + 注册表 + 所有临时世界键）。
 * 只操作 `jsjg_eval_` 前缀与注册表中的命名空间 ID，正式用户数据不受影响。
 * @returns {{ removed: number, namespaces: number }}
 */
export function cleanupAllEvalData() {
  const b = getBackend()
  if (!b) return { removed: 0, namespaces: 0 }

  // 1. 清理注册的临时世界命名空间
  const namespaces = getRuntimeNamespaces()
  let removed = 0
  for (const ns of namespaces) {
    const r = cleanupRuntimeNamespace(ns)
    removed += r.removed
  }

  // 2. 清理 jsjg_eval_ 前缀的所有键（结果、索引、注册表）
  for (let i = b.length - 1; i >= 0; i--) {
    const key = b.key ? b.key(i) : null
    if (key && key.startsWith(NAMESPACE_PREFIX)) {
      try { b.removeItem(key) } catch {}
      removed++
    }
  }
  return { removed, namespaces: namespaces.length }
}

/** 判断 localStorage 是否存在评测数据（用于页面清理按钮状态） */
export function hasEvalData() {
  const b = getBackend()
  if (!b) return false
  for (let i = 0; i < b.length; i++) {
    const key = b.key ? b.key(i) : null
    if (key && key.startsWith(NAMESPACE_PREFIX)) return true
  }
  return false
}
