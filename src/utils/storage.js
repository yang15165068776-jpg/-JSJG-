function getPrefix(mode) {
  if (mode === 'story') return 'story_'
  if (mode === 'daily') return 'daily_'
  return 'rp_'
}

function getKeys(mode) {
  const p = getPrefix(mode)
  return {
    CHARACTERS: p + 'characters',
    CHAT_ARCHIVES: p + 'chat_archives',
    SETTINGS: 'rp_settings',
    MIGRATION: '_' + p + 'migrated_v2',
  }
}

function cleanOldMessages() {
  // Find all chat archive keys across all modes
  const archiveKeys = ['story_chat_archives', 'daily_chat_archives', 'rp_chat_archives']
  for (const key of archiveKeys) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const all = JSON.parse(raw)
      let modified = false
      for (const archiveId of Object.keys(all)) {
        const archive = all[archiveId]
        if (archive.messages && archive.messages.length > 20) {
          archive.messages = archive.messages.slice(-20)
          modified = true
        }
      }
      if (modified) {
        localStorage.setItem(key, JSON.stringify(all))
      }
    } catch {}
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      cleanOldMessages()
      try {
        localStorage.setItem(key, value)
        return true
      } catch {
        alert('存储空间不足，请导出并清理部分对话记录')
        return false
      }
    }
    return false
  }
}

function migrateChatArchives(mode) {
  const keys = getKeys(mode)
  if (localStorage.getItem(keys.MIGRATION)) return
  const oldRaw = localStorage.getItem('rp_chat_history')
  const newRaw = localStorage.getItem(keys.CHAT_ARCHIVES)
  if (newRaw) {
    localStorage.setItem(keys.MIGRATION, '1')
    return
  }
  if (!oldRaw) {
    localStorage.setItem(keys.MIGRATION, '1')
    return
  }
  try {
    const oldData = JSON.parse(oldRaw)
    const newData = JSON.parse(localStorage.getItem(keys.CHAT_ARCHIVES) || '{}')
    for (const [characterId, entry] of Object.entries(oldData)) {
      if (!entry.messages || entry.messages.length === 0) continue
      const archiveId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
      newData[archiveId] = {
        id: archiveId,
        characterId,
        name: '默认对话',
        createdAt: Date.now(),
        messages: entry.messages,
        affection: entry.affection ?? null,
      }
    }
    localStorage.setItem(keys.CHAT_ARCHIVES, JSON.stringify(newData))
  } catch {}
  localStorage.setItem(keys.MIGRATION, '1')
}

// ---------- Characters ----------

export function getCharacters(mode) {
  try {
    return JSON.parse(localStorage.getItem(getKeys(mode).CHARACTERS) || '[]')
  } catch { return [] }
}

export function saveCharacters(characters, mode) {
  safeSetItem(getKeys(mode).CHARACTERS, JSON.stringify(characters))
}

export function getCharacter(id, mode) {
  return getCharacters(mode).find(c => c.id === id) || null
}

export function saveCharacter(character, mode) {
  const list = getCharacters(mode)
  const idx = list.findIndex(c => c.id === character.id)
  if (idx >= 0) {
    list[idx] = character
  } else {
    list.push(character)
  }
  saveCharacters(list, mode)
  return character
}

export function deleteCharacter(id, mode) {
  const list = getCharacters(mode).filter(c => c.id !== id)
  saveCharacters(list, mode)
  const keys = getKeys(mode)
  const all = JSON.parse(localStorage.getItem(keys.CHAT_ARCHIVES) || '{}')
  for (const [archiveId, archive] of Object.entries(all)) {
    if (archive.characterId === id) {
      delete all[archiveId]
    }
  }
  safeSetItem(keys.CHAT_ARCHIVES, JSON.stringify(all))
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
}

// ---------- Archives ----------

function readArchives(mode) {
  migrateChatArchives(mode)
  try {
    return JSON.parse(localStorage.getItem(getKeys(mode).CHAT_ARCHIVES) || '{}')
  } catch { return {} }
}

function writeArchives(data, mode) {
  safeSetItem(getKeys(mode).CHAT_ARCHIVES, JSON.stringify(data))
}

