# JSJG Character OS — 前端 UI 架构文档

> 仓库：https://github.com/yang15165068776-jpg/-.git
> 部署：https://jsjg.vercel.app
> 生成日期：2026-06-20

给另一个 AI 看的完整架构说明。包含文件结构、路由、CSS 设计系统、数据模型、核心页面详解、引擎 API、开发规范。

---

## 技术栈

React 18 + Vite 6 | 内联 CSS 变量样式 | localStorage 全客户端 | DeepSeek API | 自建路由引擎

---

## 文件树（src/ 下）

```
App.jsx                    # 根组件：430px手机壳 + StatusBar + 路由分发
main.jsx                   # ReactDOM.createRoot 入口
index.css                  # CSS变量(:root) + Tailwind reset + 动画keyframes

engine/                    # 引擎层
  navigationEngine.js      # 路由栈 push/pop/back + CustomEvent
  hydrationEngine.js       # 内存缓存 save/get/hydrate
  interactionKernel.js     # 交互内核：消息/好感/token/turn 状态机
  agentDecisionLayer.js    # 角色决策层：规则评分->选行为

state/                     # 状态层
  unifiedStateKernel.js    # USK：4层20维角色状态(+文件夹USK)
  uskApi.js                # USK 访问：init/read/write/patch/tick
  stateBridge.js           # UI-USK 桥接(支持文件夹USK模式)
  folderStore.js           # Folder/Save/PlayerProfile CRUD

pages/                     # 页面（v6全部新建）
  Entry.jsx                # 首页(三栏布局)
  PlayerProfile.jsx        # 玩家设定
  CreateFolder.jsx         # 创建世界(AI生成+角色编辑器内联)
  FolderInterior.jsx       # 存档大厅(两级:选存档->选模式)
  DramaPage.jsx            # 剧情模式(段落叙事+流式输出)
  DailyPage.jsx            # 日常模式(微信气泡)
  CharacterEditor.jsx      # 角色编辑器(全字段)
  Settings.jsx             # API Key设置

components/                # UI组件
  StatusBar.jsx            # 手机顶栏
  ProgressBar.jsx          # 进度条(好感度/Tension)
  EventActionPanel.jsx     # 剧情浮动面板(骰子+编辑+删除+张力)
  StatusPanel.jsx          # 日常右侧状态面板
  Toast.jsx                # 全局提示

agents/                    # 智能体(不可动)
  coordinator.js           # v3每轮编排
  npcAgent.js              # NPC意图决策(9种)

runtime/                   # 运行时引擎(不可动)
  affectionRules.js        # 好感规则评分
  affectionTrigger.js      # 好感触发判断
  conflictPersistence.js   # CPS冲突持续
  powerDynamics.js         # 权力动力学
  antiSmoothing.js         # EPI极端人格稳定
  alignmentSuppression.js  # ASL对齐检测
  tokenBudget.js           # Token预算

memory/                    # 记忆系统
  memoryGraph.js           # 事件原生图
  contextBuilder.js        # 上下文构建
  workingMemory.js         # 工作记忆(6轮)
  episodeSummarizer.js     # 情节摘要

utils/
  deepseek.js              # DeepSeek API调用
  storage.js               # localStorage存取

hooks/
  useAutoMessage.js        # 自动消息(仅legacy ChatRoom)
```

---

## 路由

```js
// App.jsx 中通过 NavigationEngine 驱动：
NavigationEngine.push('dramaPage', { folder: folderObj })  // 前进
NavigationEngine.back()                                      // 后退

// 路由表：
entry          -> Entry.jsx
profile        -> PlayerProfile.jsx
createFolder   -> CreateFolder.jsx
folder         -> FolderInterior.jsx
dramaPage      -> DramaPage.jsx
dailyPage      -> DailyPage.jsx
characterEditor-> CharacterEditor.jsx
settings       -> Settings.jsx
```

---

## CSS 设计系统

