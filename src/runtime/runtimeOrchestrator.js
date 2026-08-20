/**
 * NOS Runtime Orchestrator v1 — The World's Master Clock
 *
 * Core principle:
 *   ❗ The Orchestrator decides the ORDER. The model only GENERATES.
 *
 * Without the Orchestrator:
 *   ❌ Modules run in implicit order (whatever the function happens to call)
 *   ❌ No clear data flow between steps
 *   ❌ Adding a new step means refactoring a giant function
 *
 * With the Orchestrator:
 *   ✅ Explicit pipeline — every step is visible
 *   ✅ Clear data flow — each step reads/writes a shared context
 *   ✅ Pluggable — add/remove/reorder steps without touching the LLM
 *
 * Architecture (v9.1):
 *   INPUT → CCL → NTK → USK → ARSL → AIIS/ANDS/DAS/DCS/NDOS → CIE/TOM → EVENTS → CAUSAL → CEKv4 → BUILD → RENDER → RSE
 *                                                                                             ↑
 *   CIE: Character Intent Engine — persistent psychological motivations (v9.1)
 *   TOM: Turn Objective Manager — per-turn action objectives (v9.1)
 *   ITRL: Inner Thought Rendering Layer — dual-track narrative (v8.8)
 *   RSE: Runtime Supervisor Engine — Director → Main Model → Supervisor closed loop (v8.9)
 *   Director(flash) → Runtime Contract → Main Model → Supervisor(flash) → PASS/REWRITE
 *
 * This is NOT a new module. It's the CONDUCTOR for all existing modules.
 */

import { buildConstitution } from './characterConstitution'
import { buildLedgerBlock, enforceSceneContinuity } from './factLedger'
import { EventGraph } from './eventGraph'
import { AutonomousWorldEngine } from './autonomousWorldEngine'
import { RelationshipPhysics } from './relationshipPhysics'
import { AgencyEngine } from './agencyEngine'
import { AutonomousInitiativeSystem } from './autonomousInitiativeSystem'
import { AutonomousNarrativeDrive } from './autonomousNarrativeDrive'
import { DramaAutopilot } from './dramaAutopilot'
import { DramaControlSystem } from './dramaControlSystem'
import { NarrativeDirectorOS } from './narrativeDirectorOS'
import { decideDarkActionLevel, trackLevel, getAntiAveragingOverride } from './darkActionKernel'
import { decideDesireLevel, trackDesireLevel, getDesireAntiAveragingOverride } from './desireKernel'
import { decideInitiativeLevel } from './characterInitiativeKernel'
import { buildCEKv4Block } from './characterExecutionKernelV4'
import { buildCIEBlock, getCIEState } from './characterIntentEngine'
import { schedule, buildTOMBlock, buildFallbackTOM } from './turnObjectiveManager'
import { buildNarratorPrompt } from '../prompt/v3/narratorPrompt'
import { runAgentTurn } from '../agents/coordinator'

// ═══════════════════════════════════════════════════════════
// 1. Pipeline Definition
// ═══════════════════════════════════════════════════════════

/**
 * The canonical NOS turn pipeline. Order matters.
 * Each step is: { name, fn(ctx) }
 *
 * Adding a new layer to NOS? Add a step here. That's it.
 */
