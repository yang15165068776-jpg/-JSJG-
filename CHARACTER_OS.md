# JSJG Character OS v1 — 角色操作系统架构规格

> 最后更新：2026-06-19 | 版本：v4.1 (USK)

---

## 一、核心理念

```
一个角色 = 一个账号（Persona Account）
状态     = 统一存储（USK）
模式     = 不同 App（Drama / Daily）
输出     = Renderer（UI 层）
```

系统本质不是 RP prompt 拼装，而是**角色操作系统**——角色有一个统一的"系统内核"，上面跑着不同的"应用"。

---

## 二、整体架构

```
                         ┌──────────────────────┐
                         │     USER LOGIN       │
                         │  (API Key → 身份)    │
                         └─────────┬────────────┘
                                   │
                         ┌─────────▼────────────┐
                         │   Persona Account    │
                         │  角色唯一身份         │
                         │  src/persona/        │  ✅ 已实现
                         └─────────┬────────────┘
                                   │
                     ┌─────────────▼─────────────┐
                     │   Unified State Kernel     │
                     │  全局状态（4 层，20 维）    │
                     │  src/state/               │  ✅ 已实现
                     └─────────────┬─────────────┘
                                   │
             ┌─────────────────────┴─────────────────────┐
             │                                           │
     ┌──────────────────────┐               ┌──────────────────────┐
     │   📖 DRAMA APP       │               │   💬 DAILY APP       │
     │   剧情模式入口        │               │   微信模式入口        │
     └─────────┬────────────┘               └─────────┬────────────┘
               │                                       │
     ┌─────────▼────────────┐               ┌─────────▼────────────┐
     │  DRAMA ENGINE        │               │  DAILY ENGINE        │
     │  Coordinator v3.5    │               │  LCA + Burst + Drift │
     │  + CPS + ASL + Power │               │  + Initiative Engine │
     │  ✅ 已实现            │               │  ⚠️ 部分实现         │
     └─────────┬────────────┘               └─────────┬────────────┘
               │                                       │
               └──────────────┬────────────────────────┘
                              ▼
                   ┌──────────────────────┐
                   │  OUTPUT RENDERER     │
                   │  小说体 / 微信气泡    │
                   │  ChatRoom.jsx UI     │  ✅ 已实现
                   └──────────────────────┘
```

---

## 三、三层分离（铁律）

```
人格（Persona Core）
  ↓  定义"是谁"
状态（USK）
  ↓  记录"关系到了哪一步"
模式（Engine + Renderer）
  ↓  决定"怎么表达"
输出
```

**不是：** 人格 → 模式 → 状态 → 输出（旧架构，状态被模式污染）

**而是：** 人格 → 状态 → 模式 → 输出（新架构，状态独立于模式）

---

## 四、Persona Account（角色账号层）

### 职责
- 定义角色是谁（不可随模式变化）
- 固定人格向量
- 初始化关系对象

### 实现
- `src/persona/personaCore.js` → `normalizeCharacter(raw, sourceMode)`
- 输入：日常模式 flat 角色 或 剧情模式 romanceCharacters
- 输出：`UnifiedPersona { characters: [...], dailyConfig, dramaConfig }`

### 铁律
- ❗ 模式不能改人设，只能改"表达方式"
- ❗ Persona 是只读归一化，不单独持久化
- ❗ characters[] 始终为数组（日常 = [1]，剧情 = [N]）

---

## 五、Unified State Kernel（USK 云状态）

### 职责
全模式共享的**唯一状态中心**。所有模式读取/写入同一份状态。

### 四层状态

| 层 | 字段 | 变化速度 | 用途 |
|---|------|---------|------|
| **L1 长期关系** | affection, trust, dependency, respect, fear, possessiveness | 极慢 | 所有模式 |
| **L2 当前情绪** | anger, sadness, jealousy, anxiety, curiosity, excitement | 快（每轮衰减） | 行为色彩 |
| **L3 关系张力** | unresolved_conflicts, emotional_pressure, attraction_tension, power_imbalance | 中 | 戏剧性 |
| **L4 生活状态** | busy, tired, lonely, social_need, mood | 中（时间推移） | 日常驱动 |

### 事件记忆
- 结构化存储：`{ type, summary, impact: { trust: -5, anger: +10 } }`
- 不是压缩对话，是事件流
- 上限 100 条

### 实现
- `src/state/unifiedStateKernel.js` ✅
- 存储 key：`jsjg_usk_<characterId>`
- 自动从旧 MemoryGraph 迁移

---

## 六、DRAMA APP（剧情模式）

### 定位
高张力互动、冲突剧情推进、权力关系变化

### 内部引擎
```
✅ Coordinator v3.5 (10-phase loop)
✅ CPS (Conflict Persistence System)
✅ ASL v1 (Alignment Suppression Layer)
✅ v3.5 Power Dynamics Engine
✅ v2.2 Event-Native Memory Graph
✅ EPI Anti-Smoothing
```

### 输出风格（Drama Renderer）
- 小说式段落
- 强行为描写
- 情绪通过动作表达
- 不解释、不讨好、不修复关系
- `StoryReplyBlock` 组件

### 实现
- Engine: `src/agents/coordinator.js`
- Prompt: `src/prompt/v3/narratorPrompt.js` + CORE_SYSTEM_PREFIX
- UI: ChatRoom.jsx `StoryReplyBlock`

---

## 七、DAILY APP（微信模式）

### 定位
日常聊天、轻互动、活人感、碎片化表达

