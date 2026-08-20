/**
 * Event Extractor — v2.2 Event-Native Memory Engine
 *
 * Replaces text-based compressChatHistory with structured event extraction.
 *
 * Core principle:
 *   ❌ Do NOT extract "plot" or "summary"
 *   ✅ Extract "what CHANGED" — events + state diffs + relationship shifts
 *
 * Uses a lightweight LLM call (deepseek-v4-flash) to parse dialogue into
 * structured events. Falls back to deterministic extraction on failure.
 *
 * Output: Array of structured events, NOT text summaries.
 */

const BASE_URL = 'https://api.deepseek.com'

/**
 * Event type taxonomy.
 * Every extracted event MUST match one of these types.
 */
export const EVENT_TYPES = {
  RELATIONSHIP_CHANGE: 'RELATIONSHIP_CHANGE',   // affection/tension/trust delta
  DIALOGUE_INTENT: 'DIALOGUE_INTENT',           // what the character was trying to do
  CONFLICT_EVENT: 'CONFLICT_EVENT',             // conflict started/escalated/de-escalated
  SCENE_SHIFT: 'SCENE_SHIFT',                   // location/time/mood change
  NPC_ACTION: 'NPC_ACTION',                     // significant NPC behavior
  REVELATION: 'REVELATION',                     // secret revealed / information bomb
  CONTROL_ATTEMPT: 'CONTROL_ATTEMPT',           // one character tried to control another
  EMOTIONAL_SPIKE: 'EMOTIONAL_SPIKE',           // sudden intense emotional outburst
}

/**
 * Intent taxonomy for DIALOGUE_INTENT events.
 */
export const INTENTS = [
  'accusation', 'withdrawal', 'control', 'confession',
  'provocation', 'interrogation', 'dismissal', 'threat',
  'seduction', 'mockery', 'challenge', 'appeal',
  'silence_as_weapon', 'territory_marking', 'ultimatum',
]

/**
 * Extract structured events from a batch of dialogue turns.
 *
 * @param {Array} messages - user/assistant messages to extract from
 * @param {string} apiKey - DeepSeek API key
 * @param {object} existingGraph - current memory graph for continuity
 * @returns {{ events: Array, error: Error|null }}
 */
export async function extractEvents(messages, apiKey, existingGraph = null) {
  // Build compact dialogue text
  const dialogueText = messages
    .filter(m => m.role !== 'system')
    .map(m => {
      const prefix = m.role === 'user' ? '玩家' : '角色'
      return prefix + '：' + (m.content || '').slice(0, 1500)
    })
    .join('\n')

  if (!dialogueText.trim()) {
    return { events: [], error: new Error('没有可提取的对话内容') }
  }

  // Build existing state context for continuity
  const stateContext = existingGraph
    ? buildStateContext(existingGraph)
    : ''

  const prompt = buildExtractionPrompt(dialogueText, stateContext)

  try {
    const response = await fetch(BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          {
            role: 'system',
            content: '你是事件提取器。只提取"发生了什么变化"，不总结剧情。只返回 JSON，不要任何解释。',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 2500,  // 🔧 v4 思考: 预留 reasoning_content 预算
        temperature: 0.1,
        stream: false,
      }),
    })

    if (!response.ok) {
      throw new Error('Event extraction API error: ' + response.status)
    }

    const data = await response.json()
    const rawContent = data.choices?.[0]?.message?.content || ''

    // Parse JSON from response (may have markdown fence)
    const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/)
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawContent.trim()

    try {
      const parsed = JSON.parse(jsonStr)
      const events = parsed.events || []
      return { events: validateAndCleanEvents(events), error: null }
    } catch (parseErr) {
      console.error('[EventExtractor] JSON parse failed, raw:', rawContent.slice(0, 200))
      return { events: [], error: new Error('JSON parse failed: ' + parseErr.message) }
    }
  } catch (err) {
    console.error('[EventExtractor] Failed:', err.message)
    return { events: [], error: err }
  }
}

/**
 * Build the extraction prompt with strict output format.
 */
function buildExtractionPrompt(dialogueText, stateContext) {
  return [
    stateContext,
    '从以下对话中提取结构化事件。',
    '',
    '⚠️ 核心原则：',
    '❌ 不要写剧情摘要、不要复述对话、不要写自然语言总结',
    '✅ 只提取"发生了什么变化"——状态变化、关系变化、意图、冲突',
    '',
    '每个事件格式：',
    '{',
    '  "type": "事件类型（见下方枚举）",',
    '  "actor": "发起角色名（玩家写 user）",',
    '  "target": "目标角色名（玩家写 user）",',
    '  "intensity": 0到1的浮点数（事件强度）,',
    '  "delta": {',
    '    "affection": -3到+3的整数,',
    '    "tension": -5到+5的整数,',
    '    "trust": -3到+3的整数',
    '  },',
    '  "summary": "≤15字事件描述",',
    '  "emotion": "anger|hurt|jealousy|fear|cold|longing|warmth|despair|triumph|none"',
    '}',
    '',
    '事件类型枚举（type 字段必须是以下之一）：',
    'RELATIONSHIP_CHANGE — 好感/张力/信任发生变化',
    'DIALOGUE_INTENT — 角色对话意图（accusation/withdrawal/control/confession/provocation/interrogation/dismissal/threat/seduction/mockery/challenge/appeal/silence_as_weapon/territory_marking/ultimatum）',
    'CONFLICT_EVENT — 冲突开始/升级/降级',
    'SCENE_SHIFT — 地点/时间/氛围变化',
    'NPC_ACTION — 重要 NPC 行为',
    'REVELATION — 秘密/信息炸弹被抛出',
    'CONTROL_ATTEMPT — 一个角色试图控制另一个',
    'EMOTIONAL_SPIKE — 情绪突然爆发',
    '',
    '规则：',
    '- 每轮对话提取 1-4 个事件',
    '- delta 没有变化写 0',
    '- intensity 根据对话激烈程度判断（0.3=平淡, 0.7=激烈, 1.0=爆炸）',
    '- 只提取"变化"，不提取"维持现状"',
    '- 如果对话平淡无变化，events 数组可以为空',
    '',
    '只返回 JSON，格式：{"events": [...]}',
    '不要 markdown 代码块，不要解释。',
    '',
    '待提取对话：',
    dialogueText,
  ].join('\n')
}

