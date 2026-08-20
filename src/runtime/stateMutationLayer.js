/**
 * 🔄 SML — State Mutation Layer v1
 *
 * "剧情不是聊天记录。剧情必须产生状态变化。"
 *
 * Core problem SML solves:
 *   Without SML: reply generated → next turn starts fresh.
 *   Character had a breakthrough last turn? Next turn: forgotten.
 *   Player rejected the character? Next turn: back to default.
 *   The world doesn't accumulate weight.
 *
 *   With SML: reply generated → extract what changed → write into state →
 *   next turn's STATE_SNAPSHOT reflects accumulated history.
 *
 * Architecture:
 *   Reply → SML.extractMutations() → applyMutations() → _worldState updated
 *                                                    → next turn STATE_SNAPSHOT
 *
 * Design principle:
 *   SML is a DATABASE TRIGGER, not a STORY WRITER.
 *   It extracts factual state changes from the reply.
 *   No LLM call — pure pattern matching + rule inference.
 */

// ═══════════════════════════════════════════════════════════
// 1. Pattern Catalog — detect state changes from reply text
// ═══════════════════════════════════════════════════════════

// NOTE on pattern discipline:
//   Chinese regexes here must be SPECIFIC to actual relationship events.
//   Avoid single-char words (/热/ /烫/ /冷/) — they match 热情/热闹/发烧/冷静/冷笑
//   and drown real signals in noise. Every alternation branch should be a
//   phrase-level action or explicit feeling, not a bare adjective.

const TRUST_PATTERNS = {
  increase: [
    /相信你|信任|说实话|坦白|从不.*告诉|只告诉你|秘密|真实的我|卸下防备|暴露弱点|软肋|承诺|保证/,
  ],
  decrease: [
    /骗你|骗我|骗你的|假的|撒谎|伪装|不信任|怀疑我|怀疑你|欺骗|隐瞒|看不清|不懂你|玩弄/,
  ],
}

const INTIMACY_PATTERNS = {
  increase: [
    /靠近|贴近|触碰|吻上|亲吻|抱住|压在墙上|压在身上|按在床上|床单|脱下|解开衣|皮肤贴着|呼吸交缠|心跳|发烫|滚烫|灼热|体温|喘息|进去|忍不住|想要你/,
  ],
  decrease: [
    /推开|后退|拉开距离|保持距离|背过身|别碰|放开我|松手|停下|够了|算了|起身离开/,
  ],
}

const CONFLICT_PATTERNS = {
  increase: [
    /我不会|我拒绝|绝不|凭什么|你凭什么|争吵|吵架|愤怒|恨你|讨厌|威胁|逼迫|逼我|滚开|你给我滚|翻旧账|摔门/,
  ],
  decrease: [
    /好吧|算了|妥协|让步|听你的|不吵了|冷静下来|和解|道歉/,
  ],
}

const DEPENDENCY_PATTERNS = {
  increase: [
    /需要你|离不开|帮我|陪我|别走|留下|不要.*离开|怕.*失去|没有你|想你|等你/,
  ],
  decrease: [
    /不需要|自己.*可以|不靠|独立|不依赖|无所谓|不在乎|不重要/,
  ],
}

const SCENE_CHANGE_PATTERNS = [
  { pattern: /离开|走出|出去|下楼|上楼|来到|进入|到了|回到/, type: 'location_change' },
  { pattern: /天亮|天黑|早上|中午|下午|晚上|深夜|凌晨|第二天|次日|几.*小时后/, type: 'time_change' },
  { pattern: /电话.*响|门.*响|敲门|有人.*来|出现.*人|第三人/, type: 'new_actor' },
]

// ═══════════════════════════════════════════════════════════
// 2. Mutation Extraction
// ═══════════════════════════════════════════════════════════

/**
 * Count actual occurrences across patterns.
 * (Not "how many patterns hit" — but how many times the words actually appear.)
 */
function _countOccurrences(text, patterns) {
  let total = 0
  for (const p of patterns) {
    const re = new RegExp(p.source, 'g')  // clone with global flag to count occurrences
    const m = text.match(re)
    if (m) total += m.length
  }
  return total
}

