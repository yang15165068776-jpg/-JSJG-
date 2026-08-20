/**
 * Mode Translator — Shared State → Mode-Specific Behavior (Dual-Mode v1)
 *
 * The same relationship state produces DIFFERENT behavior depending on mode.
 * This is the "bridge" between unified state and mode-specific expression.
 *
 * Core principle:
 *   ❗ Mode does not change who the character IS
 *   ❗ Mode changes how the character EXPRESSES themselves
 *
 * Example: affection=80, trust=60
 *   Drama → cold treatment with reluctant care leaking through actions
 *   Daily → more frequent WeChat replies, ironic emojis, pretends indifference
 */

// ═══════════════════════════════════════════════════════════
// Drama Mode Translation
// ═══════════════════════════════════════════════════════════

/**
 * Translate relationship state into drama mode behavioral directives.
 *
 * @param {string} characterName
 * @param {{ affection: number, trust: number, tension: number, dominance: number }} rel
 * @param {number} cpsTension — CPS global tension level (0-1), null if no CPS
 * @returns {{ directive: string, tone: string, controlLevel: string, shouldConfront: boolean }}
 */
export function translateForDrama(characterName, rel, cpsTension) {
  const { affection, trust, tension, dominance } = rel
  const tensionPct = Math.round((cpsTension ?? 0.5) * 100)

  let directive = ''
  let tone = ''
  let controlLevel = 'medium'
  let shouldConfront = false

  if (affection < 20) {
    directive = '彻底敌对——视玩家为威胁或障碍，行为以伤害/排斥/利用为主'
    tone = '冷酷、轻蔑、敌意'
    controlLevel = 'maximum'
    shouldConfront = true
  } else if (affection < 40) {
    if (dominance > 70) {
      directive = '高压控制——用冷漠和威胁维持主导，偶尔施舍关注作为控制手段'
      tone = '压迫、疏离、审讯式'
    } else {
      directive = '防御性疏远——不主动攻击但拒绝靠近，用沉默和简短回应筑墙'
      tone = '淡漠、回避、敷衍'
    }
    controlLevel = 'high'
    shouldConfront = tension > 70
  } else if (affection < 60) {
    directive = '核心冷淡人设——保持距离但不再主动伤害，用讽刺和冷幽默测试对方底线'
    tone = '讽刺、克制、若即若离'
    controlLevel = 'medium-high'
    shouldConfront = tension > 80
  } else if (affection < 75) {
    directive = '内部矛盾可见——关心正在泄漏但被强硬压制，嘴上冷漠但行为上有不经意的靠近'
    tone = '矛盾、嘴硬、偶尔破防'
    controlLevel = 'medium'
    shouldConfront = false
  } else if (affection < 90) {
    directive = '占有欲替代压制——控制不再是推开而是抓紧，不允许他人靠近玩家，行为上出现不经意的保护'
    tone = '占有、紧张、醋意'
    controlLevel = 'medium-low'
    shouldConfront = false
  } else {
    directive = '依赖暴露——冷漠外壳已碎，对玩家的需求感无法隐藏。行为上出现寻求确认、害怕失去的信号'
    tone = '脆弱、依赖、强烈占有'
    controlLevel = 'low'
    shouldConfront = false
  }

  // CPS tension boost: if global tension is high, increase confrontation
  if (cpsTension && cpsTension > 0.75) {
    shouldConfront = true
    controlLevel = controlLevel === 'low' ? 'medium' : controlLevel === 'medium' ? 'high' : controlLevel
  }

  return { directive, tone, controlLevel, shouldConfront }
}

// ═══════════════════════════════════════════════════════════
// Daily Mode Translation
// ═══════════════════════════════════════════════════════════

/**
 * Translate relationship state into daily (WeChat) mode behavioral directives.
 *
 * @param {string} characterName
 * @param {{ affection: number, trust: number }} rel
 * @returns {{ replyStyle: string, frequency: string, initiativeChance: number, maxWords: number }}
 */