/**
 * Build existing state context for the extraction prompt.
 */
function buildStateContext(graph) {
  if (!graph || !graph.edges) return ''

  const lines = ['【当前关系状态——用于判断"变化"的基线】']
  for (const [key, edge] of Object.entries(graph.edges)) {
    if (!edge) continue
    const parts = []
    if (edge.affection != null) parts.push('好感' + edge.affection)
    if (edge.tension != null) parts.push('张力' + edge.tension)
    if (edge.trust != null) parts.push('信任' + edge.trust)
    if (edge.dominance != null) parts.push('主导' + Math.round(edge.dominance * 100) + '%')
    if (parts.length) lines.push(key + '：' + parts.join('，'))
  }

  if (graph.global?.sceneLocation) {
    lines.push('当前地点：' + graph.global.sceneLocation)
  }
  if (graph.global?.activeConflicts?.length) {
    lines.push('活跃冲突：' + graph.global.activeConflicts.join(' | '))
  }

  return lines.length > 1 ? lines.join('\n') + '\n\n' : ''
}

/**
 * Validate and clean extracted events.
 */
function validateAndCleanEvents(events) {
  if (!Array.isArray(events)) return []

  const validTypes = Object.values(EVENT_TYPES)

  return events
    .filter(e => e && typeof e === 'object')
    .map(e => ({
      type: validTypes.includes(e.type) ? e.type : 'RELATIONSHIP_CHANGE',
      actor: String(e.actor || '未知'),
      target: String(e.target || 'user'),
      intensity: clamp(parseFloat(e.intensity) || 0.5, 0, 1),
      delta: {
        affection: clamp(parseInt(e.delta?.affection) || 0, -3, 3),
        tension: clamp(parseInt(e.delta?.tension) || 0, -5, 5),
        trust: clamp(parseInt(e.delta?.trust) || 0, -3, 3),
      },
      summary: String(e.summary || '').slice(0, 20),
      emotion: String(e.emotion || 'none'),
      intent: e.intent || null,
    }))
    .filter(e => {
      // Filter out no-op events (no change + no meaningful content)
      const hasDelta = e.delta.affection !== 0 || e.delta.tension !== 0 || e.delta.trust !== 0
      const hasSummary = e.summary.length > 0
      return hasDelta || hasSummary
    })
}

function clamp(v, min, max) {
  if (isNaN(v)) return min
  return Math.max(min, Math.min(max, v))
}

/**
 * Deterministic fallback: extract events without LLM.
 * Used when API is unavailable. Scans for keywords and patterns.
 */
export function extractEventsDeterministic(messages, existingGraph) {
  const events = []
  const lastFew = messages.filter(m => m.role !== 'system').slice(-4)

  const combined = lastFew.map(m => m.content || '').join(' ').toLowerCase()

  // Conflict keywords
  const conflictKW = ['滚', '闭嘴', '够了', '别说了', '放开', '凭什么', '你敢', '你以为', '你算']
  const hitConflict = conflictKW.filter(kw => combined.includes(kw))

  if (hitConflict.length >= 2) {
    events.push({
      type: 'CONFLICT_EVENT',
      actor: '角色',
      target: 'user',
      intensity: 0.7,
      delta: { affection: -1, tension: 3, trust: -1 },
      summary: '对话冲突升级',
      emotion: 'anger',
      intent: 'confrontation',
    })
  }

  // Jealousy keywords
  const jealousyKW = ['他是谁', '你和', '为什么不回', '在哪', '跟谁']
  if (jealousyKW.some(kw => combined.includes(kw))) {
    events.push({
      type: 'DIALOGUE_INTENT',
      actor: '角色',
      target: 'user',
      intensity: 0.6,
      delta: { affection: 0, tension: 2, trust: -1 },
      summary: '嫉妒质问',
      emotion: 'jealousy',
      intent: 'interrogation',
    })
  }

  // Withdrawal keywords
  const withdrawKW = ['算了', '没什么', '随便', '我走了', '不用']
  if (withdrawKW.some(kw => combined.includes(kw))) {
    events.push({
      type: 'DIALOGUE_INTENT',
      actor: '角色',
      target: 'user',
      intensity: 0.5,
      delta: { affection: -1, tension: 1, trust: 0 },
      summary: '退缩疏离',
      emotion: 'hurt',
      intent: 'withdrawal',
    })
  }

  // Control keywords
  const controlKW = ['不许', '不能', '必须', '给我', '回来', '别想']
  if (controlKW.some(kw => combined.includes(kw))) {
    events.push({
      type: 'CONTROL_ATTEMPT',
      actor: '角色',
      target: 'user',
      intensity: 0.65,
      delta: { affection: 0, tension: 2, trust: -1 },
      summary: '试图控制对方',
      emotion: 'cold',
      intent: 'control',
    })
  }

  return events
}
