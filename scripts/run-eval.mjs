/**
 * run-eval.mjs — 终端运行评测（冒烟测试）
 *
 * 用法（先静默暴露 Key，绝不出现在本会话明文里）：
 *   ! read -s -p "DeepSeek API Key: " K && echo "" && DEEPSEEK_API_KEY="$K" node scripts/run-eval.mjs && unset K
 *
 * 可选：
 *   PROBE=1 ...                      # 预检：只跑 M01×1
 *   SCENARIOS=P01,M01 ...            # 指定场景
 *   RUN_COUNT=1 ...                  # 每场景次数（默认 3）
 *   MODEL=deepseek-v4-flash ...      # 主模型
 *
 * 原则：
 *   - API Key 仅从环境变量读取，本脚本/日志绝不打印、绝不落盘明文。
 *   - 走真实产品链路（InteractionKernel.executeTurn → coordinator → NOS）。
 *   - 产品链路自身的 console.log 重定向到 eval-results/run-console.log，
 *     stdout 只保留 [EVAL] 进度（避免 ~100 次调用的日志刷屏）。
 *   - 每跑完一个 run 立即增量落盘（smoke-running.*），崩溃不丢数据。
 *   - 结果最终导出 eval-results/（CSV / 完整 JSON / 版本摘要）。
 *   - 每次运行独立世界容器，跑完立即清理，不污染正式数据。
 */

import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'eval-results')

// ── 0. 日志重定向：产品链路 console → 文件；[EVAL] 进度 → stdout ──
await mkdir(OUT_DIR, { recursive: true })
// Each run starts a clean log so old failures cannot be mistaken for current ones.
const _logStream = createWriteStream(path.join(OUT_DIR, 'run-console.log'), { flags: 'w' })
const _str = (a) => {
  if (typeof a === 'string') return a
  if (a instanceof Error) return (a.stack || a.message)
  try { return JSON.stringify(a) } catch { return String(a) }
}
const say = (...a) => process.stdout.write(a.join(' ') + '\n')
console.log = (...a) => _logStream.write('[LOG] ' + a.map(_str).join(' ') + '\n')
console.warn = (...a) => _logStream.write('[WARN] ' + a.map(_str).join(' ') + '\n')
console.error = (...a) => _logStream.write('[ERR] ' + a.map(_str).join(' ') + '\n')

// ── 1. API Key：环境变量或本地临时文件（读完即删，绝不打印/落日志）──
const KEY_FILES = [
  path.join(ROOT, '.eval-key.tmp'),
  path.join(ROOT, '请填写DeepSeekKey.txt'),
]
let API_KEY = process.env.DEEPSEEK_API_KEY || ''
if (API_KEY) {
  for (const file of KEY_FILES) await unlink(file).catch(() => {})
} else {
  for (const file of KEY_FILES) {
    try {
      const raw = await readFile(file, 'utf8')
      // The friendly file may contain Chinese instructions. Only accept a
      // printable ASCII token that looks like an API key, never the label.
      API_KEY = raw.split(/\r?\n/).map(line => line.trim())
        .find(line => /^sk-[\x21-\x7e]{16,}$/.test(line)) || ''
      if (API_KEY) break
    } catch { /* 尝试下一个文件 */ }
  }
  for (const file of KEY_FILES) await unlink(file).catch(() => {})
}
if (!API_KEY) {
  say('[EVAL] 未检测到 DEEPSEEK_API_KEY，也没有可用的本地临时密钥。')
  say('[EVAL] 请先在本会话静默写入密钥文件（明文不出现在对话里），然后我再运行：')
  say('  ! read -s -p "Paste DeepSeek API key: " K && printf "%s" "$K" > .eval-key.tmp && unset K && echo 已写入')
  process.exit(1)
}

