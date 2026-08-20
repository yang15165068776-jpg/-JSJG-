/**
 * ChatHeader — Top bar with character info, mode switch, and affection bar.
 * Props: persona, character, currentMode, onSwitchMode, affection, affections,
 *        onBack, archiveName, autoMessageEnabled, onToggleAutoMessage
 */
export default function ChatHeader({
  persona,
  character,
  currentMode,
  onSwitchMode,
  affection,
  affections,
  onBack,
  archiveName,
  autoMessageEnabled,
  onToggleAutoMessage,
}) {
  const mainChar = persona?.characters?.find(c => c.type === 'romance')
  const charName = mainChar?.name || character?.name || '角色'
  const charAvatar = mainChar?.avatar || character?.avatar || ''
  const affValue = affection ?? 50

  return (
    <div style={{ flexShrink: 0, background: 'var(--bg)', borderBottom: '1px solid var(--border2)' }}>
      {/* ── Header Row ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        gap: '10px',
        minHeight: '48px',
      }}>
        {/* Back button */}
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text2)',
            fontSize: '18px',
            cursor: 'pointer',
            padding: '4px',
            minWidth: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ←
        </button>

        {/* Avatar */}
        <div style={{
          width: '34px',
          height: '34px',
          borderRadius: '10px',
          background: charAvatar ? 'transparent' : 'var(--purple)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          overflow: 'hidden',
        }}>
          {charAvatar ? (
            <img src={charAvatar} alt={charName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ color: '#fff', fontSize: '14px', fontWeight: 600 }}>{charName[0]}</span>
          )}
        </div>

        {/* Name + Status */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', lineHeight: 1.2 }}>
            {charName}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '1px' }}>
            {currentMode === 'daily' ? '💬 日常聊天' : '📖 剧情模式'}
            {archiveName ? ' · ' + archiveName : ''}
          </div>
        </div>

        {/* Auto message toggle */}
        {currentMode === 'daily' && onToggleAutoMessage && (
          <button
            onClick={onToggleAutoMessage}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '16px',
              cursor: 'pointer',
              padding: '4px',
              opacity: autoMessageEnabled ? 1 : 0.4,
            }}
            title={autoMessageEnabled ? '自动消息：开' : '自动消息：关'}
          >
            {autoMessageEnabled ? '🔔' : '🔕'}
          </button>
        )}

        {/* Mode toggle capsule */}
        <div style={{
          display: 'flex',
          background: 'var(--bg3)',
          borderRadius: '16px',
          padding: '2px',
          gap: '1px',
        }}>
          <button
            onClick={() => currentMode !== 'drama' && onSwitchMode && onSwitchMode('drama')}
            style={{
              padding: '5px 10px',
              borderRadius: '14px',
              border: 'none',
              fontSize: '11px',
              fontWeight: currentMode === 'drama' ? 600 : 400,
              cursor: 'pointer',
              background: currentMode === 'drama' ? 'var(--bg)' : 'transparent',
              color: currentMode === 'drama' ? 'var(--text)' : 'var(--text3)',
              boxShadow: currentMode === 'drama' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.2s',
            }}
          >
            剧情
          </button>
          <button
            onClick={() => currentMode !== 'daily' && onSwitchMode && onSwitchMode('daily')}
            style={{
              padding: '5px 10px',
              borderRadius: '14px',
              border: 'none',
              fontSize: '11px',
              fontWeight: currentMode === 'daily' ? 600 : 400,
              cursor: 'pointer',
              background: currentMode === 'daily' ? 'var(--bg)' : 'transparent',
              color: currentMode === 'daily' ? 'var(--text)' : 'var(--text3)',
              boxShadow: currentMode === 'daily' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.2s',
            }}
          >
            日常
          </button>
        </div>
      </div>

      {/* ── Affection Bar ── */}
      {character?.affectionEnabled && (
        <div style={{
          padding: '4px 12px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span style={{ fontSize: '10px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>好感度</span>
          <div style={{
            flex: 1,
            height: '3px',
            borderRadius: '2px',
            background: 'var(--bg3)',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: Math.min(100, Math.max(0, affValue)) + '%',
              background: 'var(--purple)',
              borderRadius: '2px',
              transition: 'width 0.4s ease',
            }} />
          </div>
          <span style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--purple)',
            minWidth: '24px',
            textAlign: 'right',
          }}>
            {affValue}
          </span>
        </div>
      )}
    </div>
  )
}
