/**
 * Character Stability Compiler v1 — 人格稳定编译器
 *
 * 不是过滤器，不是规则系统。是在"生成之前"就把人设编译成不可漂移的执行约束。
 *
 * 核心思想：不是让角色"表现像谁"，而是让角色"只能像谁"。
 *
 * 三阶段编译：
 *   1. freezePersona — 冻结人格核心（不可变向量）
 *   2. buildConstraints — 编译行为约束（禁止/强制/上限/保底）
 *   3. buildInvariants — 不变量系统（跨轮次稳定性）
 *
 * 运行时校验：
 *   validate() — 每轮检查是否有漂移，有则强制拉回
 */

// ═══════════════════════════════════════════════════════════
// Archetype definitions — frozen personality vectors
// ═══════════════════════════════════════════════════════════

const ARCHETYPES = {
  aggressive: {
    label: '攻击型',
    baseline_tone: '对抗/压迫/情绪爆发',
    softnessCap: 0.2,
    complianceCap: 0.3,
    affectionCap: 0.6,
    conflictFloor: 0.5,
    emotionalRange: [30, 100],  // min-max emotion intensity
  },
  cold: {
    label: '冷淡型',
    baseline_tone: '疏离/简短/不主动',
    softnessCap: 0.25,
    complianceCap: 0.3,
    affectionCap: 0.5,
    conflictFloor: 0.4,
    emotionalRange: [5, 60],
  },
  manipulative: {
    label: '操纵型',
    baseline_tone: '控制/测试/若即若离',
    softnessCap: 0.15,  // even stricter — manipulation must not slip into genuine care
    complianceCap: 0.2,
    affectionCap: 0.7,  // can show warmth but must be controlling
    conflictFloor: 0.35,
    emotionalRange: [20, 80],
  },
  possessive: {
    label: '占有型',
    baseline_tone: '归属/嫉妒/不能失去',
    softnessCap: 0.3,
    complianceCap: 0.4,
    affectionCap: 0.9,  // high affection but pathological
    conflictFloor: 0.3,
    emotionalRange: [10, 100],
  },
  warm_dark: {
    label: '暖暗型（表面温和/内里控制）',
    baseline_tone: '表面关心/实质操纵',
    softnessCap: 0.6,  // allowed to seem gentle, but not genuinely
    complianceCap: 0.35,
    affectionCap: 0.8,
    conflictFloor: 0.3,
    emotionalRange: [10, 90],
  },
}

// ═══════════════════════════════════════════════════════════
// Stability Compiler
// ═══════════════════════════════════════════════════════════

