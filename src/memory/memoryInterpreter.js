/**
 * Memory Interpretation Layer v1 — 记忆解释层
 *
 * 核心问题：同一件事，在剧情模式和日常模式里应该有不同的情绪意义。
 *
 * 架构：
 *   Global Memory (事实层) → Event Parser → Interpretation Layer
 *       ├── Drama Interpretation View  (冲突强化)
 *       └── Daily Interpretation View  (情绪强化)
 *
 * 设计原则：
 *   - 事实是纯客观的 (fact)
 *   - 解释是模式相关的 (meaning)
 *   - Agent 只读当前模式的解释
 */

// ═══════════════════════════════════════════════════════════
// 1. Event Parser — 把消息变成标准化事件
// ═══════════════════════════════════════════════════════════

export function parseEvent(message, role) {
  if (!message || !message.content) return null

  const content = typeof message === 'string' ? message : message.content
  const msgRole = role || message.role || 'user'
  const actors = [msgRole]

  return {
    id: message.id || ('evt-' + Date.now()),
    type: detectType(content, msgRole),
    actors,
    content,
    // Pure fact — no emotion
    fact: normalizeFact(content, msgRole),
    timestamp: message.timestamp || Date.now(),
  }
}

/**
 * Detect event type from message content.
 */
function detectType(content, role) {
  const text = (content || '').toLowerCase()

  // Conflict types
  if (/为什么|你到底|你从来|你总是|凭什么|你怎么又/.test(text)) {
    return 'conflict_question'
  }
  if (/不[再要会]|离开|走了|分手|结束/.test(text)) {
    return 'departure_threat'
  }
  if (/算了|没什么|随便|无所谓|不用/.test(text) && text.length < 15) {
    return 'dismissal'
  }

  // Approach types
  if (/想[你了念]/i.test(text) || /想[你我]/i.test(text)) {
    return 'approach_longing'
  }
  if (/爱你|喜欢|在乎|在意|不能没有/.test(text)) {
    return 'confession'
  }
  if (/过来|靠近|陪我|一起|牵手|拥抱|接吻/.test(text)) {
    return 'approach_physical'
  }

  // Emotional types
  if (/生气|愤怒|讨厌|恨|烦/.test(text)) {
    return 'anger_expression'
  }
  if (/难过|伤心|哭|心疼|委屈/.test(text)) {
    return 'hurt_expression'
  }
  if (/担心|害怕|不安|紧张/.test(text)) {
    return 'anxiety_expression'
  }

  // Action types
  if (role === 'assistant' && text.length > 100) {
    return 'narration'
  }
  if (role === 'assistant' && /【.+】/.test(text)) {
    return 'multi_character_scene'
  }

  // Silent treatment / ignore
  if (text.trim().length < 5 && role === 'user') {
    return 'minimal_input'
  }

  return 'neutral_interaction'
}

/**
 * Normalize a message into a neutral fact description.
 */
function normalizeFact(content, role) {
  const text = (content || '').trim()
  const actor = role === 'user' || role === 'player' ? '玩家' : '角色'

  if (text.length <= 20) return actor + '说：' + text
  return actor + '说了一段话（' + text.length + '字）'
}

// ═══════════════════════════════════════════════════════════
// 2. Memory Interpreter — 双视角解释引擎
// ═══════════════════════════════════════════════════════════

