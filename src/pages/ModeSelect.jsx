export default function ModeSelect({ onSelectStory, onSelectDaily, onSelectDirect, onSettings }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
      padding: '32px 24px',
      gap: '24px',
    }}>
      <h1 style={{
        fontSize: '22px',
        fontWeight: 700,
        color: 'var(--text)',
        textAlign: 'center',
        margin: 0,
      }}>
        角色扮演对话
      </h1>
      <p style={{
        fontSize: '13px',
        color: 'var(--text3)',
        textAlign: 'center',
        margin: 0,
      }}>
        选择一个模式开始
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', maxWidth: '320px' }}>
        <button
          onClick={onSelectStory}
          className="press-scale"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '20px',
            borderRadius: '16px',
            border: 'none',
            borderLeft: '3px solid var(--coral)',
            background: 'var(--bg2)',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'transform 0.1s, box-shadow 0.2s',
          }}
        >
          <span style={{ fontSize: '32px' }}>📖</span>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)', margin: '0 0 4px 0' }}>剧情模式</h2>
            <p style={{ fontSize: '12px', color: 'var(--text3)', margin: 0 }}>
              沉浸式角色扮演，丰富的叙述描写与心理活动
            </p>
          </div>
        </button>

        <button
          onClick={onSelectDaily}
          className="press-scale"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '20px',
            borderRadius: '16px',
            border: 'none',
            borderLeft: '3px solid var(--teal)',
            background: 'var(--bg2)',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'transform 0.1s, box-shadow 0.2s',
          }}
        >
          <span style={{ fontSize: '32px' }}>💬</span>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)', margin: '0 0 4px 0' }}>日常模式</h2>
            <p style={{ fontSize: '12px', color: 'var(--text3)', margin: 0 }}>
              微信风格聊天，短气泡快速对话，像真人发消息
            </p>
          </div>
        </button>

        <button
          onClick={onSelectDirect}
          className="press-scale"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '20px',
            borderRadius: '16px',
            border: 'none',
            borderLeft: '3px solid var(--border)',
            background: 'var(--bg2)',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'transform 0.1s, box-shadow 0.2s',
          }}
        >
          <span style={{ fontSize: '32px' }}>🤖</span>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)', margin: '0 0 4px 0' }}>直接对话</h2>
            <p style={{ fontSize: '12px', color: 'var(--text3)', margin: 0 }}>
              无角色设定，直接与AI对话，简洁高效
            </p>
          </div>
        </button>
      </div>

      <button
        onClick={onSettings}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text3)',
          fontSize: '13px',
          cursor: 'pointer',
          padding: '8px',
        }}
      >
        ⚙️ 设置
      </button>
    </div>
  )
}
