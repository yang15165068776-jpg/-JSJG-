import ProgressBar from './ProgressBar'

/**
 * StatusPanel — Right-side status panel for daily mode.
 * Shows affection, trust, life, and emotion summary for a character. (Tension removed in v4.)
 *
 * Props:
 *   characterName: string
 *   relationship: { affection, trust, dependency, respect, fear, possessiveness }
 *   emotion: { anger, sadness, jealousy, anxiety, curiosity, excitement }
 *   life: { mood, lonely, busy, tired }
 *   affectionFlash: number | null
 *   collapsed: boolean
 *   onToggle: () => void
 */
export default function StatusPanel({
  characterName = '',
  relationship = {},
  emotion = {},
  life = {},
  affectionFlash = null,
  collapsed = false,
  onToggle,
}) {
  if (collapsed) {
    return (
      <div style={{
        width: '36px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: '12px',
        borderLeft: '0.5px solid var(--border2)',
        background: 'var(--bg)',
      }}>
        <button
          onClick={onToggle}
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '6px',
            border: 'none',
            background: 'var(--bg2)',
            cursor: 'pointer',
            fontSize: '12px',
            color: 'var(--text3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ◀
        </button>
        <div style={{
          writingMode: 'vertical-rl',
          fontSize: '10px',
          color: 'var(--text3)',
          marginTop: '12px',
          letterSpacing: '2px',
        }}>
          {characterName}
        </div>
      </div>
    )
  }

  const emoSummary = [
    emotion.anger > 50 && '怒',
    emotion.sadness > 50 && '悲',
    emotion.jealousy > 50 && '妒',
    emotion.anxiety > 50 && '虑',
    emotion.curiosity > 50 && '奇',
    emotion.excitement > 50 && '奋',
  ].filter(Boolean).join(' ') || '平静'

  return (
    <div style={{
      width: '160px',
      flexShrink: 0,
      overflowY: 'auto',
      padding: '12px 10px',
      borderLeft: '0.5px solid var(--border2)',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
          {characterName}
        </span>
        <button
          onClick={onToggle}
          style={{
            width: '22px',
            height: '22px',
            borderRadius: '6px',
            border: 'none',
            background: 'var(--bg2)',
            cursor: 'pointer',
            fontSize: '10px',
            color: 'var(--text3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ▶
        </button>
      </div>

      {/* Section: Relationship */}
      <div>
        <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text3)', marginBottom: '6px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
          关系
        </div>
        <ProgressBar
          label="好感"
          value={relationship.affection ?? 50}
          color="var(--purple)"
          height={3}
          flash={affectionFlash}
        />
        <ProgressBar
          label="信任"
          value={relationship.trust ?? 30}
          color="var(--teal)"
          height={3}
        />
        <ProgressBar
          label="依赖"
          value={relationship.dependency ?? 30}
          color="var(--purple)"
          height={2}
        />
      </div>

      {/* Section: Life */}
      <div>
        <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text3)', marginBottom: '6px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
          状态
        </div>
        <ProgressBar
          label="心情"
          value={life.mood ?? 60}
          color="var(--teal)"
          height={3}
        />
        <ProgressBar
          label="忙碌"
          value={life.busy ?? 20}
          color="var(--text3)"
          height={2}
        />
        <ProgressBar
          label="孤独"
          value={life.lonely ?? 40}
          color="var(--purple)"
          height={2}
        />
      </div>

      {/* Emotion summary */}
      <div style={{
        padding: '8px',
        borderRadius: '8px',
        background: 'var(--bg3)',
        fontSize: '10px',
        color: 'var(--text2)',
        textAlign: 'center',
        lineHeight: 1.4,
      }}>
        <div style={{ color: 'var(--text3)', marginBottom: '2px' }}>情绪</div>
        <div style={{ fontWeight: 500 }}>{emoSummary}</div>
      </div>
    </div>
  )
}
