import { useState, useEffect } from 'react'
import { getAllFolders, deleteFolder } from '../state/folderStore'
import { getActiveAccount, getActiveAccountId, getAllAccounts, setActiveAccount } from '../state/accountStore'

/**
 * Entry — Opening page. 2-column layout:
 *   Left (84px) : toolbar — player avatar (active account), world cards, account switcher
 *   Right(flex:1): main — large avatar (selected folder), create button
 *
 * Worlds are filtered by active account. Switching accounts = switching phones.
 */
export default function Entry({
  onEnterFolder,
  onCreateFolder,
  onProfile,
  onSettings,
  onLegacyList,
}) {
  const [folders, setFolders] = useState([])
  const [account, setAccount] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [selectedFolder, setSelectedFolder] = useState(null)
  const [showAccountPicker, setShowAccountPicker] = useState(false)

  const refresh = () => {
    const activeId = getActiveAccountId()
    const activeAcct = getActiveAccount()
    setAccount(activeAcct)
    setAccounts(getAllAccounts())

    const all = getAllFolders(activeId)
    setFolders(all)
    // Keep selection if folder still exists
    if (selectedFolder && !all.find(f => f.id === selectedFolder.id)) {
      setSelectedFolder(null)
    }
  }
  useEffect(() => { refresh() }, [])
  useEffect(() => {
    const h = () => refresh()
    window.addEventListener('focus', h)
    // Listen for custom account-changed event (fired by PlayerProfile)
    window.addEventListener('account-changed', h)
    return () => {
      window.removeEventListener('focus', h)
      window.removeEventListener('account-changed', h)
    }
  }, [])

  const handleSwitchAccount = (id) => {
    setActiveAccount(id)
    setShowAccountPicker(false)
    // Dispatch custom event so other components can react
    window.dispatchEvent(new CustomEvent('account-changed'))
    refresh()
  }

  // First folder avatar for center display
  const displayFolder = selectedFolder || (folders.length > 0 ? folders[0] : null)
  const firstChar = displayFolder?.characterData?.[0]
  const displayName = displayFolder?.name || (account?.name || '玩家')
  const displayAvatar = account?.avatar || firstChar?.avatar || ''

  return (
    <div style={{ display: 'flex', flexDirection: 'row', height: '100%', background: 'var(--bg)' }}>

      {/* ═══ LEFT — 84px toolbar ═══ */}
      <div style={{
        width: '84px', flexShrink: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', padding: '12px 6px', background: 'var(--bg2)',
        borderRight: '0.5px solid var(--border2)', height: '100%', overflowY: 'auto',
      }}>
        {/* Player avatar thumbnail — active account */}
        <div onClick={() => {
          if (accounts.length > 1) {
            setShowAccountPicker(v => !v)
          } else {
            onProfile()
          }
        }} style={{ cursor: 'pointer', marginBottom: '8px', position: 'relative' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '8px', overflow: 'hidden',
            background: 'var(--bg3)', border: account ? '2px solid var(--purple)' : '0.5px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {account?.avatar ? (
              <img src={account.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-7 8-7s8 3 8 7"/></svg>
            )}
          </div>
          {accounts.length > 1 && (
            <div style={{ position: 'absolute', bottom: '-2px', right: '-2px', width: '14px', height: '14px', borderRadius: '7px', background: 'var(--text)', color: 'var(--bg)', fontSize: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--bg2)' }}>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M8 7l4.5-4.5L17 7M8 17l4.5 4.5L17 17"/></svg>
            </div>
          )}
        </div>

        {/* Account name label */}
        {account && (
          <div style={{ fontSize: '10px', color: 'var(--text3)', marginBottom: '12px', textAlign: 'center', maxWidth: '72px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={account.name}>
            {account.name}
          </div>
        )}

        {/* Account picker dropdown */}
        {showAccountPicker && accounts.length > 1 && (
          <div style={{
            position: 'absolute', top: '56px', left: '4px', zIndex: 10,
            width: '76px', background: 'var(--bg)', borderRadius: '10px',
            border: '0.5px solid var(--border)', boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
            padding: '4px', display: 'flex', flexDirection: 'column', gap: '2px',
          }}>
            {accounts.map(a => (
              <button key={a.id}
                onClick={() => handleSwitchAccount(a.id)}
                style={{
                  padding: '6px 4px', borderRadius: '6px', border: 'none',
                  background: a.id === getActiveAccountId() ? 'var(--purple-l)' : 'transparent',
                  color: a.id === getActiveAccountId() ? 'var(--purple)' : 'var(--text2)',
                  fontSize: '10px', cursor: 'pointer', textAlign: 'center',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
                title={a.name}
              >{a.name}</button>
            ))}
            <button
              onClick={() => { setShowAccountPicker(false); onProfile() }}
              style={{
                padding: '4px', borderRadius: '4px', border: 'none',
                background: 'transparent', color: 'var(--text3)', fontSize: '9px',
                cursor: 'pointer', textAlign: 'center',
              }}
            >管理身份…</button>
          </div>
        )}

        {/* World card list (scrollable) — paddingTop gives the -6px delete button
            room to overhang the first card without being clipped by overflowY:auto */}
        <div style={{ flex: 1, overflowY: 'auto', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '6px' }}>
          {folders.length === 0 ? (
            <div style={{ fontSize: '20px', color: 'var(--text3)', marginTop: '8px' }}>🌍</div>
          ) : (
            folders.map((f) => {
              const isSelected = selectedFolder?.id === f.id
              return (
                <div key={f.id}
                  onClick={() => setSelectedFolder(f)}
                  style={{
                    width: '60px', minHeight: '44px', borderRadius: '10px',
                    background: isSelected ? 'var(--purple-l)' : 'var(--bg)',
                    border: isSelected ? '2px solid var(--purple)' : '2px solid transparent',
                    marginBottom: '10px', cursor: 'pointer', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '8px 6px', position: 'relative', transition: 'all 0.12s',
                  }}
                  title={f.name}
                >
                  <span style={{
                    fontSize: '12px', color: isSelected ? 'var(--purple)' : 'var(--text2)',
                    textAlign: 'center', lineHeight: '1.3', wordBreak: 'break-word',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                    {f.name}
                  </span>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      if (confirm(`确定删除世界"${f.name}"？\n（角色、存档、好感度等数据一并清除）`)) {
                        deleteFolder(f.id)
                        if (isSelected) setSelectedFolder(null)
                        setFolders(getAllFolders(getActiveAccountId()))
                      }
                    }}
                    style={{
                      position: 'absolute', top: '-6px', right: '-6px',
                      width: '24px', height: '24px', borderRadius: '50%',
                      border: '2px solid var(--bg)', background: 'var(--coral)', color: '#fff',
                      fontSize: '14px', fontWeight: 600, cursor: 'pointer', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      zIndex: 999,
                    }}
                    title="删除世界"
                  >×</button>
                </div>
              )
            })
          )}
        </div>

        {/* Bottom icons */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '8px' }}>
          <button onClick={onProfile} title="玩家身份" style={{
            width: '36px', height: '36px', borderRadius: '18px',
            border: '0.5px solid var(--border)', background: 'var(--bg)',
            cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: 'var(--text2)',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-7 8-7s8 3 8 7"/></svg>
          </button>
          <button onClick={onSettings} title="设置" style={{
            width: '36px', height: '36px', borderRadius: '18px',
            border: '0.5px solid var(--border)', background: 'var(--bg)',
            cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: 'var(--text2)',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
          </button>
        </div>
      </div>

      {/* ═══ RIGHT — flex:1: main display ═══ */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: '24px', padding: '24px',
      }}>
        {/* Large round avatar — shows selected folder character or player */}
        <div
          onClick={() => {
            if (displayFolder) onEnterFolder(displayFolder)
          }}
          style={{
            width: '96px', height: '96px', borderRadius: '48px', overflow: 'hidden',
            cursor: displayFolder ? 'pointer' : 'default',
            background: 'var(--bg3)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'transform 0.15s',
          }}
          onMouseEnter={e => { if (displayFolder) e.currentTarget.style.transform = 'scale(1.04)' }}
          onMouseLeave={e => { if (displayFolder) e.currentTarget.style.transform = 'scale(1)' }}
        >
          {displayAvatar ? (
            <img src={displayAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: '32px', color: 'var(--text3)' }}>
              {displayFolder ? (firstChar?.name?.[0] || displayFolder.name[0] || '?') : (
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1.2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-7 8-7s8 3 8 7"/></svg>
              )}
            </span>
          )}
        </div>

        {/* Name */}
        <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)', textAlign: 'center' }}>
          {displayName}
        </div>

        {/* Account subtitle — show current active identity */}
        {account && !displayFolder && (
          <div style={{ fontSize: '12px', color: 'var(--text3)', textAlign: 'center', maxWidth: '260px', lineHeight: 1.5 }}>
            {account.description
              ? account.description.slice(0, 80) + (account.description.length > 80 ? '…' : '')
              : '当前身份 · ' + (account.gender || '未设性别')}
          </div>
        )}

        {/* Subtitle — world info */}
        {displayFolder && (
          <div style={{ fontSize: '12px', color: 'var(--text3)', textAlign: 'center', maxWidth: '260px', lineHeight: 1.5 }}>
            <div style={{ marginTop: '4px' }}>{(displayFolder.characterData || []).length} 位角色 · {displayFolder.saveIds?.length || 0} 个存档</div>
          </div>
        )}

        {/* Create world button — purple pill */}
        <button onClick={onCreateFolder} style={{
          padding: '14px 40px', borderRadius: '24px', border: 'none',
          background: 'var(--purple)', color: '#fff', fontSize: '14px',
          fontWeight: 600, cursor: 'pointer', letterSpacing: '0.3px',
        }}>
          + 创建世界观故事
        </button>

        {/* Enter button — shown when a folder is selected */}
        {displayFolder && (
          <button onClick={() => onEnterFolder(displayFolder)} style={{
            padding: '10px 32px', borderRadius: '16px',
            border: '0.5px solid var(--border)', background: 'var(--bg)',
            color: 'var(--text2)', fontSize: '13px', cursor: 'pointer',
          }}>
            进入世界
          </button>
        )}
      </div>
    </div>
  )
}
