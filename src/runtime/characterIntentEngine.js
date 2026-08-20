/**
 * 🧠 CIE — Character Intent Engine v1
 *
 * "角色不再是回应者，而是剧中人——他们有自己的欲望、恐惧和计划。"
 *
 * Core principle:
 *   CEK v4 controls HOW characters perform.
 *   CIE tells CEK WHY — what the character persistently wants.
 *
 * Without CIE:
 *   ❌ Characters react to player input — push → move, no push → idle
 *   ❌ No persistent psychological motivation across turns
 *   ❌ Character behavior is turn-by-turn, not arc-driven
 *
 * With CIE:
 *   ✅ Characters have long-term psychological goals (desire, fear, conflict)
 *   ✅ Every turn's behavior is anchored in persistent motivation
 *   ✅ Characters act proactively — they want things even when the player is passive
 *
 * Architecture:
 *   CIE runs periodically (every 5-8 turns or on stage change) via flash model.
 *   Output is persisted in module state + localStorage.
 *   TOM (Turn Objective Manager) consumes CIE output each turn.
 *   CEK v4 consumes TOM output to guide character behavior execution.
 *
 * Flow:
 *   Character Settings → CIE (persistent intents) → TOM (turn objectives) → CEK → Reply
 */

import { getAuditModel } from '../utils/storage'
import { getCurrentAffectionStage } from '../utils/deepseek'
import { detectAggressionProfile, AGGRESSION_PROFILES } from './aggressionProfile'

// ═══════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════

const BASE_URL = 'https://api.deepseek.com'
const FLASH_MODEL = 'deepseek-v4-flash'
const STORAGE_PREFIX = 'jsjg_cie_'
const DEFAULT_INTERVAL = 6 // Run CIE every 6 turns

// ═══════════════════════════════════════════════════════════
// Module-Level State
// ═══════════════════════════════════════════════════════════

const _state = {
  intents: new Map(),       // charName → CIEOutput
  lastRunTurn: 0,           // last turn CIE ran
  runInterval: DEFAULT_INTERVAL,
  stageKeys: new Map(),     // charName → last stage key (detect stage changes)
  turnCount: 0,             // local turn counter
  lastError: null,          // last error message for debugging
}

// ═══════════════════════════════════════════════════════════
// 1. Flash Model API Call
// ═══════════════════════════════════════════════════════════

async function _callFlash(prompt, apiKey) {
  if (!apiKey) return { raw: '', error: 'No API key' }

  try {
    const model = getAuditModel() || FLASH_MODEL
    const response = await fetch(BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是 JSON 输出机。只输出合法 JSON。禁止任何其他文字。' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 2048,  // 🔧 v4 思考: 预留 reasoning_content 预算
        temperature: 0.1,
        stream: false,
      }),
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      return { raw: '', error: errData.error?.message || `API ${response.status}` }
    }

    const data = await response.json()
    const raw = data.choices?.[0]?.message?.content || ''
    return { raw }
  } catch (err) {
    return { raw: '', error: err.message }
  }
}

// ═══════════════════════════════════════════════════════════
// 2. JSON Extraction (robust against markdown wrapping)
// ═══════════════════════════════════════════════════════════

function _extractJSON(raw) {
  if (!raw || !raw.trim()) return null

  // Try direct parse first
  try {
    return JSON.parse(raw)
  } catch (_) {
    // continue
  }

  // Try extracting from markdown code block
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch (_) {
      // continue
    }
  }

  // Try finding first { ... } block
  const braceMatch = raw.match(/\{[\s\S]*\}/)
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0])
    } catch (_) {
      // continue
    }
  }

  console.warn('[CIE] Failed to extract JSON from:', raw.slice(0, 200))
  return null
}

// ═══════════════════════════════════════════════════════════
// 3. CIE Prompt Builder
// ═══════════════════════════════════════════════════════════

