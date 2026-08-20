/**
 * Persona Core — Unified Character Identity (Dual-Mode Single Persona v1)
 *
 * The persona is the SINGLE source of truth for who a character IS.
 * It is independent of mode (drama/daily) — modes are interpreters, not identities.
 *
 * Core principles:
 *   ❗ Mode cannot modify persona — only expression
 *   ❗ Persona is computed on load, never persisted separately
 *   ❗ characters[] is always an array (daily=length 1, story=length N)
 *
 * Normalization:
 *   daily flat character  → UnifiedPersona with single characters[0]
 *   story romanceCharacters → UnifiedPersona with characters[] mapped directly
 */

// ═══════════════════════════════════════════════════════════
// UnifiedPersona structure
// ═══════════════════════════════════════════════════════════

/**
 * @typedef {object} PersonaCharacter
 * @property {string} id
 * @property {string} name
 * @property {string} avatar
 * @property {string} background
 * @property {string} personality
 * @property {string} speakingStyle
 * @property {string[]} styleRules
 * @property {string[]} forbiddenWords
 * @property {boolean} affectionEnabled
 * @property {number} affectionInitial
 * @property {Array} affectionStages
 * @property {string} transitionTriggers
 * @property {string} irreversibleMoment
 * @property {string} erosionCondition
 * @property {string} anchorSuppression
 * @property {boolean} thinkingEnabled
 * @property {string} thinkingPrompt
 * @property {'romance'|'npc'} type
 * @property {string} relationship
 */

/**
 * @typedef {object} UnifiedPersona
 * @property {string} id
 * @property {string} name
 * @property {string} avatar
 * @property {string} worldSetting
 * @property {string} openingScenario
 * @property {string} storyTone
 * @property {string} protagonistName/Gender/Background/Personality
 * @property {PersonaCharacter[]} characters  — always array
 * @property {Array} npcs
 * @property {object} dailyConfig — { contextWindow, showTimestamp, activeMessageEnabled, activePrompt, nickname }
 * @property {object} dramaConfig — { temperature, topP, thinkingEnabled, thinkingPrompt, autoGenerateNpcs, npcStyleLimit }
 * @property {string} _sourceMode — 'daily' | 'story'
 * @property {string|null} _lastPlayedMode
 * @property {number} _normalizedAt
 */

// ═══════════════════════════════════════════════════════════
// Normalization (raw → UnifiedPersona)
// ═══════════════════════════════════════════════════════════

/**
 * Normalize a character from either mode into UnifiedPersona.
 * READ-ONLY — does not modify storage.
 *
 * @param {object} raw — raw character object from getCharacter(id, mode)
 * @param {string} sourceMode — 'daily' | 'story'
 * @returns {UnifiedPersona|null}
 */
export function normalizeCharacter(raw, sourceMode) {
  if (!raw) return null

  const isStory = sourceMode === 'story' || raw.chatStyle === 'story'

  if (isStory) {
    return normalizeFromStory(raw)
  }

  return normalizeFromDaily(raw)
}

function normalizeFromStory(raw) {
  const characters = (raw.romanceCharacters || []).map(normalizePersonaChar)

  // Also include NPCs as persona characters (type='npc')
  const npcChars = (raw.npcs || []).filter(n => n.name).map(n => ({
    id: n.id || n.name,
    name: n.name,
    avatar: n.avatar || '',
    background: n.background || '',
    personality: n.personality || '',
    speakingStyle: n.speakingStyle || '',
    styleRules: typeof n.styleRules === 'string' ? n.styleRules.split('\n').filter(Boolean) : (n.styleRules || []),
    forbiddenWords: typeof n.forbiddenWords === 'string' ? n.forbiddenWords.split('\n').filter(Boolean) : (n.forbiddenWords || []),
    affectionEnabled: false,
    affectionInitial: 50,
    affectionStages: [],
    transitionTriggers: '',
    irreversibleMoment: '',
    erosionCondition: '',
    anchorSuppression: '',
    thinkingEnabled: false,
    thinkingPrompt: '',
    type: 'npc',
    relationship: n.relationship || '',
  }))

  return {
    id: raw.id || '',
    name: raw.name || '',
    avatar: raw.avatar || '',
    worldSetting: raw.worldSetting || '',
    openingScenario: raw.openingScenario || '',
    storyTone: raw.storyTone || '甜虐',
    protagonistName: raw.protagonistName || '',
    protagonistGender: raw.protagonistGender || '',
    protagonistBackground: raw.protagonistBackground || '',
    protagonistPersonality: raw.protagonistPersonality || '',
    characters: [...characters, ...npcChars],
    npcs: raw.npcs || [],
    dailyConfig: {
      contextWindow: raw.contextWindow || 40,
      showTimestamp: raw.showTimestamp || false,
      activeMessageEnabled: raw.activeMessageEnabled || false,
      activePrompt: raw.activePrompt || '',
      nickname: raw.nickname || '',
    },
    dramaConfig: {
      temperature: raw.temperature ?? 0.9,
      topP: raw.topP ?? 0.95,
      thinkingEnabled: raw.thinkingEnabled || false,
      thinkingPrompt: raw.thinkingPrompt || '',
      autoGenerateNpcs: raw.autoGenerateNpcs !== false,
      npcStyleLimit: raw.npcStyleLimit || '',
    },
    chatStyle: 'story', // kept for backward compat
    _sourceMode: 'story',
    _normalizedAt: Date.now(),
  }
}

