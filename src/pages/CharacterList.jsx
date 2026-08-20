import { useState, useEffect, useCallback } from 'react'
import {
  getCharacters,
  deleteCharacter,
  getArchives,
} from '../utils/storage'

export default function CharacterList({ mode, onCreate, onEdit, onArchives }) {
  const [characters, setCharacters] = useState([])
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => {
    setCharacters(getCharacters(mode))
  }, [])

  const refresh = useCallback(() => {
    setCharacters(getCharacters(mode))
  }, [])

  // Re-fetch when coming back from other pages
  useEffect(() => {
    const handleFocus = () => refresh()
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [refresh])

  // Refresh on visibility change (mobile)
  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', handleVisible)
    return () => document.removeEventListener('visibilitychange', handleVisible)
  }, [refresh])

  const handleDelete = (id, name) => {
    deleteCharacter(id, mode)
    setDeleteConfirm(null)
    refresh()
  }

  const getPreview = (character) => {
    const archives = getArchives(character.id, mode)
    if (archives.length === 0) return '暂无对话记录'
    let lastMsg = null
    let latestTime = 0
    for (const a of archives) {
      const msgs = a.messages
      if (msgs.length > 0) {
        const candidate = msgs[msgs.length - 1]
        if (a.createdAt > latestTime) {
          latestTime = a.createdAt
          lastMsg = candidate
        }
      }
    }
    if (!lastMsg) return '暂无对话记录'
    const text = lastMsg.role === 'assistant' ? lastMsg.content : '...'
    return text.slice(0, 60) + (text.length > 60 ? '...' : '')
  }

  return (
    <div className="p-4">
      {/* Create button */}
      <button
        onClick={() => { refresh(); onCreate() }}
        style={{
          width: '100%', padding: '13px', borderRadius: '14px',
          border: 'none', background: 'var(--purple)', color: '#fff',
          fontSize: '15px', fontWeight: 500, cursor: 'pointer',
          marginBottom: '16px',
        }}
      >
        + 创建新角色
      </button>

      {/* Character grid */}
      {characters.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text3)', fontSize: '14px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎭</div>
          <div>还没有角色</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>点击上方按钮创建你的第一个角色</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {characters.map(char => {
            const archives = getArchives(char.id)
            const msgCount = archives.reduce((sum, a) => sum + (a.messages?.length || 0), 0)
            return (
              <div
                key={char.id}
                style={{
                  background: 'var(--bg2)', borderRadius: '16px', padding: '16px',
                  border: '0.5px solid var(--border)', color: 'var(--text)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', margin: '0 0 2px 0' }}>{char.name}</h3>
                  {char.nickname && (
                    <p style={{ fontSize: '12px', color: 'var(--purple)', margin: '0 0 4px 0' }}>称呼你：{char.nickname}</p>
                  )}
                  <p style={{ fontSize: '12px', color: 'var(--text2)', margin: '8px 0 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {getPreview(char)}
                  </p>
                </div>

                {/* Meta tags */}
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                  {char.affectionEnabled && (
                    <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'var(--coral-l)', color: 'var(--coral)' }}>好感度</span>
                  )}
                  {char.thinkingEnabled && (
                    <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: '#3a2f0a', color: '#d4a017' }}>思考层</span>
                  )}
                  {char.activeMessageEnabled && (
                    <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'var(--teal-l)', color: 'var(--teal)' }}>主动消息</span>
                  )}
                  <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'var(--bg3)', color: 'var(--text3)' }}>{msgCount} 条消息</span>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                  <button onClick={() => onArchives(char)} style={{ flex: 1, padding: '9px', borderRadius: '10px', border: 'none', background: 'var(--purple)', color: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}>对话</button>
                  <button onClick={() => onEdit(char.id)} style={{ padding: '9px 12px', borderRadius: '10px', border: '0.5px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', fontSize: '13px', cursor: 'pointer' }}>编辑</button>
                  <button onClick={() => setDeleteConfirm(char.id)} style={{ padding: '9px 12px', borderRadius: '10px', border: '0.5px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', fontSize: '13px', cursor: 'pointer' }}>删除</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Delete confirm dialog */}
      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', padding: '16px' }}>
          <div style={{ background: 'var(--bg)', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '320px', border: '0.5px solid var(--border)' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)', margin: '0 0 8px 0' }}>确认删除</h3>
            <p style={{ fontSize: '13px', color: 'var(--text2)', margin: '0 0 20px 0' }}>删除后将同时清除该角色的所有对话记录，此操作不可撤销。</p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: 'none', background: 'var(--bg2)', color: 'var(--text)', fontSize: '14px', cursor: 'pointer' }}>取消</button>
              <button onClick={() => handleDelete(deleteConfirm)} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: 'none', background: 'var(--coral)', color: '#fff', fontSize: '14px', cursor: 'pointer' }}>确认删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
