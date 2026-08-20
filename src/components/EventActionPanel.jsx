import { useState } from 'react'

/**
 * EventActionPanel — Drama mode floating action panel.
 * Positioned on the right side, vertically centered.
 * Provides: random event (dice), edit episode, delete node, back.
 *
 * Props:
 *   onDiceOpen: () => void
 *   onEditLast: () => void
 *   onDeleteLast: () => void
 *   hasMessages: boolean
 *   tension: number
 */
export default function EventActionPanel({
  onDiceOpen,
  onEditLast,
  onDeleteLast,
  hasMessages = false,
  tension = 50,
}) {
  const [expanded, setExpanded] = useState(false)

  const iconBtn = (bg, color) => ({
    width: '36px', height: '36px', borderRadius: '18px',
    border: '0.5px solid var(--border)', background: bg || 'var(--bg2)',
    color: color || 'var(--text2)', fontSize: '14px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'transform 0.12s',
  })

  return (
    <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: '16px', zIndex: 20, alignItems: 'center' }}>

      {/* Toggle button — always visible */}
      <button
        style={{ ...iconBtn(expanded ? 'var(--text)' : 'var(--bg2)', expanded ? 'var(--bg)' : 'var(--text2)'), width: '40px', height: '40px', borderRadius: '20px', fontSize: '16px' }}
        onClick={() => setExpanded(v => !v)}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.08)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        {expanded ? '×' : '✦'}
      </button>

      {/* Expanded actions */}
      {expanded && (
        <>
          <button style={iconBtn()} onClick={() => { onDiceOpen(); setExpanded(false) }} title="随机事件骰子"
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.08)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >🎲</button>

          <button style={{ ...iconBtn(), opacity: hasMessages ? 1 : 0.3, cursor: hasMessages ? 'pointer' : 'default' }}
            onClick={() => { if (hasMessages) { onEditLast(); setExpanded(false) } }} title="编辑最后一条"
            onMouseEnter={e => { if (hasMessages) e.currentTarget.style.transform = 'scale(1.08)' }}
            onMouseLeave={e => { if (hasMessages) e.currentTarget.style.transform = 'scale(1)' }}
          >✏️</button>

          <button style={{ ...iconBtn(), opacity: hasMessages ? 1 : 0.3, cursor: hasMessages ? 'pointer' : 'default' }}
            onClick={() => { if (hasMessages) { onDeleteLast(); setExpanded(false) } }} title="删除最后一条"
            onMouseEnter={e => { if (hasMessages) e.currentTarget.style.transform = 'scale(1.08)' }}
            onMouseLeave={e => { if (hasMessages) e.currentTarget.style.transform = 'scale(1)' }}
          >🗑</button>
        </>
      )}

      {/* Tension indicator */}
      <div style={{ fontSize: '10px', color: 'var(--text3)', textAlign: 'center', lineHeight: 1.3 }}>
        <div>⚡</div>
        <div>{tension}</div>
      </div>
    </div>
  )
}
