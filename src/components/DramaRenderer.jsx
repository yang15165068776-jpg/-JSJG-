/**
 * DramaRenderer — Novel-style narrative display.
 * Props: messages, streamingText
 *
 * Renders action descriptions (italic, small) and dialogue (regular, large).
 * Parses content for 【Character】 headers and separates action vs speech.
 * streamingText: live token-by-token text during LLM generation.
 */
export default function DramaRenderer({ messages, streamingText }) {
  const visible = (messages || []).filter(m => m.role === 'user' || m.role === 'assistant')

  if (visible.length === 0) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--text3)',
        fontSize: '13px',
        gap: '8px',
        padding: '20px',
      }}>
        <div style={{ fontSize: '40px' }}>📖</div>
        <div>故事即将开始…</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {visible.map((msg, i) => {
        const isUser = msg.role === 'user'
        const content = msg.content || ''

        // Split by character headers: 【Name】
        const blocks = content.split(/(?=【)/g).filter(Boolean)

        if (blocks.length === 0) {
          return (
            <div key={i} style={{
              textAlign: isUser ? 'right' : 'left',
              fontSize: isUser ? '14px' : '15px',
              color: isUser ? 'var(--text2)' : 'var(--text)',
              lineHeight: 1.8,
            }}>
              {content}
            </div>
          )
        }

        return (
          <div key={i} style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}>
            {blocks.map((block, j) => {
              // Separate header from body
              const headerMatch = block.match(/^【(.+?)】\s*/)
              const header = headerMatch ? headerMatch[1] : null
              const body = headerMatch ? block.slice(headerMatch[0].length) : block

              // Parse body: split by newlines, classify action vs speech
              const lines = body.split('\n').filter(l => l.trim())

              return (
                <div key={j} style={{
                  animation: 'fadeIn 0.4s ease-out',
                  animationDelay: (j * 0.05) + 's',
                  opacity: 0,
                  animationFillMode: 'forwards',
                }}>
                  {/* Character header */}
                  {header && (
                    <div style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: 'var(--purple)',
                      marginBottom: '6px',
                    }}>
                      {header}
                    </div>
                  )}

                  {/* Content lines */}
                  {lines.map((line, k) => {
                    // Action: if line starts with （ or contains action cues
                    const isAction = line.startsWith('（') || line.startsWith('(') ||
                      /^(他|她|他们|她)[^说问道喊叫]/.test(line) ||
                      /^(默默|轻轻|缓缓|慢慢|突然|忽然|微微)/.test(line)

                    return (
                      <div key={k} style={{
                        fontSize: isAction ? '13px' : '15px',
                        fontStyle: isAction ? 'italic' : 'normal',
                        color: isAction ? 'var(--text3)' : 'var(--text)',
                        lineHeight: isAction ? 1.6 : 1.8,
                        marginBottom: '4px',
                      }}>
                        {line}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )
      })}

      {/* ── Streaming text (live token-by-token) ── */}
      {streamingText && (
        <div style={{
          animation: 'fadeIn 0.2s ease-out',
          fontSize: '15px',
          lineHeight: 1.8,
          color: 'var(--text)',
        }}>
          {streamingText}
          <span style={{
            display: 'inline-block',
            width: '2px',
            height: '15px',
            background: 'var(--purple)',
            marginLeft: '1px',
            verticalAlign: 'text-bottom',
            animation: 'blink 0.8s step-end infinite',
          }}>|</span>
        </div>
      )}
    </div>
  )
}
