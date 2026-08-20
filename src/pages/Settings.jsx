import { useState, useEffect, useRef } from 'react'
import {
  getApiKey, saveApiKey,
  getModel, saveModel,
  getAuditModel, saveAuditModel,
  getUserAvatar, saveUserAvatar,
  getCharacters,
} from '../utils/storage'
import { buildSystemPrompt } from '../utils/deepseek'

function imageToBase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const maxSize = 200
        let { width, height } = img
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height)
          width *= ratio
          height *= ratio
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.7))
      }
      img.onerror = () => resolve(reader.result)
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

export default function Settings({ onBack, showToast }) {
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  const [model, setModel] = useState('deepseek-v4-flash')
  const [modelList, setModelList] = useState([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelError, setModelError] = useState('')

  const [auditModel, setAuditModel] = useState('deepseek-v4-flash')

  const [userAvatar, setUserAvatar] = useState('')
  const avatarInputRef = useRef(null)

  useEffect(() => {
    setApiKey(getApiKey())
    setModel(getModel())
    setAuditModel(getAuditModel())
    setUserAvatar(getUserAvatar())
  }, [])

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const base64 = await imageToBase64(file)
    setUserAvatar(base64)
    saveUserAvatar(base64)
    setSaved(false)
  }

  const handleSave = () => {
    saveApiKey(apiKey.trim())
    saveModel(model)
    saveAuditModel(auditModel)
    setSaved(true)
    showToast && showToast('设置已保存', 'success')
    setTimeout(() => setSaved(false), 2000)
  }

  const handleFetchModels = async () => {
    const key = apiKey.trim()
    if (!key) {
      setModelError('请先填写 API Key')
      return
    }
    setLoadingModels(true)
    setModelError('')
    try {
      const res = await fetch('https://api.deepseek.com/models', {
        headers: { Authorization: 'Bearer ' + key },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error?.message || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const list = (data.data || []).map(m => m.id).sort()
      setModelList(list)
      // Preserve saved model: don't reset to first list item
      const saved = getModel()
      if (list.includes(saved)) {
        setModel(saved)
      } else if (list.length > 0) {
        setModel(list[0])
        saveModel(list[0])
      }
      if (list.length === 0) {
        setModelError('未获取到可用模型')
      }
    } catch (err) {
      setModelError(err.message)
    } finally {
      setLoadingModels(false)
    }
  }

  const handleModelChange = (value) => {
    setModel(value)
    saveModel(value)
    setSaved(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ height: '56px', display: 'flex', alignItems: 'center', padding: '0 16px', gap: '12px', borderBottom: '0.5px solid var(--border2)', flexShrink: 0 }}>
        <button onClick={onBack} style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', color: 'var(--text2)' }}>←</button>
        <span style={{ flex: 1, fontSize: '16px', fontWeight: 500, color: 'var(--text)' }}>设置</span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', paddingBottom: '100px' }}>
        {/* API Key */}
        <div style={{ fontSize: '12px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>API 设置</div>
        <div style={{ background: 'var(--bg2)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <label style={{ fontSize: '13px', color: 'var(--text2)', display: 'block', marginBottom: '6px' }}>DeepSeek API Key</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showKey ? 'text' : 'password'}
              style={{ width: '100%', padding: '10px 50px 10px 14px', borderRadius: '10px', border: '0.5px solid var(--border)', background: 'var(--bg)', fontSize: '14px', color: 'var(--text)', fontFamily: 'inherit', outline: 'none' }}
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setSaved(false) }}
              placeholder="sk-..."
            />
            <button type="button" onClick={() => setShowKey(!showKey)} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'var(--bg2)', border: 'none', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', color: 'var(--text2)', cursor: 'pointer' }}>
              {showKey ? '隐藏' : '显示'}
            </button>
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '8px' }}>API Key 仅保存在浏览器本地存储中</p>
        </div>

        {/* Model */}
        <div style={{ background: 'var(--bg2)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <label style={{ fontSize: '13px', color: 'var(--text2)', display: 'block', marginBottom: '6px' }}>模型选择</label>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <button onClick={handleFetchModels} disabled={loadingModels} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'var(--purple)', color: '#fff', fontSize: '13px', cursor: 'pointer', opacity: loadingModels ? 0.5 : 1 }}>
              {loadingModels ? '获取中...' : '获取模型列表'}
            </button>
          </div>
          {modelError && <p style={{ fontSize: '11px', color: 'var(--coral)', marginBottom: '8px' }}>{modelError}</p>}
          {modelList.length > 0 ? (
            <select value={model} onChange={e => handleModelChange(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '0.5px solid var(--border)', background: 'var(--bg)', fontSize: '14px', color: 'var(--text)', fontFamily: 'inherit', outline: 'none', appearance: 'none' }}>
              {modelList.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : !loadingModels ? (
            <input type="text" value={model} onChange={e => handleModelChange(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '0.5px solid var(--border)', background: 'var(--bg)', fontSize: '14px', color: 'var(--text)', fontFamily: 'inherit', outline: 'none' }} placeholder="deepseek-v4-flash" />
          ) : null}
        </div>

        {/* Audit Model — RQA/RCC 专用独立模型 */}
        <div style={{ background: 'var(--bg2)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <label style={{ fontSize: '13px', color: 'var(--text2)', display: 'block', marginBottom: '4px' }}>
            🔍 审计模型（RQA/RCC）
          </label>
          <p style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '8px' }}>
            独立于主生成模型。用于运行时质量审计（RQA）和角色宪法编译（RCC）。<br/>
            推荐使用快速模型（deepseek-v4-flash）以降低延迟和成本。
          </p>
          <input
            type="text"
            value={auditModel}
            onChange={e => setAuditModel(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '0.5px solid var(--border)', background: 'var(--bg)', fontSize: '14px', color: 'var(--text)', fontFamily: 'inherit', outline: 'none' }}
            placeholder="deepseek-v4-flash"
          />
        </div>

        {/* Avatar */}
        <div style={{ fontSize: '12px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', marginTop: '24px' }}>外观</div>
        <div style={{ background: 'var(--bg2)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <label style={{ fontSize: '13px', color: 'var(--text2)', display: 'block', marginBottom: '6px' }}>我的头像</label>
          <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
          <div onClick={() => avatarInputRef.current?.click()} style={{ width: '72px', height: '72px', borderRadius: '50%', border: '2px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer', background: 'var(--bg)' }}>
            {userAvatar ? <img src={userAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: '24px', color: 'var(--text3)' }}>+</span>}
          </div>
          {userAvatar && <button onClick={() => { setUserAvatar(''); saveUserAvatar('') }} style={{ marginTop: '8px', fontSize: '12px', color: 'var(--coral)', background: 'none', border: 'none', cursor: 'pointer' }}>移除头像</button>}
        </div>

        {/* Info sections */}
        <div style={{ fontSize: '12px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', marginTop: '24px' }}>帮助</div>
        <div style={{ background: 'var(--bg2)', borderRadius: '12px', padding: '16px', marginBottom: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)', marginBottom: '8px' }}>如何获取 API Key？</div>
          <ol style={{ fontSize: '12px', color: 'var(--text2)', margin: 0, paddingLeft: '18px' }}>
            <li>访问 platform.deepseek.com 并注册账号</li>
            <li>进入 API Keys 页面创建新的 Key</li>
            <li>复制 Key 并粘贴到上方输入框</li>
            <li>DeepSeek API 按使用量计费，价格低廉</li>
          </ol>
        </div>
        <div style={{ background: 'var(--bg2)', borderRadius: '12px', padding: '16px', marginBottom: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)', marginBottom: '8px' }}>数据说明</div>
          <ul style={{ fontSize: '12px', color: 'var(--text2)', margin: 0, paddingLeft: '16px' }}>
            <li>· 所有角色和对话数据存储在浏览器 localStorage 中</li>
            <li>· 清除浏览器数据会导致角色和对话丢失</li>
            <li>· 对话内容会发送至 DeepSeek 服务器以生成回复</li>
          </ul>
        </div>
        <div style={{ background: 'var(--bg2)', borderRadius: '12px', padding: '16px', marginBottom: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)', marginBottom: '8px' }}>System Prompt 预览</div>
          <button onClick={() => {
            const chars = [...getCharacters('story'), ...getCharacters('daily')]
            if (chars.length === 0) { alert('暂无角色数据'); return }
            const lines = ['=== System Prompt 字符数统计 ===\n']; let grandTotal = 0
            for (const { label, mode } of [{ label: '剧情模式', mode: 'story' }, { label: '日常模式', mode: 'daily' }]) {
              const modeChars = getCharacters(mode); if (modeChars.length === 0) continue
              lines.push('【' + label + '】')
              for (const char of modeChars) {
                const affData = char.chatStyle === 'story' && char.romanceCharacters ? Object.fromEntries(char.romanceCharacters.filter(rc => rc.affectionEnabled).map(rc => [rc.name, rc.affectionInitial ?? 50])) : char.affectionInitial ?? 50
                const prompt = buildSystemPrompt(char, affData); const len = prompt.length; const estTokens = Math.round(len / 2.5)
                lines.push('  ' + char.name + ': ' + len.toLocaleString() + ' 字符 ≈ ' + estTokens.toLocaleString() + ' tokens'); grandTotal += len
              }
            }
            lines.push('\n总计: ' + grandTotal.toLocaleString() + ' 字符'); lines.push('注：实际发送时只包含当前角色')
            alert(lines.join('\n'))
          }} style={{ width: '100%', padding: '10px', borderRadius: '10px', border: 'none', background: 'var(--purple)', color: '#fff', fontSize: '13px', cursor: 'pointer' }}>
            计算 System Prompt 大小
          </button>
        </div>
      </div>

      {/* Fixed bottom bar */}
      <div style={{ padding: '12px 16px', paddingBottom: 'max(20px, env(safe-area-inset-bottom, 20px))', borderTop: '0.5px solid var(--border2)', background: 'var(--bg)', display: 'flex', gap: '10px', flexShrink: 0 }}>
        <button onClick={onBack} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: 'var(--bg2)', color: 'var(--text)', fontSize: '15px', cursor: 'pointer' }}>返回</button>
        <button onClick={handleSave} style={{ flex: 2, padding: '12px', borderRadius: '12px', border: 'none', background: 'var(--purple)', color: '#fff', fontSize: '15px', fontWeight: 500, cursor: 'pointer' }}>{saved ? '已保存 ✓' : '保存设置'}</button>
      </div>
    </div>
  )
}
