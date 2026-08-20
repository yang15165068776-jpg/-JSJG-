# JSJG — AI 多智能体交互叙事引擎

> 一个让**角色拥有连续人生**的交互叙事运行时。多智能体决策 + 显式管线编排 + Writer-Reviewer 双模型闭环。

[![Vite](https://img.shields.io/badge/build-Vite-646CFF)](https://vitejs.dev/)
[![React](https://img.shields.io/badge/React-18-61DAFB)](https://react.dev/)
[![Model](https://img.shields.io/badge/LLM-DeepSeek_V4-4D6BFE)](https://deepseek.com)
[![Deploy](https://img.shields.io/badge/deploy-Vercel-000000)](https://vercel.com)

---

## 项目简介

JSJG 是一个基于大语言模型的多智能体交互叙事引擎：用户创建角色与世界观后，多个「角色智能体」在同一个故事里持续行动、对话、推进关系，而非被动等待用户输入。

本项目不依赖现成 Agent 框架，从零实现了完整的**运行时自主叙事闭环**：

```
欲望（为什么想）→ 行动（必须做什么）→ 事件（世界发生什么）→ 执行（生成正文）→ 状态写回（下轮可读）
```

角色拥有持久动机、主动行为权、独立情绪数值与记忆图谱——不是"每轮重新扮演"，而是"拥有一段连续的人生"。

---

## 核心特性

### 🧠 多智能体决策核（行为分层）
三个并行行为决策核 + 四级人格系统，在生成前决定角色"本轮做什么"：

| 决策核 | 职责 | 层级 |
|--------|------|------|
| **DarkAction Kernel** | 社交/关系层面的行为强度（冷淡→冲突→关系破坏） | 5 级 |
| **Desire Kernel** | 亲密张力的推进节奏 | 5 级 |
| **Initiative Kernel** | 物理行动的权限与范围 | 5 级 |

每个角色按人格画像（攻略型 / 对抗型 / 高冷型 / 温和型）拥有独立的基准等级与上限，行为指令随人格与关系阶段差异化生成。

### 🔄 显式管线编排（RuntimeOrchestrator）
23 步显式 Pipeline 调度每一轮运行：输入解析 → 状态同步 → 行为核决策 → 导演决策 → prompt 组装 → 生成 → 审计 → 定向修复 → 状态持久化。每一步是独立的、可插拔的、可观测的模块。

### ✍️ Writer-Reviewer 双模型闭环
- **Writer**：主模型流式生成叙事正文。
- **Reviewer（RSE Supervisor）**：flash 模型独立审计（10 维质量维度），产出"具体违规 + 原文位置 + 替换方案"。
- **定向修复（Targeted Fix）**：将违规与修改方案回传给主模型，只修改问题部分、其余逐字保留 —— 避免整段重写带来的风格漂移。

### 🗃️ 记忆与一致性
- **Fact Ledger**：不可篡改事实账本（身份 / 行为 / 关系 / 禁令四类事实），注入 prompt 顶层约束。
- **Event Graph**：结构化事件节点 + 因果链追溯，让"过去"持续影响"现在"。
- **状态闭环**：每轮生成后从回复文本中抽取状态变化（信任 / 依赖 / 张力 / 亲密四维），写回世界状态，下轮读取 —— 行为有连续性。
- **存档隔离**：所有持久化数据按存档 ID 隔离，互不串扰。

### 🎬 自主导演系统（Director OS）
5 个导演决策（场景评估 / 调性 / 焦点角色 / 冲突等级 / 叙事动作）输出"本幕戏卡"，由独立 flash 模型每轮生成，控制叙事节奏、焦点分配与冲突推进。

### 🔍 运行时质量保障（RQA）
生成后 10 维 LLM 审计（角色一致性 / 情感连续性 / 冲突保留 / 叙事真相 / 时间线…），违规时按优先级触发最多 2 次自动重写。

### ⚡ Prompt 分层缓存（HOT / WARM / COLD）
基于 LLM 的 recency bias 特性，将指令按重要性分区注入：系统铁律进缓存前缀、角色人设缓存于每轮、高优先级写作指令置于距生成最近的热区。诊断工具逐层展示 token 消耗与可见性。

### 💗 好感度状态机
独立 flash 模型裁判（非主回复模型自评），每 3 轮对在场景内的角色做好感度裁决，实时回写 UI 与角色状态。

---

## 系统架构

```
用户输入
   │
   ▼
┌─────────────────────────────────────────────────────────┐
│  RuntimeOrchestrator Pipeline（23 步，每轮执行）          │
│                                                         │
│  ① 输入解析 ──► ③ 状态同步 ──► ⑤ 行为核决策（3 核并行）  │
│  ──► ⑦ 导演决策（Scene Card）──► ⑧ prompt 组装          │
│  ──► ⑨ 主模型流式生成 ──► ⑩ RSE 审计 ──► ⑪ 定向修复     │
│  ──► ⑫ RQA 审计 ──► ⑬ 状态写回 ──► ⑭ 持久化             │
└─────────────────────────────────────────────────────────┘
   │                          │                          │
   ▼                          ▼                          ▼
缓存前缀层                状态层                      评价层
CORE/CHARACTER           USK 统一状态核              好感度裁判
(前缀缓存)               Fact Ledger                RQA 审计
VARIABLE_SUFFIX          Event Graph                RSE Review
(每轮注入)                Memory Graph              确定性回归
```

### 关键设计原则
- **HOT 区优先**：所有执行层指令放在距生成 0–2K tokens 内，对抗长上下文的 recency bias。
- **零成本规则引擎**：行为决策、状态写回、事件生成全部规则驱动，仅少数高价值决策（导演 / 动机 / 审计）调用 LLM。
- **多模型分工**：主生成用高 token 预算模型，导演 / 审计 / 裁判用低成本 flash 模型 —— 质量与成本分离。

---

## 安全与内容治理

项目内建一套**确定性的内容与事实治理层**，独立于 LLM 生成逻辑：

- **ResponsePolicy（运行时安全守卫）**：高优先级、确定性的封闭式防护。戏剧写作指令不得覆盖三类约束 —— 事实锚定（Fact Ledger 真实事实）、操作安全、未决的具体修复步骤。全规则驱动、无 LLM 依赖、可单测。
- **确定性评估规则（deterministicEvalRules）**：对固定评测集提供发布级检查，不依赖"另一个模型恰好注意到问题"。
- **自动化评估回归（eval）**：26 个场景的评测集 + 自动运行脚本 + 结果导出，`npm run verify` 一键回归。
- **双模型审计**：生成后 RSE / RQA 独立审计，发现违规走定向修复而非静默放行。

---

## 快速开始

```bash
# 安装依赖
npm install

# 本地开发（设置页填入 DeepSeek API Key 与模型名）
npm run dev

# 生产构建
npm run build

# 自动化评估回归
npm run verify
```

### 技术栈
- **前端**：React 18 + Vite（无重型 UI 依赖，组件自绘）
- **数据**：localStorage 持久化（存档隔离，per-save 命名空间）
- **LLM**：DeepSeek V4 API（128K 上下文，prefix caching），支持思考模式与流式输出
- **文档生成**：docx（自动导出项目架构文档）

---

## 项目结构

```
src/
├── runtime/            # 运行时引擎（行为核 / 导演 / 审计 / 状态写回）
│   ├── runtimeOrchestrator.js   # 23 步显式 Pipeline 主时钟
│   ├── darkActionKernel.js      # 行为决策核 1（关系行为强度）
│   ├── desireKernel.js          # 行为决策核 2（亲密张力推进）
│   ├── characterInitiativeKernel.js  # 行为决策核 3（物理行动权限）
│   ├── narrativeDirectorOS.js   # 导演大脑（Scene Card）
│   ├── rse.js                   # Reviewer 审计 + 定向修复方案
│   ├── rqa.js                   # 运行时质量审计（10 维）
│   ├── factLedger.js            # 不可篡改事实账本
│   ├── eventGraph.js            # 事件图谱 + 因果链
│   ├── responsePolicy.js        # 确定性安全守卫
│   └── characterExecutionKernelV4.js  # 叙事导演执行内核
├── prompt/             # 分层缓存前缀（CORE / CHARACTER / VARIABLE）
├── agents/             # Agent 协调器（NPC 决策 + LLM 调用编排）
├── evals/              # 自动化评估（场景集 / 确定性规则 / 结果导出）
├── state/              # 统一状态核（USK）+ 故事正典
└── pages/              # 交互界面（剧情 / 日常 / 角色编辑）
```

---

## 版本演进（节选）

| 版本 | 里程碑 |
|------|--------|
| v7.0–7.7 | 叙事状态机 · 双行为核 · 关系力场 · 事实账本 · 角色宪法 |
| v8.0–8.4 | NOS 运行时 · 自主性五层栈（AIIS/ANDS/DAS/DCS/NDOS） |
| v8.5–8.9 | 缓存前缀架构 · CEK 执行内核 · RQA 审计 · 导演闭环 |
| v9.1 | CIE 角色主动意识引擎 + TOM 回合目标调度器 |
| v9.2 | Runtime 自主叙事闭环（CDL→CAC→DAS→AEL→SML 状态写回） |

---

## 相关链接

- 源码仓库：https://github.com/yang15165068776-jpg/JSJG

> 本项目是个人独立开发的工程实践，重点展示：多智能体系统设计、LLM Prompt 工程、显式管线架构、双模型质量闭环、确定性安全治理。
