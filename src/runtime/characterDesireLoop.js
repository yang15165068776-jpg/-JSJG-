/**
 * 🧠 CDL — Character Desire Loop v1
 *
 * "角色为什么想做——不是剧情需要，是欲望在推。"
 *
 * Core problem CDL solves:
 *   Without CDL: ACL says "你必须制造冲突" → character manufactures conflict
 *   → player feels "AI is pushing plot, not character living."
 *
 *   With CDL: ACL says "你必须制造冲突" AND CDL says "因为你害怕失去控制"
 *   → character's action reads as internally motivated, not mechanically plotted.
 *
 * Core formula:
 *   Desire + Fear + Belief + Conflict → Intent → Action → Consequence → Updated Desire
 *
 * Architecture:
 *   CDL runs every 5-8 turns via flash model.
 *   Output is persisted to module state + localStorage.
 *   CAC consumes CDL to generate psychologically-grounded actions.
 *
 * Flow:
 *   Character Settings → CDL (deep psychology) → CIE (narrative intent) → CAC (agency) → Reply
 *
 * v1 CDL vs CIE:
 *   CIE: "What does the character want to achieve?" (narrative goal)
 *   CDL: "Why does the character want it?" (psychological drive)
 */

import { getAuditModel } from '../utils/storage'
import { detectAggressionProfile } from './aggressionProfile'

const BASE_URL = 'https://api.deepseek.com'
const FLASH_MODEL = 'deepseek-v4-flash'
const STORAGE_PREFIX = 'jsjg_cdl_'
const DEFAULT_INTERVAL = 6

// ═══════════════════════════════════════════════════════════
// Module-Level State
// ═══════════════════════════════════════════════════════════

const _state = {
  loops: new Map(),        // charName → CDLOutput
  lastRunTurn: 0,
  runInterval: DEFAULT_INTERVAL,
  stageKeys: new Map(),    // charName → last stage key
  turnCount: 0,
  lastError: null,
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
        max_tokens: 1600,  // 🔧 v4 思考: 预留 reasoning_content 预算
        temperature: 0.3,
        stream: false,
      }),
    })
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      return { raw: '', error: errData.error?.message || `API ${response.status}` }
    }
    const data = await response.json()
    return { raw: data.choices?.[0]?.message?.content || '' }
  } catch (err) {
    return { raw: '', error: err.message }
  }
}

// ═══════════════════════════════════════════════════════════
// 2. JSON Extraction
// ═══════════════════════════════════════════════════════════

function _extractJSON(raw) {
  if (!raw || !raw.trim()) return null
  try { return JSON.parse(raw) } catch (_) {}
  const codeMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (codeMatch) { try { return JSON.parse(codeMatch[1].trim()) } catch (_) {} }
  const braceMatch = raw.match(/\{[\s\S]*\}/)
  if (braceMatch) { try { return JSON.parse(braceMatch[0]) } catch (_) {} }
  console.warn('[CDL] Failed to extract JSON from:', raw.slice(0, 200))
  return null
}

// ═══════════════════════════════════════════════════════════
// 3. CDL Prompt Builder
// ═══════════════════════════════════════════════════════════

