import { useState } from 'react'
import ChatRoom from './ChatRoom'
import ArchiveList from './ArchiveList'
import { getRomanceCharacters } from '../persona/personaCore'
import { initBridge, getUIState, initBridgeForFolder, getFolderUIState } from '../state/stateBridge'
import { normalizeCharacter } from '../persona/personaCore'

/**
 * CharacterHome — Character space with tab bar navigation.
 * Props: character, onBack
 *
 * v6: When character._v6FolderId exists, uses folder-scoped USK and folder saves.
 */
export default function CharacterHome({ character, onBack }) {
  const [activeTab, setActiveTab] = useState('daily')
  const [archiveId, setArchiveId] = useState(null)
  const isV6Folder = !!character?._v6FolderId
  const folderId = character?._v6FolderId || null
  const folderChars = character?._v6FolderChars || []

  // Load affection from USK (folder or legacy)
  const [affection, setAffection] = useState(() => {
    try {
      if (isV6Folder && folderId) {
        // v6: folder-scoped USK — use name as key for persona compatibility
        const charsForUSK = folderChars.map(c => ({
          id: c.name,  // use name as USK key so persona lookups match
          name: c.name,
          affectionInitial: c.affectionInitial ?? 50,
        }))
        initBridgeForFolder(folderId, charsForUSK, 'daily')
        const mainChar = folderChars[0]
        if (mainChar) {
          const state = getFolderUIState(mainChar.id || mainChar.name)
          return state?.relationship?.affection ?? mainChar.affectionInitial ?? 50
        }
      } else {
        // Legacy: per-character USK
        const persona = normalizeCharacter(character, character?.chatStyle === 'story' ? 'story' : 'daily')
        const mainChar = persona?.characters?.find(c => c.type === 'romance')
        if (mainChar) {
          initBridge(persona, 'daily')
          const state = getUIState(mainChar.name)
          return state?.relationship?.affection ?? mainChar.affectionInitial ?? 50
        }
      }
    } catch { /* fall through */ }
    return 50
  })

  const mainName = (isV6Folder
    ? (folderChars[0]?.name || character?.name || '')
    : getRomanceCharacters(normalizeCharacter(character, character?.chatStyle === 'story' ? 'story' : 'daily'))?.[0]?.name || character?.name || ''
  )

  const tabs = [
    { key: 'daily', icon: '💬', label: '日常' },
    { key: 'drama', icon: '📖', label: '剧情' },
    { key: 'archive', icon: '📁', label: '存档' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* ── Top Character Bar ── */}
      <div style={{
        height: '56px', display: 'flex', alignItems: 'center',
        padding: '0 16px', gap: '12px',
        borderBottom: '0.5px solid var(--border2)',
        background: 'var(--bg)', flexShrink: 0,
      }}>
        <button onClick={onBack} style={{
          width: '32px', height: '32px', borderRadius: '50%',
          background: 'var(--bg2)', border: 'none', cursor: 'pointer',
          fontSize: '18px', color: 'var(--text2)',
        }}>←</button>

        <div style={{
          width: '36px', height: '36px', borderRadius: '50%',
          background: character?.avatar ? 'transparent' : 'var(--purple)',
          color: '#fff', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: '14px', fontWeight: 500,
          flexShrink: 0, overflow: 'hidden',
        }}>
          {character?.avatar ? <img src={character.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (character?.name || '?')[0]}
        </div>

        <span style={{ flex: 1, fontSize: '16px', fontWeight: 500, color: 'var(--text)' }}>
          {character?.name}
        </span>

        <span style={{ fontSize: '13px', color: 'var(--purple)', fontWeight: 500 }}>
          好感 {affection}
        </span>
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'archive' ? (
          <ArchiveList
            character={character}
            onBack={null}
            onChat={(id) => {
              setArchiveId(id)
              setActiveTab('daily')
            }}
            {...(isV6Folder ? { _v6FolderId: folderId } : {})}
          />
        ) : (
          <ChatRoom
            key={(character?.id || 'char') + '_' + activeTab}
            character={character}
            mode={activeTab}
            onAffectionChange={setAffection}
            archiveId={archiveId}
            onBack={null}
            {...(isV6Folder ? { _v6FolderId: folderId, _v6FolderChars: folderChars } : {})}
          />
        )}
      </div>

      {/* ── Bottom Tab Bar ── */}
      <div style={{
        height: '56px', display: 'flex',
        borderTop: '0.5px solid var(--border2)',
        background: 'var(--bg)', flexShrink: 0,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: '3px',
              background: 'none', border: 'none', cursor: 'pointer',
              color: activeTab === tab.key ? 'var(--purple)' : 'var(--text3)',
              transition: 'color 0.15s',
            }}
          >
            <span style={{ fontSize: '20px', lineHeight: 1 }}>{tab.icon}</span>
            <span style={{ fontSize: '11px', fontWeight: activeTab === tab.key ? 500 : 400 }}>
              {tab.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
