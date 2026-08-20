/**
 * Episode Memory — compressed N-round summaries.
 *
 * Thin wrapper around the existing compressChatHistory function.
 * Adds episode metadata (turn range, index) for structured memory access.
 * Each episode is stored as a system message with isEpisode: true flag.
 */

import { compressChatHistory } from '../utils/deepseek'

/**
 * Create an episode summary from a range of messages.
 * @returns {{ summary: string|null, error: Error|null }}
 */
export async function createEpisodeSummary(messages, apiKey, existingEpisodes, turnStart, turnEnd) {
  // Collect existing episode text for context continuity
  const existingText = existingEpisodes
    .map(ep => ep.content)
    .join('\n\n---\n\n')

  const { summary, structured, error } = await compressChatHistory(messages, apiKey, null, existingText)

  if (error || !summary) {
    return { summary: null, structured: null, error }
  }

  // Store structured data alongside summary for downstream consumers
  // (eventMemory, semanticMemory, coordinator can use structured directly)
  return {
    summary,
    structured,  // v3 structured compression: { events, relationships, skeleton, last_scene, last_reply_verbatim }
    metadata: {
      turnStart,
      turnEnd,
      createdAt: Date.now(),
      eventCount: structured?.events?.length || 0,
      relationshipCount: structured?.relationships ? Object.keys(structured.relationships).length : 0,
    },
    error: null,
  }
}

/**
 * Get all episode messages from the messages array.
 * @returns {Array} messages with isEpisode flag
 */
export function getAllEpisodes(messages) {
  return messages.filter(m =>
    m.role === 'system' &&
    (m.isEpisode || (m.isMemory && m.episodeMetadata))
  )
}

/**
 * Format episodes for prompt injection.
 * Most recent episodes first, limited to maxEpisodes.
 * Output is pure narrative — no JSON, no schema, no debug markers.
 * @returns {string} formatted episode text
 */
export function formatEpisodesForPrompt(episodes, maxEpisodes = 12) {
  if (!episodes || episodes.length === 0) return ''

  const recent = episodes.slice(-maxEpisodes)

  // Group: episodes with structured data get compact narrative formatting
  const parts = recent.map((ep, i) => {
    const meta = ep.episodeMetadata || {}
    const label = meta.turnStart != null
      ? `第${meta.turnStart}-${meta.turnEnd}轮`
      : `片段 ${i + 1}`

    // If structured data is available, use clean narrative format
    if (ep.structured) {
      return '【' + label + '】\n' + formatStructuredEpisode(ep.structured, i + 1, '')
    }

    // Fallback: raw content (already a formatted summary string)
    return '【' + label + '】\n' + ep.content
  })

  return '【已压缩的历史剧情】\n' + parts.join('\n\n')
}

/**
 * Format a single episode from structured data (compact, narrative-only).
 *
 * THREE-LAYER OUTPUT (no JSON, no schema, no debug fields):
 *   [STATE]  — relationship tension + dominance levels
 *   [EVENTS] — clean event descriptions
 *   [NARRATIVE] — pure text summary of the scene
 *
 * CRITICAL: This output is injected directly into the LLM context.
 * It must NOT contain: JSON, field names, code structures, debug markers.
 */
function formatStructuredEpisode(s, index, range) {
  const lines = []

  // ── Layer 1: STATE ──
  const stateLines = []
  if (s.skeleton?.current_state) {
    stateLines.push(s.skeleton.current_state)
  }
  if (s.relationships) {
    const relParts = Object.entries(s.relationships).map(([name, r]) => {
      const parts = []
      if (r.stage_hint) parts.push(r.stage_hint)
      if (r.dominance != null) parts.push('主导' + Math.round(r.dominance * 100) + '%')
      return name + '：' + parts.join('，')
    })
    if (relParts.length) stateLines.push(relParts.join(' | '))
  }
  if (stateLines.length) {
    lines.push('【状态】' + stateLines.join('。'))
  }

  // ── Layer 2: EVENTS ──
  if (s.events?.length) {
    const eventDescs = s.events.slice(-5).map(e => {
      const actor = e.actor || '某人'
      const target = e.target === 'user' ? '玩家' : (e.target || '对方')
      const summary = e.summary || ''
      const mood = e.emotion || ''
      // Clean narrative: "林晚对玩家发怒——「你骗我」"
      let desc = actor + '对' + target
      if (mood) desc += mood === 'anger' ? '发怒' : mood === 'hurt' ? '受伤' : mood === 'cold' ? '冷漠' : mood === 'jealousy' ? '吃醋' : mood === 'fear' ? '恐惧' : mood === 'longing' ? '想念' : mood === 'warmth' ? '示好' : mood === 'despair' ? '绝望' : mood === 'hope' ? '期待' : mood === 'guilt' ? '内疚' : ''
      if (summary) desc += '——' + summary
      return desc
    })
    lines.push('【事件】' + eventDescs.join('。'))
  }

  if (s.skeleton?.key_events?.length) {
    lines.push('【关键】' + s.skeleton.key_events.join(' | '))
  }

  // ── Layer 3: NARRATIVE ──
  if (s.last_scene?.location) {
    const scene = s.last_scene
    const present = (scene.present || []).filter(p => p !== 'user').join('、')
    const parts = ['地点：' + scene.location]
    if (present) parts.push('在场：' + present)
    if (scene.mood) parts.push('氛围：' + scene.mood)
    lines.push('【场景】' + parts.join(' | '))
  }

  if (s.last_reply_verbatim) {
    // Keep last reply for continuity, but sanitized
    const clean = s.last_reply_verbatim
      .replace(/```[\s\S]*?```/g, '') // remove code blocks
      .replace(/\{[\s\S]*?\}/g, '')    // remove JSON objects
      .trim()
      .slice(0, 300)
    if (clean) {
      lines.push('【最后一幕】' + clean)
    }
  }

  // ── Conflict tracking (compact) ──
  if (s.skeleton?.active_conflicts?.length) {
    lines.push('【未解决】' + s.skeleton.active_conflicts.join(' | '))
  }

  return lines.join('\n')
}

/**
 * Count total episodes.
 */
export function countEpisodes(messages) {
  return getAllEpisodes(messages).length
}

/**
 * Create an episode message object for storage in the messages array.
 * Stores both the human-readable summary AND the structured compression data.
 */
export function createEpisodeMessage(summary, structured, metadata) {
  return {
    role: 'system',
    content: summary,
    structured,  // v3 structured data: { events, relationships, skeleton, last_scene, last_reply_verbatim }
    timestamp: metadata.createdAt || Date.now(),
    isMemory: true,
    isEpisode: true,
    episodeMetadata: {
      turnStart: metadata.turnStart,
      turnEnd: metadata.turnEnd,
      index: metadata.index || 0,
      eventCount: metadata.eventCount || 0,
      relationshipCount: metadata.relationshipCount || 0,
    },
  }
}
