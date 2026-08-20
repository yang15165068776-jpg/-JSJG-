/**
 * Drama Orchestrator v3 — Shuraba / Rivalry Engine
 *
 * v3 paradigm shift:
 *   ❌ 世界围绕玩家转（角色对玩家输出）
 *   ✅ 世界在玩家存在下"自发互相崩坏"（角色之间互相撕裂剧情）
 *
 * 修罗场不是对话系统，是"关系冲突动力系统"。
 *
 * Architecture v3:
 *   ConflictGraph → AggroSystem → AttentionAllocation → InterruptionEngine
 *   → DialogueCollision → SceneCollapse → DirectorPrompt
 */

// ═══════════════════════════════════════════════════════════
// 0. Helpers
// ═══════════════════════════════════════════════════════════

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }

// ═══════════════════════════════════════════════════════════
// 1. Scene State (upgraded)
// ═══════════════════════════════════════════════════════════

export function createSceneState(location = '', time = '') {
  return {
    location: location || '未指定',
    time: time || '当前',
    participants: [],
    tension: 30,
    stability: 60,
    activeConflict: null,
    lastEvent: null,
    turnInScene: 0,
    scenePhase: 'setup',     // setup → rising → crisis → collapse → release
    shurabaActive: false,    // 🔥 v3: 修罗场激活标志
    collapseCount: 0,        // v3: 连续崩坏次数
    dominantChar: null,      // v3: 当前主导角色
    suppressedChars: [],     // v3: 被压制角色
  }
}

// ═══════════════════════════════════════════════════════════
// 2. Conflict Graph Engine v3
// ═══════════════════════════════════════════════════════════

export function createConflictGraph(participants) {
  const graph = { nodes: participants, edges: {} }
  for (const a of participants) {
    for (const b of participants) {
      if (a === b) continue
      const key = a + '->' + b
      graph.edges[key] = {
        jealousy: 0,
        hostility: 0,
        dependence: 0,
        attraction: 0,
      }
    }
  }
  return graph
}

/**
 * Sync Conflict Graph edges from USK character states.
 */
export function syncConflictGraph(graph, uskCharacters, affections) {
  if (!graph || !uskCharacters) return graph

  const names = graph.nodes || []
  for (const a of names) {
    const stateA = uskCharacters[a]
    if (!stateA) continue
    for (const b of names) {
      if (a === b) continue
      const key = a + '->' + b
      const edge = graph.edges[key]
      if (!edge) continue

      // Pull from USK
      edge.jealousy = clamp(stateA.emotion?.jealousy ?? 30, 0, 100)
      edge.hostility = clamp((stateA.emotion?.anger ?? 5) + (stateA.tension?.unresolved_conflicts ?? 30) * 0.5, 0, 100)
      edge.dependence = clamp(stateA.relationship?.dependency ?? 30, 0, 100)
      edge.attraction = clamp(stateA.relationship?.affection ?? 50, 0, 100)

      // Boost attraction if affection is specifically toward this character
      if (affections && affections[b] != null) {
        edge.attraction = clamp(affections[b], 0, 100)
      }
    }
  }
  return graph
}

// ═══════════════════════════════════════════════════════════
// 3. Character Aggro System v3
// ═══════════════════════════════════════════════════════════

/**
 * Compute aggression score for a character.
 * Aggression determines: speak priority, interrupt ability, dominance.
 */
export function computeAggression(charName, graph, uskCharacters) {
  const state = uskCharacters?.[charName]
  if (!state) return 30

  // Base from emotion
  const anger = state.emotion?.anger ?? 5
  const jealousy = state.emotion?.jealousy ?? 5
  let aggro = anger * 0.6 + jealousy * 0.4

  // Add hostility from all outgoing edges
  if (graph?.edges) {
    for (const [key, edge] of Object.entries(graph.edges)) {
      if (key.startsWith(charName + '->')) {
        aggro += (edge.hostility || 0) * 0.3 + (edge.jealousy || 0) * 0.2
      }
    }
  }

  // Tension contributes
  aggro += (state.tension?.emotional_pressure ?? 30) * 0.2

  return clamp(Math.round(aggro), 0, 100)
}

