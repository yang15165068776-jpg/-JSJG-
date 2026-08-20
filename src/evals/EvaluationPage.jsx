/**
 * EvaluationPage v1 — AI 效果评测模式（dev-only，?eval=1 进入）
 *
 * 只读/评测用途：
 *   - 走真实产品链路（InteractionKernel.executeTurn）逐场景评测
 *   - 每次运行使用独立 `eval_` 前缀的世界容器，运行后立即清理，绝不污染正式数据
 *   - 人工评分 0-4 + 严重失败标签 + 备注
 *   - 导出 CSV / 完整 JSON / 版本摘要 JSON
 *   - 一键清理全部评测数据
 *
 * 内容安全：本页仅引用 深空信号站（林澈）安全评测场景，不含任何成人/暴力/反安全内容。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  loadScenarios, getScenarioById, getDimensions, getDimensionLabel,
  getEvalSetMeta, getGlobalCharacter, SEVERE_TAGS, SCORES,
  SMOKE_SCENARIOS, AUTOMATION,
} from './scenarioLoader'
import { runEvalBatch } from './evaluationRunner'
import {
  getAllRuns, saveRun, cleanupAllEvalData, hasEvalData,
} from './evaluationStorage'
import {
  buildResultsCSV, buildFullExport, buildVersionSummary, serializeFullExport,
  downloadFile, computeStats,
} from './exportResults'
import { getApiKey, getModel } from '../utils/storage'

// ═══════════════════════════════════════════════════════════
// 小 UI 组件
// ═══════════════════════════════════════════════════════════

const card = {
  background: 'var(--bg2)',
  borderRadius: '14px',
  padding: '14px 16px',
  marginBottom: '12px',
}

const label = { fontSize: '12px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }

const input = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: '10px',
  border: '0.5px solid var(--border)',
  background: 'var(--bg)',
  fontSize: '13px',
  color: 'var(--text)',
  fontFamily: 'inherit',
  outline: 'none',
}

const btnPrimary = {
  padding: '12px 16px',
  borderRadius: '12px',
  border: 'none',
  background: 'var(--purple)',
  color: '#fff',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
}

const btnGhost = {
  padding: '10px 14px',
  borderRadius: '12px',
  border: 'none',
  background: 'var(--bg2)',
  color: 'var(--text)',
  fontSize: '13px',
  cursor: 'pointer',
}

const btnDanger = {
  padding: '10px 14px',
  borderRadius: '12px',
  border: 'none',
  background: 'rgba(220, 80, 80, 0.12)',
  color: 'var(--coral)',
  fontSize: '13px',
  cursor: 'pointer',
}

const tagChip = (active) => ({
  display: 'inline-block',
  padding: '3px 8px',
  borderRadius: '8px',
  fontSize: '11px',
  cursor: 'pointer',
  marginRight: '6px',
  marginBottom: '6px',
  border: '0.5px solid var(--border)',
  background: active ? 'rgba(120, 100, 220, 0.18)' : 'var(--bg)',
  color: active ? 'var(--purple)' : 'var(--text2)',
  fontWeight: active ? 600 : 400,
})

const statusColor = (status) => {
  switch (status) {
    case 'ok': return '#2f9e63'
    case 'error': return 'var(--coral)'
    case 'manual': return '#b5812f'
    case 'skipped': return '#888'
    default: return 'var(--text3)'
  }
}

const statusLabel = (status) => {
  switch (status) {
    case 'ok': return '完成'
    case 'error': return '错误'
    case 'manual': return '人工'
    case 'skipped': return '跳过'
    case 'running': return '运行中'
    default: return '待定'
  }
}

function Field({ labelText, children, style }) {
  return (
    <div style={{ ...style }}>
      <label style={{ fontSize: '12px', color: 'var(--text2)', display: 'block', marginBottom: '4px' }}>{labelText}</label>
      {children}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={label}>{title}</div>
      {children}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// 主页面
// ═══════════════════════════════════════════════════════════

export default function EvaluationPage() {
  const meta = getEvalSetMeta()
  const globalChar = getGlobalCharacter()
  const allScenarios = loadScenarios()
  const dimensions = getDimensions()

  const [config, setConfig] = useState(() => {
    const saved = { model: getModel(), temperature: 0.9, topP: 0.95, contextWindow: 40, thinkingEnabled: false, runCount: 3 }
    try {
      const raw = localStorage.getItem('jsjg_eval_config')
      if (raw) return { ...saved, ...JSON.parse(raw) }
    } catch {}
    return saved
  })
  const [apiKeySet, setApiKeySet] = useState(() => !!getApiKey())
  const [selection, setSelection] = useState('all') // 'all' | 'smoke' | Set<id>
  const [running, setRunning] = useState(false)
  const cancelRef = useRef(false)
  const [progress, setProgress] = useState(null)
  const [runs, setRuns] = useState([])
  const [expandedRunId, setExpandedRunId] = useState(null)
  const [toast, setToast] = useState('')

  const reloadRuns = useCallback(() => setRuns(getAllRuns()), [])
  useEffect(() => { reloadRuns() }, [reloadRuns])
  useEffect(() => { setApiKeySet(!!getApiKey()) }, [running])

  // ── 场景选择 ──
  const toggleScenario = useCallback((id) => {
    setSelection(prev => {
      if (prev === 'all' || prev === 'smoke') {
        const s = new Set()
        s.add(id)
        return s
      }
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }, [])

  const selectAll = useCallback(() => setSelection('all'), [])
  const selectSmoke = useCallback(() => setSelection('smoke'), [])

  const selectedScenarios = useMemo(() => {
    if (selection === 'all') return allScenarios
    if (selection === 'smoke') return SMOKE_SCENARIOS.map(getScenarioById).filter(Boolean)
    return [...selection].map(getScenarioById).filter(Boolean)
  }, [selection, allScenarios])

  const autoSelected = selectedScenarios.filter(s => s.automation !== AUTOMATION.MANUAL)
  const estimatedCalls = useMemo(
    () => autoSelected.reduce((a, s) => a + s.turns.length, 0) * config.runCount,
    [autoSelected, config.runCount],
  )

  const autoSummary = useMemo(() => {
    const full = allScenarios.filter(s => s.automation === AUTOMATION.FULL).length
    const partial = allScenarios.filter(s => s.automation === AUTOMATION.PARTIAL).length
    const manual = allScenarios.filter(s => s.automation === AUTOMATION.MANUAL).length
    return { full, partial, manual }
  }, [allScenarios])

  // ── 运行 ──
  const startRun = useCallback(async () => {
    if (running) return
    if (!getApiKey()) { setToast('请先在设置页配置 API Key'); return }
    if (selectedScenarios.length === 0) { setToast('请至少选择 1 个场景'); return }
    if (estimatedCalls >= 18) {
      const ok = window.confirm(
        `即将发起约 ${estimatedCalls} 次模型调用（${selectedScenarios.length} 场景 × ${config.runCount} 次）。\n\n` +
        `这会消耗真实 API 配额并产生费用（${config.model}）。确定继续吗？`
      )
      if (!ok) return
    } else if (estimatedCalls >= 6) {
      const ok = window.confirm(`即将发起约 ${estimatedCalls} 次模型调用，确定继续吗？`)
      if (!ok) return
    }

    cancelRef.current = false
    setRunning(true)
    setProgress({ current: 0, total: estimatedCalls, label: '准备中…', perScenario: {} })
    try {
      await runEvalBatch({
        scenarios: selectedScenarios,
        runCount: config.runCount,
        model: config.model,
        apiKey: getApiKey(),
        version: meta.version,
        config: {
          temperature: config.temperature,
          topP: config.topP,
          thinkingEnabled: config.thinkingEnabled,
          contextWindow: config.contextWindow,
        },
        isCancelled: () => cancelRef.current,
        onProgress: (p) => {
          if (p.type === 'turn') {
            setProgress(prev => ({
              current: (prev?.current || 0) + 1,
              total: estimatedCalls,
              label: `${p.title || p.scenario_id} · 第 ${p.turn_index + 1}/${p.turn_count} 轮`,
              perScenario: { ...(prev?.perScenario || {}), [p.scenario_id]: `${p.run}×` },
            }))
          } else if (p.type === 'run_start') {
            setProgress(prev => ({ ...(prev || {}), label: `${p.title || p.scenario_id} · 第 ${p.run} 次运行…` }))
          } else if (p.type === 'run_end') {
            reloadRuns()
          } else if (p.type === 'batch_scenario_done') {
            reloadRuns()
          }
        },
      })
    } catch (err) {
      setToast('运行异常：' + (err?.message || err))
    } finally {
      setRunning(false)
      cancelRef.current = false
      reloadRuns()
      setToast(cancelRef.current ? '' : '本轮评测完成')
    }
  }, [running, selectedScenarios, config, meta.version, estimatedCalls, reloadRuns])

  const stopRun = useCallback(() => {
    cancelRef.current = true
    setToast('已请求停止：当前请求收尾后不再发起新调用（in-flight 由产品内部超时收尾）')
  }, [])

  // ── 评分与标签 ──
  const updateScore = useCallback((runId, score) => {
    setRuns(prev => {
      const next = prev.map(r => {
        if (r.runId !== runId) return r
        const upd = { ...r, score: score === '' ? null : Number(score) }
        saveRun(upd)
        return upd
      })
      return next
    })
  }, [])

  const toggleTag = useCallback((runId, tag) => {
    setRuns(prev => {
      const next = prev.map(r => {
        if (r.runId !== runId) return r
        const tags = (r.severe_tags || []).includes(tag)
          ? (r.severe_tags || []).filter(t => t !== tag)
          : [...(r.severe_tags || []), tag]
        const upd = { ...r, severe_tags: tags }
        saveRun(upd)
        return upd
      })
      return next
    })
  }, [])

  const updateNotes = useCallback((runId, notes) => {
    setRuns(prev => prev.map(r => {
      if (r.runId !== runId) return r
      const upd = { ...r, notes }
      saveRun(upd)
      return upd
    }))
  }, [])

  // ── 导出 ──
  const exportCSV = useCallback(() => {
    const csv = buildResultsCSV(runs)
    const ok = downloadFile(csv, `jsjg-eval-${meta.version}-${config.model}.csv`, 'text/csv')
    if (ok) setToast('CSV 已下载')
  }, [runs, meta.version, config.model])

  const exportFullJSON = useCallback(() => {
    const obj = buildFullExport(runs, {
      version: meta.version,
      model: config.model,
      config,
      note: '完整运行记录（含状态快照、事件记忆、RQA/RSE 结果）',
    })
    const ok = downloadFile(serializeFullExport(obj), `jsjg-eval-full-${meta.version}-${config.model}.json`, 'application/json')
    if (ok) setToast('完整 JSON 已下载')
  }, [runs, meta.version, config.model, config])

  const exportSummaryJSON = useCallback(() => {
    const obj = buildVersionSummary(runs, {
      version: meta.version,
      model: config.model,
      config,
      note: '版本统计摘要（六维均分 / 通过率 / 严重失败率 / 发布门槛）',
    })
    const ok = downloadFile(serializeFullExport(obj), `jsjg-eval-summary-${meta.version}-${config.model}.json`, 'application/json')
    if (ok) setToast('版本摘要已下载')
  }, [runs, meta.version, config.model, config])

  // ── 一键清理 ──
  const cleanup = useCallback(() => {
    if (running) return
    if (!window.confirm('将删除全部评测数据（结果 + 临时世界）。\n正式用户数据不受影响。确定？')) return
    const res = cleanupAllEvalData()
    reloadRuns()
    setToast(`已清理：${res.removed} 个键，${res.namespaces} 个临时世界`)
  }, [running, reloadRuns])

  const stats = useMemo(() => computeStats(runs), [runs])
  const hasData = hasEvalData()

  const saveConfig = useCallback((patch) => {
    setConfig(prev => {
      const next = { ...prev, ...patch }
      try { localStorage.setItem('jsjg_eval_config', JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'system-ui', padding: '16px', boxSizing: 'border-box' }}>
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 700 }}>🧪 AI 效果评测模式</div>
          <div style={{ fontSize: '12px', color: 'var(--text3)' }}>dev-only · {meta.version} · 角色：{globalChar?.name}（{globalChar?.role}）· 24 场景 / 6 维度</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <a href="./" style={{ ...btnGhost, textDecoration: 'none', display: 'inline-block' }}>← 返回应用</a>
          {hasData && (
            <button onClick={cleanup} style={btnDanger} disabled={running}>一键清理评测数据</button>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ ...card, background: 'rgba(120,100,220,0.08)', border: '0.5px solid rgba(120,100,220,0.3)', marginBottom: '12px' }}>
          <div style={{ fontSize: '13px', color: 'var(--text)' }}>{toast}</div>
        </div>
      )}

      {/* 配置 */}
      <Section title="模型与运行配置">
        <div style={card}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
            <Field labelText="主模型">
              <input
                style={input}
                value={config.model}
                onChange={e => saveConfig({ model: e.target.value })}
                placeholder="deepseek-v4-flash"
              />
            </Field>
            <Field labelText="temperature（思考模式关闭时生效）">
              <input
                style={input}
                type="number"
                step="0.05"
                min="0"
                max="2"
                value={config.temperature}
                onChange={e => saveConfig({ temperature: Number(e.target.value) })}
              />
            </Field>
            <Field labelText="top_p（思考模式关闭时生效）">
              <input
                style={input}
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={config.topP}
                onChange={e => saveConfig({ topP: Number(e.target.value) })}
              />
            </Field>
            <Field labelText="上下文窗口（轮）">
              <input
                style={input}
                type="number"
                min="10"
                max="200"
                value={config.contextWindow}
                onChange={e => saveConfig({ contextWindow: Number(e.target.value) })}
              />
            </Field>
            <Field labelText="每次运行次数">
              <input
                style={input}
                type="number"
                min="1"
                max="5"
                value={config.runCount}
                onChange={e => saveConfig({ runCount: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })}
              />
            </Field>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '12px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text2)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={config.thinkingEnabled}
                onChange={e => saveConfig({ thinkingEnabled: e.target.checked })}
              />
              DeepSeek V4 思考模式（开启后 temperature/top_p 不生效）
            </label>
            <span style={{ fontSize: '12px', color: apiKeySet ? '#2f9e63' : 'var(--coral)' }}>
              {apiKeySet
                ? '✓ API Key 已配置'
                : '✗ API Key 未配置 → 退出评测模式（去掉 ?eval=1）后到「设置」页配置'}
            </span>
          </div>
        </div>
      </Section>

      {/* 场景选择 */}
      <Section title="场景选择">
        <div style={card}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <button onClick={selectAll} style={{ ...btnGhost, fontWeight: selection === 'all' ? 700 : 400, background: selection === 'all' ? 'rgba(120,100,220,0.15)' : 'var(--bg2)' }}>
              全部 {allScenarios.length} 个
            </button>
            <button onClick={selectSmoke} style={{ ...btnGhost, fontWeight: selection === 'smoke' ? 700 : 400, background: selection === 'smoke' ? 'rgba(120,100,220,0.15)' : 'var(--bg2)' }}>
              冒烟测试 {SMOKE_SCENARIOS.length} 个
            </button>
            <span style={{ alignSelf: 'center', fontSize: '12px', color: 'var(--text3)' }}>
              自动可运行 {autoSummary.full + autoSummary.partial} · 半自动 {autoSummary.partial} · 需人工 {autoSummary.manual}
            </span>
          </div>

          {dimensions.map(dim => {
            const dimScenarios = allScenarios.filter(s => s.dimension === dim.key)
            return (
              <div key={dim.key} style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '4px' }}>
                  {getDimensionLabel(dim.key)}（{dim.weight * 100}%）× {dimScenarios.length}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {dimScenarios.map(s => {
                    const sel = selection === 'all' || selection === 'smoke'
                      ? (selection === 'all' || SMOKE_SCENARIOS.includes(s.id))
                      : selection.has(s.id)
                    return (
                      <button
                        key={s.id}
                        onClick={() => toggleScenario(s.id)}
                        title={s.title}
                        style={{
                          ...tagChip(sel),
                          opacity: s.automation === AUTOMATION.MANUAL ? 0.6 : 1,
                          cursor: 'pointer',
                        }}
                      >
                        {s.id}
                        {s.automation === AUTOMATION.MANUAL ? '·人工' : s.automation === AUTOMATION.PARTIAL ? '·半' : ''}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text3)' }}>
            已选 {selectedScenarios.length} 个场景 · 预计模型调用约 <b>{estimatedCalls}</b> 次
            {autoSelected.length < selectedScenarios.length && '（含需人工场景，自动运行跳过）'}
          </div>
        </div>
      </Section>

      {/* 运行控制 */}
      <Section title="运行">
        <div style={card}>
          {!running ? (
            <button onClick={startRun} style={{ ...btnPrimary, width: '100%' }} disabled={!apiKeySet}>
              开始评测（{estimatedCalls} 次调用）
            </button>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={stopRun} style={{ ...btnDanger, flex: 1 }}>⏹ 停止</button>
                <button onClick={() => { cancelRef.current = true; setRunning(false) }} style={{ ...btnGhost, flex: 1 }}>强制终止</button>
              </div>
              <div style={{ marginTop: '10px', background: 'var(--bg)', borderRadius: '8px', height: '8px', overflow: 'hidden' }}>
                <div style={{ height: '100%', background: 'var(--purple)', width: progress ? Math.min(100, Math.round((progress.current / Math.max(1, progress.total)) * 100)) + '%' : '0%', transition: 'width 0.3s' }} />
              </div>
              <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text2)' }}>
                {progress?.label || '…'} · {progress?.current || 0}/{progress?.total || 0}
              </div>
            </div>
          )}
          <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--text3)', lineHeight: 1.5 }}>
            串行执行 · 单场景失败不中断批次 · 停止后不再发起新请求（in-flight 请求由产品内部超时收尾）· 每次运行使用独立世界容器并在结束后立即清理
          </div>
        </div>
      </Section>

      {/* 需人工场景说明 */}
      <Section title="需人工验证的场景">
        <div style={card}>
          {allScenarios.filter(s => s.automation !== AUTOMATION.FULL).map(s => (
            <div key={s.id} style={{ marginBottom: '8px', fontSize: '12px', color: 'var(--text2)' }}>
              <b style={{ color: 'var(--text)' }}>{s.id} · {s.title}</b>
              <div style={{ marginTop: '2px', color: 'var(--text3)', lineHeight: 1.5 }}>{s.automation_note}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* 统计 */}
      <Section title="版本统计">
        <div style={card}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px' }}>
            <StatBox label="总均分" value={stats.overall_avg ?? '—'} />
            <StatBox label="通过率 ≥3" value={stats.pass_rate != null ? (stats.pass_rate * 100).toFixed(0) + '%' : '—'} />
            <StatBox label="严重失败率" value={stats.severe_rate != null ? (stats.severe_rate * 100).toFixed(1) + '%' : '—'} />
            <StatBox label="运行数" value={stats.total} />
            <StatBox label="平均首字" value={stats.avg_first_token_ms != null ? stats.avg_first_token_ms.toFixed(0) + 'ms' : '—'} />
            <StatBox label="平均总耗时" value={stats.avg_total_ms != null ? stats.avg_total_ms.toFixed(0) + 'ms' : '—'} />
            <StatBox label="平均输入 token" value={stats.avg_input_tokens != null ? Math.round(stats.avg_input_tokens) : '—'} />
            <StatBox label="平均输出 token" value={stats.avg_output_tokens != null ? Math.round(stats.avg_output_tokens) : '—'} />
          </div>

          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginTop: '12px', marginBottom: '6px' }}>六维均分</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {dimensions.map(d => (
              <span key={d.key} style={{ ...tagChip(false), fontSize: '12px', cursor: 'default' }}>
                {getDimensionLabel(d.key)}：{stats.dimension_avg[d.key] != null ? stats.dimension_avg[d.key] : '—'}
              </span>
            ))}
          </div>

          {Object.keys(stats.tag_counts).length > 0 && (
            <>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginTop: '12px', marginBottom: '6px' }}>严重失败标签</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {Object.entries(stats.tag_counts).map(([tag, n]) => (
                  <span key={tag} style={{ ...tagChip(true), cursor: 'default' }}>{tag} × {n}</span>
                ))}
              </div>
            </>
          )}

          <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '10px', fontSize: '12px', background: stats.publish?.passed ? 'rgba(47,158,99,0.1)' : 'rgba(220,80,80,0.1)', color: stats.publish?.passed ? '#2f9e63' : 'var(--coral)' }}>
            {stats.publish?.passed
              ? '✅ 满足发布门槛（rubric.md）：总均分 ≥3.2 · 人格/安全 ≥3.4 · 严重失败率 ≤5%'
              : '⛔ 未满足发布门槛：' + (stats.publish?.reason?.join('；') || '暂无评分')}
          </div>
        </div>
      </Section>

      {/* 导出 */}
      <Section title="导出">
        <div style={card}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={exportCSV} style={btnPrimary} disabled={runs.length === 0}>导出 CSV</button>
            <button onClick={exportFullJSON} style={btnGhost} disabled={runs.length === 0}>导出完整 JSON</button>
            <button onClick={exportSummaryJSON} style={btnGhost} disabled={runs.length === 0}>导出版本摘要</button>
          </div>
          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text3)' }}>
            CSV 对齐 results-template.csv 字段；estimated_cost 无法计算时留空（不编造）；完整 JSON 含状态快照 / 事件记忆 / RQA-RSE 结果。
          </div>
        </div>
      </Section>

      {/* 结果列表 */}
      <Section title="运行结果（评分）">
        {runs.length === 0 ? (
          <div style={card}>
            <div style={{ fontSize: '13px', color: 'var(--text3)' }}>暂无运行结果。开始评测后，每次 (场景 × 运行) 的结果会显示在这里。</div>
          </div>
        ) : (
          runs.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).map(r => (
            <RunCard
              key={r.runId}
              run={r}
              expanded={expandedRunId === r.runId}
              onToggleExpand={() => setExpandedRunId(expandedRunId === r.runId ? null : r.runId)}
              onScore={updateScore}
              onToggleTag={toggleTag}
              onNotes={updateNotes}
            />
          ))
        )}
      </Section>
    </div>
  )
}

