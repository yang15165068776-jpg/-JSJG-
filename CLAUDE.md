# JSJG — AI 多智能体交互叙事引擎

> 一个让**角色拥有连续人生**的交互叙事运行时。多智能体决策 + 显式管线编排 + Writer-Reviewer 双模型闭环。
> 仓库：https://github.com/yang15165068776-jpg/-JSJG-

---

## 项目定位

用户创建角色与世界观后，多个「角色智能体」在同一个故事里持续行动、对话、推进关系，而非被动等待用户输入。核心闭环：

```
欲望（为什么想）→ 行动（必须做什么）→ 事件（世界发生什么）→ 执行（生成正文）→ 状态写回（下轮可读）
```

角色拥有持久动机、主动行为权、独立情绪数值与记忆图谱——不是"每轮重新扮演"，而是"拥有一段连续的人生"。

## 技术栈

- **前端**：React 18 + Vite（无重型 UI 依赖，组件自绘，内联 CSS 变量，430px 手机壳布局）
- **数据**：localStorage 持久化（存档隔离，per-save 命名空间）
- **LLM**：DeepSeek V4 API（128K 上下文，prefix caching），支持思考模式与流式输出
- **文档**：docx（`generate-portfolio.mjs` 自动导出项目架构文档）

---

## 核心架构

### Runtime 自主叙事闭环

每一轮运行经过 **RuntimeOrchestrator**（`src/runtime/runtimeOrchestrator.js`）的 23 步显式 Pipeline：

```
① 输入解析 → ③ 状态同步（USK）→ ⑤ 行为决策（3 核并行）→ ⑦ 导演决策（Scene Card）
→ ⑧ prompt 组装（分层缓存）→ ⑨ 主模型流式生成 → ⑩ RSE 审计 → ⑪ 定向修复
→ ⑫ RQA 审计 → ⑬ 状态写回 → ⑭ 持久化
```

每一步是独立的、可插拔的、可观测的模块。新能力通过往 Pipeline 数组追加 step 接入，不侵入 `executeTurn`。

### 行为决策核（生成前决定角色"本轮做什么"）

| 决策核 | 职责 | 层级 |
|--------|------|------|
| `darkActionKernel.js` | 社交/关系层面的行为强度（冷淡 → 冲突 → 关系破坏） | 5 级 |
| `desireKernel.js` | 情感张力的推进节奏 | 5 级 |
| `characterInitiativeKernel.js` | 物理行动的权限与范围 | 5 级 |

每个角色按人格画像（攻略型 / 对抗型 / 高冷型 / 温和型）拥有独立基准等级与上限，指令随人格与关系阶段差异化生成。

### Writer-Reviewer 双模型闭环

- **Writer**：主模型流式生成叙事正文。
- **Reviewer（RSE Supervisor）**：flash 模型独立审计（10 维质量维度），产出"具体违规 + 原文位置 + 替换方案"。
- **定向修复（Targeted Fix）**：违规与修改方案回传主模型，只修改问题部分、其余逐字保留——避免整段重写带来的风格漂移。

### 记忆与一致性

- **Fact Ledger**（`factLedger.js`）：不可篡改事实账本（身份 / 行为 / 关系 / 禁令四类事实），注入 prompt 顶层约束。含衣着/物理状态的一致性追踪（脱衣后不会凭空穿回）。
- **Event Graph**（`eventGraph.js`）：结构化事件节点 + 因果链追溯，每个事件必须有前因。
- **状态闭环**：每轮生成后从回复文本抽取状态变化（信任 / 依赖 / 张力 / 亲密四维），写回世界状态，下轮读取。
- **Memory Graph**：记忆分层（工作记忆 / 语义记忆 / 事件记忆 / 情景总结），支持重进存档恢复。

### 导演与自主性

- **Director OS**（`narrativeDirectorOS.js`）：5 个导演决策（场景评估 / 调性 / 焦点角色 / 冲突等级 / 叙事动作）输出"本幕戏卡"，由独立 flash 模型每轮生成。
- **自主性五层栈**：AIIS（日常自主消息）→ ANDS（剧情角色主动性）→ DAS（世界事件）→ DCS（导演控制）→ NDOS（统一导演大脑）。
- **CIE + TOM**（`characterIntentEngine.js` + `turnObjectiveManager.js`）：角色持久心理动机 + 每轮行动目标调度。

### Prompt 分层缓存（HOT / WARM / COLD）

基于 LLM 的 recency bias 特性分区注入：系统铁律进缓存前缀（`prompt/cachePrefix.js`）、角色人设缓存于每轮（`prompt/characterPrefix.js`）、高优先级指令置于距生成最近的热区（HOT 0–2K tokens）。`promptLayerDiagnostic.js` 逐层展示 token 消耗与可见性。