const PIPELINE = [

  // ═══════════════════════════════════════════════════
  // STEP 1: INPUT_PARSE — classify what the player did
  // ═══════════════════════════════════════════════════
  {
    name: 'INPUT_PARSE',
    fn(ctx) {
      const input = ctx.userText || ''
      ctx.parsed = {
        isAction: /脱|走|打|抱|推|拉|吻|亲|压|按|撕|扯|踢|摔|砸|关门|开门|起身|坐下|躺|站/.test(input),
        isQuestion: /[？?]/.test(input),
        isEmotional: /恨|爱|气|哭|怕|想|在乎|在意|讨厌|恶心|喜欢/.test(input),
        isSilent: /^[。.…\s]*$/.test(input),
        length: input.length,
      }
    },
  },

  // ═══════════════════════════════════════════════════
  // STEP 2: CONSTITUTION_CHECK — build and inject CCL
  // ═══════════════════════════════════════════════════
  {
    name: 'CONSTITUTION_CHECK',
    fn(ctx) {
      if (!ctx.usk) return
      ctx.character._constitution = buildConstitution(ctx.character, ctx.usk)
    },
  },

  // ═══════════════════════════════════════════════════
  // STEP 3: FACT_SYNC — sync Fact Ledger, inject block
  // ═══════════════════════════════════════════════════
  {
    name: 'FACT_SYNC',
    fn(ctx) {
      if (!ctx.ledger) return
      const lastMsg = ctx.messages?.[ctx.messages.length - 1]
      if (lastMsg?.role === 'assistant' && lastMsg.content) {
        enforceSceneContinuity(ctx.ledger, lastMsg.content)
      }
      ctx.character._ledgerBlock = buildLedgerBlock(ctx.ledger)
    },
  },

  // ═══════════════════════════════════════════════════
  // STEP 4: STATE_UPDATE — USK state snapshot (read-only this step)
  // ═══════════════════════════════════════════════════
  {
    name: 'STATE_UPDATE',
    fn(ctx) {
      // USK is read via getRawFolderUSK() in executeTurn — already available in ctx.usk
      // State changes (affection) happen AFTER LLM reply (step 9)
    },
  },

  // ═══════════════════════════════════════════════════
  // STEP 5: RELATIONSHIP_UPDATE — ARSL tick + Agency + World Engine
  // ═══════════════════════════════════════════════════
  {
    name: 'RELATIONSHIP_UPDATE',
    fn(ctx) {
      if (!ctx.character) return

      // ARSL: relationship physics tick
      RelationshipPhysics.applyPlayerInteraction(ctx.mainCharName || '主角')
      RelationshipPhysics.tick(ctx.usk)

      // Agency: autonomous character actions
      AgencyEngine.syncFromUSK(ctx.usk)
      AgencyEngine.check(ctx.character, ctx.usk)

      // World Engine: unified world tick
      const worldSnapshot = AutonomousWorldEngine.tick(ctx.usk, ctx.userText)
      if (worldSnapshot) {
        ctx.character._worldContext = AutonomousWorldEngine.buildNarrativeContext()
        ctx.worldTension = worldSnapshot.tension
        ctx.worldInstability = worldSnapshot.instability
      }
    },
  },

  // ═══════════════════════════════════════════════════
  // STEP 5.5: AIIS_TICK — Autonomous Intent & Initiative (v8.4)
  // ═══════════════════════════════════════════════════
  {
    name: 'AIIS_TICK',
    fn(ctx) {
      if (!ctx.character || !ctx.usk) return

      // Init on first call (lazy — avoids needing explicit init call)
      if (AutonomousInitiativeSystem._turnCount === 0) {
        AutonomousInitiativeSystem.init(ctx.character, ctx.usk)
      }

      // Record player interaction if there's input
      if (ctx.userText && ctx.userText.trim()) {
        AutonomousInitiativeSystem.recordPlayerInteraction()
      }

      // Tick AIIS — compute motivations + generate intents + schedule bursts
      const arslEdges = RelationshipPhysics.edges || {}
      const tickResult = AutonomousInitiativeSystem.tick(ctx.usk, arslEdges)

      // Inject intent context into character for prompt assembly
      ctx.character._aiisIntentContext = AutonomousInitiativeSystem.buildAllIntentsContext()

      // Store tick result for post-generation processing
      ctx._aiisTickResult = tickResult
    },
  },

  // ═══════════════════════════════════════════════════
  // STEP 5.6: ANDS_TICK — Autonomous Narrative Drive (v8.4)
  // ═══════════════════════════════════════════════════
  {
    name: 'ANDS_TICK',
    fn(ctx) {
      if (!ctx.character || !ctx.usk) return

      // Init on first call
      if (AutonomousNarrativeDrive._turnCount === 0) {
        AutonomousNarrativeDrive.init(ctx.character, ctx.usk)
      }

      // Gather world state for awareness
      const worldState = AutonomousWorldEngine.getWorldState()
      const agencyHints = AgencyEngine._pendingHints || []
      const arslEdges = RelationshipPhysics.edges || {}
      const passiveTurns = ctx.lifecyclePassiveTurns || 0

      // Tick ANDS — compute autonomy + generate narrative intents + schedule actions
      const andsResult = AutonomousNarrativeDrive.tick(
        ctx.usk,
        ctx.sceneState || null,  // sceneState from DramaOrchestrator
        worldState,
        agencyHints,
        arslEdges,
        ctx.lifecyclePassiveTurns || passiveTurns,
        !!ctx.userText,          // playerJustActed
      )

      // Inject narrative directives into character for prompt assembly
      ctx.character._andsNarrativeDirective = AutonomousNarrativeDrive.buildAllNarrativeDirectives()

      // Store for post-generation
      ctx._andsTickResult = andsResult
    },
  },

  // ═══════════════════════════════════════════════════
  // STEP 5.7: DAS_TICK — Drama Autopilot System (v8.4)
  // ═══════════════════════════════════════════════════
  {
    name: 'DAS_TICK',
    fn(ctx) {
      if (!ctx.character || !ctx.usk) return

      // Init on first call
      if (DramaAutopilot._state.turnCount === 0) {
        DramaAutopilot.init()
      }

      // Run autopilot cycle
      const arslEdges = RelationshipPhysics.edges || {}
      const dasResult = DramaAutopilot.tick({
        arslEdges,
        sceneState: ctx.sceneState || null,
        uskState: ctx.usk,
        userText: ctx.userText || '',
      })

      // Inject DAS narrative event block into character for prompt assembly
      ctx.character._dasNarrativeEvent = DramaAutopilot.buildNarrativeEventBlock()

      // Store for post-generation
      ctx._dasTickResult = dasResult
    },
  },

  // ═══════════════════════════════════════════════════
  // STEP 5.8: DCS_DIRECT — Drama Control System (v8.4)
  // ═══════════════════════════════════════════════════
  {
    name: 'DCS_DIRECT',
    fn(ctx) {
      if (!ctx.character || !ctx.usk) return

      // Init on first call
      if (DramaControlSystem._state.turnCount === 0) {
        DramaControlSystem.init()
      }

      // Gather inputs from generation systems
      const arslEdges = RelationshipPhysics.edges || {}
      const attentionMap = AutonomousWorldEngine.getAttention() || {}
      const playerName = ctx.mainCharName || (ctx.character?._playerProfile?.name) || '玩家'

      // Run director cycle — curate what AIIS+ANDS+DAS generated
      const dcsResult = DramaControlSystem.direct({
        character: ctx.character,
        uskState: ctx.usk,
        arslEdges,
        sceneState: ctx.sceneState || null,
        attentionMap,
        playerName,
        dasTickResult: ctx._dasTickResult || null,
        andsTickResult: ctx._andsTickResult || null,
      })

      // Inject unified Director's Cut into character for prompt assembly
      ctx.character._dcsDirectorCut = dcsResult.directorCut

      // Store for post-generation
      ctx._dcsResult = dcsResult
    },
  },

  // ═══════════════════════════════════════════════════
  // STEP 5.9: NDOS_DIRECT — Narrative Director OS (v8.4)
  // ═══════════════════════════════════════════════════
  {
    name: 'NDOS_DIRECT',
    fn(ctx) {
      if (!ctx.character || !ctx.usk) return

      // Init on first call
      if (NarrativeDirectorOS._state.turnCount === 0) {
        NarrativeDirectorOS.init()
      }

      // Gather character names
      const rcList = ctx.character?.romanceCharacters || []
      const characterNames = rcList.map(rc => rc.name).filter(Boolean)
      if (ctx.character?.name && !characterNames.includes(ctx.character.name)) {
        characterNames.push(ctx.character.name)
      }
      if (ctx.mainCharName && !characterNames.includes(ctx.mainCharName)) {
        characterNames.push(ctx.mainCharName)
      }

      const arslEdges = RelationshipPhysics.edges || {}
      const attentionMap = AutonomousWorldEngine.getAttention() || {}
      const playerName = ctx.mainCharName || (ctx.character?._playerProfile?.name) || '玩家'

      // Run NDOS director cycle — make the 5 director decisions + render Scene Card
      const ndosResult = NarrativeDirectorOS.direct({
        character: ctx.character,
        uskState: ctx.usk,
        arslEdges,
        sceneState: ctx.sceneState || null,
        attentionMap,
        playerName,
        dasTickResult: ctx._dasTickResult || null,
        dcsResult: ctx._dcsResult || null,
        characterNames,
      })

      // Inject Scene Card — THE authoritative narrative directive
      ctx.character._ndosSceneCard = ndosResult.sceneCard

      // Store decisions for post-generation
      ctx._ndosResult = ndosResult
    },
  },

  // ═══════════════════════════════════════════════════
  // STEP 6: EVENT_TICK — Event Graph context (before LLM)
  // ═══════════════════════════════════════════════════
  {
    name: 'EVENT_TICK',
    fn(ctx) {
      const graphCtx = EventGraph.buildContext()
      if (graphCtx) {
        ctx.character._eventGraphContext = graphCtx
      }
    },
  },

  // ═══════════════════════════════════════════════════
  // STEP 7: CAUSAL_UPDATE — behavior kernel directives
  // ═══════════════════════════════════════════════════
  {
    name: 'CAUSAL_UPDATE',
    fn(ctx) {
      if (!ctx.character || !ctx.uskState) return

      // DarkAction — cold violence behavior level
      const darkAction = decideDarkActionLevel(ctx.character, ctx.uskState, ctx.turnCount, {
        decisionType: ctx.decision?.type || null,
      })
      const isDark = _detectDarkColor(ctx.character)
      const override = getAntiAveragingOverride(isDark)
      if (override > darkAction.level) {
        darkAction.level = override
        darkAction.directive = darkAction.directive.replace(
          /当前行为层：LEVEL \d/,
          '当前行为层：LEVEL ' + override + ' [反均值化强制提升]'
        )
      }
      trackLevel(darkAction.level)
      ctx.character._darkActionDirective = darkAction.directive
      ctx.character._darkActionLevel = darkAction.level

      // Desire — physical push behavior level
      const desireDecision = decideDesireLevel(ctx.character, ctx.uskState, ctx.turnCount, {
        decisionType: ctx.decision?.type || null,
        darkActionLevel: darkAction.level,
        alone: true,
      })
      if (desireDecision.active) {
        const desireOverride = getDesireAntiAveragingOverride(desireDecision.level > 0)
        if (desireOverride > desireDecision.level) {
          desireDecision.level = desireOverride
          desireDecision.directive = desireDecision.directive.replace(
            /当前欲望层：LEVEL \d/,
            '当前欲望层：LEVEL ' + desireOverride + ' [反均值化强制提升]'
          )
        }
        trackDesireLevel(desireDecision.level)
        ctx.character._desireDirective = desireDecision.directive
        ctx.character._desireLevel = desireDecision.level
      }

      // Initiative — physical action against player (bridges DarkAction + Desire)
      const initiativeDecision = decideInitiativeLevel(ctx.character, ctx.uskState, ctx.turnCount, {
        darkActionLevel: darkAction.level,
        desireLevel: desireDecision.level,
        decisionType: ctx.decision?.type || null,
      })
      if (initiativeDecision.active) {
        ctx.character._initiativeDirective = initiativeDecision.directive
        ctx.character._initiativeLevel = initiativeDecision.level
      }
    },
  },

  // ═══════════════════════════════════════════════════
  // STEP 7.5: CEK_EXECUTE — Character Execution Kernel v4
  //   🎬 Autonomous Narrative Director: system DIRECTS the story
  //   v4 adds: Narrative Intent Generator + Scene Director + Character Planner
  //            + Attention War + Conflict Simulation + Narrative Branching
  // ═══════════════════════════════════════════════════════
  {
    name: 'CEK_EXECUTE',
    fn(ctx) {
      if (!ctx.character || !ctx.usk) return

      // Build affection map from USK
      const affectionMap = {}
      const rcList = ctx.character.romanceCharacters || []
      for (const rc of rcList) {
        const aff = ctx.usk?.characters?.[rc.name]?.relationship?.affection
          ?? rc.affectionInitial ?? 50
        affectionMap[rc.name] = aff
      }

      // Get ARSL edges for rivalry graph
      const arslEdges = RelationshipPhysics.edges || {}

      // Build CEK v4 block — autonomous narrative director (v9.1: CIE-enhanced)
      const cieState = getCIEState()
      const cekBlock = buildCEKv4Block(ctx.character, ctx.usk, affectionMap, arslEdges, cieState)
      if (cekBlock) {
        ctx.character._behaviorLocks = cekBlock
      }
    },
  },

  // ═══════════════════════════════════════════════════════════
  // STEP 7.6: CIE_INJECT — Character Intent Engine + Turn Objective Manager
  //   🧠 CIE: persistent character psychological motivations
  //   🎯 TOM: per-turn action objectives derived from CIE
  //   CIE computation runs in interactionKernel (flash model, periodic).
  //   This step injects cached CIE state + rule-based TOM into ctx.character.
  // ═══════════════════════════════════════════════════════════
  {
    name: 'CIE_INJECT',
    fn(ctx) {
      if (!ctx.character) return

      // CIE: inject persistent psychological intents from cached state
      const cieBlock = buildCIEBlock(ctx.character)
      if (cieBlock) {
        ctx.character._cieContext = cieBlock
      }

      // TOM: compute per-turn objectives from CIE state (rule-based, no LLM)
      const cieState = getCIEState()
      if (cieState) {
        const tomOutputs = schedule(ctx.character, cieState, {
          turnCount: ctx.turnCount || 0,
          userText: ctx.userText || '',
          usk: ctx.usk,
        })
        if (tomOutputs) {
          ctx.character._tomBlock = buildTOMBlock(tomOutputs)
        }
      } else {
        // No CIE state yet (first turn before CIE compiled) — use fallback
        const fallbackTOM = buildFallbackTOM(ctx.character, ctx.usk)
        if (fallbackTOM) {
          ctx.character._tomBlock = buildTOMBlock(fallbackTOM)
        }
      }
    },
  },

  // ═══════════════════════════════════════════════════════════
  // STEP 8: NARRATIVE_BUILD — assemble the full prompt
  // ═══════════════════════════════════════════════════════════
  {
    name: 'NARRATIVE_BUILD',
    fn(ctx) {
      // Prompt is built inside runAgentTurn → buildNarratorPrompt
      // The character object now carries all injected blocks:
      //   _constitution, _ledgerBlock, _eventGraphContext,
      //   _worldContext, _darkActionDirective, _desireDirective, _initiativeDirective,
      //   _behaviorLocks (CEK v3: narrative economy execution kernel)
    },
  },

  // ═══════════════════════════════════════════════════
  // STEP 9: OUTPUT_RENDER — LLM generation
  // ═══════════════════════════════════════════════════
  {
    name: 'OUTPUT_RENDER',
    fn(ctx) {
      // LLM call is done by executeTurn via runAgentTurn
      // The ctx now has all character directives ready
    },
  },

  // ═══════════════════════════════════════════════════
  // STEP 10: RQA_AUDIT — Runtime Quality Assurance
  //   LLM audit of generated output across 10 dimensions
  //   Performed in coordinator.js after LLM generation.
  // ═══════════════════════════════════════════════════
  {
    name: "RQA_AUDIT",
    fn(ctx) {
      // RQA audit runs in coordinator.js runAgentTurn
      // after LLM generation, before returning to UI.
    },
  },
]