// ── 2. 浏览器全局 polyfill（Node 下支撑产品链路）──
class MockStorage {
  constructor() { this.map = new Map() }
  get length() { return this.map.size }
  key(i) { return [...this.map.keys()][i] ?? null }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) { this.map.set(k, String(v)) }
  removeItem(k) { this.map.delete(k) }
  clear() { this.map.clear() }
}
globalThis.localStorage = new MockStorage()
globalThis.sessionStorage = new MockStorage()
globalThis.window = globalThis
globalThis.alert = () => {}
globalThis.confirm = () => true
globalThis.location = { search: '', href: '', pathname: '/' }
// navigator / addEventListener / dispatchEvent / CustomEvent 由 Node ≥24 原生提供，不覆盖

// 预置设置：Key 只进内存，不打印
localStorage.setItem('rp_settings', JSON.stringify({
  apiKey: API_KEY,
  model: 'deepseek-v4-flash',
  auditModel: 'deepseek-v4-flash',
}))

// ── 3. 参数 ──
const PROBE = process.env.PROBE === '1'
const RUN_COUNT = Math.max(1, Math.min(5, parseInt(process.env.RUN_COUNT, 10) || 3))
const MODEL = process.env.MODEL || 'deepseek-v4-flash'
const CONFIG = {
  temperature: 0.9,
  topP: 0.95,
  thinkingEnabled: false,
  contextWindow: 40,
}