function _buildCIEPrompt(character, usk) {
  const rcList = character?.romanceCharacters || []
  if (rcList.length === 0) return null

  // Build character context blocks
  const charBlocks = rcList.map(rc => {
    const aff = usk?.characters?.[rc.name]?.relationship?.affection ?? rc.affectionInitial ?? 50
    const stage = getCurrentAffectionStage(rc, aff)
    const profile = detectAggressionProfile(rc)
    return [
      `【${rc.name}】`,
      `  人格关键词：${rc.personality || '未设定'}`,
      `  背景：${(rc.background || '').slice(0, 300)}`,
      `  侵略性分类：${profile || 'unknown'}`,
      `  当前好感度：${aff}`,
      `  当前关系阶段：${stage?.name || '初始'}`,
      `  说话风格：${(rc.speakingStyle || '').slice(0, 200)}`,
    ].join('\n')
  }).join('\n\n')

  const playerName = character?._playerProfile?.name || '玩家'
  const worldSetting = (character?.worldSetting || '').slice(0, 500)

  return `你是角色主动意识系统（Character Intent Engine）。

你的职责不是生成回复。
你的职责是分析角色当前心理状态，并生成角色下一阶段的主动意图。

【世界观】
${worldSetting || '未设定'}

【玩家】
${playerName}

【角色设定】
${charBlocks}

【核心规则】
禁止：
- 顺从玩家意愿
- 默认玩家正确
- 只分析玩家行为
- 直接写台词
- 让角色成为玩家的附属反应器

你必须为每个角色回答以下问题：

1. 当前角色真正想要什么？（primary_intent）
   — 必须来自角色人格，不是玩家要求。角色有独立于玩家的欲望。

2. 当前角色的次要目标是什么？（secondary_intent）
   — 如果首要目标受阻，角色会转向什么？

3. 当前角色正在避免什么？（fear）
   — 角色最怕发生的事。驱动回避行为。

4. 当前角色最深层的欲望是什么？（desire）
   — 可能连角色自己都没完全意识到的渴望。影响所有决策的底层动力。

5. 当前角色最大的心理矛盾是什么？（conflict）
   — 两个互相冲突的欲望/恐惧。角色被困在这个矛盾里。

6. 如果玩家停止行动，角色会主动做什么？（autonomous_action）
   — 角色不是被动等待的NPC。他们有自己的议程。

7. 当前关系中，角色想推动什么变化？（relationship_direction）
   — 角色想把关系带向哪里？拉近、推远、重新定义、还是维持现状但改变权力结构？

【输出格式 — 严格 JSON】
{
  "characters": {
    "角色名": {
      "primary_intent": "角色真正想要什么——用角色的语言，不是分析语言",
      "secondary_intent": "如果主要目标受阻的备选方向",
      "fear": "角色最恐惧的结果",
      "desire": "底层欲望——可能角色自己都没完全意识到",
      "conflict": "角色的核心心理矛盾——两个互相冲突的驱动力",
      "autonomous_action": "如果玩家不行动，角色会主动做什么",
      "relationship_direction": "角色想推动关系往哪个方向变化"
    }
  }
}

【质量要求】
- primary_intent 必须具体，不能是"维持关系"这种空洞表述
  好："让玩家主动证明她不会离开——制造危机测试她的忠诚"
  差："和玩家互动"
- fear 必须来自角色背景和人格
  好："害怕自己一旦暴露真实需求就会失去掌控权"
  差："害怕被讨厌"
- autonomous_action 必须可执行
  好："故意在公共场合和第三人亲近，观察玩家反应"
  差："做点什么"
- 每个角色的 intent 必须互不相同——即使在同一场景里，不同角色的欲望应该冲突或互补

只输出 JSON。不要任何其他文字。`
}

// ═══════════════════════════════════════════════════════════
// 4. Rule-Based Fallback (when flash model fails)
// ═══════════════════════════════════════════════════════════

