/**
 * Folder Store — Top-level container for Character OS v6
 *
 * Architecture:
 *   Folder = World instance (世界容器)
 *     ├── Characters (角色，来自 legacy 或新建)
 *     ├── USK (单一状态源，内含多角色子状态 + global_state)
 *     └── Saves (时间点存档，仅存消息，不存状态)
 *
 * Principles:
 *   1. Folder 是世界容器，不是角色容器
 *   2. USK 是唯一状态源 (SSOT)
 *   3. Save 只存消息，状态永远来自 USK
 *   4. 所有 legacy 数据通过 adapter 接入
 *
 * Storage keys:
 *   jsjg_folders           — Folder[] array
 *   jsjg_folder_saves_<id> — { [saveId]: Save }
 *   jsjg_player_profile    — PlayerProfile
 */

// ═══════════════════════════════════════════════════════════
// Storage keys
// ═══════════════════════════════════════════════════════════

const FOLDERS_KEY = 'jsjg_folders'
const SAVES_PREFIX = 'jsjg_folder_saves_'
const PROFILE_KEY = 'jsjg_player_profile'

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      // Attempt cleanup: trim oldest saves
      try {
        const folders = _readFolders()
        for (const f of folders) {
          const saves = _readSaves(f.id)
          const ids = Object.keys(saves)
          if (ids.length > 10) {
            const oldest = ids.sort((a, b) => (saves[a].createdAt || 0) - (saves[b].createdAt || 0)).slice(0, ids.length - 5)
            for (const id of oldest) delete saves[id]
            localStorage.setItem(SAVES_PREFIX + f.id, JSON.stringify(saves))
          }
        }
        localStorage.setItem(key, value)
        return true
      } catch {
        alert('存储空间不足，请清理部分存档')
        return false
      }
    }
    return false
  }
}

// ═══════════════════════════════════════════════════════════
// Internal readers
// ═══════════════════════════════════════════════════════════

function _readFolders() {
  try {
    return JSON.parse(localStorage.getItem(FOLDERS_KEY) || '[]')
  } catch { return [] }
}

function _writeFolders(folders) {
  safeSet(FOLDERS_KEY, JSON.stringify(folders))
}

function _readSaves(folderId) {
  try {
    return JSON.parse(localStorage.getItem(SAVES_PREFIX + folderId) || '{}')
  } catch { return {} }
}

function _writeSaves(folderId, saves) {
  safeSet(SAVES_PREFIX + folderId, JSON.stringify(saves))
}

// ═══════════════════════════════════════════════════════════
// Folder CRUD
// ═══════════════════════════════════════════════════════════

/**
 * Create a new Folder (世界).
 *
 * @param {string} name — 世界/计划名称
 * @param {string} worldview — 世界观描述
 * @param {string} storyIntro — 开场剧情
 * @param {string} accountId — 归属账户 ID（可选，默认取活跃账户）
 * @returns {object} Folder
 */
