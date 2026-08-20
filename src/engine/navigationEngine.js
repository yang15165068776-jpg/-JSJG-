/**
 * NavigationEngine v1 — Route stack with history.
 *
 * Replaces raw setPage('...') with a proper push/pop stack.
 * This fixes: back button blanking, lost context, page state fracture.
 *
 * Usage:
 *   NavigationEngine.push('dramaPage', { folderId: 'abc' })
 *   NavigationEngine.back()          // pops stack, restores previous page
 *   NavigationEngine.replace('entry') // replaces current, no stack change
 *   NavigationEngine.reset()         // clears stack, goes to entry
 */

const NAV_EVENT = 'NAV_CHANGE'

const NavigationEngine = {
  stack: [],
  current: 'entry',
  currentParams: {},

  /**
   * Push a new page onto the stack.
   * Saves current page + params to history, navigates to new page.
   */
  push(page, params = {}) {
    this.stack.push({
      page: this.current,
      params: { ...this.currentParams },
    })
    this.current = page
    this.currentParams = params
    this._emit()
  },

  /**
   * Replace current page without pushing to stack.
   * Use for redirects, not for normal navigation.
   */
  replace(page, params = {}) {
    this.current = page
    this.currentParams = params
    this._emit()
  },

  /**
   * Go back to previous page. Pops from stack.
   * If stack is empty, goes to entry.
   */
  back() {
    if (this.stack.length === 0) {
      this.current = 'entry'
      this.currentParams = {}
      this._emit()
      return
    }
    const prev = this.stack.pop()
    this.current = prev.page
    this.currentParams = prev.params
    this._emit()
  },

  /**
   * Check if there's a previous page to go back to.
   */
  canGoBack() {
    return this.stack.length > 0
  },

  /**
   * Get the page that would be restored on back().
   * Returns null if stack is empty.
   */
  peekBack() {
    if (this.stack.length === 0) return null
    return this.stack[this.stack.length - 1]
  },

  /**
   * Reset everything — clear stack, go to entry.
   */
  reset() {
    this.stack = []
    this.current = 'entry'
    this.currentParams = {}
    this._emit()
  },

  _emit() {
    window.dispatchEvent(new CustomEvent(NAV_EVENT, {
      detail: { page: this.current, params: this.currentParams }
    }))
  },
}

export { NavigationEngine, NAV_EVENT }
