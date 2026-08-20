/**
 * HydrationEngine v2 — State recovery layer (save-isolated).
 *
 * Caches page state (messages, USK) so navigating away and back
 * doesn't lose everything. Also loads state from folder saves.
 *
 * v2 fix: All cache keys now include saveId to prevent data leaking
 * between save slots. USK loads per-save instead of shared folder level.
 *
 * Usage:
 *   // Before navigating away from DramaPage:
 *   HydrationEngine.save(folderId, saveId, 'drama', messages, uskSnapshot)
 *
 *   // When DramaPage mounts:
 *   const cached = HydrationEngine.get(folderId, saveId, 'drama')
 *   if (cached) { setMessages(cached.messages); setUSK(cached.usk) }
 *
 *   // When opening a save from FolderInterior:
 *   const state = HydrationEngine.hydrate(folderId, saveId)
 */

import { getSave, getSaveMessages } from '../state/folderStore'
import { loadFolderUSK } from '../state/unifiedStateKernel'

/** Build cache key with save isolation */
function _cacheKey(folderId, saveId, mode) {
  return folderId + ':' + (saveId || '') + ':' + mode
}

const HydrationEngine = {
  /** { [`${folderId}:${saveId}:${mode}`]: { messages, usk, timestamp } } */
  cache: {},

  /**
   * Cache current page state before navigating away.
   *
   * @param {string} folderId
   * @param {string} saveId — save isolation key
   * @param {string} mode — 'drama' | 'daily'
   * @param {object[]} messages
   * @param {object} usk — full USK snapshot
   */
  save(folderId, saveId, mode, messages, usk) {
    if (!folderId || !mode) return
    const key = _cacheKey(folderId, saveId, mode)
    this.cache[key] = {
      messages: messages || [],
      usk: usk || null,
      timestamp: Date.now(),
    }
  },

  /**
   * Get cached state for a specific save+page.
   *
   * @param {string} folderId
   * @param {string} saveId
   * @param {string} mode — 'drama' | 'daily'
   * @returns {{ messages: object[], usk: object|null, timestamp: number } | null}
   */
  get(folderId, saveId, mode) {
    if (!folderId || !mode) return null
    const key = _cacheKey(folderId, saveId, mode)
    return this.cache[key] || null
  },

  /**
   * Load state from a specific folder save.
   * Used when clicking a save in FolderInterior.
   *
   * @param {string} folderId
   * @param {string} saveId — specific save ID
   * @param {string} mode — 'drama' | 'daily' | 'all'
   * @returns {{ dramaMessages?: object[], dailyMessages?: object[], usk: object|null }}
   */
  hydrate(folderId, saveId, mode = 'all') {
    if (!folderId || !saveId) return null

    const save = getSave(saveId, folderId)
    if (!save) return null

    // Load per-save USK (v2 fix: was loading shared folder USK)
    const usk = loadFolderUSK(folderId, saveId)

    const state = {
      usk: usk || null,
    }

    if (mode === 'all' || mode === 'drama') {
      state.dramaMessages = getSaveMessages(saveId, folderId, 'drama')
    }
    if (mode === 'all' || mode === 'daily') {
      state.dailyMessages = getSaveMessages(saveId, folderId, 'daily')
    }

    // Also cache for get() calls — v2: key includes saveId
    if (state.dramaMessages) {
      this.cache[_cacheKey(folderId, saveId, 'drama')] = { messages: state.dramaMessages, usk, timestamp: Date.now() }
    }
    if (state.dailyMessages) {
      this.cache[_cacheKey(folderId, saveId, 'daily')] = { messages: state.dailyMessages, usk, timestamp: Date.now() }
    }

    return state
  },

  /**
   * Check if cached state exists for a folder+save+mode.
   */
  has(folderId, saveId, mode) {
    if (!folderId || !mode) return false
    return !!this.cache[_cacheKey(folderId, saveId, mode)]
  },

  /**
   * Clear all cached state.
   */
  clear() {
    this.cache = {}
  },

  /**
   * Clear cached state for a specific folder+save+mode.
   */
  clearOne(folderId, saveId, mode) {
    if (!folderId || !mode) return
    delete this.cache[_cacheKey(folderId, saveId, mode)]
  },
}

export { HydrationEngine }