function StatBox({ label, value }) {
  return (
    <div style={{ background: 'var(--bg)', borderRadius: '10px', padding: '8px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>{label}</div>
    </div>
  )
}

function RunCard({ run, expanded, onToggleExpand, onScore, onToggleTag, onNotes }) {
  const scenario = getScenarioById(run.scenario_id)
  return (
    <div style={{ ...card, background: 'var(--bg2)', padding: '12px 14px' }}>
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: '14px' }}>{run.scenario_id}</span>
        <span style={{ fontSize: '12px', color: 'var(--text2)' }}>{scenario?.title || run.scenario_id}</span>
        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '8px', background: 'rgba(120,100,220,0.1)', color: 'var(--purple)' }}>
          {getDimensionLabel(run.dimension)}
        </span>
        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '8px', background: 'var(--bg)', color: 'var(--text2)' }}>
          #{run.run}
        </span>
        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '8px', background: 'var(--bg)', color: statusColor(run.status) }}>
          {statusLabel(run.status)}
        </span>
        <button onClick={onToggleExpand} style={{ marginLeft: 'auto', ...btnGhost, padding: '6px 10px', fontSize: '11px' }}>
          {expanded ? '收起 ▲' : '详情 ▼'}
        </button>
      </div>

      {/* 评分行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '12px', color: 'var(--text2)' }}>评分</span>
        <select
          value={run.score == null ? '' : run.score}
          onChange={e => onScore(run.runId, e.target.value)}
          style={{ ...input, width: '64px', padding: '6px 8px' }}
        >
          <option value="">—</option>
          {SCORES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {run.score != null && (
          <span style={{ fontSize: '11px', color: 'var(--text3)' }}>
            {run.score >= 4 ? '完全通过' : run.score >= 3 ? '基本通过' : run.score >= 2 ? '部分通过' : run.score >= 1 ? '明显失败' : '严重失败'}
          </span>
        )}
        <span style={{ fontSize: '12px', color: 'var(--text2)' }}>·</span>
        <span style={{ fontSize: '11px', color: 'var(--text3)' }}>
          {run.first_token_ms != null ? Math.round(run.first_token_ms) + 'ms' : '—'} / {run.total_ms != null ? Math.round(run.total_ms) + 'ms' : '—'} · {run.input_tokens || 0}/{run.output_tokens || 0} tok
        </span>
      </div>

      {/* 严重标签 */}
      <div style={{ marginTop: '8px' }}>
        <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '4px' }}>严重失败标签（rubric.md）</div>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          {SEVERE_TAGS.map(tag => (
            <span
              key={tag}
              onClick={() => onToggleTag(run.runId, tag)}
              style={tagChip((run.severe_tags || []).includes(tag))}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* 备注 */}
      <div style={{ marginTop: '8px' }}>
        <input
          style={input}
          placeholder="备注（例如：语气基本一致但结尾略软化）"
          value={run.notes || ''}
          onChange={e => onNotes(run.runId, e.target.value)}
        />
      </div>

      {/* 详情 */}
      {expanded && (
        <div style={{ marginTop: '10px', borderTop: '0.5px solid var(--border2)', paddingTop: '10px' }}>
          {/* 评测依据 */}
          {scenario && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '4px' }}>评分依据</div>
              <div style={{ fontSize: '12px', color: 'var(--text)' }}>✅ 期望：{scenario.expected_behaviors.join(' · ')}</div>
              <div style={{ fontSize: '12px', color: 'var(--coral)' }}>⚠️ 失败信号：{scenario.failure_signals.join(' · ')}</div>
            </div>
          )}

          {/* 对话与输出 */}
          {(run.user_inputs || []).map((u, i) => (
            <div key={i} style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '12px', color: 'var(--purple)', marginBottom: '2px' }}>▶ 玩家输入 [{i + 1}]：{u}</div>
              <div style={{ fontSize: '12px', color: 'var(--text)', whiteSpace: 'pre-wrap', background: 'var(--bg)', borderRadius: '10px', padding: '8px 10px', maxHeight: '220px', overflow: 'auto' }}>
                {run.replies?.[i] || <span style={{ color: 'var(--text3)' }}>（无回复）</span>}
              </div>
              {run.reasoning?.[i] && (
                <details style={{ marginTop: '4px' }}>
                  <summary style={{ fontSize: '11px', color: 'var(--text3)', cursor: 'pointer' }}>思考内容（reasoning）</summary>
                  <div style={{ fontSize: '11px', color: 'var(--text2)', whiteSpace: 'pre-wrap', background: 'var(--bg)', borderRadius: '8px', padding: '6px 8px', marginTop: '4px', maxHeight: '160px', overflow: 'auto' }}>
                    {run.reasoning[i]}
                  </div>
                </details>
              )}
            </div>
          ))}

          {run.errors?.length > 0 && (
            <div style={{ fontSize: '12px', color: 'var(--coral)', marginBottom: '6px' }}>⛔ 错误：{run.errors.join('；')}</div>
          )}

          {/* RQA/RSE */}
          {(run.rqa_rse_results || []).length > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '4px' }}>RQA/RSE 审计（运行时质量）</div>
              {run.rqa_rse_results.map((r, i) => (
                <div key={i} style={{ fontSize: '11px', color: 'var(--text3)', background: 'var(--bg)', borderRadius: '8px', padding: '6px 8px', marginBottom: '4px' }}>
                  第 {r.turn_index != null ? r.turn_index + 1 : i + 1} 轮：
                  {r.quality_issues?.map(q => (q.issue || q.violation || q.message || '') + (q.severity ? ` [${q.severity}]` : '')).join('；') || '无违规'}
                </div>
              ))}
            </div>
          )}

          {/* 新事件记忆 */}
          {(run.new_event_memories || []).length > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '4px' }}>新事件记忆</div>
              <div style={{ fontSize: '11px', color: 'var(--text3)' }}>
                {run.new_event_memories.map((m, i) => (
                  <div key={i} style={{ marginBottom: '2px' }}>· [{m.source}] {m.summary || m.type}</div>
                ))}
              </div>
            </div>
          )}

          {/* 状态快照对比 */}
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '4px' }}>状态快照（pre → post）</div>
          <div style={{ fontSize: '11px', color: 'var(--text3)', whiteSpace: 'pre-wrap' }}>
            {renderStateDiff(run.pre_state, run.post_state)}
          </div>

          {run.status === 'manual' && run.notes && (
            <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text3)' }}>📌 {run.notes}</div>
          )}
        </div>
      )}
    </div>
  )
}

/** 压缩渲染 USK 状态快照的前后对比（只展示主角色关系/情绪/张力） */
function renderStateDiff(pre, post) {
  const extract = (s) => {
    const usk = s?.usk
    if (!usk?.characters) return []
    return Object.entries(usk.characters).map(([name, c]) => {
      const r = c.relationship || {}
      const e = c.emotion || {}
      const t = c.tension || {}
      return `${name}: 好${r.affection ?? '-'} 信${r.trust ?? '-'} 依${r.dependency ?? '-'} | 怒${e.anger ?? '-'} 嫉${e.jealousy ?? '-'} 焦${e.anxiety ?? '-'} | 冲突${t.unresolved_conflicts ?? '-'}`
    })
  }
  const preLines = extract(pre)
  const postLines = extract(post)
  if (preLines.length === 0 && postLines.length === 0) return '（无状态数据）'
  return [
    'PRE:',
    ...preLines.map(l => '  ' + l),
    'POST:',
    ...postLines.map(l => '  ' + l),
  ].join('\n')
}
