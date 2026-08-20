import { useState, useEffect } from 'react'
import {
  getAllAccounts,
  getActiveAccount,
  getActiveAccountId,
  setActiveAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  deleteAccountFolders,
} from '../state/accountStore'

const GENDER_OPTIONS = ['男', '女', '其他']
const PRESET_TAGS = ['开朗', '内向', '温柔', '强势', '理性', '感性', '慢热', '直率', '腹黑', '天然']

export default function PlayerProfile({ onBack, onAccountsChanged }) {
  const [accounts, setAccounts] = useState([])
  const [activeId, setActiveId] = useState('')
  const [editingId, setEditingId] = useState('')   // which account is being edited
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState('')
  const [gender, setGender] = useState('')
  const [tags, setTags] = useState([])
  const [description, setDescription] = useState('')
  const [customTag, setCustomTag] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    refresh()
  }, [])

  const refresh = () => {
    const all = getAllAccounts()
    setAccounts(all)
    const active = getActiveAccountId()
    setActiveId(active)
    // Auto-select editing target
    if (editingId) {
      const target = all.find(a => a.id === editingId)
      if (target) loadAccount(target)
      else {
        // editing account was deleted
        const fallback = all.find(a => a.id === active) || all[0]
        if (fallback) { setEditingId(fallback.id); loadAccount(fallback) }
        else resetForm()
      }
    } else if (active) {
      const target = all.find(a => a.id === active) || all[0]
      if (target) { setEditingId(target.id); loadAccount(target) }
    } else if (all.length > 0) {
      setEditingId(all[0].id); loadAccount(all[0])
    }
  }

  const loadAccount = (a) => {
    setEditingId(a.id)
    setName(a.name || '')
    setAvatar(a.avatar || '')
    setGender(a.gender || '')
    setTags(a.personalityTags || [])
    setDescription(a.description || '')
  }

  const resetForm = () => {
    setEditingId('')
    setName('')
    setAvatar('')
    setGender('')
    setTags([])
    setDescription('')
  }

  const handleSave = () => {
    if (!editingId) return
    updateAccount(editingId, { name, avatar, gender, personalityTags: tags, description })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    refresh()
    if (onAccountsChanged) onAccountsChanged()
  }

  const handleNew = () => {
    const acc = createAccount({ name: '新玩家', avatar: '', gender: '', personalityTags: [], description: '' })
    refresh()
    loadAccount(acc)
    if (onAccountsChanged) onAccountsChanged()
  }

  const handleSwitch = (id) => {
    setActiveAccount(id)
    setActiveId(id)
    const target = accounts.find(a => a.id === id)
    if (target) loadAccount(target)
    if (onAccountsChanged) onAccountsChanged()
  }

  const handleDelete = (id) => {
    const acc = accounts.find(a => a.id === id)
    if (!acc) return
    if (!confirm(`确定删除玩家身份"${acc.name}"？\n\n该身份下的所有世界也会被删除。此操作不可撤销。`)) return
    deleteAccountFolders(id)
    deleteAccount(id)
    refresh()
    // After deleting, select first remaining or reset
    const remaining = getAllAccounts()
    if (remaining.length > 0) {
      const next = remaining[0]
      setActiveId(next.id)
      setEditingId(next.id)
      loadAccount(next)
    } else {
      resetForm()
      setActiveId('')
    }
    if (onAccountsChanged) onAccountsChanged()
  }

  const toggleTag = (t) => setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  const addCustomTag = () => { const t = customTag.trim(); if (t && !tags.includes(t)) { setTags(prev => [...prev, t]); setCustomTag('') } }
  const handleCustomKey = (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCustomTag() } }
  const handleAvatarClick = () => { const url = prompt('请输入头像图片链接（URL）：', avatar); if (url !== null) setAvatar(url.trim()) }

  const input = { width: '100%', padding: '10px 14px', borderRadius: '12px', border: '0.5px solid var(--border)', background: 'var(--bg2)', fontSize: '14px', color: 'var(--text)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }
  const textarea = { ...input, resize: 'vertical', minHeight: '80px' }

  const isActive = editingId === activeId

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px', height: '48px', borderBottom: '0.5px solid var(--border2)', flexShrink: 0 }}>
        <button onClick={onBack} style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', background: 'var(--bg2)', cursor: 'pointer', color: 'var(--text2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span style={{ flex: 1, textAlign: 'center', fontSize: '16px', fontWeight: 600, color: 'var(--text)', marginRight: '32px' }}>玩家身份</span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 24px' }}>

        {/* ── Account switcher tabs ──
             No overflowX:auto — flexWrap already wraps long names, and overflow
             would clip the -5px delete button on first-row tabs. */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
          {accounts.map(a => {
            const sel = editingId === a.id
            const act = a.id === activeId
            return (
              <div key={a.id} style={{ position: 'relative' }}>
                <button
                  onClick={() => { loadAccount(a); if (!act) handleSwitch(a.id) }}
                  style={{
                    padding: '8px 14px', borderRadius: '20px', border: sel ? '1.5px solid var(--purple)' : '0.5px solid var(--border)',
                    background: sel ? 'var(--purple-l)' : 'var(--bg2)', color: sel ? 'var(--purple)' : 'var(--text2)',
                    fontSize: '13px', fontWeight: sel ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  {a.name}
                  {act && <span style={{ marginLeft: '4px', fontSize: '10px', color: 'var(--teal)' }}>●</span>}
                </button>
                {accounts.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(a.id) }}
                    style={{ position: 'absolute', top: '-5px', right: '-5px', width: '16px', height: '16px', borderRadius: '50%', border: 'none', background: 'var(--coral)', color: '#fff', fontSize: '9px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}
                    title="删除此身份"
                  >×</button>
                )}
              </div>
            )
          })}
          <button onClick={handleNew} style={{
            width: '36px', height: '36px', borderRadius: '18px', border: '1px dashed var(--border)',
            background: 'var(--bg)', color: 'var(--text3)', fontSize: '18px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }} title="创建新身份">+</button>
        </div>

        {/* ── Active indicator ── */}
        {editingId && !isActive && (
          <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '16px', textAlign: 'center' }}>
            当前查看：{name}（非活跃身份，点击上方标签切换为活跃）
          </div>
        )}
        {isActive && editingId && (
          <div style={{ fontSize: '12px', color: 'var(--teal)', marginBottom: '16px', textAlign: 'center' }}>
            ● 当前活跃身份 — 世界和角色使用此身份
          </div>
        )}

        {!editingId ? (
          <div style={{ textAlign: 'center', color: 'var(--text3)', marginTop: '60px' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>👤</div>
            <div style={{ fontSize: '14px' }}>还没有玩家身份</div>
            <button onClick={handleNew} style={{ marginTop: '16px', padding: '10px 32px', borderRadius: '20px', border: 'none', background: 'var(--purple)', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>+ 创建玩家身份</button>
          </div>
        ) : (
          <>
            {/* Avatar + gender */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '24px', position: 'relative' }}>
              <div onClick={handleAvatarClick} style={{ width: '80px', height: '80px', borderRadius: '40px', overflow: 'hidden', cursor: 'pointer', background: 'var(--bg3)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {avatar ? (
                  <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-7 8-7s8 3 8 7"/></svg>
                )}
              </div>
              <div style={{ position: 'absolute', top: 0, right: 'calc(50% - 60px)', display: 'flex', gap: '4px' }}>
                {GENDER_OPTIONS.map(g => (
                  <button key={g} onClick={() => setGender(g)} style={{ width: '24px', height: '24px', borderRadius: '6px', border: gender === g ? '1.5px solid var(--purple)' : '0.5px solid var(--border)', background: gender === g ? 'var(--purple-l)' : 'var(--bg)', color: gender === g ? 'var(--purple)' : 'var(--text3)', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{g}</button>
                ))}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '8px', cursor: 'pointer' }} onClick={handleAvatarClick}>点击更换头像</div>
            </div>

            {/* Name */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '8px' }}>名字</div>
              <input style={input} value={name} onChange={e => setName(e.target.value)} placeholder="你的名字（角色会用这个名字称呼你）" />
            </div>

            {/* Description — 玩家设定 */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '8px' }}>设定</div>
              <textarea
                style={textarea}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={'你的设定。角色会了解这些信息，并据此与你互动。\n\n例如：\n· 你的身份、职业、背景\n· 你的外貌、年龄\n· 你的性格、习惯\n· 你和角色的关系\n\n这个设定会发送给 AI，让角色认识你。'}
              />
              <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '4px' }}>切换身份 = 换一部手机。每个身份有独立的世界和角色。</div>
            </div>

            {/* Personality tags */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', marginBottom: '8px' }}>性格标签</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {PRESET_TAGS.map(t => (
                  <button key={t} onClick={() => toggleTag(t)} style={{ padding: '6px 14px', borderRadius: '16px', border: '0.5px solid var(--border)', fontSize: '12px', cursor: 'pointer', background: tags.includes(t) ? 'var(--text)' : 'var(--bg)', color: tags.includes(t) ? 'var(--bg)' : 'var(--text2)' }}>{t}</button>
                ))}
                <input style={{ padding: '6px 14px', borderRadius: '16px', border: '0.5px dashed var(--border)', background: 'var(--bg)', fontSize: '12px', color: 'var(--text)', outline: 'none', width: '80px' }} value={customTag} onChange={e => setCustomTag(e.target.value)} onKeyDown={handleCustomKey} onBlur={addCustomTag} placeholder="+ 自定义" />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Bottom — flex:none + safe-area bottom padding so the bar sits flush
          above the home indicator on iPhones with a notch */}
      {editingId && (
        <div style={{ padding: '16px 24px', paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))', flexShrink: 0, display: 'flex', gap: '10px' }}>
          <button onClick={onBack} style={{ flex: 1, padding: '14px', borderRadius: '14px', border: '0.5px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', fontSize: '15px', fontWeight: 500, cursor: 'pointer' }}>返回</button>
          <button onClick={handleSave} style={{ flex: 1, padding: '14px', borderRadius: '14px', border: 'none', background: 'var(--purple)', color: '#fff', fontSize: '15px', fontWeight: 600, cursor: 'pointer' }}>{saved ? '✓ 已保存' : '保存'}</button>
        </div>
      )}
    </div>
  )
}