function _extractRelationshipDelta(reply, charName) {
  const delta = { trust: 0, intimacy: 0, conflict: 0, dependency: 0 }

  // If a character is named, only count evidence in the paragraphs near their name.
  // This prevents a reply about character A from mutating character B's state.
  const target = charName && reply.includes(charName) ? _nearNameWindow(reply, charName) : reply

  // Trust
  const trustUp = _countOccurrences(target, TRUST_PATTERNS.increase)
  const trustDown = _countOccurrences(target, TRUST_PATTERNS.decrease)
  delta.trust = Math.min(trustUp * 3, 10) - Math.min(trustDown * 3, 10)

  // Intimacy
  const intUp = _countOccurrences(target, INTIMACY_PATTERNS.increase)
  const intDown = _countOccurrences(target, INTIMACY_PATTERNS.decrease)
  delta.intimacy = Math.min(intUp * 5, 15) - Math.min(intDown * 5, 15)

  // Conflict
  const confUp = _countOccurrences(target, CONFLICT_PATTERNS.increase)
  const confDown = _countOccurrences(target, CONFLICT_PATTERNS.decrease)
  delta.conflict = Math.min(confUp * 4, 12) - Math.min(confDown * 3, 9)

  // Dependency
  const depUp = _countOccurrences(target, DEPENDENCY_PATTERNS.increase)
  const depDown = _countOccurrences(target, DEPENDENCY_PATTERNS.decrease)
  delta.dependency = Math.min(depUp * 4, 12) - Math.min(depDown * 4, 12)

  return delta
}

/**
 * Extract the sentences/paragraphs around a named character.
 * A reply usually contains multiple characters in 修罗场; attributing the
 * whole text to every character produced identical phantom deltas.
 * Returns the window around the FIRST mention of charName (or the whole text).
 */
function _nearNameWindow(reply, charName) {
  const sentences = reply.split(/(?<=[。！？!?；;\n])/)
  const idx = sentences.findIndex(s => s.includes(charName))
  if (idx < 0) return reply
  // Window: the sentence naming them + one before + one after (context)
  const start = Math.max(0, idx - 1)
  const end = Math.min(sentences.length, idx + 2)
  return sentences.slice(start, end).join('')
}

function _extractSceneChange(reply) {
  for (const { pattern, type } of SCENE_CHANGE_PATTERNS) {
    if (pattern.test(reply)) {
      const match = reply.match(pattern)
      return { type, detail: match ? match[0] : '' }
    }
  }
  return null
}

function _extractMemoryMarker(reply) {
  const markers = []

  // Check for irreversible events
  if (/第一次|从没|从未|居然|竟然|没想到|原来.*是|终于/.test(reply)) {
    const match = reply.match(/(第一次|从没|从未|居然|竟然|没想到|原来.*是|终于)[^。！？\n]{0,40}/)
    if (match) markers.push({ level: 'A', event: match[0], type: '认知改变' })
  }

  if (/选择|决定|答应|拒绝|接受|放弃/.test(reply)) {
    const match = reply.match(/(选择|决定|答应|拒绝|接受|放弃)[^。！？\n]{0,40}/)
    if (match) markers.push({ level: 'B', event: match[0], type: '关系改变' })
  }

  return markers.slice(0, 3) // Max 3 per turn
}

function _extractFutureHook(reply, characterDelta) {
  const hooks = []

  if (/测试|试探|观察/.test(reply)) {
    hooks.push('角色正在测试玩家——等待玩家反应')
  }
  if (/秘密|隐藏|没.*说|不能.*说/.test(reply)) {
    hooks.push('角色隐藏了某些信息——可能在后续揭露')
  }
  if (/下次|以后|将来|总有一天|早晚/.test(reply)) {
    hooks.push('角色暗示了未来的行动——玩家需要注意')
  }
  if (characterDelta && (Math.abs(characterDelta.trust || 0) >= 3 || Math.abs(characterDelta.conflict || 0) >= 4)) {
    hooks.push('重大的信任或冲突变化——关系方向可能改变')
  }

  return hooks.slice(0, 2)
}

