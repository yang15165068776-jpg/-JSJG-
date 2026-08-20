/**
 * useAutoMessage — Autonomous Message Hook (USK-driven, zero LLM)
 *
 * Replaces the old LLM-based triggerActiveCheck() with a deterministic
 * USK initiative engine. No API call needed — state alone decides if
 * the character should reach out.
 *
 * Usage:
 *   const { pendingMessage, dismissMessage, isChecking } = useAutoMessage({
 *     persona, currentMode, enabled: settings.autoMessageEnabled, idleMs
 *   })
 *
 * How it works:
 *   1. Every `interval` ms, reads USK initiative score via bridge
 *   2. If initiative > threshold + enough passive turns → triggers
 *   3. Generates message content based on USK emotion/life state
 *   4. Returns message to caller; caller displays it in chat
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { getUIState } from '../state/stateBridge'
import { shouldSendAutonomousMessage, getRelationship, getEmotion, getLife } from '../state/unifiedStateKernel'
import { getRawUSK } from '../state/stateBridge'

// ═══════════════════════════════════════════════════════════
// Message templates — weighted by USK state
// ═══════════════════════════════════════════════════════════

const MESSAGE_POOLS = {
  lonely_high: [
    '在吗……',
    '今天好安静',
    '有点无聊',
    '你在干嘛',
    '怎么不说话',
    '我一个人好没意思',
  ],
  affectionate: [
    '刚刚突然想到你',
    '今天好像有什么事想跟你说…但又忘了',
    '你吃饭了吗',
    '（发了一张模糊的照片）',
    '不知道为什么就点开你头像了',
  ],
  curious: [
    '你最近在忙什么',
    '话说……',
    '你今天好像和平时不太一样',
    '我猜你在……算了不猜了',
  ],
  moody_low: [
    '有点累',
    '今天不太想说话',
    '…',
    '没什么',
    '就发一下',
  ],
  neutral: [
    '嗯',
    '在',
    '哦',
    '刚看到',
  ],
}

/**
 * Pick a message from the appropriate pool based on USK state.
 */
function pickMessage(usk, charName) {
  const loneliness = getLife(usk, charName, 'loneliness') || getLife(usk, charName, 'lonely') || 40
  const affection = getRelationship(usk, charName, 'affection') || 50
  const curiosity = getEmotion(usk, charName, 'curiosity') || 30
  const mood = getLife(usk, charName, 'mood') || 60

  // Weighted pool selection
  const pools = []

  if (loneliness > 70) {
    pools.push({ pool: 'lonely_high', weight: loneliness })
  }
  if (affection > 65) {
    pools.push({ pool: 'affectionate', weight: affection })
  }
  if (curiosity > 60) {
    pools.push({ pool: 'curious', weight: curiosity })
  }
  if (mood < 40) {
    pools.push({ pool: 'moody_low', weight: 100 - mood })
  }

  // Fallback
  if (pools.length === 0) {
    pools.push({ pool: 'neutral', weight: 50 })
  }

  // Weighted random selection
  const totalWeight = pools.reduce((s, p) => s + p.weight, 0)
  let rand = Math.random() * totalWeight
  let selectedPool = pools[0].pool

  for (const p of pools) {
    rand -= p.weight
    if (rand <= 0) {
      selectedPool = p.pool
      break
    }
  }

  const messages = MESSAGE_POOLS[selectedPool] || MESSAGE_POOLS.neutral
  return messages[Math.floor(Math.random() * messages.length)]
}

// ═══════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════

/**
 * @param {object} options
 * @param {object} options.persona — UnifiedPersona
 * @param {string} options.currentMode — 'drama' | 'daily'
 * @param {boolean} options.enabled — auto message toggle (from settings)
 * @param {number} options.idleMs — milliseconds since last user activity
 * @param {number} [options.checkInterval=30000] — how often to check (ms)
 * @returns {{ pendingMessage: string|null, dismissMessage: function, isChecking: boolean }}
 */
export function useAutoMessage({
  persona,
  currentMode,
  enabled,
  idleMs = 0,
  checkInterval = 30000,
}) {
  const [pendingMessage, setPendingMessage] = useState(null)
  const [isChecking, setIsChecking] = useState(false)
  const timerRef = useRef(null)
  const lastCheckRef = useRef(0)

  const dismissMessage = useCallback(() => {
    setPendingMessage(null)
  }, [])

  useEffect(() => {
    // Clear timer on unmount or settings change
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    // Only active in DAILY mode with toggle ON
    if (!enabled || currentMode !== 'daily') return

    const check = () => {
      if (!persona) return

      const charName = persona.characters?.find(c => c.type === 'romance')?.name
      if (!charName) return

      setIsChecking(true)

      try {
        const usk = getRawUSK()
        if (!usk) return

        const result = shouldSendAutonomousMessage(usk, charName)

        if (result.shouldSend) {
          const msg = pickMessage(usk, charName)
          setPendingMessage(msg)
          console.log('[AutoMessage] Triggered:',
            result.reason, '| urgency:', result.urgency,
            '| message:', msg)
        }
      } catch (e) {
        console.warn('[AutoMessage] Check failed:', e)
      } finally {
        setIsChecking(false)
        lastCheckRef.current = Date.now()
      }
    }

    // Initial check after 5 seconds
    const initialTimer = setTimeout(check, 5000)

    // Periodic checks
    timerRef.current = setInterval(check, checkInterval)

    return () => {
      clearTimeout(initialTimer)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [enabled, currentMode, persona?.id, checkInterval])

  return { pendingMessage, dismissMessage, isChecking }
}
