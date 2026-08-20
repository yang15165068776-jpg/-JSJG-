import { useState, useEffect, useRef } from 'react'
import { getCharacter, saveCharacter, generateId, getApiKey } from '../../utils/storage'
import { generateAutonomySummary, fillCharacterFromSkeleton, extractStoryFromText, generateStageBehaviors } from '../../utils/deepseek'
import { compileCharacter, hasRCC } from '../../runtime/rcc'

const emptyStage = () => ({
  name: '',
  min: 0,
  max: 50,
  coreState: '',
  playerStrategy: '',
  riseCondition: '',
  languageSamples: '',
  classicLines: '',
  innerMonologue: '',
  forbiddenBehaviors: '',
  stageDetails: '',
  emotionalTraits: '',
  stageExplosion: '',
  selfDriveBehaviors: [],
})
const emptyRomanceChar = () => ({
  id: '',
  name: '',
  avatar: '',
  background: '',
  personality: '',
  styleRules: '',
  forbiddenWords: '',
  speakingStyle: '',
  affectionEnabled: true,
  affectionInitial: 50,
  affectionStages: [emptyStage()],
  transitionTriggers: '',
  irreversibleMoment: '',
  erosionCondition: '',
  anchorSuppression: '',
  thinkingEnabled: true,
  thinkingPrompt: '',
})
const emptyNpc = () => ({ id: '', name: '', identity: '', personality: '', background: '', avatar: '' })

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