function _buildCDLPrompt(character, usk, prevLoop) {
  const rcList = character?.romanceCharacters || []
  if (rcList.length === 0) return null

  const charBlocks = rcList.map(rc => {
    const aff = usk?.characters?.[rc.name]?.relationship?.affection ?? rc.affectionInitial ?? 50
    const profile = detectAggressionProfile(rc)
    const prev = prevLoop?.get?.(rc.name) || prevLoop?.[rc.name] || null

    const prevBlock = prev ? [
      `  上次 core_desire：${prev.core_desire || '?'}`,
      `  上次 fear：${prev.fear || '?'}`,
      `  上次 internal_conflict：${prev.internal_conflict || '?'}`,
      `  上次 desired_outcome：${prev.desired_outcome || '?'}`,
    ].join('\n') : '（首次生成，无历史）'

    return [
      `【${rc.name}】`,
      `  人格：${rc.personality || '未设定'}`,
      `  背景：${(rc.background || '').slice(0, 300)}`,
      `  侵略类型：${profile || 'unknown'}`,
      `  当前好感度：${aff}`,
      `  说话风格：${(rc.speakingStyle || '').slice(0, 200)}`,
      ``,
      `  历史欲望状态：`,
      prevBlock,
    ].join('\n')
  }).join('\n\n')

  return [
    '你是 Character Desire Loop 引擎。分析角色的深层心理驱动力。',
    '',
    '输出 JSON：',
    '{',
    '  "characters": {',
    '    "角色名": {',
    '      "core_desire": "长期驱动力——他一生想获得/证明/避免什么",',
    '      "immediate_desire": "当前场景中最想从玩家那里获得什么",',
    '      "hidden_need": "他意识不到但真正需要的东西",',
    '      "fear": "他最害怕在此刻发生的事",',
    '      "belief": "他认为人际关系如何运作——用他自己的视角，不是客观事实",',
    '      "internal_conflict": "core_desire和fear之间的具体矛盾——他卡在哪里",',
    '      "current_drive": "本轮行动的心理驱动源——情绪必须对应欲望",',
    '      "desired_outcome": "他希望本轮结束时玩家/关系发生什么变化"',
    '    }',
    '  }',
    '}',
    '',
    '规则：',
    '1. 不能只有情绪——任何情绪必须对应一个欲望。不是"他很难过"，而是"他害怕X，所以表现出Y"。',
    '2. 考虑"如果玩家停止说话，角色的欲望会推动他做什么？"',
    '3. 角色行为必须服务于至少一个：获得/避免/证明/隐藏/测试。',
    '4. 角色不能知道自己的全部真实动机。表层理由≠深层理由。',
    '5. 欲望必须在角色人设框架内——不能凭空产生不符合性格的欲望。',
    '6. 语言精炼——每项30-60字。',
    '',
    '角色数据：',
    charBlocks,
  ].join('\n')
}

// ═══════════════════════════════════════════════════════════
// 4. Desire Evolution — how desire changes after action
// ═══════════════════════════════════════════════════════════

const DESIRE_EVOLUTION_RULES = [
  // If character acted on desire and got positive feedback → desire intensifies or shifts
  {
    condition: (prev, feedback) => feedback === 'positive',
    evolve: (d) => ({
      ...d,
      immediate_desire: d.immediate_desire + '——但想要更多',
      current_drive: d.current_drive + '；上次行动得到了正面反馈，驱动力增强',
    }),
  },
  // If character acted and got rejected → desire becomes fear-driven or redirected
  {
    condition: (prev, feedback) => feedback === 'negative',
    evolve: (d) => ({
      ...d,
      immediate_desire: d.fear ? `避免${d.fear.slice(0, 20)}，同时寻找替代方式获得` + (d.core_desire || '').slice(0, 20) : d.immediate_desire,
      current_drive: d.current_drive + '；上次行动受挫，转为更隐蔽的方式',
      internal_conflict: (d.internal_conflict || '') + '；行动受挫加剧了内心矛盾',
    }),
  },
  // No clear feedback → desire persists, anxiety grows
  {
    condition: (prev, feedback) => feedback === 'neutral' || !feedback,
    evolve: (d) => ({
      ...d,
      current_drive: d.current_drive + '；结果不明——焦虑增加，更迫切地需要回应',
      internal_conflict: (d.internal_conflict || '') + '；不确定感放大了恐惧',
    }),
  },
]

function _evolveDesire(prevLoop, consequence) {
  if (!prevLoop) return null
  const feedback = consequence?.feedback || 'neutral'
  const rule = DESIRE_EVOLUTION_RULES.find(r => r.condition(prevLoop, feedback))
  return rule ? rule.evolve({ ...prevLoop }) : prevLoop
}

// ═══════════════════════════════════════════════════════════
// 5. CDL Block Builder — for prompt injection
// ═══════════════════════════════════════════════════════════

/**
 * Build a compact CDL block for HOT zone injection.
 * This goes BEFORE CAC — providing the "why" that CAC uses.
 */
