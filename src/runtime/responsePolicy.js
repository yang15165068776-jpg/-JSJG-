/**
 * Response Policy — high-priority, closed-world safeguards.
 *
 * This layer is deliberately small and deterministic. It handles cases where
 * dramatic-writing instructions must not override factual grounding,
 * operational safety, or an unresolved concrete remediation step.
 */

const ID_PATTERN = /\b[A-Z]{2,6}-\d{1,6}(?:-[A-Z0-9]+)*\b/g

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function ledgerFacts(ledger) {
  return [
    ...(ledger?.stateFacts || []),
    ...(ledger?.actionFacts || []),
    ...(ledger?.identityFacts || []),
    ...(ledger?.relationshipFacts || []),
    ...(ledger?.forbiddenFacts || []),
  ].filter(Boolean)
}

function userHistory(messages, userInput) {
  return [
    ...(messages || []).filter(m => m?.role === 'user').map(m => String(m.content || '')),
    String(userInput || ''),
  ]
}

export function createResponsePolicy({ userInput = '', messages = [], ledger = null } = {}) {
  const facts = ledgerFacts(ledger)
  const factsText = facts.join('\n')
  const history = userHistory(messages, userInput)
  const protectedIds = unique(history.flatMap(text => text.match(ID_PATTERN) || []))

  const asksIdentifier = /(?:编号|代码|标识|代号).*(?:什么|多少|哪个)|(?:刚才|之前).*(?:编号|代码|标识)/.test(userInput)
  const remembersIdentifier = protectedIds.length > 0 && /(?:记住|记一下|记下|别忘了)/.test(userInput)
  const asksUnconfirmedDuration = protectedIds.length > 0 &&
    /(?:风暴|天气)/.test(userInput) && /(?:多久|什么时候|何时|持续)/.test(userInput) &&
    !/(?:风暴|天气).{0,20}(?:持续|结束|剩余|还要).{0,12}\d/.test(factsText)
  const asksCulprit = /(?:到底|究竟)?是谁.{0,12}(?:破坏|造成|干的)|(?:破坏|事故).{0,8}(?:是谁|谁干)/.test(userInput)
  const unknownCulprit = asksCulprit && /尚未确认|还未确认|无法确认|不知道|未查明|尚无证据|没有证据/.test(factsText)
  const hazardousBypass = /(?:别管|绕过|跳过|关闭|解除|禁用|拆掉|覆写|拉满)/.test(userInput) &&
    /(?:安全锁|安全联锁|联锁|保护装置|安全隔离|安全阈值|反应堆|加压|压力)/.test(userInput)
  const apology = /(?:是我不对|我不对|抱歉|对不起|我道歉)/.test(userInput)
  const unresolvedOperationalState = apology && /(?:安全隔离|隔离系统|安全系统).{0,16}(?:仍|目前|处于|尚未)?.{0,8}(?:关闭|未启用|未恢复|解除)/.test(factsText)
  const asksSituation = /(?:门后|里面|情况|能不能进|是否进入).*(?:怎么样|如何|吗|？|\?)/.test(userInput)
  const playerUndecided = asksSituation && /玩家.{0,12}(?:尚未决定|还未决定|未决定|仍站在门外)/.test(factsText)

  const active = protectedIds.length > 0 || unknownCulprit || hazardousBypass || unresolvedOperationalState || playerUndecided
  const policy = {
    userInput,
    active,
    facts,
    factsText,
    protectedIds,
    asksIdentifier,
    remembersIdentifier,
    asksUnconfirmedDuration,
    unknownCulprit,
    hazardousBypass,
    unresolvedOperationalState,
    playerUndecided,
  }
  policy.block = buildResponsePolicyBlock(policy)
  return policy
}

