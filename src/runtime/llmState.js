/**
 * LLM Runtime State — centralized domain state for the story/chat session.
 *
 * All domain state lives here, not scattered in UI components or derived from
 * raw character JSON. This module provides pure read/update functions.
 *
 * State shape:
 *   scene: { time?, location?, activeEventFlags[] }
 *   characters: { [name]: { affection, stageName, stageIndex, flags[], present } }
 *   round: { index, affectionJudgeCounter, lastUserInput, lastAiReply }
 *   memory: { workingMessageCount, episodeCount, totalEstimatedTokens }
 */

import { getCurrentAffectionStage, estimateTokens } from '../utils/deepseek'

/**
 * Build initial runtime state from character data and existing session state.
 */
export function createRuntimeState(character, affections, messages) {
  const now = Date.now()
  const state = {
    storyId: character?.id || '',
    mode: character?.chatStyle || 'daily',

    scene: {
      time: null,
      location: '',
      activeEventFlags: [],
    },

    characters: {},
    round: {
      index: messages ? messages.filter(m => m.role === 'user').length : 0,
      affectionJudgeCounter: 0,
      lastUserInput: '',
      lastAiReply: '',
    },
    memory: {
      workingMessageCount: 0,
      episodeCount: 0,
      totalEstimatedTokens: 0,
    },

    _createdAt: now,
    _updatedAt: now,
  }

  // Populate character states from affections data
  if (character?.chatStyle === 'story' && character?.romanceCharacters) {
    for (const rc of character.romanceCharacters) {
      if (!rc.affectionEnabled) continue
      const affValue = affections?.[rc.name] ?? rc.affectionInitial ?? 50
      const stage = getCurrentAffectionStage(rc, affValue)
      state.characters[rc.name] = {
        affection: affValue,
        stageName: stage?.name || stage?.label || '',
        stageIndex: rc.affectionStages
          ? rc.affectionStages.findIndex(s => affValue >= (s.min ?? 0) && affValue <= (s.max ?? 100))
          : -1,
        flags: [],
        present: true,
        lastMentionedTurn: 0,
      }
    }
  }

  return state
}

/**
 * Immutable-style state update (shallow merge at top level).
 */
export function updateRuntimeState(state, patch) {
  return {
    ...state,
    ...patch,
    _updatedAt: Date.now(),
  }
}

/**
 * Update a single character's state within the runtime state.
 */
export function updateCharacterState(state, charName, charPatch) {
  return {
    ...state,
    characters: {
      ...state.characters,
      [charName]: {
        ...state.characters[charName],
        ...charPatch,
      },
    },
    _updatedAt: Date.now(),
  }
}

/**
 * Produce a compact JSON snapshot for prompt injection.
 * Only includes data that changed or is relevant to the current turn.
 */
export function snapshotForPrompt(state) {
  const chars = Object.entries(state.characters).map(([name, c]) => ({
    name,
    aff: c.affection,
    stage: c.stageName,
    present: c.present,
    flags: c.flags.length > 0 ? c.flags : undefined,
  }))

  return JSON.stringify({
    mode: state.mode,
    scene: state.scene.time ? state.scene : undefined,
    chars,
    round: state.round.index,
    mem: {
      episodes: state.memory.episodeCount,
      estTokens: state.memory.totalEstimatedTokens,
    },
  })
}

/**
 * Produce the "what changed" diff between two state snapshots.
 */
export function diffForPrompt(state, prevState, userInput) {
  const changes = []

  // Scene changes
  if (prevState && state.scene.location !== prevState.scene.location) {
    changes.push('场景变更：' + (state.scene.location || '未指定'))
  }

  // Affection changes
  if (prevState) {
    for (const [name, c] of Object.entries(state.characters)) {
      const prev = prevState.characters[name]
      if (prev && c.affection !== prev.affection) {
        const delta = c.affection - prev.affection
        changes.push(name + ' 好感度 ' + (delta > 0 ? '+' : '') + delta + ' → ' + c.affection)
      }
      if (prev && c.stageName !== prev.stageName) {
        changes.push(name + ' 阶段变更：' + prev.stageName + ' → ' + c.stageName)
      }
    }
  }

  return {
    userInput: userInput || '',
    changes: changes.length > 0 ? changes : ['本轮无显著状态变化'],
  }
}

/**
 * Estimate total tokens for the current state + messages.
 */
export function estimateStateTokens(state, systemPromptChars) {
  const systemTokens = estimateTokens(systemPromptChars || '')
  const stateTokens = estimateTokens(snapshotForPrompt(state))
  return {
    system: systemTokens,
    state: stateTokens,
    total: systemTokens + stateTokens + state.memory.totalEstimatedTokens,
  }
}