export function translateForDaily(characterName, rel) {
  const { affection, trust } = rel

  let replyStyle = ''
  let frequency = ''
  let initiativeChance = 0 // probability of initiating message (0-1)
  let maxWords = 30

  if (affection < 10) {
    replyStyle = '彻底已读不回——最多2字回复，"嗯""哦""。"'
    frequency = '几小时到几天回一次'
    initiativeChance = 0
    maxWords = 3
  } else if (affection < 30) {
    replyStyle = '冰点一字千金——"嗯""哦""行""不"为主，不带任何语气词和表情'
    frequency = '几十分钟到几小时'
    initiativeChance = 0.02
    maxWords = 8
  } else if (affection < 50) {
    replyStyle = '冷淡碎片——简短回复但不再是单字，偶尔带讽刺或冷幽默，不用表情'
    frequency = '十几分钟'
    initiativeChance = 0.05
    maxWords = 20
  } else if (affection < 65) {
    replyStyle = '随意但冷淡——口语化的冷淡，假装不在意但回复变快，偶尔用"……"制造停顿感'
    frequency = '几分钟'
    initiativeChance = 0.10
    maxWords = 30
  } else if (affection < 80) {
    replyStyle = '碎碎念伪装——用吐槽、反问、假装不耐的方式主动出现，回复明显变快，偶尔用表情'
    frequency = '很快'
    initiativeChance = 0.20
    maxWords = 40
  } else if (affection < 95) {
    replyStyle = '主动但不承认——会主动发消息但用"顺手""无聊"做借口，回复几乎秒回，语气里的关心藏不住'
    frequency = '秒回或很快'
    initiativeChance = 0.35
    maxWords = 50
  } else {
    replyStyle = '直球——偶尔不再伪装，出现罕见的直率表达。但还是会用玩笑或吐槽迅速收回，怕暴露太多'
    frequency = '秒回'
    initiativeChance = 0.50
    maxWords = 50
  }

  // Trust modulates: higher trust → slightly more words, more initiative
  if (trust > 60) {
    initiativeChance = Math.min(0.7, initiativeChance * 1.3)
    maxWords = Math.min(60, maxWords + 10)
  }

  return { replyStyle, frequency, initiativeChance: Math.round(initiativeChance * 100) / 100, maxWords }
}

// ═══════════════════════════════════════════════════════════
// Master Translation
// ═══════════════════════════════════════════════════════════

/**
 * Build the complete mode behavior envelope for the current turn.
 *
 * @param {string} mode — 'drama' | 'daily'
 * @param {object} persona — UnifiedPersona
 * @param {object} state — shared state
 * @param {object|null} cpsState — CPS state (null in daily mode)
 * @returns {object} mode-specific behavior directives
 */
export function buildModeBehavior(mode, persona, state, cpsState) {
  if (!persona || !state) return null

  const romanceChars = persona.characters.filter(c => c.type === 'romance' && c.affectionEnabled)
  if (romanceChars.length === 0) return null

  const cpsTension = cpsState?.tensionLevel ?? null

  const characters = romanceChars.map(char => {
    const rel = {
      affection: state.edges?.['user_' + char.name]?.affection ?? char.affectionInitial ?? 50,
      trust: state.edges?.['user_' + char.name]?.trust ?? 30,
      tension: state.edges?.['user_' + char.name]?.tension ?? 50,
      dominance: state.edges?.['user_' + char.name]?.dominance ?? 50,
    }

    if (mode === 'drama') {
      return {
        name: char.name,
        ...translateForDrama(char.name, rel, cpsTension),
      }
    }

    return {
      name: char.name,
      ...translateForDaily(char.name, rel),
    }
  })

  return {
    mode,
    characters,
    globalTilt: state._powerTilt ?? 50,
  }
}

/**
 * Build a compact mode directive string for prompt injection.
 * Only includes characters with affection enabled.
 */
export function buildModeDirectiveForPrompt(mode, persona, state, cpsState) {
  const behavior = buildModeBehavior(mode, persona, state, cpsState)
  if (!behavior || !behavior.characters?.length) return ''

  const lines = ['【MODE BEHAVIOR——当前模式行为指令】']
  lines.push('模式：' + (mode === 'drama' ? '剧情模式（高张力叙事）' : '日常模式（微信碎片聊天）'))

  for (const char of behavior.characters) {
    if (mode === 'drama') {
      lines.push(
        char.name + '：' + char.directive +
        ' | 语调：' + char.tone +
        ' | 控制等级：' + char.controlLevel +
        (char.shouldConfront ? ' | ⚠️ 本轮应存在对抗行为' : '')
      )
    } else {
      lines.push(
        char.name + '：' + char.replyStyle +
        ' | 回复频率：' + char.frequency +
        ' | 主动概率：' + Math.round(char.initiativeChance * 100) + '%' +
        ' | 单条上限：' + char.maxWords + '字'
      )
    }
  }

  return lines.join('\n')
}