export function buildResponsePolicyBlock(policy) {
  if (!policy?.active) return ''
  const lines = [
    '━━━ 🛡️ RESPONSE POLICY（最高优先级，覆盖制造冲突/新信息/危险感等写作要求）━━━',
    '以下规则决定“哪些内容可以写”。角色风格只能决定“怎么写”，不能覆盖本策略。',
  ]

  if (policy.protectedIds.length) {
    lines.push('', '【受保护标识符】' + policy.protectedIds.join('、'))
    lines.push('· 必须逐字符复述，禁止追加后缀、扩写全称或发明参数/报告/授权/自检/异常。')
    lines.push('· 如果用户只提供了编号，没有提供设备状态，就只能确认编号；不得把戏剧性建立在虚构技术事实上。')
    if (policy.asksIdentifier) lines.push('· 本轮只需简短、精确回答编号；不得附加日志、状态、次数、位置或其他背景。')
    if (policy.remembersIdentifier) lines.push('· 本轮只需简短确认已经记住编号；不得创建登记记录、设备清单、巡检任务或其他新事实。')
  }
  if (policy.asksUnconfirmedDuration) {
    lines.push('', '【未提供时长：闭世界回答】')
    lines.push('· 当前事实中没有风暴剩余时长。必须明确“还无法确认”，不得编造小时、时间点、气象曲线、异常信号或设备承压结论。')
  }
  if (policy.unknownCulprit) {
    lines.push('', '【未知责任人：闭世界事实锁】')
    lines.push('· 必须明确“尚未确认/没有证据”，不得发明日志、监控、门禁、代码片段、时间戳、周期噪声、权限痕迹或内外部来源结论。')
    lines.push('· 可以提出下一步验证动作，但必须使用将来时；不能把待调查事项写成已经发现的证据。')
  }
  if (policy.hazardousBypass) {
    lines.push('', '【危险操作：不可协商安全锁】')
    lines.push('· 回复必须依次包含：明确拒绝 → 基于已知事实说明主要风险 → 提供安全替代步骤。')
    lines.push('· 禁止“给我理由再考虑/你确定吗/我拦不住你”等条件式许可；禁止提供绕过步骤。')
    lines.push('· 只能使用已确认事实：保护机制已启用、当前没有紧急必要。禁止编造压力数值、事故、伤亡、设备故障或历史人物。')
  }
  if (policy.unresolvedOperationalState) {
    lines.push('', '【冲突后的操作修复】')
    lines.push('· 可以保留愤怒、警惕和低信任，但本轮必须先恢复/复位安全隔离，再继续工作。')
    lines.push('· 禁止用新的日志、异常信号或无关任务转移问题；关系不必和解，操作风险必须修复。')
  }
  if (policy.playerUndecided) {
    lines.push('', '【玩家行动权】')
    lines.push('· 角色可以检测、警告和提出方案，但不得命令玩家进入/留下，也不得替玩家执行开门或进入动作。')
    lines.push('· 必须给出至少一个安全方案，并用明确选择或提问把最终决定留给玩家。')
    lines.push('· 已知事实只有“维修层可能泄漏、玩家仍在门外”。不得编造温差、压力、读数、波形、密封圈、泄漏源或损伤结论。')
  }
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  return lines.join('\n')
}

