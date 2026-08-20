/**
 * World Engine — complete world state simulator.
 *
 * Evolved from llmState.js. Manages:
 *   - Time system (advances per turn)
 *   - Location graph (character positions + available locations)
 *   - Global irreversible flags
 *   - Structured event log queue
 *   - NPC agent registry snapshots
 *
 * All state is pure data. No side effects, no API calls.
 */

import { getCurrentAffectionStage } from '../utils/deepseek'

/**
 * Create a fresh world state from character data + session state.
 */
export function createWorldState(character, affections, messages, storyTime) {
  const now = Date.now()

  // Build time from storyTime or default
  const time = storyTime && storyTime.year
    ? { year: storyTime.year, month: storyTime.month || 1, day: storyTime.day || 1, hour: 20, minute: 0 }
    : { year: 2026, month: 6, day: 18, hour: 20, minute: 0 }

  // Build character registry from romance characters + NPCs
  const characters = {}
  const locations = {}

  // Default location
  locations['main'] = { name: '当前场景', description: '', charactersHere: [] }

  if (character?.chatStyle === 'story') {
    // Romance characters become registered agents
    const rcList = character.romanceCharacters || []
    for (const rc of rcList) {
      const affValue = affections?.[rc.name] ?? rc.affectionInitial ?? 50
      const stage = getCurrentAffectionStage(rc, affValue)
      const personalityColor = detectSimpleColor(rc)

      characters[rc.name] = {
        id: rc.id || rc.name,
        name: rc.name,
        type: 'romance',
        personality: rc.personality || '',
        personalityColor,
        speakingStyle: rc.speakingStyle || '',
        styleRules: rc.styleRules || [],
        forbiddenWords: rc.forbiddenWords || [],
        background: rc.background || '',
        affection: affValue,
        affectionInitial: rc.affectionInitial ?? 50,
        stageName: stage?.name || stage?.label || '',
        stageIndex: rc.affectionStages
          ? rc.affectionStages.findIndex(s => affValue >= (s.min ?? 0) && affValue <= (s.max ?? 100))
          : -1,
        affectionStages: rc.affectionStages || [],
        affectionEnabled: rc.affectionEnabled !== false,
        affectionUpRules: rc.affectionUpRules || '',
        affectionDownRules: rc.affectionDownRules || '',
        erosionCondition: rc.erosionCondition || '',
        anchorSuppression: rc.anchorSuppression || '',
        selfDriveBehaviors: [],  // populated from current stage
        flags: [],
        present: true,
        location: 'main',
        mood: 'neutral',
        autonomy: 0.7,
        lastAction: null,
      }

      // Populate self-drive behaviors from current stage
      if (stage?.selfDriveBehaviors) {
        characters[rc.name].selfDriveBehaviors = stage.selfDriveBehaviors.map(b => ({
          behavior: b.behavior || b.description || '',
          trigger: b.trigger || '',
        }))
      }

      locations['main'].charactersHere.push(rc.name)
    }

    // NPCs become lightweight agents
    const npcList = character.npcs || []
    for (const npc of npcList) {
      if (!npc.name) continue
      characters[npc.name] = {
        id: npc.id || npc.name,
        name: npc.name,
        type: 'npc',
        personality: npc.personality || '',
        personalityColor: 'neutral',
        speakingStyle: '',
        styleRules: [],
        forbiddenWords: [],
        background: '',
        affection: 0,
        affectionEnabled: false,
        affectionStages: [],
        selfDriveBehaviors: [],
        flags: [],
        present: true,
        location: 'main',
        mood: 'neutral',
        autonomy: 0.4,
        relationship: npc.relationship || '',
        lastAction: null,
      }
      locations['main'].charactersHere.push(npc.name)
    }
  }

  // Build event log from existing messages
  const eventLog = extractInitialEvents(messages, characters)

  return {
    time,
    locations,
    globalFlags: [],
    characters,
    eventLog,
    roundIndex: messages ? messages.filter(m => m.role === 'user').length : 0,
    _createdAt: now,
    _updatedAt: now,
  }
}

/**
 * Advance the world by one turn. Returns updated world + events generated.
 */
export function advanceWorld(world, userAction) {
  const events = []

  // Advance time by ~15 minutes per turn
  const newTime = advanceTime(world.time, 15)
  events.push({
    type: 'TIME_ADVANCE',
    timestamp: Date.now(),
    data: { from: formatTime(world.time), to: formatTime(newTime) },
  })

  // Create user action event
  if (userAction) {
    events.push({
      type: 'USER_ACTION',
      timestamp: Date.now(),
      data: { content: userAction },
    })
  }

  return {
    world: {
      ...world,
      time: newTime,
      roundIndex: world.roundIndex + 1,
      _updatedAt: Date.now(),
    },
    events,
  }
}

/**
 * Apply an event to the world state (immutable update).
 */
