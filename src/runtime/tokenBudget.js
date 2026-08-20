/**
 * Token Budget Controller — enforces hard limits on LLM input size.
 *
 * Limits:
 *   maxInputTokens: 6000   — total input tokens per API call
 *   maxWorkingMemory: 8    — max conversation turns in working memory
 *   maxEpisodes: 12        — max compressed episode summaries
 *
 * When budget is exceeded, trims in order:
 *   1. Drop oldest working memory turns
 *   2. Compress older episodes into fewer
 *   3. Drop oldest episodes
 */

import { estimateTokens } from '../utils/deepseek'
import { getWorkingMemory, formatWorkingMemoryForPrompt } from '../memory/workingMemory'
import { getAllEpisodes, formatEpisodesForPrompt, createEpisodeSummary } from '../memory/episodeSummarizer'

export const LIMITS = {
  maxInputTokens: 6000,
  maxWorkingMemory: 8,
  maxEpisodes: 12,
  maxSystemPromptTokens: 3500,
}

/**
 * Check if current message set is within budget.
 */
export function checkBudget(messages, systemPrompt) {
  const working = getWorkingMemory(messages, LIMITS.maxWorkingMemory)
  const episodes = getAllEpisodes(messages)
  const systemTokens = estimateTokens(systemPrompt || '')
  const workingTokens = estimateTokens(formatWorkingMemoryForPrompt(messages, LIMITS.maxWorkingMemory))
  const episodeTokens = estimateTokens(formatEpisodesForPrompt(episodes, LIMITS.maxEpisodes))
  const total = systemTokens + workingTokens + episodeTokens

  return {
    withinBudget: total <= LIMITS.maxInputTokens,
    breakdown: {
      system: systemTokens,
      working: workingTokens,
      episodes: episodeTokens,
      total,
    },
    limits: { ...LIMITS },
  }
}

/**
 * Enforce budget by trimming. Returns the messages that should be sent.
 * Does NOT mutate the original array — returns a new one.
 */
export async function enforceBudget(messages, systemPrompt, apiKey) {
  const budget = checkBudget(messages, systemPrompt)
  const actions = []

  let result = [...messages]

  // If within budget, nothing to do
  if (budget.withinBudget) {
    return { messages: result, actions: ['预算内，无需修剪'] }
  }

  // Strategy 1: Reduce working memory
  if (budget.breakdown.working > budget.breakdown.system) {
    for (let turns = LIMITS.maxWorkingMemory; turns >= 4; turns -= 2) {
      const working = getWorkingMemory(result, turns)
      const workingTokens = estimateTokens(
        working.map(m => m.content || '').join('\n')
      )

      if (budget.breakdown.system + workingTokens + budget.breakdown.episodes <= LIMITS.maxInputTokens) {
        // Keep only the last N turns in result, preserving system messages
        const conversationMsgs = result.filter(m => m.role !== 'system')
        const systemMsgs = result.filter(m => m.role === 'system')
        const recentConv = working
        result = [...systemMsgs, ...recentConv]
        actions.push(`Working memory 从 ${LIMITS.maxWorkingMemory} 轮缩减至 ${turns} 轮`)
        break
      }
    }
  }

  // Strategy 2: Reduce episodes
  const episodes = getAllEpisodes(result)
  if (episodes.length > 4) {
    for (let maxEp = LIMITS.maxEpisodes; maxEp >= 4; maxEp -= 4) {
      const epTokens = estimateTokens(formatEpisodesForPrompt(episodes, maxEp))
      const currentBudget = checkBudget(result, systemPrompt)
      if (currentBudget.breakdown.system + currentBudget.breakdown.working + epTokens <= LIMITS.maxInputTokens) {
        // Keep only last maxEp episodes
        const toRemove = episodes.slice(0, -maxEp)
        result = result.filter(m => !toRemove.includes(m))
        actions.push(`Episode 从 ${episodes.length} 个缩减至 ${maxEp} 个`)
        break
      }
    }
  }

  // Strategy 3: If still over, trigger compression of oldest episodes
  const finalBudget = checkBudget(result, systemPrompt)
  if (!finalBudget.withinBudget && apiKey && episodes.length >= 3 && typeof createEpisodeSummary === 'function') {
    const oldestEpisodes = episodes.slice(0, -2)
    try {
      const merged = await createEpisodeSummary(
        oldestEpisodes.map(e => ({ role: 'assistant', content: e.content })),
        apiKey,
        episodes.slice(-2),
        oldestEpisodes[0]?.episodeMetadata?.turnStart || 0,
        oldestEpisodes[oldestEpisodes.length - 1]?.episodeMetadata?.turnEnd || 0,
      )
      if (merged.summary) {
        result = result.filter(m => !oldestEpisodes.includes(m))
        result.push({
          role: 'system',
          content: merged.summary,
          timestamp: Date.now(),
          isMemory: true,
          isEpisode: true,
          episodeMetadata: merged.metadata,
        })
        actions.push('合并最旧的 ' + oldestEpisodes.length + ' 个 episode')
      }
    } catch (e) {
      actions.push('Episode 合并失败: ' + e.message)
    }
  }

  return { messages: result, actions }
}

/**
 * Estimate total input tokens for a given message set.
 */
export function estimateTotalTokens(messages, systemPrompt) {
  const budget = checkBudget(messages, systemPrompt)
  return budget.breakdown.total
}
