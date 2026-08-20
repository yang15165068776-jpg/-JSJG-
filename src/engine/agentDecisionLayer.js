/**
 * Agent Decision Layer v1 — 角色自主决策层
 *
 * 纯规则引擎，不调 LLM。读取 USK 状态 → 评分 → 选择行为。
 *
 * 控制三件事：
 *   1. 是否发言（speak / silence）
 *   2. 说几条（burst control: 0-3）
 *   3. 行为类型（normal / interrupt / initiate / emotional / silent）
 *
 * 设计原则：
 *   - 零 API 成本（纯计算，确定性）
 *   - Singleton object 模式
 *   - 通过 InteractionKernel 消费，不直接暴露给 UI
 *   - 决策矩阵按优先级递减（高冲突优先于高依恋）
 */

import { getFolderUIState } from '../state/stateBridge'

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

// ═══════════════════════════════════════════════════════════
// Agent Decision Layer
// ═══════════════════════════════════════════════════════════

export const AgentDecisionLayer = {

  /**
   * 主决策入口。
   *
   * @param {object} params
   * @param {object} params.uskState — getFolderUIState() 返回值 { relationship, emotion, tension, life }
   * @param {object[]} params.lastMessages — 最近的消息数组
   * @param {'drama'|'daily'} params.mode — 当前模式
   * @param {number} params.turnCount — 当前轮数
   * @param {number} params.passiveTurns — 连续未互动轮数
   * @returns {object} decision { type, intensity, burst, emotion, reason, urgency }
   */
  decide({ uskState, lastMessages, mode, turnCount, passiveTurns }) {
    const scores = this.evaluateState({ uskState, lastMessages, turnCount, passiveTurns, mode })
    return this.selectAction(scores)
  },

  // ═══════════════════════════════════════════════════════
  // 1. State Evaluation
  // ═══════════════════════════════════════════════════════

  /**
   * 从 USK 状态计算评分维度。
   * 所有分数均为 0-100。
   */
  evaluateState({ uskState, lastMessages, turnCount, passiveTurns }) {
    const rel = uskState?.relationship || {}
    const emo = uskState?.emotion || {}
    const ten = uskState?.tension || {}
    const lif = uskState?.life || {}

    // 基础值
    const affection = rel.affection ?? 50
    const dependency = rel.dependency ?? 30
    const possessiveness = rel.possessiveness ?? 20
    const fear = rel.fear ?? 10
    const trust = rel.trust ?? 40

    const anger = emo.anger ?? 10
    const jealousy = emo.jealousy ?? 10
    const sadness = emo.sadness ?? 10
    const curiosity = emo.curiosity ?? 30

    const unresolvedConflicts = ten.unresolved_conflicts ?? 30
    const emotionalPressure = ten.emotional_pressure ?? 20
    const attractionTension = ten.attraction_tension ?? 25
    const powerImbalance = ten.power_imbalance ?? 15

    const mood = lif.mood ?? 50
    const lonely = lif.lonely ?? 40
    const busy = lif.busy ?? 20

    // ── 综合评分公式 ──

    // 冲突评分：张力 + 愤怒 → 0-100
    const conflictScore = clamp(
      unresolvedConflicts * 0.4 +
      emotionalPressure * 0.25 +
      anger * 0.25 +
      powerImbalance * 0.1,
      0, 100,
    )

    // 依恋评分：好感 + 依赖 + 孤独 → 0-100
    const attachmentScore = clamp(
      affection * 0.45 +
      dependency * 0.25 +
      lonely * 0.2 +
      attractionTension * 0.1,
      0, 100,
    )

    // 冷落评分：被动轮数 + 情绪低落 → 0-100
    const neglectScore = clamp(
      (passiveTurns || 0) * 12 +
      (100 - mood) * 0.25 +
      sadness * 0.15,
      0, 100,
    )

    // 嫉妒评分：嫉妒 + 占有欲 + 恐惧 → 0-100
    const jealousyScore = clamp(
      jealousy * 0.5 +
      possessiveness * 0.3 +
      fear * 0.2,
      0, 100,
    )

    // 主动性评分：好奇 + 好感 + 低忙碌 → 0-100
    const initiativeScore = clamp(
      curiosity * 0.35 +
      affection * 0.3 +
      (100 - busy) * 0.2 +
      lonely * 0.15,
      0, 100,
    )

    // 冷落检测：玩家是否多轮未互动
    const ignored = this.detectIgnored(lastMessages, turnCount)

    return {
      conflictScore,
      attachmentScore,
      neglectScore,
      jealousyScore,
      initiativeScore,
      ignored,
      // 保留原始维度用于调试
      raw: { affection, dependency, anger, jealousy: jealousy, sadness, mood, lonely, busy,
             unresolvedConflicts, emotionalPressure, possessiveness, fear },
    }
  },

  // ═══════════════════════════════════════════════════════
  // 2. Action Selection
  // ═══════════════════════════════════════════════════════

  /**
   * 根据评分选择行为。优先级递减，先匹配到的胜出。
   */
  selectAction(scores) {
    const {
      conflictScore, attachmentScore, neglectScore,
      jealousyScore, initiativeScore, ignored,
    } = scores

    // ── Priority 1: 高冲突 → 强制插话 ──
    if (conflictScore > 70) {
      return {
        type: 'interrupt',
        intensity: conflictScore > 85 ? 'high' : 'medium',
        burst: conflictScore > 85 ? 3 : 2,
        emotion: 'anger',
        reason: `高冲突状态 (${Math.round(conflictScore)}分)，角色主动打断`,
        urgency: clamp(conflictScore / 100, 0.5, 1),
      }
    }

    // ── Priority 2: 强烈嫉妒 → 情绪爆发 ──
    if (jealousyScore > 65) {
      return {
        type: 'emotional_burst',
        intensity: jealousyScore > 80 ? 'high' : 'medium',
        burst: jealousyScore > 80 ? 3 : 2,
        emotion: 'jealousy',
        reason: `嫉妒驱动 (${Math.round(jealousyScore)}分)，角色情绪爆发`,
        urgency: clamp(jealousyScore / 100, 0.5, 0.9),
      }
    }

    // ── Priority 3: 被冷落 → 冷处理 ──
    if (neglectScore > 70) {
      return {
        type: 'silent',
        intensity: neglectScore > 85 ? 'high' : 'medium',
        burst: 0,
        emotion: 'cold',
        reason: `被冷落 (${Math.round(neglectScore)}分)，角色选择沉默`,
        urgency: 0,
        duration: neglectScore > 85 ? 3 : 2,
      }
    }

    // ── Priority 4: 高依恋 + 被冷落 → 主动黏人 ──
    if (attachmentScore > 60 && neglectScore > 40) {
      return {
        type: 'initiate_chat',
        intensity: attachmentScore > 75 ? 'high' : 'medium',
        burst: 1,
        emotion: 'affectionate',
        reason: `高依恋 (${Math.round(attachmentScore)}分) + 被冷落 (${Math.round(neglectScore)}分)，角色主动搭话`,
        urgency: clamp(attachmentScore / 100, 0.3, 0.7),
      }
    }

    // ── Priority 5: 高主动性 + 非忙碌 → 主动发起 ──
    if (initiativeScore > 70 && ignored) {
      return {
        type: 'initiate_chat',
        intensity: 'low',
        burst: 1,
        emotion: 'curious',
        reason: `高主动性 (${Math.round(initiativeScore)}分)，角色主动发起对话`,
        urgency: clamp(initiativeScore / 100, 0.2, 0.5),
      }
    }

    // ── Priority 6: 低冲突 + 低依恋 + 被忽略 → 轻量冷处理 ──
    if (neglectScore > 50 && attachmentScore < 35) {
      return {
        type: 'silent',
        intensity: 'low',
        burst: 0,
        emotion: 'cold',
        reason: '低依恋+被冷落，角色简短回应或沉默',
        urgency: 0,
        duration: 1,
      }
    }

    // ── Default: 正常状态 ──
    return {
      type: 'normal_reply',
      intensity: 'low',
      burst: 1,
      emotion: null,
      reason: '正常互动状态',
      urgency: 0,
    }
  },

  // ═══════════════════════════════════════════════════════
  // 3. Ignore Detection
  // ═══════════════════════════════════════════════════════

  /**
   * 检测玩家是否在"冷落"角色。
   * 最近 3 条消息中没有 player 消息 → 被冷落
   * 最近消息全是 player 但没有 assistant → 角色被跳过
   */
  detectIgnored(messages, turnCount) {
    if (!messages || messages.length === 0) return turnCount > 0

    const recent = messages.slice(-4)
    const hasPlayer = recent.some(m => m.role === 'user' || m.role === 'player')
    const hasAssistant = recent.some(m => m.role === 'assistant' || m.role === 'agent')

    // 有 assistant 回复说明没有冷落
    if (hasAssistant) return false

    // 只有 player 消息但无 assistant 回复 → 被跳过
    if (hasPlayer && !hasAssistant) return true

    // 最近的不是 player 消息 → 可能被冷落
    const last = messages[messages.length - 1]
    if (last && last.role !== 'user' && last.role !== 'player') return true

    return false
  },

  // ═══════════════════════════════════════════════════════
  // 4. Autonomous Speak Decision
  // ═══════════════════════════════════════════════════════

  /**
   * 判断角色是否应该主动说话（不需要玩家输入）。
   * 用于 idle 定时器触发。
   *
   * @returns {{ shouldSpeak: boolean, reason: string, urgency: number }}
   */
  shouldAutoSpeak(uskState, lastMessages, mode) {
    const scores = this.evaluateState({
      uskState,
      lastMessages,
      turnCount: 0,
      passiveTurns: 0,
    })

    // 高冲突：不需要主动说话（已经在对抗中）
    if (scores.conflictScore > 70) {
      return { shouldSpeak: false, reason: '冲突中，等待玩家回应', urgency: 0 }
    }

    // 高主动性 + 无最近互动 → 主动搭话
    if (scores.initiativeScore > 70 && scores.ignored) {
      return {
        shouldSpeak: true,
        reason: `高主动性 (${Math.round(scores.initiativeScore)}分)，角色想打破沉默`,
        urgency: clamp(scores.initiativeScore / 100, 0.3, 0.8),
      }
    }

    // 极度孤独 → 主动求关注
    if (scores.raw.lonely > 80) {
      return {
        shouldSpeak: true,
        reason: `极度孤独 (${Math.round(scores.raw.lonely)}分)，角色寻求互动`,
        urgency: clamp(scores.raw.lonely / 100, 0.5, 0.95),
      }
    }

    // 高依恋 + 长时间无互动
    if (scores.attachmentScore > 70 && scores.ignored) {
      return {
        shouldSpeak: true,
        reason: '高依恋状态，角色想念玩家',
        urgency: clamp(scores.attachmentScore / 100, 0.3, 0.6),
      }
    }

    return { shouldSpeak: false, reason: '', urgency: 0 }
  },

  // ═══════════════════════════════════════════════════════
  // 5. Convenience: decide from folder USK
  // ═══════════════════════════════════════════════════════

  /**
   * 从 folder USK 直接决策（便捷方法）。
   * 封装了 getFolderUIState 调用。
   *
   * @param {string} charName — 主角名字
   * @param {object[]} lastMessages
   * @param {'drama'|'daily'} mode
   * @param {number} turnCount
   * @param {number} passiveTurns
   */
  decideFromFolder(charName, lastMessages, mode, turnCount, passiveTurns) {
    const uskState = getFolderUIState(charName)
    if (!uskState) {
      return {
        type: 'normal_reply',
        intensity: 'low',
        burst: 1,
        emotion: null,
        reason: 'USK 状态不可用，默认正常回复',
        urgency: 0,
      }
    }
    return this.decide({ uskState, lastMessages, mode, turnCount, passiveTurns })
  },
}
