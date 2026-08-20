import { useState, useEffect, useRef } from 'react'
import { getFolder, getSaves, createSave, deleteSave, renameSave, getFolderCharacters, getSaveMessageCount } from '../state/folderStore'
import { getActiveAccount } from '../state/accountStore'
import { HydrationEngine } from '../engine/hydrationEngine'

export default function FolderInterior({ folderId, onBack, onEnterDrama, onEnterDaily, onEditCharacter }) {
  const [folder, setFolder] = useState(null)
  const [saves, setSaves] = useState([])
  const [chars, setChars] = useState([])
  const [profile, setProfile] = useState({ name: '', avatar: '' })
  const [fabOpen, setFabOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [selectedSave, setSelectedSave] = useState(null) // save picked for mode choice
  const longPressRef = useRef(null)

  const refresh = () => {
    const f = getFolder(folderId)
    setFolder(f)
    if (f) {
      setSaves(getSaves(f.id))
      setChars(getFolderCharacters(f.id))
    }
    const acct = getActiveAccount()
    setProfile(acct ? { name: acct.name, avatar: acct.avatar } : { name: '', avatar: '' })
  }
  useEffect(() => { refresh() }, [folderId])
  useEffect(() => {
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const handleNewSave = () => {
    const name = '存档 ' + (saves.length + 1)
    const save = createSave(folderId, name)
    if (save) { setFabOpen(false); refresh() }
  }

  const handleRenameSave = (saveId, currentName) => {
    const newName = prompt('新名称：', currentName)
    if (!newName) return
    renameSave(saveId, folderId, newName.trim())
    refresh()
  }

  const handleDeleteSave = (saveId) => {
    deleteSave(saveId, folderId)
    setDeleteTarget(null)
    setSelectedSave(null)
    refresh()
  }

  const handleTouchStart = (saveId) => {
    longPressRef.current = setTimeout(() => setDeleteTarget(saveId), 600)
  }
  const handleTouchEnd = () => { clearTimeout(longPressRef.current) }

  // Click save → show mode picker
  const handleSaveClick = (saveId) => {
    if (deleteTarget === saveId) return
    HydrationEngine.hydrate(folderId, saveId, 'all')
    setSelectedSave(saveId)
  }

  const handlePickDrama = () => {
    if (onEnterDrama) onEnterDrama(folder, selectedSave)
  }
  const handlePickDaily = () => {
    if (onEnterDaily) onEnterDaily(folder, selectedSave)
  }

  const formatDate = (ts) => {
    if (!ts) return ''
    const d = new Date(ts)
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  }

  if (!folder) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px', height: '48px' }}>
          <button onClick={onBack} style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', background: 'var(--bg2)', cursor: 'pointer', color: 'var(--text2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}>世界不存在</div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', position: 'relative' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', height: '48px', borderBottom: '0.5px solid var(--border2)', flexShrink: 0, gap: '8px' }}>
        <button onClick={onBack} style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', background: 'var(--bg2)', cursor: 'pointer', color: 'var(--text2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span style={{ flex: 1, fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>{folder.name}</span>
        {chars.length > 0 && onEditCharacter && (
          <button onClick={() => onEditCharacter(0)} style={{ padding: '5px 10px', borderRadius: '6px', border: '0.5px solid var(--border)', background: 'var(--bg)', color: 'var(--text2)', fontSize: '11px', cursor: 'pointer' }}>✎</button>
        )}
      </div>

      {/* ── Folder Info ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '12px 14px', padding: '14px', borderRadius: '14px', background: 'var(--bg2)', flexShrink: 0 }}>
        <div style={{ width: '40px', height: '40px', borderRadius: '20px', overflow: 'hidden', background: 'var(--bg)', border: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {profile.avatar ? <img src={profile.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text3)' }}><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-7 8-7s8 3 8 7"/></svg>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>{folder.name}</div>
          <div style={{ fontSize: '10px', color: 'var(--text3)' }}>{chars.length} 位角色 · {saves.length} 个存档</div>
        </div>
      </div>

      {/* ── Save Slots ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '8px', letterSpacing: '0.5px' }}>
          存档
        </div>
        {saves.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: '12px', padding: '48px 0', lineHeight: 1.8 }}>
            <div style={{ fontSize: '36px', marginBottom: '6px' }}>💾</div>还没有存档<br />点击右下角 + 创建
          </div>
        ) : (
          saves.map((s) => {
            const msgCount = getSaveMessageCount(s.id, folderId)
            const isPicked = selectedSave === s.id
            return (
              <div key={s.id}
                onTouchStart={() => handleTouchStart(s.id)}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchEnd}
                onClick={() => handleSaveClick(s.id)}
                style={{
                  padding: '12px 16px', borderRadius: '14px',
                  background: deleteTarget === s.id ? 'var(--coral-l)' : isPicked ? 'var(--purple-l)' : 'var(--bg2)',
                  marginBottom: '8px', cursor: 'pointer', transition: 'all 0.12s',
                  display: 'flex', alignItems: 'center', gap: '12px',
                }}
              >
                {deleteTarget === s.id ? (
                  <>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', color: 'var(--coral)', fontWeight: 500 }}>确认删除？</div>
                      <div style={{ fontSize: '10px', color: 'var(--text3)' }}>{s.name}</div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); handleDeleteSave(s.id) }} style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', background: 'var(--coral)', color: '#fff', fontSize: '11px', cursor: 'pointer' }}>删除</button>
                    <button onClick={e => { e.stopPropagation(); setDeleteTarget(null) }} style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', background: 'var(--bg2)', color: 'var(--text2)', fontSize: '11px', cursor: 'pointer' }}>取消</button>
                  </>
                ) : (
                  <>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 }}>💬</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>{s.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '1px' }}>{formatDate(s.createdAt)} · {msgCount} 条</div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); handleRenameSave(s.id, s.name) }} style={{ width: '24px', height: '24px', borderRadius: '6px', border: 'none', background: 'var(--bg3)', color: 'var(--text3)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✎</button>
                  </>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* ── Mode Picker (bottom sheet, shown when save selected) ── */}
      {selectedSave && (
        <div style={{
          borderTop: '0.5px solid var(--border)', background: 'var(--bg)',
          padding: '12px 14px', flexShrink: 0,
          animation: 'fadeInUp 0.25s ease-out',
        }}>
          <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text2)', marginBottom: '8px', textAlign: 'center' }}>
            选择模式进入
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handlePickDrama} style={{
              flex: 1, padding: '12px 0', borderRadius: '12px',
              border: '0.5px solid var(--border)', background: 'var(--bg)',
              color: 'var(--text)', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}>
              📖 剧情模式
            </button>
            <button onClick={handlePickDaily} style={{
              flex: 1, padding: '12px 0', borderRadius: '12px',
              border: '0.5px solid var(--border)', background: 'var(--bg)',
              color: 'var(--text)', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}>
              💬 日常模式
            </button>
          </div>
          <button onClick={() => setSelectedSave(null)} style={{
            width: '100%', padding: '8px', marginTop: '6px',
            border: 'none', background: 'transparent', color: 'var(--text3)',
            fontSize: '11px', cursor: 'pointer',
          }}>
            取消
          </button>
        </div>
      )}

      {/* ── FAB: New Save ── */}
      <div style={{ position: 'absolute', right: '16px', bottom: selectedSave ? '140px' : '20px', zIndex: 10 }}>
        {fabOpen && (
          <div style={{ position: 'absolute', bottom: '52px', right: '0' }}>
            <button onClick={handleNewSave} style={{
              padding: '8px 14px', borderRadius: '10px', border: '0.5px solid var(--border)',
              background: 'var(--bg)', color: 'var(--text2)', fontSize: '12px',
              cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            }}>
              + 新建存档
            </button>
          </div>
        )}
        <button onClick={() => setFabOpen(v => !v)} style={{
          width: '44px', height: '44px', borderRadius: '14px',
          border: '0.5px solid var(--border)',
          background: fabOpen ? 'var(--text)' : 'var(--bg)',
          color: fabOpen ? 'var(--bg)' : 'var(--text2)',
          fontSize: '18px', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          transition: 'all 0.15s',
        }}>
          {fabOpen ? '×' : '+'}
        </button>
      </div>
    </div>
  )
}
