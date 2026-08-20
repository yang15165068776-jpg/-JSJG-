/**
 * Causal Narrative Engine v1 — 因果叙事引擎
 *
 * 核心问题：数值变化（affection +3, tension -2）没有"为什么"。
 * 本引擎把数值变化翻译成剧情因果故事。
 *
 * Architecture:
 *   USK Diff Detector → Causal Graph Builder → Narrative Synthesizer
 *
 * 设计原则：
 *   - 同一个数值变化，不同模式下生成不同的叙事解释
 *   - 剧情模式：冲突/权力/博弈叙事
 *   - 日常模式：情绪/关系/感觉叙事
 */

// ═══════════════════════════════════════════════════════════
// 1. Change Detection — diff two USK snapshots
// ═══════════════════════════════════════════════════════════

function detectChange(prevUSK, nextUSK) {
  const prev = prevUSK || {}
  const next = nextUSK || {}

  const prevAff = prev.affection ?? 50
  const nextAff = next.affection ?? 50
  const prevTension = prev.tension ?? 30
  const nextTension = next.tension ?? 30
  const prevDependency = prev.dependency ?? 30
  const nextDependency = next.dependency ?? 30
  const prevAnger = prev.anger ?? 5
  const nextAnger = next.anger ?? 5
  const prevJealousy = prev.jealousy ?? 5
  const nextJealousy = next.jealousy ?? 5
  const prevTrust = prev.trust ?? 30
  const nextTrust = next.trust ?? 30

  return {
    affection: { from: prevAff, to: nextAff, delta: nextAff - prevAff },
    tension: { from: prevTension, to: nextTension, delta: nextTension - prevTension },
    dependency: { from: prevDependency, to: nextDependency, delta: nextDependency - prevDependency },
    anger: { from: prevAnger, to: nextAnger, delta: nextAnger - prevAnger },
    jealousy: { from: prevJealousy, to: nextJealousy, delta: nextJealousy - prevJealousy },
    trust: { from: prevTrust, to: nextTrust, delta: nextTrust - prevTrust },
  }
}

// ═══════════════════════════════════════════════════════════
// 2. Cause Builder — map deltas to cause nodes
// ═══════════════════════════════════════════════════════════

function buildCauses(diff, mode, context) {
  const causes = []
  const { affection, tension, dependency, anger, jealousy, trust } = diff

  // Affection causes
  if (affection.delta >= 3) {
    causes.push({ type: 'strong_positive', magnitude: 'high', axis: 'affection', delta: affection.delta,
      raw: '显著情感升温', dramaMeaning: '关系结构正在松动——权力可能转移', dailyMeaning: '他好像比平时更依赖你了' })
  } else if (affection.delta >= 1) {
    causes.push({ type: 'mild_positive', magnitude: 'low', axis: 'affection', delta: affection.delta,
      raw: '轻微好感上升', dramaMeaning: '表面缓和，但底层张力未消', dailyMeaning: '今天比平时更亲近了一点' })
  } else if (affection.delta <= -3) {
    causes.push({ type: 'strong_negative', magnitude: 'high', axis: 'affection', delta: affection.delta,
      raw: '显著情感降温', dramaMeaning: '关系裂缝扩大——信任正在流失', dailyMeaning: '他好像突然变得冷淡疏远了' })
  } else if (affection.delta <= -1) {
    causes.push({ type: 'mild_negative', magnitude: 'low', axis: 'affection', delta: affection.delta,
      raw: '轻微好感下降', dramaMeaning: '细微的失望正在累积', dailyMeaning: '感觉好像有一点点疏远' })
  }

  // Tension causes
  if (tension.delta >= 10) {
    causes.push({ type: 'conflict_spike', magnitude: 'high', axis: 'tension', delta: tension.delta,
      raw: '冲突显著升级', dramaMeaning: '对抗进入新阶段——不可回头', dailyMeaning: '你们之间突然变得很紧张' })
  } else if (tension.delta >= 5) {
    causes.push({ type: 'conflict_rise', magnitude: 'medium', axis: 'tension', delta: tension.delta,
      raw: '张力上升', dramaMeaning: '关系裂缝出现，对方开始质疑', dailyMeaning: '他今天好像有点不太开心' })
  } else if (tension.delta <= -5) {
    causes.push({ type: 'conflict_ease', magnitude: 'medium', axis: 'tension', delta: tension.delta,
      raw: '张力下降', dramaMeaning: '冲突暂时缓和，但矛盾未解决', dailyMeaning: '感觉关系好像缓和了一点' })
  }

  // Anger causes
  if (anger.delta >= 5) {
    causes.push({ type: 'anger_rise', magnitude: 'medium', axis: 'anger', delta: anger.delta,
      raw: '愤怒上升', dramaMeaning: '压抑的怒火正在寻找出口', dailyMeaning: '他今天情绪好像特别烦躁' })
  }

  // Jealousy causes
  if (jealousy.delta >= 5) {
    causes.push({ type: 'jealousy_rise', magnitude: 'medium', axis: 'jealousy', delta: jealousy.delta,
      raw: '嫉妒上升', dramaMeaning: '占有欲被激活——控制即将升级', dailyMeaning: '他好像很在意你跟别人互动' })
  }

  // Trust causes
  if (trust.delta >= 5) {
    causes.push({ type: 'trust_gain', magnitude: 'medium', axis: 'trust', delta: trust.delta,
      raw: '信任上升', dramaMeaning: '权力的天平出现微小倾斜', dailyMeaning: '他似乎更愿意相信你了' })
  }
  if (trust.delta <= -5) {
    causes.push({ type: 'trust_loss', magnitude: 'medium', axis: 'trust', delta: trust.delta,
      raw: '信任下降', dramaMeaning: '又一次证明"不可信"——裂痕加深', dailyMeaning: '他好像对你失去了部分信任' })
  }

  // Dependency causes
  if (dependency.delta >= 3) {
    causes.push({ type: 'dependency_rise', magnitude: 'medium', axis: 'dependency', delta: dependency.delta,
      raw: '依赖上升', dramaMeaning: '角色的弱点暴露——对方获得了更多筹码', dailyMeaning: '他好像比平时更需要你了' })
  }

  return causes
}