export function createFolder(name, worldview = '', storyIntro = '', accountId = '', playerName = '', playerGender = '', playerDescription = '') {
  // accountId kept for backward compat, but no longer required.
  // playerName/playerGender/playerDescription are the v9 simplified identity model.
  const folders = _readFolders()
  const folder = {
    id: generateId(),
    name: name || '未命名世界',
    worldview,
    story_intro: storyIntro,
    accountId: accountId || '',
    // v9: player identity is per-world, not global account
    playerName: playerName || '',
    playerGender: playerGender || '',
    playerDescription: playerDescription || '',
    characterIds: [],
    characterData: [],
    saveIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  folders.push(folder)
  _writeFolders(folders)
  _writeSaves(folder.id, {})
  return folder
}

/**
 * Get all Folders, sorted by updatedAt desc.
 * Optionally filter by accountId.
 * @param {string} [accountId] — if provided, only return folders for this account
 * @returns {object[]}
 */
export function getAllFolders(accountId) {
  const folders = _readFolders()
  const filtered = accountId
    ? folders.filter(f => !f.accountId || f.accountId === accountId)
    : folders
  return filtered.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
}

/**
 * Get all Folders for a specific account.
 * @param {string} accountId
 * @returns {object[]}
 */
export function getAllFoldersByAccount(accountId) {
  return getAllFolders(accountId)
}

/**
 * Assign folders without accountId to a given account.
 * Used during migration.
 * @param {string} accountId
 */
export function assignOrphanFolders(accountId) {
  if (!accountId) return
  const folders = _readFolders()
  let modified = false
  for (const f of folders) {
    if (!f.accountId) {
      f.accountId = accountId
      modified = true
    }
  }
  if (modified) {
    _writeFolders(folders)
  }
}

/**
 * Get a single Folder by ID.
 * @param {string} id
 * @returns {object|null}
 */
export function getFolder(id) {
  if (!id) return null
  return _readFolders().find(f => f.id === id) || null
}

/**
 * Update a Folder's metadata.
 * @param {string} id
 * @param {object} updates — { name?, worldview?, story_intro? }
 * @returns {object|null} updated Folder
 */
export function updateFolder(id, updates) {
  const folders = _readFolders()
  const idx = folders.findIndex(f => f.id === id)
  if (idx === -1) return null
  const allowed = ['name', 'worldview', 'story_intro', 'characterIds', 'characterData', 'saveIds', 'accountId', 'playerName', 'playerGender', 'playerDescription']
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      folders[idx][key] = updates[key]
    }
  }
  folders[idx].updatedAt = Date.now()
  _writeFolders(folders)
  return folders[idx]
}

/**
 * Delete a Folder and all its saves.
 * @param {string} id
 * @returns {boolean}
 */
export function deleteFolder(id) {
  const folders = _readFolders().filter(f => f.id !== id)
  _writeFolders(folders)
  // Remove saves
  try { localStorage.removeItem(SAVES_PREFIX + id) } catch {}
  // Remove all USK variants (folder-level + per-save)
  try {
    const uskPrefix = 'jsjg_folder_usk_' + id
    localStorage.removeItem(uskPrefix)
    // Also remove per-save USK keys
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key && key.startsWith(uskPrefix + '_')) localStorage.removeItem(key)
    }
  } catch {}
  // Remove NIO (narrative identity)
  try {
    const niPrefix = 'jsjg_ni_' + id
    localStorage.removeItem(niPrefix)
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key && key.startsWith(niPrefix + '_')) localStorage.removeItem(key)
    }
  } catch {}
  // Remove hydration cache
  try {
    const hydPrefix = 'jsjg_hyd_' + id
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key && key.startsWith(hydPrefix)) localStorage.removeItem(key)
    }
  } catch {}
  return true
}

// ═══════════════════════════════════════════════════════════
// Characters in Folder
// ═══════════════════════════════════════════════════════════

/**
 * Add a legacy character reference to a Folder.
 * The actual character data stays in story_characters / daily_characters.
 *
 * @param {string} folderId
 * @param {string} characterId — legacy character ID
 * @param {string} mode — 'story' | 'daily' (where the actual data lives)
 * @returns {object|null} updated Folder
 */
export function addCharacterToFolder(folderId, characterId, mode = 'story') {
  const folder = getFolder(folderId)
  if (!folder) return null
  if (folder.characterIds.includes(characterId)) return folder

  const updated = {
    characterIds: [...folder.characterIds, characterId],
  }
  return updateFolder(folderId, updated)
}

/**
 * Remove a character reference from a Folder.
 * @returns {object|null} updated Folder
 */
export function removeCharacterFromFolder(folderId, characterId) {
  const folder = getFolder(folderId)
  if (!folder) return null
  return updateFolder(folderId, {
    characterIds: folder.characterIds.filter(id => id !== characterId),
  })
}

/**
 * Add inline character data to a Folder (folder-native, not legacy).
 * Used when characters are created directly inside a Folder context.
 *
 * @param {string} folderId
 * @param {object} charData — { name, personality, background, ... }
 * @returns {object|null} updated Folder
 */