function normalizeFromDaily(raw) {
  // Synthesize a single PersonaCharacter from daily mode's flat fields
  const personaChar = {
    id: (raw.id || '') + '_persona',
    name: raw.name || '',
    avatar: raw.avatar || '',
    background: raw.background || '',
    personality: raw.personality || '',
    speakingStyle: raw.speakingStyle || '',
    styleRules: normalizeStringArray(raw.styleRules),
    forbiddenWords: normalizeStringArray(raw.forbiddenWords),
    affectionEnabled: raw.affectionEnabled || false,
    affectionInitial: raw.affectionInitial ?? 50,
    affectionStages: raw.affectionStages || [],
    transitionTriggers: raw.affectionUpRules || '',
    irreversibleMoment: raw.affectionDownRules || '',
    erosionCondition: '',
    anchorSuppression: '',
    thinkingEnabled: raw.thinkingEnabled || false,
    thinkingPrompt: raw.thinkingPrompt || '',
    type: 'romance',
    relationship: '',
  }

  return {
    id: raw.id || '',
    name: raw.name || '',
    avatar: raw.avatar || '',
    worldSetting: raw.worldSetting || '',
    openingScenario: raw.openingScenario || '',
    storyTone: raw.storyTone || '日常',
    protagonistName: raw.protagonistName || '',
    protagonistGender: raw.protagonistGender || '',
    protagonistBackground: raw.protagonistBackground || '',
    protagonistPersonality: raw.protagonistPersonality || '',
    characters: [personaChar],
    npcs: raw.npcs || [],
    dailyConfig: {
      contextWindow: raw.contextWindow || 40,
      showTimestamp: raw.showTimestamp || false,
      activeMessageEnabled: raw.activeMessageEnabled || false,
      activePrompt: raw.activePrompt || '',
      nickname: raw.nickname || '',
    },
    dramaConfig: {
      temperature: raw.temperature ?? 0.9,
      topP: raw.topP ?? 0.95,
      thinkingEnabled: raw.thinkingEnabled || false,
      thinkingPrompt: raw.thinkingPrompt || '',
      autoGenerateNpcs: false,
      npcStyleLimit: '',
    },
    chatStyle: 'casual', // kept for backward compat
    _sourceMode: 'daily',
    _normalizedAt: Date.now(),
  }
}

function normalizePersonaChar(rc) {
  return {
    id: rc.id || '',
    name: rc.name || '',
    avatar: rc.avatar || '',
    background: rc.background || '',
    personality: rc.personality || '',
    speakingStyle: rc.speakingStyle || '',
    styleRules: normalizeStringArray(rc.styleRules),
    forbiddenWords: normalizeStringArray(rc.forbiddenWords),
    affectionEnabled: rc.affectionEnabled !== false,
    affectionInitial: rc.affectionInitial ?? 50,
    affectionStages: rc.affectionStages || [],
    transitionTriggers: rc.transitionTriggers || '',
    irreversibleMoment: rc.irreversibleMoment || '',
    erosionCondition: rc.erosionCondition || '',
    anchorSuppression: rc.anchorSuppression || '',
    thinkingEnabled: rc.thinkingEnabled !== false,
    thinkingPrompt: rc.thinkingPrompt || '',
    type: 'romance',
    relationship: '',
  }
}

// ═══════════════════════════════════════════════════════════
// Legacy format reconstruction (UnifiedPersona → raw)
// ═══════════════════════════════════════════════════════════

/**
 * Reconstruct a legacy-format character object for existing code paths.
 * This lets us gradually refactor ChatRoom without breaking everything.
 *
 * @param {UnifiedPersona} persona
 * @param {string} mode — 'drama' | 'daily'
 * @returns {object} legacy character object
 */