// ── 4. 启动 Vite + 加载评测模块 ──
const server = await createServer({
  root: ROOT,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

const loader = await server.ssrLoadModule('/src/evals/scenarioLoader.js')
const runner = await server.ssrLoadModule('/src/evals/evaluationRunner.js')
const storage = await server.ssrLoadModule('/src/evals/evaluationStorage.js')
const exporter = await server.ssrLoadModule('/src/evals/exportResults.js')

const meta = loader.getEvalSetMeta()

// 场景集：默认冒烟 6 场景
let scenarioIds = loader.SMOKE_SCENARIOS
if (process.env.SCENARIOS) {
  scenarioIds = process.env.SCENARIOS.split(',').map(s => s.trim()).filter(Boolean)
}
if (PROBE) scenarioIds = ['M01']

const scenarios = scenarioIds.map(id => loader.getScenarioById(id)).filter(Boolean)
if (scenarios.length === 0) { say('[EVAL] 场景为空'); await server.close(); process.exit(1) }

// 预估只计 full 场景轮次（partial/manual 如 X01 标记 manual，不自动调用模型）
const autoScenarios = scenarios.filter(s => s.automation === 'full')
const perRunTurns = autoScenarios.reduce((a, s) => a + s.turns.length, 0)
const manualScenarios = scenarios.filter(s => s.automation !== 'full')
say(`[EVAL] 模型=${MODEL} · 场景=${scenarios.map(s => s.id).join(',')} · 每场景${RUN_COUNT}次 · ${perRunTurns}轮/次` + (manualScenarios.length ? `（${manualScenarios.map(s => s.id).join(',')} 标记 manual，不调用模型）` : ''))
say(`[EVAL] 预估主模型调用=${perRunTurns * RUN_COUNT}（真实链路每轮含 NDC 导演 + RSE 审计等，总量约 3 倍）`)
say(`[EVAL] 开始 ${PROBE ? '预检' : '冒烟'}运行（完整链路日志已写入 eval-results/run-console.log）…\n`)

// ── 5. 运行 + 增量落盘 ──
const t0 = Date.now()
let records = []
const persistRunning = async () => {
  const current = storage.getAllRuns()
  const metaRun = { version: meta.version, model: MODEL, run_mode: 'smoke-running', config: CONFIG, note: '增量写入，崩溃不丢数据' }
  await writeFile(path.join(OUT_DIR, 'smoke-running.csv'), exporter.buildResultsCSV(current), 'utf8')
  await writeFile(path.join(OUT_DIR, 'smoke-running.json'), exporter.serializeFullExport(exporter.buildFullExport(current, metaRun)), 'utf8')
}
records = await runner.runEvalBatch({
  scenarios,
  runCount: RUN_COUNT,
  model: MODEL,
  apiKey: API_KEY,
  version: meta.version,
  config: CONFIG,
  isCancelled: () => false,
  onProgress: (p) => {
    if (p.type === 'turn') {
      process.stdout.write(`  [EVAL] ${p.scenario_id}#${p.run} 第 ${p.turn_index + 1}/${p.turn_count} 轮…\r`)
    } else if (p.type === 'run_end') {
      const status = p.status === 'ok' ? '✅' : (p.status === 'error' || p.status === 'SYSTEM_FAILURE') ? '⛔' : '◐'
      say(`  [EVAL] ${p.scenario_id}#${p.run} ${status} ${p.status}`)
      persistRunning().catch(e => say('[EVAL] 增量落盘失败:', e.message))
    }
  },
})
const totalMs = Date.now() - t0

// ── 6. 导出 ──
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const stats = exporter.computeStats(records)

const metaExport = {
  version: meta.version,
  model: MODEL,
  run_mode: PROBE ? 'probe' : 'smoke',
  started_at: new Date(t0).toISOString(),
  finished_at: new Date().toISOString(),
  total_ms: totalMs,
  config: CONFIG,
  scenarios: scenarios.map(s => s.id),
  run_count: RUN_COUNT,
  note: '真实产品链路运行（InteractionKernel + coordinator + NOS）；人工评分留空待补。',
}

const csv = exporter.buildResultsCSV(records)
const full = exporter.buildFullExport(records, metaExport)
const summary = exporter.buildVersionSummary(records, metaExport)

const csvPath = path.join(OUT_DIR, `smoke-${ts}.csv`)
const fullPath = path.join(OUT_DIR, `smoke-full-${ts}.json`)
const summaryPath = path.join(OUT_DIR, `smoke-summary-${ts}.json`)
await writeFile(csvPath, csv, 'utf8')
await writeFile(fullPath, exporter.serializeFullExport(full), 'utf8')
await writeFile(summaryPath, exporter.serializeFullExport(summary), 'utf8')
await persistRunning()

await server.close()

// ── 7. 汇总 ──
say('\n' + '═'.repeat(56))
say(`耗时 ${(totalMs / 1000).toFixed(1)}s · 运行 ${records.length} 条`)
const _sf = records.filter(r => r.status === 'SYSTEM_FAILURE').length
say(`状态: ${records.filter(r => r.status === 'ok').length} 完成 · ${records.filter(r => r.status === 'error').length} 错误 · ${_sf} 系统失败 · ${records.filter(r => r.status === 'manual').length} 人工 · ${records.filter(r => r.status === 'skipped').length} 跳过`)
for (const r of records) {
  const s = r.status
  const c = s === 'ok' ? '✅' : (s === 'error' || s === 'SYSTEM_FAILURE') ? '⛔' : '◐'
  say(`  ${c} ${r.scenario_id}#${r.run} ${s.padEnd(6)} 首字${r.first_token_ms != null ? r.first_token_ms.toFixed(0) + 'ms' : '—'} 总${r.total_ms != null ? r.total_ms.toFixed(0) + 'ms' : '—'} tok ${r.input_tokens}/${r.output_tokens}${r.errors?.[0] ? '  ' + String(r.errors[0]).slice(0, 60) : ''}`)
}
if (stats.overall_avg != null) {
  say(`\n总均分 ${stats.overall_avg}（未含人工评分，留空待补）`)
}
say('\n结果文件：')
say(`  CSV    → ${csvPath}`)
say(`  完整   → ${fullPath}`)
say(`  摘要   → ${summaryPath}`)
say(`  链路日志 → ${path.join(OUT_DIR, 'run-console.log')}`)
say('提示：本次为终端运行，评分/严重标签按约定留空。')
say('终端运行的结果只存在于上述导出文件中（浏览器 ?eval=1 页面的存储是独立的，看不到本次记录）。')
say('如需在页面内补评分，请用浏览器 ?eval=1 运行该场景，或后续为评测页增加「导入终端结果」功能。')
