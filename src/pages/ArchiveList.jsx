import { useState, useEffect, useCallback } from 'react'
import { getArchives, createArchive, deleteArchive, renameArchive } from '../utils/storage'
import { getSaves, createSave, deleteSave, renameSave } from '../state/folderStore'

function getPreview(messages) {
  if (!messages || messages.length === 0) return '暂无对话记录'
  const last = messages[messages.length - 1]
  const text = last.role === 'assistant' ? last.content : (messages.length > 1 ? messages[messages.length - 2]?.content : '')
  if (!text) return '暂无对话记录'
  return text.slice(0, 60) + (text.length > 60 ? '...' : '')
}

export default function ArchiveList({ mode, character, onBack, onChat, _v6FolderId }) {
  const [archives, setArchives] = useState([])
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [renameId, setRenameId] = useState(null)
  const [renameText, setRenameText] = useState('')
  const isV6Folder = !!_v6FolderId

  const refresh = useCallback(() => {
    if (isV6Folder && _v6FolderId) {
      // v6: use folder saves
      const saves = getSaves(_v6FolderId)
      setArchives(saves.map(s => ({
        id: s.id,
        name: s.name,
        messages: s.messages || [],
        createdAt: s.createdAt,
      })))
    } else {
      setArchives(getArchives(character.id, mode))
    }
  }, [character.id, mode, isV6Folder, _v6FolderId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleCreate = () => {
    if (isV6Folder && _v6FolderId) {
      const name = '存档 ' + new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      const save = createSave(_v6FolderId, name)
      if (save) onChat(save.id)
    } else {
      const name = '新对话 ' + new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      const archive = createArchive(character.id, name, mode)
      onChat(archive.id)
    }
  }

  const handleDelete = (id) => {
    if (isV6Folder && _v6FolderId) {
      deleteSave(id, _v6FolderId)
    } else {
      deleteArchive(id, mode)
    }
    setDeleteConfirm(null)
    if (renameId === id) {
      setRenameId(null)
      setRenameText('')
    }
    refresh()
  }

  const handleRenameStart = (archive) => {
    setRenameId(archive.id)
    setRenameText(archive.name)
  }

  const handleRenameConfirm = (id) => {
    const trimmed = renameText.trim()
    if (trimmed) {
      if (isV6Folder && _v6FolderId) {
        renameSave(id, _v6FolderId, trimmed)
      } else {
        renameArchive(id, trimmed, mode)
      }
    }
    setRenameId(null)
    setRenameText('')
    refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Header — only in standalone mode */}
      {onBack && (
        <div style={{ height: '56px', display: 'flex', alignItems: 'center', padding: '0 16px', gap: '12px', borderBottom: '0.5px solid var(--border2)', flexShrink: 0 }}>
          <button onClick={onBack} style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', color: 'var(--text2)' }}>←</button>
          <span style={{ flex: 1, fontSize: '16px', fontWeight: 500, color: 'var(--text)' }}>{character?.name || ''} 的对话</span>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        <button onClick={handleCreate} style={{ width: '100%', padding: '14px', borderRadius: '14px', border: 'none', background: 'var(--purple)', color: '#fff', fontSize: '15px', fontWeight: 500, cursor: 'pointer', marginBottom: '16px' }}>
          + 新建对话
        </button>

        {archives.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text3)', fontSize: '14px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>💬</div>
            <div>还没有对话存档</div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>点击上方按钮开始与 {character?.name} 对话</div>
          </div>
        ) : (
          archives.map(archive => {
            const msgCount = archive.messages?.filter(m => m.role !== 'system')?.length || 0
            const isRenaming = renameId === archive.id
            const avatarChar = (character?.name || '?')[0]
            const dateStr = new Date(archive.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

            return (
              <div key={archive.id} style={{ padding: '14px 16px', borderRadius: '12px', background: 'var(--bg2)', border: '0.5px solid var(--border2)', marginBottom: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px' }} onClick={() => { if (!isRenaming) onChat(archive.id) }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: character?.avatar ? 'transparent' : 'var(--purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', color: '#fff', fontWeight: 500, flexShrink: 0, overflow: 'hidden' }}>
                  {character?.avatar ? <img src={character.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : avatarChar}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isRenaming ? (
                    <input
                      style={{ width: '100%', padding: '6px 10px', borderRadius: '8px', border: '0.5px solid var(--purple)', background: 'var(--bg)', fontSize: '14px', color: 'var(--text)', fontFamily: 'inherit', outline: 'none' }}
                      value={renameText}
                      onChange={e => setRenameText(e.target.value)}
                      onBlur={() => handleRenameConfirm(archive.id)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRenameConfirm(archive.id); if (e.key === 'Escape') { setRenameId(null); setRenameText('') } }}
                      autoFocus
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text)', marginBottom: '3px' }}>{archive.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{getPreview(archive.messages)}</div>
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
                  <span style={{ fontSize: '11px', color: 'var(--text3)' }}>{dateStr} · {msgCount}条</span>
                  {!isRenaming && (
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button onClick={e => { e.stopPropagation(); handleRenameStart(archive) }} style={{ fontSize: '11px', color: 'var(--text2)', background: 'none', border: 'none', cursor: 'pointer' }}>重命名</button>
                      <button onClick={e => { e.stopPropagation(); setDeleteConfirm(archive.id) }} style={{ fontSize: '11px', color: 'var(--coral)', background: 'none', border: 'none', cursor: 'pointer' }}>删除</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Delete confirm dialog */}
      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', padding: '16px' }} onClick={() => setDeleteConfirm(null)}>
          <div style={{ background: 'var(--bg)', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '320px', border: '0.5px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>确认删除</div>
            <div style={{ fontSize: '13px', color: 'var(--text2)', marginBottom: '20px' }}>删除后将清除该存档的所有对话记录，此操作不可撤销。</div>
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
