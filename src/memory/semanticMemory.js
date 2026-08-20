/**
 * Semantic Memory — long-term facts extracted deterministically from
 * existing compression summaries. Zero API calls.
 *
 * Scans system memory messages for named entities, relationship descriptors,
 * and irreversible story flags. Outputs structured data for prompt injection.
 */

// Relationship-indicating keywords
const RELATION_KEYWORDS = [
  '好感度', '关系', '信任', '依赖', '疏远', '靠近',
  '喜欢', '讨厌', '恨', '爱', '在意', '不在乎',
  '亲密', '冷漠', '敌对', '和解', '冷战', '冲突',
]

const FLAG_KEYWORDS = [
  '第一次', '已经', '不再', '从未', '终于',
  '发现了', '知道', '得知', '揭露', '坦白',
  '决裂', '分手', '求婚', '结婚', '背叛',
]

/**
 * Deterministically extract structured facts from memory/compression messages.
 * @returns {{ relationships: string[], flags: string[], keyFacts: string[] }}
 */
export function extractSemanticFacts(messages, character) {
  const relationships = []
  const flags = []
  const keyFacts = []

  // Scan system memory messages for fact-bearing content
  const memoryMessages = messages.filter(m =>
    m.role === 'system' && (m.isMemory || m.isEpisode)
  )

  for (const msg of memoryMessages) {
    const content = msg.content || ''

    // Extract relationship statements
    for (const kw of RELATION_KEYWORDS) {
      // Find sentences containing the keyword near a character name
      const charNames = character?.romanceCharacters?.map(rc => rc.name) || []
      for (const name of charNames) {
        const pattern = new RegExp(
          `[^。\\n]{0,30}${escapeRegExp(name)}[^。\\n]{0,30}${escapeRegExp(kw)}[^。\\n]{0,30}[。\\n]`,
          'g'
        )
        const matches = content.match(pattern)
        if (matches) {
          for (const m of matches) {
            const trimmed = m.trim().replace(/^[，,、]/, '')
            if (!relationships.includes(trimmed) && relationships.length < 20) {
              relationships.push(trimmed)
            }
          }
        }
      }
    }

    // Extract irreversible flags
    for (const kw of FLAG_KEYWORDS) {
      const pattern = new RegExp(
        `[^。\\n]{0,40}${escapeRegExp(kw)}[^。\\n]{0,40}[。\\n]`,
        'g'
      )
      const matches = content.match(pattern)
      if (matches) {
        for (const m of matches) {
          const trimmed = m.trim().replace(/^[，,、]/, '')
          if (!flags.includes(trimmed) && flags.length < 15) {
            flags.push(trimmed)
          }
        }
      }
    }
  }

  return { relationships, flags, keyFacts }
}

/**
 * Format semantic facts for prompt injection.
 * Compact format: one line per fact.
 */
export function formatSemanticFactsForPrompt(facts) {
  const lines = []

  if (facts.flags.length > 0) {
    lines.push('【不可逆事件】')
    facts.flags.forEach(f => lines.push('- ' + f))
  }

  if (facts.relationships.length > 0) {
    lines.push('【关系动态】')
    facts.relationships.slice(0, 10).forEach(r => lines.push('- ' + r))
  }

  return lines.length > 0 ? lines.join('\n') : ''
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