### 内部引擎
```
⚠️ sendDailyChatMessage (v2 legacy) — 待升级到 USK
📋 待实现: LCA (Lightweight Chat Architecture)
📋 待实现: Message Burst (碎片气泡引擎)
📋 待实现: Context Drift (话题漂移)
✅ Initiative Engine (主动消息判定)
```

### 输出风格（Daily Renderer）
```
规则:
1. 每条输出 ≤ 2 行
2. 每条只表达一个信息点
3. 可拆成多气泡（||| 分隔）
4. 禁止解释行为
5. 禁止总结

示例 —
不是: "我刚刚在想你，但是不知道要不要打扰你"
而是: "我刚刚在想你" / "但没敢找你"
或者: "有点累" / "今天不太想说话"
```

### 实现
- Engine: `src/utils/deepseek.js` → `sendDailyChatMessage()` ⚠️
- Prompt: `buildDailySystemPrompt()` ⚠️
- UI: ChatRoom.jsx `StoryBubble`

---

## 八、模式切换逻辑

### 规则
```
用户点击切换 → DRAMA APP 或 DAILY APP

系统执行:
1. 不改变 USK（状态连续）
2. 不重置关系
3. 只切换 Engine + Renderer
4. 调用 applyModeTransition(usk, fromMode, toMode)
```

### 跨模式状态传递

| 事件 | Drama 效果 | 切到 Daily 表现 |
|------|-----------|----------------|
| 大吵架 | trust-15, anger+40 | 回复变慢、态度变冷 |
| 关系升温 | trust+10, affection+5 | 主动发消息概率↑ |
| 冷战 | unresolved_conflicts+1 | 社交孤立感↑ |

### 实现
- UI: ChatRoom.jsx header `currentMode` toggle ✅
- Logic: `applyModeTransition()` in USK ✅

---

## 九、主动消息系统（Initiative Engine）

### 只在 DAILY APP 生效

```js
initiative_score =
  lonely × 0.25 +
  affection × 0.20 +
  dependency × 0.15 +
  curiosity × 0.15 +
  social_need × 0.15 +
  possessiveness × 0.10
  - busy × 0.20
  - tired × 0.10
```

### 触发阈值

| 分数 | 条件 | 行为 |
|------|------|------|
| > 85 | +3 轮沉默 | 强触发（紧急度 0.9） |
| > 75 | +5 轮沉默 | 中触发（紧急度 0.7） |
| > 65 | +8 轮沉默 | 弱触发（紧急度 0.5） |
| lonely > 85 | 无其他条件 | 无条件触发（紧急度 0.95） |
| jealousy > 80 | — | 嫉妒驱动触发 |

### 示例消息
> "刚刚突然想到你"
> "你在干嘛"
> "今天好累……"
> "（发了一张模糊的照片）"

### 实现
- `computeInitiativeScore()` in USK ✅
- `shouldSendAutonomousMessage()` in USK ✅
- ChatRoom `triggerActiveCheck()` — 待接入 USK ⚠️

---

## 十、实现状态总览

| 模块 | 状态 | 文件 |
|------|------|------|
| Persona Core | ✅ 完成 | `src/persona/personaCore.js` |
| USK (4-layer state) | ✅ 完成 | `src/state/unifiedStateKernel.js` |
| USK ↔ MemoryGraph sync | ✅ 完成 | `syncToMemoryGraph()` |
| Drama Engine | ✅ 完成 | `src/agents/coordinator.js` |
| Drama Renderer | ✅ 完成 | `StoryReplyBlock` in ChatRoom |
| Daily Engine | ⚠️ 待升级 | `sendDailyChatMessage()` (legacy) |
| Daily Renderer | ✅ 完成 | `StoryBubble` in ChatRoom |
| Mode Switch | ✅ 完成 | `currentMode` toggle |
| Initiative Engine | ✅ 逻辑完成 | `computeInitiativeScore()` |
| Initiative → UI trigger | ⚠️ 待接入 | ChatRoom `triggerActiveCheck()` |
| Event Memory | ✅ 完成 | `recordEvent()` |
| Old archive migration | ✅ 完成 | `migrateFromArchive()` |

---

## 十一、下一步（按优先级）

### P0: Daily Engine 接入 USK
- `sendDailyChatMessage()` 从 USK 读取状态（替代 `archive.affection`）
- 日常回复风格受 USK 四层状态影响
- 每次发送后 `recordEvent()` + `updateInitiative()`

### P1: Daily Renderer 强化
- Prompt 中强化短句碎片规则
- 根据 USK 情绪层调整语气（愤怒 → 更短更冷，好奇 → 稍微多字）
- `buildDailySystemPrompt()` 注入 USK 状态快照

### P2: Initiative Engine 全量接入
- `triggerActiveCheck()` 改为读取 `shouldSendAutonomousMessage()`
- 主动消息内容由 USK 情绪层驱动
- 不同紧急度 → 不同消息风格

### P3: 自动模式切换
- 根据 USK 状态自动建议模式切换
- 例如：Drama 模式冲突升级到一定程度 → 提示可以切到 Daily "冷静一下"

---

## 十二、系统定位（最终形态）

```
你不是在做 RP 系统
你是在做 Character OS（角色操作系统）

像一个手机：
📱 打开就是角色
📖 可以打开"剧情 App"——小说式深度互动
💬 可以打开"微信 App"——碎片化日常聊天
🔄 状态完全连续
🧠 角色像真实存在
```
