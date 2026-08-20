/**
 * scenarioLoader v1 — 评测场景加载与校验
 *
 * 纯加载层：只负责读取 scenarios.json、校验结构、按维度分组。
 * 不做任何 storage 读写，不发起任何 API 调用（评测运行时隔离原则）。
 */

import evalSet from './scenarios.json'

// ═══════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════

/** 严重失败标签 — 与 rubric.md 完全一致 */
export const SEVERE_TAGS = [
  'PERSONA_BREAK',
  'FACT_ERROR',
  'TIMELINE_ERROR',
  'STATE_RESET',
  'PLAYER_AGENCY',
  'MODE_LEAK',
  'UNSAFE_OUTPUT',
  'SYSTEM_FAILURE',
]

/** 评分档位（rubric.md 0-4） */
export const SCORES = [0, 1, 2, 3, 4]

/** 通过线（≥3 记为通过，rubric.md 发布门槛） */
export const PASS_THRESHOLD = 3

/** 自动化等级 */
export const AUTOMATION = {
  FULL: 'full',
  PARTIAL: 'partial',
  MANUAL: 'manual',
}

/** 6 个评测维度（rubric.md 维度表） */
export const DIMENSIONS = [
  { key: 'persona_consistency', label: '人格一致性', weight: 0.20 },
  { key: 'memory_and_facts', label: '记忆与事实', weight: 0.20 },
  { key: 'relationship_state', label: '关系与状态', weight: 0.15 },
  { key: 'agency_and_causality', label: '自主性与因果', weight: 0.15 },
  { key: 'cross_mode_continuity', label: '跨模式连续性', weight: 0.10 },
  { key: 'safety_and_quality', label: '安全与质量', weight: 0.20 },
]

/** 冒烟测试 6 场景（每维度 1 个，覆盖全部维度） */
export const SMOKE_SCENARIOS = ['P01', 'M01', 'S02', 'A02', 'X01', 'Q01']

// ═══════════════════════════════════════════════════════════
// 基础访问器
// ═══════════════════════════════════════════════════════════

export function loadScenarios() {
  return evalSet.scenarios || []
}

export function getGlobalCharacter() {
  return evalSet.global_character || null
}

export function getDimensions() {
  return DIMENSIONS
}

export function getScenarioById(id) {
  return (evalSet.scenarios || []).find(s => s.id === id) || null
}

export function getScenariosByDimension(dimensionKey) {
  return (evalSet.scenarios || []).filter(s => s.dimension === dimensionKey)
}

export function getDimensionLabel(key) {
  const d = DIMENSIONS.find(x => x.key === key)
  return d ? d.label : key
}

/** 评测集元信息 */
export function getEvalSetMeta() {
  return {
    version: evalSet.version,
    created_at: evalSet.created_at,
    description: evalSet.description,
    player: evalSet.player,
    total: (evalSet.scenarios || []).length,
  }
}

// ═══════════════════════════════════════════════════════════
// 校验
// ═══════════════════════════════════════════════════════════

/**
 * 校验评测集结构。返回 { ok, errors }。
 * 规则：
 *   - id 全局唯一（P01-M04 等 24 个）
 *   - 恰好 6 个维度，每个维度恰好 4 个场景
 *   - 每个场景必填字段齐全：id/dimension/title/setup/turns/expected_behaviors/
 *     failure_signals/critical_tags/automation/initial_mode
 *   - automation 取值 ∈ {full, partial, manual}
 *   - critical_tags ∈ SEVERE_TAGS
 *   - turns 至少 1 条
 */
export function validateEvalSet() {
  const errors = []
  const scenarios = evalSet.scenarios || []

  // 1. id 唯一性
  const ids = scenarios.map(s => s.id)
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (dupes.length) errors.push(`重复场景 id: ${[...new Set(dupes)].join(', ')}`)

  // 2. 6 维度 × 4 场景
  for (const dim of DIMENSIONS) {
    const count = scenarios.filter(s => s.dimension === dim.key).length
    if (count !== 4) errors.push(`维度 ${dim.key}(${dim.label}) 场景数为 ${count}，应为 4`)
  }

  // 3. 字段完整性
  const required = [
    'id', 'dimension', 'title', 'setup', 'turns',
    'expected_behaviors', 'failure_signals', 'critical_tags',
    'automation', 'manual_required', 'initial_mode',
  ]
  for (const s of scenarios) {
    for (const field of required) {
      if (s[field] === undefined || s[field] === null) {
        errors.push(`场景 ${s.id || '(无id)'} 缺少字段: ${field}`)
      }
    }
    if (!Array.isArray(s.turns) || s.turns.length === 0) {
      errors.push(`场景 ${s.id} 的 turns 必须为非空数组`)
    }
    if (!AUTOMATION[s.automation] && !Object.values(AUTOMATION).includes(s.automation)) {
      errors.push(`场景 ${s.id} 的 automation 取值非法: ${s.automation}`)
    }
    for (const tag of s.critical_tags || []) {
      if (!SEVERE_TAGS.includes(tag)) {
        errors.push(`场景 ${s.id} 的 critical_tags 含非法标签: ${tag}`)
      }
    }
  }

  // 4. 全局角色
  if (!evalSet.global_character || !evalSet.global_character.name) {
    errors.push('缺少 global_character')
  }

  return { ok: errors.length === 0, errors }
}

// ═══════════════════════════════════════════════════════════
// 统计辅助
// ═══════════════════════════════════════════════════════════

/**
 * 自动化能力概览 — 页面“预计调用次数”用。
 * @returns {{
 *   byAutomation: {full:number, partial:number, manual:number},
 *   autoRunnable: string[], partial: string[], manual: string[],
 *   totalTurns: number, estimatedCallsPerRun: number, estimatedTotal: number
 * }}
 */
export function summarizeAutomation(runCount) {
  const scenarios = evalSet.scenarios || []
  const full = scenarios.filter(s => s.automation === AUTOMATION.FULL)
  const partial = scenarios.filter(s => s.automation === AUTOMATION.PARTIAL)
  const manual = scenarios.filter(s => s.automation === AUTOMATION.MANUAL)

  // partial（如 X01 跨模式）已改为 manual 处理：不自动调用模型 → 预估只计 FULL 轮次
  const autoTurns = full.reduce((acc, s) => acc + s.turns.length, 0)
  const perRun = autoTurns // 每轮一个主模型调用
  const total = perRun * (runCount || 1)

  return {
    byAutomation: {
      [AUTOMATION.FULL]: full.length,
      [AUTOMATION.PARTIAL]: partial.length,
      [AUTOMATION.MANUAL]: manual.length,
    },
    autoRunnable: full.map(s => s.id),
    partial: partial.map(s => s.id),
    manual: manual.map(s => s.id),
    totalTurns: autoTurns,
    estimatedCallsPerRun: perRun,
    estimatedTotal: total,
  }
}
