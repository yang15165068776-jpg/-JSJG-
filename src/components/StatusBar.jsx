import { useState, useEffect } from 'react'

/**
 * StatusBar — Phone-style status bar for the mobile shell.
 * Shows time, battery, signal. Auto-updates time every 30s.
 */
export default function StatusBar() {
  const [time, setTime] = useState('')

  useEffect(() => {
    const update = () => {
      const now = new Date()
      setTime(
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0')
      )
    }
    update()
    const timer = setInterval(update, 30000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div style={{
      height: '28px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 20px',
      background: 'var(--bg)',
      flexShrink: 0,
      userSelect: 'none',
    }}>
      {/* Time */}
      <span style={{
        fontSize: '12px',
        fontWeight: 600,
        color: 'var(--text)',
        width: '48px',
      }}>
        {time}
      </span>

      {/* Notch area */}
      <div style={{
        width: '80px',
        height: '20px',
        borderRadius: '10px',
        background: 'var(--text)',
        opacity: 0.08,
      }} />

      {/* Signal + Battery */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '48px',
        justifyContent: 'flex-end',
      }}>
        {/* Signal bars */}
        <svg width="14" height="10" viewBox="0 0 14 10" style={{ opacity: 0.6 }}>
          <rect x="0" y="7" width="2.5" height="3" rx="0.5" fill="var(--text)"/>
          <rect x="3.5" y="4" width="2.5" height="6" rx="0.5" fill="var(--text)"/>
          <rect x="7" y="2" width="2.5" height="8" rx="0.5" fill="var(--text)"/>
          <rect x="10.5" y="0" width="2.5" height="10" rx="0.5" fill="var(--text)"/>
        </svg>

        {/* Battery */}
        <div style={{
          width: '20px',
          height: '10px',
          borderRadius: '2px',
          border: '1px solid var(--text)',
          opacity: 0.6,
          padding: '1.5px',
          display: 'flex',
          alignItems: 'center',
        }}>
          <div style={{
            width: '100%',
            height: '100%',
            borderRadius: '0.5px',
            background: 'var(--text)',
            opacity: 0.8,
          }} />
        </div>
        <div style={{
          width: '2px',
          height: '3px',
          borderRadius: '0 1px 1px 0',
          border: '1px solid var(--text)',
          borderLeft: 'none',
          opacity: 0.6,
          marginLeft: '-6px',
        }} />
      </div>
    </div>
  )
}
