/**
 * TypingIndicator — "对方正在输入…" animation
 *
 * Shows a subtle typing indicator with animated dots,
 * simulating the WeChat "typing…" experience.
 *
 * Usage:
 *   <TypingIndicator visible={isStreaming} characterName="林晚" />
 */

import { useEffect, useState } from 'react'

export default function TypingIndicator({ visible, characterName }) {
  const [dots, setDots] = useState(1)

  useEffect(() => {
    if (!visible) {
      setDots(1)
      return
    }

    const interval = setInterval(() => {
      setDots(d => (d % 3) + 1)
    }, 400)

    return () => clearInterval(interval)
  }, [visible])

  if (!visible) return null

  return (
    <div className="flex items-center gap-2 px-4 py-2 animate-fade-in">
      {/* Avatar placeholder */}
      <div className="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center flex-shrink-0">
        <span className="text-[10px] text-gray-300">
          {(characterName || '?')[0]}
        </span>
      </div>

      {/* Typing bubble */}
      <div className="bg-gray-700/60 rounded-2xl rounded-tl-sm px-3 py-2 max-w-[60%]">
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-gray-400">
            {characterName ? characterName + ' 正在输入' : '对方正在输入'}
          </span>
          <span className="text-gray-500 text-[10px] tracking-wider">
            {'.'.repeat(dots)}
          </span>
        </div>
      </div>
    </div>
  )
}