export default function StoryCharacterForm({ mode, characterId, onSave, onCancel }) {
  const isEdit = !!characterId
  const [generatingAutonomy, setGeneratingAutonomy] = useState(false)
  const [generatingBehaviors, setGeneratingBehaviors] = useState(false)
  const [showExtractModal, setShowExtractModal] = useState(false)
  const [extractText, setExtractText] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [skeletonText, setSkeletonText] = useState('')
  const [showSkeletonModal, setShowSkeletonModal] = useState(false)
  const [fillingSkeleton, setFillingSkeleton] = useState(false)
  const [compilingRCC, setCompilingRCC] = useState(false)
  const [rccStatus, setRccStatus] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [expandedRC, setExpandedRC] = useState(0)
  const [expandedNPC, setExpandedNPC] = useState(0)

  const [form, setForm] = useState({
    id: '',
    name: '',
    avatar: '',
    // Protagonist
    protagonistName: '',
    protagonistGender: '',
    protagonistBackground: '',
    protagonistPersonality: '',
    // Block 1
    worldSetting: '',
    openingScenario: '',
    storyTone: '甜虐',
    // Block 2
    romanceCharacters: [emptyRomanceChar()],
    // Block 3
    npcs: [],
    // Block 4
    autoGenerateNpcs: true,
    npcStyleLimit: '',
    // Shared
    chatStyle: 'story',
    contextWindow: 40,
    showTimestamp: false,
    activeMessageEnabled: false,
    activePrompt: '',
    autoMessageEnabled: false,
    autoMessagePrompt: '',
    autonomyBehavior: '',
    temperature: 0.9,
    topP: 0.95,
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
          worldSetting: char.worldSetting || '',
          openingScenario: char.openingScenario || '',
          storyTone: char.storyTone || '甜虐',
          romanceCharacters: char.romanceCharacters?.length > 0
            ? char.romanceCharacters.map(rc => ({
                ...emptyRomanceChar(),
                ...rc,
                styleRules: Array.isArray(rc.styleRules) ? rc.styleRules.join('\n') : (rc.styleRules || ''),
                forbiddenWords: Array.isArray(rc.forbiddenWords) ? rc.forbiddenWords.join('\n') : (rc.forbiddenWords || ''),
                transitionTriggers: Array.isArray(rc.transitionTriggers) ? rc.transitionTriggers.join('\n') : (rc.transitionTriggers || ''),
                affectionStages: rc.affectionStages?.length > 0
                  ? rc.affectionStages.map(s => ({
                      ...emptyStage(),
                      ...s,
                      languageSamples: Array.isArray(s.languageSamples) ? s.languageSamples.join('\n') : (s.languageSamples || ''),
                      classicLines: Array.isArray(s.classicLines) ? s.classicLines.join('\n') : (s.classicLines || ''),
                      innerMonologue: Array.isArray(s.innerMonologue) ? s.innerMonologue.join('\n') : (s.innerMonologue || ''),
                      forbiddenBehaviors: Array.isArray(s.forbiddenBehaviors) ? s.forbiddenBehaviors.join('\n') : (s.forbiddenBehaviors || ''),
                    }))
                  : [emptyStage()],
              }))
            : [emptyRomanceChar()],
          npcs: char.npcs?.length > 0
            ? char.npcs.map(n => ({ ...emptyNpc(), ...n }))
            : [],
          autoGenerateNpcs: char.autoGenerateNpcs !== false,
          npcStyleLimit: char.npcStyleLimit || '',
          chatStyle: 'story',
          contextWindow: char.contextWindow || 40,
          showTimestamp: char.showTimestamp || false,
          activeMessageEnabled: char.activeMessageEnabled || false,
          activePrompt: char.activePrompt || '',
          autoMessageEnabled: char.autoMessageEnabled || false,
          autoMessagePrompt: char.autoMessagePrompt || '',
          autonomyBehavior: char.autonomyBehavior || '',
          temperature: char.temperature ?? 0.9,
          topP: char.topP ?? 0.95,
        })
      }
    }
  }, [characterId, mode])

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }))

  // Romance character helpers
  const updateRC = (index, field, value) => {
    const chars = [...form.romanceCharacters]
    chars[index] = { ...chars[index], [field]: value }
    setForm(prev => ({ ...prev, romanceCharacters: chars }))
  }

  const updateRCStage = (rcIdx, stageIdx, field, value) => {
    const chars = [...form.romanceCharacters]
    const stages = [...chars[rcIdx].affectionStages]
    stages[stageIdx] = { ...stages[stageIdx], [field]: value }
    chars[rcIdx] = { ...chars[rcIdx], affectionStages: stages }
    setForm(prev => ({ ...prev, romanceCharacters: chars }))
  }

  const addRCStage = (rcIdx) => {
    const chars = [...form.romanceCharacters]
    chars[rcIdx] = { ...chars[rcIdx], affectionStages: [...chars[rcIdx].affectionStages, emptyStage()] }
    setForm(prev => ({ ...prev, romanceCharacters: chars }))
  }

  const removeRCStage = (rcIdx, stageIdx) => {
    const chars = [...form.romanceCharacters]
    if (chars[rcIdx].affectionStages.length <= 1) return
    chars[rcIdx] = {
      ...chars[rcIdx],
      affectionStages: chars[rcIdx].affectionStages.filter((_, i) => i !== stageIdx),
    }
    setForm(prev => ({ ...prev, romanceCharacters: chars }))
  }

  const addRCStageBehavior = (rcIdx, stageIdx) => {
    const chars = [...form.romanceCharacters]
    const stages = [...chars[rcIdx].affectionStages]
    stages[stageIdx] = {
      ...stages[stageIdx],
      selfDriveBehaviors: [...(stages[stageIdx].selfDriveBehaviors || []), { description: '', trigger: 'overNrounds' }],
    }
    chars[rcIdx] = { ...chars[rcIdx], affectionStages: stages }
    setForm(prev => ({ ...prev, romanceCharacters: chars }))
  }

  const removeRCStageBehavior = (rcIdx, stageIdx, behIdx) => {
    const chars = [...form.romanceCharacters]
    const stages = [...chars[rcIdx].affectionStages]
    stages[stageIdx] = {
      ...stages[stageIdx],
      selfDriveBehaviors: (stages[stageIdx].selfDriveBehaviors || []).filter((_, i) => i !== behIdx),
    }
    chars[rcIdx] = { ...chars[rcIdx], affectionStages: stages }
    setForm(prev => ({ ...prev, romanceCharacters: chars }))
  }

  const updateRCStageBehavior = (rcIdx, stageIdx, behIdx, field, value) => {
    const chars = [...form.romanceCharacters]
    const stages = [...chars[rcIdx].affectionStages]
    const behaviors = [...(stages[stageIdx].selfDriveBehaviors || [])]
    behaviors[behIdx] = { ...behaviors[behIdx], [field]: value }
    stages[stageIdx] = { ...stages[stageIdx], selfDriveBehaviors: behaviors }
    chars[rcIdx] = { ...chars[rcIdx], affectionStages: stages }
    setForm(prev => ({ ...prev, romanceCharacters: chars }))
  }

  const addRomanceChar = () => {
    if (form.romanceCharacters.length >= 3) return
    setForm(prev => ({ ...prev, romanceCharacters: [...prev.romanceCharacters, emptyRomanceChar()] }))
    setExpandedRC(form.romanceCharacters.length)
  }

  const removeRomanceChar = (index) => {
    if (form.romanceCharacters.length <= 1) return
    setForm(prev => ({
      ...prev,
      romanceCharacters: prev.romanceCharacters.filter((_, i) => i !== index),
    }))
    if (expandedRC >= form.romanceCharacters.length - 1) {
      setExpandedRC(Math.max(0, form.romanceCharacters.length - 2))
    }
  }

  const handleRCAvatar = async (index, file) => {
    if (!file) return
    const base64 = await imageToBase64(file)
    updateRC(index, 'avatar', base64)
  }

  // NPC helpers
  const updateNpc = (index, field, value) => {
    const npcs = [...form.npcs]
    npcs[index] = { ...npcs[index], [field]: value }
    setForm(prev => ({ ...prev, npcs }))
  }

  const addNpc = () => {
    setForm(prev => ({ ...prev, npcs: [...prev.npcs, emptyNpc()] }))
  }

  const removeNpc = (index) => {
    setForm(prev => ({ ...prev, npcs: prev.npcs.filter((_, i) => i !== index) }))
  }

  const handleNpcAvatar = async (index, file) => {
    if (!file) return
    const base64 = await imageToBase64(file)
    updateNpc(index, 'avatar', base64)
  }

  // Avatar for main story
  const avatarInputRef = useRef(null)
  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const base64 = await imageToBase64(file)
    update('avatar', base64)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      alert('请输入故事名称')
      return
    }
    const validRC = form.romanceCharacters.filter(rc => rc.name.trim())
    if (validRC.length === 0) {
      alert('至少需要一个可攻略角色')
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
      worldSetting: form.worldSetting.trim(),
      openingScenario: form.openingScenario.trim(),
      storyTone: form.storyTone,
      romanceCharacters: validRC.map(rc => ({
        id: rc.id || generateId(),
        name: rc.name.trim(),
        avatar: rc.avatar || '',
        background: rc.background.trim(),
        personality: rc.personality.trim(),
        styleRules: parseLines(rc.styleRules),
        forbiddenWords: parseLines(rc.forbiddenWords),
        speakingStyle: rc.speakingStyle.trim(),
        affectionEnabled: rc.affectionEnabled,
        affectionInitial: rc.affectionEnabled ? rc.affectionInitial : 50,
        affectionStages: rc.affectionEnabled
          ? rc.affectionStages.filter(s => s.name.trim()).map(s => ({
              name: s.name.trim(),
              min: s.min != null ? Number(s.min) : 0,
              max: s.max != null ? Number(s.max) : 50,
              coreState: s.coreState.trim(),
              playerStrategy: s.playerStrategy.trim(),
              riseCondition: s.riseCondition.trim(),
              languageSamples: parseLines(s.languageSamples),
              classicLines: parseLines(s.classicLines),
              innerMonologue: parseLines(s.innerMonologue),
              forbiddenBehaviors: parseLines(s.forbiddenBehaviors),
              selfDriveBehaviors: (s.selfDriveBehaviors || []).filter(b => b.description.trim()),
              stageDetails: s.stageDetails?.trim() || '',
              emotionalTraits: s.emotionalTraits?.trim() || '',
              stageExplosion: s.stageExplosion?.trim() || '',
            }))
          : [],
        transitionTriggers: rc.affectionEnabled ? parseLines(rc.transitionTriggers) : [],
        irreversibleMoment: rc.affectionEnabled ? rc.irreversibleMoment.trim() : '',
        erosionCondition: rc.affectionEnabled ? rc.erosionCondition.trim() : '',
        anchorSuppression: rc.affectionEnabled ? rc.anchorSuppression.trim() : '',
        thinkingEnabled: true,
        thinkingPrompt: '',
      })),
      npcs: form.npcs.filter(n => n.name.trim()).map(n => ({
        id: n.id || generateId(),
        name: n.name.trim(),
        identity: (n.identity || '').trim(),
        personality: n.personality.trim(),
        background: (n.background || '').trim(),
        avatar: n.avatar || '',
      })),
      autoGenerateNpcs: form.autoGenerateNpcs,
      npcStyleLimit: form.npcStyleLimit.trim(),
      chatStyle: 'story',
      contextWindow: form.contextWindow || 40,
      showTimestamp: form.showTimestamp || false,
      activeMessageEnabled: form.activeMessageEnabled || false,
      activePrompt: form.activeMessageEnabled ? form.activePrompt.trim() : '',
      autoMessageEnabled: form.autoMessageEnabled || false,
      autoMessagePrompt: form.autoMessageEnabled ? form.autoMessagePrompt.trim() : '',
      autonomyBehavior: form.autonomyBehavior.trim(),
      temperature: form.temperature ?? 0.9,
      topP: form.topP ?? 0.95,
      updatedAt: Date.now(),
    }

    saveCharacter(character, mode)

    // ── RCC v1: Compile character constitution ──
    const apiKey = getApiKey()
    if (apiKey && !hasRCC(character)) {
      setCompilingRCC(true)
      setRccStatus('⚙️ 正在编译角色宪法...')
      try {
        const result = await compileCharacter(character, apiKey)
        if (result.success && result.rcc) {
          character._rcc = result.rcc
          saveCharacter(character, mode) // Re-save with compiled RCC
          const articleCount = result.rcc.constitution?.length || 0
          setRccStatus('✅ 宪法编译完成：' + articleCount + ' 条规则')
          console.log('[RCC] Compiled for character:', character.name,
            '| articles:', articleCount,
            '| guide fields:', Object.keys(result.rcc.runtimeGuide).filter(k => result.rcc.runtimeGuide[k]).length,
            '| psych fields:', Object.keys(result.rcc.hiddenPsychology).filter(k => result.rcc.hiddenPsychology[k]).length)
        } else {
          setRccStatus('⚠️ 编译失败：' + (result.error || '未知错误') + '（角色已保存，可后续重新编译）')
          console.warn('[RCC] Compilation failed:', result.error)
        }
      } catch (err) {
        setRccStatus('⚠️ 编译异常：' + err.message)
        console.error('[RCC] Compilation exception:', err)
      }
      setCompilingRCC(false)
    }

    onSave()
  }

  const handleExtract = async () => {
    const text = extractText.trim()
    if (!text) return
    const apiKey = getApiKey()
    if (!apiKey) {
      alert('请先在设置页面填写 DeepSeek API Key')
      return
    }
    setExtracting(true)
    const { result, error } = await extractStoryFromText(text, apiKey)
    setExtracting(false)
    if (error || !result) {
      alert('提取失败：' + (error?.message || '未知错误'))
      return
    }

    // Apply extracted data to form
    const rc = result['可攻略角色'] || []
    const npcs = result['主要NPC'] || []

    setForm(prev => ({
      ...prev,
      name: result['故事名称'] || prev.name,
      worldSetting: result['世界观'] || prev.worldSetting,
      openingScenario: result['开场剧情'] || prev.openingScenario,
      storyTone: result['故事基调'] || prev.storyTone,
      romanceCharacters: rc.length > 0
        ? rc.map((r, i) => ({
            ...emptyRomanceChar(),
            name: r['角色名'] || '',
            background: r['背景'] || '',
            personality: r['性格'] || '',
            styleRules: Array.isArray(r['文风规则']) ? r['文风规则'].join('\n') : (r['文风规则'] || ''),
            forbiddenWords: Array.isArray(r['禁止行为']) ? r['禁止行为'].join('\n') : (r['禁止行为'] || ''),
            speakingStyle: r['说话风格'] || '',
            affectionEnabled: true,
            affectionInitial: r['好感度初始'] ?? 50,
            affectionStages: Array.isArray(r['好感度阶段']) && r['好感度阶段'].length > 0
              ? r['好感度阶段'].map(s => ({
                  name: s.label || s.name || '',
                  min: s.min != null ? Number(s.min) : 0,
                  max: s.max != null ? Number(s.max) : 50,
                  coreState: s.coreState || '',
                  playerStrategy: s.playerStrategy || '',
                  riseCondition: s.riseCondition || '',
                  languageSamples: Array.isArray(s.languageSamples) ? s.languageSamples.join('\n') : (s.languageSamples || ''),
                  classicLines: Array.isArray(s.classicLines) ? s.classicLines.join('\n') : (s.classicLines || ''),
                  innerMonologue: Array.isArray(s.innerMonologue) ? s.innerMonologue.join('\n') : (s.innerMonologue || ''),
                  forbiddenBehaviors: Array.isArray(s.forbiddenBehaviors) ? s.forbiddenBehaviors.join('\n') : (s.forbiddenBehaviors || ''),
                  selfDriveBehaviors: Array.isArray(s.selfDriveBehaviors)
                    ? s.selfDriveBehaviors.map(b => ({
                        description: b.behavior || b.description || '',
                        trigger: b.trigger || 'overNrounds',
                      }))
                    : [],
                  stageDetails: Array.isArray(s.stageDetails) ? s.stageDetails.join('\n') : (s.stageDetails || ''),
                  emotionalTraits: Array.isArray(s.emotionalTraits) ? s.emotionalTraits.join('\n') : (s.emotionalTraits || ''),
                  stageExplosion: s.stageExplosion || '',
                }))
              : [emptyStage()],
            transitionTriggers: Array.isArray(r['transitionTriggers']) ? r['transitionTriggers'].join('\n') : (r['transitionTriggers'] || ''),
            irreversibleMoment: r['irreversibleMoment'] || '',
            erosionCondition: r['erosionCondition'] || '',
            anchorSuppression: r['anchorSuppression'] || '',
            thinkingEnabled: true,
            thinkingPrompt: '',
          }))
        : prev.romanceCharacters,
      npcs: npcs.length > 0
        ? npcs.map(n => ({
            ...emptyNpc(),
            name: n['NPC名'] || '',
            relationship: n['关系'] || '',
            personality: n['性格'] || '',
            avatar: '',
          }))
        : prev.npcs,
    }))

    setShowExtractModal(false)
    setExtractText('')
    if (rc.length > 0) setExpandedRC(0)
  }

  // ── Fill character from skeleton ──
  const handleFillSkeleton = async () => {
    const text = skeletonText.trim()
    if (!text) return
    const apiKey = getApiKey()
    if (!apiKey) {
      alert('请先在设置页面填写 DeepSeek API Key')
      return
    }
    setFillingSkeleton(true)
    const { result, error } = await fillCharacterFromSkeleton(text, apiKey)
    setFillingSkeleton(false)
    if (error || !result) {
      alert('骨架填充失败：' + (error?.message || '未知错误'))
      return
    }

    // Map skeleton output to currently expanded romance character
    const rcIdx = expandedRC
    const updatedRC = [...form.romanceCharacters]
    const current = { ...(updatedRC[rcIdx] || emptyRomanceChar()) }

    // Core identity
    if (result['角色名']) current.name = result['角色名']
    if (result['背景']) current.background = result['背景']
    if (result['性格']) current.personality = result['性格']
    if (result['说话风格']) current.speakingStyle = result['说话风格']

    // Arrays → join with newlines
    if (Array.isArray(result['文风规则'])) current.styleRules = result['文风规则'].join('\n')
    else if (result['文风规则']) current.styleRules = result['文风规则']
    if (Array.isArray(result['禁止行为'])) current.forbiddenWords = result['禁止行为'].join('\n')
    else if (result['禁止行为']) current.forbiddenWords = result['禁止行为']

    // Affection
    if (result['好感度初始'] != null) current.affectionInitial = result['好感度初始']

    // Affection stages → map extensively
    const rawStages = result['好感度阶段'] || []
    if (rawStages.length > 0) {
      current.affectionStages = rawStages.map(s => ({
        ...emptyStage(),
        name: s.label || s.name || '',
        min: s.min != null ? Number(s.min) : 0,
        max: s.max != null ? Number(s.max) : 50,
        coreState: s.coreState || '',
        playerStrategy: s.playerStrategy || '',
        riseCondition: s.riseCondition || '',
        languageSamples: Array.isArray(s.languageSamples) ? s.languageSamples.join('\n') : (s.languageSamples || ''),
        classicLines: Array.isArray(s.classicLines) ? s.classicLines.join('\n') : (s.classicLines || ''),
        innerMonologue: Array.isArray(s.innerMonologue) ? s.innerMonologue.join('\n') : (s.innerMonologue || ''),
        forbiddenBehaviors: Array.isArray(s.forbiddenBehaviors) ? s.forbiddenBehaviors.join('\n') : (s.forbiddenBehaviors || ''),
        stageDetails: Array.isArray(s.stageDetails) ? s.stageDetails.join('\n') : (s.stageDetails || ''),
        emotionalTraits: Array.isArray(s.emotionalTraits) ? s.emotionalTraits.join('\n') : (s.emotionalTraits || ''),
        stageExplosion: s.stageExplosion || '',
        selfDriveBehaviors: Array.isArray(s.selfDriveBehaviors)
          ? s.selfDriveBehaviors.map(b => ({
              description: b.behavior || b.description || '',
              trigger: b.trigger || 'overNrounds',
            }))
          : [],
      }))
    }

    // Advanced fields
    if (result['transitionTriggers']) current.transitionTriggers = result['transitionTriggers']
    if (result['irreversibleMoment']) current.irreversibleMoment = result['irreversibleMoment']
    if (result['erosionCondition']) current.erosionCondition = result['erosionCondition']
    if (result['anchorSuppression']) current.anchorSuppression = result['anchorSuppression']

    // Opening scene → form-level field
    updatedRC[rcIdx] = current
    const newForm = { ...form, romanceCharacters: updatedRC }
    if (result['openingScene']) newForm.openingScenario = result['openingScene']

    setForm(newForm)
    setShowSkeletonModal(false)
    setSkeletonText('')
    alert('✅ 角色骨架填充完成！请检查各字段，特别是好感度阶段数值范围。')
  }

  const handleGenerateBehaviors = async () => {
    const apiKey = getApiKey()
    if (!apiKey) {
      alert('请先在设置页面填写 DeepSeek API Key')
      return
    }
    const validRC = form.romanceCharacters.filter(rc => rc.name.trim())
    if (validRC.length === 0) {
      alert('请先填写至少一个可攻略角色的姓名')
      return
    }
    setGeneratingBehaviors(true)
    try {
      const updatedRC = [...form.romanceCharacters]
      for (let i = 0; i < updatedRC.length; i++) {
        const rc = updatedRC[i]
        if (!rc.name.trim() || rc.affectionStages.length === 0) continue
        const { result, error } = await generateStageBehaviors({
          name: rc.name,
          background: rc.background,
          personality: rc.personality,
          styleRules: rc.styleRules,
          speakingStyle: rc.speakingStyle,
          affectionStages: rc.affectionStages,
        }, apiKey)
        if (error || !result) {
          console.error('[generateBehaviors] 角色 ' + rc.name + ' 生成失败:', error)
          continue
        }
        // Map returned behaviors into stages
        const aiStages = result.stages || []
        const newStages = rc.affectionStages.map(stage => {
          const match = aiStages.find(s => s.label === stage.name) || aiStages.find(s => s.label.includes(stage.name)) || (aiStages.length > 0 ? aiStages[0] : null)
          // Find by index fallback
          const stageIdx = rc.affectionStages.indexOf(stage)
          const aiMatch = match || (aiStages[stageIdx] || null)
          if (aiMatch && Array.isArray(aiMatch.behaviors)) {
            return {
              ...stage,
              selfDriveBehaviors: aiMatch.behaviors.map(b => ({
                description: b.behavior || b.description || '',
                trigger: b.trigger || 'overNrounds',
              })),
            }
          }
          return stage
        })
        updatedRC[i] = { ...rc, affectionStages: newStages }
      }
      setForm(prev => ({ ...prev, romanceCharacters: updatedRC }))
    } catch (err) {
      alert('生成失败：' + err.message)
    }
    setGeneratingBehaviors(false)
  }

  const inputStyle = { width:'100%', padding:'10px 14px', borderRadius:'10px', border:'0.5px solid var(--border)', background:'var(--bg2)', fontSize:'14px', color:'var(--text)', fontFamily:'inherit', outline:'none' }
  const sectionStyle = { background:'var(--bg2)', borderRadius:'12px', padding:'16px', marginBottom:'12px' }
  const labelStyle = { fontSize:'13px', color:'var(--text2)', display:'block', marginBottom:'6px' }
  const groupTitle = { fontSize:'12px', color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'8px', marginTop:'24px' }
  const inputClass = ''

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'var(--bg)' }}>
      <div style={{ height:'56px', display:'flex', alignItems:'center', padding:'0 16px', gap:'12px', borderBottom:'0.5px solid var(--border2)', flexShrink:0 }}>
        <button type="button" onClick={onCancel} style={{ width:'32px', height:'32px', borderRadius:'50%', background:'var(--bg2)', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'18px', color:'var(--text2)' }}>←</button>
        <span style={{ flex:1, fontSize:'16px', fontWeight:500, color:'var(--text)' }}>{characterId?'编辑':'新建'}剧情角色</span>
        <button type="submit" style={{ padding:'8px 16px', borderRadius:'8px', border:'none', background:'var(--purple)', color:'#fff', fontSize:'13px', fontWeight:500, cursor:'pointer' }}>{characterId?'保存':'创建'}</button>
      </div>
      <form onSubmit={handleSubmit} style={{ flex:1, overflowY:'auto', padding:'20px 16px', paddingBottom:'40px' }}>
      {/* Story name */}
      <div>
        <label style={labelStyle}>故事名称 *</label>
        <input
          type="text"
          style={inputStyle}
          value={form.name}
          onChange={e => update('name', e.target.value)}
          placeholder="给你的故事起个名字"
        />
      </div>

      {/* Avatar + AI Extract */}
      <div className="flex gap-3 items-end">
        <div>
          <label style={labelStyle}>故事封面（可选）</label>
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          <div
            onClick={() => avatarInputRef.current?.click()}
            className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-500 hover:border-blue-400 flex items-center justify-center overflow-hidden cursor-pointer transition-colors bg-gray-800"
          >
            {form.avatar ? (
              <img src={form.avatar} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="text-center text-gray-500">
                <div className="text-2xl leading-none">+</div>
                <div className="text-[10px]">封面</div>
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowExtractModal(true)}
          className="px-4 py-2.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-sm font-medium transition-all active:scale-[0.98]"
        >
          🤖 AI 一键抓取
        </button>
      </div>

      {/* Player identity notice */}
      <div style={{ ...sectionStyle, padding: '12px 14px', borderRadius: '12px', border: '0.5px solid var(--purple-l)', background: 'var(--purple-l)' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--purple)', marginBottom: '4px' }}>👤 玩家身份</div>
        <p style={{ fontSize: '11px', color: 'var(--purple)', lineHeight: 1.5, margin: 0 }}>
          你的名字、性别、设定等信息在<b>玩家身份</b>中统一管理。角色会自动识别当前活跃的玩家身份并据此推进剧情。
        </p>
      </div>

      {/* ========== BLOCK 1: World & Plot ========== */}
      <div style={sectionStyle}>
        <h3 className="text-sm font-medium text-gray-200 mb-3">📖 世界观与剧情设定</h3>

        <div className="space-y-3">
          <div>
            <label style={labelStyle}>世界观描述</label>
            <textarea
              className={inputClass + " h-28 resize-none"}
              value={form.worldSetting}
              onChange={e => update('worldSetting', e.target.value)}
              placeholder="描述故事发生的世界背景、时代、社会结构、魔法/科技体系等..."
            />
          </div>

          <div>
            <label style={labelStyle}>开场剧情</label>
            <p className="text-[10px] text-gray-500 mb-2">AI第一条消息使用的开场内容，不计入对话历史</p>
            <textarea
              className={inputClass + " h-24 resize-none"}
              value={form.openingScenario}
              onChange={e => update('openingScenario', e.target.value)}
              placeholder="例如：深夜的咖啡馆里，窗外飘着细雨。你推开门，看到一个熟悉的身影坐在角落..."
            />
          </div>

          <div>
            <label style={labelStyle}>故事基调</label>
            <div className="flex gap-2">
              {['甜虐', '纯爱', '悬疑', '其他'].map(tone => (
                <button
                  key={tone}
                  type="button"
                  onClick={() => update('storyTone', tone)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    form.storyTone === tone
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {tone}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ========== BLOCK 2: Romance Characters ========== */}
      <div style={sectionStyle}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium text-gray-200">💕 可攻略角色</h3>
            <p className="text-xs text-gray-500 mt-0.5">最少1个，最多3个</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowSkeletonModal(true)}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium transition-colors"
            >
              🧬 从骨架填充
            </button>
            {form.romanceCharacters.length < 3 && (
              <button
                type="button"
                onClick={addRomanceChar}
                className="px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-xs font-medium transition-colors"
              >
                + 添加攻略角色
              </button>
          )}
          </div>
        </div>

        <div className="space-y-3">
          {form.romanceCharacters.map((rc, i) => (
            <div key={i} className="bg-gray-700/30 rounded-lg border border-gray-700/50 overflow-hidden">
              {/* Header bar */}
              <button
                type="button"
                onClick={() => setExpandedRC(expandedRC === i ? -1 : i)}
                className="w-full flex items-center justify-between p-3 hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {rc.avatar ? (
                    <img src={rc.avatar} alt="" className="w-7 h-7 rounded-full object-cover" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center text-xs text-gray-300">
                      {rc.name ? rc.name[0] : '?'}
                    </div>
                  )}
                  <span className="text-sm font-medium text-gray-200">
                    {rc.name || '未命名角色 ' + (i + 1)}
                  </span>
                  <span className="text-[10px] text-gray-500">
                    {i === 0 ? '(默认)' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {i > 0 && (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); removeRomanceChar(i) }}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      删除
                    </button>
                  )}
                  <span className="text-gray-500 text-xs">{expandedRC === i ? '▲' : '▼'}</span>
                </div>
              </button>

              {/* Expanded content */}
              {expandedRC === i && (
                <div className="p-3 pt-0 space-y-3 border-t border-gray-700/50">
                  {/* Name + Avatar */}
                  <div className="flex gap-3 items-end">
                    <div>
                      <input
                        ref={el => { if (el) el._rcIdx = i }}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleRCAvatar(i, f) }}
                        id={`rc-avatar-${i}`}
                      />
                      <label
                        htmlFor={`rc-avatar-${i}`}
                        className="w-14 h-14 rounded-full border-2 border-dashed border-gray-500 hover:border-pink-400 flex items-center justify-center overflow-hidden cursor-pointer transition-colors bg-gray-600 flex-shrink-0 block"
                      >
                        {rc.avatar ? (
                          <img src={rc.avatar} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-gray-400 text-lg">+</span>
                        )}
                      </label>
                    </div>
                    <div className="flex-1">
                      <label style={labelStyle}>姓名</label>
                      <input
                        type="text"
                        style={inputStyle}
                        value={rc.name}
                        onChange={e => updateRC(i, 'name', e.target.value)}
                        placeholder="角色姓名"
                      />
                    </div>
                  </div>

                  {/* Background */}
                  <div>
                    <label style={labelStyle}>详细背景设定（内部真相、身世、行为根源）</label>
                    <textarea
                      className={inputClass + " h-36 resize-y"}
                      value={rc.background}
                      onChange={e => updateRC(i, 'background', e.target.value)}
                      placeholder="角色的完整背景。包括：童年/身世、核心创伤、行为根源、私生活状态、外貌武器化方式、对感情的态度……越详细AI越能准确扮演。"
                    />
                  </div>

                  {/* Personality */}
                  <div>
                    <label style={labelStyle}>性格核心</label>
                    <textarea
                      className={inputClass + " h-24 resize-y"}
                      value={rc.personality}
                      onChange={e => updateRC(i, 'personality', e.target.value)}
                      placeholder="核心性格特征、价值观、行为模式、对外展示vs内部真相的双层结构..."
                    />
                  </div>

                  {/* Style rules */}
                  <div>
                    <label style={labelStyle}>文风规则 & 体态动作（每行一条）</label>
                    <textarea
                      className={inputClass + " h-24 resize-y"}
                      value={rc.styleRules}
                      onChange={e => updateRC(i, 'styleRules', e.target.value)}
                      placeholder="该角色的对话风格、肢体语言、习惯性动作、说话节奏。例如：站姿松散像猫科动物、说话时精确控制目光停留时长、靠在门框上时重心压在一条腿上…"
                    />
                  </div>

                  {/* Forbidden words */}
                  <div>
                    <label style={labelStyle}>禁止行为（每行一条）</label>
                    <textarea
                      className={inputClass + " h-24 resize-y"}
                      value={rc.forbiddenWords}
                      onChange={e => updateRC(i, 'forbiddenWords', e.target.value)}
                      placeholder="该角色不应出现的言行"
                    />
                  </div>

                  {/* Speaking style */}
                  <div>
                    <label style={labelStyle}>说话风格描述</label>
                    <input
                      type="text"
                      style={inputStyle}
                      value={rc.speakingStyle}
                      onChange={e => updateRC(i, 'speakingStyle', e.target.value)}
                      placeholder="例如：温柔体贴、爱用古诗词、说话带刺、沉默寡言"
                    />
                  </div>

                  {/* Affection toggle */}
                  <div className="bg-gray-800/50 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-medium text-gray-300">好感度系统</h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateRC(i, 'affectionEnabled', !rc.affectionEnabled)}
                        className={`w-10 h-5 rounded-full transition-colors relative ${
                          rc.affectionEnabled ? 'bg-pink-500' : 'bg-gray-600'
                        }`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          rc.affectionEnabled ? 'left-[20px]' : 'left-[2px]'
                        }`} />
                      </button>
                    </div>
                    {rc.affectionEnabled && (
                      <div className="mt-3 space-y-3">
                        <div>
                          <label className="text-[11px] text-gray-500">初始好感度</label>
                          <input
                            type="number" min="0" max="100"
                            className={inputClass + " mt-0.5"}
                            value={rc.affectionInitial}
                            onChange={e => updateRC(i, 'affectionInitial', Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                          />
                        </div>

                        {/* Affection Stages */}
                        <div>
                          <label className="text-[11px] text-gray-500">好感度阶段</label>
                          <div className="space-y-2 mt-1">
                            {rc.affectionStages.map((stage, si) => (
                              <div key={si} className="bg-gray-700/50 rounded p-2 space-y-1.5">
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-gray-500 font-medium">阶段 {si + 1}</span>
                                  {rc.affectionStages.length > 1 && (
                                    <button type="button" onClick={() => removeRCStage(i, si)} className="text-[10px] text-red-400 hover:text-red-300">删除</button>
                                  )}
                                </div>
                                <input type="text" style={inputStyle} value={stage.name} onChange={e => updateRCStage(i, si, 'name', e.target.value)} placeholder="阶段标题（如：冷漠期）" />
                                <div className="flex gap-2">
                                  <input type="number" min="0" max="100" style={inputStyle} value={stage.min} onChange={e => updateRCStage(i, si, 'min', parseInt(e.target.value) || 0)} placeholder="下限" />
                                  <input type="number" min="0" max="100" style={inputStyle} value={stage.max} onChange={e => updateRCStage(i, si, 'max', parseInt(e.target.value) || 0)} placeholder="上限" />
                                </div>
                                <textarea className={inputClass + " h-20 resize-y"} value={stage.coreState} onChange={e => updateRCStage(i, si, 'coreState', e.target.value)} placeholder="角色状态描述（越详细越好——AI会根据此描述塑造角色的整体气场和存在方式）" />
                                <textarea className={inputClass + " h-20 resize-y"} value={stage.playerStrategy} onChange={e => updateRCStage(i, si, 'playerStrategy', e.target.value)} placeholder="对玩家的核心策略（他怎么对待你？用什么手段？目的是什么？）" />
                                <textarea className={inputClass + " h-20 resize-y"} value={stage.riseCondition} onChange={e => updateRCStage(i, si, 'riseCondition', e.target.value)} placeholder="上涨触发条件（什么行为会让他好感上升？不是被善待——是预期被打破）" />
                                <textarea className={inputClass + " h-24 resize-y"} value={stage.languageSamples} onChange={e => updateRCStage(i, si, 'languageSamples', e.target.value)} placeholder="【语言样本】本阶段角色的实际对话示例。每行一句。AI会严格模仿此语气和句式。越多越准确。" />
                                <textarea className={inputClass + " h-24 resize-y"} value={stage.classicLines} onChange={e => updateRCStage(i, si, 'classicLines', e.target.value)} placeholder="【经典台词】本阶段最具代表性的台词（带情境）。格式：情境描述 + 台词。例如：你加班晚归时——他靠在门框上：「钥匙在门垫下面。热水器按两次。」" />
                                <textarea className={inputClass + " h-24 resize-y"} value={stage.innerMonologue} onChange={e => updateRCStage(i, si, 'innerMonologue', e.target.value)} placeholder="【内心独白】本阶段角色的典型内心活动。AI会在<think>标签中参考此内容。例如：'又一个。两周，撑死三周。'" />
                                <textarea className={inputClass + " h-24 resize-y"} value={stage.forbiddenBehaviors} onChange={e => updateRCStage(i, si, 'forbiddenBehaviors', e.target.value)} placeholder="本阶段禁止行为（每行一条。违反即重写）" />

                                <textarea className={inputClass + " h-28 resize-y"} value={stage.stageDetails} onChange={e => updateRCStage(i, si, 'stageDetails', e.target.value)} placeholder="【本阶段表现细节】每行一条具体行为。AI会将其作为高频自发动作执行。写得越细，角色越活。" />
                                <textarea className={inputClass + " h-28 resize-y"} value={stage.emotionalTraits} onChange={e => updateRCStage(i, si, 'emotionalTraits', e.target.value)} placeholder="【核心情绪与心理逻辑】每行一条情绪锁。AI会将其作为底层心理驱动力。例如：任何你对他的冷淡都会让他陷入恐慌，但他会用更恶劣的态度掩饰。" />
                                <textarea className={inputClass + " h-32 resize-y"} value={stage.stageExplosion} onChange={e => updateRCStage(i, si, 'stageExplosion', e.target.value)} placeholder="【阶段爆发/转折点名场面】描述本阶段可能引爆的关键剧情高光。AI会在剧情冲突激化时参考此场景进行收拢或爆发。" />

                                {/* Self-drive behaviors */}
                                <div className="border-t border-gray-600/50 pt-1.5 mt-1.5">
                                  <label className="text-[10px] text-amber-400 font-medium">该阶段自驱行为（3-5条）</label>
                                  {(stage.selfDriveBehaviors || []).map((beh, bi) => (
                                    <div key={bi} className="flex gap-1.5 mt-1 items-start">
                                      <div className="flex-1 space-y-1">
                                        <input
                                          type="text"
                                          style={inputStyle}
                                          value={beh.description}
                                          onChange={e => updateRCStageBehavior(i, si, bi, 'description', e.target.value)}
                                          placeholder="行为描述（角色会做什么）"
                                        />
                                        <select
                                          className={inputClass + " text-[11px]"}
                                          value={beh.trigger}
                                          onChange={e => updateRCStageBehavior(i, si, bi, 'trigger', e.target.value)}
                                        >
                                          <option value="overNrounds">超过N轮用户没主动互动</option>
                                          <option value="sceneElement">场景出现特定元素</option>
                                          <option value="stageEnter">好感度刚进入本阶段</option>
                                          <option value="selfDisadvantage">AI判断局面对自己不利</option>
                                        </select>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => removeRCStageBehavior(i, si, bi)}
                                        className="text-[10px] text-red-400 hover:text-red-300 mt-1 flex-shrink-0"
                                      >
                                        删除
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() => addRCStageBehavior(i, si)}
                                    className="w-full py-1 mt-1.5 rounded border border-dashed border-gray-600 text-gray-400 text-[10px] hover:border-gray-500"
                                  >
                                    + 添加自驱行为
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                          <button type="button" onClick={() => addRCStage(i)} className="w-full py-1.5 mt-1 rounded border border-dashed border-gray-600 text-gray-400 text-xs hover:border-gray-500">+ 添加阶段</button>
                        </div>

                        {/* Transition Anchors */}
                        <div className="bg-gray-700/50 rounded p-2 space-y-2">
                          <label className="text-[11px] text-gray-400 font-medium">阶段转折锚点</label>
                          <textarea className={inputClass + " h-16 resize-none"} value={rc.transitionTriggers} onChange={e => updateRC(i, 'transitionTriggers', e.target.value)} placeholder="各阶段转折的触发事件类型（每行一个）" />
                          <div>
                            <label className="text-[10px] text-gray-500">不可逆转折描述</label>
                            <textarea className={inputClass + " h-12 resize-none mt-0.5"} value={rc.irreversibleMoment} onChange={e => updateRC(i, 'irreversibleMoment', e.target.value)} placeholder="不可逆转折的详细描述" />
                          </div>
                        </div>

                        {/* Iron Law */}
                        <div className="bg-gray-700/50 rounded p-2 space-y-2">
                          <label className="text-[11px] text-gray-400 font-medium">数值增长铁律</label>
                          <div>
                            <label className="text-[10px] text-gray-500">反向侵蚀条件（什么情况下反而-值）</label>
                            <textarea className={inputClass + " h-12 resize-none mt-0.5"} value={rc.erosionCondition} onChange={e => updateRC(i, 'erosionCondition', e.target.value)} placeholder="例如：连续3轮没有任何情绪波动" />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500">现实锚点压制（哪类场景本轮禁止上涨）</label>
                            <textarea className={inputClass + " h-12 resize-none mt-0.5"} value={rc.anchorSuppression} onChange={e => updateRC(i, 'anchorSuppression', e.target.value)} placeholder="例如：公共场所、战斗场景、重大危机" />
                          </div>
                          <div className="space-y-1 pt-1 border-t border-gray-600/50">
                            <div className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                              <span className="text-[10px] text-green-400">身体先于数值原则</span>
                              <span className="text-[10px] text-gray-500">— 好感度变化必须先体现在生理反应上</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                              <span className="text-[10px] text-green-400">虚假上涨机制</span>
                              <span className="text-[10px] text-gray-500">— 数值涨时外在表现可能更恶劣</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ========== BLOCK 3: Major NPCs ========== */}
      <div style={sectionStyle}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium text-gray-200">👥 主要NPC</h3>
            <p className="text-xs text-gray-500 mt-0.5">数量不限</p>
          </div>
          <button
            type="button"
            onClick={addNpc}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
          >
            + 添加NPC
          </button>
        </div>

        {form.npcs.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-4 border border-dashed border-gray-600 rounded-lg">
            暂未添加NPC
          </p>
        ) : (
          <div className="space-y-2">
            {form.npcs.map((npc, i) => (
              <div key={i} style={{ ...sectionStyle, overflow:'hidden' }}>
                <div onClick={() => setExpandedNPC(expandedNPC === i ? -1 : i)} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer', paddingBottom: expandedNPC === i ? '12px' : '0', borderBottom: expandedNPC === i ? '0.5px solid var(--border2)' : 'none' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                    <div style={{ width:'6px', height:'6px', borderRadius:'50%', background:'var(--teal)' }} />
                    <span style={{ fontSize:'13px', fontWeight:500, color:'var(--text)' }}>{npc.name || 'NPC ' + (i + 1)}</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                    <button type="button" onClick={e => { e.stopPropagation(); removeNpc(i) }} style={{ fontSize:'11px', color:'var(--coral)', background:'none', border:'none', cursor:'pointer' }}>删除</button>
                    <span style={{ fontSize:'10px', color:'var(--text3)', transform: expandedNPC === i ? 'rotate(180deg)' : 'rotate(0deg)', transition:'transform 0.2s', display:'inline-block' }}>▼</span>
                  </div>
                </div>
                {expandedNPC === i && (
                  <div style={{ paddingTop:'12px', display:'flex', flexDirection:'column', gap:'10px' }}>
                    {/* Row 1: Avatar + Name + Identity */}
                    <div style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}>
                      <input type="file" accept="image/*" style={{ display:'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleNpcAvatar(i, f) }} id={`npc-avatar-${i}`} />
                      <label htmlFor={`npc-avatar-${i}`} style={{ width:'44px', height:'44px', borderRadius:'50%', border:'2px dashed var(--border)', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', cursor:'pointer', flexShrink:0, background:'var(--bg)' }}>
                        {npc.avatar ? <img src={npc.avatar} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : <span style={{ fontSize:'16px', color:'var(--text3)' }}>+</span>}
                      </label>
                      <div style={{ flex:1, display:'flex', flexDirection:'column', gap:'8px' }}>
                        <input type="text" style={inputStyle} value={npc.name} onChange={e => updateNpc(i, 'name', e.target.value)} placeholder="NPC姓名 *" />
                        <input type="text" style={inputStyle} value={npc.identity || ''} onChange={e => updateNpc(i, 'identity', e.target.value)} placeholder="身份/职业/与主角的关系" />
                      </div>
                    </div>
                    {/* Row 2: Personality */}
                    <div>
                      <label style={{ ...labelStyle, fontSize:'11px', marginBottom:'3px' }}>性格与行为特征</label>
                      <textarea style={{ ...inputStyle, minHeight:'72px', resize:'vertical' }} value={npc.personality} onChange={e => updateNpc(i, 'personality', e.target.value)} placeholder="核心性格、说话方式、行为习惯、对主角的态度……写得越详细AI越能准确扮演" />
                    </div>
                    {/* Row 3: Background / Detailed setting */}
                    <div>
                      <label style={{ ...labelStyle, fontSize:'11px', marginBottom:'3px' }}>详细设定</label>
                      <textarea style={{ ...inputStyle, minHeight:'72px', resize:'vertical' }} value={npc.background || ''} onChange={e => updateNpc(i, 'background', e.target.value)} placeholder="身份背景、过往经历、与可攻略角色的关系、在故事中的作用……" />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ========== BLOCK 4: Minor NPCs ========== */}
      <div style={sectionStyle}>
        <h3 className="text-sm font-medium text-gray-200 mb-3">🎭 次要NPC设置</h3>
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-xs text-gray-300">AI自动生成次要NPC</span>
            <p className="text-[10px] text-gray-500 mt-0.5">场景需要时AI可自主创建路人、店主等临时NPC</p>
          </div>
          <button
            type="button"
            onClick={() => update('autoGenerateNpcs', !form.autoGenerateNpcs)}
            className={`w-10 h-5 rounded-full transition-colors relative ${
              form.autoGenerateNpcs ? 'bg-green-500' : 'bg-gray-600'
            }`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              form.autoGenerateNpcs ? 'left-[20px]' : 'left-[2px]'
            }`} />
          </button>
        </div>
        {form.autoGenerateNpcs && (
          <div>
            <label style={labelStyle}>次要NPC风格限制</label>
            <textarea
              className={inputClass + " h-20 resize-none"}
              value={form.npcStyleLimit}
              onChange={e => update('npcStyleLimit', e.target.value)}
              placeholder="例如：符合古代宫廷背景，不出现现代词汇"
            />
          </div>
        )}
      </div>

      {/* ========== Advanced Parameters ========== */}
      <div style={sectionStyle}>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between text-sm font-medium text-gray-200"
        >
          <span>高级参数</span>
          <span className="text-gray-400 text-xs">{showAdvanced ? '收起 ▲' : '展开 ▼'}</span>
        </button>
        {showAdvanced && (
          <div className="mt-4 space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-400">温度 (Temperature)</label>
                <span className="text-xs text-blue-400 font-mono">{form.temperature ?? 0.9}</span>
              </div>
              <input type="range" min="0" max="2" step="0.1" value={form.temperature ?? 0.9}
                onChange={e => update('temperature', parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none bg-gray-600 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500" />
              <div className="flex justify-between text-[10px] text-gray-600 mt-0.5"><span>0 精确</span><span>2 创意</span></div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-400">TopP</label>
                <span className="text-xs text-purple-400 font-mono">{form.topP ?? 0.95}</span>
              </div>
              <input type="range" min="0" max="1" step="0.05" value={form.topP ?? 0.95}
                onChange={e => update('topP', parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none bg-gray-600 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-500" />
              <div className="flex justify-between text-[10px] text-gray-600 mt-0.5"><span>0 集中</span><span>1 多样</span></div>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">上下文窗口</label>
              <select style={inputStyle} value={form.contextWindow} onChange={e => update('contextWindow', parseInt(e.target.value))}>
                <option value={20}>20 条消息</option>
                <option value={40}>40 条消息（默认）</option>
                <option value={60}>60 条消息</option>
                <option value={80}>80 条消息</option>
                <option value={100}>100 条消息</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* AI Extract modal */}
      {showExtractModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/60 backdrop-blur-sm" onClick={() => { setShowExtractModal(false); setExtractText('') }}>
          <div className="bg-gray-800 rounded-2xl border border-gray-700 p-5 mx-4 w-full max-w-lg max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-medium text-gray-200 mb-1">AI 抓取角色设定</h3>
            <p className="text-xs text-gray-500 mb-3">
              粘贴包含世界观和角色设定的文本，AI 将自动提取并填充表单。支持小说简介、角色设定文档等格式。
            </p>

            <textarea
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-3 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none transition-colors flex-1 resize-none"
              value={extractText}
              onChange={e => setExtractText(e.target.value)}
              placeholder="例如：&#10;这是一个发生在未来星际联邦背景下的故事。&#10;&#10;女主角林晚是联邦第一舰队指挥官，性格冷峻果断但内心柔软...&#10;&#10;男主角苏晨是星际科学院首席研究员..."
              rows={12}
            />

            {extracting && (
              <div className="flex items-center gap-2 py-2 text-sm text-purple-400">
                <span className="inline-flex gap-0.5">
                  <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
                AI正在分析文本，提取角色信息...
              </div>
            )}

            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => { setShowExtractModal(false); setExtractText('') }}
                className="flex-1 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleExtract}
                disabled={extracting || !extractText.trim()}
                className="flex-[2] py-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-sm font-medium transition-all disabled:opacity-50 active:scale-[0.98]"
              >
                {extracting ? '提取中...' : '🤖 开始提取'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Skeleton Fill modal */}
      {showSkeletonModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/60 backdrop-blur-sm" onClick={() => { setShowSkeletonModal(false); setSkeletonText('') }}>
          <div className="bg-gray-800 rounded-2xl border border-amber-700/50 p-5 mx-4 w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-medium text-amber-300 mb-1">🧬 从角色骨架填充表单</h3>
            <p className="text-xs text-gray-400 mb-3">
              粘贴"角色扮演设计骨架"模板的完整内容。AI会逐段搬运到表单的对应字段——不概括、不缩水、不改编。填充对象为当前展开的可攻略角色。
            </p>

            <textarea
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-3 text-sm text-white placeholder-gray-500 focus:border-amber-500 focus:outline-none transition-colors flex-1 resize-y"
              value={skeletonText}
              onChange={e => setSkeletonText(e.target.value)}
              placeholder={`# 【角色扮演设计骨架】\n\n## 一、核心身份层\n【角色名】：\n【外部标签】：\n【内部真相】：\n【进场目的】：\n【核心矛盾】：\n\n## 二、皮相与感官层\n【外貌核心】：\n【感官侵略设计】：\n【体态语言】：\n\n## 三、好感度 / 状态进度系统\n阶段一：【0–X】标题：\n  · 角色状态描述：\n  · 对玩家的核心策略：\n  · 上涨触发条件：\n  · 本阶段语言样本：\n  · 典型发言：\n  · 本阶段禁止行为：\n阶段二：【X–X】...\n（可只填2-3个阶段，其余AI推断）\n\n## 四、行为铁律层\n...\n\n## 六、说话风格校准层\n...\n\n## 七、关系差异表\n...\n\n## 八、主动性驱动模块\n...\n\n## 十、开场锚点\n...\n\n提示：骨架不需要填满所有模块。缺失的部分AI会基于已有信息合理推断填充。`}
              rows={16}
            />

            {fillingSkeleton && (
              <div className="flex items-center gap-2 py-2 text-sm text-amber-400">
                <span className="inline-flex gap-0.5">
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
                AI正在逐段搬运骨架内容到表单字段...
              </div>
            )}

            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => { setShowSkeletonModal(false); setSkeletonText('') }}
                className="flex-1 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleFillSkeleton}
                disabled={fillingSkeleton || !skeletonText.trim()}
                className="flex-[2] py-2 rounded-lg bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-sm font-medium transition-all disabled:opacity-50 active:scale-[0.98]"
              >
                {fillingSkeleton ? '填充中...' : '🧬 填充到当前角色'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Generate self-drive behaviors */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700/50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-200">AI生成自驱行为</h3>
            <p className="text-xs text-gray-500 mt-0.5">根据各角色设定，为每个好感度阶段自动生成3-5条自驱行为</p>
          </div>
          <button
            type="button"
            onClick={handleGenerateBehaviors}
            disabled={generatingBehaviors}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {generatingBehaviors ? '生成中...' : '生成自驱行为'}
          </button>
        </div>
      </div>

      {/* RCC Status */}
      {(compilingRCC || rccStatus) && (
        <div style={{
          padding: '10px 14px', borderRadius: '10px', marginBottom: '8px',
          background: compilingRCC ? 'var(--bg2)' : rccStatus.startsWith('✅') ? '#e8f5e9' : '#fff3e0',
          fontSize: '13px', color: 'var(--text)', lineHeight: '1.5',
        }}>
          {compilingRCC && <span style={{ marginRight: '6px' }}>⏳</span>}
          {rccStatus || '正在编译角色宪法，请稍候...'}
        </div>
      )}

      {/* Submit */}
      <div style={{ padding:'16px 0', display:'flex', gap:'10px' }}>
        <button type="button" onClick={onCancel} style={{ flex:1, padding:'12px', borderRadius:'12px', border:'none', background:'var(--bg2)', color:'var(--text)', fontSize:'15px', cursor:'pointer' }}>取消</button>
        <button type="submit" disabled={compilingRCC} style={{ flex:2, padding:'12px', borderRadius:'12px', border:'none', background: compilingRCC ? 'var(--bg3)' : 'var(--purple)', color: compilingRCC ? 'var(--text2)' : '#fff', fontSize:'15px', fontWeight:500, cursor: compilingRCC ? 'not-allowed' : 'pointer' }}>{compilingRCC ? '编译中...' : isEdit ? '保存修改' : '创建故事'}</button>
      </div>
    </form>
    </div>
  )
}
