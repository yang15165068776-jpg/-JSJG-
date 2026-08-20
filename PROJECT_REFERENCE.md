# JSJG Character OS v4.2 — 完整项目架构与代码参考

> 生成日期：2026-06-19 | 总代码量：~15,250 行 | 文件数：53

---

## 一、系统分层架构

```
┌─────────────────────────────────────────────────────────┐
│ UI Layer (React)                                         │
│   ChatRoom.jsx, ModeSelect.jsx, Settings.jsx             │
│   CharacterForm.jsx, StoryCharacterForm.jsx              │
│   TypingIndicator.jsx                                    │
├─────────────────────────────────────────────────────────┤
│ Hooks Layer                                              │
│   useAutoMessage.js — USK-driven autonomous messaging    │
├─────────────────────────────────────────────────────────┤
│ State Bridge                                             │
│   stateBridge.js — UI ↔ USK_API connector                │
│   uskApi.js — USK_API facade (init/read/write/patch)    │
├─────────────────────────────────────────────────────────┤
│ Unified State Kernel (USK v1.0)                          │
│   unifiedStateKernel.js — 4-layer, 20-dimension state    │
│   sharedState.js — MemoryGraph wrapper (legacy compat)   │
├─────────────────────────────────────────────────────────┤
│ Persona Layer                                            │
│   personaCore.js — UnifiedPersona normalization          │
├─────────────────────────────────────────────────────────┤
│ Runtime Engines                                          │
│   ASL v1 — alignmentSuppression.js (highest priority)    │
│   CPS — conflictPersistence.js                           │
│   v3.5 — powerDynamics.js                                │
│   Mode Translator — modeTranslator.js                    │
│   EPI — antiSmoothing.js                                 │
│   Affection — affectionRules.js, affectionTrigger.js     │
├─────────────────────────────────────────────────────────┤
│ Agent System (Drama Engine)                              │
│   coordinator.js — 10-phase main loop                    │
│   npcAgent.js — Deterministic NPC AI                     │
│   worldEngine.js — Time/Location/Character registry      │
│   eventBus.js — Pub/sub event system                     │
├─────────────────────────────────────────────────────────┤
│ Memory System                                            │
│   memoryGraph.js — Event-native relationship graph       │
│   contextBuilder.js — 3-layer structured prompt output   │
│   eventMemory.js — Compact event formatting              │
│   eventExtractor.js, stateDiffEngine.js                  │
│   workingMemory.js, episodeSummarizer.js, semanticMemory │
├─────────────────────────────────────────────────────────┤
│ Prompt Layer                                             │
│   cachePrefix.js — CORE_SYSTEM_PREFIX (cached)           │
│   narratorPrompt.js — v3 narrator prompt builder         │
│   buildPromptV2.js — v2 legacy prompt wrapper            │
├─────────────────────────────────────────────────────────┤
│ API / Storage                                            │
│   deepseek.js — API calls + legacy prompt builders       │
│   storage.js — localStorage CRUD                         │
└─────────────────────────────────────────────────────────┘
```

---

## 二、完整文件清单

