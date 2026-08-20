/**
 * Event Memory — structured event log as LLM context.
 *
 * Replaces flat chat history with compact event records.
 * Each event captures a meaningful world change, not raw conversation text.
 * ~80%+ more compact than verbatim message history.
 */

/**
 * Format recent events for Narrator prompt injection.
 * Most recent first, limited to maxEvents.
 */
export function formatEventLogForPrompt(events, maxEvents = 10) {
  if (!events || events.length === 0) return ''

  const recent = events.slice(-maxEvents)

  return '【最近事件】\n' + recent.map((e, i) => {
    const idx = events.length - recent.length + i + 1
    return `${idx}. ${formatEvent(e)}`
  }).join('\n')
}

/**
 * Compress event log: keep recent N events verbatim, summarize older ones.
 */
export function compressEventLog(events, keepRecent = 10) {
  if (!events || events.length <= keepRecent) {
    return {
      compressedSummary: '',
      recentEvents: events || [],
    }
  }

  const older = events.slice(0, -keepRecent)
  const recent = events.slice(-keepRecent)

  // Generate compressed summary from older events
  const summary = summarizeEvents(older)

  return { compressedSummary: summary, recentEvents: recent }
}

/**
 * Format full event memory for prompt: summary + recent events.
 */
export function formatEventMemoryForPrompt(compressedSummary, recentEvents, maxEvents = 10) {
  const parts = []

  if (compressedSummary) {
    parts.push('【历史摘要】\n' + compressedSummary)
  }

  if (recentEvents && recentEvents.length > 0) {
    parts.push(formatEventLogForPrompt(recentEvents, maxEvents))
  }

  return parts.join('\n\n')
}

// ─── Internal Formatters ─────────────────────────────────

function formatEvent(event) {
  switch (event.type) {
    case 'RELATIONSHIP_CHANGE': {
      const d = event.data || {}
      const arrow = d.delta > 0 ? '↑' : d.delta < 0 ? '↓' : '→'
      return `${arrow} ${d.source || '?'} 好感 ${d.delta > 0 ? '+' : ''}${d.delta || 0} (${d.trigger || ''})`
    }
    case 'NPC_ACTION': {
      const d = event.data || {}
      return `🎭 ${d.agent || '?'}: ${d.intent || '?'} — ${d.action || ''}`
    }
    case 'USER_ACTION': {
      const d = event.data || {}
      return `👤 玩家: ${(d.content || '').slice(0, 100)}`
    }
    case 'SCENE_TRANSITION': {
      const d = event.data || {}
      return `📍 场景: ${d.from || '?'} → ${d.to || '?'}`
    }
    case 'CONFLICT_EVENT': {
      const d = event.data || {}
      const participants = (d.participants || []).join(' vs ')
      return `⚡ 冲突: ${participants} (${d.intensity || '?'}/10)`
    }
    case 'TIME_ADVANCE': {
      const d = event.data || {}
      return `🕐 ${d.from || '?'} → ${d.to || '?'}`
    }
    case 'MEMORY_SNAPSHOT': {
      return '📋 ' + ((event.data?.summary || '').slice(0, 120))
    }
    default: {
      return `${event.type}: ${JSON.stringify(event.data || {}).slice(0, 80)}`
    }
  }
}

function summarizeEvents(events) {
  const chars = []
  const scenes = new Set()
  let totalAffectionDelta = 0
  let npcActionCount = 0
  let conflictCount = 0

  for (const e of events) {
    switch (e.type) {
      case 'RELATIONSHIP_CHANGE':
        totalAffectionDelta += e.data?.delta || 0
        chars.push(e.data?.source)
        break
      case 'NPC_ACTION':
        npcActionCount++
        break
      case 'CONFLICT_EVENT':
        conflictCount++
        break
      case 'SCENE_TRANSITION':
        if (e.data?.to) scenes.add(e.data.to)
        break
    }
  }

  const lines = []
  if (chars.length > 0) {
    const uniqueChars = [...new Set(chars.filter(Boolean))]
    lines.push(`涉及角色：${uniqueChars.join('、')}`)
  }
  if (totalAffectionDelta !== 0) {
    lines.push(`好感度总变化：${totalAffectionDelta > 0 ? '+' : ''}${totalAffectionDelta}`)
  }
  if (npcActionCount > 0) {
    lines.push(`NPC主动行动：${npcActionCount}次`)
  }
  if (conflictCount > 0) {
    lines.push(`冲突事件：${conflictCount}次`)
  }
  if (scenes.size > 0) {
    lines.push(`场景变更：${[...scenes].join(' → ')}`)
  }

  lines.push(`(共 ${events.length} 个事件被压缩)`)
  return lines.join(' | ')
}
