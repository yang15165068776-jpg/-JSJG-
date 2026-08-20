/**
 * Aggression Profile v1 — Personality-aware boundary-pushing classification
 *
 * Problem: All behavioral gates in dailyGuard.js operate on (affection, tension)
 * only — completely blind to character personality. A "花心" (playboy) character
 * and a "温柔" (gentle) character at affection 30 get identical restrictions.
 *
 * This module classifies characters into aggression profiles so that gates
 * can be calibrated per personality type:
 *   - Pursuer: actively pushes romantic/sexual boundaries (花心, 霸道, 轻浮…)
 *   - Confrontational: seeks conflict but not necessarily romance (傲娇, 毒舌…)
 *   - Aloof: distant/cold but not aggressive (清冷, 高冷…)
 *   - Gentle: reserved, keeps existing gates (温柔, 善良…)
 *
 * Classification is hierarchical: pursuer > confrontational > aloof > gentle.
 * Default is 'gentle' — safest default preserves existing behavior.
 */

// ═══════════════════════════════════════════════════════════
// Keyword Sets
// ═══════════════════════════════════════════════════════════

const PURSUER_KEYWORDS = [
  '花心', '霸道', '轻浮', '风流', '放荡', '病娇', '疯批',
  '控制欲', '占有欲强', '玩世不恭', '纨绔', '邪魅', '偏执', '堕落',
]

const CONFRONTATIONAL_KEYWORDS = [
  '傲娇', '毒舌', '腹黑', '恶劣', '阴郁', '暴戾',
  '喜怒无常', '桀骜不驯', '狂妄', '尖酸刻薄',
]

const ALOOF_KEYWORDS = [
  '清冷', '高冷', '城府深', '强势', '冷酷', '冷漠', '无情',
]

const GENTLE_KEYWORDS = [
  '温柔', '善良', '阳光', '单纯', '软萌', '小天使', '体贴', '治愈',
  '温暖', '乖巧', '可爱', '纯真', '柔和', '和善', '暖心', '元气',
  '开朗', '天真', '温润', '谦和', '正直', '赤诚', '热心',
  '傻白甜', '人妻', '贤惠', '包容', '善解人意',
]

// ═══════════════════════════════════════════════════════════
// Profile Constants
// ═══════════════════════════════════════════════════════════

export const AGGRESSION_PROFILES = {
  PURSUER: 'pursuer',
  CONFRONTATIONAL: 'confrontational',
  ALOOF: 'aloof',
  GENTLE: 'gentle',
}

// ═══════════════════════════════════════════════════════════
// Detection
// ═══════════════════════════════════════════════════════════

/**
 * Collect all personality/background/behavior text from a character object.
 * Handles both story-mode (romanceCharacters) and daily-mode shapes.
 */
function collectCharacterTexts(character) {
  if (!character) return ''
  const texts = []
  if (character.background) texts.push(character.background)
  if (character.personality) texts.push(character.personality)
  if (character.behavior) texts.push(character.behavior)
  if (character.storyTone) texts.push(character.storyTone)
  const rcList = character.romanceCharacters || []
  for (const rc of rcList) {
    if (rc.background) texts.push(rc.background)
    if (rc.personality) texts.push(rc.personality)
    if (rc.behavior) texts.push(rc.behavior)
  }
  return texts.join(' ').toLowerCase()
}

/**
 * Detect the aggression profile of a character.
 *
 * Classification is hierarchical — first match wins:
 *   1. Any PURSUER keyword → 'pursuer'
 *   2. Any CONFRONTATIONAL keyword → 'confrontational'
 *   3. Any ALOOF keyword → 'aloof'
 *   4. Any GENTLE keyword → 'gentle'
 *   5. Default → 'gentle' (safest default, preserves existing behavior)
 *
 * @param {object} character — character object with personality/background/behavior fields
 * @returns {'pursuer' | 'confrontational' | 'aloof' | 'gentle'}
 */
export function detectAggressionProfile(character) {
  const combined = collectCharacterTexts(character)
  if (!combined.trim()) return AGGRESSION_PROFILES.GENTLE

  // Hierarchical matching
  if (PURSUER_KEYWORDS.some(kw => combined.includes(kw))) {
    return AGGRESSION_PROFILES.PURSUER
  }
  if (CONFRONTATIONAL_KEYWORDS.some(kw => combined.includes(kw))) {
    return AGGRESSION_PROFILES.CONFRONTATIONAL
  }
  if (ALOOF_KEYWORDS.some(kw => combined.includes(kw))) {
    return AGGRESSION_PROFILES.ALOOF
  }
  if (GENTLE_KEYWORDS.some(kw => combined.includes(kw))) {
    return AGGRESSION_PROFILES.GENTLE
  }

  return AGGRESSION_PROFILES.GENTLE
}

// ═══════════════════════════════════════════════════════════
// Convenience Functions
// ═══════════════════════════════════════════════════════════

export function isPursuer(character) {
  return detectAggressionProfile(character) === AGGRESSION_PROFILES.PURSUER
}

export function isConfrontational(character) {
  return detectAggressionProfile(character) === AGGRESSION_PROFILES.CONFRONTATIONAL
}

export function isAloof(character) {
  return detectAggressionProfile(character) === AGGRESSION_PROFILES.ALOOF
}

export function isGentle(character) {
  return detectAggressionProfile(character) === AGGRESSION_PROFILES.GENTLE
}

// ═══════════════════════════════════════════════════════════
// Gate Modifiers
// ═══════════════════════════════════════════════════════════

/**
 * Effective affection shift per profile.
 * Pursuers "see" the relationship as more advanced — they act like affection
 * is higher than it is, unlocking more intimate behavior gates sooner.
 *
 * @param {string} profile — from detectAggressionProfile()
 * @returns {number} — how much to add to raw affection for gate selection
 */
export function getAffectionShift(profile) {
  switch (profile) {
    case AGGRESSION_PROFILES.PURSUER:         return 30
    case AGGRESSION_PROFILES.CONFRONTATIONAL: return 15
    case AGGRESSION_PROFILES.ALOOF:           return 10
    default:                                   return 0   // gentle
  }
}