/**
 * Compute aggression for all participants. Returns sorted list.
 */
export function getAggroRanking(graph, uskCharacters) {
  const nodes = graph?.nodes || []
  return nodes
    .map(name => ({ name, aggression: computeAggression(name, graph, uskCharacters) }))
    .sort((a, b) => b.aggression - a.aggression)
}

// ═══════════════════════════════════════════════════════════
// 4. Shuraba Trigger v3
// ═══════════════════════════════════════════════════════════

/**
 * Determine if the scene should enter 修罗场 mode.
 * Requires: 2+ characters with affection > 60 toward player, AND tension > 65.
 */
export function shouldEnterShuraba(scene, graph, uskCharacters) {
  if (!uskCharacters) return false

  const highAffectionCount = Object.entries(uskCharacters)
    .filter(([, s]) => (s.relationship?.affection || 0) > 60)
    .length

  const tensionOk = scene.tension > 65

  // Also check: any edge with jealousy > 50
  let jealousySpike = false
  if (graph?.edges) {
    for (const edge of Object.values(graph.edges)) {
      if ((edge.jealousy || 0) > 50) { jealousySpike = true; break }
    }
  }

  return highAffectionCount >= 2 && (tensionOk || jealousySpike)
}

// ═══════════════════════════════════════════════════════════
// 5. Attention Allocation Model v3
// ═══════════════════════════════════════════════════════════

/**
 * Allocate scarce attention among characters.
 * Returns distribution: [{ name, share, role }]
 *
 * 主导者 40% / 挑衅者 30% / 被压制者 20% / 沉默观察者 10%
 */
export function allocateAttention(ranking, scene) {
  if (ranking.length === 0) return []
  if (ranking.length === 1) return [{ name: ranking[0].name, share: 100, role: '主导者' }]

  const allocation = []

  // 主导者 — highest aggression
  allocation.push({ name: ranking[0].name, share: 40, role: '主导者' })
  scene.dominantChar = ranking[0].name

  if (ranking.length >= 2) {
    // 挑衅者 — second highest, competes with dominant
    allocation.push({ name: ranking[1].name, share: 30, role: '挑衅者' })
  }

  if (ranking.length >= 3) {
    // 被压制者 — low aggression, gets talked over
    allocation.push({ name: ranking[2].name, share: 20, role: '被压制者' })
    scene.suppressedChars = [ranking[2].name]
  }

  // Remaining — 沉默观察者
  for (let i = 3; i < ranking.length; i++) {
    allocation.push({ name: ranking[i].name, share: Math.floor(10 / (ranking.length - 3 + 1)), role: '沉默观察者' })
  }

  return allocation
}

// ═══════════════════════════════════════════════════════════
// 6. Interruption Engine v3
// ═══════════════════════════════════════════════════════════

/**
 * Determine who can interrupt whom.
 * Character can interrupt if: aggression > 70 OR is dominant.
 */
export function getInterruptPermissions(ranking, allocation) {
  const perms = {}
  const dominant = allocation.find(a => a.role === '主导者')
  const challenger = allocation.find(a => a.role === '挑衅者')

  for (const char of ranking) {
    perms[char.name] = {
      canInterrupt: char.aggression > 70 || char.name === dominant?.name,
      interruptStyle: char.aggression > 80 ? '冷笑打断' :
                      char.aggression > 60 ? '突然插话' :
                      char.aggression > 40 ? '低声反驳' : null,
      canBeInterrupted: char.name !== dominant?.name,
    }
  }

  // Dominant character can never be interrupted (unless by challenger with aggro > 80)
  if (dominant && challenger) {
    const challengerAggro = ranking.find(r => r.name === challenger.name)?.aggression || 0
    if (challengerAggro > 80) {
      perms[dominant.name].canBeInterrupted = true
    }
  }

  return perms
}

// ═══════════════════════════════════════════════════════════
// 7. Dialogue Collision Resolver v3
// ═══════════════════════════════════════════════════════════

/**
 * Resolve who speaks in what order when multiple characters want to talk.
 * Returns structured output directives.
 */
