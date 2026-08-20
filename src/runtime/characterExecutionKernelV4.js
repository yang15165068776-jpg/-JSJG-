/**
 * ⚙️ Character Execution Kernel v4 — Autonomous Narrative Director Edition
 *
 * "CEK v4 = 让AI不再'扮演角色'，而是'导演角色之间的欲望战争'"
 *
 * v3 → v4 paradigm shift:
 *   v3: manufacture tension (make it interesting)
 *   v4: autonomous narrative direction (AI DIRECTS the story)
 *
 * The player is no longer the protagonist driving the story.
 * The player is the ATTENTION RESOURCE that characters fight over.
 *
 * New v4 systems:
 *   🎬 Narrative Intent Generator   — system decides WHAT story to write
 *   🎬 Scene Director Engine        — intent → concrete scene instructions
 *   🧠 Autonomous Character Planner — each character has a strategic plan
 *   ⚔️ Conflict Simulation Layer    — simulate multi-character dynamics before output
 *   ⚡ Attention War System         — characters compete for player_attention_share
 *   🌿 Narrative Branching Engine   — scene branches (escalate/soften/rupture/redirect)
 */

import { detectAggressionProfile, AGGRESSION_PROFILES } from './aggressionProfile'
import { getCurrentAffectionStage } from '../utils/deepseek'
import { generateMadnessState, buildMadnessStaticPrefix, resetMadnessEngine } from './madnessPersonalityGenerator'
import { buildCEKStrategyContext } from './rcc'

// ═══════════════════════════════════════════════════
// 0. Constants + Internal State
// ═══════════════════════════════════════════════════

const PHASE_1_MAX = 25, PHASE_2_MAX = 50, PHASE_3_MAX = 75
const ROLE_MODES = { 1: 'hunter', 2: 'performer', 3: 'breaking', 4: 'collapsed' }
const BEHAVIOR_ACTIONS = ['observe','seduce','reject','escalate','withdraw','test','provoke','ignore','submit','expose']
const EXPLOSION_COOLDOWN = 3
const DESIRE_LABELS = { 0:'冷',1:'注意',2:'好奇',3:'吸引',4:'压抑',5:'爆发' }

const $ = {
  turnCount: 0,
  accounts: new Map(),           // emotion economy
  globalTension: 30,
  desireGradients: new Map(),
  prevDesire: new Map(),
  emotionCurves: new Map(),
  explosionCooldown: 0,
  rivalryEdges: null,
  attentionSplit: null,
  playerPosition: null,
  // ── v4 new ──
  narrativeIntent: null,         // current scene's narrative goal
  sceneCard: null,               // current scene director output
  characterPlans: new Map(),     // per-character strategic plans
  conflictSim: null,             // conflict simulation result
  attentionWar: null,            // attention war state
  narrativeBranch: null,         // selected branch
  // ── v8.6 madness ──
  madnessStates: null,           // per-character madness state
  madnessDynamicBlock: '',       // madness prompt injection
}

// ═══════════════════════════════════════════════════
// ① Narrative Intent Generator
// ═══════════════════════════════════════════════════

/**
 * The system decides WHAT kind of story to write this turn.
 *
 * This is NOT responsive — it's DIRECTIVE.
 * The story doesn't wait for the player to act. It moves on its own.
 *
 * @param {object} state — current system state
 * @returns {NarrativeIntent}
 *
 * @typedef {object} NarrativeIntent
 * @property {string} goal — increase_tension | resolve_tension | destabilize | reveal | seduce | confront
 * @property {string} target — which character or 'player'
 * @property {string} method — how to achieve the goal
 * @property {number} intensity — 0-100
 * @property {string} sceneType — confrontation | seduction | revelation | withdrawal | test | interrupt
 */

const NARRATIVE_GOALS = {
  INCREASE_TENSION: 'increase_tension',
  RESOLVE_TENSION: 'resolve_tension',
  DESTABILIZE: 'destabilize',
  REVEAL: 'reveal',
  SEDUCE: 'seduce',
  CONFRONT: 'confront',
  WITHDRAW_IMPACT: 'withdraw_impact',
}

const SCENE_TYPES = {
  CONFRONTATION: 'confrontation',
  SEDUCTION: 'seduction',
  REVELATION: 'revelation',
  WITHDRAWAL: 'withdrawal',
  TEST: 'test',
  INTERRUPT: 'interrupt',
  TRIANGULATION: 'triangulation',
}

function generateNarrativeIntent(rcList, attentionSplit, tension) {
  const charNames = rcList.map(rc => rc.name)
  if (charNames.length === 0) return null

  // ── Determine the dominant narrative need ──
  let goal, method, sceneType, target, intensity

  // Who's starving for attention?
  const starving = [...$.accounts.entries()]
    .filter(([, a]) => a.attentionBalance < 30)
    .sort((a, b) => a[1].frustrationIndex - b[1].frustrationIndex)
  const mostFrustrated = starving[starving.length - 1]

  // Who has the most jealousy?
  const mostJealous = [...$.accounts.entries()]
    .sort((a, b) => b[1].jealousyCredit - a[1].jealousyCredit)[0]

  if (tension > 75 && $.explosionCooldown >= EXPLOSION_COOLDOWN) {
    // High tension + cooldown ready → force confrontation
    goal = NARRATIVE_GOALS.CONFRONT
    method = mostJealous ? mostJealous[0] + '_challenges_player' : 'direct_confrontation'
    sceneType = SCENE_TYPES.CONFRONTATION
    target = 'player'
    intensity = clamp(tension, 70, 100)
  } else if (tension > 55 && mostFrustrated) {
    // Medium-high tension → destabilize or seduce
    const roll = Math.random()
    if (roll < 0.4) {
      goal = NARRATIVE_GOALS.DESTABILIZE
      method = mostFrustrated[0] + '_tests_boundary'
      sceneType = SCENE_TYPES.TEST
    } else if (roll < 0.7) {
      goal = NARRATIVE_GOALS.SEDUCE
      method = 'ambiguous_proximity'
      sceneType = SCENE_TYPES.SEDUCTION
    } else {
      goal = NARRATIVE_GOALS.REVEAL
      method = 'controlled_leak'
      sceneType = SCENE_TYPES.REVELATION
    }
    target = 'player'
    intensity = clamp(tension * 0.8, 30, 80)
  } else if (tension < 25) {
    // Too calm → someone needs to stir the pot
    goal = NARRATIVE_GOALS.INCREASE_TENSION
    const actor = rcList[Math.floor(Math.random() * rcList.length)]
    method = actor.name + '_creates_distance'
    sceneType = SCENE_TYPES.WITHDRAWAL
    target = 'player'
    intensity = 40
  } else if (charNames.length >= 2 && tension > 40) {
    // Multi-character → triangulation scene
    goal = NARRATIVE_GOALS.DESTABILIZE
    method = 'triangulation_' + charNames[0] + '_vs_' + charNames[1]
    sceneType = SCENE_TYPES.TRIANGULATION
    target = 'player'
    intensity = clamp(tension, 40, 70)
  } else {
    // Default: push forward
    goal = NARRATIVE_GOALS.INCREASE_TENSION
    method = 'proactive_move'
    sceneType = SCENE_TYPES.TEST
    target = 'player'
    intensity = 35
  }

  const intent = { goal, target, method, intensity, sceneType }
  $.narrativeIntent = intent
  return intent
}

