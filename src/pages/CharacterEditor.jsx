import { useState, useEffect } from 'react'
import { getFolder, updateFolder } from '../state/folderStore'

const S = {
  page: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' },
  header: { display: 'flex', alignItems: 'center', padding: '0 12px', height: '48px', borderBottom: '0.5px solid var(--border)', flexShrink: 0, gap: '8px' },
  title: { flex: 1, fontSize: '15px', fontWeight: 600, color: 'var(--text)' },
  body: { flex: 1, overflowY: 'auto', padding: '14px' },
  label: { fontSize: '11px', fontWeight: 500, color: 'var(--text2)', marginBottom: '4px', display: 'block' },
  input: { width: '100%', padding: '10px 12px', borderRadius: '12px', border: '0.5px solid var(--border)', background: 'var(--bg)', fontSize: '13px', color: 'var(--text)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' },
  textarea: { width: '100%', padding: '12px', borderRadius: '12px', border: '0.5px solid var(--border)', background: 'var(--bg)', fontSize: '13px', color: 'var(--text)', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', lineHeight: 1.6 },
  hint: { fontSize: '10px', color: 'var(--text3)', lineHeight: 1.4, marginTop: '2px' },
  btn: { padding: '10px 16px', borderRadius: '10px', border: 'none', background: 'var(--text)', color: 'var(--bg)', fontSize: '13px', fontWeight: 500, cursor: 'pointer' },
  btn2: { padding: '10px 16px', borderRadius: '10px', border: '0.5px solid var(--border)', background: 'var(--bg)', color: 'var(--text2)', fontSize: '13px', cursor: 'pointer' },
}

function safeInt(val, fallback = 0) {
  if (val === '' || val === '-') return 0
  const n = parseInt(val, 10)
  return isNaN(n) ? fallback : n
}

export default function CharacterEditor({ folderId, charIndex, onBack }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [archetype, setArchetype] = useState('pursuer')
  const [affectionInitial, setAffectionInitial] = useState(0)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const folder = getFolder(folderId)
    if (!folder) return
    const data = (folder.characterData || [])[charIndex]
    if (data) {
      setName(data.name || '')
      setDescription(data.description || '')
      setArchetype(data.archetype || 'pursuer')
      setAffectionInitial(data.affectionInitial ?? 0)
    }
  }, [folderId, charIndex])

  const handleSave = () => {
    const folder = getFolder(folderId)
    if (!folder) return
    const chars = [...(folder.characterData || [])]
    chars[charIndex] = {
      ...chars[charIndex],
      name: name.trim(),
      description: description.trim(),
      archetype,
      affectionInitial,
      affectionStages: [{ name: '默认', min: 0, max: 100, description: '' }],
      updatedAt: Date.now(),
    }
    updateFolder(folderId, { characterData: chars })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <button onClick={onBack} style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', background: 'var(--bg2)', cursor: 'pointer', color: 'var(--text2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span style={S.title}>编辑角色 · {name || '未命名'}</span>
        <button style={{ ...S.btn, opacity: saved ? 0.6 : 1 }} onClick={handleSave}>{saved ? '✓ 已保存' : '保存'}</button>
      </div>

      <div style={S.body}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <div style={{ flex: 1 }}>
            <label style={S.label}>角色名</label>
            <input style={S.input} value={name} onChange={e => { setName(e.target.value); setSaved(false) }} placeholder="角色名字" />
          </div>
          <div style={{ width: '120px' }}>
            <label style={S.label}>人格类型</label>
            <select style={{ ...S.input, cursor: 'pointer' }} value={archetype} onChange={e => { setArchetype(e.target.value); setSaved(false) }}>
              <option value="pursuer">进攻型</option>
              <option value="confrontational">对抗型</option>
              <option value="aloof">高冷型</option>
              <option value="gentle">温柔型</option>
            </select>
          </div>
          <div style={{ width: '80px' }}>
            <label style={S.label}>初始好感</label>
            <input style={S.input} type="number" min={0} max={100} value={affectionInitial} onChange={e => { setAffectionInitial(safeInt(e.target.value, 0)); setSaved(false) }} />
          </div>
        </div>

        <div>
          <label style={S.label}>角色设定</label>
          <textarea
            style={{ ...S.textarea, minHeight: 'calc(100dvh - 260px)' }}
            value={description}
            onChange={e => { setDescription(e.target.value); setSaved(false) }}
            placeholder="角色的完整设定文本。AI 直接读这段文字。"
          />
          <div style={S.hint}>修改后保存，下一次对话生效。</div>
        </div>
      </div>
    </div>
  )
}