// ═══════════════════════════════════════════════════════
// 2. Runtime Orchestrator API
// ═══════════════════════════════════════════════════════

export const RuntimeOrchestrator = {

  /**
   * Run the full pre-generation pipeline.
   * Prepares all character directives BEFORE the LLM call.
   *
   * @param {object} ctx — shared context
   * @param {string} ctx.userText — player input
   * @param {object} ctx.character — full LLM character descriptor
   * @param {object} ctx.usk — raw USK state
   * @param {object} ctx.uskState — character UI state
   * @param {object} ctx.ledger — Fact Ledger instance
   * @param {object[]} ctx.messages — message array
   * @param {number} ctx.turnCount — current turn number
   * @param {object} ctx.decision — AgentDecisionLayer result
   * @param {string} ctx.mainCharName — main character name
   */
  runPreGeneration(ctx) {
    // All steps before NARRATIVE_BUILD + OUTPUT_RENDER (the last two)
    const steps = PIPELINE.slice(0, -2)
    for (const step of steps) {
      try {
        step.fn(ctx)
      } catch (err) {
        console.error('[Orchestrator] Step ' + step.name + ' failed:', err.message)
        // Don't crash — let the LLM run even if a step fails
      }
    }
    return ctx
  },

  /**
   * Run the full post-generation pipeline.
   * Extracts events, facts, and updates state AFTER the LLM reply.
   *
   * @param {object} ctx — shared context (now includes ctx.reply)
   */
  runPostGeneration(ctx) {
    // Record events into Event Graph
    if (ctx.reply) {
      EventGraph.processTurn(ctx.userText, ctx.reply, {
        characterNames: ctx.affectionNames || [],
      })
    }

    // Fact extraction is done by executeTurn via extractTurnFacts
    // (called separately to keep ledger save in one place)

    return ctx
  },

  /**
   * Get the pipeline structure for debugging / introspection.
   */
  getPipeline() {
    return PIPELINE.map(s => ({ name: s.name }))
  },

  /**
   * Log the pipeline execution (for debugging).
   */
  logPipeline() {
    const steps = PIPELINE.map(s => s.name)
    console.log('[NOS Pipeline]\n' + steps.map((s, i) => (i + 1) + '. ' + s).join('\n'))
  },
}