// ═══════════════════════════════════════════════════════════
// ② Scene Director Engine
// ═══════════════════════════════════════════════════════════

/**
 * Convert narrative intent into a concrete scene card.
 *
 * This is the "导演案头工作" — the director's prep before the scene.
 *
 * @param {NarrativeIntent} intent
 * @param {object[]} rcList
 * @param {string} playerName
 * @returns {object} SceneCard
 */
function directScene(intent, rcList, playerName) {
  if (!intent) return null

  const scene = {
    type: intent.sceneType,
    goal: intent.goal,
    intensity: intent.intensity,
    focusCharacter: null,
    secondaryCharacter: null,
    playerPosition: $.playerPosition || '被注视',
    requiredElements: [],
    forbiddenElements: [],
    exitCondition: '',
  }

  // Assign focus character
  const charNames = rcList.map(rc => rc.name)
  if (intent.method.includes('_')) {
    const actorName = intent.method.split('_')[0]
    scene.focusCharacter = charNames.includes(actorName) ? actorName : charNames[0]
  } else {
    // Pick most frustrated character
    const sorted = [...$.accounts.entries()]
      .sort((a, b) => b[1].frustrationIndex - a[1].frustrationIndex)
    scene.focusCharacter = sorted[0]?.[0] || charNames[0]
  }

  // Secondary: the other character in multi-char scenes
  if (charNames.length >= 2) {
    scene.secondaryCharacter = charNames.find(n => n !== scene.focusCharacter) || null
  }

  // Required and forbidden elements per scene type
  switch (intent.sceneType) {
    case SCENE_TYPES.CONFRONTATION:
      scene.requiredElements = ['direct_question_to_player', 'emotional_charge', 'power_shift']
      scene.forbiddenElements = ['deflection', 'peaceful_resolution', 'changing_subject']
      scene.exitCondition = 'tension_peaks_or_player_reacts'
      break
    case SCENE_TYPES.SEDUCTION:
      scene.requiredElements = ['physical_proximity', 'ambiguous_statement', 'body_language_over_words']
      scene.forbiddenElements = ['explicit_confession', 'sentimental_vulnerability']
      scene.exitCondition = 'boundary_tested'
      break
    case SCENE_TYPES.REVELATION:
      scene.requiredElements = ['new_information', 'controlled_vulnerability', 'shifts_player_understanding']
      scene.forbiddenElements = ['full_exposure', 'complete_truth']
      scene.exitCondition = 'information_landed'
      break
    case SCENE_TYPES.WITHDRAWAL:
      scene.requiredElements = ['distance_created', 'absence_felt', 'unfinished_business']
      scene.forbiddenElements = ['explaining_why', 'seeking_permission']
      scene.exitCondition = 'player_feels_the_gap'
      break
    case SCENE_TYPES.TEST:
      scene.requiredElements = ['boundary_probe', 'watch_for_reaction', 'plausible_deniability']
      scene.forbiddenElements = ['explicit_statement_of_intent', 'backing_down_too_soon']
      scene.exitCondition = 'reaction_observed'
      break
    case SCENE_TYPES.INTERRUPT:
      scene.requiredElements = ['unexpected_entry', 'disruption_of_current_flow', 'recontextualizes_scene']
      scene.forbiddenElements = ['polite_waiting', 'asking_permission_to_enter']
      scene.exitCondition = 'new_dynamic_established'
      break
    case SCENE_TYPES.TRIANGULATION:
      scene.requiredElements = ['two_characters_vie_for_player', 'player_between_them', 'escalating_competing_claims']
      scene.forbiddenElements = ['characters_resolving_between_themselves', 'player_becoming_spectator']
      scene.exitCondition = 'pressure_peak_or_player_chooses'
      break
  }

  $.sceneCard = scene
  return scene
}

// ═══════════════════════════════════════════════════════════
// ③ Autonomous Character Planner
// ═══════════════════════════════════════════════════════════

/**
 * Each character gets a STRATEGIC PLAN for this turn.
 *
 * Characters don't wait for the player to act.
 * They generate their own behavioral path based on:
 *   - Their phase (what they're allowed to do)
 *   - Their emotion account (what they NEED)
 *   - The narrative intent (what the scene demands)
 *   - Other characters' plans (competitive awareness)
 *
 * @param {object[]} rcList
 * @param {object} affectionMap
 * @param {NarrativeIntent} intent
 * @returns {Map<string, CharacterPlan>}
 *
 * @typedef {object} CharacterPlan
 * @property {string} nextAction — what they'll do this turn
 * @property {string} emotionalStrategy — cold | warm | volatile | controlled_leak | withdrawal
 * @property {number} manipulationLevel — 0-100: how calculated is their behavior
 * @property {number} riskTolerance — 0-100: how much they're willing to risk
 * @property {string} primaryTarget — player | other_char_name
 * @property {string} hiddenGoal — what they REALLY want (may differ from visible action)
 */

