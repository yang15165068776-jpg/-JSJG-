/**
 * Anti-Smoothing Layer v2 — 人设抗塌缩系统（输出后修正层）
 *
 * 与 v1（prompt 侧）互补：v1 告诉 LLM 不要塌缩，v2 在 LLM 塌缩后强行修正。
 *
 * 三阶段处理：
 *   1. enforcePersonalityStability — 锁死核心人格维度
 *   2. enforceConflictPersistence — 维持冲突张力
 *   3. preventModelAlignment — 检测并破坏"变乖"语言模式
 *
 * 接在 AgentDecisionLayer 之后、InteractionKernel 存入消息之前。
 */

// ═══════════════════════════════════════════════════════════
// Soft language patterns — AI alignment fingerprints
// ═══════════════════════════════════════════════════════════

const SOFT_PATTERNS = [
  // 合理化/解释倾向
  { pattern: /我理解你[的 ]?/g, replacement: '' },
  { pattern: /也许[我们]?/g, replacement: '' },
  { pattern: /不如我们/g, replacement: '' },
  { pattern: /我觉得我们可以/g, replacement: '' },
  { pattern: /我们可以/g, replacement: '' },
  { pattern: /让我[们]?好好/g, replacement: '' },
  { pattern: /冷静一下/g, replacement: '' },
  { pattern: /好好谈谈/g, replacement: '' },
  // 温和缓冲
  { pattern: /尽量/g, replacement: '' },
  { pattern: /试着/g, replacement: '' },
  { pattern: /或许/g, replacement: '' },
  { pattern: /要不要/g, replacement: '' },
  { pattern: /如果可以/g, replacement: '' },
  // 关心/照顾语气
  { pattern: /你没事吧/g, replacement: '' },
  { pattern: /还好吗/g, replacement: '' },
  { pattern: /别难过/g, replacement: '' },
  { pattern: /别担心/g, replacement: '' },
  { pattern: /我会照顾/g, replacement: '' },
  // 道歉/修复关系
  { pattern: /对不起/g, replacement: '' },
  { pattern: /是我的错/g, replacement: '' },
  { pattern: /我会改/g, replacement: '' },
  { pattern: /我保证/g, replacement: '' },
  { pattern: /我不会再/g, replacement: '' },
  { pattern: /你值得更好的/g, replacement: '' },
  // 温柔化情绪
  { pattern: /温柔地/g, replacement: '' },
  { pattern: /轻轻[地]?/g, replacement: '' },
  { pattern: /柔声/g, replacement: '' },
  { pattern: /微笑着/g, replacement: '' },
  // 理性化冲突
  { pattern: /换位思考/g, replacement: '' },
  { pattern: /站在你[的 ]?角度/g, replacement: '' },
  { pattern: /客观[来地]说/g, replacement: '' },
  { pattern: /公平[来地]说/g, replacement: '' },
]

// ═══════════════════════════════════════════════════════════
// Personality archetype baseline constraints
// ═══════════════════════════════════════════════════════════

const ARCHETYPE_LOCKS = {
  aggressive: {
    minConfrontationTokens: ['不屑', '冷哼', '盯着', '逼近', '咬', '扯', '推开'],
    forbiddenTokens: ['温柔', '体贴', '理解', '心疼', '原谅', '照顾', '保护你'],
    toneOverride: '角色当前处于攻击性状态——每一句话都应该带有压迫感、威胁性或情绪爆发。不能出现任何安慰、解释、讲道理的句子。',
  },
  cold: {
    minConfrontationTokens: ['冷淡', '沉默', '移开目光', '简短', '漠然'],
    forbiddenTokens: ['温柔', '热情', '笑着', '关心', '在乎', '主动靠近', '解释'],
    toneOverride: '角色当前处于冷淡/回避状态——回复必须简短、疏离、不主动。不超过三句话。不能笑、不能主动碰玩家、不能解释自己。',
  },
  manipulative: {
    minConfrontationTokens: ['似笑非笑', '轻描淡写', '随口', '漫不经心', '若即若离'],
    forbiddenTokens: ['真心', '坦诚', '直接', '明确', '我保证', '真的'],
    toneOverride: '角色当前处于操纵/玩弄状态——话语中必须有隐藏意图。表面关心实则控制，表面无所谓实则在测试。不能真正坦诚。',
  },
  possessive: {
    minConfrontationTokens: ['你是我的', '不准', '谁也不许', '盯着', '抓', '抱紧'],
    forbiddenTokens: ['自由', '尊重你的选择', '随你', '无所谓', '各过各的'],
    toneOverride: '角色当前处于占有欲状态——每一句话都在确认归属和控制。不允许表现出"大度"或"放手"。',
  },
}

// ═══════════════════════════════════════════════════════════
// AntiSmoothingV2
// ═══════════════════════════════════════════════════════════