// ═══════════════════════════════════════════════════════════
// 3. Narrative Synthesizer — mode-specific story generation
// ═══════════════════════════════════════════════════════════

function generateNarrative(causes, mode, characterName) {
  if (!causes || causes.length === 0) {
    return mode === 'drama'
      ? '这一轮没有发生显著的关系变化。局势暂时维持原状，但平静往往是暴风雨的前兆。'
      : '这一轮没什么特别的变化，感觉和平时一样。'
  }

  const name = characterName || '角色'

  if (mode === 'drama') {
    return dramaNarrative(causes, name)
  }

  if (mode === 'daily') {
    return dailyNarrative(causes, name)
  }

  return causes.map(c => c.raw).join('；')
}

function dramaNarrative(causes, name) {
  const lines = causes.map(c => c.dramaMeaning)

  // Add a coherence summary based on dominant axis
  const hasConflict = causes.some(c => c.axis === 'tension' && c.delta > 0)
  const hasAffectionUp = causes.some(c => c.axis === 'affection' && c.delta > 0)
  const hasAffectionDown = causes.some(c => c.axis === 'affection' && c.delta < 0)
  const hasJealousy = causes.some(c => c.axis === 'jealousy')

  if (hasConflict && hasAffectionDown) {
    lines.push('关系进入下行螺旋——冲突正在侵蚀情感基础。')
  } else if (hasJealousy && hasAffectionUp) {
    lines.push('占有与升温并存——这是控制型依恋的典型模式。')
  } else if (hasConflict && hasAffectionUp) {
    lines.push('冲突与情感并存——' + name + '在对抗中确认关系，这正是权力的游戏。')
  } else if (!hasConflict && hasAffectionUp) {
    lines.push('关系在无声中拉近——但' + name + '的本性不允许它平静太久。')
  }

  return lines.join(' ')
}

function dailyNarrative(causes, name) {
  const lines = causes.map(c => c.dailyMeaning)

  const hasConflict = causes.some(c => c.axis === 'tension' && c.delta > 0)
  const hasAffectionUp = causes.some(c => c.axis === 'affection' && c.delta > 0)
  const hasAffectionDown = causes.some(c => c.axis === 'affection' && c.delta < 0)

  if (hasConflict && hasAffectionUp) {
    lines.push('虽然有点小摩擦，但总体感觉好像更亲近了。')
  } else if (hasConflict && hasAffectionDown) {
    lines.push('今天的气氛好像不太对，感觉有点疏远了。')
  } else if (hasAffectionUp) {
    lines.push('感觉今天比平时更亲近了一点。')
  }

  return lines.join('。')
}

// ═══════════════════════════════════════════════════════════
// 4. Causal Engine — main API
// ═══════════════════════════════════════════════════════════

export const CausalEngine = {

  /**
   * Analyze a turn: diff USK changes → build causes → generate narrative.
   *
   * @param {object} prevUSK — USK snapshot before the turn
   * @param {object} nextUSK — USK snapshot after the turn
   * @param {'drama'|'daily'} mode
   * @param {object} context — { characterName, userText }
   * @returns {object} { diff, causes, narrative, mode }
   */
  analyze(prevUSK, nextUSK, mode, context = {}) {
    const diff = detectChange(prevUSK, nextUSK)
    const causes = buildCauses(diff, mode, context)
    const narrative = generateNarrative(causes, mode, context.characterName || '')

    return {
      diff,
      causes,
      narrative,
      mode,
      hasChanges: causes.length > 0,
      summary: summarizeChanges(diff),
    }
  },

  /**
   * Quick check: did anything meaningful change?
   */
  hasSignificantChange(diff) {
    if (!diff) return false
    return Object.values(diff).some(d => Math.abs(d.delta) >= 3)
  },
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function summarizeChanges(diff) {
  const parts = []
  for (const [key, d] of Object.entries(diff)) {
    if (d.delta !== 0) {
      parts.push(key + (d.delta > 0 ? '+' : '') + d.delta)
    }
  }
  return parts.length > 0 ? parts.join(', ') : '无变化'
}