export function getLegacyCharacter(persona, mode) {
  if (!persona) return null

  if (mode === 'drama') {
    return {
      id: persona.id,
      name: persona.name,
      avatar: persona.avatar,
      chatStyle: 'story',
      worldSetting: persona.worldSetting,
      openingScenario: persona.openingScenario,
      storyTone: persona.storyTone,
      protagonistName: persona.protagonistName,
      protagonistGender: persona.protagonistGender,
      protagonistBackground: persona.protagonistBackground,
      protagonistPersonality: persona.protagonistPersonality,
      romanceCharacters: persona.characters
        .filter(c => c.type === 'romance')
        .map(c => ({
          id: c.id,
          name: c.name,
          avatar: c.avatar,
          background: c.background,
          personality: c.personality,
          speakingStyle: c.speakingStyle,
          styleRules: c.styleRules,
          forbiddenWords: c.forbiddenWords,
          affectionEnabled: c.affectionEnabled,
          affectionInitial: c.affectionInitial,
          affectionStages: c.affectionStages,
          transitionTriggers: c.transitionTriggers,
          irreversibleMoment: c.irreversibleMoment,
          erosionCondition: c.erosionCondition,
          anchorSuppression: c.anchorSuppression,
          thinkingEnabled: c.thinkingEnabled,
          thinkingPrompt: c.thinkingPrompt,
        })),
      npcs: persona.npcs,
      contextWindow: persona.dailyConfig.contextWindow,
      showTimestamp: persona.dailyConfig.showTimestamp,
      activeMessageEnabled: persona.dailyConfig.activeMessageEnabled,
      activePrompt: persona.dailyConfig.activePrompt,
      nickname: persona.dailyConfig.nickname,
      temperature: persona.dramaConfig.temperature,
      topP: persona.dramaConfig.topP,
      thinkingEnabled: persona.dramaConfig.thinkingEnabled,
      thinkingPrompt: persona.dramaConfig.thinkingPrompt,
      autoGenerateNpcs: persona.dramaConfig.autoGenerateNpcs,
      npcStyleLimit: persona.dramaConfig.npcStyleLimit,
      affectionEnabled: persona.characters.some(c => c.affectionEnabled),
    }
  }

  // Daily mode legacy format
  const mainChar = persona.characters[0] || {}
  return {
    id: persona.id,
    name: persona.name,
    avatar: persona.avatar,
    chatStyle: 'casual',
    background: mainChar.background || '',
    personality: mainChar.personality || '',
    speakingStyle: mainChar.speakingStyle || '',
    styleRules: mainChar.styleRules || [],
    forbiddenWords: mainChar.forbiddenWords || [],
    affectionEnabled: mainChar.affectionEnabled || false,
    affectionInitial: mainChar.affectionInitial ?? 50,
    affectionStages: mainChar.affectionStages || [],
    affectionUpRules: mainChar.transitionTriggers || '',
    affectionDownRules: mainChar.irreversibleMoment || '',
    thinkingEnabled: mainChar.thinkingEnabled || false,
    thinkingPrompt: mainChar.thinkingPrompt || '',
    protagonistName: persona.protagonistName,
    protagonistGender: persona.protagonistGender,
    protagonistBackground: persona.protagonistBackground,
    protagonistPersonality: persona.protagonistPersonality,
    openingScenario: persona.openingScenario,
    worldSetting: persona.worldSetting,
    contextWindow: persona.dailyConfig.contextWindow,
    showTimestamp: persona.dailyConfig.showTimestamp,
    activeMessageEnabled: persona.dailyConfig.activeMessageEnabled,
    activePrompt: persona.dailyConfig.activePrompt,
    nickname: persona.dailyConfig.nickname,
    temperature: persona.dramaConfig.temperature,
    topP: persona.dramaConfig.topP,
    npcs: persona.npcs,
  }
}

/**
 * Get only the romance characters (exclude NPCs).
 */
export function getRomanceCharacters(persona) {
  if (!persona) return []
  return persona.characters.filter(c => c.type === 'romance')
}

/**
 * Get the primary character name (first romance character).
 */
export function getPrimaryCharacterName(persona) {
  const romances = getRomanceCharacters(persona)
  return romances[0]?.name || persona.name || ''
}

/**
 * Check if persona has multiple romance characters (修罗场 mode).
 */
export function hasHarem(persona) {
  return getRomanceCharacters(persona).length >= 2
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string') return value.split('\n').map(s => s.trim()).filter(Boolean)
  return []
}