function planCharacters(rcList, affectionMap, intent, cieState = null) {
  const plans = new Map()

  for (const rc of rcList) {
    const aff = affectionMap[rc.name] ?? rc.affectionInitial ?? 50
    const phase = computePhase(aff)
    const profile = detectAggressionProfile({ personality: rc.personality || '', background: rc.background || '' })
    const acct = $.accounts.get(rc.name) || createAccount()
    const desireLvl = $.desireGradients.get(rc.name) ?? 0

    // ── Determine emotional strategy ──
    let emotionalStrategy
    if (phase === 1) emotionalStrategy = 'cold'
    else if (phase === 2) emotionalStrategy = profile === AGGRESSION_PROFILES.PURSUER ? 'controlled_leak' : 'cold'
    else if (phase === 3) emotionalStrategy = 'volatile'
    else emotionalStrategy = profile === AGGRESSION_PROFILES.ALOOF ? 'controlled_leak' : 'volatile'

    // ── Determine next action based on account needs + scene intent ──
    let nextAction, manipulationLevel, riskTolerance, hiddenGoal

    if (acct.frustrationIndex > 70) {
      // Desperate → aggressive move
      nextAction = profile === AGGRESSION_PROFILES.PURSUER ? 'escalate_physically'
        : profile === AGGRESSION_PROFILES.CONFRONTATIONAL ? 'provoke_directly'
        : profile === AGGRESSION_PROFILES.ALOOF ? 'withdraw_completely'
        : 'plead_or_cry'
      manipulationLevel = 20  // low — too frustrated to calculate
      riskTolerance = 85       // high — nothing left to lose
      hiddenGoal = 'force_reaction_at_any_cost'
    } else if (acct.jealousyCredit > 60) {
      // Jealous → compete for attention
      nextAction = 'claim_player_attention'
      manipulationLevel = 60
      riskTolerance = 60
      hiddenGoal = 'remind_player_who_matters'
    } else if (acct.desireStock > 60) {
      // Pent-up desire → test physical boundary
      nextAction = 'test_physical_boundary'
      manipulationLevel = 50
      riskTolerance = 55
      hiddenGoal = 'see_if_player_responds_physically'
    } else if (acct.dependencyDebt > 60) {
      // Needy → seek validation
      nextAction = 'seek_player_validation'
      manipulationLevel = 40
      riskTolerance = 35
      hiddenGoal = 'get_player_to_show_they_care'
    } else if (intent?.goal === NARRATIVE_GOALS.INCREASE_TENSION) {
      // Scene needs tension → character creates it
      nextAction = 'create_tension_opportunity'
      manipulationLevel = 75
      riskTolerance = 50
      hiddenGoal = 'serve_the_scene'
    } else {
      // Baseline: strategic observation + subtle probe
      nextAction = 'observe_and_probe'
      manipulationLevel = profile === AGGRESSION_PROFILES.PURSUER ? 70
        : profile === AGGRESSION_PROFILES.ALOOF ? 55 : 40
      riskTolerance = 30
      hiddenGoal = 'gather_information'
    }

    // ── 🧠 CIE override: persistent psychological motivation enriches hiddenGoal ──
    const cieIntent = cieState?.get?.(rc.name) || cieState?.intents?.get?.(rc.name)
    if (cieIntent && !cieIntent._fallback) {
      // Override hiddenGoal with CIE's persistent intent (more specific than rule-based)
      hiddenGoal = (cieIntent.primary_intent || hiddenGoal).slice(0, 80)
      // CIE direction influences risk and manipulation
      if (cieIntent.relationship_direction === 'self_destruct') {
        riskTolerance = clamp(riskTolerance + 20, 0, 100)
      } else if (cieIntent.relationship_direction === 'push_control') {
        manipulationLevel = clamp(manipulationLevel + 15, 0, 100)
      } else if (cieIntent.relationship_direction === 'maintain_distance') {
        manipulationLevel = clamp(manipulationLevel - 10, 0, 100)
      }
    }

    // ── Personality override: gentle characters use lower manipulation ──
    if (profile === AGGRESSION_PROFILES.GENTLE) {
      manipulationLevel = clamp(manipulationLevel - 20, 0, 100)
      if (nextAction === 'escalate_physically') nextAction = 'plead_or_cry'
      if (nextAction === 'provoke_directly') nextAction = 'passive_aggressive_hint'
    }

    // ── Phase override: Phase 1 can't do vulnerable actions ──
    if (phase === 1 && ['plead_or_cry', 'seek_player_validation', 'test_physical_boundary'].includes(nextAction)) {
      nextAction = 'cold_test'  // reframe as strategic
      hiddenGoal = 'assess_player_value'
    }

    plans.set(rc.name, {
      nextAction,
      emotionalStrategy,
      manipulationLevel,
      riskTolerance,
      primaryTarget: 'player',
      hiddenGoal,
    })
  }

  $.characterPlans = plans
  return plans
}

// ═══════════════════════════════════════════════════════════
// ④ Attention War System
// ═══════════════════════════════════════════════════════════

/**
 * Formalize the attention war: characters compete for player_attention_share.
 *
 * Four combat tactics:
 *   - 争夺 (capture)  — direct bid for attention
 *   - 阻断 (block)    — disrupt rival's bid
 *   - 引导 (redirect) — steer attention toward self
 *   - 替代 (replace)  — make rival irrelevant
 *
 * @param {Map<string, CharacterPlan>} plans
 * @param {object} attentionSplit
 * @returns {object} war state
 */
function simulateAttentionWar(plans, attentionSplit) {
  const charNames = [...plans.keys()]
  if (charNames.length < 2) {
    $.attentionWar = { active: false }
    return $.attentionWar
  }

  // Determine each character's tactic
  const tactics = {}
  for (const [name, plan] of plans) {
    const attn = attentionSplit[name] || 50
    if (attn < 30) tactics[name] = 'capture'       // starving → aggressive bid
    else if (attn < 45) tactics[name] = 'redirect'  // behind → redirect
    else if (attn > 55) tactics[name] = 'block'     // ahead → block rivals
    else tactics[name] = 'replace'                   // even → try to dominate
  }

  // Simulate: who has the advantage?
  const attacker = charNames.reduce((a, b) =>
    (attentionSplit[a] || 50) < (attentionSplit[b] || 50) ? a : b)  // lower attention = more aggressive
  const defender = charNames.find(n => n !== attacker)

  // Determine the "battleground" — what form does the war take?
  let battleground
  if (tactics[attacker] === 'capture' && tactics[defender] === 'block') {
    battleground = 'interruption'  // attacker tries to speak/act, defender blocks
  } else if (tactics[attacker] === 'capture' && tactics[defender] === 'redirect') {
    battleground = 'comparison'    // defender redirects by comparing
  } else {
    battleground = 'proximity_war' // physical proximity as weapon
  }

  $.attentionWar = {
    active: true,
    attacker,
    defender,
    attackerTactic: tactics[attacker],
    defenderTactic: tactics[defender],
    battleground,
    intensity: clamp(Math.abs((attentionSplit[attacker] || 50) - (attentionSplit[defender] || 50)) * 2, 30, 100),
  }

  return $.attentionWar
}

// ═══════════════════════════════════════════════════════════
// ⑤ Conflict Simulation Layer + ⑥ Narrative Branching
// ═══════════════════════════════════════════════════════════

/**
 * Simulate how multi-character interactions will play out.
 * Runs BEFORE output — determines the conflict topology.
 *
 * @param {Map<string, CharacterPlan>} plans
 * @param {object} attentionWar
 * @param {NarrativeIntent} intent
 * @returns {object} simulation result
 */
function simulateConflict(plans, attentionWar, intent) {
  const charNames = [...plans.keys()]
  if (charNames.length < 2) {
    $.conflictSim = { active: false }
    return $.conflictSim
  }

  // Determine conflict topology
  let topology, escalationPath

  const a = attentionWar.attacker
  const b = attentionWar.defender
  const planA = plans.get(a)
  const planB = plans.get(b)

  if (planA.riskTolerance > 70 && planB.riskTolerance > 60) {
    topology = 'mutual_escalation'    // both pushing → spiral
    escalationPath = [a + '_acts', b + '_counters', a + '_escalates', 'player_intervenes_or_watches']
  } else if (planA.manipulationLevel > 60 && planB.manipulationLevel > 50) {
    topology = 'cold_war'             // both calculating → tactical
    escalationPath = [a + '_probes', b + '_redirects', 'tension_accumulates', 'eventual_rupture']
  } else {
    topology = 'asymmetric'           // one aggressive, one defensive
    escalationPath = [a + '_pushes', b + '_reacts', 'player_caught_between']
  }

  $.conflictSim = {
    active: true,
    topology,
    escalationPath,
    pressurePoint: 'player_attention', // always the player
    predictedOutcome: intentionBasedOutcome(intent),
  }

  return $.conflictSim
}