---

## 目录结构

```
src/
├── runtime/        # 运行时引擎（行为核 / 导演 / 审计 / 状态写回）
│   ├── runtimeOrchestrator.js   # 23 步显式 Pipeline 主时钟
│   ├── darkActionKernel.js      # 行为决策核 1（关系行为强度）
│   ├── desireKernel.js          # 行为决策核 2（情感张力推进）
│   ├── characterInitiativeKernel.js  # 行为决策核 3（物理行动权限）
│   ├── narrativeDirectorOS.js   # 导演大脑（Scene Card）
│   ├── rse.js                   # Reviewer 审计 + 定向修复方案
│   ├── rqa.js                   # 运行时质量审计（10 维）
│   ├── factLedger.js            # 不可篡改事实账本
│   ├── eventGraph.js            # 事件图谱 + 因果链
│   ├── responsePolicy.js        # 确定性安全守卫
│   └── characterExecutionKernelV4.js  # 叙事导演执行内核
├── prompt/         # 分层缓存前缀（CORE / CHARACTER / VARIABLE）
├── agents/         # Agent 协调器（NPC 决策 + LLM 调用编排）
├── evals/          # 自动化评估（场景集 / 确定性规则 / 结果导出）
├── memory/         # 记忆分层（工作 / 语义 / 事件 / 情景）
├── state/          # 统一状态核（USK）+ 故事正典
├── pages/          # 交互界面（剧情 / 日常 / 角色编辑）
└── world/          # 世界引擎（事件总线 / 关系力场）
scripts/
├── run-eval.mjs    # 运行评估集
└── verify-eval.mjs # 回归校验（npm run verify）
showcase/           # 静态介绍页（纯 HTML，无构建依赖）
```

---

## 常用命令

```bash
npm install        # 安装依赖
npm run dev        # 本地开发（设置页填入 DeepSeek API Key 与模型名）
npm run build      # 生产构建
npm run preview    # 预览构建产物
npm run verify     # 自动化评估回归（26 场景确定性校验）
node generate-portfolio.mjs   # 重新生成作品集 docx
```

---

## 开发规则

- **加新层**：在 `RuntimeOrchestrator` Pipeline 数组里加一个 step，不碰 `executeTurn`。
- **引擎层**（`runtime/`）— 所有新模块通过 RuntimeOrchestrator 编排。
- **状态层**（`state/`）— 通过 `stateBridge` 读写，不直触 raw USK。
- **UI 层**（`pages/`）— 只消费 State Snapshot，不做逻辑决策。
- **存档隔离**：所有 per-save 存储均含 `saveId`；`dramaMessages` / `dailyMessages` 永不交叉。
- **数值默认值**：用 `??` 不用 `||`（0 是合法值），初始化数值时检查 NaN。
- **人格分级**：任何行为指令必须考虑四级人格（攻略型 / 对抗型 / 高冷型 / 温和型），不能一刀切。
- **质量门禁**：改动影响生成逻辑时跑 `npm run verify` 回归；涉及构建的改动跑 `npm run build`。
- **Debug**：调试弹窗用 `alert()`，常规日志用 `console.log`。

---

## 内容治理与对外原则

本仓库是**秋招对外展示的纯净版**：

1. **确定性安全守卫**（`responsePolicy.js`）：高优先级、确定性的封闭式防护——戏剧写作指令不得覆盖三类约束：事实锚定（Fact Ledger 真实事实）、操作安全、未决的具体修复步骤。全规则驱动、无 LLM 依赖、可单测。
2. **自动化评估回归**（`evals/` + `scripts/verify-eval.mjs`）：26 场景评测集 + 发布级确定性检查（含安全拒绝、玩家自主权、叙事一致性），不依赖"另一个模型恰好注意到问题"。
3. **仓库纪律**：本仓库是干净展示件，**不允许提交任何露骨/不当内容**（含注释、示例、文档、历史）。露骨词扫描应保持干净。
4. **双模型审计**：生成后 RSE / RQA 独立审计，发现违规走定向修复而非静默放行。

---

## 版本演进（节选）

| 版本 | 里程碑 |
|------|--------|
| v7.0–7.7 | 叙事状态机 · 双行为核 · 关系力场 · 事实账本 · 角色宪法 |
| v8.0–8.4 | NOS 运行时 · 自主性五层栈（AIIS/ANDS/DAS/DCS/NDOS） |
| v8.5–8.9 | 缓存前缀架构 · CEK 执行内核 · RQA 审计 · 导演闭环 |
| v9.1 | CIE 角色主动意识引擎 + TOM 回合目标调度器 |
| v9.2 | Runtime 自主叙事闭环（CDL→CAC→DAS→AEL→SML 状态写回） |