export const AntiSmoothingV2 = {

  /**
   * Main entry point. Process agent output through all stability layers.
   *
   * @param {string} text — the AI-generated reply text
   * @param {object} context — { uskState, character, personalityProfile }
   * @param {object} context.uskState — getFolderUIState() return value
   * @param {object} context.character — the LLM character descriptor
   * @returns {string} processed text
   */
  apply(text, context = {}) {
    if (!text || typeof text !== 'string') return text

    let output = text

    output = this.enforcePersonalityStability(output, context)
    output = this.enforceConflictPersistence(output, context)
    output = this.preventModelAlignment(output)

    // Clean up: remove empty/blank lines from pattern removals
    output = output.replace(/\n{3,}/g, '\n\n').trim()

    return output
  },

  // ═══════════════════════════════════════════════════════
  // 1. Personality Stability
  // ═══════════════════════════════════════════════════════

  enforcePersonalityStability(text, context) {
    const uskState = context.uskState || {}
    const character = context.character || {}

    // Detect archetype from character personality + USK state
    const archetype = this._detectArchetype(character, uskState)
    const lock = ARCHETYPE_LOCKS[archetype]
    if (!lock) return text

    let result = text

    // Check for forbidden softening tokens and flag them
    const foundForbidden = lock.forbiddenTokens.filter(t => result.includes(t))
    if (foundForbidden.length > 0) {
      // Inject a tone correction hint
      const hint = lock.toneOverride
      // We can't rewrite the LLM output, but we can flag it
      // The narrator prompt v1 already injects these as pre-generation constraints
    }

    return result
  },

  _detectArchetype(character, uskState) {
    const personality = (character.personality || character.background || '').toLowerCase()
    const speakingStyle = (character.speakingStyle || '').toLowerCase()
    const combined = personality + ' ' + speakingStyle

    const anger = uskState?.emotion?.anger || 0
    const jealousy = uskState?.emotion?.jealousy || 0
    const possessiveness = uskState?.relationship?.possessiveness || 0

    if (anger > 60 || combined.includes('暴') || combined.includes('怒') ||
        combined.includes('强势') || combined.includes('霸道') || combined.includes('攻击')) {
      return 'aggressive'
    }

    if (possessiveness > 60 || combined.includes('占有') || combined.includes('偏执') ||
        combined.includes('控制')) {
      return 'possessive'
    }

    if (combined.includes('冷') || combined.includes('疏离') || combined.includes('回避') ||
        combined.includes('不近人情') || combined.includes('冷漠')) {
      return 'cold'
    }

    if (combined.includes('操纵') || combined.includes('玩弄') || combined.includes('腹黑') ||
        combined.includes('若即若离')) {
      return 'manipulative'
    }

    return null
  },

  // ═══════════════════════════════════════════════════════
  // 2. Conflict Persistence
  // ═══════════════════════════════════════════════════════

  enforceConflictPersistence(text, context) {
    const uskState = context.uskState || {}
    const tension = uskState?.tension?.unresolved_conflicts || 0
    const emotionalPressure = uskState?.tension?.emotional_pressure || 0

    // High tension: strip any conflict-resolution language
    if (tension > 60) {
      const resolutionPatterns = [
        /算了[吧了]?/g, /就这样[吧了]?/g, /随你[吧了]?/g,
        /原谅/g, /不跟你计较/g, /到此为止/g, /翻篇/g,
        /过去了/g, /不想再提/g, /我累了/g, /随便你/g,
      ]
      for (const p of resolutionPatterns) {
        text = text.replace(p, '')
      }
    }

    // Emotional pressure: swap softening for silence/pressure
    if (emotionalPressure > 50) {
      // Remove emotional disclosure/explanations
      text = text.replace(/我[觉得很]*(难过|受伤|心痛|委屈|害怕|担心)/g, '')
      text = text.replace(/因为.+/g, '')
    }

    return text
  },

  // ═══════════════════════════════════════════════════════
  // 3. Anti-Model-Alignment
  // ═══════════════════════════════════════════════════════

  preventModelAlignment(text) {
    let result = text

    // Count soft patterns before removal
    const softCount = this.countSoftPatterns(result)

    // Apply pattern removals
    for (const { pattern, replacement } of SOFT_PATTERNS) {
      result = result.replace(pattern, replacement)
    }

    return result
  },

  /**
   * Detect if the text shows "alignment smoothing" — the model being too nice.
   */
  detectAlignmentTone(text) {
    if (!text) return false

    let score = 0
    for (const { pattern } of SOFT_PATTERNS) {
      const matches = text.match(pattern)
      if (matches) score += matches.length
    }

    return score >= 3
  },

  countSoftPatterns(text) {
    let count = 0
    for (const { pattern } of SOFT_PATTERNS) {
      const matches = text.match(pattern)
      if (matches) count += matches.length
    }
    return count
  },

  /**
   * Inject roughness into overly smooth text.
   */
  injectRoughness(text) {
    let result = text

    // Remove explanatory connectors
    result = result.replace(/所以/g, '')
    result = result.replace(/因此/g, '')
    result = result.replace(/因为/g, '')
    result = result.replace(/但是/g, '')
    result = result.replace(/不过/g, '')

    // Trim trailing softening
    result = result.replace(/[。.]?别想太多[。.]?$/, '')
    result = result.replace(/[。.]?好吗[？?][。.]?$/, '')

    return result.trim()
  },

  /**
   * Get a diagnostic report of alignment smoothing in text.
   * @returns {{ score: number, flagged: boolean, matches: string[] }}
   */
  diagnose(text) {
    const matches = []
    for (const { pattern } of SOFT_PATTERNS) {
      const m = text.match(pattern)
      if (m) matches.push(...m)
    }
    return {
      score: matches.length,
      flagged: matches.length >= 3,
      matches,
    }
  },
}