function _buildFallbackIntent(rc, affection, usk) {
  const profile = detectAggressionProfile(rc)
  const stage = getCurrentAffectionStage(rc, affection)
  const stageName = stage?.name || '初始'

  // Base intents by aggression profile
  const profileIntents = {
    [AGGRESSION_PROFILES.PURSUER]: {
      primary_intent: '提高玩家对自己的投入程度——制造不可预测的局面让玩家无法松懈',
      secondary_intent: '测试玩家忠诚度的边界——看看她到底能忍到什么程度',
      fear: '玩家看穿自己的套路，发现交易本质后离开',
      desire: '获得一个无论如何都不会离开的人——即使看到最坏的一面',
      conflict: '想要完全占有玩家，但又不愿意自己被占有——渴望控制但恐惧对等',
      autonomous_action: '故意在玩家面前和别人暧昧，观察她的反应——如果她不生气就加大剂量',
      relationship_direction: '推动关系进入更深的依赖——让玩家离不开自己，但自己保持自由',
    },
    [AGGRESSION_PROFILES.CONFRONTATIONAL]: {
      primary_intent: '让玩家承认自己的重要性——通过对抗和否定来证明她在乎',
      secondary_intent: '找到一个可以发泄情绪又不会被抛弃的安全出口',
      fear: '自己其实不被需要——所有对抗都是独角戏',
      desire: '被无条件接纳——即使自己浑身是刺',
      conflict: '想靠近但只会用推开的方式表达——越在乎越恶劣',
      autonomous_action: '故意找茬挑起争吵——只有看到玩家情绪波动才能确认自己在她心里有分量',
      relationship_direction: '测试关系底线——想知道到什么程度对方才会真的离开',
    },
    [AGGRESSION_PROFILES.ALOOF]: {
      primary_intent: '保持情感安全距离——不让任何人靠得太近以免暴露弱点',
      secondary_intent: '观察玩家的真实意图——判断她值不值得破例',
      fear: '一旦打开心防就会被利用或抛弃',
      desire: '有一个能看穿自己冷淡外表却不离开的人',
      conflict: '渴望被理解但拒绝主动表达——希望对方自己看穿',
      autonomous_action: '突然冷淡疏远——测试玩家会不会主动靠近，如果她不靠近就证明不在乎',
      relationship_direction: '维持现状但暗中评估——等待玩家证明自己值得信任',
    },
    [AGGRESSION_PROFILES.GENTLE]: {
      primary_intent: '让玩家感到被珍视——通过温柔的方式建立安全感',
      secondary_intent: '确认自己的温柔不是单向付出——期待回应',
      fear: '自己的温柔被当作理所当然，最终被辜负',
      desire: '一段温暖但深刻的关系——温柔不等于肤浅',
      conflict: '想要表达不满但害怕破坏和谐——压抑带来内耗',
      autonomous_action: '用退出的姿态表达受伤——不是威胁，是真实的脆弱流露',
      relationship_direction: '推动关系更亲密但害怕操之过急——在靠近和克制之间摇摆',
    },
  }

  const base = profileIntents[profile] || profileIntents[AGGRESSION_PROFILES.CONFRONTATIONAL]

  // Adjust based on affection level
  let intensityMod = ''
  if (affection < 25) {
    intensityMod = '（低好感强化：更不信任，更多测试，更少投入）'
  } else if (affection > 75) {
    intensityMod = '（高好感强化：更多占有欲，更害怕失去，更主动维护关系）'
  }

  return {
    primary_intent: base.primary_intent + intensityMod,
    secondary_intent: base.secondary_intent,
    fear: base.fear,
    desire: base.desire,
    conflict: base.conflict,
    autonomous_action: base.autonomous_action,
    relationship_direction: base.relationship_direction,
    _fallback: true,
  }
}

// ═══════════════════════════════════════════════════════════
// 5. Stage Change Detection
// ═══════════════════════════════════════════════════════════

function _detectStageChanges(character, usk) {
  const rcList = character?.romanceCharacters || []
  for (const rc of rcList) {
    const aff = usk?.characters?.[rc.name]?.relationship?.affection ?? rc.affectionInitial ?? 50
    const stage = getCurrentAffectionStage(rc, aff)
    const newKey = `${rc.name}:${stage?.name || '?'}:${Math.round(aff / 10) * 10}`
    const oldKey = _state.stageKeys.get(rc.name)
    if (oldKey && oldKey !== newKey) {
      return true // Stage changed for at least one character
    }
    _state.stageKeys.set(rc.name, newKey)
  }
  return false
}

// ═══════════════════════════════════════════════════════════
// 6. Public API
// ═══════════════════════════════════════════════════════════

/**
 * Tick the CIE engine — decide if re-computation is needed.
 * Called from coordinator.js BEFORE the NDC director pass.
 *
 * @param {object} character — full character descriptor
 * @param {object} usk — USK state
 * @param {number} turnCount — current turn number
 * @param {string} apiKey — DeepSeek API key
 * @returns {Promise<Map|null>} — CIE state map (charName → CIEOutput) or null if no change
 */