export function resolveDialogueCollision(ranking, allocation, interruptPerms, scene) {
  const directives = []
  const dominant = allocation.find(a => a.role === '主导者')
  const challenger = allocation.find(a => a.role === '挑衅者')
  const suppressed = allocation.filter(a => a.role === '被压制者' || a.role === '沉默观察者')

  // ── Opening: dominant speaks first ──
  if (dominant) {
    directives.push({
      char: dominant.name,
      action: 'speak_first',
      priority: 1,
      instruction: dominant.name + ' 率先发言——主导当前对话节奏',
    })
  }

  // ── Challenger response ──
  if (challenger) {
    const challengerAggro = ranking.find(r => r.name === challenger.name)?.aggression || 0
    if (challengerAggro > 70 && interruptPerms[challenger.name]?.canInterrupt) {
      directives.push({
        char: challenger.name,
        action: 'interrupt',
        priority: 2,
        prefix: challengerAggro > 80 ? '（冷笑打断）' : '（突然插话）',
        instruction: challenger.name + ' 打断' + (dominant?.name || '') + '——争夺话语权',
      })
    } else {
      directives.push({
        char: challenger.name,
        action: 'respond',
        priority: 2,
        instruction: challenger.name + ' 回应' + (dominant?.name || '') + '——针锋相对',
      })
    }
  }

  // ── Suppressed: may try to speak but get interrupted ──
  for (const sup of suppressed) {
    const supAggro = ranking.find(r => r.name === sup.name)?.aggression || 0
    // Low aggression + high tension = gets interrupted by challenger
    if (scene.tension > 70 && supAggro < 40 && challenger) {
      directives.push({
        char: sup.name,
        action: 'interrupted',
        priority: 3,
        interruptedBy: challenger.name,
        instruction: sup.name + ' 试图开口 → ' + challenger.name + ' 直接打断 —— ' + sup.name + ' 被压制',
      })
    } else {
      directives.push({
        char: sup.name,
        action: 'speak_last',
        priority: 3,
        instruction: sup.name + ' 在其他人都说完后发言——或者沉默',
      })
    }
  }

  return directives
}

// ═══════════════════════════════════════════════════════════
// 8. Scene Collapse Controller v3
// ═══════════════════════════════════════════════════════════

/**
 * When tension > 85, scene enters collapse mode.
 * Dialogue fragments, multiple people speak at once, emotion overrides logic.
 */
export function checkSceneCollapse(scene) {
  if (scene.tension > 85) {
    scene.scenePhase = 'collapse'
    scene.collapseCount++
    return {
      collapsing: true,
      effects: [
        '对话不再完整——句子被打断，话说一半',
        '多人同时发言——没有轮流，没有次序',
        '语义碎片化——短句、重复、喊叫',
        '情绪压过逻辑——角色在说但不是在交流',
      ],
    }
  }

  // Recover from collapse after 2 turns
  if (scene.scenePhase === 'collapse' && scene.turnInScene > 2) {
    scene.scenePhase = 'release'
    scene.collapseCount = 0
  }

  return { collapsing: false, effects: [] }
}

// ═══════════════════════════════════════════════════════════
// 9. Narrative Output Mode v3
// ═══════════════════════════════════════════════════════════

const NARRATIVE_OUTPUT_TEMPLATE = `
【叙事输出模式——修罗场写作格式】

输出结构（按以下节奏组织回复）：

1. 场景锚点（1句）
   → 一个感官细节锁定场景：温度/声音/光线/气味

2. 冲突节点（1-2句）
   → 明确写出：谁 vs 谁，为了什么

3. 三方对话交错
   → 主导者发起 → 挑衅者反击 → 被压制者试图插入 → 观察者沉默
   → 使用打断/抢话/冷笑/沉默作为转场

4. 情绪压制变化（1-2句）
   → 短短两轮内，谁的气势压过了谁

5. 结尾张力停顿（1句）
   → 不闭合。不平稳。留下一个无法忽视的问题。
   → 让下一轮必须继续。`

// ═══════════════════════════════════════════════════════════
// 10. Scene Events (upgraded for v3)
// ═══════════════════════════════════════════════════════════

