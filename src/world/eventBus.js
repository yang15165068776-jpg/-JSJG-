/**
 * Event Bus — lightweight publish-subscribe for world events.
 *
 * All behavior flows through the Event Bus:
 *   User actions, NPC actions, relationship changes, scene transitions, conflicts.
 *
 * The Event Bus decouples NPC agents from the World Engine.
 * Agents publish events; the World Engine consumes them.
 */

/**
 * Create a new Event Bus instance.
 */
export function createEventBus() {
  return {
    events: [],
    subscribers: [],
    _createdAt: Date.now(),
  }
}

/**
 * Publish an event to the bus.
 */
export function publish(bus, type, data) {
  if (!bus || !type) return bus

  const event = {
    id: generateEventId(),
    type,
    timestamp: Date.now(),
    data: data || {},
  }

  bus.events.push(event)

  // Notify subscribers
  for (const sub of bus.subscribers) {
    try {
      if (!sub.types || sub.types.includes(type) || sub.types.includes('*')) {
        sub.handler(event, bus)
      }
    } catch (e) {
      console.error('[EventBus] Subscriber error:', e)
    }
  }

  return bus
}

/**
 * Subscribe to specific event types. Returns unsubscribe function.
 */
export function subscribe(bus, types, handler) {
  if (!bus || !handler) return () => {}

  const subscriber = { types: Array.isArray(types) ? types : [types], handler }
  bus.subscribers.push(subscriber)

  return () => {
    const idx = bus.subscribers.indexOf(subscriber)
    if (idx >= 0) bus.subscribers.splice(idx, 1)
  }
}

/**
 * Drain all pending events from the bus (returns them and clears the queue).
 */
export function drain(bus) {
  if (!bus) return []
  const events = [...bus.events]
  bus.events = []
  return events
}

/**
 * Process the event queue and return narrative hints for the Narrator.
 * Each event type produces a compact hint string.
 */
export function processEventQueue(bus, world) {
  const events = drain(bus)
  const hints = []

  for (const event of events) {
    switch (event.type) {
      case 'NPC_ACTION': {
        const { agent, intent, action, emotion, target } = event.data || {}
        hints.push({
          priority: intent === 'confront' || intent === 'intervene' ? 'high' : 'normal',
          text: buildNPCActionHint(agent, intent, action, emotion, target),
        })
        break
      }
      case 'RELATIONSHIP_CHANGE': {
        const { source, target: tgt, delta, trigger } = event.data || {}
        if (delta !== 0) {
          hints.push({
            priority: Math.abs(delta) >= 2 ? 'high' : 'normal',
            text: `${source}好感度${delta > 0 ? '+' : ''}${delta} (${trigger || '本轮互动'})`,
          })
        }
        break
      }
      case 'SCENE_TRANSITION': {
        hints.push({
          priority: 'high',
          text: `场景切换: ${event.data?.from || '?'} → ${event.data?.to || '?'}`,
        })
        break
      }
      case 'CONFLICT_EVENT': {
        hints.push({
          priority: 'high',
          text: `冲突事件: ${(event.data?.participants || []).join(' vs ')} (强度: ${event.data?.intensity || '?'}/10)`,
        })
        break
      }
      case 'USER_ACTION': {
        hints.push({
          priority: 'normal',
          text: '玩家行动: ' + ((event.data?.content || '').slice(0, 80)),
        })
        break
      }
      default: {
        hints.push({
          priority: 'low',
          text: event.type + ': ' + JSON.stringify(event.data || {}).slice(0, 60),
        })
      }
    }
  }

  return { updatedWorld: world, narrativeHints: hints, eventCount: events.length }
}

// ─── Helpers ────────────────────────────────────────────

function generateEventId() {
  return 'evt_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6)
}

function buildNPCActionHint(agent, intent, action, emotion, target) {
  const intentMap = {
    approach: '靠近玩家',
    ignore: '无视当前互动',
    intervene: '插入打断',
    observe: '暗中观察',
    confront: '正面冲突',
    withdraw: '回避退让',
    protect: '保护玩家',
    escalate: '升级对抗',
    jealous: '吃醋表现',
  }
  const intentCN = intentMap[intent] || intent
  let hint = `${agent}: ${intentCN}`
  if (emotion && emotion !== 'neutral') hint += ` (${emotion})`
  if (target) hint += ` → ${target}`
  if (action) hint += ` — ${action.slice(0, 50)}`
  return hint
}