export function applyEvent(world, event) {
  const updated = { ...world, _updatedAt: Date.now() }

  switch (event.type) {
    case 'RELATIONSHIP_CHANGE': {
      const { source, target, delta } = event.data || {}
      if (source && updated.characters[source]) {
        const oldAff = updated.characters[source].affection
        updated.characters = {
          ...updated.characters,
          [source]: {
            ...updated.characters[source],
            affection: clampAffection(oldAff + (delta || 0), updated.characters[source]),
          },
        }
      }
      break
    }
    case 'NPC_ACTION': {
      const { agent, intent, action } = event.data || {}
      if (agent && updated.characters[agent]) {
        updated.characters = {
          ...updated.characters,
          [agent]: {
            ...updated.characters[agent],
            lastAction: action || intent,
            mood: event.data?.emotion || updated.characters[agent].mood,
          },
        }
      }
      break
    }
    case 'SCENE_TRANSITION': {
      const { from, to } = event.data || {}
      if (from && to && updated.locations[from] && updated.locations[to]) {
        // Move characters between locations (handled by the event's character list)
        updated.locations = { ...updated.locations }
      }
      break
    }
    case 'GLOBAL_FLAG': {
      const { flag } = event.data || {}
      if (flag && !updated.globalFlags.includes(flag)) {
        updated.globalFlags = [...updated.globalFlags, flag]
      }
      break
    }
  }

  // Append to event log
  updated.eventLog = [...(world.eventLog || []), event].slice(-50)

  return updated
}

/**
 * Produce a compact snapshot for the Narrator LLM.
 */
export function snapshotForNarrator(world) {
  const activeChars = Object.entries(world.characters)
    .filter(([, c]) => c.present)
    .map(([name, c]) => ({
      name,
      type: c.type,
      aff: c.affection,
      stage: c.stageName,
      mood: c.mood,
      color: c.personalityColor,
      lastAction: c.lastAction,
      personality: c.personality?.slice(0, 60),
      speakStyle: c.speakingStyle?.slice(0, 40),
    }))

  const recentEvents = (world.eventLog || []).slice(-8).map(e => ({
    type: e.type,
    data: summarizeEventData(e),
  }))

  return {
    time: formatTime(world.time),
    location: getPrimaryLocation(world),
    flags: world.globalFlags.slice(-5),
    characters: activeChars,
    recentEvents,
    round: world.roundIndex,
  }
}

// ─── Helpers ────────────────────────────────────────────

function advanceTime(time, minutes) {
  let { year, month, day, hour, minute } = time
  minute += minutes
  while (minute >= 60) { minute -= 60; hour++ }
  while (hour >= 24) { hour -= 24; day++ }
  // Simplified: no month/year rollover for RP purposes
  return { year, month, day, hour, minute }
}

function formatTime(time) {
  return `第${time.year}年${time.month}月${time.day}日 ${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`
}

function getPrimaryLocation(world) {
  const locs = Object.values(world.locations || {})
  return locs.length > 0 ? locs[0].name : '未知'
}

function clampAffection(value, charState) {
  const stages = charState?.affectionStages
  if (stages && stages.length > 0) {
    const mins = stages.map(s => s.min != null ? Number(s.min) : 0)
    const maxs = stages.map(s => s.max != null ? Number(s.max) : 100)
    return Math.min(Math.max(...maxs), Math.max(Math.min(...mins), value))
  }
  return Math.min(100, Math.max(-100, value))
}

function detectSimpleColor(rc) {
  const warm = ['温柔', '善良', '阳光', '单纯', '软萌', '体贴', '治愈', '温暖', '乖巧', '可爱', '柔和', '和善', '暖心', '元气', '开朗', '天真']
  const dark = ['傲娇', '毒舌', '清冷', '偏执', '疯批', '恶劣', '堕落', '冷漠', '腹黑', '霸道', '强势', '冷酷', '邪魅', '病娇', '阴郁', '暴戾', '高冷']
  const combined = (rc.personality || '') + (rc.background || '') + (rc.speakingStyle || '')
  const warmHits = warm.filter(kw => combined.includes(kw)).length
  const darkHits = dark.filter(kw => combined.includes(kw)).length
  if (warmHits > 0 && darkHits === 0) return 'warm'
  if (darkHits > 0 && warmHits === 0) return 'dark'
  return 'neutral'
}

function extractInitialEvents(messages, characters) {
  if (!messages || messages.length === 0) return []
  const events = []
  // Extract from existing system/memory messages
  for (const msg of messages) {
    if (msg.role === 'system' && (msg.isMemory || msg.isEpisode)) {
      events.push({
        type: 'MEMORY_SNAPSHOT',
        timestamp: msg.timestamp || Date.now(),
        data: { summary: (msg.content || '').slice(0, 200) },
      })
    }
  }
  return events.slice(-20)
}

function summarizeEventData(event) {
  const d = event.data || {}
  switch (event.type) {
    case 'NPC_ACTION': return `${d.agent}: ${d.intent} (${d.emotion || 'neutral'})`
    case 'RELATIONSHIP_CHANGE': return `${d.source}: ${d.delta > 0 ? '+' : ''}${d.delta} (${d.trigger || ''})`
    case 'USER_ACTION': return `玩家: ${(d.content || '').slice(0, 80)}`
    case 'TIME_ADVANCE': return `${d.from} → ${d.to}`
    case 'SCENE_TRANSITION': return `${d.from} → ${d.to}`
    default: return JSON.stringify(d).slice(0, 60)
  }
}