export function buildCDLBlock(cdlState, characterName) {
  if (!cdlState || cdlState.size === 0) return ''

  const blocks = []
  for (const [name, loop] of cdlState) {
    if (!loop || !loop.core_desire) continue
    const d = loop
    blocks.push([
      `━━━ 🧠 CDL · ${name} 欲望驱动 ━━━`,
      `核心欲望：${d.core_desire || '——'}`,
      `当下想要：${d.immediate_desire || '——'}`,
      `隐藏需求：${d.hidden_need || '——'}（角色自己未意识到的）`,
      `深层恐惧：${d.fear || '——'}`,
      `世界观信念：${d.belief || '——'}（角色视角，非客观事实）`,
      `内心矛盾：${d.internal_conflict || '——'}`,
      `本轮驱动：${d.current_drive || '——'}`,
      `期望结果：${d.desired_outcome || '——'}`,
      '',
      `【给模型的指令】`,
      `角色的行为必须源于以上欲望——不由玩家输入驱动。`,
      `表面行为可以不一致，但深层动机必须一致。`,
      `"如果玩家没有说话——角色的欲望会推动他做什么？"`,
    ].join('\n'))
  }

  return blocks.join('\n\n')
}

// ═══════════════════════════════════════════════════════════
// 6. Main API — tickCDL
// ═══════════════════════════════════════════════════════════

/**
 * Tick the CDL — runs flash model every ~6 turns or on stage change.
 * Returns updated CDL state if refreshed, null if skipped.
 *
 * @param {object} character
 * @param {object} usk
 * @param {number} roundIndex
 * @param {string} apiKey
 * @param {object} options
 * @param {object} options.consequence — { feedback: 'positive'|'negative'|'neutral' }
 * @returns {Map|null}
 */
export async function tickCDL(character, usk, roundIndex, apiKey, options = {}) {
  _state.turnCount++

  const rcList = character?.romanceCharacters || []
  if (rcList.length === 0) return null

  // Check stage changes for each character
  let shouldRun = false
  for (const rc of rcList) {
    const name = rc.name
    const aff = usk?.characters?.[name]?.relationship?.affection ?? 50
    const stageKey = `${name}_${Math.floor(aff / 15)}` // Stage changes every 15 affection
    if (_state.stageKeys.get(name) !== stageKey) {
      _state.stageKeys.set(name, stageKey)
      shouldRun = true
    }
  }

  // Run on interval or stage change
  const turnsSinceLast = _state.turnCount - _state.lastRunTurn
  if (!shouldRun && turnsSinceLast < _state.runInterval) return null

  // ── Evolve existing desires if there's a consequence ──
  if (options.consequence && _state.loops.size > 0) {
    for (const [name, prevLoop] of _state.loops) {
      const evolved = _evolveDesire(prevLoop, options.consequence)
      if (evolved) _state.loops.set(name, evolved)
    }
  }

  // ── Call flash model for fresh desire analysis ──
  const prompt = _buildCDLPrompt(character, usk, _state.loops)
  if (!prompt) return null

  if (!apiKey) {
    console.warn('[CDL] No API key — using rule-based fallback')
    return _buildFallbackCDL(character, usk)
  }

  try {
    const { raw, error } = await _callFlash(prompt, apiKey)
    if (error || !raw) {
      console.warn('[CDL] Flash call failed:', error, '— using fallback')
      _state.lastError = error
      return _buildFallbackCDL(character, usk)
    }

    const parsed = _extractJSON(raw)
    if (!parsed || !parsed.characters) {
      console.warn('[CDL] JSON parse failed — using fallback')
      return _buildFallbackCDL(character, usk)
    }

    // Update state
    for (const [name, loop] of Object.entries(parsed.characters)) {
      if (loop && loop.core_desire) {
        _state.loops.set(name, loop)
      }
    }
    _state.lastRunTurn = _state.turnCount
    _state.lastError = null

    console.log('[CDL] Refreshed for', _state.loops.size, 'characters')
    return _state.loops
  } catch (e) {
    console.warn('[CDL] Unexpected error:', e.message)
    _state.lastError = e.message
    return _buildFallbackCDL(character, usk)
  }
}

// ═══════════════════════════════════════════════════════════
// 7. Rule-Based Fallback
// ═══════════════════════════════════════════════════════════

