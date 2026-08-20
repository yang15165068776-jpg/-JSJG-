import { useEffect } from 'react'

/**
 * Toast — auto-dismissing notification.
 * Props: message, type ('success'|'error'|'info'), visible, onHide
 */
export default function Toast({ message, type = 'info', visible, onHide }) {
  useEffect(() => {
    if (visible) {
      const t = setTimeout(onHide, 2500)
      return () => clearTimeout(t)
    }
  }, [visible, onHide])

  if (!visible) return null

  const colors = {
    success: { bg: 'var(--teal-l)', text: 'var(--teal)' },
    error: { bg: 'var(--coral-l)', text: 'var(--coral)' },
    info: { bg: 'var(--purple-l)', text: 'var(--purple)' },
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 'calc(env(safe-area-inset-bottom) + 80px)',
      left: '50%',
      transform: 'translateX(-50%)',
      background: colors[type]?.bg || colors.info.bg,
      color: colors[type]?.text || colors.info.text,
      padding: '10px 20px',
      borderRadius: '20px',
      fontSize: '13px',
      fontWeight: 500,
      whiteSpace: 'nowrap',
      zIndex: 9999,
      animation: 'fadeUp 0.2s ease',
      pointerEvents: 'none',
    }}>
      {message}
    </div>
  )
}
