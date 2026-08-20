import { useRef, useCallback } from 'react'

/**
 * ChatInput — Bottom input bar with auto-growing textarea and send button.
 * Props: value, onChange, onSend, disabled
 */
export default function ChatInput({ value, onChange, onSend, disabled }) {
  const textareaRef = useRef(null)

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() && !disabled) {
        onSend()
      }
    }
  }, [value, disabled, onSend])

  const handleInput = useCallback((e) => {
    onChange(e.target.value)
    // Auto-resize
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 100) + 'px'
  }, [onChange])

  return (
    <div style={{
      flexShrink: 0,
      padding: '8px 12px',
      paddingBottom: 'max(20px, env(safe-area-inset-bottom, 20px))',
      background: 'var(--bg)',
      borderTop: '1px solid var(--border2)',
      display: 'flex',
      alignItems: 'flex-end',
      gap: '8px',
    }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="输入消息…"
        disabled={disabled}
        rows={1}
        style={{
          flex: 1,
          resize: 'none',
          border: 'none',
          outline: 'none',
          background: 'var(--bg2)',
          borderRadius: '20px',
          padding: '10px 16px',
          fontSize: '14px',
          lineHeight: 1.4,
          color: 'var(--text)',
          fontFamily: 'inherit',
          minHeight: '38px',
          maxHeight: '100px',
          overflow: 'auto',
        }}
      />

      <button
        onClick={() => {
          if (value.trim() && !disabled) onSend()
        }}
        disabled={disabled || !value.trim()}
        style={{
          width: '38px',
          height: '38px',
          borderRadius: '19px',
          border: 'none',
          background: disabled || !value.trim() ? 'var(--bg3)' : 'var(--purple)',
          color: disabled || !value.trim() ? 'var(--text3)' : '#fff',
          fontSize: '18px',
          cursor: disabled || !value.trim() ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'background 0.2s',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </div>
  )
}