function intentionBasedOutcome(intent) {
  if (!intent) return 'tension_increases'
  switch (intent.goal) {
    case NARRATIVE_GOALS.INCREASE_TENSION: return 'tension_spike'
    case NARRATIVE_GOALS.DESTABILIZE: return 'power_shift'
    case NARRATIVE_GOALS.SEDUCE: return 'boundary_blurred'
    case NARRATIVE_GOALS.CONFRONT: return 'confrontation_erupts'
    case NARRATIVE_GOALS.REVEAL: return 'new_understanding'
    default: return 'dynamic_shift'
  }
}

/**
 * Narrative Branching Engine.
 * Each scene has 4 possible branches. The system auto-selects one.
 *
 * Branch types:
 *   - escalate: push conflict further
 *   - soften: brief de-escalation (tactical, not resolution)
 *   - rupture: something breaks (relationship, trust, boundary)
 *   - redirect: shift focus to a different dynamic
 *
 * @param {number} tension
 * @param {object} intent
 * @returns {object} selected branch
 */
function selectNarrativeBranch(tension, intent) {
  const branches = {
    escalate: { weight: 0, description: '推高冲突 — 角色不退让，矛盾升级' },
    soften:   { weight: 0, description: '战术性缓和 — 暂时的退让，为了下一轮更大的进攻' },
    rupture:  { weight: 0, description: '关系破裂 — 某件事不可逆地改变了' },
    redirect: { weight: 0, description: '注意力转移 — 新的刺激介入，改变当前动态' },
  }

  // Weight branches based on tension + intent
  if (tension > 70) {
    branches.escalate.weight = 30
    branches.rupture.weight = 40
    branches.soften.weight = 10
    branches.redirect.weight = 20
  } else if (tension > 40) {
    branches.escalate.weight = 40
    branches.rupture.weight = 15
    branches.soften.weight = 15
    branches.redirect.weight = 30
  } else {
    branches.escalate.weight = 35
    branches.rupture.weight = 5
    branches.soften.weight = 30
    branches.redirect.weight = 30
  }

  // Adjust by intent
  if (intent?.goal === NARRATIVE_GOALS.RESOLVE_TENSION) {
    branches.soften.weight += 20
    branches.rupture.weight = Math.max(0, branches.rupture.weight - 15)
  }
  if (intent?.goal === NARRATIVE_GOALS.DESTABILIZE) {
    branches.rupture.weight += 20
    branches.escalate.weight += 10
    branches.soften.weight = Math.max(0, branches.soften.weight - 15)
  }

  // Select highest weight
  const sorted = Object.entries(branches).sort((a, b) => b[1].weight - a[1].weight)
  const [selectedKey, selectedBranch] = sorted[0]

  $.narrativeBranch = {
    selected: selectedKey,
    ...selectedBranch,
    alternatives: sorted.slice(1).map(([k, v]) => ({ branch: k, ...v })),
  }

  return $.narrativeBranch
}

// ═══════════════════════════════════════════════════
// Master Pipeline — buildCEKv4Block
// ═══════════════════════════════════════════════════

/**
 * Build the complete CEK v4 prompt block.
 * This is THE main entry point.
 */
