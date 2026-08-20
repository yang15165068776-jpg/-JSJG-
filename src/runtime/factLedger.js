/**
 * Fact Ledger v2 — Immutable Truth Layer
 *
 * Core problem:
 *   ❗ The LLM "completes the story" by fabricating past events.
 *   The model isn't a fact database — it's a "next-token predictor."
 *   When context is missing, it invents what "probably happened."
 *
 * Solution:
 *   ✅ FACT LEDGER = single source of truth for ALL events, states, identities
 *   ✅ Facts are LOCKED — the LLM cannot modify or contradict them
 *   ✅ Injected EVERY turn — not just on first turn
 *   ✅ Forbidden facts = what the model CANNOT say (based on what didn't happen)
 *
 * This is NOT a prompt patch. It's a STRUCTURAL constraint on narrative generation.
 *
 * Architecture:
 *   Fact Ledger = {
 *     stateFacts:     ["角色A衣物已脱去", "场景在卧室"]       ← physical reality
 *     actionFacts:    ["玩家说'滚'", "角色B离开了房间"]     ← what actually happened
 *     identityFacts:  ["玩家名字=落总", "玩家父母双亡"]     ← who people are
 *     relationshipFacts: ["A在第3轮明确拒绝了B"]            ← irreversible events
 *     forbiddenFacts: ["玩家从未说'我爱你'","角色A和B没有独处过"] ← what CAN'T be said
 *   }
 *
 * Integration:
 *   → injected into every prompt (before LLM generation)
 *   → updated after every turn (extract new facts from what just happened)
 *   → validated against after generation (StateLocks already does this)
 */

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }

// ═══════════════════════════════════════════════════════════
// 1. Fact Ledger Storage
// ═══════════════════════════════════════════════════════════

const STORAGE_KEY = 'jsjg_fact_ledger_'

function _key(characterId, saveId) {
  // 🔒 Always include saveId in key. If missing, still namespace by characterId
  // to prevent cross-save contamination (instead of sharing a key across all saves).
  const sid = saveId || '__no_save__'
  return STORAGE_KEY + sid + '_' + characterId
}

function _create() {
  return {
    version: 2,
    // ── State facts: physical reality of the scene ──
    stateFacts: [],           // ["角色A衣物已脱去", "两人在卧室床上", "时间是深夜"]
    // ── Action facts: what actually happened (ordered) ──
    actionFacts: [],          // ["玩家说'滚出去'", "角色B推门离开", "角色A哭了"]
    // ── Identity facts: who people are ──
    identityFacts: [],        // ["玩家名字=落总", "玩家父母双亡", "角色A有未婚夫"]
    // ── Relationship facts: irreversible events and states ──
    relationshipFacts: [],    // ["第3轮A明确拒绝了B的告白", "B和C在第5轮接吻了"]
    // ── Forbidden facts: what the LLM CANNOT say ──
    forbiddenFacts: [],       // ["玩家从未说'我爱你'", "A和B从未独处", "没有人脱过衣服"]
    // ── Scene continuity: track the current physical state ──
    sceneState: {
      location: '',           // 当前场景位置
      timePhase: '',          // 时间段
      characterStates: {},    // { "沈寂": "衣物已脱去,躺在床上", "落总": "穿着睡衣,坐在床边" }
    },
    updatedAt: null,
  }
}

// ═══════════════════════════════════════════════════════════
// 2. Public API
// ═══════════════════════════════════════════════════════════

export function loadLedger(characterId, saveId) {
  const key = _key(characterId, saveId)
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.version >= 2) return parsed
    }
  } catch {}
  return _create()
}

export function saveLedger(characterId, saveId, ledger) {
  const key = _key(characterId, saveId)
  ledger.updatedAt = Date.now()
  // Prune: cap all fact arrays
  if (ledger.stateFacts.length > 30) ledger.stateFacts = ledger.stateFacts.slice(-30)
  if (ledger.actionFacts.length > 50) ledger.actionFacts = ledger.actionFacts.slice(-50)
  if (ledger.relationshipFacts.length > 30) ledger.relationshipFacts = ledger.relationshipFacts.slice(-30)
  if (ledger.forbiddenFacts.length > 20) ledger.forbiddenFacts = ledger.forbiddenFacts.slice(-20)
  try {
    localStorage.setItem(key, JSON.stringify(ledger))
  } catch {}
}

// ═══════════════════════════════════════════════════════════
// 3. Fact Locking
// ═══════════════════════════════════════════════════════════

/**
 * Lock a state fact — a physical reality that cannot change unless explicitly updated.
 */