```css
:root {
  --bg: #ffffff;        --bg2: #f5f4f0;       --bg3: #ebebeb;
  --text: #222222;      --text2: #666666;      --text3: #999999;
  --border: #e6e6e6;    --border2: rgba(0,0,0,0.06);
  --purple: #7F77DD;    --purple-l: #EEEDFE;   /* 好感度 */
  --teal: #1D9E75;      --teal-l: #E1F5EE;     /* 正面 */
  --coral: #D85A30;     --coral-l: #FAECE7;    /* 负面/张力 */
}
```

规则：禁止Tailwind、禁止暗黑模式、禁止霓虹渐变阴影、圆角8-14px、430px手机壳

样式写法：
```jsx
// 正确
<div style={{ padding: '12px', background: 'var(--bg)', color: 'var(--text)' }}>

// 错误
<div className="p-3 bg-white text-gray-900">
```

---

## 数据模型

### Folder（localStorage['jsjg_folders']）
```js
{ id, name, worldview, story_intro,
  characterData: [{ id, name, avatar, personality, background, speakingStyle,
    styleRules:[], forbiddenWords:[], worldSetting, openingScenario,
    affectionEnabled, affectionInitial,
    affectionStages: [{ name, min, max, behavior, coreState, playerStrategy }],
    thinkingEnabled, activeMessageEnabled, activePrompt,
    temperature, topP, contextWindow,
    npcs: [{ name, relationship, personality }] }],
  characterIds:[], saveIds:[], createdAt, updatedAt }
```

### Save（localStorage['jsjg_folder_saves_(id)']）
```js
{ id, folderId, name, dramaMessages:[], dailyMessages:[], createdAt, updatedAt }
```

### USK（localStorage['jsjg_folder_usk_(id)']）
```js
{ version:1, folderId,
  characters: { [name]: {
    relationship: { affection, trust, dependency, respect, fear, possessiveness },
    emotion: { anger, sadness, jealousy, anxiety, curiosity, excitement },
    tension: { unresolved_conflicts, emotional_pressure, attraction_tension, power_imbalance },
    life: { busy, tired, lonely, social_need, mood, initiative_score } } },
  global_state: { world_tension, folder_mood },
  event_memory:[],
  initiative: { score, consecutivePassiveTurns } }
```

---

## 核心页面：DramaPage.jsx 详解

### Props
```js
{ folderId: string, folderChars: object[], onBack: () => void }
```

### 状态（15个 useState）
messages, input, loading, streamingText, error, affection, affections, affectionFlash, tension, showDice, diceResult, diceRolling, saveId, lastDecision

### 布局（从上到下）
1. Header：返回按钮 + "角色名·剧情"
2. 进度条区：好感度条 + 加减2按钮 + 决策指示器 + token统计 + 压缩按钮
3. 叙事区：段落消息列表 + 流式光标 + loading动画
4. EventActionPanel：骰子/编辑/删除/张力值
5. 输入区：textarea + 发送按钮
6. 骰子弹窗

### 消息类型与渲染
- 玩家(user)：左缩进24px + "主角"标签
- AI(assistant)：左边框2px solid + 【角色名】分段解析 + 开场剧情徽章
- 系统(system)：
  - silent：居中斜体灰色
  - interruptCtx：coral色标签
  - isSummary：灰色圆角卡片

### 每条消息悬停显示按钮（opacity 0->1过渡）
- 玩家消息：编辑(回输入栏)、删除(该条+后续)
- AI消息：重刷(玩家原话回输入栏)、删除(仅该条)
- immutable消息（开场剧情）无按钮

### 发送完整流程
```
doSend(userText)
  buildCharacterForLLM()          合并worldview + 传递behavior/affectionStages等
  InteractionKernel.executeTurn() 核心：decision + silent/interrupt + coordinator + USK写回
  setXxx()                        更新所有React state
```