const SCENE_EVENTS = {
  setup: [
    '建立场景氛围', '角色初次登场', '暗示潜在冲突', '铺垫关系张力',
    '某个角色被冷落', '沉默中酝酿敌意',
  ],
  rising: [
    '误会升级', '第三方介入', '情绪冷却失败', '关系试探',
    '信息泄露', '态度转变', '边界被侵犯', '旧事重提',
    '某角色故意刺激另一角色', '玩家成为争夺焦点',
  ],
  crisis: [
    '冲突爆发', '不可挽回的话说出口', '物理对峙', '真相揭露',
    '被迫选择', '情绪彻底失控', '关系破裂边缘', '第三方插足',
    '修罗场触发——多位角色同时争夺话语权',
  ],
  collapse: [
    '对话完全碎片化', '角色不再交流——只在输出情绪',
    '某个角色沉默退场', '某个角色做出无法撤回的行为',
  ],
  release: [
    '短暂平静', '反思与回味', '新的裂痕', '余波未平',
    '下一轮冲突的种子', '关系重新校准',
    '某个角色留下意味深长的一句话后离开',
  ],
}

const PHASE_TRANSITIONS = {
  setup: 'rising',
  rising: 'crisis',
  crisis: 'collapse',    // v3: crisis → collapse (not directly to release)
  collapse: 'release',
  release: 'setup',
}

// ═══════════════════════════════════════════════════════════
// 11. Drama Orchestrator v3 — Public API
// ═══════════════════════════════════════════════════════════

