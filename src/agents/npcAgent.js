/**
 * NPC Agent System — deterministic rule-based NPC autonomy.
 *
 * Design principle: NPCs do NOT use LLM calls.
 * Each NPC evaluates the world state against its personality + stage
 * and produces an intent/emotion/action deterministically.
 *
 * Intent matrix:   affection stage × personality color × trigger condition
 * Emotion mapping: stage emotional traits + recent events
 * Action generation: selfDriveBehaviors + intent-based templates
 */

import { publish } from '../world/eventBus'
import { computeDominance } from '../runtime/powerDynamics'

// ─── Intent Matrix ──────────────────────────────────────
// [stageLevel][triggerType] → intent priority list (first match wins)

const STAGE_LEVELS = {
  high: ['在意期', '亲密期', '依赖期', '爱', '恋爱', '深爱', '热恋', '依恋'],
  mid: ['友好期', '熟悉期', '关注期', '动摇期', '好奇', '兴趣'],
  low: ['陌生期', '冷漠期', '戒备期', '厌恶期', '恨', '利用', '折磨'],
}

const TRIGGER_TYPES = {
  player_approach: '玩家主动靠近或示好',
  player_neglect: '玩家冷落或无视该角色',
  other_npc_present: '其他NPC在场并与玩家互动',
  conflict_active: '当前存在冲突事件',
  high_signal_input: '玩家输入包含高情感信号',
}

// Intent matrix: [stageLevel][trigger] → [intents ordered by priority]
const INTENT_MATRIX = {
  high: {
    player_approach: ['approach', 'protect'],
    player_neglect: ['confront', 'approach'],
    other_npc_present: ['intervene', 'confront', 'jealous'],
    conflict_active: ['protect', 'confront'],
    high_signal_input: ['approach', 'protect'],
  },
  mid: {
    player_approach: ['observe', 'approach'],
    player_neglect: ['approach', 'observe'],
    other_npc_present: ['observe', 'approach'],
    conflict_active: ['withdraw', 'observe'],
    high_signal_input: ['approach', 'observe'],
  },
  low: {
    player_approach: ['withdraw', 'ignore'],
    player_neglect: ['ignore', 'confront'],
    other_npc_present: ['confront', 'escalate'],
    conflict_active: ['escalate', 'withdraw'],
    high_signal_input: ['confront', 'ignore'],
  },
}

// Dark personality modifier (more aggressive intents)
const DARK_MODIFIER = {
  approach: ['confront', 'approach'],
  observe: ['confront', 'observe'],
  withdraw: ['escalate', 'withdraw'],
  ignore: ['confront', 'ignore'],
}

// Warm personality modifier (softer intents)
const WARM_MODIFIER = {
  confront: ['withdraw', 'approach'],
  escalate: ['withdraw', 'confront'],
  intervene: ['observe', 'approach'],
}

// ─── Emotion Mapping ────────────────────────────────────

const EMOTION_MAP = {
  approach: ['期待', '紧张', '渴望'],
  confront: ['愤怒', '嫉妒', '受伤'],
  intervene: ['焦虑', '占有', '不安'],
  observe: ['冷静', '好奇', '疏离'],
  withdraw: ['退缩', '卑微', '自我怀疑'],
  protect: ['坚定', '担忧', '温柔'],
  escalate: ['暴怒', '攻击性', '失控'],
  ignore: ['冷漠', '无聊', '不屑'],
  jealous: ['嫉妒', '酸涩', '不安'],
}

// ─── Action Templates ───────────────────────────────────

const ACTION_TEMPLATES = {
  approach: [
    '靠近玩家身边',
    '轻声开口说话',
    '伸手触碰又收回',
    '目光锁定玩家',
  ],
  confront: [
    '堵在玩家面前',
    '声音带刺地质问',
    '抓住玩家的手腕',
    '眼神冰冷地逼视',
  ],
  intervene: [
    '插入两人之间',
    '故意打断对话',
    '用身体隔开距离',
    '冷笑一声吸引注意',
  ],
  observe: [
    '靠在墙边沉默注视',
    '低头假装不在意',
    '指尖轻敲桌面',
    '从远处投来目光',
  ],
  withdraw: [
    '退后一步拉开距离',
    '转过身去不看',
    '低声说了句没什么',
    '安静地离开中心区域',
  ],
  protect: [
    '挡在玩家身前',
    '压低声音警告对方',
    '手臂护住玩家',
    '眼神锐利地扫视周围',
  ],
  escalate: [
    '猛地把东西摔在地上',
    '声音陡然拔高',
    '一拳砸在墙上',
    '冷笑着说出更伤人的话',
  ],
  ignore: [
    '完全当作空气不存在',
    '继续做自己的事',
    '眼神淡漠地掠过',
    '转身去看窗外',
  ],
  jealous: [
    '阴阳怪气地评论',
    '故意提起旧事',
    '眼神在两人之间来回',
    '冷哼一声别过脸',
  ],
}