export function addInlineCharacter(folderId, charData) {
  const folder = getFolder(folderId)
  if (!folder) return null

  const newChar = {
    id: generateId(),
    ...charData,
    createdAt: Date.now(),
  }

  return updateFolder(folderId, {
    characterData: [...(folder.characterData || []), newChar],
  })
}

/**
 * Get all characters in a Folder (both legacy refs and inline).
 * Returns a unified array for UI consumption.
 *
 * @param {string} folderId
 * @returns {object[]} — [ { id, name, avatar, source: 'legacy'|'inline', mode?, raw }, ... ]
 */
export function getFolderCharacters(folderId) {
  const folder = getFolder(folderId)
  if (!folder) return []

  const chars = []

  // Inline characters
  for (const c of (folder.characterData || [])) {
    chars.push({
      id: c.id,
      name: c.name || '',
      avatar: c.avatar || '',
      personality: c.personality || '',
      source: 'inline',
      raw: c,
    })
  }

  // Legacy character references — try to resolve from storage
  for (const charId of (folder.characterIds || [])) {
    // Try story mode first, then daily
    let raw = null
    let mode = null
    try {
      const storyChars = JSON.parse(localStorage.getItem('story_characters') || '[]')
      raw = storyChars.find(c => c.id === charId)
      if (raw) mode = 'story'
    } catch {}
    if (!raw) {
      try {
        const dailyChars = JSON.parse(localStorage.getItem('daily_characters') || '[]')
        raw = dailyChars.find(c => c.id === charId)
        if (raw) mode = 'daily'
      } catch {}
    }
    if (raw) {
      chars.push({
        id: raw.id,
        name: raw.name || '',
        avatar: raw.avatar || '',
        source: 'legacy',
        mode,
        raw,
      })
    }
  }

  return chars
}

// ═══════════════════════════════════════════════════════════
// Save CRUD (时间点存档)
// ═══════════════════════════════════════════════════════════

/**
 * Create a new Save within a Folder.
 * Save = time point in the story. Stores messages only; state comes from USK.
 *
 * @param {string} folderId
 * @param {string} name — save name
 * @returns {object} Save
 */
export function createSave(folderId, name) {
  const folder = getFolder(folderId)
  if (!folder) return null

  const save = {
    id: generateId(),
    folderId,
    name: name || '新存档',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dramaMessages: [],     // DRAMA mode — completely isolated
    dailyMessages: [],     // DAILY mode — completely isolated
    dramaStats: { turnCount: 0, promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 },
    dailyStats: { turnCount: 0, promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 },
    // Note: NO affection/affections — state is from USK (SSOT)
  }

  const saves = _readSaves(folderId)
  saves[save.id] = save
  _writeSaves(folderId, saves)

  // Update folder's saveIds
  updateFolder(folderId, { saveIds: [...folder.saveIds, save.id] })

  return save
}

/**
 * Get all Saves for a Folder, sorted by updatedAt desc.
 * @param {string} folderId
 * @returns {object[]}
 */
export function getSaves(folderId) {
  const saves = _readSaves(folderId)
  return Object.values(saves).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
}

/**
 * Get a single Save.
 * @param {string} saveId
 * @param {string} folderId
 * @returns {object|null}
 */
export function getSave(saveId, folderId) {
  if (!saveId || !folderId) return null
  const saves = _readSaves(folderId)
  return saves[saveId] || null
}

/**
 * Get or create the default save for a Folder.
 * @returns {object} Save
 */
export function getOrCreateDefaultSave(folderId) {
  const existing = getSaves(folderId)
  if (existing.length > 0) return existing[0]
  return createSave(folderId, '默认存档')
}

/**
 * Get messages for a specific mode from a Save.
 * DRAMA and DAILY message streams are COMPLETELY ISOLATED.
 *
 * @param {string} saveId
 * @param {string} folderId
 * @param {string} mode — 'drama' | 'daily'
 * @returns {object[]}
 */
export function getSaveMessages(saveId, folderId, mode) {
  const saves = _readSaves(folderId)
  if (!saves[saveId]) return []
  const key = mode === 'drama' ? 'dramaMessages' : 'dailyMessages'
  return saves[saveId][key] || []
}