// ═══════════════════════════════════════════════════════
// Helper (duplicated from interactionKernel to avoid circular import)
// ═══════════════════════════════════════════════════════

function _detectDarkColor(character) {
  if (!character) return false
  const texts = []
  if (character.background) texts.push(character.background)
  if (character.personality) texts.push(character.personality)
  if (character.storyTone) texts.push(character.storyTone)
  const rcList = character.romanceCharacters || []
  for (const rc of rcList) {
    if (rc.background) texts.push(rc.background)
    if (rc.personality) texts.push(rc.personality)
  }
  const combined = texts.join(' ').toLowerCase()
  const darkKw = ['傲娇', '毒舌', '清冷', '偏执', '疯批', '恶劣', '堕落', '花心', '城府深', '报复', '冷漠', '腹黑', '霸道', '强势', '冷酷', '邪魅', '病娇', '阴郁', '暴戾', '放荡', '高冷', '玩世不恭', '纨绔', '无情', '嗜血', '残忍', '阴沉', '孤僻', '控制欲', '占有欲强']
  const warmKw = ['温柔', '善良', '阳光', '单纯', '软萌', '小天使', '体贴', '治愈', '温暖', '乖巧', '可爱', '纯真', '柔和', '和善', '暖心', '元气', '开朗', '天真', '温润', '谦和', '正直', '赤诚', '热心']
  const darkHits = darkKw.filter(kw => combined.includes(kw)).length
  const warmHits = warmKw.filter(kw => combined.includes(kw)).length
  return darkHits > 0 && warmHits === 0
}
