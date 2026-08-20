import { useState, useEffect, useRef } from 'react'
import { getCharacter, saveCharacter, generateId, getApiKey } from '../utils/storage'
import { generateAutonomySummary, generateThinkingPrompt, extractCharacterFromText } from '../utils/deepseek'

const emptyStage = () => ({ name: '', min: 0, max: 50, behavior: '' })
const emptySubCharacter = () => ({ name: '', personality: '', avatar: '', relationship: '', speakingStyle: '' })

function parseLines(text) {
  return text.split('\n').map(s => s.trim()).filter(Boolean)
}

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

export default function CharacterForm({ mode, characterId, onSave, onCancel }) {
  const isEdit = !!characterId
  const avatarInputRef = useRef(null)
  const [generatingAutonomy, setGeneratingAutonomy] = useState(false)
  const [generatingThinking, setGeneratingThinking] = useState(false)
  const [showExtractModal, setShowExtractModal] = useState(false)
  const [extractText, setExtractText] = useState('')
  const [extracting, setExtracting] = useState(false)

  const [form, setForm] = useState({
    id: '',
    name: '',
    avatar: '',
    protagonistName: '',
    protagonistGender: '',
    protagonistBackground: '',
    protagonistPersonality: '',
    background: '',
    nickname: '',
    styleRules: '',
    forbiddenWords: '',
    affectionEnabled: false,
    affectionInitial: 50,
    affectionStages: [emptyStage()],
    affectionUpRules: '',
    affectionDownRules: '',
    thinkingEnabled: false,
    thinkingPrompt: '',
    activeMessageEnabled: false,
    activePrompt: '',
    autonomyBehavior: '',
    openingScenario: '',
    chatStyle: mode === 'daily' ? 'casual' : 'story',
    contextWindow: 40,
    showTimestamp: false,
    autoMessageEnabled: false,
    autoMessagePrompt: '',
    temperature: 0.9,
    topP: 0.95,
    characters: mode === 'story' ? [] : undefined,
    showAdvanced: false,
  })

  useEffect(() => {
    if (characterId) {
      const char = getCharacter(characterId, mode)
      if (char) {
        setForm({
          id: char.id,
          name: char.name || '',
          avatar: char.avatar || '',
          protagonistName: char.protagonistName || '',
          protagonistGender: char.protagonistGender || '',
          protagonistBackground: char.protagonistBackground || '',
          protagonistPersonality: char.protagonistPersonality || '',
          background: char.background || '',
          nickname: char.nickname || '',
          styleRules: (char.styleRules || []).join('\n'),
          forbiddenWords: (char.forbiddenWords || []).join('\n'),
          affectionEnabled: char.affectionEnabled || false,
          affectionInitial: char.affectionInitial ?? 50,
          affectionStages: char.affectionStages?.length > 0
            ? char.affectionStages.map(s => ({ ...emptyStage(), ...s }))
            : [emptyStage()],
          affectionUpRules: char.affectionUpRules || '',
          affectionDownRules: char.affectionDownRules || '',
          thinkingEnabled: char.thinkingEnabled || false,
          thinkingPrompt: char.thinkingPrompt || '',
          activeMessageEnabled: char.activeMessageEnabled || false,
          activePrompt: char.activePrompt || '',
          autonomyBehavior: char.autonomyBehavior || '',
          openingScenario: char.openingScenario || '',
          chatStyle: char.chatStyle || (mode === 'daily' ? 'casual' : 'story'),
          contextWindow: char.contextWindow || 40,
          showTimestamp: char.showTimestamp || false,
          autoMessageEnabled: char.autoMessageEnabled || false,
          autoMessagePrompt: char.autoMessagePrompt || '',
          temperature: char.temperature ?? 0.9,
          topP: char.topP ?? 0.95,
          characters: char.characters?.length > 0
            ? char.characters.map(c => ({ ...emptySubCharacter(), ...c }))
            : (mode === 'story' ? [] : undefined),
        })
      }
    }
  }, [characterId])

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const base64 = await imageToBase64(file)
    update('avatar', base64)
  }

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }))

  const updateStage = (index, field, value) => {
    const stages = [...form.affectionStages]
    stages[index] = { ...stages[index], [field]: value }
    setForm(prev => ({ ...prev, affectionStages: stages }))
  }

  const addStage = () => {
    setForm(prev => ({ ...prev, affectionStages: [...prev.affectionStages, emptyStage()] }))
  }

  const removeStage = (index) => {
    if (form.affectionStages.length <= 1) return
    setForm(prev => ({
      ...prev,
      affectionStages: prev.affectionStages.filter((_, i) => i !== index),
    }))
  }

  const updateSubChar = (index, field, value) => {
    const chars = [...(form.characters || [])]
    chars[index] = { ...chars[index], [field]: value }
    setForm(prev => ({ ...prev, characters: chars }))
  }

  const addSubChar = () => {
    setForm(prev => ({ ...prev, characters: [...(prev.characters || []), emptySubCharacter()] }))
  }

  const removeSubChar = (index) => {
    setForm(prev => ({
      ...prev,
      characters: prev.characters.filter((_, i) => i !== index),
    }))
  }

  const handleSubCharAvatar = async (index, file) => {
    if (!file) return
    const base64 = await imageToBase64(file)
    updateSubChar(index, 'avatar', base64)
  }

  const handleGenerateAutonomy = async () => {
    const apiKey = getApiKey()
    if (!apiKey) {
      alert('请先在设置页面填写 DeepSeek API Key')
      return
    }
    if (!form.background.trim()) {
      alert('请先填写角色基本设定（至少填写背景）')
      return
    }
    setGeneratingAutonomy(true)
    const { reply, error } = await generateAutonomySummary({
      name: form.name,
      background: form.background,
      styleRules: form.styleRules,
      thinkingPrompt: form.thinkingPrompt,
    }, apiKey)
    setGeneratingAutonomy(false)
    if (error || !reply) {
      alert('生成失败：' + (error?.message || '未知错误'))
      return
    }
    update('autonomyBehavior', reply)
  }

  const handleGenerateThinking = async () => {
    const apiKey = getApiKey()
    if (!apiKey) {
      alert('请先在设置页面填写 DeepSeek API Key')
      return
    }
    if (!form.background.trim() && !form.name.trim()) {
      alert('请先填写角色名或背景设定')
      return
    }
    setGeneratingThinking(true)
    const { reply, error } = await generateThinkingPrompt({
      name: form.name,
      background: form.background,
      styleRules: form.styleRules,
      nickname: form.nickname,
      autonomyBehavior: form.autonomyBehavior,
    }, apiKey)
    setGeneratingThinking(false)
    if (error || !reply) {
      alert('生成失败：' + (error?.message || '未知错误'))
      return
    }
    update('thinkingPrompt', reply)
  }

  const handleExtract = async () => {
    const apiKey = getApiKey()
    if (!apiKey) {
      alert('请先在设置页面填写 DeepSeek API Key')
      return
    }
    if (!extractText.trim()) {
      alert('请先粘贴人设文本')
      return
    }
    setExtracting(true)
    const { result, error } = await extractCharacterFromText(extractText, apiKey)
    setExtracting(false)
    if (error || !result) {
      alert('提取失败：' + (error?.message || '解析错误，请检查文本内容'))
      return
    }

    try {
      const r = result
      console.log('[handleExtract] AI返回数据:', JSON.stringify(r, null, 2))

      // Basic fields
      if (r.name) update('name', r.name)
      if (r.background) update('background', r.background)
      if (r.userTitle) update('nickname', r.userTitle)

      // Style rules
      if (Array.isArray(r.styleRules) && r.styleRules.length > 0) {
        update('styleRules', r.styleRules.join('\n'))
      }

      // Forbidden behaviors
      if (Array.isArray(r.forbiddenBehaviors) && r.forbiddenBehaviors.length > 0) {
        update('forbiddenWords', r.forbiddenBehaviors.join('\n'))
      }

      // Opening scene
      if (r.openingScene) update('openingScenario', r.openingScene)

      // Thinking
      if (r.thinkingEnabled) update('thinkingEnabled', true)
      if (r.thinkingPrompt) update('thinkingPrompt', r.thinkingPrompt)

      // Affection
      if (r.affectionEnabled) {
        update('affectionEnabled', true)
        const affInit = Number(r.affectionInitial)
        if (!isNaN(affInit) && affInit >= 0 && affInit <= 100) {
          update('affectionInitial', affInit)
        }
        // Affection stages — handle expanded format
        if (Array.isArray(r.affectionStages) && r.affectionStages.length > 0) {
          const mappedStages = r.affectionStages.map(s => {
            // Build behavior from rich fields
            const behaviorParts = []
            if (s.coreState) behaviorParts.push('【状态】' + s.coreState)
            if (s.playerStrategy) behaviorParts.push('【策略】' + s.playerStrategy)
            if (s.riseCondition) behaviorParts.push('【上涨条件】' + s.riseCondition)
            if (s.languageSamples) behaviorParts.push('【语言样本】' + s.languageSamples)
            if (s.forbiddenBehaviors) behaviorParts.push('【禁止】' + s.forbiddenBehaviors)
            if (Array.isArray(s.autonomousBehaviors) && s.autonomousBehaviors.length > 0) {
              const behText = s.autonomousBehaviors.map(b => b.behavior + '（触发：' + b.trigger + '）').join('；')
              behaviorParts.push('【自驱行为】' + behText)
            }
            return {
              name: s.label || s.name || '',
              min: s.min != null ? Number(s.min) : 0,
              max: s.max != null ? Number(s.max) : 50,
              behavior: behaviorParts.join('\n'),
            }
          })
          update('affectionStages', mappedStages)
        }

        // Increase rules — derive from stages' riseCondition if no explicit rules
        if (Array.isArray(r.affectionIncreaseRules) && r.affectionIncreaseRules.length > 0) {
          update('affectionUpRules', r.affectionIncreaseRules.join('\n'))
        } else if (typeof r.affectionIncreaseRules === 'string' && r.affectionIncreaseRules.trim()) {
          update('affectionUpRules', r.affectionIncreaseRules)
        } else {
          // Derive from stage riseConditions
          const riseConditions = (r.affectionStages || [])
            .filter(s => s.riseCondition)
            .map(s => s.riseCondition)
          if (riseConditions.length > 0) {
            update('affectionUpRules', riseConditions.join('\n'))
          }
        }

        // Decrease rules
        if (Array.isArray(r.affectionDecreaseRules) && r.affectionDecreaseRules.length > 0) {
          update('affectionDownRules', r.affectionDecreaseRules.join('\n'))
        } else if (typeof r.affectionDecreaseRules === 'string' && r.affectionDecreaseRules.trim()) {
          update('affectionDownRules', r.affectionDecreaseRules)
        }

        // Erosion condition
        if (r.erosionCondition) {
          const existing = r.affectionDecreaseRules
            ? (Array.isArray(r.affectionDecreaseRules) ? r.affectionDecreaseRules.join('\n') : r.affectionDecreaseRules)
            : ''
          update('affectionDownRules', existing + (existing ? '\n【反向侵蚀】' : '【反向侵蚀】') + r.erosionCondition)
        }
      }

      // Autonomy behavior
      if (r.autonomyBehavior) {
        update('autonomyBehavior', r.autonomyBehavior)
      }

      setShowExtractModal(false)
      setExtractText('')
    } catch (err) {
      alert('提取失败：' + err.message)
      console.error('[handleExtract] 提取数据填入失败，原始返回:', JSON.stringify(result, null, 2))
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      alert('请输入角色名')
      return
    }

    const character = {
      id: isEdit ? form.id : generateId(),
      name: form.name.trim(),
      avatar: form.avatar || '',
      protagonistName: form.protagonistName.trim(),
      protagonistGender: form.protagonistGender,
      protagonistBackground: form.protagonistBackground.trim(),
      protagonistPersonality: form.protagonistPersonality.trim(),
      background: form.background.trim(),
      nickname: form.nickname.trim(),
      styleRules: parseLines(form.styleRules),
      forbiddenWords: parseLines(form.forbiddenWords),
      affectionEnabled: form.affectionEnabled,
      affectionInitial: form.affectionEnabled ? form.affectionInitial : 50,
      affectionStages: form.affectionEnabled
        ? form.affectionStages.filter(s => s.name.trim())
        : [],
      affectionUpRules: form.affectionEnabled ? form.affectionUpRules.trim() : '',
      affectionDownRules: form.affectionEnabled ? form.affectionDownRules.trim() : '',
      thinkingEnabled: form.thinkingEnabled,
      thinkingPrompt: form.thinkingEnabled ? form.thinkingPrompt.trim() : '',
      activeMessageEnabled: form.activeMessageEnabled,
      activePrompt: form.activeMessageEnabled ? form.activePrompt.trim() : '',
      autonomyBehavior: form.autonomyBehavior.trim(),
      openingScenario: form.openingScenario.trim(),
      chatStyle: form.chatStyle || (mode === 'daily' ? 'casual' : 'story'),
      contextWindow: form.contextWindow || 40,
      showTimestamp: form.showTimestamp || false,
      autoMessageEnabled: form.autoMessageEnabled || false,
      autoMessagePrompt: form.autoMessageEnabled ? form.autoMessagePrompt.trim() : '',
      temperature: form.temperature ?? 0.9,
      topP: form.topP ?? 0.95,
      characters: form.characters ? form.characters.filter(c => c.name.trim()) : undefined,
      updatedAt: Date.now(),
    }

    saveCharacter(character, mode)
    onSave()
  }

  const inputStyle = { width:'100%', padding:'10px 14px', borderRadius:'10px', border:'0.5px solid var(--border)', background:'var(--bg2)', fontSize:'14px', color:'var(--text)', fontFamily:'inherit', outline:'none' }
  const sectionStyle = { background:'var(--bg2)', borderRadius:'12px', padding:'16px', marginBottom:'12px' }
  const labelStyle = { fontSize:'13px', color:'var(--text2)', display:'block', marginBottom:'6px' }
  const groupTitle = { fontSize:'12px', color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'8px', marginTop:'24px' }
  // Legacy aliases for unconverted className references
  const inputClass = ''
  const labelClass = ''
  const sectionClass = ''

  // Collapsible stage cards
  const [expandedStages, setExpandedStages] = useState(() => {
    const init = {}
    const stages = JSON.parse(localStorage.getItem('_cf_expanded') || '{}')
    return stages
  })
  const toggleStage = (i) => setExpandedStages(p => ({ ...p, [i]: !p[i] }))

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'var(--bg)' }}>
      <div style={{ height:'56px', display:'flex', alignItems:'center', padding:'0 16px', gap:'12px', borderBottom:'0.5px solid var(--border2)', flexShrink:0 }}>
        <button type="button" onClick={onCancel} style={{ width:'32px', height:'32px', borderRadius:'50%', background:'var(--bg2)', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'18px', color:'var(--text2)' }}>←</button>
        <span style={{ flex:1, fontSize:'16px', fontWeight:500, color:'var(--text)' }}>{isEdit?'编辑':'新建'}{mode==='daily'?'日常':''}角色</span>
        <button type="submit" style={{ padding:'8px 16px', borderRadius:'8px', border:'none', background:'var(--purple)', color:'#fff', fontSize:'13px', fontWeight:500, cursor:'pointer' }}>{isEdit?'保存':'创建'}</button>
      </div>
      <form onSubmit={handleSubmit} style={{ flex:1, overflowY:'auto', padding:'20px 16px', paddingBottom:'40px' }}>
      {/* Extract modal */}
      {showExtractModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowExtractModal(false)}>
          <div className="bg-gray-800 rounded-2xl border border-gray-700 p-5 mx-4 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-medium text-gray-200 mb-3">粘贴人设文本自动填写</h3>
            <textarea
              className={inputClass + " h-48 resize-none mb-3"}
              value={extractText}
              onChange={e => setExtractText(e.target.value)}
              placeholder="粘贴任意格式的角色人设文本，AI将自动提取各项信息..."
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setShowExtractModal(false); setExtractText('') }}
                className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleExtract}
                disabled={extracting}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white text-sm font-medium transition-all disabled:opacity-50"
              >
                {extracting ? '提取中...' : '开始提取'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Extract button */}
      <button
        type="button"
        onClick={() => setShowExtractModal(true)}
        className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600/20 to-blue-600/20 border border-purple-500/30 hover:border-purple-500/50 text-purple-300 hover:text-purple-200 text-sm font-medium transition-all"
      >
        ✨ 粘贴人设文本自动填写
      </button>

      {/* Basic info */}
      <div>
        <label style={labelStyle}>角色名 *</label>
        <input
          type="text"
          style={inputStyle}
          value={form.name}
          onChange={e => update('name', e.target.value)}
          placeholder="给角色起个名字"
        />
      </div>

      {/* Avatar */}
      <div>
        <label style={labelStyle}>头像</label>
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleAvatarChange}
        />
        <div
          onClick={() => avatarInputRef.current?.click()}
          className="w-20 h-20 rounded-full border-2 border-dashed border-gray-500 hover:border-blue-400 flex items-center justify-center overflow-hidden cursor-pointer transition-colors bg-gray-800"
        >
          {form.avatar ? (
            <img src={form.avatar} alt="头像预览" className="w-full h-full object-cover" />
          ) : (
            <div className="text-center text-gray-500">
              <div className="text-2xl leading-none">+</div>
              <div className="text-[10px]">上传</div>
            </div>
          )}
        </div>
        {form.avatar && (
          <button
            type="button"
            onClick={() => update('avatar', '')}
            className="mt-1 text-xs text-red-400 hover:text-red-300"
          >
            移除头像
          </button>
        )}
      </div>

      {/* Player identity notice */}
      <div style={{ ...sectionStyle, padding: '12px 14px', borderRadius: '12px', border: '0.5px solid var(--purple-l)', background: 'var(--purple-l)' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--purple)', marginBottom: '4px' }}>👤 玩家身份</div>
        <p style={{ fontSize: '11px', color: 'var(--purple)', lineHeight: 1.5, margin: 0 }}>
          你的名字、性别、设定等信息在<b>玩家身份</b>中统一管理。角色会自动识别当前活跃的玩家身份并据此互动。
        </p>
      </div>

      <div>
        <label style={labelStyle}>角色对你的称呼</label>
        <input
          type="text"
          style={inputStyle}
          value={form.nickname}
          onChange={e => update('nickname', e.target.value)}
          placeholder="例如：主人、亲爱的、训练师"
        />
      </div>

      <div>
        <label style={labelStyle}>背景设定</label>
        <textarea
          className={inputClass + " h-28 resize-none"}
          value={form.background}
          onChange={e => update('background', e.target.value)}
          placeholder="描述角色的身份、性格、世界观等..."
        />
      </div>

      {/* Multi-character (story mode only) */}
      {mode === 'story' && (
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700/50">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-medium text-gray-200">出场角色列表</h3>
              <p className="text-xs text-gray-500 mt-0.5">添加剧情中可能出现的其他角色，AI会在对话中扮演他们</p>
            </div>
            <button
              type="button"
              onClick={addSubChar}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
            >
              + 添加角色
            </button>
          </div>

          {(form.characters || []).length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4 border border-dashed border-gray-600 rounded-lg">
              暂未添加其他角色，对话中只有{form.name || '主角色'}一人出场
            </p>
          ) : (
            <div className="space-y-3">
              {(form.characters || []).map((char, i) => (
                <div key={i} className="bg-gray-700/50 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">角色 {i + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeSubChar(i)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      删除
                    </button>
                  </div>

                  <div className="flex gap-3">
                    <input
                      ref={el => { if (el) el._subCharIdx = i }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleSubCharAvatar(i, f) }}
                      id={`subchar-avatar-${i}`}
                    />
                    <label
                      htmlFor={`subchar-avatar-${i}`}
                      className="w-12 h-12 rounded-full border-2 border-dashed border-gray-500 hover:border-blue-400 flex items-center justify-center overflow-hidden cursor-pointer transition-colors bg-gray-600 flex-shrink-0"
                    >
                      {char.avatar ? (
                        <img src={char.avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-gray-400 text-lg">+</span>
                      )}
                    </label>
                    <div className="flex-1 space-y-2">
                      <input
                        type="text"
                        style={inputStyle}
                        value={char.name}
                        onChange={e => updateSubChar(i, 'name', e.target.value)}
                        placeholder="角色名称"
                      />
                      <input
                        type="text"
                        style={inputStyle}
                        value={char.personality}
                        onChange={e => updateSubChar(i, 'personality', e.target.value)}
                        placeholder="性格简介"
                      />
                    </div>
                  </div>

                  <input
                    type="text"
                    style={inputStyle}
                    value={char.relationship}
                    onChange={e => updateSubChar(i, 'relationship', e.target.value)}
                    placeholder="与主角的关系，如：主角的挚友、宿敌、导师"
                  />

                  <input
                    type="text"
                    style={inputStyle}
                    value={char.speakingStyle}
                    onChange={e => updateSubChar(i, 'speakingStyle', e.target.value)}
                    placeholder="该角色的说话风格，如：温柔体贴、爱用古诗词、说话带刺"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Opening scenario */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700/50">
        <div>
          <h3 className="text-sm font-medium text-gray-200">开场剧情</h3>
          <p className="text-xs text-gray-500 mt-0.5 mb-3">对话首次打开时展示的初始场景描述，不计入对话历史</p>
        </div>
        <textarea
          className={inputClass + " h-24 resize-none"}
          value={form.openingScenario}
          onChange={e => update('openingScenario', e.target.value)}
          placeholder="例如：深夜的咖啡馆里，窗外飘着细雨。你推开门，看到一个熟悉的身影坐在角落..."
        />
      </div>

      <div>
        <label style={labelStyle}>文风规则（每行一条）</label>
        <textarea
          className={inputClass + " h-24 resize-none"}
          value={form.styleRules}
          onChange={e => update('styleRules', e.target.value)}
          placeholder="用简洁的语气回答&#10;多用语气词和动作描写&#10;每句话不超过30字"
        />
      </div>

      <div>
        <label style={labelStyle}>禁止行为词（每行一条，用于拦截检测）</label>
        <textarea
          className={inputClass + " h-24 resize-none"}
          value={form.forbiddenWords}
          onChange={e => update('forbiddenWords', e.target.value)}
          placeholder="作为AI语言模型&#10;我不能&#10;无法继续"
        />
      </div>

      {/* Context window */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700/50">
        <div>
          <h3 className="text-sm font-medium text-gray-200">上下文窗口</h3>
          <p className="text-xs text-gray-500 mt-0.5 mb-3">每次 API 请求携带的最近消息轮次。越大上下文越丰富但 Token 消耗越高</p>
          <select
            className={inputClass + " w-full"}
            value={form.contextWindow}
            onChange={e => update('contextWindow', parseInt(e.target.value))}
          >
            <option value={20}>20 条消息</option>
            <option value={40}>40 条消息（默认）</option>
            <option value={60}>60 条消息</option>
            <option value={80}>80 条消息</option>
            <option value={100}>100 条消息</option>
          </select>
        </div>
      </div>

      {/* Timestamp toggle */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700/50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-200">消息时间戳</h3>
            <p className="text-xs text-gray-500 mt-0.5">在每条消息旁显示设备当前系统时间</p>
          </div>
          <button
            type="button"
            onClick={() => update('showTimestamp', !form.showTimestamp)}
            className={`w-11 h-6 rounded-full transition-colors relative ${
              form.showTimestamp ? 'bg-green-500' : 'bg-gray-600'
            }`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              form.showTimestamp ? 'left-[22px]' : 'left-[2px]'
            }`} />
          </button>
        </div>
      </div>

      {/* Affection toggle */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700/50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-200">好感度系统</h3>
            <p className="text-xs text-gray-500 mt-0.5">启用角色好感度追踪</p>
          </div>
          <button
            type="button"
            onClick={() => update('affectionEnabled', !form.affectionEnabled)}
            className={`w-11 h-6 rounded-full transition-colors relative ${
              form.affectionEnabled ? 'bg-pink-500' : 'bg-gray-600'
            }`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              form.affectionEnabled ? 'left-[22px]' : 'left-[2px]'
            }`} />
          </button>
        </div>

        {form.affectionEnabled && (
          <div className="mt-4 space-y-3">
            <div>
              <label style={labelStyle}>初始好感度 (0-100)</label>
              <input
                type="number"
                min="0"
                max="100"
                style={inputStyle}
                value={form.affectionInitial}
                onChange={e => update('affectionInitial', Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
              />
            </div>

            <div>
              <label style={labelStyle}>好感度阶段</label>
              <div className="space-y-3">
                {form.affectionStages.map((stage, i) => {
                  const expanded = expandedStages[i] ?? (i === form.affectionStages.length - 1)
                  return (
                  <div key={i} style={sectionStyle}>
                    <div onClick={() => toggleStage(i)} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer', paddingBottom: expanded ? '12px' : '0', borderBottom: expanded ? '0.5px solid var(--border2)' : 'none' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                        <div style={{ width:'6px', height:'6px', borderRadius:'50%', background:'var(--purple)' }} />
                        <span style={{ fontSize:'13px', fontWeight:500, color:'var(--text)' }}>{stage.name || '阶段 ' + (i + 1)}</span>
                        <span style={{ fontSize:'11px', color:'var(--text3)' }}>{stage.min}-{stage.max}</span>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                        {form.affectionStages.length > 1 && (
                          <button type="button" onClick={e => { e.stopPropagation(); removeStage(i) }} style={{ fontSize:'11px', color:'var(--coral)', background:'none', border:'none', cursor:'pointer' }}>删除</button>
                        )}
                        <span style={{ fontSize:'10px', color:'var(--text3)', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition:'transform 0.2s', display:'inline-block' }}>▼</span>
                      </div>
                    </div>
                    {expanded && (
                      <div style={{ paddingTop:'12px', display:'flex', flexDirection:'column', gap:'8px' }}>
                        <input type="text" style={inputStyle} value={stage.name} onChange={e => updateStage(i, 'name', e.target.value)} placeholder="阶段名称，如：陌生、友好、亲密" />
                        <div style={{ display:'flex', gap:'8px' }}>
                          <div style={{ flex:1 }}>
                            <label style={{ fontSize:'11px', color:'var(--text3)' }}>下限</label>
                            <input type="number" min="0" max="100" style={{ ...inputStyle, marginTop:'2px' }} value={stage.min} onChange={e => updateStage(i, 'min', parseInt(e.target.value) || 0)} />
                          </div>
                          <div style={{ flex:1 }}>
                            <label style={{ fontSize:'11px', color:'var(--text3)' }}>上限</label>
                            <input type="number" min="0" max="100" style={{ ...inputStyle, marginTop:'2px' }} value={stage.max} onChange={e => updateStage(i, 'max', parseInt(e.target.value) || 0)} />
                          </div>
                        </div>
                        <textarea style={{ ...inputStyle, height:'64px', resize:'none' }} value={stage.behavior} onChange={e => updateStage(i, 'behavior', e.target.value)} placeholder="该阶段的行为规则" />
                      </div>
                    )}
                  </div>
                )})}
                <button
                  type="button"
                  onClick={addStage}
                  className="w-full py-2 rounded-lg border border-dashed border-gray-600 text-gray-400 text-sm hover:border-gray-500 hover:text-gray-300 transition-colors"
                >
                  + 添加阶段
                </button>
              </div>
            </div>

            <div>
              <label style={labelStyle}>好感度增加条件（每行一条）</label>
              <textarea
                className={inputClass + " h-20 resize-none"}
                value={form.affectionUpRules}
                onChange={e => update('affectionUpRules', e.target.value)}
                placeholder="表现出友好和善意：+3&#10;送礼物或表达关心：+5&#10;帮助角色解决问题：+7"
              />
            </div>

            <div>
              <label style={labelStyle}>好感度减少条件（每行一条）</label>
              <textarea
                className={inputClass + " h-20 resize-none"}
                value={form.affectionDownRules}
                onChange={e => update('affectionDownRules', e.target.value)}
                placeholder="态度粗鲁或不尊重：-5&#10;无视角色的感受：-3&#10;欺骗或背叛行为：-10"
              />
            </div>
          </div>
        )}
      </div>

      {/* Thinking toggle */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700/50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-200">思考层</h3>
            <p className="text-xs text-gray-500 mt-0.5">在生成回复前先进行内部思考</p>
          </div>
          <button
            type="button"
            onClick={() => update('thinkingEnabled', !form.thinkingEnabled)}
            className={`w-11 h-6 rounded-full transition-colors relative ${
              form.thinkingEnabled ? 'bg-amber-500' : 'bg-gray-600'
            }`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              form.thinkingEnabled ? 'left-[22px]' : 'left-[2px]'
            }`} />
          </button>
        </div>

        {form.thinkingEnabled && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1">
              <label style={labelStyle}>思考指令</label>
              <button
                type="button"
                onClick={handleGenerateThinking}
                disabled={generatingThinking}
                className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
              >
                {generatingThinking ? '生成中...' : 'AI生成思考层'}
              </button>
            </div>
            <textarea
              className={inputClass + " h-28 resize-none"}
              value={form.thinkingPrompt}
              onChange={e => update('thinkingPrompt', e.target.value)}
              placeholder="在每次回复前，先在心里思考以下问题：&#10;1. 此刻角色处于什么情绪状态？&#10;2. 根据好感度阶段，应该如何调整语气？&#10;3. 当前对话场景需要特别注意什么？"
            />
          </div>
        )}
      </div>

      {/* Active message toggle */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700/50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-200">主动消息</h3>
            <p className="text-xs text-gray-500 mt-0.5">角色可定时主动发起对话</p>
          </div>
          <button
            type="button"
            onClick={() => update('activeMessageEnabled', !form.activeMessageEnabled)}
            className={`w-11 h-6 rounded-full transition-colors relative ${
              form.activeMessageEnabled ? 'bg-green-500' : 'bg-gray-600'
            }`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              form.activeMessageEnabled ? 'left-[22px]' : 'left-[2px]'
            }`} />
          </button>
        </div>

        {form.activeMessageEnabled && (
          <div className="mt-4">
            <label style={labelStyle}>主动消息指令</label>
            <p className="text-[10px] text-gray-500 mt-0.5 mb-2">
              AI会根据系统时间、对话间隔和角色设定，自主判断是否主动发消息给用户
            </p>
            <textarea
              className={inputClass + " h-24 resize-none"}
              value={form.activePrompt}
              onChange={e => update('activePrompt', e.target.value)}
              placeholder={'告诉AI在什么情境下主动发消息、发什么类型的内容：\n例如：早上8-10点主动问早安；\n超过1小时没对话可以问问在忙什么；\n看到有趣的东西会主动分享'}
            />
          </div>
        )}
      </div>

      {/* Auto message (autonomous after reply) */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700/50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-200">角色自主消息</h3>
            <p className="text-xs text-gray-500 mt-0.5">收到回复后，AI判断角色是否还有话要说，自动追加一条消息</p>
          </div>
          <button
            type="button"
            onClick={() => update('autoMessageEnabled', !form.autoMessageEnabled)}
            className={`w-11 h-6 rounded-full transition-colors relative ${
              form.autoMessageEnabled ? 'bg-green-500' : 'bg-gray-600'
            }`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              form.autoMessageEnabled ? 'left-[22px]' : 'left-[2px]'
            }`} />
          </button>
        </div>

        {form.autoMessageEnabled && (
          <div className="mt-4">
            <label style={labelStyle}>自主消息指令</label>
            <textarea
              className={inputClass + " h-24 resize-none"}
              value={form.autoMessagePrompt}
              onChange={e => update('autoMessagePrompt', e.target.value)}
              placeholder={'例如：当角色情绪激动、想引起注意或刚想到重要事情时，会再主动发一条消息。\n描述角色在什么情境下会主动追加消息，以及消息的类型和风格。'}
            />
          </div>
        )}
      </div>

      {/* Advanced parameters */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700/50">
        <button
          type="button"
          onClick={() => update('showAdvanced', !form.showAdvanced)}
          className="w-full flex items-center justify-between text-sm font-medium text-gray-200"
        >
          <span>高级参数</span>
          <span className="text-gray-400 text-xs">{form.showAdvanced ? '收起 ▲' : '展开 ▼'}</span>
        </button>

        {form.showAdvanced && (
          <div className="mt-4 space-y-4">
            {/* Temperature */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-400">温度 (Temperature)</label>
                <span className="text-xs text-blue-400 font-mono">{form.temperature ?? 0.9}</span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={form.temperature ?? 0.9}
                onChange={e => update('temperature', parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none bg-gray-600 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500"
              />
              <div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
                <span>0 精确</span>
                <span>2 创意</span>
              </div>
            </div>

            {/* TopP */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-400">TopP</label>
                <span className="text-xs text-blue-400 font-mono">{form.topP ?? 0.95}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={form.topP ?? 0.95}
                onChange={e => update('topP', parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none bg-gray-600 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-500"
              />
              <div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
                <span>0 集中</span>
                <span>1 多样</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Autonomy behavior */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700/50">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium text-gray-200">自主行为</h3>
            <p className="text-xs text-gray-500 mt-0.5">角色在日常互动中的行为模式总结</p>
          </div>
          <button
            type="button"
            onClick={handleGenerateAutonomy}
            disabled={generatingAutonomy}
            className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
          >
            {generatingAutonomy ? '生成中...' : '生成自主行为'}
          </button>
        </div>
        <textarea
          className={inputClass + " h-32 resize-none"}
          value={form.autonomyBehavior}
          onChange={e => update('autonomyBehavior', e.target.value)}
          placeholder="点击上方按钮让AI根据角色设定自动生成，或手动填写角色在互动中的自主行为、习惯动作、主动话题和情绪反应模式..."
        />
      </div>

      {/* Submit buttons */}
      <div style={{ padding:'16px 0', display:'flex', gap:'10px' }}>
        <button type="button" onClick={onCancel} style={{ flex:1, padding:'12px', borderRadius:'12px', border:'none', background:'var(--bg2)', color:'var(--text)', fontSize:'15px', cursor:'pointer' }}>取消</button>
        <button type="submit" style={{ flex:2, padding:'12px', borderRadius:'12px', border:'none', background:'var(--purple)', color:'#fff', fontSize:'15px', fontWeight:500, cursor:'pointer' }}>{isEdit ? '保存修改' : '创建角色'}</button>
      </div>
    </form>
    </div>
  )
}