// ═══════════════════════════════════════════════════════════
// 3. Main API
// ═══════════════════════════════════════════════════════════

/**
 * Extract state mutations from a generated reply.
 *
 * @param {string} reply — the generated assistant reply text
 * @param {object} worldState — current world state
 * @param {object} character — character descriptor
 * @returns {object} mutations
 */
export function extractMutations(reply, worldState, character) {
  if (!reply || reply.length < 10) return null

  const rcList = character?.romanceCharacters || []
  const mutations = {
    scene_delta: null,
    character_delta: {},
    relationship_delta: {},
    memory_delta: [],
    future_hooks: [],
    mutation_score: 0,
  }

  // ── Scene change ──
  mutations.scene_delta = _extractSceneChange(reply)

  // ── Per-character changes ──
  // Attribution rule: only mutate a character's relationship state when this
  // reply actually concerns them. With multiple romance characters, attributing
  // the whole reply to everyone produced identical phantom deltas.
  for (const rc of rcList) {
    const name = rc.name
    if (!name) continue

    const isOnlyChar = rcList.length === 1
    const isNamed = reply.includes(name)
    if (!isOnlyChar && !isNamed) continue

    const relDelta = _extractRelationshipDelta(reply, name)
    mutations.relationship_delta[name] = relDelta

    // Score based on total absolute change
    const absSum = Math.abs(relDelta.trust) + Math.abs(relDelta.intimacy) +
      Math.abs(relDelta.conflict) + Math.abs(relDelta.dependency)
    mutations.mutation_score += absSum
  }

  // ── Memory markers ──
  mutations.memory_delta = _extractMemoryMarker(reply)

  // ── Future hooks ──
  const primaryName = rcList[0]?.name
  mutations.future_hooks = _extractFutureHook(reply, mutations.relationship_delta[primaryName])

  // Normalize score
  mutations.mutation_score = Math.min(100, Math.round(mutations.mutation_score * 2))

  return mutations
}

/**
 * Apply extracted mutations to world state.
 * This is called after every turn to ensure state continuity.
 *
 * @param {object} mutations — from extractMutations()
 * @param {object} worldState — mutable world state object
 * @param {object} ssmState — mutable SSM state (optional)
 */
export function applyMutations(mutations, worldState, ssmState) {
  if (!mutations) return

  // ── Apply relationship deltas to world state ──
  if (worldState?.characters) {
    for (const [name, delta] of Object.entries(mutations.relationship_delta || {})) {
      const wsChar = worldState.characters[name]
      if (!wsChar) continue

      // Skip all-zero deltas (a character may be present but unchanged this turn)
      const hasChange = [delta.trust, delta.dependency, delta.conflict, delta.intimacy].some(v => v)
      if (!hasChange) continue

      // Initialize tracking fields (?? — 0 is a legal value)
      wsChar.trust = Math.max(0, Math.min(100, (wsChar.trust ?? 50) + (delta.trust || 0)))
      wsChar.dependency = Math.max(0, Math.min(100, (wsChar.dependency ?? 30) + (delta.dependency || 0)))
      wsChar.tension = Math.max(0, Math.min(100, (wsChar.tension ?? 20) + (delta.conflict || 0)))
      wsChar.intimacy = Math.max(0, Math.min(100, (wsChar.intimacy ?? 20) + (delta.intimacy || 0)))

      // Track last mutation
      wsChar.lastMutation = {
        time: Date.now(),
        deltas: delta,
        score: mutations.mutation_score,
      }
    }
  }

  // ── Append memory markers to event log ──
  if (mutations.memory_delta?.length > 0 && worldState) {
    if (!worldState.eventLog) worldState.eventLog = []
    for (const marker of mutations.memory_delta) {
      worldState.eventLog.push({
        type: marker.type,
        level: marker.level,
        description: marker.event,
        timestamp: Date.now(),
      })
    }
    // Keep event log manageable
    if (worldState.eventLog.length > 20) {
      worldState.eventLog = worldState.eventLog.slice(-20)
    }
  }

  // ── Store future hooks ──
  if (mutations.future_hooks?.length > 0 && worldState) {
    if (!worldState.pendingHooks) worldState.pendingHooks = []
    for (const hook of mutations.future_hooks) {
      // Don't duplicate existing hooks
      if (!worldState.pendingHooks.includes(hook)) {
        worldState.pendingHooks.push(hook)
      }
    }
    // Keep hooks manageable
    if (worldState.pendingHooks.length > 5) {
      worldState.pendingHooks = worldState.pendingHooks.slice(-5)
    }
  }

  // ── Apply scene change to SSM ──
  if (mutations.scene_delta && ssmState) {
    if (mutations.scene_delta.type === 'location_change' && ssmState.scene) {
      ssmState.scene.lastLocationChange = mutations.scene_delta.detail
    }
    if (mutations.scene_delta.type === 'time_change' && ssmState.scene) {
      ssmState.scene.lastTimeChange = mutations.scene_delta.detail
    }
  }
}