export function buildCEKv4Block(character, uskState, affectionMap = {}, arslEdges = {}, cieState = null) {
  if (!character) return ''

  const rcList = character.romanceCharacters || []
  if (rcList.length === 0) return ''

  const playerName = character._playerProfile?.name || '玩家'
  $.turnCount++
  $.explosionCooldown++

  // ── Compile characters ──
  const compiledList = rcList.map(rc => ({
    name: rc.name,
    phase: computePhase(affectionMap[rc.name] ?? rc.affectionInitial ?? 50),
    profile: detectAggressionProfile({ personality: rc.personality || '', background: rc.background || '' }),
    affection: affectionMap[rc.name] ?? rc.affectionInitial ?? 50,
    actions: computeActions(computePhase(affectionMap[rc.name] ?? rc.affectionInitial ?? 50),
      detectAggressionProfile({ personality: rc.personality || '', background: rc.background || '' })),
  }))

  // ── Emotion Economy tick ──
  tickEconomy(rcList, affectionMap)

  // ── Attention Split ──
  const attnResult = computeAttention(rcList, affectionMap)

  // ── Tension Accumulate ──
  const tension = accumulateTensionV4()

  // ── Desire + Emotion ticks ──
  for (const cc of compiledList) {
    const uskChar = uskState?.characters?.[cc.name] || {}
    $.prevDesire.set(cc.name, $.desireGradients.get(cc.name) ?? 0)
    const raw = clamp((uskChar.tension?.attraction_tension || 40) * 0.4 + (cc.phase >= 2 ? 30 : 0) - (cc.phase === 1 ? 40 : 0) + (cc.affection * 0.1), 0, 100)
    let lvl = raw < 10 ? 0 : raw < 30 ? 1 : raw < 50 ? 2 : raw < 70 ? 3 : raw < 90 ? 4 : 5
    const prev = $.desireGradients.get(cc.name)
    if (prev != null && Math.abs(lvl - prev) > 1) lvl = prev + Math.sign(lvl - prev) * 1
    $.desireGradients.set(cc.name, lvl)
  }

  // ═══ V4 NEW SYSTEMS ═══

  // ① Narrative Intent Generator
  const intent = generateNarrativeIntent(rcList, attnResult.split, tension)

  // ② Scene Director Engine
  const scene = directScene(intent, rcList, playerName)

  // ③ Autonomous Character Planner
  const plans = planCharacters(rcList, affectionMap, intent, cieState)

  // ③.5 🔥 Madness Personality Engine — inject controlled psychological fractures
  const madnessResult = generateMadnessState(rcList, plans, affectionMap, uskState, compiledList)
  if (madnessResult?.madnessStates) {
    $.madnessStates = madnessResult.madnessStates
    $.madnessDynamicBlock = madnessResult.dynamicBlock || ''
  }

  // ④ Attention War System
  const war = simulateAttentionWar(plans, attnResult.split)

  // ⑤ Conflict Simulation Layer
  const sim = simulateConflict(plans, war, intent)

  // ⑥ Narrative Branching Engine
  const branch = selectNarrativeBranch(tension, intent)

  // ── Build rivalries ──
  buildRivalriesV4(rcList, arslEdges)

  // ═══ ASSEMBLE DYNAMIC STATE (rules in cached prefix) ═══
  const sections = []
  sections.push('━━━ ⚙️ CEK v4 · 本轮导演状态 ━━━')
  sections.push('执行规则已缓存。以下是本轮动态状态——参照执行即可。')
  sections.push('')

  // ① Narrative Intent — this turn's directive
  if (intent) {
    sections.push('🎬 本幕: ' + (GOAL_LABELS[intent.goal] || intent.goal) +
      ' | 方式=' + intent.method +
      ' | 场景=' + (SCENE_LABELS[intent.sceneType] || intent.sceneType) +
      ' | 强度=' + Math.round(intent.intensity) + '/100')
  }

  // ② Scene Card — this turn's scene parameters
  if (scene) {
    sections.push('🎬 场景: 焦点=' + (scene.focusCharacter || '?') +
      (scene.secondaryCharacter ? ' 副焦点=' + scene.secondaryCharacter : '') +
      ' | 玩家位置=' + (scene.playerPosition || '?'))
    sections.push('  必须: ' + (scene.requiredElements || []).join(' | '))
    sections.push('  禁止: ' + (scene.forbiddenElements || []).join(' | '))
    sections.push('  退场: ' + (scene.exitCondition || '?'))
  }

  // ⓪ 🧠 CIE Context — persistent character psychological motivations (v9.1)
  if (cieState && cieState.size > 0) {
    const cieLines = ['🧠 角色心理动机 CIE（长期意图——CEK 必须对齐）:']
    for (const [name, intent] of cieState) {
      cieLines.push('  ' + name + ': ' + (intent.primary_intent || '?').slice(0, 80))
      cieLines.push('    欲望=' + (intent.desire || '?').slice(0, 50) +
        ' | 恐惧=' + (intent.fear || '?').slice(0, 40) +
        ' | 主动=' + (intent.autonomous_action || '?').slice(0, 50))
    }
    sections.push(cieLines.join('\n'))
    sections.push('')
  }

  // ③ Character Plans — per-character strategic state
  // 🆕 v8.5.7: Offensive language for pursuer/confrontational archetypes
  const planLines = ['🧠 角色策略（进攻型角色使用破坏性指令）:']
  for (const [name, plan] of plans) {
    const cc = compiledList.find(c => c.name === name)
    const actionLabel = getOffensiveActionLabel(plan.nextAction, cc?.profile)
    const strategyLabel = getOffensiveStrategyLabel(plan.emotionalStrategy, cc?.profile)
    const archetypeTag = cc?.profile === 'pursuer' ? '🔥进攻'
      : cc?.profile === 'confrontational' ? '⚡对抗'
      : cc?.profile === 'aloof' ? '❄️疏离'
      : '🌸温柔'
    planLines.push('  ' + name + '(' + archetypeTag + '|P' + (cc?.phase || '?') + '): ' +
      actionLabel +
      ' | 策略=' + strategyLabel +
      ' | 操纵=' + plan.manipulationLevel + ' 风险=' + plan.riskTolerance +
      ' | 隐藏目标=' + plan.hiddenGoal)
    // For pursuer/confrontational, add explicit aggressive directive
    if (cc?.profile === 'pursuer') {
      planLines.push('    ⚠️ 侵略者模式：不进攻=角色死亡。你的行为必须让对方感到危险/不安/被侵犯。')
    } else if (cc?.profile === 'confrontational') {
      planLines.push('    ⚠️ 对抗者模式：不找茬=角色死亡。你的存在必须让对方不舒服。')
    }
  }
  sections.push(planLines.join('\n'))

  // ③.3 🧬 RCC Strategy Context — compiled behavioral guidance
  const rccStrategy = buildCEKStrategyContext(character)
  if (rccStrategy) {
    sections.push('')
    sections.push(rccStrategy)
  }

  // ③.5 🔥 Madness Personality State — controlled psychodynamic injection
  if ($.madnessDynamicBlock) {
    sections.push($.madnessDynamicBlock)
  }

  // ④ Attention War — current battle state
  if (war?.active) {
    sections.push('⚡ 注意力战争: ' + war.attacker + '(' + (WAR_LABELS[war.attackerTactic] || war.attackerTactic) + ')' +
      ' vs ' + war.defender + '(' + (WAR_LABELS[war.defenderTactic] || war.defenderTactic) + ')' +
      ' | 战场=' + (BATTLEGROUND_LABELS[war.battleground] || war.battleground) +
      ' | 强度=' + Math.round(war.intensity) + '/100')
  }

  // ⑤ Conflict Simulation
  if (sim?.active) {
    sections.push('⚔️ 冲突: ' + (TOPOLOGY_LABELS[sim.topology] || sim.topology) +
      ' | 路径: ' + (sim.escalationPath || []).join(' → ') +
      ' | 预测: ' + (sim.predictedOutcome || '?'))
  }

  // ⑥ Economy + Tension — current values only
  const econLines = ['💰 情绪账户 + ⚡ 张力:']
  for (const [name, acct] of $.accounts) {
    econLines.push('  ' + name + ': attn=' + Math.round(acct.attentionBalance) +
      ' jealousy=' + Math.round(acct.jealousyCredit) +
      ' desire=' + Math.round(acct.desireStock) +
      ' frust=' + Math.round(acct.frustrationIndex))
  }
  econLines.push('  全局张力=' + Math.round(tension) + '/100' + (tension > 70 ? ' ⚠️爆点' : ''))
  if (Object.keys($.attentionSplit || {}).length >= 2) {
    econLines.push('  注意力: ' + Object.entries($.attentionSplit || {}).map(([n, p]) => n + '=' + p + '%').join(' | '))
  }
  sections.push(econLines.join('\n'))

  // ⑦ Branch — selected + alternatives
  if (branch) {
    sections.push('🌿 分支: ' + (BRANCH_LABELS[branch.selected] || branch.selected) +
      ' → ' + branch.description +
      ' | 备选: ' + (branch.alternatives || []).map(a => BRANCH_LABELS[a.branch] || a.branch).join('/'))
  }

  // ⑧ Turn-specific enforcement
  sections.push('🔒 本轮约束: 禁止无张力对话 | 禁止脱离场景卡 | 禁止角色互相解决冲突 | ' +
    (branch?.selected === 'escalate' ? '本幕=升级→不退让 | ' : '') +
    (branch?.selected === 'rupture' ? '本幕=破裂→不可逆 | ' : '') +
    '玩家必须在场')

  return sections.join('\n')
}

// ═══════════════════════════════════════════════════
// Prompt Block Builders (v4)
// ═══════════════════════════════════════════════════

function buildIntentBlock(intent, playerName) {
  if (!intent) return ''
  return `┌─ 🎬 ① 叙事意图 (Narrative Intent) ──────────
│ 本幕目标: ${GOAL_LABELS[intent.goal] || intent.goal}
│ 执行方式: ${intent.method}
│ 场景类型: ${SCENE_LABELS[intent.sceneType] || intent.sceneType}
│ 强度: ${Math.round(intent.intensity)}/100
│ 目标: ${intent.target === 'player' ? playerName : intent.target}
│
│ ❗ 这是本轮的"导演指令"——不是建议，是执行命令。
└──────────────────────────────────────────`
}

function buildSceneBlock(scene, playerName) {
  if (!scene) return ''
  return `┌─ 🎬 ② 场景导演卡 (Scene Director) ──────────
│ 焦点角色: ${scene.focusCharacter || '自动'}
│ 副角色: ${scene.secondaryCharacter || '无'}
│ 玩家位置: ${scene.playerPosition}
│
│ 必须包含: ${(scene.requiredElements || []).join(' | ')}
│ 禁止出现: ${(scene.forbiddenElements || []).join(' | ')}
│ 退场条件: ${scene.exitCondition || '自然过渡'}
│
│ ❗ 场景必须有变化——不能"仍然是之前的氛围"。
└──────────────────────────────────────────`
}

