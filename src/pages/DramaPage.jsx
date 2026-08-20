import { useState, useEffect, useRef, useCallback } from 'react'
import { parseMultiCharacterMessage, findCharacterAvatar, compressChatHistory } from '../utils/deepseek'
import { getApiKey } from '../utils/storage'
import { getFolder, updateFolder } from '../state/folderStore'
import { getActiveAccount } from '../state/accountStore'
import { InteractionKernel } from '../engine/interactionKernel'
import ProgressBar from '../components/ProgressBar'
import EventActionPanel from '../components/EventActionPanel'

/**
 * DramaPage — DRAMA MODE ONLY. Pure paragraph narrative. NO BUBBLES. NO TIMESTAMPS.
 * Completely isolated from DailyPage. Uses folder USK + folder saves.
 */
export default function DramaPage({ folderId, folderChars, saveId: propSaveId, onBack }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [error, setError] = useState('')
  const [affection, setAffection] = useState(50)
  const [affections, setAffections] = useState({})
  const [affectionFlash, setAffectionFlash] = useState(null)
  const [tension, setTension] = useState(30)
  const [showDice, setShowDice] = useState(false)
  const [diceResult, setDiceResult] = useState(null)
  const [diceRolling, setDiceRolling] = useState(false)
  const [saveId, setSaveId] = useState(null)
  const [lastDecision, setLastDecision] = useState(null)
  const [editingIndex, setEditingIndex] = useState(null) // non-null = editing this msg
  const [compressing, setCompressing] = useState(false)
  const [qualityIssues, setQualityIssues] = useState([])
  const [showQuality, setShowQuality] = useState(false)
  const [openingExpanded, setOpeningExpanded] = useState(false)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const messagesEndRef = useRef(null)

  const mainChar = folderChars[0] || {}
  const apiKey = getApiKey()

  // ── Extract opening text from character settings ──
  const getOpeningText = useCallback(() => {
    // 1. Legacy: explicit openingScenario
    const explicit = mainChar.openingScenario || mainChar.raw?.openingScenario
    if (explicit?.trim()) return explicit.trim()

    // 2. Folder story_intro
    const folder = getFolder(folderId)
    if (folder?.story_intro?.trim()) return folder.story_intro.trim()

    // 3. Extract from v9 description text (regex)
    const desc = mainChar.description || mainChar.raw?.description || ''
    if (desc.trim()) {
      const patterns = [
        /(?:开场|开场剧情|开场场景|开局)[：:]\s*([\s\S]+?)(?=\n\n[^\n]{0,4}(?:角色|好感|人物|设定|世界|背景|性格|身份|玩家|男主|女主|称呼|备注|注意|规则|风格|禁止|写作|结尾|\n{2,}|$))/i,
        /(?:^|\n\n)([^\n]{30,300}?(?:开场|开始|起初|这天|那天|晚上|早上|下午|深夜|酒吧|房间|门口|推门|走进)[^\n]{0,300})/,
      ]
      for (const pat of patterns) {
        const m = desc.match(pat)
        if (m?.[1]?.trim().length > 15) return m[1].trim()
      }
      // Fallback: first substantial paragraph (likely the intro)
      const firstPara = desc.split(/\n\n+/).find(p => p.trim().length > 30)
      if (firstPara?.trim()) return firstPara.trim()
    }
    return null
  }, [folderId, mainChar])

  // ── Init: kernel handles hydration → save → USK ──
  useEffect(() => {
    const state = InteractionKernel.init(folderId, folderChars, 'drama', null, propSaveId)
    let msgs = state.messages

    // Inject opening scene as first message (pre-written, zero token cost)
    if (msgs.length === 0) {
      const openingText = getOpeningText()
      if (openingText) {
        const openingMsg = {
          id: 'opening_' + Date.now(),
          role: 'assistant',
          content: openingText,
          isOpening: true,
          timestamp: Date.now(),
        }
        msgs = [openingMsg]
        InteractionKernel.state.messages = msgs

        // Persist to folder so buildCharacterForLLM → narratorPrompt picks it up
        const folder = getFolder(folderId)
        if (folder && !folder.story_intro) {
          updateFolder(folderId, { story_intro: openingText })
        }
      }
    }

    setMessages([...msgs])
    setAffection(state.affection)
    setTension(state.tension)
    setSaveId(state.saveId)
    setAffections(state.affections)
  }, [folderId])

  // ── Auto-save safety net ──
  useEffect(() => {
    if (saveId && messages.length > 0) {
      InteractionKernel.persistMessages()
    }
  }, [messages, saveId, folderId])

  // ── Auto-scroll ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  // ── Build character object for LLM ──
  const buildCharacterForLLM = useCallback(() => {
    const folder = getFolder(folderId)
    const mergedWorldSetting = mainChar.worldSetting || (folder ? folder.worldview : '') || ''
    const mergedOpening = mainChar.openingScenario || (folder ? folder.story_intro : '') || ''

    // v9: Player identity from folder (per-world), fallback to account
    const playerName = folder?.playerName || getActiveAccount()?.name || ''
    const playerGender = folder?.playerGender || getActiveAccount()?.gender || ''
    const playerDescription = folder?.playerDescription || getActiveAccount()?.description || ''
    const _playerProfile = {
      name: playerName,
      gender: playerGender,
      personalityTags: getActiveAccount()?.personalityTags || [],
      description: playerDescription,
    }

    // v9: Build romanceCharacters from ALL folder chars
    const allChars = folderChars.length > 0 ? folderChars : [mainChar]
    const romanceCharacters = allChars.map(c => ({
      id: c.id || c.name,
      name: c.name,
      description: c.description || '',
      background: c.background || '',
      personality: c.personality || '',
      speakingStyle: c.speakingStyle || '',
      styleRules: c.styleRules || [],
      forbiddenWords: c.forbiddenWords || [],
      affectionEnabled: c.affectionEnabled !== false,
      affectionInitial: c.affectionInitial ?? 0,
      affectionStages: c.affectionStages || [{ name: '默认', min: 0, max: 100, description: '' }],
      behavior: c.behavior || '',
      archetype: c.archetype || 'pursuer',
      nickname: c.nickname || '',
    }))

    return {
      id: mainChar.id || folderId,
      name: mainChar.name,
      chatStyle: 'story',
      worldSetting: mergedWorldSetting,
      openingScenario: mergedOpening,
      behavior: mainChar.behavior || '',
      personality: mainChar.personality || '',
      background: mainChar.background || '',
      speakingStyle: mainChar.speakingStyle || '',
      styleRules: mainChar.styleRules || [],
      forbiddenWords: mainChar.forbiddenWords || [],
      activeMessageEnabled: mainChar.activeMessageEnabled || false,
      activePrompt: mainChar.activePrompt || '',
      romanceCharacters,
      npcs: mainChar.npcs || [],
      affectionStages: mainChar.affectionStages || [],
      temperature: mainChar.temperature ?? 0.9,
      topP: mainChar.topP ?? 0.95,
      thinkingEnabled: mainChar.thinkingEnabled || false,
      contextWindow: mainChar.contextWindow || 40,
      _playerProfile,
      _playerName: playerName,         // v9: per-world player name
      _playerGender: playerGender,     // v9: per-world player gender
      _playerDescription: playerDescription, // v9: per-world player description
    }
  }, [folderId, mainChar])

  // ── Send ──
  const doSend = useCallback(async (userText) => {
    if (!apiKey) { setError('请先配置 API Key'); return }
    setError('')
    setLoading(true)
    setInput('')
    setStreamingText('')

    // If editing: truncate at the message being edited, then send
    const editIdx = editingIndex
    if (editIdx != null) {
      InteractionKernel.rollbackTo(editIdx - 1)
      setEditingIndex(null)
    }

    const char = buildCharacterForLLM()

    const result = await InteractionKernel.executeTurn(
      userText, apiKey,
      (token, fullText, reset) => {
        if (reset) { setStreamingText(''); return }
        setStreamingText(fullText)
      },
      char,
    )

    setLoading(false)
    setStreamingText('')

    if (result.error) {
      setError(result.error?.message || result.error?.toString?.() || '请求失败')
      return
    }

    // Track decision for UI indicator
    if (result.decision) {
      setLastDecision(result.decision)
      if (result.decision.type !== 'normal_reply') {
        setTimeout(() => setLastDecision(null), 4000)
      }
    }

    // Silent: character refused to respond — still update messages
    if (result.silent) {
      setMessages(result.messages)
      return
    }

    setMessages(result.messages)
    if (result.updatedAffections) {
      setAffections(result.updatedAffections)
    }
    if (result.affectionFlash) {
      setAffectionFlash(result.affectionFlash)
      setTimeout(() => setAffectionFlash(null), 1500)
    }
    setAffection(result.affection)
    setTension(result.tension)
    if (result.qualityIssues?.length) {
      setQualityIssues(result.qualityIssues)
    }
  }, [apiKey, buildCharacterForLLM, editingIndex])

  const handleSend = () => {
    const text = input.trim()
    if (!text || loading) return
    doSend(text)
  }

  const handleCancelEdit = () => {
    setEditingIndex(null)
    setInput('')
  }

  const handleDice = () => {
    if (diceResult != null) {
      const triggerText = '（骰子掷出了' + diceResult + '点，触发随机事件）'
      setShowDice(false)
      setDiceResult(null)
      doSend(triggerText)
    }
  }

  const cancelEdit = () => {
    setEditingIndex(null)
    setInput('')
  }

  // ── Per-message handlers ──
  const handleEditMessage = (idx) => {
    const msg = InteractionKernel.getState().messages[idx]
    if (!msg || msg.role !== 'user') return
    // Just put text in input, mark editing — don't truncate yet
    setEditingIndex(idx)
    setInput(msg.content)
  }

  const handleDeleteMessage = (idx) => {
    const state = InteractionKernel.getState()
    const msg = state.messages[idx]
    if (!msg || msg.immutable) return
    if (msg.role === 'user') {
      InteractionKernel.rollbackTo(idx - 1)
    } else {
      InteractionKernel.deleteMessageAtIndex(idx)
    }
    setMessages(InteractionKernel.getState().messages)
    setAffection(InteractionKernel.getAffection())
    setTension(InteractionKernel.getState().tension)
  }

  const handleRegenerate = (assistantIdx) => {
    const userMsg = InteractionKernel.getUserMsgBefore(assistantIdx)
    if (!userMsg) return
    // Directly regenerate: rollback to before the user message, then re-send
    InteractionKernel.rollbackTo(userMsg._index - 1)
    setMessages(InteractionKernel.getState().messages)
    doSend(userMsg.content)
  }

  const handleEditLast = () => {
    const last = InteractionKernel.getLastUserMessage()
    if (!last) return
    setEditingIndex(last._index)
    setInput(last.content)
  }

  const handleDeleteLast = () => {
    const msgs = InteractionKernel.deleteLastPair()
    setMessages(msgs)
    setAffection(InteractionKernel.getAffection())
    setTension(InteractionKernel.getState().tension)
  }

  // ── Paragraph renderer (NO BUBBLES) ──
  const renderParagraph = (msg, i) => {
    // System messages: summary, silent, interrupt context
    if (msg.role === 'system') {
      if (msg.isSummary) {
        return (
          <div key={i} style={{ marginBottom: '16px', padding: '10px 12px', background: 'var(--bg3)', borderRadius: '10px', border: '0.5px solid var(--border)', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text3)' }}>📋 前情摘要</span>
              <button onClick={() => {
                const newText = prompt('编辑摘要：', msg.content.replace(/^📋 前情摘要（结构化压缩）：\n?/, ''))
                if (newText != null) {
                  msg.content = '📋 前情摘要（结构化压缩）：\n' + newText
                  InteractionKernel.persistMessages()
                  setMessages([...InteractionKernel.getState().messages])
                }
              }} style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', border: '0.5px solid var(--border)', background: 'var(--bg)', color: 'var(--text3)', cursor: 'pointer' }}>✏️ 编辑</button>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text2)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {msg.content.replace(/^📋 前情摘要.*：\n?/, '')}
            </div>
          </div>
        )
      }
      if (msg.silent) {
        return (
          <div key={i} style={{ textAlign: 'center', marginBottom: '20px', padding: '12px' }}>
            <span style={{
              fontSize: '11px', color: 'var(--text3)', background: 'var(--bg3)',
              padding: '4px 12px', borderRadius: '16px', fontStyle: 'italic',
            }}>
              {msg.content}
            </span>
          </div>
        )
      }
      if (msg.interruptCtx) {
        return (
          <div key={i} style={{ textAlign: 'center', marginBottom: '8px' }}>
            <span style={{
              fontSize: '10px', color: 'var(--coral)', background: 'var(--coral-l)',
              padding: '3px 10px', borderRadius: '10px',
            }}>
              ⚡ {msg.content}
            </span>
          </div>
        )
      }
      return null
    }

    if (msg.role === 'user') {
      return (
        <div key={i} style={{ marginBottom: '20px', paddingLeft: '24px', position: 'relative' }}
          onMouseEnter={e => { e.currentTarget.querySelector('.msg-actions')?.style.setProperty('opacity', '1') }}
          onMouseLeave={e => { e.currentTarget.querySelector('.msg-actions')?.style.setProperty('opacity', '0') }}
        >
          <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '4px' }}>主角</div>
          <div style={{ fontSize: '14px', color: 'var(--text)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
            {msg.content}
          </div>
          <div className="msg-actions" style={{ position: 'absolute', top: 0, right: 0, display: 'flex', gap: '2px', opacity: 0, transition: 'opacity 0.15s' }}>
            <button onClick={() => handleEditMessage(i)} title="编辑"
              style={{ width: '20px', height: '20px', borderRadius: '4px', border: 'none', background: 'var(--bg2)', color: 'var(--text3)', fontSize: '10px', cursor: 'pointer' }}>✏️</button>
            <button onClick={() => handleDeleteMessage(i)} title="删除"
              style={{ width: '20px', height: '20px', borderRadius: '4px', border: 'none', background: 'var(--bg2)', color: 'var(--text3)', fontSize: '10px', cursor: 'pointer' }}>🗑</button>
          </div>
        </div>
      )
    }

    const sections = parseMultiCharacterMessage(msg.content)

    // Opening message: render only the collapsible module, nothing else
    if (msg.isOpening) {
      const fullText = msg.content || ''
      const previewLen = 300
      const needsTruncate = fullText.length > previewLen + 50
      const preview = needsTruncate ? '…' + fullText.slice(-previewLen) : fullText
      return (
        <div key={i} style={{ marginBottom: '24px' }}>
          <div style={{ marginBottom: '12px' }}>
            <button
              onClick={() => setOpeningExpanded(!openingExpanded)}
              style={{
                display: 'block', width: '100%', padding: '0',
                borderRadius: '10px', border: '0.5px solid var(--border)',
                background: 'var(--bg3)', cursor: 'pointer', textAlign: 'left',
                fontFamily: 'inherit', overflow: 'hidden',
              }}
            >
              <div style={{ padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text2)' }}>📋 开场剧情</span>
                <span style={{ fontSize: '10px', color: 'var(--text3)' }}>{openingExpanded ? '收起 ▲' : '展开 ▼'}</span>
              </div>
              {!openingExpanded && (
                <div style={{
                  padding: '0 14px 10px',
                  fontSize: '12px', lineHeight: 1.7, color: 'var(--text3)',
                  whiteSpace: 'pre-wrap', maxHeight: '80px', overflow: 'hidden',
                  position: 'relative',
                }}>
                  {preview}
                  {needsTruncate && (
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      height: '32px',
                      background: 'linear-gradient(transparent, var(--bg3))',
                    }} />
                  )}
                </div>
              )}
            </button>
            {openingExpanded && (
              <div style={{
                marginTop: '8px', padding: '12px 16px',
                background: 'var(--bg)', borderRadius: '10px',
                border: '0.5px solid var(--border)',
              }}>
                <div style={{
                  fontSize: '14px', lineHeight: 1.8, color: 'var(--text)',
                  whiteSpace: 'pre-wrap',
                }}>
                  {fullText}
                </div>
              </div>
            )}
          </div>
        </div>
      )
    }

    return (
      <div key={i} style={{ marginBottom: '24px', position: 'relative' }}
        onMouseEnter={e => { e.currentTarget.querySelector('.msg-actions')?.style.setProperty('opacity', '1') }}
        onMouseLeave={e => { e.currentTarget.querySelector('.msg-actions')?.style.setProperty('opacity', '0') }}
      >
        {!msg.immutable && (
          <div className="msg-actions" style={{ position: 'absolute', top: 0, right: 0, display: 'flex', gap: '2px', opacity: 0, transition: 'opacity 0.15s' }}>
            <button onClick={() => handleRegenerate(i)} title="重刷"
              style={{ width: '20px', height: '20px', borderRadius: '4px', border: 'none', background: 'var(--bg2)', color: 'var(--text3)', fontSize: '10px', cursor: 'pointer' }}>🔄</button>
            <button onClick={() => handleDeleteMessage(i)} title="删除"
              style={{ width: '20px', height: '20px', borderRadius: '4px', border: 'none', background: 'var(--bg2)', color: 'var(--text3)', fontSize: '10px', cursor: 'pointer' }}>🗑</button>
          </div>
        )}
        {sections.length <= 1 ? (
          <div style={{
            paddingLeft: '16px',
            borderLeft: '2px solid var(--border)',
            fontSize: '15px',
            lineHeight: 1.9,
            color: 'var(--text)',
            whiteSpace: 'pre-wrap',
          }}>
            {msg.content}
          </div>
        ) : (
          sections.map((sec, si) => {
            const charInfo = sec.characterName ? findCharacterAvatar(mainChar, sec.characterName) : null
            return (
              <div key={si} style={{ marginBottom: si < sections.length - 1 ? '12px' : 0, paddingLeft: '16px', borderLeft: '2px solid var(--border)' }}>
                {sec.characterName && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)' }}>
                      【{sec.characterName}】
                    </span>
                  </div>
                )}
                <div style={{ fontSize: '15px', lineHeight: 1.9, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
                  {sec.content}
                </div>
              </div>
            )
          })
        )}
      </div>
    )
  }

  const mainCharName = mainChar.name || '角色'
  const charNames = Object.keys(affections).filter(n => affections[n] != null)
  if (charNames.length === 0 && mainCharName) charNames.push(mainCharName)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', position: 'relative' }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '0 12px', height: '48px',
        borderBottom: '0.5px solid var(--border)', flexShrink: 0, gap: '8px',
      }}>
        <button onClick={onBack} style={{
          width: '32px', height: '32px', borderRadius: '8px', border: 'none',
          background: 'var(--bg2)', cursor: 'pointer', color: 'var(--text2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>{mainCharName} · 剧情</span>
      </div>

      {/* ── Progress Bars — one per character ── */}
      <div style={{ padding: '4px 16px', borderBottom: '0.5px solid var(--border2)', flexShrink: 0 }}>
        {charNames.map(cName => {
          const cAff = affections[cName] ?? 0
          const cFlash = affectionFlash?.[cName] || null
          return (
            <div key={cName} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text2)', minWidth: '48px', flexShrink: 0 }}>{cName}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <ProgressBar value={cAff} color="var(--purple)" height={3} flash={cFlash} showValue />
              </div>
              <button
                onClick={() => {
                  InteractionKernel.manualAffectionAdjust(cName, -2)
                  setAffections({...InteractionKernel.getAffections()})
                }}
                style={{ width: '20px', height: '20px', borderRadius: '4px', border: '0.5px solid var(--border)', background: 'var(--bg)', color: 'var(--coral)', fontSize: '11px', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title={cName + ' -2'}
              >−</button>
              <button
                onClick={() => {
                  InteractionKernel.manualAffectionAdjust(cName, 2)
                  setAffections({...InteractionKernel.getAffections()})
                }}
                style={{ width: '20px', height: '20px', borderRadius: '4px', border: '0.5px solid var(--border)', background: 'var(--bg)', color: 'var(--teal)', fontSize: '11px', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title={cName + ' +2'}
              >+</button>
            </div>
          )
        })}
        {/* Decision indicator */}
        {lastDecision && lastDecision.type !== 'normal_reply' && (
          <div style={{
            marginTop: '4px', textAlign: 'center',
            fontSize: '10px', padding: '2px 8px', borderRadius: '6px',
            background: lastDecision.type === 'silent' ? 'var(--bg3)' :
                        lastDecision.type === 'interrupt' ? 'var(--coral-l)' :
                        lastDecision.type === 'emotional_burst' ? 'var(--coral-l)' :
                        'var(--purple-l)',
            color: lastDecision.type === 'silent' ? 'var(--text3)' :
                   lastDecision.type === 'interrupt' ? 'var(--coral)' :
                   lastDecision.type === 'emotional_burst' ? 'var(--coral)' :
                   'var(--purple)',
          }}>
            {lastDecision.type === 'silent' && '🤐 '}
            {lastDecision.type === 'interrupt' && '⚡ '}
            {lastDecision.type === 'emotional_burst' && '💢 '}
            {lastDecision.type === 'initiate_chat' && '💬 '}
            {lastDecision.reason}
          </div>
        )}
        {/* Token + Compress row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
          <span style={{ fontSize: '9px', color: 'var(--text3)' }}>
            🪙 {(() => { const t = InteractionKernel.getTokenUsage(); return `${t.totalTokens} tokens (${t.turnCount}轮)` })()}
          </span>
          <button
            onClick={async () => {
              const KEEP = 4
              const all = InteractionKernel.getState().messages
              const compressible = all.filter(m => m.role === 'user' || (m.role === 'assistant' && !m.isOpening))
              if (compressible.length <= KEEP + 2) {
                alert('消息太少，不需要压缩（至少需要 ' + (KEEP + 3) + ' 条）')
                return
              }
              if (!apiKey) { alert('请先配置 API Key'); return }
              setCompressing(true)
              try {
                const toKeep = all.slice(-KEEP)
                const old = all.slice(0, -KEEP)
                // Find existing summary to merge into new compression
                const existingSummary = all.find(m => m.isSummary)
                const existingMemory = existingSummary
                  ? existingSummary.content.replace(/^📋 前情摘要.*：\n?/, '')
                  : ''
                const result = await compressChatHistory(old, apiKey, '', existingMemory)
                const summary = result.summary || JSON.stringify(result)
                const summaryMsg = {
                  id: 'summary-' + Date.now(),
                  role: 'system',
                  content: '📋 前情摘要（结构化压缩）：\n' + summary,
                  timestamp: Date.now(),
                  isSummary: true,
                }
                const newMessages = [summaryMsg, ...toKeep]
                InteractionKernel.state.messages = newMessages
                InteractionKernel.persistMessages()
                setMessages(newMessages)
              } catch (e) {
                alert('压缩失败：' + (e.message || '未知错误'))
              } finally {
                setCompressing(false)
              }
            }}
            disabled={compressing}
            style={{
              fontSize: '9px', padding: '2px 8px', borderRadius: '6px',
              border: '0.5px solid var(--border)', background: 'var(--bg)',
              color: compressing ? 'var(--text3)' : 'var(--text3)',
              cursor: compressing ? 'default' : 'pointer', opacity: compressing ? 0.5 : 1,
            }}
          >{compressing ? '压缩中…' : '压缩'}</button>
        </div>
      </div>

      {/* ── Quality Report (audit findings, no rewrite) ── */}
      {qualityIssues.length > 0 && (
        <div style={{ padding: '0 16px', flexShrink: 0 }}>
          <div
            onClick={() => setShowQuality(!showQuality)}
            style={{ fontSize: '10px', color: 'var(--coral)', cursor: 'pointer', padding: '4px 8px', borderRadius: '6px', background: 'var(--coral-l)', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            ⚠ {qualityIssues.length} 个质量问题 {showQuality ? '▲' : '▼'}
          </div>
          {showQuality && (
            <div style={{ marginTop: '4px', maxHeight: '200px', overflowY: 'auto', fontSize: '10px', lineHeight: 1.5 }}>
              {qualityIssues.map((q, i) => (
                <div key={i} style={{ padding: '3px 6px', marginBottom: '2px', borderRadius: '4px', background: 'var(--bg2)', color: 'var(--text2)' }}>
                  <span style={{ color: 'var(--text3)', marginRight: '4px' }}>[{q.source}]</span>
                  <span style={{ fontWeight: 500 }}>{q.dimension || q.type || '?'}</span>
                  {q.description && <span>: {q.description}</span>}
                  {q.snippet && <span style={{ color: 'var(--text3)', marginLeft: '4px' }}>"{q.snippet}"</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Narrative Area ── */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 16px' }}>
        {messages.length === 0 && !streamingText && (
          <div style={{ textAlign: 'center', color: 'var(--text3)', padding: '60px 0' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>📖</div>
            <div style={{ fontSize: '14px' }}>剧情模式</div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>输入行动开始你的故事</div>
          </div>
        )}

        {messages.map((msg, i) => renderParagraph(msg, i))}

        {/* Streaming text */}
        {streamingText && (
          <div style={{
            paddingLeft: '16px',
            borderLeft: '2px solid var(--purple)',
            fontSize: '15px',
            lineHeight: 1.9,
            color: 'var(--text)',
            whiteSpace: 'pre-wrap',
          }}>
            {streamingText}
            <span style={{ display: 'inline-block', width: '2px', height: '16px', background: 'var(--purple)', marginLeft: '2px', animation: 'blink 1s infinite' }} />
          </div>
        )}

        {/* Loading */}
        {loading && !streamingText && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '16px', color: 'var(--text3)', fontSize: '13px' }}>
            <span>生成中</span>
            <span style={{ display: 'inline-flex', gap: '3px' }}>
              <span className="dot-bounce" style={{ width: '4px', height: '4px', borderRadius: '2px', background: 'var(--text3)' }} />
              <span className="dot-bounce" style={{ width: '4px', height: '4px', borderRadius: '2px', background: 'var(--text3)', animationDelay: '0.2s' }} />
              <span className="dot-bounce" style={{ width: '4px', height: '4px', borderRadius: '2px', background: 'var(--text3)', animationDelay: '0.4s' }} />
            </span>
          </div>
        )}

        {error && (
          <div style={{ textAlign: 'center', padding: '8px', color: 'var(--coral)', fontSize: '12px', background: 'var(--coral-l)', borderRadius: '8px' }}>
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Event Action Panel (floating) ── */}
      <EventActionPanel
        onDiceOpen={() => setShowDice(true)}
        onEditLast={handleEditLast}
        onDeleteLast={handleDeleteLast}
        hasMessages={messages.length > 0}
        tension={tension}
      />

      {/* ── Input ── */}
      <div style={{ padding: '10px 12px', borderTop: '0.5px solid var(--border)', flexShrink: 0 }}>
        {/* Editing indicator */}
        {editingIndex != null && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', padding: '4px 8px', borderRadius: '8px', background: 'var(--purple-l)', fontSize: '11px', color: 'var(--purple)' }}>
            <span>✏️ 正在编辑消息 — 修改后点发送，不发送请点取消</span>
            <button onClick={handleCancelEdit} style={{ padding: '2px 10px', borderRadius: '6px', border: 'none', background: 'var(--bg)', color: 'var(--text2)', fontSize: '11px', cursor: 'pointer' }}>取消编辑</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px' }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
          }}
          placeholder="输入你的行动…"
          rows={1}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: '12px',
            border: '0.5px solid var(--border)', background: 'var(--bg2)',
            fontSize: '14px', color: 'var(--text)', outline: 'none',
            resize: 'none', fontFamily: 'inherit', minHeight: '42px', maxHeight: '120px',
          }}
          onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px' }}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          style={{
            padding: '0 18px', borderRadius: '12px', border: 'none',
            background: loading || !input.trim() ? 'var(--bg3)' : 'var(--text)',
            color: loading || !input.trim() ? 'var(--text3)' : 'var(--bg)',
            fontSize: '14px', fontWeight: 500, cursor: loading || !input.trim() ? 'default' : 'pointer',
            flexShrink: 0,
          }}
        >
          发送
        </button>
        </div>
      </div>

      {/* ── Dice Modal ── */}
      {showDice && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }} onClick={() => { setShowDice(false); setDiceResult(null) }}>
          <div style={{ background: 'var(--bg)', borderRadius: '16px', padding: '24px', width: '280px', border: '0.5px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: 'center', fontSize: '16px', fontWeight: 600, color: 'var(--text)', marginBottom: '16px' }}>随机事件骰子</div>
            {diceRolling ? (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <span style={{ fontSize: '48px' }} className="animate-dice-roll">🎲</span>
              </div>
            ) : diceResult != null ? (
              <div style={{ textAlign: 'center', padding: '16px' }}>
                <div style={{ fontSize: '48px', marginBottom: '8px' }}>🎲</div>
                <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--purple)' }}>{diceResult}</div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text3)', fontSize: '13px' }}>
                点击下方按钮投掷
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button onClick={() => { setShowDice(false); setDiceResult(null) }} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '0.5px solid var(--border)', background: 'var(--bg)', color: 'var(--text2)', fontSize: '13px', cursor: 'pointer' }}>取消</button>
              {diceResult != null ? (
                <button onClick={handleDice} style={{ flex: 2, padding: '10px', borderRadius: '10px', border: 'none', background: 'var(--text)', color: 'var(--bg)', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}>确认触发</button>
              ) : (
                <button onClick={() => { setDiceRolling(true); setTimeout(() => { setDiceRolling(false); setDiceResult(Math.floor(Math.random() * 20) + 1) }, 800) }} style={{ flex: 2, padding: '10px', borderRadius: '10px', border: 'none', background: 'var(--text)', color: 'var(--bg)', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}>掷骰子</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
