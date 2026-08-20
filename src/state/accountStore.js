/**
 * Account Store — 玩家账户系统
 *
 * Architecture:
 *   Account = 玩家身份 = 一部"手机"
 *     ├── 每个账户有独立的 name / avatar / gender / personalityTags / description
 *     ├── 每个账户拥有自己的一组 Folder（世界）
 *     └── 切换账户 = 切换手机，看到不同的世界列表
 *
 * Storage keys:
 *   jsjg_accounts        — Account[] array
 *   jsjg_active_account   — string (active account ID)
 *   jsjg_player_profile   — LEGACY（迁移后删除）
 */

import { generateId, assignOrphanFolders } from './folderStore'

// ═══════════════════════════════════════════════════════════
// Storage keys
// ═══════════════════════════════════════════════════════════

const ACCOUNTS_KEY = 'jsjg_accounts'
const ACTIVE_KEY = 'jsjg_active_account'
const LEGACY_PROFILE_KEY = 'jsjg_player_profile'

// ═══════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════

function _readAccounts() {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]')
  } catch { return [] }
}

function _writeAccounts(accounts) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
    return true
  } catch (e) {
    alert('存储空间不足，无法保存账户')
    return false
  }
}

function _readLegacyProfile() {
  try {
    const raw = localStorage.getItem(LEGACY_PROFILE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

// ═══════════════════════════════════════════════════════════
// Migration
// ═══════════════════════════════════════════════════════════

/**
 * Run once: migrate legacy jsjg_player_profile → Account system.
 * Called automatically by getOrCreateDefaultAccount() and getActiveAccount().
 * Idempotent — does nothing if migration already happened.
 *
 * Also assigns existing folder[].accountId if missing.
 *
 * @returns {object|null} the migrated account, or null if nothing to migrate
 */
export function runAccountMigration() {
  const existingAccounts = _readAccounts()
  if (existingAccounts.length > 0) {
    // Migration already done or accounts exist natively
    return null
  }

  const legacy = _readLegacyProfile()
  if (!legacy || (!legacy.name && !legacy.avatar)) {
    // No legacy data to migrate
    return null
  }

  // Create account from legacy profile
  const account = {
    id: generateId(),
    name: legacy.name || '玩家',
    avatar: legacy.avatar || '',
    gender: legacy.gender || '',
    personalityTags: legacy.personalityTags || [],
    description: legacy.description || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  _writeAccounts([account])
  setActiveAccount(account.id)

  // Migrate existing folders — assign to this account
  assignOrphanFolders(account.id)

  // Clean up legacy key
  try { localStorage.removeItem(LEGACY_PROFILE_KEY) } catch {}

  return account
}

// ═══════════════════════════════════════════════════════════
// Account CRUD
// ═══════════════════════════════════════════════════════════

/**
 * Create a new player account.
 * @param {object} opts — { name, avatar?, gender?, personalityTags?, description? }
 * @returns {object} Account
 */
export function createAccount({ name, avatar, gender, personalityTags, description } = {}) {
  const accounts = _readAccounts()
  const account = {
    id: generateId(),
    name: name || '新玩家',
    avatar: avatar || '',
    gender: gender || '',
    personalityTags: personalityTags || [],
    description: description || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  accounts.push(account)
  _writeAccounts(accounts)

  // Auto-set as active if first account
  if (accounts.length === 1) {
    setActiveAccount(account.id)
  }

  return account
}

/**
 * Get all accounts, sorted by createdAt.
 * @returns {object[]}
 */
export function getAllAccounts() {
  return _readAccounts().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

/**
 * Get a single account by ID.
 * @param {string} id
 * @returns {object|null}
 */
export function getAccount(id) {
  if (!id) return null
  return _readAccounts().find(a => a.id === id) || null
}

/**
 * Update an account's fields.
 * @param {string} id
 * @param {object} updates — { name?, avatar?, gender?, personalityTags?, description? }
 * @returns {object|null} updated Account
 */
export function updateAccount(id, updates) {
  const accounts = _readAccounts()
  const idx = accounts.findIndex(a => a.id === id)
  if (idx === -1) return null

  const allowed = ['name', 'avatar', 'gender', 'personalityTags', 'description']
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      accounts[idx][key] = updates[key]
    }
  }
  accounts[idx].updatedAt = Date.now()
  _writeAccounts(accounts)
  return accounts[idx]
}

/**
 * Delete an account. Does NOT delete associated folders (caller should handle that).
 * If deleting the active account, clears the active reference.
 * @param {string} id
 * @returns {boolean}
 */
export function deleteAccount(id) {
  const accounts = _readAccounts().filter(a => a.id !== id)
  if (accounts.length === _readAccounts().length) return false // not found
  _writeAccounts(accounts)

  // Clear active if deleted
  const activeId = getActiveAccountId()
  if (activeId === id) {
    const nextActive = accounts.length > 0 ? accounts[0].id : ''
    setActiveAccount(nextActive)
  }

  return true
}

// ═══════════════════════════════════════════════════════════
// Active Account
// ═══════════════════════════════════════════════════════════

/**
 * Get the active account ID.
 * @returns {string} account ID or empty string
 */
export function getActiveAccountId() {
  try {
    return localStorage.getItem(ACTIVE_KEY) || ''
  } catch { return '' }
}

/**
 * Set the active account.
 * @param {string} id
 */
export function setActiveAccount(id) {
  try {
    if (id) {
      localStorage.setItem(ACTIVE_KEY, id)
    } else {
      localStorage.removeItem(ACTIVE_KEY)
    }
  } catch {}
}

/**
 * Get the full active account object.
 * Auto-runs migration if needed.
 * @returns {object|null} Account or null
 */
export function getActiveAccount() {
  // Ensure migration ran
  runAccountMigration()

  const activeId = getActiveAccountId()
  if (!activeId) {
    // Try to auto-select: first account or create default
    const accounts = _readAccounts()
    if (accounts.length > 0) {
      setActiveAccount(accounts[0].id)
      return accounts[0]
    }
    // No accounts at all — create default from legacy or blank
    return getOrCreateDefaultAccount()
  }

  const account = getAccount(activeId)
  if (!account) {
    // Active account was deleted — fall back to first available
    const accounts = _readAccounts()
    if (accounts.length > 0) {
      setActiveAccount(accounts[0].id)
      return accounts[0]
    }
    return getOrCreateDefaultAccount()
  }

  return account
}

/**
 * Ensure at least one account exists. Creates default if none.
 * Auto-migrates from legacy profile.
 * @returns {object} Account
 */
export function getOrCreateDefaultAccount() {
  // Try migration first
  const migrated = runAccountMigration()
  if (migrated) return migrated

  const accounts = _readAccounts()
  if (accounts.length > 0) {
    // Already exists, make sure active is set
    if (!getActiveAccountId()) {
      setActiveAccount(accounts[0].id)
    }
    return accounts[0]
  }

  // Create a blank default account
  return createAccount({ name: '玩家', avatar: '', gender: '', personalityTags: [], description: '' })
}

// ═══════════════════════════════════════════════════════════
// Folder association helpers
// ═══════════════════════════════════════════════════════════

/**
 * Get all folder IDs associated with an account.
 * @param {string} accountId
 * @returns {string[]}
 */
export function getAccountFolderIds(accountId) {
  if (!accountId) return []
  try {
    const folders = JSON.parse(localStorage.getItem('jsjg_folders') || '[]')
    return folders.filter(f => f.accountId === accountId).map(f => f.id)
  } catch { return [] }
}

/**
 * Delete all folders belonging to an account.
 * @param {string} accountId
 */
export function deleteAccountFolders(accountId) {
  if (!accountId) return
  try {
    const foldersRaw = localStorage.getItem('jsjg_folders')
    if (!foldersRaw) return
    const folders = JSON.parse(foldersRaw)
    const toDelete = folders.filter(f => f.accountId === accountId)
    // Remove folder saves and USKs
    for (const f of toDelete) {
      try { localStorage.removeItem('jsjg_folder_saves_' + f.id) } catch {}
      try { localStorage.removeItem('jsjg_folder_usk_' + f.id) } catch {}
    }
    // Remove folders
    const remaining = folders.filter(f => f.accountId !== accountId)
    localStorage.setItem('jsjg_folders', JSON.stringify(remaining))
  } catch {}
}