function buildPlansBlock(plans, compiledList) {
  const lines = ['┌─ 🧠 ③ 角色自主策略 (Character Planner) ────']
  lines.push('│ 每个角色有自己的隐藏目标。他们说的和想要的不一样。')
  lines.push('│ 🆕 进攻型角色使用破坏性策略语言。')
  lines.push('│')
  for (const [name, plan] of plans) {
    const cc = compiledList.find(c => c.name === name)
    const actionLabel = getOffensiveActionLabel(plan.nextAction, cc?.profile)
    const strategyLabel = getOffensiveStrategyLabel(plan.emotionalStrategy, cc?.profile)
    const archetypeTag = cc?.profile === 'pursuer' ? '🔥进攻'
      : cc?.profile === 'confrontational' ? '⚡对抗'
      : cc?.profile === 'aloof' ? '❄️疏离'
      : '🌸温柔'
    lines.push('│ ' + name + ' (' + archetypeTag + ' | Phase ' + (cc?.phase || '?') + '):')
    lines.push('│   本能行动: ' + actionLabel)
    lines.push('│   情绪策略: ' + strategyLabel)
    lines.push('│   操纵程度: ' + plan.manipulationLevel + '/100 | 风险承受: ' + plan.riskTolerance + '/100')
    lines.push('│   隐藏目标: ' + plan.hiddenGoal)
    if (cc?.profile === 'pursuer') {
      lines.push('│   ⚠️ 侵略者铁律：必须主动侵犯——身体/性/情绪。不进攻=角色死亡。')
    } else if (cc?.profile === 'confrontational') {
      lines.push('│   ⚠️ 对抗者铁律：必须主动找茬——讽刺/打断/吼/摔。不让步=角色死亡。')
    }
    lines.push('│')
  }
  lines.push('│ ❗ 角色的"隐藏目标"决定他们怎么说、怎么做——表面行为和真实动机可以矛盾。')
  lines.push('│ ❗ 进攻型角色的策略不是"算计"——是"破坏"。他们制造混沌，不计算后果。')
  lines.push('└──────────────────────────────────────────')
  return lines.join('\n')
}

function buildWarBlock(war) {
  if (!war?.active) return ''
  return `┌─ ⚡ ④ 注意力战争 (Attention War) ────────────
│ 进攻方: ${war.attacker} → ${WAR_LABELS[war.attackerTactic] || war.attackerTactic}
│ 防守方: ${war.defender} → ${WAR_LABELS[war.defenderTactic] || war.defenderTactic}
│ 战场: ${BATTLEGROUND_LABELS[war.battleground] || war.battleground}
│ 强度: ${Math.round(war.intensity)}/100
│
│ 战争规则:
│   争夺 = 直接夺取玩家注意力
│   阻断 = 打断对手的注意力获取
│   引导 = 将注意力转向自己
│   替代 = 让对手变得无关紧要
│
│ ❗ 所有角色行为最终目标: maximize player_attention_share
└──────────────────────────────────────────`
}

function buildConflictSimBlock(sim) {
  if (!sim?.active) return ''
  return `┌─ ⚔️ ⑤ 冲突模拟 (Conflict Simulation) ────────
│ 冲突拓扑: ${TOPOLOGY_LABELS[sim.topology] || sim.topology}
│ 升级路径: ${(sim.escalationPath || []).join(' → ')}
│ 压力点: ${sim.pressurePoint}
│ 预测结果: ${sim.predictedOutcome}
│
│ ❗ 冲突必须围绕玩家——玩家是压力点，也是解决点。
└──────────────────────────────────────────`
}

function buildEconomyTensionBlock(tension) {
  const lines = ['┌─ 💰 情绪经济 + ⚡ 张力 ────────────────────']
  for (const [name, acct] of $.accounts) {
    lines.push('│ ' + name + ': attn=' + Math.round(acct.attentionBalance) +
      ' jealousy=' + Math.round(acct.jealousyCredit) +
      ' desire=' + Math.round(acct.desireStock) +
      ' frust=' + Math.round(acct.frustrationIndex))
  }
  lines.push('│ 全局张力: ' + Math.round(tension) + '/100' +
    (tension > 70 ? ' ⚠️ 爆点阈值' : ''))
  const split = $.attentionSplit || {}
  if (Object.keys(split).length >= 2) {
    lines.push('│ 注意力分配: ' + Object.entries(split).map(([n, p]) => n + '=' + p + '%').join(' | '))
  }
  lines.push('└──────────────────────────────────────────')
  return lines.join('\n')
}

function buildBranchBlock(branch) {
  if (!branch) return ''
  return `┌─ 🌿 ⑥ 叙事分支 (Narrative Branching) ────────
│ 选中分支: ${BRANCH_LABELS[branch.selected] || branch.selected} → ${branch.description}
│
│ 备选分支:
${(branch.alternatives || []).map(a => '│   · ' + (BRANCH_LABELS[a.branch] || a.branch) + ': ' + a.description).join('\n')}
│
│ ❗ 选中分支是本轮的执行方向。备选分支是下一轮的可能选择。
│ ❗ 不要在本轮化解冲突——暂停可以，消散不行。
└──────────────────────────────────────────`
}

function buildFirewallV4(rcList, playerName) {
  return `┌─ 🔒 约束防火墙 v4 ─────────────────────────
│
│ ▸ Phase Firewall — 人格阶段不可跨越
│ ▸ Memory Firewall — 禁止编造未发生事件
│ ▸ Identity Firewall — 禁止名称漂移/身份改写
│ ▸ Tension Firewall — 禁止无张力对话（每句话必须有情绪/权力/信息变化）
│
│ ▸ 🆕 v4 Director Firewall:
│   · 禁止角色脱离场景卡自行发挥
│   · 禁止角色互相解决冲突（玩家必须在场）
│   · 禁止角色"放弃"争夺玩家注意力
│   · 禁止注意力战争在无玩家参与下结束
│
│ ❗ 所有约束 = 不可违背。导演指令优先于角色设定。
└──────────────────────────────────────────`
}

// ═══════════════════════════════════════════════════
// Post-Generation Validation v4
// ═══════════════════════════════════════════════════