export function lockStateFact(ledger, fact) {
  if (!ledger.stateFacts.includes(fact)) {
    ledger.stateFacts.push(fact)
  }
}

/**
 * Lock an action fact — something that actually happened.
 */
export function lockActionFact(ledger, fact) {
  if (!ledger.actionFacts.includes(fact)) {
    ledger.actionFacts.push(fact)
  }
}

/**
 * Lock an identity fact — who someone is.
 */
export function lockIdentityFact(ledger, fact) {
  if (!ledger.identityFacts.includes(fact)) {
    ledger.identityFacts.push(fact)
  }
}

/**
 * Lock a relationship fact — an irreversible event between characters.
 */
export function lockRelationshipFact(ledger, fact) {
  if (!ledger.relationshipFacts.includes(fact)) {
    ledger.relationshipFacts.push(fact)
  }
}

/**
 * Lock a forbidden fact — something the LLM CANNOT say.
 * Generated from: what HASN'T happened, what the player has NOT said/done.
 */
export function lockForbiddenFact(ledger, fact) {
  if (!ledger.forbiddenFacts.includes(fact)) {
    ledger.forbiddenFacts.push(fact)
  }
}

/**
 * Update scene state — the current physical reality.
 */
export function updateSceneState(ledger, updates = {}) {
  if (updates.location) ledger.sceneState.location = updates.location
  if (updates.timePhase) ledger.sceneState.timePhase = updates.timePhase
  if (updates.characterStates) {
    for (const [name, state] of Object.entries(updates.characterStates)) {
      ledger.sceneState.characterStates[name] = state
      // Also lock as a state fact
      lockStateFact(ledger, name + '：' + state)
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 4. Fact Extraction — scan turns for new facts
// ═══════════════════════════════════════════════════════════

/**
 * After each turn, extract new facts from what just happened.
 * Called AFTER the LLM reply is generated.
 *
 * @param {object} ledger
 * @param {string} userInput — what the player just said/did
 * @param {string} aiReply — what the character(s) just said/did
 * @param {object} context — { characterNames, playerName }
 */
export function extractTurnFacts(ledger, userInput, aiReply, context = {}) {
  if (!ledger || !aiReply) return ledger

  const playerName = context.playerName || '玩家'
  const charNames = context.characterNames || []

  // ── Extract player actions from user input ──
  if (userInput && userInput.trim()) {
    // Player said something → lock it
    lockActionFact(ledger, playerName + '说：' + userInput.slice(0, 100))

    // Detect key player actions
    const lower = userInput.toLowerCase()
    if (/脱|解[开扣]|褪[下去]/.test(lower)) {
      lockActionFact(ledger, playerName + '脱掉了衣服')
    }
    if (/走|离开|出去|滚/.test(lower)) {
      lockActionFact(ledger, playerName + '表达离开/疏远的意图')
    }
    if (/爱|喜欢|在乎|想你/.test(lower)) {
      // Lock ONLY if explicitly said — don't infer
      if (/我爱你|我喜欢你|我在乎你|我想你/.test(userInput)) {
        lockActionFact(ledger, playerName + '表达了感情')
      }
    }
  }

  // ── Extract character actions from AI reply ──
  for (const name of charNames) {
    if (!aiReply.includes(name)) continue

    // Detect clothing/nakedness state changes — comprehensive patterns (v9 fix)
    const undressAction = /脱[掉下了去光净完]|解[开扣]|褪[去下净光尽]|扒[掉下光净]|扯[掉下开]|剥[掉光净]|撕[开掉]/
    // 注意：不匹配「露出」——"露出半行字/露出侧脸"不是脱衣状态（v9.2.6 误配修复）
    const nakedState = /没穿|衣不蔽体|光着|脱[光净]/
    const getDressedAction = /穿[上好了回起戴]|套[上了]|披[上了]|裹[上了紧]|系[好上]|扣[好上]|拉[上]|整理[好]?衣|重新穿|穿戴整齐|着装/

    // Check for getting dressed (reverse of naked — LATER message wins)
    if (getDressedAction.test(aiReply)) {
      updateSceneState(ledger, {
        characterStates: { [name]: '已穿好衣服' },
      })
      lockStateFact(ledger, name + '当前已穿好衣服')
    }
    // Check for undressing or naked state
    else if (undressAction.test(aiReply) || nakedState.test(aiReply)) {
      const isFullyNaked = /衣不蔽体|脱[光净]/.test(aiReply)
      const state = isFullyNaked ? '衣物已被完全脱去' : '衣物已被脱去部分/衣着不整'
      updateSceneState(ledger, {
        characterStates: { [name]: state },
      })
      lockStateFact(ledger, name + '当前' + state)
    }

    // Detect location — broader pattern
    const locMatch = aiReply.match(/(?:在|坐在|躺在|站在|靠在|走进|来到|回到)([^，。！？\n]{2,15})/)
    if (locMatch && !ledger.sceneState.location) {
      const loc = locMatch[1].replace(/[了着的]/g, '').trim()
      if (loc.length >= 2) ledger.sceneState.location = loc
    }

    // Detect key character actions
    // 离开检测：剔除否定句（"没有离开"/"并未离开"）与短语级移动（"走了两步"≠离开）
    const leavePattern = /离开|走了出去|走出去|走出[了门]|摔门|夺门而出|扬长而去|转身就走|转身离开|起身离开/
    const leaveNegation = /(?:没[有]?|未|并不|从不|不愿|不肯|不想|不会|拒绝)[^。，！？；]{0,6}(?:离开|走)/
    if (leavePattern.test(aiReply) && !leaveNegation.test(aiReply) && aiReply.includes(name)) {
      lockActionFact(ledger, name + '离开或试图离开')
    }
    if (/拒绝/.test(aiReply) && aiReply.includes(name)) {
      lockRelationshipFact(ledger, name + '曾在对话中明确拒绝')
    }
    // 亲密接触：吻/舔 无条件（语境中恒为身体接触）；亲/咬 需身体部位/直接对象语境
    // （修复误配："咬字清楚""亲自处理"不再是亲密事实）
    const intimateContact = /吻|舔|亲(?:吻|了[她他你]|上|在|手|脸|额|唇|颊|颈)|咬(?:[上住在到向]|痕|破|肩|唇|颈|耳|舌|手指|手臂|牙印)/
    if (intimateContact.test(aiReply) && aiReply.includes(name)) {
      lockActionFact(ledger, name + '有亲密身体接触——此事实不可抹除或淡化')
    }
  }

  // ── Generate forbidden facts from what DIDN'T happen ──
  // If player hasn't said "I love you", the model can't claim they did
  const forbiddenChecks = [
    { condition: !/我爱你/.test(userInput || ''), fact: playerName + '从未说过"我爱你"——禁止角色声称玩家说过' },
    { condition: !/我想你/.test(userInput || ''), fact: playerName + '从未说过"我想你"——禁止角色声称玩家说过' },
    { condition: !/我答应|我同意|我愿意/.test(userInput || ''), fact: playerName + '从未承诺或同意任何关系——禁止角色声称玩家同意了某事' },
  ]
  for (const check of forbiddenChecks) {
    if (check.condition) lockForbiddenFact(ledger, check.fact)
  }

  return ledger
}

// ═══════════════════════════════════════════════════════════
// 5. Prompt Builder — the enforcement block
// ═══════════════════════════════════════════════════════════

/**
 * Build the FACT LEDGER enforcement block for prompt injection.
 * This goes into EVERY turn's system prompt, before the LLM generates.
 *
 * It tells the LLM:
 *   1. What IS true (locked facts)
 *   2. What CANNOT be said (forbidden facts)
 *   3. What the current physical state is
 */
export function buildLedgerBlock(ledger) {
  if (!ledger) return ''

  const lines = ['【🔒 FACT LEDGER —— 不可篡改】']

  // ── Scene state — HIGH PRIORITY: current physical reality ──
  const stateEntries = Object.entries(ledger.sceneState.characterStates || {})
  if (ledger.sceneState.location || stateEntries.length > 0) {
    lines.push('━━━ 📍 当前场景状态 ★不可自行改变★ ━━━')
    let sceneLine = ''
    if (ledger.sceneState.location) sceneLine += '场景：' + ledger.sceneState.location
    if (ledger.sceneState.timePhase) sceneLine += ' · ' + ledger.sceneState.timePhase
    lines.push(sceneLine)
    if (stateEntries.length > 0) {
      for (const [n, s] of stateEntries) {
        lines.push('  ' + n + '：【' + s + '】← 这是此刻的真实状态')
      }
    }
    lines.push('⚠️ 以上角色衣着/位置/身体状态是已确立的叙事事实。禁止自行让角色穿回衣服/换位置/恢复原状，除非有明确的剧情事件触发。')
    lines.push('')
  }

  // ── Identity (compact, last 5) ──
  const idFacts = ledger.identityFacts.slice(-5)
  if (idFacts.length > 0) {
    lines.push('👤 ' + idFacts.join(' | '))
  }

  // ── Recent actions (last 5, compact) ──
  const actFacts = ledger.actionFacts.slice(-5)
  if (actFacts.length > 0) {
    lines.push('📋 ' + actFacts.join(' → '))
  }

  // ── State facts (last 5, compact) ──
  const stFacts = ledger.stateFacts.slice(-5)
  if (stFacts.length > 0) {
    lines.push('🔵 ' + stFacts.join(' | '))
  }

  // ── Forbidden (last 5, compact) ──
  const forbFacts = ledger.forbiddenFacts.slice(-5)
  if (forbFacts.length > 0) {
    lines.push('🚫 禁止编造：' + forbFacts.join('；'))
  }

  // ── Relationship (last 3, compact) ──
  const relFacts = ledger.relationshipFacts.slice(-3)
  if (relFacts.length > 0) {
    lines.push('💔 ' + relFacts.join(' | '))
  }

  lines.push('⚠ 以上事实不可改写/补剧情/回溯。场景状态不会自己变。')

  // Fallback: if no scene state is recorded, explicitly tell LLM to check history
  if (!ledger.sceneState.location && Object.keys(ledger.sceneState.characterStates || {}).length === 0) {
    lines.push('')
    lines.push('📌 场景连续性检查：请在生成回复前，检查对话历史中最后确立的角色衣着/位置/身体状态，并在回复中保持该状态的连续性。角色不会自己穿上衣服、不会自己换位置、不会自己改变身体状态——除非有明确的剧情事件触发变化。')
  }

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════
// 6. State Continuity Tracker
// ═══════════════════════════════════════════════════════════

/**
 * Before each turn, check the current scene state and ensure continuity.
 * If last turn ended with character naked, lock that fact.
 */
export function enforceSceneContinuity(ledger, lastAIMessage) {
  if (!ledger || !lastAIMessage) return ledger

  // Detect current clothing state from the last AI reply
  for (const [name] of Object.entries(ledger.sceneState.characterStates || {})) {
    const currentState = ledger.sceneState.characterStates[name]
    if (!currentState) continue

    // If character was unclothed last turn, reinforce it
    if (/完全脱去|没穿|衣不蔽体/.test(currentState)) {
      lockStateFact(ledger, name + '此刻衣物依然处于脱去状态——衣物没有自己穿回去')
      lockForbiddenFact(ledger, '禁止声称' + name + '已经穿好衣服——ta的衣物依然是脱去状态')
    }
    // If character had clothes partially removed, reinforce that too
    if (/脱去|不整/.test(currentState)) {
      lockStateFact(ledger, name + '此刻衣着依然不整——状态没有自己恢复')
    }
  }

  // Also scan the last AI message for clothing state that may have been missed
  if (lastAIMessage && Object.keys(ledger.sceneState.characterStates || {}).length === 0) {
    // Scene state is empty — try to extract from the last message
    const nakedStateRegex = /(没穿|衣不蔽体|脱[光净])/
    const dressedRegex = /(穿[上好了]|套[上了]|披[上了]|裹[上了]|整理[好]?衣)/
    const charNames = Object.keys(ledger.sceneState.characterStates || {})
    // If we have no state at all, the extraction step already attempts this in extractTurnFacts
  }

  return ledger
}

// ═══════════════════════════════════════════════════════════
// 6.5 Scene State Reconstruction — rebuild on save re-entry
// ═══════════════════════════════════════════════════════════

/**
 * Reconstruct current scene state from recent message history.
 * Called when re-entering a save to recover physical state that may have
 * been missed by per-turn extractTurnFacts regex.
 *
 * Scans the last N messages for clothing/location/position descriptions
 * and rebuilds ledger.sceneState.
 *
 * @param {object} ledger — the loaded Fact Ledger
 * @param {object[]} messages — recent messages (role + content)
 * @param {string[]} characterNames — names to track
 * @returns {object} updated ledger
 */
export function reconstructSceneStateFromMessages(ledger, messages, characterNames = []) {
  if (!ledger || !messages?.length) return ledger
  if (!characterNames.length) return ledger

  // Comprehensive detection patterns (same as extractTurnFacts + extra patterns)
  const undressAction = /脱[掉下了去光净完]|解[开扣]|褪[去下净光尽]|扒[掉下光净]|扯[掉下开]|剥[掉光净]|撕[开掉]/
  const nakedStateRe = /没穿|衣不蔽体|光着|脱[光净]/
  const getDressedRe = /穿[上好了回起戴]|套[上了]|披[上了]|裹[上了紧]|系[好上]|扣[好上]|拉[上拉链]|整理[好]?衣|重新穿|穿戴整齐|着装/
  const locationRe = /(?:在|坐在|躺在|站在|靠在|走进|来到|回到|身处)([^，。！？\n]{2,15})/

  // Track per-character state: scan from oldest → newest (last match wins)
  const charStates = {}
  let lastLocation = ''
  let lastTimePhase = ''

  // Scan last 8 messages (enough to capture recent state)
  const recentMsgs = messages.slice(-8)
  for (const msg of recentMsgs) {
    const content = msg.content || ''
    if (!content) continue

    // Time phase detection
    if (/深夜|凌晨|清晨|早晨|中午|下午|傍晚|晚上|黄昏|午夜/.test(content)) {
      const tm = content.match(/深夜|凌晨|清晨|早晨|中午|下午|傍晚|晚上|黄昏|午夜/)
      if (tm) lastTimePhase = tm[0]
    }

    // Location detection
    const locMatch = content.match(locationRe)
    if (locMatch) {
      const loc = locMatch[1].replace(/[了着的]/g, '').trim()
      if (loc.length >= 2 && loc.length <= 15) lastLocation = loc
    }

    // Per-character clothing state detection
    for (const name of characterNames) {
      if (!content.includes(name)) continue

      // Check for getting dressed (wins over naked)
      if (getDressedRe.test(content)) {
        charStates[name] = '已穿好衣服'
        continue
      }
      // Check for undressing or naked state
      if (undressAction.test(content) || nakedStateRe.test(content)) {
        const isFullyNaked = /衣不蔽体|脱[光净]/.test(content)
        charStates[name] = isFullyNaked ? '衣物已被完全脱去' : '衣物已被脱去部分/衣着不整'
        continue
      }
    }
  }

  // Apply reconstructed state to ledger
  if (Object.keys(charStates).length > 0) {
    // Only update if the ledger doesn't already have newer state
    for (const [name, state] of Object.entries(charStates)) {
      const existingState = ledger.sceneState.characterStates?.[name]
      if (!existingState) {
        // No existing state — apply reconstruction
        if (!ledger.sceneState.characterStates) ledger.sceneState.characterStates = {}
        ledger.sceneState.characterStates[name] = state
        lockStateFact(ledger, name + '当前' + state + '（存档恢复重建）')
      }
      // If existing state exists, keep it (it's from a more recent extraction)
    }
  }

  // Apply location if not already set
  if (lastLocation && !ledger.sceneState.location) {
    ledger.sceneState.location = lastLocation
  }
  if (lastTimePhase && !ledger.sceneState.timePhase) {
    ledger.sceneState.timePhase = lastTimePhase
  }

  // If we found scene state, lock it as a forbidden fact to prevent the LLM
  // from silently reverting the scene
  if (Object.keys(charStates).length > 0 || lastLocation) {
    lockForbiddenFact(ledger, '禁止自行改变角色的衣着/位置/场景状态——必须保持与Fact Ledger记录一致')
  }

  return ledger
}

// ═══════════════════════════════════════════════════════════
// 7. Pre-Turn Setup — initialize identity facts from character
// ═══════════════════════════════════════════════════════════

/**
 * Seed the ledger with identity facts from character and player profile.
 * Called once when the ledger is first created.
 */
export function seedIdentityFacts(ledger, character, playerProfile) {
  if (!ledger) return

  // Player identity
  if (playerProfile?.name && playerProfile.name !== '玩家' && playerProfile.name !== '新玩家') {
    lockIdentityFact(ledger, '玩家名字=' + playerProfile.name + '——所有角色必须用此名称呼，禁止编造其他名字')
    if (playerProfile.gender) {
      lockIdentityFact(ledger, '玩家性别=' + playerProfile.gender)
    }
    if (playerProfile.description) {
      lockIdentityFact(ledger, '玩家背景：' + playerProfile.description.slice(0, 300))
    }
    // Generate forbidden facts from player identity
    lockForbiddenFact(ledger, '禁止用"王总""小姐""沈总""那个谁"等编造的名字称呼玩家——玩家的名字是' + playerProfile.name)
  }

  // Character identities
  const rcList = character?.romanceCharacters || []
  for (const rc of rcList) {
    if (!rc.name) continue
    if (rc.personality) lockIdentityFact(ledger, rc.name + '的性格=' + rc.personality.slice(0, 100))
    if (rc.background) lockIdentityFact(ledger, rc.name + '的背景=' + rc.background.slice(0, 200))
  }

  return ledger
}
