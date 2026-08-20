import { useEffect, useState } from 'react'

/**
 * TypingIndicator — "对方正在输入…" with animated bouncing dots.
 * Matches DailyRenderer bubble style.
 */
export default function TypingIndicator({ visible, characterName }) {
  const [dots, setDots] = useState(1)

  useEffect(() => {
    if (!visible) { setDots(1); return }
    const interval = setInterval(() => setDots(d => (d % 3) + 1), 400)
    return () => clearInterval(interval)
  }, [visible])

  if (!visible) return null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-end',
      gap: '6px',
      padding: '0 12px 4px',
      animation: 'fadeIn 0.3s ease-out',
    }}>
      {/* Avatar */}
      <div style={{
        width: '30px',
        height: '30px',
        borderRadius: '8px',
        background: 'var(--purple)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <span style={{ color: '#fff', fontSize: '13px', fontWeight: 600 }}>
          {(characterName || '?')[0]}
        </span>
      </div>

      {/* Typing bubble */}
      <div style={{
        padding: '10px 14px',
        borderRadius: '18px 18px 18px 4px',
        background: 'var(--bg2)',
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
      }}>
        <span style={{ fontSize: '12px', color: 'var(--text3)' }}>
          {characterName ? characterName + ' 正在输入' : '对方正在输入'}
        </span>
        <span style={{ display: 'flex', gap: '2px', marginLeft: '1px' }}>
          {[1, 2, 3].map(i => (
            <span
              key={i}
              className="dot-bounce"
              style={{
                width: '4px',
                height: '4px',
                borderRadius: '2px',
                background: 'var(--text3)',
                display: 'inline-block',
                animationDelay: (i * 0.15) + 's',
              }}
            />
          ))}
        </span>
      </div>
    </div>
  )
}
