/**
 * ProgressBar — Thin progress bar for affection, tension, trust, etc.
 * Props:
 *   value: number (0-100)
 *   max: number (default 100)
 *   label: string (shown left)
 *   showValue: boolean (show "value/max" right)
 *   color: string (CSS var or hex — default 'var(--purple)')
 *   height: number (default 4)
 *   flash: number | null (positive = green flash, negative = red flash)
 */
export default function ProgressBar({
  value = 50,
  max = 100,
  label = '',
  showValue = false,
  color = 'var(--purple)',
  height = 4,
  flash = null,
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))

  const flashStyle = flash != null
    ? (flash > 0
      ? { animation: 'affectionFlashGreen 1.5s ease' }
      : { animation: 'affectionFlashRed 1.5s ease' })
    : {}

  return (
    <div style={{ marginBottom: '8px' }}>
      {(label || showValue) && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '4px',
        }}>
          <span style={{ fontSize: '11px', color: 'var(--text2)', fontWeight: 500 }}>
            {label}
          </span>
          {showValue && (
            <span style={{ fontSize: '11px', color: 'var(--text3)' }}>
              {value}/{max}
            </span>
          )}
        </div>
      )}
      <div style={{
        height: height + 'px',
        borderRadius: (height / 2) + 'px',
        background: 'var(--bg3)',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: pct + '%',
          borderRadius: (height / 2) + 'px',
          background: color,
          transition: 'width 0.5s ease',
          ...flashStyle,
        }} />
      </div>
      {/* Flash delta indicator */}
      {flash != null && flash !== 0 && (
        <div style={{
          fontSize: '10px',
          fontWeight: 600,
          color: flash > 0 ? 'var(--teal)' : 'var(--coral)',
          animation: 'floatUpFade 1.5s ease forwards',
          position: 'relative',
          textAlign: 'right',
          marginTop: '-2px',
        }}>
          {flash > 0 ? '+' : ''}{flash}
        </div>
      )}
    </div>
  )
}