### buildCharacterForLLM 传递的字段
id, name, chatStyle:'story', worldSetting, openingScenario, behavior, personality, background, speakingStyle, styleRules, forbiddenWords, activeMessageEnabled, activePrompt, romanceCharacters(含affectionStages/behavior), npcs, affectionStages, temperature, topP, thinkingEnabled, contextWindow

---

## 引擎层 API

### InteractionKernel
```js
InteractionKernel.init(folderId, chars, mode, hydrateData?)  // 初始化->state snapshot
InteractionKernel.executeTurn(userText, apiKey, streamCb, char)  // 完整一轮->result
InteractionKernel.getLastUserMessage()  // { content, _index }
InteractionKernel.rollbackTo(index)
InteractionKernel.deleteLastPair()
InteractionKernel.deleteMessageAtIndex(idx)
InteractionKernel.editMessageAtIndex(idx, newContent)
InteractionKernel.getUserMsgBefore(assistantIdx)  // 重刷用
InteractionKernel.manualAffectionAdjust(charName, delta)  // 手动加减好感
InteractionKernel.getDecision()  // { type, intensity, burst, emotion, reason, urgency }
InteractionKernel.getTokenUsage()  // { promptTokens, completionTokens, totalTokens, cacheHitRate, turnCount }
InteractionKernel.compressMessages()  // { summary }
InteractionKernel.getState()  // 完整snapshot
InteractionKernel.persistMessages()
InteractionKernel.incrementPassiveTurns()
```

executeTurn 返回：
```js
{ reply, reasoningContent, usage, error, messages, updatedAffections,
  affectionFlash, affection, tension, decision, silent, turnReport, worldState }
```

silent=true 时 reply 为 null，messages 中有系统沉默消息。

### AgentDecisionLayer
```js
AgentDecisionLayer.decide({ uskState, lastMessages, mode, turnCount, passiveTurns })
  // -> { type, intensity, burst, emotion, reason, urgency }
  // type: normal_reply|interrupt|emotional_burst|initiate_chat|silent

AgentDecisionLayer.evaluateState(...)  // 5维评分
AgentDecisionLayer.shouldAutoSpeak(...)  // { shouldSpeak, reason, urgency }
```

决策矩阵（优先级递减）：
- conflictScore>70 -> interrupt(burst 2-3)
- jealousyScore>65 -> emotional_burst(burst 2-3)
- neglectScore>70 -> silent(burst 0)
- attachmentScore>60+neglectScore>40 -> initiate_chat
- default -> normal_reply

---

## 其他页面简述

### Entry.jsx
三栏：左34%(世界卡片+删除按钮) | 中flex(大头像+名字) | 右30%(创建+设置按钮)

### DailyPage.jsx
微信气泡UI，|||分隔多段弹出，左侧角色侧边栏+右侧StatusPanel(完整USK 4层)，未接入InteractionKernel

### FolderInterior.jsx
两级：选存档 -> 底部弹窗选剧情/日常模式

### CreateFolder.jsx
AI生成按钮 -> DeepSeek自动填充 -> 每个角色可展开卡片编辑

### CharacterEditor.jsx
全字段编辑，好感度阶段配置，safeInt/safeFloat数值输入

---

## 开发规范

1. 样式：内联style+CSS变量，禁止Tailwind
2. 数值：safeInt/safeFloat，禁止 parseInt||50（0是falsy会被吃掉）
3. 引擎层不可动：runtime/ agents/ memory/ world/ prompt/
4. 状态层谨慎动：state/（改动需测试）
5. UI层随意动：pages/ components/
6. 禁止复用legacy组件
7. 消息隔离：dramaMessages/dailyMessages永不相交

---

## 已知问题

1. CharacterEditor与CreateFolder编辑器代码重复
2. DailyPage未接入InteractionKernel（直接调sendDailyChatMessage）
3. Settings有Tailwind残留
4. DailyPage delta:0硬编码
5. useAutoMessage仅legacy ChatRoom用
6. reasoningContent已不渲染但coordinator仍在生成