/**
 * Convenience: run full SML cycle — extract + apply + log.
 * Mutations are applied to worldState in place; the returned object carries
 * the raw deltas for callers that need them.
 */
export function runSMLCycle(reply, worldState, character, ssmState) {
  const mutations = extractMutations(reply, worldState, character)
  if (!mutations) return null

  applyMutations(mutations, worldState, ssmState)

  console.log('[SML] Mutation score:', mutations.mutation_score,
    '| scene:', mutations.scene_delta?.type || 'none',
    '| memory:', mutations.memory_delta.length + ' markers',
    '| hooks:', mutations.future_hooks.length)

  return mutations
}

// ═══════════════════════════════════════════════════════════
// 4. Persistence — SML state survives session reload
// ═══════════════════════════════════════════════════════════
// _worldState is rebuilt fresh from character data on every session init
// (worldEngine.createWorldState). The SML-managed fields (trust/dependency/
// tension/intimacy + lastMutation + pendingHooks + eventLog) would otherwise
// reset to defaults on reload — breaking the "world accumulates weight"
// contract. We persist only the SML-owned slice and re-merge on load.
// Affection stays USK-owned (LLM-judged, UI-displayed) — SML never touches it.

const SML_STORAGE_PREFIX = 'jsjg_sml_state_'

export function saveSMLState(characterId, saveId, worldState) {
  if (!characterId || !saveId || !worldState) return
  const key = SML_STORAGE_PREFIX + characterId + '_' + saveId
  const data = {
    characters: {},
    pendingHooks: worldState.pendingHooks || [],
    eventLog: worldState.eventLog || [],
  }
  for (const [name, c] of Object.entries(worldState.characters || {})) {
    if (c.trust == null && c.dependency == null && c.tension == null && c.intimacy == null && !c.lastMutation) continue
    data.characters[name] = {
      trust: c.trust ?? 50,
      dependency: c.dependency ?? 30,
      tension: c.tension ?? 20,
      intimacy: c.intimacy ?? 20,
      lastMutation: c.lastMutation || null,
    }
  }
  try { localStorage.setItem(key, JSON.stringify(data)) } catch (e) { /* non-critical; skip on quota */ }
}

export function loadSMLState(characterId, saveId) {
  if (!characterId || !saveId) return null
  const key = SML_STORAGE_PREFIX + characterId + '_' + saveId
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const data = JSON.parse(raw)
    console.log('[SML] State loaded:', Object.keys(data.characters || {}).length, 'characters,',
      (data.eventLog || []).length, 'events')
    return data
  } catch (e) { return null }
}

export function mergeSMLState(worldState, smlData) {
  if (!worldState || !smlData) return
  if (Array.isArray(smlData.pendingHooks) && smlData.pendingHooks.length) worldState.pendingHooks = smlData.pendingHooks
  if (Array.isArray(smlData.eventLog) && smlData.eventLog.length) worldState.eventLog = smlData.eventLog
  for (const [name, saved] of Object.entries(smlData.characters || {})) {
    const wsChar = worldState.characters?.[name]
    if (!wsChar) continue
    wsChar.trust = saved.trust
    wsChar.dependency = saved.dependency
    wsChar.tension = saved.tension
    wsChar.intimacy = saved.intimacy
    if (saved.lastMutation) wsChar.lastMutation = saved.lastMutation
  }
}