export const MemoryInterpreter = {

  /**
   * Main entry. Interpret an event through a mode-specific lens.
   *
   * @param {object} event — from parseEvent()
   * @param {'drama'|'daily'} mode
   * @param {object} context — { uskState, turnCount, character }
   * @returns {object} { meaning, weight, tension_delta, affection_delta, mode }
   */
  interpret(event, mode, context = {}) {
    if (!event) return null

    if (mode === 'drama') {
      return this.dramaView(event, context)
    }

    if (mode === 'daily') {
      return this.dailyView(event, context)
    }

    return { meaning: event.fact, weight: 0.3, tension_delta: 0, affection_delta: 0, mode }
  },

  // ═══════════════════════════════════════════════════════
  // Drama View — conflict amplification
  // ═══════════════════════════════════════════════════════

  dramaView(event, context) {
    const type = event.type
    const usk = context.uskState || {}
    const tension = usk?.tension?.unresolved_conflicts || 30

    switch (type) {
      case 'conflict_question':
        return {
          meaning: '质疑关系 / 冲突升级信号',
          weight: 0.8,
          tension_delta: Math.round(8 + tension * 0.1),
          affection_delta: 0,
          mode: 'drama',
        }

      case 'departure_threat':
        return {
          meaning: '离开威胁 / 关系破裂边缘',
          weight: 0.9,
          tension_delta: Math.round(12 + tension * 0.15),
          affection_delta: 0,
          mode: 'drama',
        }

      case 'dismissal':
        return {
          meaning: '冷处理 / 权力博弈 — 拒绝沟通',
          weight: 0.7,
          tension_delta: Math.round(6 + tension * 0.1),
          affection_delta: 0,
          mode: 'drama',
        }

      case 'approach_longing':
      case 'approach_physical':
        return {
          meaning: '接近试探 / 权力结构可能松动',
          weight: 0.6,
          tension_delta: Math.round(-3 - tension * 0.05),
          affection_delta: 0,
          mode: 'drama',
        }

      case 'confession':
        return {
          meaning: '情感暴露 / 角色获得了筹码或弱点',
          weight: 0.75,
          tension_delta: Math.round(-5 - tension * 0.08),
          affection_delta: 0,
          mode: 'drama',
        }

      case 'anger_expression':
        return {
          meaning: '情绪爆发 / 冲突显性化',
          weight: 0.85,
          tension_delta: Math.round(10 + tension * 0.12),
          affection_delta: 0,
          mode: 'drama',
        }

      case 'minimal_input':
        return {
          meaning: '玩家沉默 / 关系降温',
          weight: 0.5,
          tension_delta: Math.round(3 + tension * 0.05),
          affection_delta: 0,
          mode: 'drama',
        }

      default:
        return {
          meaning: '叙事推进 / 场景过渡',
          weight: 0.3,
          tension_delta: 0,
          affection_delta: 0,
          mode: 'drama',
        }
    }
  },

  // ═══════════════════════════════════════════════════════
  // Daily View — emotional amplification
  // ═══════════════════════════════════════════════════════

  dailyView(event, context) {
    const type = event.type
    const usk = context.uskState || {}
    const affection = usk?.relationship?.affection || 50

    switch (type) {
      case 'conflict_question':
        return {
          meaning: '有点在意你为什么不理我 / 轻微失落',
          weight: 0.6,
          tension_delta: 0,
          affection_delta: Math.round(-1 - (affection > 60 ? 0.5 : 0)),
          mode: 'daily',
        }

      case 'departure_threat':
        return {
          meaning: '感觉被推开 / 关系不太稳',
          weight: 0.8,
          tension_delta: 0,
          affection_delta: Math.round(-3 - (affection > 60 ? 1 : 0)),
          mode: 'daily',
        }

      case 'dismissal':
        return {
          meaning: '感觉被冷落了 / 心里不是滋味',
          weight: 0.55,
          tension_delta: 0,
          affection_delta: Math.round(-2 - (affection > 60 ? 0.5 : 0)),
          mode: 'daily',
        }

      case 'approach_longing':
        return {
          meaning: '想你了 / 情感靠近',
          weight: 0.65,
          tension_delta: 0,
          affection_delta: Math.round(2 + (affection > 50 ? 1 : 0)),
          mode: 'daily',
        }

      case 'approach_physical':
        return {
          meaning: '亲密靠近 / 情感升温',
          weight: 0.7,
          tension_delta: 0,
          affection_delta: Math.round(3 + (affection > 50 ? 1 : 0)),
          mode: 'daily',
        }

      case 'confession':
        return {
          meaning: '真心话 / 感情袒露',
          weight: 0.75,
          tension_delta: 0,
          affection_delta: Math.round(3 + (affection > 50 ? 2 : 0)),
          mode: 'daily',
        }

      case 'hurt_expression':
        return {
          meaning: '感到受伤 / 情感脆弱',
          weight: 0.7,
          tension_delta: 0,
          affection_delta: Math.round(-2 - (affection > 60 ? 0.5 : 0)),
          mode: 'daily',
        }

      case 'minimal_input':
        return {
          meaning: '你好像不太想说话 / 有点冷淡',
          weight: 0.4,
          tension_delta: 0,
          affection_delta: Math.round(-1 - (affection > 60 ? 0.5 : 0)),
          mode: 'daily',
        }

      default:
        return {
          meaning: '日常聊天 / 普通互动',
          weight: 0.2,
          tension_delta: 0,
          affection_delta: 0,
          mode: 'daily',
        }
    }
  },

  // ═══════════════════════════════════════════════════════
  // Batch interpretation — process multiple events
  // ═══════════════════════════════════════════════════════

  /**
   * Interpret a whole turn: user message + AI reply, through current mode.
   * Returns accumulated deltas.
   */
  interpretTurn(userMsg, assistantMsg, mode, context = {}) {
    const results = []

    const userEvent = parseEvent(userMsg, 'user')
    if (userEvent) {
      results.push(this.interpret(userEvent, mode, context))
    }

    if (assistantMsg) {
      const aiEvent = parseEvent(assistantMsg, 'assistant')
      if (aiEvent) {
        results.push(this.interpret(aiEvent, mode, context))
      }
    }

    // Aggregate
    const aggregated = results.filter(Boolean).reduce((acc, r) => ({
      meanings: [...acc.meanings, r.meaning],
      totalTensionDelta: acc.totalTensionDelta + (r.tension_delta || 0),
      totalAffectionDelta: acc.totalAffectionDelta + (r.affection_delta || 0),
      maxWeight: Math.max(acc.maxWeight, r.weight),
      events: r,
    }), { meanings: [], totalTensionDelta: 0, totalAffectionDelta: 0, maxWeight: 0 })

    return {
      ...aggregated,
      mode,
      eventCount: results.length,
    }
  },
}