// ─── Main Agent Run ─────────────────────────────────────

/**
 * Run a single NPC agent for one turn.
 *
 * @param {object} agent — character state from World Engine
 * @param {object} world — full world state
 * @param {object} eventBus — Event Bus instance
 * @param {string} userAction — current user input
 * @returns {{ intent, emotion, action, eventsPublished }}
 */
export function runNPCAgent(agent, world, eventBus, userAction, powerGraph) {
  if (!agent.present) {
    return { intent: 'absent', emotion: 'none', action: null, eventsPublished: 0 }
  }

  // 1. Determine stage level
  const stageLevel = classifyStageLevel(agent.stageName, agent.affection, agent.affectionStages)

  // 2. Determine active triggers
  const triggers = detectTriggers(world, agent, userAction)

  // 3. Determine power position (v3.5)
  let powerPosition = null
  if (powerGraph) {
    const dom = computeDominance(powerGraph, agent.name, 'user')
    powerPosition = {
      dominant: dom.dominant === agent.name,
      intensity: dom.intensity,
      myDominance: dom.A_over_B,
    }
  }

  // 4. Determine intent from matrix (power-aware)
  const intent = selectIntent(stageLevel, agent.personalityColor, triggers, powerPosition)

  // 5. Determine emotion
  const emotion = selectEmotion(intent, agent)

  // 6. Generate action description
  const action = selectAction(intent, agent, userAction)

  // 7. Publish NPC_ACTION event
  publish(eventBus, 'NPC_ACTION', {
    agent: agent.name,
    intent,
    emotion,
    action,
    target: 'player',
    stageLevel,
    triggers: triggers.join(','),
    powerPosition,  // v3.5: include power state for CPS detection
  })

  // 8. Check self-drive behaviors for additional events
  checkSelfDriveBehaviors(agent, world, eventBus, triggers)

  return {
    intent,
    emotion,
    action,
    eventsPublished: 1,
  }
}

/**
 * Run all NPC agents in parallel.
 * (They are synchronous rule evaluations, not API calls — "parallel" is just Promise.all for API compatibility.)
 */
export async function runAllNPCAgents(world, eventBus, userAction, powerGraph) {
  const agents = Object.values(world.characters).filter(c => c.present)
  const results = []

  for (const agent of agents) {
    const result = runNPCAgent(agent, world, eventBus, userAction, powerGraph)
    results.push({ agent: agent.name, ...result })
  }

  return results
}

// ─── Internal Functions ─────────────────────────────────

function classifyStageLevel(stageName, affection, stages) {
  if (!stageName) {
    if (affection >= 60) return 'high'
    if (affection >= 30) return 'mid'
    return 'low'
  }

  const name = stageName.toLowerCase()
  for (const kw of STAGE_LEVELS.high) {
    if (name.includes(kw)) return 'high'
  }
  for (const kw of STAGE_LEVELS.mid) {
    if (name.includes(kw)) return 'mid'
  }
  for (const kw of STAGE_LEVELS.low) {
    if (name.includes(kw)) return 'low'
  }

  // Fallback to threshold
  if (affection >= 60) return 'high'
  if (affection >= 30) return 'mid'
  return 'low'
}

function detectTriggers(world, agent, userAction) {
  const triggers = []

  const input = (userAction || '').toLowerCase()

  // Check for high-signal input
  const highSignal = ['亲密', '冲突', '拒绝', '依赖', '爱', '恨', '离开',
    '拥抱', '牵手', '接吻', '推', '冷', '靠近', '疏远', '信任', '背叛',
    '保护', '伤害', '安慰', '在意']
  if (highSignal.some(kw => input.includes(kw))) {
    triggers.push('high_signal_input')
  }

  // Check for player approach/neglect
  const approachWords = ['过来', '靠近', '想你', '陪你', '聊聊', '看看你', '找你']
  const neglectWords = ['算了', '不用', '随便', '没什么', '走了', '再见', '别管']
  if (approachWords.some(kw => input.includes(kw))) triggers.push('player_approach')
  if (neglectWords.some(kw => input.includes(kw))) triggers.push('player_neglect')

  // Other NPCs present?
  const presentNPCs = Object.values(world.characters).filter(
    c => c.present && c.name !== agent.name && c.type === 'romance'
  )
  if (presentNPCs.length > 0) triggers.push('other_npc_present')

  // Conflict active?
  const recentEvents = (world.eventLog || []).slice(-3)
  if (recentEvents.some(e => e.type === 'CONFLICT_EVENT')) {
    triggers.push('conflict_active')
  }

  // Default: if no specific trigger, at least the presence of user action
  if (triggers.length === 0 && userAction) {
    triggers.push('high_signal_input') // default to treating user input as a signal
  }

  return triggers
}