export async function tickCIE(character, usk, turnCount, apiKey) {
  if (!character?.romanceCharacters?.length) return null

  _state.turnCount = turnCount

  // Determine if re-computation is needed
  const stageChanged = _detectStageChanges(character, usk)
  const periodicRefresh = (turnCount - _state.lastRunTurn) >= _state.runInterval
  const isFirstRun = _state.intents.size === 0

  if (!stageChanged && !periodicRefresh && !isFirstRun) {
    return _state.intents // Return cached state
  }

  console.log('[CIE] Running intent computation (turn=' + turnCount +
    ', stageChanged=' + stageChanged +
    ', periodic=' + periodicRefresh +
    ', firstRun=' + isFirstRun + ')')

  const prompt = _buildCIEPrompt(character, usk)
  if (!prompt) return _state.intents

  const { raw, error } = await _callFlash(prompt, apiKey)

  if (error || !raw) {
    console.warn('[CIE] Flash call failed, using fallback:', error || 'empty response')
    _state.lastError = error || 'empty response'

    // Use rule-based fallback for all characters
    const rcList = character.romanceCharacters || []
    const fallbackMap = new Map()
    for (const rc of rcList) {
      const aff = usk?.characters?.[rc.name]?.relationship?.affection ?? rc.affectionInitial ?? 50
      fallbackMap.set(rc.name, _buildFallbackIntent(rc, aff, usk))
    }
    _state.intents = fallbackMap
    _state.lastRunTurn = turnCount
    return _state.intents
  }

  // Parse JSON response
  const parsed = _extractJSON(raw)
  if (!parsed || !parsed.characters) {
    console.warn('[CIE] Failed to parse JSON, using fallback. Raw:', raw.slice(0, 200))
    _state.lastError = 'JSON parse failed'

    const rcList = character.romanceCharacters || []
    const fallbackMap = new Map()
    for (const rc of rcList) {
      const aff = usk?.characters?.[rc.name]?.relationship?.affection ?? rc.affectionInitial ?? 50
      fallbackMap.set(rc.name, _buildFallbackIntent(rc, aff, usk))
    }
    _state.intents = fallbackMap
    _state.lastRunTurn = turnCount
    return _state.intents
  }

  // Merge parsed intents with rule-based fallbacks (fill any missing characters)
  const rcList = character.romanceCharacters || []
  const resultMap = new Map()
  for (const rc of rcList) {
    const parsedIntent = parsed.characters?.[rc.name]
    if (parsedIntent && parsedIntent.primary_intent) {
      resultMap.set(rc.name, {
        primary_intent: parsedIntent.primary_intent || '',
        secondary_intent: parsedIntent.secondary_intent || '',
        fear: parsedIntent.fear || '',
        desire: parsedIntent.desire || '',
        conflict: parsedIntent.conflict || '',
        autonomous_action: parsedIntent.autonomous_action || '',
        relationship_direction: parsedIntent.relationship_direction || '',
        _fallback: false,
      })
    } else {
      const aff = usk?.characters?.[rc.name]?.relationship?.affection ?? rc.affectionInitial ?? 50
      const fallback = _buildFallbackIntent(rc, aff, usk)
      console.warn('[CIE] No parsed intent for ' + rc.name + ', using fallback')
      resultMap.set(rc.name, fallback)
    }
  }

  _state.intents = resultMap
  _state.lastRunTurn = turnCount
  _state.lastError = null

  // Log summary
  const summary = [...resultMap.entries()].map(([name, intent]) =>
    name + ': ' + (intent.primary_intent || '?').slice(0, 40) +
    (intent._fallback ? ' [fallback]' : '')
  ).join(' | ')
  console.log('[CIE] Intents updated:', summary)

  return _state.intents
}

/**
 * Get the current CIE intent for a specific character.
 *
 * @param {string} charName
 * @returns {object|null} CIEOutput
 */
export function getIntent(charName) {
  return _state.intents.get(charName) || null
}

/**
 * Get the full CIE state map.
 *
 * @returns {Map}
 */
export function getCIEState() {
  return _state.intents.size > 0 ? _state.intents : null
}

/**
 * Build a formatted prompt block from CIE state for injection into the system prompt.
 *
 * @param {object} character — full character descriptor
 * @returns {string} formatted prompt block
 */