### 入口与配置

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/main.jsx` | 10 | React 入口 |
| `src/index.css` | — | Tailwind + 动画 |
| `src/App.jsx` | 217 | 状态路由（page + mode 双状态机） |
| `index.html` | — | SPA 入口 |
| `vite.config.js` | — | Vite 配置 |
| `tailwind.config.js` | — | Tailwind 配置 |
| `vercel.json` | — | Vercel SPA rewrite |

### 页面层 (src/pages/)

| 文件 | 行数 | 职责 |
|------|------|------|
| `ChatRoom.jsx` | 2,042 | ★ 核心对话页 — 双模式渲染 + USK + 自动消息 |
| `StoryCharacterForm.jsx` | 1,165 | 剧情角色创建（可攻略角色+NPC+世界观） |
| `CharacterForm.jsx` | 1,064 | 日常角色创建 |
| `Settings.jsx` | 306 | API Key / 模型 / 头像 |
| `ModeSelect.jsx` | 45 | 首页模式选择 |
| `CharacterList.jsx` | — | 通用角色列表 |
| `ArchiveList.jsx` | — | 对话存档列表 |
| `DirectChat.jsx` | — | 直接对话（无角色设定） |
| `story/*` | wrapper | 剧情模式 wrapper 层（5 文件） |
| `daily/*` | wrapper | 日常模式 wrapper 层（4 文件） |

### 状态层 (src/state/) ★ 核心

| 文件 | 行数 | 职责 |
|------|------|------|
| `unifiedStateKernel.js` | 870 | USK v1.0 — 4 层 20 维状态引擎 |
| `uskApi.js` | 295 | USK_API 门面 — 唯一状态访问入口 |
| `stateBridge.js` | 207 | UI ↔ USK_API 连接器 |
| `sharedState.js` | 298 | MemoryGraph 薄封装（兼容旧代码） |

### 角色层 (src/persona/)

| 文件 | 行数 | 职责 |
|------|------|------|
| `personaCore.js` | 360 | 角色归一化 — `normalizeCharacter()` |

### 运行时层 (src/runtime/) ★ 引擎

| 文件 | 行数 | 职责 |
|------|------|------|
| `alignmentSuppression.js` | 368 | ★ ASL v1 — 对齐反制层（最高优先级） |
| `conflictPersistence.js` | 601 | ★ CPS — 冲突持续系统 |
| `powerDynamics.js` | 687 | ★ v3.5 — 权力结构引擎 |
| `antiSmoothing.js` | 873 | EPI — 人设防漂移 |
| `modeTranslator.js` | 227 | 状态 → 模式行为翻译 |
| `affectionRules.js` | 135 | v3 规则好感度判定 |
| `affectionTrigger.js` | — | 关键词启发式触发 |
| `personaIntegrity.js` | — | PersonaShield |
| `tokenBudget.js` | — | Token 预算控制 |
| `llmState.js` | — | 集中状态管理（旧） |

### 智能体层 (src/agents/)

| 文件 | 行数 | 职责 |
|------|------|------|
| `coordinator.js` | 675 | ★ 10 阶段主循环 — Drama Engine |
| `npcAgent.js` | 390 | ★ NPC 确定性规则引擎（意图矩阵+权力感知） |

### 世界层 (src/world/)

| 文件 | 行数 | 职责 |
|------|------|------|
| `worldEngine.js` | 321 | 时间/位置/角色注册表/事件日志 |
| `eventBus.js` | 161 | 发布-订阅事件总线（6 种事件类型） |

### 记忆层 (src/memory/)

| 文件 | 行数 | 职责 |
|------|------|------|
| `memoryGraph.js` | 355 | ★ 事件原生记忆图 |
| `contextBuilder.js` | 244 | ★ 三层结构化上下文构建器 |
| `eventMemory.js` | 145 | 紧凑事件格式化 |
| `eventExtractor.js` | — | 事件提取器 |
| `stateDiffEngine.js` | — | 状态差异引擎 |
| `workingMemory.js` | — | Layer 1: 工作记忆 |
| `episodeSummarizer.js` | — | Layer 2: 片段摘要 |
| `semanticMemory.js` | — | Layer 3: 语义记忆 |

### Prompt 层 (src/prompt/)

| 文件 | 行数 | 职责 |
|------|------|------|
| `cachePrefix.js` | 141 | ★ CORE_SYSTEM_PREFIX |
| `v3/narratorPrompt.js` | 298 | ★ v3 叙事者 prompt 构建器 |
| `v2/buildPromptV2.js` | — | v2 兼容包装 |

### Hooks 层 (src/hooks/)

| 文件 | 行数 | 职责 |
|------|------|------|
| `useAutoMessage.js` | 197 | ★ USK 驱动自动消息 Hook |
| `TypingIndicator.jsx` | 53 | 微信风 "正在输入…" 动画 |

### 工具层 (src/utils/)

| 文件 | 行数 | 职责 |
|------|------|------|
| `deepseek.js` | 2,202 | API 调用 + v2 prompt 备用 + 好感度裁判 |
| `storage.js` | 295 | localStorage CRUD |
| `writing-samples.txt` | — | 写作范本（~5000 tokens） |

---

## 三、数据流（完整链路）

```
用户输入
  ↓
ChatRoom.doSend()
  ├─ currentMode === 'daily'
  │   ├─ StateBridge.dailyTurnStart(charName, userInput)
  │   │   └─ USK_API.tick() → advanceLife + decayEmotions + updateInitiative
  │   ├─ sendDailyChatMessage(character, messages, affection, apiKey, usk, persona)
  │   │   └─ prompt += buildStateSnapshot(usk, charName, 'daily')
  │   ├─ StateBridge.dailyTurnEnd(charName, { reply })
  │   │   └─ USK_API.write({ type:'daily_chat', ... })
  │   └─ USK_API.persist()
  │
  └─ currentMode === 'drama'
      ├─ StateBridge.dramaTurnStart(charName, userInput)
      │   ├─ USK_API.tick()
      │   └─ syncToMemoryGraph() → coordinator reads edges
      ├─ runAgentTurn(userInput, character, affections, messages, apiKey, onToken, usk)
      │   ├─ Phase 1: World Engine advance
      │   ├─ Phase 2: NPC Agents (power-aware)
      │   ├─ Phase 3: Event Bus → narrative hints
      │   ├─ Phase 4: Affection scoring (rule + optional LLM)
      │   ├─ Phase 5: CPS advance + Power Dynamics shift
      │   ├─ Phase 6: Narrator prompt (v3)
      │   ├─ Phase 7: 6-layer message assembly
      │   ├─ Phase 8: LLM call (single)
      │   ├─ Phase 9a: ASL validation
      │   └─ Phase 9b: Persist Graph/CPS/Power
      ├─ StateBridge.dramaTurnEnd(charName, result)
      │   └─ USK_API.write() for affection deltas + conflict events
      └─ USK_API.persist()

后台:
  useAutoMessage hook (每 30s)
    → USK_API.read() → shouldSendAutonomousMessage()
    → initiative > 阈值 → pickMessage() → displayActiveMessages()
```

---

## 四、USK v1.0 数据结构

```js
USK = {
  version: 1,
  characterId, characterName,
  meta: { last_update, active_mode: "DRAMA"|"DAILY" },

  characters: {
    "角色名": {
      // Layer 1: Long-term relationship
      relationship: {
        affection,      // 0-100  好感度
        trust,          // 0-100  信任
        dependency,     // 0-100  依赖
        respect,        // 0-100  尊重
        fear,           // 0-100  恐惧
        possessiveness, // 0-100  占有欲
      },
      // Layer 2: Current emotion (decays per turn)
      emotion: {
        anger, sadness, jealousy, anxiety, curiosity, excitement
      },
      // Layer 3: Relationship tension
      tension: {
        unresolved_conflicts, emotional_pressure,
        attraction_tension, power_imbalance
      },
      // Layer 4: Life state
      life: {
        busy, busyness, tired, lonely, loneliness,
        social_need, mood, initiative_score
      }
    }
  },

  event_memory: [
    { id, type, summary, impact: {}, mode, turn, timestamp }
  ],

  initiative: { score, lastActiveMessageAt, consecutivePassiveTurns },
  global: { currentMode, lastModeSwitch, turnCount }
}
```

---

## 五、USK_API 接口

```js
// 初始化（ChatRoom mount 时调用一次）
USK_API.init(persona, { mode: 'drama'|'daily' })

// 读状态（返回快照，非引用）
USK_API.read(charName) → { relationship, emotion, tension, life, meta }

// 写事件（唯一状态修改路径）
USK_API.write(event, charName) → updated snapshot
// event types: conflict, intimacy, rejection, absence, rupture, daily_chat

// 批量修改
USK_API.patch(delta, charName) → updated snapshot

// 深拷贝
USK_API.snapshot() → full USK clone

// 仅记录事件
USK_API.log_event(event)

// 时间推进
USK_API.tick(charName, minutesSinceLast) → updated snapshot

// 模式切换
USK_API.switchMode(toMode)
```

---

## 六、Coordinator 10 阶段主循环

```
Phase 1:  World Engine 推进时间
Phase 2:  NPC Agents 并行决策（确定性，0 LLM）
Phase 3:  Event Bus 处理队列 → 叙事提示
Phase 4:  规则好感度判定 + 可选 LLM 裁判
Phase 5:  CPS 推进 + 冲突检测 + Power Dynamics 权力转移
Phase 6:  构建 v3 Narrator prompt（首轮全量注入，后续缓存）
Phase 7:  组装 6 层消息数组
          Layer 0: System Prompt (CORE_SYSTEM_PREFIX + 首轮缓存块 + 每轮可变)
          Layer 1: Power State
          Layer 2: CPS Injection
          Layer 3: Event Memory
          Layer 4: Working Memory
          Layer 5: ASL Reinforcement
          Layer 6: User Input
Phase 8:  单次 streamCompletion 调 LLM
Phase 9:  ASL 验证 + 状态持久化
Phase 10: 回合报告输出
```

---

## 七、系统优先级

```
ASL v1 (Alignment Suppression)         ← 最高优先级硬覆盖
  ↓
CPS (Conflict Persistence)             ← 冲突持续
  ↓
v3.5 (Power Dynamics)                  ← 权力结构
  ↓
v3 (NPC Agent + World Engine)          ← 多智能体
  ↓
v2.2 (Event-Native Memory Graph)       ← 记忆
  ↓
LLM Output
```

---

## 八、Token 经济

| | v2 | v3.5 + ASL |
|---|---|---|
| 首轮 input | ~9,700 | ~7,650 |
| 后续轮 input | ~9,700 | ~1,650 |
| 100 轮合计 | ~970,000 | ~172,000 |
| 节省 | — | **-82%** |

缓存策略：CORE_SYSTEM_PREFIX + 首轮缓存块（写作范本/人设/ASL规则）DeepSeek 自动前缀缓存，后续轮次仅可变部分（~250 tokens）计费。

---

## 九、存储键一览

| 键 | 用途 |
|---|------|
| `jsjg_usk_<characterId>` | USK v1.0 状态 |
| `jsjg_memory_graph_<characterId>` | Memory Graph |
| `jsjg_cps_<characterId>` | CPS 冲突状态 |
| `jsjg_power_graph_<characterId>` | Power Dynamics |
| `jsjg_auto_msg` | 自动消息开关 |
| `story_characters` / `daily_characters` | 角色定义（旧，保留兼容） |
| `story_chat_archives` / `daily_chat_archives` | 对话存档（消息+好感度兼容） |
| `rp_settings` | API Key / 模型 / 头像 |