/**
 * Save messages for a specific mode to a Save slot.
 * DRAMA writes to dramaMessages. DAILY writes to dailyMessages. NEVER cross.
 *
 * @param {string} saveId
 * @param {string} folderId
 * @param {string} mode — 'drama' | 'daily'
 * @param {object[]} messages
 */
export function saveSaveMessages(saveId, folderId, mode, messages) {
  const saves = _readSaves(folderId)
  if (!saves[saveId]) return
  const key = mode === 'drama' ? 'dramaMessages' : 'dailyMessages'
  saves[saveId][key] = messages
  saves[saveId].updatedAt = Date.now()
  _writeSaves(folderId, saves)
}

/**
 * Legacy: update all messages (backward compat for old saves).
 * @deprecated Use saveSaveMessages with mode parameter instead.
 */
export function updateSaveMessages(saveId, folderId, messages) {
  const saves = _readSaves(folderId)
  if (!saves[saveId]) return
  saves[saveId].messages = messages
  saves[saveId].updatedAt = Date.now()
  _writeSaves(folderId, saves)
}

/**
 * Get total message count across both streams for a save.
 * Used by FolderInterior to show message counts.
 */
export function getSaveMessageCount(saveId, folderId) {
  const saves = _readSaves(folderId)
  if (!saves[saveId]) return 0
  const s = saves[saveId]
  return (s.dramaMessages?.length || 0) + (s.dailyMessages?.length || 0) + (s.messages?.length || 0)
}

/**
 * Get accumulated stats (turn count + tokens) for a save mode.
 * Stats persist across sessions — survive exits and re-entries.
 *
 * @param {string} saveId
 * @param {string} folderId
 * @param {string} mode — 'drama' | 'daily'
 * @returns {{ turnCount: number, promptTokens: number, completionTokens: number, cacheHitTokens: number, cacheMissTokens: number }}
 */
export function getSaveStats(saveId, folderId, mode) {
  const saves = _readSaves(folderId)
  if (!saves[saveId]) return null
  const key = mode === 'drama' ? 'dramaStats' : 'dailyStats'
  return saves[saveId][key] || null
}

/**
 * Persist accumulated stats to a save slot.
 * Called on each auto-save to keep stats in sync.
 *
 * @param {string} saveId
 * @param {string} folderId
 * @param {string} mode — 'drama' | 'daily'
 * @param {{ turnCount: number, promptTokens: number, completionTokens: number, cacheHitTokens: number, cacheMissTokens: number }} stats
 */
export function saveSaveStats(saveId, folderId, mode, stats) {
  const saves = _readSaves(folderId)
  if (!saves[saveId]) return
  const key = mode === 'drama' ? 'dramaStats' : 'dailyStats'
  saves[saveId][key] = stats
  saves[saveId].updatedAt = Date.now()
  _writeSaves(folderId, saves)
}

/**
 * Delete a Save.
 */
export function deleteSave(saveId, folderId) {
  const saves = _readSaves(folderId)
  delete saves[saveId]
  _writeSaves(folderId, saves)

  const folder = getFolder(folderId)
  if (folder) {
    updateFolder(folderId, { saveIds: folder.saveIds.filter(id => id !== saveId) })
  }
}

/**
 * Rename a Save.
 */
export function renameSave(saveId, folderId, newName) {
  const saves = _readSaves(folderId)
  if (!saves[saveId]) return
  saves[saveId].name = newName
  saves[saveId].updatedAt = Date.now()
  _writeSaves(folderId, saves)
}

// ═══════════════════════════════════════════════════════════
// Player Profile
// ═══════════════════════════════════════════════════════════

/**
 * Get the player profile.
 * @returns {{ name: string, avatar: string, gender: string, personalityTags: string[] }}
 */
export function getPlayerProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) return { name: '', avatar: '', gender: '', personalityTags: [] }
    return JSON.parse(raw)
  } catch {
    return { name: '', avatar: '', gender: '', personalityTags: [] }
  }
}

/**
 * Save the player profile.
 * @param {object} profile — { name?, avatar?, gender?, personalityTags? }
 */