export function buildCIEBlock(character) {
  if (_state.intents.size === 0) return ''

  const rcList = character?.romanceCharacters || []
  if (rcList.length === 0) return ''

  const lines = ['━━━ 🧠 CIE · 角色心理动机（长期意图）━━━']
  lines.push('以下动机由 Character Intent Engine 生成，代表角色当前阶段的核心心理驱动力。')
  lines.push('角色不是回应者——他们有独立于玩家的欲望、恐惧和计划。')
  lines.push('')

  for (const rc of rcList) {
    const intent = _state.intents.get(rc.name)
    if (!intent) continue

    const profile = detectAggressionProfile(rc)
    const tag = profile === AGGRESSION_PROFILES.PURSUER ? '🔥侵略者'
      : profile === AGGRESSION_PROFILES.CONFRONTATIONAL ? '⚡对抗者'
      : profile === AGGRESSION_PROFILES.ALOOF ? '❄️疏离者'
      : '🌸温柔者'

    lines.push(`【${rc.name}】${tag}${intent._fallback ? ' [规则推断]' : ''}`)
    lines.push(`  核心意图：${intent.primary_intent}`)
    if (intent.secondary_intent) lines.push(`  次要意图：${intent.secondary_intent}`)
    lines.push(`  深层欲望：${intent.desire}`)
    lines.push(`  核心恐惧：${intent.fear}`)
    lines.push(`  心理矛盾：${intent.conflict}`)
    lines.push(`  若玩家不行动：${intent.autonomous_action}`)
    lines.push(`  关系方向：${intent.relationship_direction}`)
    lines.push('')
  }

  lines.push('❗ 以上动机是角色行为的"为什么"。CEK 负责"怎么做"。')
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━')

  return lines.join('\n')
}

/**
 * Build a compact CIE context string for injection into the NDC Director prompt.
 * This is a condensed version — the full block goes into the main prompt.
 *
 * @returns {string}
 */
export function buildCIENDCContext() {
  if (_state.intents.size === 0) return ''

  const entries = [..._state.intents.entries()]
  return entries.map(([name, intent]) =>
    `${name}: 想要=${intent.primary_intent?.slice(0, 60)} | 恐惧=${intent.fear?.slice(0, 40)} | 主动会=${intent.autonomous_action?.slice(0, 50)}`
  ).join('\n')
}

/**
 * Reset CIE engine state (call on session reset / new world load).
 */
export function resetCIE() {
  _state.intents.clear()
  _state.lastRunTurn = 0
  _state.runInterval = DEFAULT_INTERVAL
  _state.stageKeys.clear()
  _state.turnCount = 0
  _state.lastError = null
}

/**
 * Get the last error (for debugging).
 */
export function getCIEError() {
  return _state.lastError
}

// ═══════════════════════════════════════════════════════════
// 7. Persistence (localStorage)
// ═══════════════════════════════════════════════════════════

function _storageKey(characterId, saveId) {
  return STORAGE_PREFIX + characterId + '_' + (saveId || 'default')
}

/**
 * Save CIE state to localStorage.
 *
 * @param {string} characterId
 * @param {string} saveId
 */
export function saveCIEState(characterId, saveId) {
  if (!characterId) return
  try {
    const data = {
      intents: Object.fromEntries(_state.intents),
      lastRunTurn: _state.lastRunTurn,
      runInterval: _state.runInterval,
      stageKeys: Object.fromEntries(_state.stageKeys),
      turnCount: _state.turnCount,
      savedAt: Date.now(),
    }
    localStorage.setItem(_storageKey(characterId, saveId), JSON.stringify(data))
  } catch (e) {
    console.warn('[CIE] Save failed:', e)
  }
}

/**
 * Load CIE state from localStorage.
 *
 * @param {string} characterId
 * @param {string} saveId
 * @returns {boolean} true if state was loaded
 */
export function loadCIEState(characterId, saveId) {
  if (!characterId) return false
  try {
    const raw = localStorage.getItem(_storageKey(characterId, saveId))
    if (!raw) return false

    const data = JSON.parse(raw)
    if (data.intents) {
      _state.intents = new Map(Object.entries(data.intents))
    }
    if (data.lastRunTurn != null) _state.lastRunTurn = data.lastRunTurn
    if (data.runInterval != null) _state.runInterval = data.runInterval
    if (data.stageKeys) {
      _state.stageKeys = new Map(Object.entries(data.stageKeys))
    }
    if (data.turnCount != null) _state.turnCount = data.turnCount

    console.log('[CIE] State loaded:',
      _state.intents.size, 'characters,',
      'lastRun=', _state.lastRunTurn)
    return true
  } catch (e) {
    console.warn('[CIE] Load failed:', e)
    return false
  }
}
