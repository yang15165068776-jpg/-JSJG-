/**
 * DailyRenderer — WeChat-style chat bubble list.
 * Props: messages, persona
 */
export default function DailyRenderer({ messages, persona }) {
  const mainChar = persona?.characters?.find(c => c.type === 'romance')
  const charName = mainChar?.name || '角色'

  // Filter out system messages, only show user + assistant
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
        <div style={{ fontSize: '40px' }}>💬</div>
        <div>开始和{charName}聊天吧</div>
      </div>
    )
  }

  // Group consecutive same-role messages
  const groups = []
  let currentGroup = null

  for (const msg of visible) {
    if (!currentGroup || currentGroup.role !== msg.role) {
      currentGroup = { role: msg.role, messages: [msg] }
      groups.push(currentGroup)
    } else {
      currentGroup.messages.push(msg)
    }
  }

  // For assistant messages, extract segments into individual bubbles
  function getBubbles(msg) {
    if (msg.role === 'user') return [{ text: msg.content || '', id: msg.timestamp }]
    // Parse ||| separated segments
    const raw = msg.content || ''
    const segments = raw.split('|||').filter(Boolean).map(s => s.trim())
    if (segments.length === 0) return [{ text: raw, id: msg.timestamp }]
    return segments.map((text, i) => ({ text, id: msg.timestamp + '_' + i }))
  }

  let lastDate = null

  return (
    <div style={{ padding: '12px 12px 16px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {groups.map((group, gi) => {
        const isUser = group.role === 'user'
        const allBubbles = group.messages.flatMap(getBubbles)

        return (
          <div key={gi}>
            {allBubbles.map((bubble, bi) => {
              // Date separator
              const msgDate = new Date(group.messages[0]?.timestamp || Date.now()).toLocaleDateString('zh-CN')
              let showDate = false
              if (msgDate !== lastDate) {
                lastDate = msgDate
                showDate = true
              }

              const showAvatar = !isUser && (bi === 0)
              const isLastInGroup = bi === allBubbles.length - 1

              return (
                <div key={bubble.id}>
                  {showDate && bi === 0 && (
                    <div style={{
                      textAlign: 'center',
                      padding: '8px 0',
                      fontSize: '11px',
                      color: 'var(--text3)',
                    }}>
                      {msgDate}
                    </div>
                  )}

                  <div style={{
                    display: 'flex',
                    flexDirection: isUser ? 'row-reverse' : 'row',
                    alignItems: 'flex-end',
                    gap: '6px',
                    marginBottom: isLastInGroup ? '12px' : '2px',
                    animation: 'fadeInUp 0.3s ease-out',
                  }}>
                    {/* Avatar (assistant only, first bubble) */}
                    {!isUser && (
                      <div style={{
                        width: showAvatar ? '30px' : '30px',
                        height: showAvatar ? '30px' : '1px',
                        flexShrink: 0,
                        visibility: showAvatar ? 'visible' : 'hidden',
                      }}>
                        {showAvatar && (
                          <div style={{
                            width: '30px',
                            height: '30px',
                            borderRadius: '8px',
                            background: 'var(--purple)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}>
                            <span style={{ color: '#fff', fontSize: '13px', fontWeight: 600 }}>
                              {charName[0]}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Bubble */}
                    <div style={{
                      maxWidth: '75%',
                      padding: '10px 14px',
                      borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                      background: isUser ? 'var(--purple)' : 'var(--bg2)',
                      color: isUser ? '#fff' : 'var(--text)',
                      fontSize: '14px',
                      lineHeight: 1.5,
                      wordBreak: 'break-word',
                    }}>
                      {bubble.text}
                    </div>

                    {/* User avatar placeholder (spacing) */}
                    {isUser && (
                      <div style={{ width: '30px', flexShrink: 0, visibility: 'hidden' }} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