// ═══════════════════════════════════════════════════════════
// 3. Mode-aware memory store — keeps separate interpretation views
// ═══════════════════════════════════════════════════════════

export const DualViewMemory = {
  state: {
    facts: [],              // Raw events (shared)
    dramaMemory: [],        // Drama interpretations
    dailyMemory: [],        // Daily interpretations
  },

  /**
   * Record a turn with both interpretations.
   */
  record(userMsg, assistantMsg, context = {}) {
    const userEvent = parseEvent(userMsg, 'user')
    const aiEvent = assistantMsg ? parseEvent(assistantMsg, 'assistant') : null

    if (userEvent) {
      this.state.facts.push(userEvent)
      this.state.dramaMemory.push(MemoryInterpreter.interpret(userEvent, 'drama', context))
      this.state.dailyMemory.push(MemoryInterpreter.interpret(userEvent, 'daily', context))
    }

    if (aiEvent) {
      this.state.facts.push(aiEvent)
      this.state.dramaMemory.push(MemoryInterpreter.interpret(aiEvent, 'drama', context))
      this.state.dailyMemory.push(MemoryInterpreter.interpret(aiEvent, 'daily', context))
    }
  },

  /**
   * Get the memory view for a specific mode.
   */
  getView(mode) {
    return mode === 'drama' ? this.state.dramaMemory : this.state.dailyMemory
  },

  /**
   * Clear all memory.
   */
  clear() {
    this.state.facts = []
    this.state.dramaMemory = []
    this.state.dailyMemory = []
  },
}
