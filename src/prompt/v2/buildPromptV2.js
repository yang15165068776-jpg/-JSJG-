/**
 * Prompt Builder V2 — Phase A: Safe Wrapper
 *
 * Internally calls the existing buildGMPrompt / buildDailySystemPrompt,
 * producing IDENTICAL output to v1. Adds the runtime state + memory
 * layering on the infrastructure side without changing prompt content.
 *
 * Phase B (deferred): compact character identity blocks into structured format.
 */

import { buildGMPrompt, buildDailySystemPrompt, getCurrentAffectionStage } from '../../utils/deepseek'
import { CORE_SYSTEM_PREFIX, assembleSystemPrompt } from '../cachePrefix'
import { createRuntimeState, updateRuntimeState, snapshotForPrompt } from '../../runtime/llmState'
import { getWorkingMemory, formatWorkingMemoryForPrompt } from '../../memory/workingMemory'
import { getAllEpisodes, formatEpisodesForPrompt } from '../../memory/episodeSummarizer'
import { extractSemanticFacts, formatSemanticFactsForPrompt } from '../../memory/semanticMemory'

/**
 * Build the v2 system prompt.
 *
 * Phase A: Produces identical output to v1 buildGMPrompt/buildDailySystemPrompt.
 * Phase B (USE_COMPACT_FORMAT=true): Character identity blocks use structured format.
 *
 * @param {object} character - full character object
 * @param {object} affections - affection values map { name: value }
 * @param {Array} messages - conversation messages array
 * @param {string} userInput - current user input
 * @returns {{ systemPrompt: string, runtimeState: object, memoryReport: object }}
 */
export function buildPromptV2(character, affections, messages, userInput) {
  const USE_COMPACT_FORMAT = false // Phase B flag — keep false for identical output

  // 1. Build the variable suffix using existing prompt builders (Phase A: identical output)
  let variableSuffix

  if (character.chatStyle === 'story') {
    if (USE_COMPACT_FORMAT) {
      // Phase B: structured format (deferred)
      variableSuffix = buildCompactStoryPrompt(character, affections, messages)
    } else {
      // Phase A: identical to v1
      variableSuffix = buildGMPrompt(character, affections)
    }
  } else {
    // Daily mode: unchanged
    variableSuffix = buildDailySystemPrompt(character)
  }

  // 2. Assemble full system prompt with cache-friendly prefix
  const systemPrompt = assembleSystemPrompt(CORE_SYSTEM_PREFIX, variableSuffix)

  // 3. Build runtime state snapshot (infrastructure — not yet injected into prompt)
  const runtimeState = createRuntimeState(character, affections, messages)

  // 4. Build memory report for logging/monitoring
  const workingMemory = getWorkingMemory(messages, 8)
  const episodes = getAllEpisodes(messages)
  const memoryReport = {
    workingTurns: Math.ceil(workingMemory.length / 2),
    episodeCount: episodes.length,
    totalMessages: messages.length,
    cachePrefixTokens: Math.ceil(CORE_SYSTEM_PREFIX.length / 2.5),
    fullPromptTokens: Math.ceil(systemPrompt.length / 2.5),
    phase: USE_COMPACT_FORMAT ? 'B' : 'A',
  }

  return { systemPrompt, runtimeState, memoryReport }
}

/**
 * Phase B: Compact character identity format (deferred — not yet active).
 * Reformats the prose character blocks into pipe-delimited structured lines.
 * Content is identical, just denser.
 */
function buildCompactStoryPrompt(character, affections, messages) {
  // For Phase B, this would produce a compact version of buildGMPrompt output.
  // For now, falls back to existing buildGMPrompt.
  // Deferred implementation — identical to Phase A until USE_COMPACT_FORMAT=true.
  return buildGMPrompt(character, affections)
}

/**
 * Lightweight version: build prompt with explicit memory injection.
 * Used when the caller wants to control memory formatting separately.
 */
export function buildPromptV2WithMemory(character, affections, messages, userInput) {
  const { systemPrompt, runtimeState, memoryReport } = buildPromptV2(character, affections, messages, userInput)

  // Extract and format memory layers
  const workingText = formatWorkingMemoryForPrompt(messages, 8)
  const episodes = getAllEpisodes(messages)
  const episodeText = formatEpisodesForPrompt(episodes, 12)
  const facts = extractSemanticFacts(messages, character)
  const semanticText = formatSemanticFactsForPrompt(facts)

  // Append memory to system prompt (this is what sendStoryStageMessage already does)
  const memoryBlock = [semanticText, episodeText].filter(Boolean).join('\n\n')
  let finalPrompt = systemPrompt
  if (memoryBlock) {
    finalPrompt = systemPrompt + '\n\n【记忆上下文】\n' + memoryBlock
  }

  return {
    systemPrompt: finalPrompt,
    runtimeState,
    memoryReport: {
      ...memoryReport,
      workingChars: workingText.length,
      episodeChars: episodeText.length,
      semanticFacts: facts.flags.length + facts.relationships.length,
    },
  }
}