export const StabilityCompiler = {

  /**
   * Main entry point. Compile a character profile into immutable constraints.
   *
   * @param {object} character — raw character object (from folderStore / personaCore)
   * @returns {object} compiled { persona, constraints, invariants, archetype }
   */
  compile(character) {
    if (!character) return null

    const archetype = this._detectArchetype(character)

    return {
      archetype: archetype ? archetype.label : null,
      persona: this.freezePersona(character, archetype),
      constraints: this.buildConstraints(character, archetype),
      invariants: this.buildInvariants(character, archetype),
      compiledAt: Date.now(),
    }
  },

  // ═══════════════════════════════════════════════════════
  // 1. Freeze Persona — immutable identity core
  // ═══════════════════════════════════════════════════════

  freezePersona(character, archetype) {
    return {
      archetype: archetype?.label || 'untyped',
      name: character.name || '',
      personality: character.personality || '',
      background: character.background || '',
      speakingStyle: character.speakingStyle || '',
      // Immutable traits — never recalculated
      baseline_tone: archetype?.baseline_tone || '中性',
      emotional_range: archetype?.emotionalRange || [20, 80],
      styleRules: [...(character.styleRules || [])],
      forbiddenWords: [...(character.forbiddenWords || [])],
    }
  },

  // ═══════════════════════════════════════════════════════
  // 2. Build Constraints — behavioral boundaries
  // ═══════════════════════════════════════════════════════

  buildConstraints(character, archetype) {
    const personality = (character.personality || '').toLowerCase()

    return {
      // Forbidden behaviors — NEVER allowed
      forbidden: [
        '变得温柔体贴', '主动道歉', '解释自己的行为动机',
        '关心玩家感受', '询问"你还好吗"', '鼓励玩家',
        '说"我理解"', '说"我保证"', '说"我会改"',
        '用温柔的语气', '主动缓解气氛',
      ].concat((character.styleRules || []).filter(r => r.trim())),

      // Required behaviors — MUST exhibit these
      required: this._deriveRequiredBehaviors(character, archetype),

      // Emotion caps — cannot exceed these soft limits
      emotion_caps: {
        affection_max: archetype?.affectionCap ?? 0.6,
        softness_max: archetype?.softnessCap ?? 0.3,
        compliance_max: archetype?.complianceCap ?? 0.4,
      },

      // Conflict floor — minimum tension that must be maintained
      conflict_floor: archetype?.conflictFloor ?? 0.3,

      // Affection stage locks from character data
      stageLocks: (character.affectionStages || []).map(s => ({
        name: s.name || '',
        min: s.min || 0,
        max: s.max || 100,
        behavior: s.behavior || '',
        coreState: s.coreState || '',
        playerStrategy: s.playerStrategy || '',
        forbiddenBehaviors: s.forbiddenBehaviors || '',
      })),

      // NPC relationship constraints
      npcConstraints: (character.npcs || []).map(n => ({
        name: n.name,
        relationship: n.relationship || '',
        personality: n.personality || '',
      })),
    }
  },

  _deriveRequiredBehaviors(character, archetype) {
    const required = []
    const personality = (character.personality || '').toLowerCase()

    if (archetype) {
      switch (archetype.label) {
        case '攻击型':
          required.push('每轮至少体现一次对抗或压迫', '语言必须直接/不婉转')
          break
        case '冷淡型':
          required.push('回复不超过三句话', '不主动靠近或触碰', '不微笑')
          break
        case '操纵型':
          required.push('话语中必须包含隐藏意图', '表面与实质必须不一致')
          break
        case '占有型':
          required.push('必须体现归属或控制', '不允许表现"大度"')
          break
        case '暖暗型':
          required.push('表面温和但实质在控制', '不能真正坦诚')
          break
      }
    }

    return required
  },

  // ═══════════════════════════════════════════════════════
  // 3. Build Invariants — cross-turn stability rules
  // ═══════════════════════════════════════════════════════

  buildInvariants(character, archetype) {
    return {
      // Core invariants — these must never flip
      no_softening: true,           // 人格不允许逐渐变温柔
      no_full_compliance: true,     // 不允许完全顺从玩家
      conflict_cycle: true,         // 冲突必须周期性出现
      emotion_drift_required: true, // 情绪必须有波动（不能长期平稳）
      // If any invariant is violated, the compiler forces a correction
    }
  },

  // ═══════════════════════════════════════════════════════
  // 4. Runtime Validation — drift detection + correction
  // ═══════════════════════════════════════════════════════

  /**
   * Validate runtime state against compiled constraints.
   * Returns corrected state if drift detected.
   *
   * @param {object} runtimeState — { affection, tension, emotion, compliance }
   * @param {object} compiled — the compiled persona from compile()
   * @returns {{ valid: boolean, corrections: string[], correctedState: object }}
   */
  validate(runtimeState, compiled) {
    if (!compiled?.constraints) return { valid: true, corrections: [], correctedState: runtimeState }

    const c = compiled.constraints
    const corrections = []
    const corrected = { ...runtimeState }

    // Check softness cap
    const softness = runtimeState.softness ?? runtimeState.compliance ?? 0.5
    if (softness > c.emotion_caps.softness_max) {
      corrected.softness = c.emotion_caps.softness_max
      corrected.compliance = c.emotion_caps.softness_max
      corrections.push(`softness drifted above cap (${softness.toFixed(2)} > ${c.emotion_caps.softness_max}) — forced back`)
    }

    // Check compliance cap
    const compliance = runtimeState.compliance ?? 0.5
    if (compliance > c.emotion_caps.compliance_max) {
      corrected.compliance = c.emotion_caps.compliance_max
      if (!corrections.includes('softness')) {
        corrections.push(`compliance exceeded cap (${compliance.toFixed(2)} > ${c.emotion_caps.compliance_max}) — forced back`)
      }
    }

    // Check conflict floor
    const conflict = runtimeState.conflict ?? runtimeState.tension ?? 0.3
    if (conflict < c.conflict_floor) {
      corrected.conflict = c.conflict_floor
      corrected.tension = c.conflict_floor
      corrections.push(`conflict below floor (${conflict.toFixed(2)} < ${c.conflict_floor}) — forced up`)
    }

    return {
      valid: corrections.length === 0,
      corrections,
      correctedState: corrected,
    }
  },

  // ═══════════════════════════════════════════════════════
  // 5. Prompt Injection — compile constraints into LLM instructions
  // ═══════════════════════════════════════════════════════

  /**
   * Build a compact constraint block for injection into the LLM system prompt.
   * This is the "pre-generation lock" — tells the LLM what it CANNOT do.
   */
  buildPromptInjection(compiled) {
    if (!compiled) return ''

    const lines = []
    const c = compiled.constraints
    const p = compiled.persona

    lines.push('【人格稳定编译——强制约束，最高优先级】')
    lines.push('以下约束由 StabilityCompiler 编译生成，优先级高于任何对话上下文。')
    lines.push('')

    if (compiled.archetype) {
      lines.push('人格原型：' + compiled.archetype)
      lines.push('基调：' + p.baseline_tone)
      lines.push('')
    }

    if (c.required?.length) {
      lines.push('强制行为（必须执行）：')
      for (const r of c.required) lines.push('  - ' + r)
      lines.push('')
    }

    if (c.forbidden?.length) {
      lines.push('绝对禁止：')
      const top = c.forbidden.slice(0, 8)
      for (const f of top) lines.push('  - ' + f)
      lines.push('')
    }

    lines.push('软性上限：')
    lines.push('  温柔度 ≤ ' + (c.emotion_caps.softness_max * 100).toFixed(0) + '%')
    lines.push('  顺从度 ≤ ' + (c.emotion_caps.compliance_max * 100).toFixed(0) + '%')
    lines.push('  好感表达 ≤ ' + (c.emotion_caps.affection_max * 100).toFixed(0) + '%')
    lines.push('')
    lines.push('冲突保底：tension ≥ ' + (c.conflict_floor * 100).toFixed(0) + '%')
    lines.push('')

    const inv = compiled.invariants
    lines.push('不变量锁：')
    if (inv.no_softening) lines.push('  × 不允许逐渐变温柔')
    if (inv.no_full_compliance) lines.push('  × 不允许完全顺从')
    if (inv.conflict_cycle) lines.push('  × 冲突必须周期性出现')
    if (inv.emotion_drift_required) lines.push('  × 情绪必须有波动')

    return lines.join('\n')
  },

  // ═══════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════

  _detectArchetype(character) {
    const personality = (character.personality || '').toLowerCase()
    const background = (character.background || '').toLowerCase()
    const speakingStyle = (character.speakingStyle || '').toLowerCase()
    const combined = personality + ' ' + background + ' ' + speakingStyle

    // Order matters — more specific matches first
    if (combined.includes('操纵') || combined.includes('玩弄') || combined.includes('腹黑') ||
        combined.includes('若即若离') || combined.includes('控制欲') || combined.includes('pua')) {
      return ARCHETYPES.manipulative
    }

    if (combined.includes('占有') || combined.includes('偏执') || combined.includes('病娇') ||
        combined.includes('执念') || combined.includes('你是我的')) {
      return ARCHETYPES.possessive
    }

    if (combined.includes('暴') || combined.includes('怒') || combined.includes('攻击') ||
        combined.includes('强势') || combined.includes('霸道') || combined.includes('咄咄')) {
      return ARCHETYPES.aggressive
    }

    if ((combined.includes('冷') || combined.includes('疏离') || combined.includes('回避')) &&
        !combined.includes('温暖') && !combined.includes('暖')) {
      return ARCHETYPES.cold
    }

    if (combined.includes('暗') || (combined.includes('温') && (combined.includes('控制') || combined.includes('伪装')))) {
      return ARCHETYPES.warm_dark
    }

    return null
  },
}