export const DramaOrchestrator = {

  /**
   * Initialize a scene with Conflict Graph.
   */
  initScene(character, folder) {
    const scene = createSceneState(
      character.worldSetting?.slice(0, 100),
      '当前'
    )
    scene.participants = (character.romanceCharacters || [])
      .map(rc => rc.name)
      .filter(Boolean)
    if (character.protagonistName) {
      scene.participants.push(character.protagonistName)
    }
    if (folder?.worldview) {
      scene.location = folder.worldview.slice(0, 80)
    }

    // v3: init Conflict Graph
    scene.conflictGraph = createConflictGraph(scene.participants)
    scene.attentionAllocation = null
    scene.dialogueDirectives = null

    return scene
  },

  /**
   * Determine if scene should advance phase.
   */
  shouldAdvanceScene(scene) {
    const tensionTrigger = scene.tension > 65
    const instabilityTrigger = scene.stability < 40
    const turnTrigger = scene.turnInScene > 5 && Math.random() < 0.3
    // v3: shuraba active forces faster phase advancement
    const shurabaTrigger = scene.shurabaActive && scene.turnInScene > 3
    return tensionTrigger || instabilityTrigger || turnTrigger || shurabaTrigger
  },

  /**
   * Detect emotional spikes from USK.
   */
  detectEmotionalSpike(uskState) {
    if (!uskState) return false
    const emo = uskState.emotion || {}
    return (emo.anger || 0) > 40 ||
           (emo.jealousy || 0) > 40 ||
           (emo.sadness || 0) > 50
  },

  /**
   * v3: Detect shuraba from graph + USK.
   */
  detectShuraba(uskCharacters, threshold) {
    if (!uskCharacters) return false
    const highAffectionChars = Object.entries(uskCharacters)
      .filter(([, s]) => (s.relationship?.affection || 0) > 60)
    return highAffectionChars.length >= 2 && (threshold || 70) > 70
  },

  /**
   * Generate scene event for current phase.
   */
  generateSceneEvent(scene) {
    const events = SCENE_EVENTS[scene.scenePhase] || SCENE_EVENTS.setup
    return {
      type: 'scene_event',
      name: pick(events),
      intensity: scene.tension,
      phase: scene.scenePhase,
    }
  },

  /**
   * Update tension from interaction type.
   */
  updateTension(scene, interactionType) {
    const deltas = {
      conflict: +15,
      jealousy: +15,
      rejection: +20,
      rupture: +25,
      shuraba_trigger: +20,    // v3: 修罗场触发加速张力
      interruption: +10,       // v3: 打断增加张力
      intimacy: -10,
      soft_reply: -10,
      reconciliation: -20,
    }
    scene.tension = clamp(scene.tension + (deltas[interactionType] || 0), 0, 100)
    return scene.tension
  },

  /**
   * Sync scene state to USK global_state.
   */
  syncToUSK(usk, scene) {
    if (!usk?.global_state) return usk
    usk.global_state.world_tension = scene.tension
    usk.global_state.narrative_phase = scene.scenePhase
    usk.global_state.timeline_pointer = scene.turnInScene
    usk.global_state.folder_mood = clamp(50 - (scene.tension - 30) * 0.5, 0, 100)
    return usk
  },

  /**
   * v3: Main advance — runs full pipeline.
   *
   * Pipeline:
   *   1. Update tension
   *   2. Sync Conflict Graph from USK
   *   3. Compute aggression ranking
   *   4. Check shuraba trigger
   *   5. Allocate attention
   *   6. Get interrupt permissions
   *   7. Resolve dialogue collision
   *   8. Check scene collapse
   *   9. Advance phase if needed
   */
  advance(scene, uskState, interactionType) {
    // 1. Update tension
    if (interactionType) {
      this.updateTension(scene, interactionType)
    }

    // Update stability
    if (uskState) {
      const spike = this.detectEmotionalSpike(uskState)
      if (spike) scene.stability = clamp(scene.stability - 10, 0, 100)
      else scene.stability = clamp(scene.stability + 3, 0, 100)
    }

    scene.turnInScene++

    // 2. Sync Conflict Graph (if USK data available)
    // The graph sync happens externally via syncConflictGraph when USK is ready
    // For now, we compute aggression from USK directly

    // 3. Compute aggression ranking
    const uskChars = uskState?.characters || uskState
    let ranking = []
    if (scene.conflictGraph && uskChars) {
      ranking = getAggroRanking(scene.conflictGraph, uskChars)
    }

    // 4. Check shuraba trigger
    if (!scene.shurabaActive && scene.conflictGraph) {
      scene.shurabaActive = shouldEnterShuraba(scene, scene.conflictGraph, uskChars)
      if (scene.shurabaActive) {
        scene.tension = clamp(scene.tension + 10, 0, 100)
        interactionType = 'shuraba_trigger'
      }
    }

    // 5. Allocate attention (always, but especially important in shuraba)
    if (ranking.length >= 2) {
      scene.attentionAllocation = allocateAttention(ranking, scene)
    }

    // 6. Get interrupt permissions
    let interruptPerms = {}
    if (scene.attentionAllocation && ranking.length >= 2) {
      interruptPerms = getInterruptPermissions(ranking, scene.attentionAllocation)
    }

    // 7. Resolve dialogue collision
    if (scene.attentionAllocation && ranking.length >= 2) {
      scene.dialogueDirectives = resolveDialogueCollision(
        ranking, scene.attentionAllocation, interruptPerms, scene
      )
    }

    // 8. Check scene collapse
    const collapse = checkSceneCollapse(scene)

    // 9. Check phase advancement
    if (!this.shouldAdvanceScene(scene)) {
      return { scene, event: null, advanced: false, ranking, collapse }
    }

    // Generate event and advance
    const event = this.generateSceneEvent(scene)
    scene.lastEvent = event
    scene.tension = clamp(scene.tension + 10, 0, 100)
    scene.stability = clamp(scene.stability - 15, 0, 100)
    scene.scenePhase = PHASE_TRANSITIONS[scene.scenePhase] || 'setup'
    scene.turnInScene = 0

    return { scene, event, advanced: true, ranking, collapse }
  },

  /**
   * v3: Build the full director prompt injection.
   */
  buildDirectorPrompt(scene) {
    const phaseLabels = {
      setup: '铺垫期 — 建立场景、暗示冲突',
      rising: '上升期 — 张力升级、矛盾浮现',
      crisis: '危机期 — 冲突爆发、不可挽回',
      collapse: '崩坏期 — 对话碎片化、情绪压过逻辑',
      release: '释放期 — 短暂平静、新裂痕',
    }

    const lines = [
      '【🎬 修罗场导演系统 v3——场景编排指令】',
      '',
      '当前场景状态：',
      '· 地点：' + scene.location,
      '· 张力：' + scene.tension + '/100',
      '· 稳定度：' + scene.stability + '/100',
      '· 阶段：' + (phaseLabels[scene.scenePhase] || scene.scenePhase),
      '· 本场景已进行：' + scene.turnInScene + ' 轮',
    ]

    if (scene.shurabaActive) {
      lines.push('· 🔥 修罗场已激活：多角色争夺战进行中')
    }

    // v3: Attention allocation
    if (scene.attentionAllocation && scene.attentionAllocation.length >= 2) {
      lines.push('',
        '━━━ 注意力分配（不是轮流说话）━━━',
      )
      for (const a of scene.attentionAllocation) {
        const label = a.role === '主导者' ? '🔴' :
                      a.role === '挑衅者' ? '🟡' :
                      a.role === '被压制者' ? '🔵' : '⚪'
        lines.push(label + ' ' + a.name + '：' + a.share + '% 戏份 — ' + a.role)
      }
    }

    // v3: Dialogue collision directives
    if (scene.dialogueDirectives && scene.dialogueDirectives.length > 0) {
      lines.push('',
        '━━━ 对话碰撞指令（核心——必须执行）━━━',
      )
      for (const d of scene.dialogueDirectives) {
        if (d.action === 'interrupt') {
          lines.push('💢 ' + d.prefix + ' ' + d.instruction)
        } else if (d.action === 'interrupted') {
          lines.push('💢 ' + d.instruction)
        } else if (d.action === 'speak_first') {
          lines.push('🔴 ' + d.instruction)
        } else if (d.action === 'respond') {
          lines.push('🟡 ' + d.instruction)
        } else {
          lines.push('🔵 ' + d.instruction)
        }
      }
    }

    // v3: Scene collapse effects
    if (scene.scenePhase === 'collapse') {
      lines.push('',
        '━━━ ⚠️ 场景崩坏中 ⚠️ ━━━',
        '· 对话不再完整——句子被打断，话说一半',
        '· 多人同时发言——没有轮流，没有次序',
        '· 语义碎片化——短句、重复、喊叫',
        '· 情绪压过逻辑——角色在说但不是在交流',
      )
    }

    // v3: Shuraba-specific instructions
    if (scene.shurabaActive) {
      lines.push('',
        '━━━ 🔥 修罗场核心规则 ━━━',
        '· 角色之间的互动优先于角色对玩家的互动',
        '· 角色可以互相攻击、讽刺、揭短——不需要玩家允许',
        '· 至少有一个角色被压制/打断/沉默',
        '· 冲突角色必须主动发言，不等玩家cue',
        '· 允许抢话、打断、冷笑反驳',
        '· 目标：形成真正群像戏，不是轮流对玩家说话',
      )
    }

    // Scene event
    if (scene.lastEvent) {
      lines.push('',
        '⚠️ 本轮场景事件：【' + scene.lastEvent.name + '】（强度：' + scene.lastEvent.intensity + '/100）',
        '你的回复必须回应这个事件，不能无视。',
      )
    }

    // Base rules (always)
    lines.push('',
      '━━━ 导演铁律 ━━━',
      '· 行为优先于语言——角色用行动表达立场，不只是说话',
      '· 每个角色的反应必须有差异——不要平均分配戏份',
      '· 必须有人被压制/被忽略/被打断',
      '· 场景不能在你手里终结——每段回复必须以钩子结尾',
      '· 多角色场景：禁止每轮只有一个角色说话',
    )

    if (scene.tension > 70) {
      lines.push('· ⚠️ 高张力：角色情绪接近失控，随时可能爆发')
      lines.push('· 🔥 角色之间必须有直接冲突——不只是各说各的')
    }
    if (scene.stability < 30) {
      lines.push('· ⚠️ 低稳定度：任何小事都可能引发连锁反应')
    }

    // v3: Narrative output mode hint
    if (scene.tension > 60) {
      lines.push('',
        '【叙事输出模式——高张力场景写作格式】',
        '1. 场景锚点（1句感官细节）',
        '2. 冲突节点（谁vs谁，为了什么）',
        '3. 三方对话交错（打断/抢话/冷笑/沉默）',
        '4. 情绪压制变化（谁的气势压过了谁）',
        '5. 结尾张力停顿（不闭合，留下无法忽视的问题）',
      )
    }

    return lines.join('\n')
  },
}