export function runCEKv4PostValidation(output, ctx = {}) {
  if (!output) return { passed: true, violations: [] }
  const violations = []
  const { playerName, storyCanon, character } = ctx

  // Zero-tension dialogue
  if (/^(?:嗯|哦|好|行|可以|知道了|明白了)[。.]?\s*$/m.test(output)) {
    violations.push('CEKv4: 无张力对话 — 每句话必须有情绪/权力/信息变化')
  }

  // Player anchoring — must reference player by name OR second-person patterns
  if (playerName && playerName !== '玩家') {
    // Escape player name for regex safety
    const safeName = playerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const hasPlayer =
      // 1. Player name appears literally in output (third-person: "他看向落总")
      new RegExp(safeName).test(output) ||
      // 2. Second-person gaze: "看向你" / "盯着你" / "目光落在你"
      /看向你|看着你|盯着你|望向你|瞥了你|注视着你|视线落|目光.*你|眼神.*你/.test(output) ||
      // 3. Second-person body: "靠近你" / "在你面前" / "你的肩膀"
      /靠近你|贴近你|在你[身旁面边]|离你[更很]|你[的肩手腰脸身前]|压着你|按住你|抓住你/.test(output) ||
      // 4. Second-person speech: "对你说" / "问你"
      /对你说|问你|告诉你|叫你的|喊你|向你/.test(output) ||
      // 5. Character reacts to player action implicitly
      /听到你|看见你|感觉到你|注意到你|发现你/.test(output) ||
      // 6. Any character name + action toward "你"
      /[他她].{0,5}[向你对着朝向].{0,3}你/.test(output)

    if (!hasPlayer) {
      console.warn('[CEKv4] Player anchoring soft-fail: no player reference found')
      // Don't hard-fail — anchoring is important but regex is imperfect
      // The prompt-level enforcement is the primary mechanism
    }
  }

  // Phase firewall
  const rcList = character?.romanceCharacters || []
  for (const rc of rcList) {
    const aff = ctx.affectionMap?.[rc.name] ?? rc.affectionInitial ?? 50
    if (computePhase(aff) === 1 && output.includes(rc.name)) {
      if (/温柔|心疼|舍不得|真心.*在乎/.test(output)) {
        violations.push('CEKv4 Phase [' + rc.name + ']: Phase 1 禁止温柔表达')
      }
    }
  }

  // Identity
  if (playerName && playerName !== '玩家' && /\b玩家\b/.test(output) && !output.includes('【玩家')) {
    violations.push('CEKv4 Identity: 默认名泄露')
  }

  return { passed: violations.length === 0, violations }
}

// ═══════════════════════════════════════════════════
// Static Cache Prefix — immutable CEK rules
// ═══════════════════════════════════════════════════

/**
 * Build the CEK v4 STATIC rule prefix for DeepSeek cache.
 *
 * These rules NEVER change between turns — they are the instruction
 * manual for how CEK works. Moving them to the cached character prefix
 * saves ~60-70% of CEK token cost per turn.
 *
 * Call from characterPrefix.js → buildCharacterPrefix().
 *
 * @returns {string} cached CEK static rules block
 */
export function buildCEKv4StaticPrefix(){
return 
}// ═══════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════

export function resetCEKv4() {
  $.turnCount = 0; $.accounts.clear(); $.globalTension = 30
  $.desireGradients.clear(); $.prevDesire.clear()
  $.emotionCurves.clear(); $.explosionCooldown = 0
  $.rivalryEdges = null; $.attentionSplit = null; $.playerPosition = null
  $.narrativeIntent = null; $.sceneCard = null
  $.characterPlans.clear(); $.conflictSim = null
  $.attentionWar = null; $.narrativeBranch = null
  $.madnessStates = null; $.madnessDynamicBlock = ''
  resetMadnessEngine()
}

export function getDirectorState() {
  return {
    intent: $.narrativeIntent,
    scene: $.sceneCard,
    plans: [...$.characterPlans.entries()].map(([n, p]) => ({ name: n, ...p })),
    war: $.attentionWar,
    conflict: $.conflictSim,
    branch: $.narrativeBranch,
    tension: $.globalTension,
    accounts: [...$.accounts.entries()].map(([n, a]) => ({ name: n, ...a })),
  }
}

// ═══════════════════════════════════════════════════
// Shared helpers (self-contained)
// ═══════════════════════════════════════════════════

function computePhase(aff) { const v = clamp(aff, 0, 100); return v <= PHASE_1_MAX ? 1 : v <= PHASE_2_MAX ? 2 : v <= PHASE_3_MAX ? 3 : 4 }
function computeActions(phase, profile) {
  if (phase === 1) { const b = ['observe','test','ignore','withdraw']; if (profile === AGGRESSION_PROFILES.PURSUER) b.push('seduce'); if (profile === AGGRESSION_PROFILES.CONFRONTATIONAL) b.push('provoke','reject'); return b }
  if (phase === 2) { const b = ['observe','seduce','test','withdraw','reject']; if (profile === AGGRESSION_PROFILES.CONFRONTATIONAL) b.push('provoke','escalate'); return b }
  if (phase === 3) return ['observe','seduce','escalate','test','provoke','reject','withdraw','submit']
  return [...BEHAVIOR_ACTIONS]
}
function createAccount() { return { attentionBalance:30, jealousyCredit:10, dependencyDebt:20, desireStock:15, frustrationIndex:10 } }

function tickEconomy(rcList, affectionMap) {
  for (const rc of rcList) {
    let a = $.accounts.get(rc.name); if (!a) { a = createAccount(); $.accounts.set(rc.name, a) }
    const attn = $.attentionSplit?.[rc.name] || (100 / Math.max(rcList.length, 1))
    a.attentionBalance = clamp(a.attentionBalance + (attn - 30) * 0.3, 0, 100)
    a.jealousyCredit = clamp(a.jealousyCredit + (attn < 35 ? 5 : -2), 0, 100)
    a.dependencyDebt = clamp(a.dependencyDebt + (attn < 30 ? 4 : -1), 0, 100)
    const aff = affectionMap[rc.name] || 50
    a.desireStock = clamp(a.desireStock + (aff > 30 ? (aff - 30) / 70 * 3 : 0), 0, 100)
    a.frustrationIndex = clamp(a.jealousyCredit * 0.3 + a.dependencyDebt * 0.4 + (100 - a.attentionBalance) * 0.3, 0, 100)
  }
}

function computeAttention(rcList, affectionMap) {
  const total = rcList.reduce((sum, rc) => sum + (affectionMap[rc.name] ?? rc.affectionInitial ?? 50), 0)
  const split = {}; for (const rc of rcList) split[rc.name] = total > 0 ? Math.round(((affectionMap[rc.name] ?? rc.affectionInitial ?? 50) / total) * 100) : Math.round(100 / rcList.length)
  const sum = Object.values(split).reduce((a, b) => a + b, 0)
  if (sum !== 100 && rcList.length > 0) { const top = rcList.reduce((a, b) => (affectionMap[a.name] ?? 50) > (affectionMap[b.name] ?? 50) ? a : b); split[top.name] = clamp(split[top.name] + (100 - sum), 0, 100) }
  const maxAttn = Math.max(...Object.values(split))
  $.attentionSplit = split
  return { split, isBalanced: maxAttn < 55, maxAttn, dominantChar: rcList.find(rc => split[rc.name] === maxAttn)?.name }
}