export function savePlayerProfile(profile) {
  const existing = getPlayerProfile()
  const merged = { ...existing, ...profile }
  safeSet(PROFILE_KEY, JSON.stringify(merged))
  return merged
}

// ═══════════════════════════════════════════════════════════
// Legacy Adapter — import legacy character into Folder
// ═══════════════════════════════════════════════════════════

/**
 * Import a legacy character into a Folder.
 * The character data is copied inline (not referenced) to avoid
 * breaking if the original is deleted.
 *
 * @param {string} folderId
 * @param {object} character — raw character from getCharacter(id, mode)
 * @param {string} mode — 'story' | 'daily'
 * @returns {object|null} updated Folder
 */
export function importLegacyCharacterToFolder(folderId, character, mode) {
  if (!character || !folderId) return null

  const charData = {
    name: character.name || '',
    avatar: character.avatar || '',
    personality: character.personality || '',
    background: character.background || '',
    speakingStyle: character.speakingStyle || '',
    worldSetting: character.worldSetting || '',
    openingScenario: character.openingScenario || '',
    storyTone: character.storyTone || '',
    protagonistName: character.protagonistName || '',
    protagonistGender: character.protagonistGender || '',
    protagonistBackground: character.protagonistBackground || '',
    protagonistPersonality: character.protagonistPersonality || '',
    romanceCharacters: character.romanceCharacters || [],
    npcs: character.npcs || [],
    styleRules: character.styleRules || [],
    forbiddenWords: character.forbiddenWords || [],
    affectionEnabled: character.affectionEnabled || false,
    affectionInitial: character.affectionInitial ?? 50,
    affectionStages: character.affectionStages || [],
    contextWindow: character.contextWindow || 40,
    thinkingEnabled: character.thinkingEnabled || false,
    thinkingPrompt: character.thinkingPrompt || '',
    activeMessageEnabled: character.activeMessageEnabled || false,
    activePrompt: character.activePrompt || '',
    nickname: character.nickname || '',
    temperature: character.temperature ?? 0.9,
    topP: character.topP ?? 0.95,
    legacyId: character.id,        // track origin
    legacyMode: mode,              // track origin mode
    importedAt: Date.now(),
  }

  return addInlineCharacter(folderId, charData)
}

/**
 * Check if a Folder has any characters.
 */
export function folderHasCharacters(folderId) {
  const chars = getFolderCharacters(folderId)
  return chars.length > 0
}

/**
 * Get the total count of saves across all folders.
 * Useful for storage management.
 */
export function getTotalSaveCount() {
  const folders = _readFolders()
  let count = 0
  for (const f of folders) {
    const saves = _readSaves(f.id)
    count += Object.keys(saves).length
  }
  return count
}

// ═══════════════════════════════════════════════════════════
// Daily Session Saves (v4 新增)
// ═══════════════════════════════════════════════════════════

/**
 * Save a daily session snapshot to the folder.
 * Unlike full saves (dramaMessages + dailyMessages), this only stores
 * the daily chat messages as a lightweight time-point snapshot.
 *
 * @param {string} folderId
 * @param {object[]} messages — daily message array
 * @returns {object} the saved session entry
 */
export function saveDailySession(folderId, messages) {
  const folder = getFolder(folderId)
  if (!folder) return null

  if (!folder.dailySaves) folder.dailySaves = []

  const session = {
    id: generateId(),
    messages: messages.slice(-100), // cap at last 100 messages
    timestamp: Date.now(),
  }

  folder.dailySaves.push(session)

  // Cap at 20 daily saves
  if (folder.dailySaves.length > 20) {
    folder.dailySaves = folder.dailySaves.slice(-20)
  }

  updateFolder(folderId, { dailySaves: folder.dailySaves })
  return session
}

/**
 * Get all daily session saves for a folder.
 * @param {string} folderId
 * @returns {object[]}
 */
export function getDailySessions(folderId) {
  const folder = getFolder(folderId)
  if (!folder || !folder.dailySaves) return []
  return folder.dailySaves.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
}