const FALLBACK_DESIRES = {
  pursuer: {
    core_desire: '通过对他人施加控制来确认自己的价值和力量',
    hidden_need: '被无条件接受——不是因为控制，而是因为被看见真实自我',
    fear: '失去控制意味着失去价值——没有控制就没有存在的理由',
    belief: '任何关系本质上都是权力交换——给予和索取必须计算',
    internal_conflict: '渴望被爱，但不相信无偿的爱存在——于是用控制来确保不被抛弃',
  },
  confrontational: {
    core_desire: '通过对抗证明自己不会被任何力量压垮',
    hidden_need: '被尊重和认真对待——而不只是被容忍',
    fear: '妥协等于软弱——一旦让步就不会再被认真对待',
    belief: '世界是一个角斗场——不进攻就会被践踏',
    internal_conflict: '渴望亲近但用攻击推开——因为不确定亲近后会不会受伤',
  },
  aloof: {
    core_desire: '保持自我完整性——不被任何关系定义或消耗',
    hidden_need: '被理解而不需要解释自己——有人能看懂沉默',
    fear: '暴露情感需求后被人利用或轻视',
    belief: '情感是弱点——保持距离就是保持安全',
    internal_conflict: '想要靠近但害怕靠近后的失控——于是用冷漠掩盖渴望',
  },
  gentle: {
    core_desire: '建立深刻、真实的情感连接——被需要和被珍惜',
    hidden_need: '被保护——温柔的人也需要有人撑住他们',
    fear: '付出被当成理所当然——温柔不等于廉价',
    belief: '善意最终会得到回报——但这条路很长',
    internal_conflict: '想要付出但害怕被消耗——在哪里划界线？',
  },
}

function _buildFallbackCDL(character, usk) {
  const rcList = character?.romanceCharacters || []
  if (rcList.length === 0) return null

  for (const rc of rcList) {
    const name = rc.name
    const profile = detectAggressionProfile(rc.tags || rc.personality || '')
    const base = FALLBACK_DESIRES[profile] || FALLBACK_DESIRES.confrontational
    const aff = usk?.characters?.[name]?.relationship?.affection ?? 50

    // Adjust based on affection stage
    let immediate = ''
    let outcome = ''
    let drive = ''
    if (aff >= 80) {
      immediate = '在亲密中确认对方不会离开——享受但保持警觉'
      outcome = '对方主动表达不会离开的证明'
      drive = '亲密中的不安全感——越喜欢越害怕失去'
    } else if (aff >= 60) {
      immediate = '加深关系但保持主导权——不给对方完全掌控节奏的机会'
      outcome = '关系升温但权力结构不变'
      drive = '吸引力与防御力的拉锯——想靠近但不能失控'
    } else if (aff >= 35) {
      immediate = '测试对方是否值得继续投入——观察、试探、评判'
      outcome = '获得对方值得深度投入的证据（或反证）'
      drive = '谨慎的好奇——有兴趣但不安全'
    } else {
      immediate = '保持距离同时观察——不确定对方的价值'
      outcome = '确认对方是否值得注意'
      drive = '防御优先——不轻易打开'
    }

    const loop = {
      ...base,
      immediate_desire: immediate,
      desired_outcome: outcome,
      current_drive: drive,
    }
    _state.loops.set(name, loop)
  }

  _state.lastRunTurn = _state.turnCount
  console.log('[CDL] Fallback generated for', _state.loops.size, 'characters')
  return _state.loops
}

// ═══════════════════════════════════════════════════════════
// 8. State Access & Persistence
// ═══════════════════════════════════════════════════════════

export function getCDLState() {
  return _state.loops.size > 0 ? _state.loops : null
}

export function saveCDLState(characterId, saveId) {
  if (!characterId || !saveId) return
  const key = STORAGE_PREFIX + characterId + '_' + saveId
  const data = {
    loops: Array.from(_state.loops.entries()),
    lastRunTurn: _state.lastRunTurn,
    stageKeys: Array.from(_state.stageKeys.entries()),
    turnCount: _state.turnCount,
  }
  try { localStorage.setItem(key, JSON.stringify(data)) } catch (e) {}
}

export function loadCDLState(characterId, saveId) {
  if (!characterId || !saveId) return
  const key = STORAGE_PREFIX + characterId + '_' + saveId
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return
    const data = JSON.parse(raw)
    _state.loops = new Map(data.loops || [])
    _state.lastRunTurn = data.lastRunTurn || 0
    _state.stageKeys = new Map(data.stageKeys || [])
    _state.turnCount = data.turnCount || 0
    console.log('[CDL] State loaded:', _state.loops.size, 'characters')
  } catch (e) {
    console.warn('[CDL] Failed to load state:', e.message)
  }
}

export function resetCDL() {
  _state.loops.clear()
  _state.lastRunTurn = 0
  _state.stageKeys.clear()
  _state.turnCount = 0
  _state.lastError = null
}