export function getArchives(characterId, mode) {
  const all = readArchives(mode)
  return Object.values(all)
    .filter(a => a.characterId === characterId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function getArchive(archiveId, mode) {
  const all = readArchives(mode)
  return all[archiveId] || null
}

export function getOrCreateDefaultArchive(characterId, mode) {
  const existing = getArchives(characterId, mode)
  if (existing.length > 0) return existing[0]
  const archiveId = generateId()
  const archive = {
    id: archiveId,
    characterId,
    name: '默认对话',
    createdAt: Date.now(),
    messages: [],
    affection: null,
    affections: null,
  }
  saveArchive(archive, mode)
  return archive
}

export function createArchive(characterId, name, mode) {
  const archiveId = generateId()
  const archive = {
    id: archiveId,
    characterId,
    name: name || '新对话',
    createdAt: Date.now(),
    messages: [],
    affection: null,
    affections: null,
  }
  saveArchive(archive, mode)
  return archive
}

export function saveArchive(archive, mode) {
  const all = readArchives(mode)
  all[archive.id] = archive
  writeArchives(all, mode)
}

export function deleteArchive(archiveId, mode) {
  const all = readArchives(mode)
  delete all[archiveId]
  writeArchives(all, mode)
}

export function renameArchive(archiveId, newName, mode) {
  const archive = getArchive(archiveId, mode)
  if (!archive) return
  archive.name = newName
  saveArchive(archive, mode)
}

// ---------- Chat messages ----------

export function getChatMessages(archiveId, mode) {
  const archive = getArchive(archiveId, mode)
  return archive?.messages || []
}

export function getAffection(archiveId, mode) {
  const archive = getArchive(archiveId, mode)
  return archive?.affection ?? null
}

export function getAffections(archiveId, mode) {
  const archive = getArchive(archiveId, mode)
  return archive?.affections ?? null
}

export function saveChatMessages(archiveId, messages, mode) {
  const archive = getArchive(archiveId, mode)
  if (!archive) return
  archive.messages = messages
  saveArchive(archive, mode)
}

export function saveAffection(archiveId, value, mode) {
  const archive = getArchive(archiveId, mode)
  if (!archive) return
  archive.affection = value
  saveArchive(archive, mode)
}

export function saveAffections(archiveId, affections, mode) {
  const archive = getArchive(archiveId, mode)
  if (!archive) return
  archive.affections = affections
  saveArchive(archive, mode)
}

export function clearChatHistory(archiveId, mode) {
  deleteArchive(archiveId, mode)
}

// ---------- Settings (shared across modes) ----------

export function getSettings() {
  try {
    return JSON.parse(localStorage.getItem('rp_settings') || '{}')
  } catch { return {} }
}

export function saveSettings(settings) {
  safeSetItem('rp_settings', JSON.stringify(settings))
}

export function getApiKey() {
  return getSettings().apiKey || import.meta.env.VITE_API_KEY || ''
}

export function saveApiKey(key) {
  const settings = getSettings()
  settings.apiKey = key
  saveSettings(settings)
}

export function getModel() {
  return getSettings().model || 'deepseek-v4-flash'
}

export function saveModel(model) {
  const settings = getSettings()
  settings.model = model
  saveSettings(settings)
}

/** 审计模型 — RQA/RCC 专用，独立于主生成模型 */
export function getAuditModel() {
  return getSettings().auditModel || 'deepseek-v4-flash'
}

export function saveAuditModel(model) {
  const settings = getSettings()
  settings.auditModel = model
  saveSettings(settings)
}

export function getUserAvatar() {
  return getSettings().userAvatar || ''
}

export function saveUserAvatar(avatar) {
  const settings = getSettings()
  settings.userAvatar = avatar
  saveSettings(settings)
}

// ═══════════════════════════════════════════════════════════
// Player Profile (v6)
// ═══════════════════════════════════════════════════════════

const PLAYER_PROFILE_KEY = 'jsjg_player_profile'

export function getPlayerProfile() {
  try {
    return JSON.parse(localStorage.getItem(PLAYER_PROFILE_KEY) || '{"name":"","avatar":"","gender":"","personalityTags":[]}')
  } catch {
    return { name: '', avatar: '', gender: '', personalityTags: [] }
  }
}

export function savePlayerProfile(profile) {
  const existing = getPlayerProfile()
  const merged = { ...existing, ...profile }
  try {
    localStorage.setItem(PLAYER_PROFILE_KEY, JSON.stringify(merged))
    return true
  } catch { return false }
}

// ═══════════════════════════════════════════════════════════
// Folder Storage (v6) — delegates to folderStore
// ═══════════════════════════════════════════════════════════

const FOLDERS_KEY = 'jsjg_folders'
const FOLDER_SAVES_PREFIX = 'jsjg_folder_saves_'

export function _readFolders() {
  try { return JSON.parse(localStorage.getItem(FOLDERS_KEY) || '[]') } catch { return [] }
}

export function _writeFolders(folders) {
  try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders)) } catch {}
}

export function _readFolderSaves(folderId) {
  try { return JSON.parse(localStorage.getItem(FOLDER_SAVES_PREFIX + folderId) || '{}') } catch { return {} }
}

export function _writeFolderSaves(folderId, saves) {
  try { localStorage.setItem(FOLDER_SAVES_PREFIX + folderId, JSON.stringify(saves)) } catch {}
}

// ═══════════════════════════════════════════════════════════
// Legacy Character Import Helpers (v6)
// ═══════════════════════════════════════════════════════════

/**
 * Get all legacy characters across both modes.
 * Used by the import-into-folder flow.
 * @returns {object[]} — [ { id, name, avatar, mode, raw }, ... ]
 */
export function getAllLegacyCharacters() {
  const chars = []
  try {
    const storyChars = JSON.parse(localStorage.getItem('story_characters') || '[]')
    for (const c of storyChars) {
      chars.push({ id: c.id, name: c.name, avatar: c.avatar || '', mode: 'story', raw: c })
    }
  } catch {}
  try {
    const dailyChars = JSON.parse(localStorage.getItem('daily_characters') || '[]')
    for (const c of dailyChars) {
      chars.push({ id: c.id, name: c.name, avatar: c.avatar || '', mode: 'daily', raw: c })
    }
  } catch {}
  return chars
}

/**
 * Get all legacy archives for a character.
 * @returns {object[]}
 */
export function getLegacyArchivesForCharacter(characterId, mode) {
  return getArchives(characterId, mode)
}
