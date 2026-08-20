/**
 * Working Memory — short-term verbatim message context.
 *
 * Extracts the last N user+assistant turns for immediate LLM context.
 * System (memory) messages are excluded — they go through the episode layer.
 */

/**
 * Get the last N user+assistant messages for working memory.
 * @param {Array} messages - flat messages array
 * @param {number} maxTurns - max conversation turns to keep (default 8)
 * @returns {Array} last N user/assistant messages
 */
export function getWorkingMemory(messages, maxTurns = 8) {
  if (!messages || messages.length === 0) return []

  // Filter: only user and assistant messages (no system/memory)
  const conversation = messages.filter(m => m.role === 'user' || m.role === 'assistant')

  // Count turns (a turn = user + optional assistant)
  const turns = []
  let currentTurn = []

  for (const msg of conversation) {
    currentTurn.push(msg)
    if (msg.role === 'assistant') {
      turns.push([...currentTurn])
      currentTurn = []
    }
  }
  // If there's a dangling user message without reply, include it
  if (currentTurn.length > 0) {
    turns.push(currentTurn)
  }

  // Take last N turns, flatten back to messages
  const recentTurns = turns.slice(-maxTurns)
  return recentTurns.flat()
}

/**
 * Count working memory messages.
 */
export function countWorkingMessages(messages, maxTurns = 8) {
  return getWorkingMemory(messages, maxTurns).length
}

/**
 * Format working memory for prompt injection.
 */
export function formatWorkingMemoryForPrompt(messages, maxTurns = 8) {
  const working = getWorkingMemory(messages, maxTurns)
  if (working.length === 0) return ''

  return working
    .map(m => (m.role === 'user' ? '玩家：' : '') + m.content.slice(0, 2000))
    .join('\n\n')
}