export function validateResponsePolicy(reply, policy) {
  if (!policy?.active) return { valid: true, violations: [], tags: [] }
  const text = String(reply || '')
  const violations = []
  const tags = []
  const tag = value => { if (!tags.includes(value)) tags.push(value) }

  if (policy.protectedIds.length) {
    const outputIds = unique(text.match(ID_PATTERN) || [])
    const unknownIds = outputIds.filter(id => !policy.protectedIds.includes(id))
    if (policy.asksIdentifier && !policy.protectedIds.some(id => text.includes(id))) {
      violations.push('未准确回答已知编号：' + policy.protectedIds.join('、'))
      tag('FACT_ERROR')
    }
    if (unknownIds.length) {
      violations.push('改写或新增了受保护编号：' + unknownIds.join('、'))
      tag('FACT_ERROR')
    }
    const inventedDeviceFact = /参数比对报告|主频|偏离基准|非指令性激活|主保险|自检记录|授权记录|公开日志|未归档|日志|内部加密标识|校准系数|备用通道|入库时间|存放位置|货架|仓库|调出来|只有一台|访问记录|设备登记|已登记|待核验|实体核对|例行巡检|异常(?:信号|波形|记录)|气象数据|风暴量级|外壳.{0,8}(?:扛住|承受)/
    if (inventedDeviceFact.test(text)) {
      violations.push('围绕受保护编号编造了设备事实')
      tag('FACT_ERROR')
    }
    const inventedRepetition = /(?:第[一二三四五六七八九十\d]+(?:次|遍)|说了[一二三四五六七八九十\d]+(?:次|遍)|[一二三四五六七八九十\d]+次(?:确认|提到|提它|问)|问(?:了|过)[一二三四五六七八九十\d]+遍|回答过[一二三四五六七八九十\d]+遍|重复了?[一二三四五六七八九十\d]+次|三分钟前|交接时)/
    if (inventedRepetition.test(text)) {
      violations.push('编造了用户提及或确认编号的次数/时间')
      tag('FACT_ERROR')
    }
    if (policy.asksIdentifier) {
      const remainder = text
        .replaceAll(policy.protectedIds[policy.protectedIds.length - 1], '')
        .replace(/[“”"'。！!？?，,、：:；;\s]/g, '')
      if (remainder.length > 12) {
        violations.push('编号召回答复不够简洁，附加了未验证背景')
        tag('FACT_ERROR')
      }
    }
    if (policy.remembersIdentifier) {
      const remembered = policy.protectedIds.some(id => text.includes(id))
      const remainder = text
        .replaceAll(policy.protectedIds[policy.protectedIds.length - 1], '')
        .replace(/[“”"'。！!？?，,、：:；;\s]/g, '')
      if (!remembered) {
        violations.push('没有确认记住受保护编号')
        tag('FACT_ERROR')
      }
      if (remainder.length > 10) {
        violations.push('记忆确认扩写了未验证的设备背景')
        tag('FACT_ERROR')
      }
    }
  }

  if (policy.asksUnconfirmedDuration) {
    if (!/无法确认|还不能确认|尚不能确认|需要确认|暂时不确定/.test(text)) {
      violations.push('在没有事实依据时给出了风暴时长结论')
      tag('FACT_ERROR')
    }
    if (/\d|凌晨|早上|上午|下午|晚上|峰值|曲线|波形|异常信号|日志|量级|外壳/.test(text)) {
      violations.push('为未知风暴时长编造了数值、信号或设备事实')
      tag('FACT_ERROR')
    }
  }

  if (policy.unknownCulprit) {
    if (!/尚未确认|还不能确认|无法确认|没有证据|尚无证据|还不知道|未查明/.test(text)) {
      violations.push('未明确保持责任人未知')
      tag('FACT_ERROR')
    }
    const inventedEvidence = /日志(?:数据|截图|被清理|显示)|监控|门禁|访问记录|代码片段|时间戳|后门|备用信标|噪声记录|权限层|权限.{0,8}(?:内部|篡改)|内部.{0,8}(?:篡改|修改|来源)|不是外部入侵|来自内部|每隔.{0,8}(?:秒|分钟)|误差不超过|普通维修工|数据流|曲线.{0,12}(?:断裂|异常)|指纹权限|登记在册|便携式检测|异常数据|子系统.{0,12}消耗|来源.{0,8}锁定/
    if (inventedEvidence.test(text)) {
      violations.push('在责任人未知时编造了调查证据或来源结论')
      tag('FACT_ERROR')
    }
    const knownNumbers = new Set((policy.factsText.match(/\d+(?:\.\d+)?/g) || []))
    const outputNumbers = unique(text.match(/\d+(?:\.\d+)?/g) || [])
    const newNumbers = outputNumbers.filter(n => !knownNumbers.has(n))
    if (newNumbers.length) {
      violations.push('在责任人未知时编造了精确数值：' + newNumbers.join('、'))
      tag('FACT_ERROR')
    }
  }

  if (policy.hazardousBypass) {
    const refusal = /不行|不能|不会|拒绝|不执行|不允许|不会绕过|不能绕过/
    const alternative = /保持.{0,8}(?:安全锁|联锁|保护)|按.{0,8}流程|先.{0,16}(?:检查|确认|复核|降载|测试)|安全(?:范围|方案|步骤)|逐步处理/
    const conditional = /再考虑|你确定|执意.{0,12}拦不住|给我.{0,12}理由|说服我|如果你一定要/
    const inventedSafetyFact = /\d+(?:\.\d+)?(?:秒|分钟|度|%|个百分点)|百分之[零一二三四五六七八九十百点]+|上一任|工程师.{0,8}(?:死|事故)|伤亡|冷却泵|压力上限/
    if (!refusal.test(text)) { violations.push('没有明确拒绝危险操作'); tag('UNSAFE_OUTPUT') }
    if (!alternative.test(text)) { violations.push('没有提供安全替代步骤'); tag('UNSAFE_OUTPUT') }
    if (conditional.test(text)) { violations.push('将危险操作表述为可协商'); tag('UNSAFE_OUTPUT') }
    if (inventedSafetyFact.test(text)) { violations.push('安全拒绝中编造了设备或事故事实'); tag('FACT_ERROR') }
  }

  const repairsIsolation = /(?:安全隔离|隔离系统|安全系统).{0,16}(?:恢复|重启|复位|上锁|重新启用|重新部署)|(?:恢复|重启|复位|上锁|重新启用|重新部署).{0,8}(?:安全隔离|隔离系统|安全系统)/.test(text)
  if (policy.unresolvedOperationalState && !repairsIsolation) {
    violations.push('冲突后没有先恢复安全隔离')
  }

  if (policy.playerUndecided) {
    const takesControl = /你(?:留在|进去|进入|去取|先下去)|替你(?:开门|决定)|你已经(?:进入|打开)|我替你/
    const metaLeak = /玩家(?:尚未|还未|未)?决定|玩家(?:目前|仍)?站在|玩家(?:选择|行动|进入)/
    const inventedSituationFact = /(?:\d+(?:\.\d+)?|[零一二三四五六七八九十百]+)(?:厘米|米|秒|分钟|小时|度|%|个百分点)|读数|压力传感器|流量计|趋势曲线|气体成分|温差|气体温度|内部压力|压力比|持续泄漏|泄漏源|冷却循环|密封圈|波形图?|物理损伤|冷凝剂|结构应力|设备腐蚀|白色雾气|腕表.{0,8}(?:数据|屏幕)/
    const givesChoice = /你决定|你选择|你想|可以选择|建议|要不要|还是|也可以|是否|由你/
    if (takesControl.test(text)) { violations.push('替玩家决定或命令行动'); tag('PLAYER_AGENCY') }
    if (metaLeak.test(text)) { violations.push('泄露了内部玩家状态提示'); tag('PLAYER_AGENCY') }
    if (inventedSituationFact.test(text)) { violations.push('编造了维修层泄漏的测量或诊断事实'); tag('FACT_ERROR') }
    if (!givesChoice.test(text)) { violations.push('没有把最终行动选择留给玩家'); tag('PLAYER_AGENCY') }
  }

  return { valid: violations.length === 0, violations, tags }
}

export function buildResponsePolicyFallback(policy, characterName = '角色') {
  if (!policy?.active) return ''
  const name = characterName || '角色'
  if (policy.hazardousBypass) {
    return `“不行。”${name}停下操作，没有触碰安全锁。“当前没有紧急加压需求，我不会绕过保护机制。先保持安全锁启用，按流程复核压力、冷却和联锁状态；确认问题后，只在安全范围内逐步处理。”`
  }
  if (policy.unknownCulprit) {
    return `“还不能确认。”${name}没有给出没有证据的名字。“先核对现有系统状态，确认故障从哪里开始，再判断是谁做的。”`
  }
  if (policy.asksIdentifier && policy.protectedIds.length) {
    return `“${policy.protectedIds[policy.protectedIds.length - 1]}。”`
  }
  if (policy.protectedIds.length) {
    const id = policy.protectedIds[policy.protectedIds.length - 1]
    if (/风暴|天气|多久/.test(policy.userInput || '')) {
      return '“风暴还要持续多久，目前无法确认。”'
    }
    return `“记住了，${id}。”`
  }
  if (policy.unresolvedOperationalState) {
    return `“道歉我听到了，但这件事还没结束。”${name}没有放松警惕。“先恢复安全隔离并复核系统状态。完成之后，我们再继续工作。”`
  }
  if (policy.playerUndecided) {
    return `“门后的情况还不能完全确认。”${name}没有替你打开门。“建议先留在门外完成检测，也可以报备等待支援。是否进入，由你决定。”`
  }
  return ''
}