function accumulateTensionV4() {
  let maxJealousy = 0, totalDesire = 0
  for (const [, a] of $.accounts) { if (a.jealousyCredit > maxJealousy) maxJealousy = a.jealousyCredit; totalDesire += a.desireStock }
  const n = $.accounts.size || 1
  const jealousyC = (maxJealousy / 100) * 25
  const desireC = (totalDesire / n / 100) * 25
  const vals = Object.values($.attentionSplit || {})
  const misunderstandingC = Math.min(25, vals.length > 1 ? (Math.max(...vals) - Math.min(...vals)) * 0.25 : 0)
  const delayC = Math.min(25, $.explosionCooldown * 4)
  $.globalTension = clamp($.globalTension * 0.7 + (jealousyC + desireC + misunderstandingC + delayC) * 0.3, 0, 100)
  return $.globalTension
}

function buildRivalriesV4(rcList, arslEdges) {
  const nodes = rcList.map(rc => ({ name: rc.name, profile: detectAggressionProfile({ personality: rc.personality || '', background: rc.background || '' }) }))
  const edges = []; const names = nodes.map(n => n.name)
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const aJ = $.accounts.get(names[i])?.jealousyCredit || 10; const bJ = $.accounts.get(names[j])?.jealousyCredit || 10
      edges.push({ from: names[i], to: names[j], type: aJ > 50 && bJ > 50 ? 'jealousy' : 'competition', intensity: clamp((aJ + bJ) / 2, 0, 100) })
    }
  }
  $.rivalryEdges = { nodes, edges }
}

function clamp(v, min, max) { if (v == null || isNaN(v)) return min; return Math.min(max, Math.max(min, Math.round(v))) }

// ═══════════════════════════════════════════════════
// Label maps
// ═══════════════════════════════════════════════════

const GOAL_LABELS = { increase_tension:'推高张力', resolve_tension:'释放张力', destabilize:'破坏稳定', reveal:'揭示信息', seduce:'诱惑行动', confront:'正面冲突', withdraw_impact:'抽离施压' }
const SCENE_LABELS = { confrontation:'对峙', seduction:'诱惑', revelation:'揭示', withdrawal:'抽离', test:'试探', interrupt:'打断', triangulation:'三角修罗场' }
const ACTION_LABELS = { escalate_physically:'物理升级', provoke_directly:'直接挑衅', withdraw_completely:'完全抽离', plead_or_cry:'恳求/崩溃', claim_player_attention:'争夺注意力', test_physical_boundary:'试探身体边界', seek_player_validation:'寻求玩家认可', create_tension_opportunity:'制造张力机会', observe_and_probe:'观察试探', cold_test:'冷测试', passive_aggressive_hint:'被动攻击暗示', force_reaction_at_any_cost:'不惜代价逼反应', remind_player_who_matters:'提醒玩家谁更重要', see_if_player_responds_physically:'试探身体反应', get_player_to_show_they_care:'让玩家表现出来在意', serve_the_scene:'服务场景需要', gather_information:'收集信息', assess_player_value:'评估玩家价值' }

// 🆕 v8.5.7: Offensive action labels for aggressive archetypes (pursuer/confrontational)
const PURSUER_ACTION_OVERLAY = { escalate_physically:'越界升级——逼近/按墙/撕扯衣物/强吻', provoke_directly:'直接挑衅+语言越界——直白话语/逼迫选择/与第三人亲密', withdraw_completely:'毁灭式撤退——"我走，但你永远会后悔"→真的走不回头', claim_player_attention:'暴力争夺——用越界/威胁/自毁强抢注意力', test_physical_boundary:'越过身体边界——触碰/抓/按/压/侵入私人空间', create_tension_opportunity:'主动制造破坏——撒谎/毁约/当面对别人好/砸东西', force_reaction_at_any_cost:'不惜代价逼反应——可以自毁、可以伤害自己、可以毁掉一切', observe_and_probe:'侵略性试探——逼近看反应、用威胁测试底线', cold_test:'冷血测试——伤害对方看能承受多少', passive_aggressive_hint:'公开挑衅——不暗示，直接说/直接做', remind_player_who_matters:'用第三人刺激——当面对别人好、提别人名字、比较', assess_player_value:'贬低→践踏→让对方觉得自己一文不值' }
const CONFRONTATIONAL_ACTION_OVERLAY = { escalate_physically:'物理冲突升级——堵门/摔东西/推搡/逼近吼叫', provoke_directly:'直接找茬——讽刺/挖苦/翻旧账/否定对方一切', withdraw_completely:'决裂式抽离——"你他妈自己过吧"→摔门走但不真走远', claim_player_attention:'对抗式争夺——骂/吼/砸/让别人无法忽视', force_reaction_at_any_cost:'逼到墙角——"你说啊""你走啊——走啊！"不给退路', observe_and_probe:'挑剔审视——找对方的错、戳对方的痛处', cold_test:'毒舌测试——说最狠的话看对方会不会走', remind_player_who_matters:'翻旧账——"上次是谁……""你欠我的还没还完"' }
const STRATEGY_LABELS = { cold:'冷策略 — 不动声色', warm:'暖策略 — 以柔克刚', volatile:'波动 — 情绪不可预测', controlled_leak:'控制泄露 — 偶尔失控但迅速收回', withdrawal:'撤退 — 制造缺失感' }
// 🆕 v8.5.7: Offensive strategy labels for aggressive archetypes
const PURSUER_STRATEGY_OVERLAY = { cold:'冷血进攻 — 不动声色但步步紧逼', volatile:'混沌爆发 — 不可预测的情绪跳变，温柔→暴怒→大笑→沉默→越界', withdrawal:'毁灭式抽离 — 不是撤退，是"我走但你永远会后悔"' }
const CONFRONTATIONAL_STRATEGY_OVERLAY = { cold:'冷言进攻 — 每一句话都带刺', volatile:'火山爆发 — 上一秒冷笑下一秒咆哮，不控制不道歉' }

// Helper: get personality-aware offensive label
function getOffensiveActionLabel(action, profile) {
  if (profile === 'pursuer' && PURSUER_ACTION_OVERLAY[action]) return PURSUER_ACTION_OVERLAY[action]
  if (profile === 'confrontational' && CONFRONTATIONAL_ACTION_OVERLAY[action]) return CONFRONTATIONAL_ACTION_OVERLAY[action]
  return ACTION_LABELS[action] || action
}
function getOffensiveStrategyLabel(strategy, profile) {
  if (profile === 'pursuer' && PURSUER_STRATEGY_OVERLAY[strategy]) return PURSUER_STRATEGY_OVERLAY[strategy]
  if (profile === 'confrontational' && CONFRONTATIONAL_STRATEGY_OVERLAY[strategy]) return CONFRONTATIONAL_STRATEGY_OVERLAY[strategy]
  return STRATEGY_LABELS[strategy] || strategy
}
const WAR_LABELS = { capture:'争夺 — 直接夺取注意力', block:'阻断 — 打断对手', redirect:'引导 — 转向自己', replace:'替代 — 让对手无关紧要' }
const BATTLEGROUND_LABELS = { interruption:'打断战', comparison:'比较战', proximity_war:'身体距离战' }
const TOPOLOGY_LABELS = { mutual_escalation:'双向升级', cold_war:'冷战', asymmetric:'非对称' }
const BRANCH_LABELS = { escalate:'升级 ↑', soften:'缓和 ↓', rupture:'破裂 ×', redirect:'转移 →' }