function selectIntent(stageLevel, personalityColor, triggers, powerPosition) {
  const matrix = INTENT_MATRIX[stageLevel] || INTENT_MATRIX.mid

  // Try each trigger in order, take the first matching intent
  for (const trigger of triggers) {
    const intents = matrix[trigger]
    if (intents && intents.length > 0) {
      let selectedIntent = intents[0] // First priority intent

      // ── v3.5 Power-aware modulation (applied BEFORE personality) ──
      if (powerPosition) {
        if (powerPosition.myDominance > 0.75) {
          // High dominance → escalate aggressive intents
          if (selectedIntent === 'observe') selectedIntent = 'approach'
          if (selectedIntent === 'withdraw') selectedIntent = 'confront'
        } else if (powerPosition.myDominance < 0.30) {
          // Low dominance → more defensive
          if (selectedIntent === 'confront') selectedIntent = 'withdraw'
          if (selectedIntent === 'escalate') selectedIntent = 'confront'
          if (selectedIntent === 'intervene') selectedIntent = 'observe'
        }

        // Emotional pressure mode (dominance > 0.70): emotion = control
        if (powerPosition.myDominance > 0.70 && selectedIntent === 'approach') {
          // "Approach" under high dominance is possessive, not warm
          selectedIntent = 'intervene'
        }
      }

      // Apply personality modifier (probabilistic — use simple hash)
      if (personalityColor === 'dark' && DARK_MODIFIER[selectedIntent]) {
        const hash = (triggers.join('').length + (powerPosition?.myDominance || 0.5) * 100) % 3
        if (hash === 0) selectedIntent = DARK_MODIFIER[selectedIntent][0]
      }
      if (personalityColor === 'warm' && WARM_MODIFIER[selectedIntent]) {
        const hash = (triggers.join('').length + (powerPosition?.myDominance || 0.5) * 100) % 3
        if (hash === 0) selectedIntent = WARM_MODIFIER[selectedIntent][0]
      }

      return selectedIntent
    }
  }

  return 'observe' // Default
}

function selectEmotion(intent, agent) {
  const emotions = EMOTION_MAP[intent] || ['neutral']
  // Deterministic selection based on agent state
  const idx = (agent.affection + (agent.stageIndex || 0)) % emotions.length
  return emotions[idx] || 'neutral'
}

function selectAction(intent, agent, userAction) {
  const templates = ACTION_TEMPLATES[intent] || ACTION_TEMPLATES.observe
  const idx = ((userAction || '').length + agent.affection) % templates.length
  return templates[idx]
}

function checkSelfDriveBehaviors(agent, world, eventBus, triggers) {
  if (!agent.selfDriveBehaviors || agent.selfDriveBehaviors.length === 0) return

  for (const sdb of agent.selfDriveBehaviors) {
    const trigger = (sdb.trigger || '').toLowerCase()
    let shouldTrigger = false

    if (trigger.includes('超过') && trigger.includes('轮')) {
      // "超过N轮用户没主动互动" type
      const turnsSinceLastMention = world.roundIndex - (agent.lastMentionedTurn || 0)
      const nMatch = trigger.match(/(\d+)/)
      const threshold = nMatch ? parseInt(nMatch[1]) : 3
      if (turnsSinceLastMention >= threshold) shouldTrigger = true
    } else if (trigger.includes('出现') || trigger.includes('元素')) {
      // Scene element detection
      if (userAction && trigger.split(/[、，,\s]/).some(kw => (userAction || '').includes(kw))) {
        shouldTrigger = true
      }
    } else if (trigger.includes('进入') && trigger.includes('阶段')) {
      // Stage entry trigger — already active since we're in this stage
      shouldTrigger = triggers.includes('high_signal_input')
    } else if (trigger.includes('不利')) {
      // Agent judges situation unfavorable
      if (triggers.includes('conflict_active') || triggers.includes('other_npc_present')) {
        shouldTrigger = true
      }
    }

    if (shouldTrigger) {
      publish(eventBus, 'NPC_ACTION', {
        agent: agent.name,
        intent: 'approach',
        emotion: '不安',
        action: sdb.behavior || sdb.description || '自主行动',
        target: 'player',
        trigger: 'self_drive',
      })
    }
  }
}
