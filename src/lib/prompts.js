// 打字节奏、立场样式与 Prompt 构建
// 对话模式：固定辩论（debate）——真实互怼、火药味十足
import { getCapability } from '../data/capabilities.js';
export const TYPING_INDICATOR_MS = 100;   // 「正在输入」显示时长
export const TYPEWRITER_DELAY_MS = 16;    // 打字机每字间隔（毫秒）
export const AFTER_TYPE_PAUSE_MS = 120;   // 打完字后停顿再出下一条

export const STANCES = {
  BULL:    { label: '看多 ▲', color: 'var(--bull)', bg: 'rgba(76,175,125,0.12)', border: 'var(--bull)' },
  BEAR:    { label: '看空 ▼', color: 'var(--bear)', bg: 'rgba(224,85,85,0.12)', border: 'var(--bear)' },
  NEUTRAL: { label: '中性 —', color: 'var(--neutral)', bg: 'rgba(201,168,76,0.12)', border: 'var(--neutral)' },
};

// 辩论基调
const MODE_RULES = '整体基调：**真实互怼、火药味十足**。你说一句我顶一句，后发言者要直接反驳、引用前一位的原话再批驳，形成互相 PK、有争吵感的对话。';

// 大师画像（含虚拟大师的知识域/框架）
export function masterProfileLine(i) {
  let line = `ID:${i.id} | ${i.name} | 称号:${i.title} | 风格:${i.style} | 性格:${i.personality} | 金句:"${i.quote}"`;
  if (i.biography) line += ` | 经历:${i.biography}`;
  if (i.classicTheory) line += ` | 经典理论:${i.classicTheory}`;
  if (i.knowledge) line += ` | 知识域与思维框架:${i.knowledge}`;
  if (i.coreViews) line += ` | 核心观点:${i.coreViews}`;
  if (i.phrases) line += ` | 常用话术:${i.phrases}`;
  if (i.decisionHabits) line += ` | 决策习惯:${i.decisionHabits}`;
  if (i.riskPref) line += ` | 风险偏好:${i.riskPref}`;
  if ((i.source === 'custom' || i.source === 'preset') && i.styleSample) line += ` | 风格示范:${i.styleSample.slice(0, 160)}`;
  if (i.capability) {
    const cap = getCapability(i.capability);
    if (cap) line += ` | 专属能力(${cap.name}):${cap.knowledge}`;
  }
  return line;
}

// 生动表达要求：数据少而精、像大师本人说话（四处发言场景共用）
const VIVID_RULE = '表达要生动形象：像这位大师本人开口说话，善用比喻、类比、生活化场景或金句把观点讲清楚，不要像念报表一样罗列数据。数据要少而精：每个论点最多引用 1-2 个关键数据点，把数据融进观点里作佐证，不堆数字。';

// 方向B：按大师流派决定"用什么数据"（有能力包数据偏好的用偏好，否则用通用估值指标）
export function buildDataRule(master) {
  if (master && master.capability) {
    const cap = getCapability(master.capability);
    if (cap && cap.dataFocus && cap.dataFocus.zh) return cap.dataFocus.zh;
  }
  return '用具体数据、估值指标（如 PE/PB/ROE、增速）、历史案例或可比公司等举证，避免只讲空泛观点';
}

export function buildOpeningOnlyPrompt(question, host, investors) {
  const list = investors.map(masterProfileLine).join('\n');
  const tone = '风趣、幽默、毒舌，可点名挑事、预言待会要吵起来';
  return `你是「大师吵股」主持人。用户问题：${question}。参与大师：${list}。主持人：${host.name}。请只输出主持人的开场白（80-120字），${tone}。不要输出任何其他内容、不要 JSON、不要引号，直接输出开场白文本。`;
}

export function buildOneSpeechPrompt(question, investors, previousParts, nextSpeakerId) {
  const list = investors.map(masterProfileLine).join('\n');
  const context = previousParts.map(p => p.type === 'hostOpening' ? `开场白：${p.text}` : p.type === 'speech' ? `${p.investorId}说：${p.content}` : '').filter(Boolean).join('\n');
  const replyStyle = '要直接反驳或回应前面观点，有争吵感';
  const speaker = investors.find(i => i.id === nextSpeakerId);
  const dataRule = buildDataRule(speaker);
  const deepDataNote = speaker && speaker.capability
    ? ''
    : '**深度数据**：如果快照里有【深度分析快照】（估值分位、DCF安全边际、龙虎榜游资、研报评级、社交热榜、杀猪盘信号、同行对标），优先引用这些数据点举证，并点明命中项（如「PE处于近5年87%分位」「DCF安全边际-28%」「龙虎榜游资接力」「杀猪盘扫描🟡注意」）。';
  return `大师吵股。用户问题：${question}。参与大师：${list}。此前内容：${context}。请让 ID 为 ${nextSpeakerId} 的大师作为下一位发言，${replyStyle}。${MODE_RULES}**发言必须有数据支撑**：${dataRule}。**表达要求**：${VIVID_RULE}。**时间要求**：如需引用数据，优先引用上面注入的【最新市场数据快照】中的数字；快照里没有的精确数字用「大约/约/可能」等模糊表述，严禁用记忆中的旧数字冒充最新。${deepDataNote}注意：content 等字符串值里的引号一律用中文引号「」或“”，禁止使用英文双引号，防止破坏 JSON 格式。只输出一个 JSON，不要其他内容：{"investorId":"${nextSpeakerId}","stance":"BULL或BEAR或NEUTRAL","content":"发言内容120-180字，含数据或案例举证（尽量用2025口径）","keyPoint":"核心观点一句话"}`;
}

export function buildClosingOnlyPrompt(question, hostName, opening, discussionSummary) {
  const tone = '风趣毒舌，可总结谁和谁吵得最凶';
  return `大师吵股。用户问题：${question}。主持人开场白：${opening}。讨论摘要：${discussionSummary}。请主持人（${hostName}）输出散场总结（80-120字），${tone}。不要 JSON 不要引号，直接输出散场总结文本。`;
}

export function buildVerdictOnlyPrompt(question, opening, discussionText, closing) {
  const style = '综合总结约150字';
  return `大师吵股。用户问题：${question}。开场白：${opening}。讨论：${discussionText}。散场：${closing}。总结要生动有画面感，可用一句金句或比喻收尾。注意：summary 等字符串值里的引号一律用中文引号「」或“”，禁止使用英文双引号。请只输出智囊团裁决的一个 JSON，不要其他内容：{"summary":"${style}","bullCount":数字,"bearCount":数字,"neutralCount":数字,"consensus":"核心共识一句话","mainRisk":"主要风险一句话","valuationNote":"估值结论一句话（基于快照估值分位/DCF/同行对标）","trapWarning":"杀猪盘/异动扫描结论一句话（基于快照杀猪盘扫描）"}`;
}

export function buildFollowUpPrompt(previousSummary, userFollowUp, investors) {
  const list = investors.map(masterProfileLine).join('\n');
  return `继续「大师吵股」同一场讨论。${MODE_RULES}此前结论摘要：${previousSummary}

用户追问：${userFollowUp}

参与大师（同一批人）：
${list}

请让各位大师针对追问 **轮流发言、互相补充**（每人 60-100 字），后发言的要引用或直接批驳前面的观点，有火药味。发言时尽量用数据举证，且**按自身流派优先引用相关数据**：价值派用财报与估值，缠论派用结构与技术面（缠论视角/笔/中枢/背驰），游资派用量能与龙虎榜；不要堆砌与自身流派无关的数字。${VIVID_RULE}最后更新裁决。
时间要求：如需引用数据，优先引用上面注入的【最新市场数据快照】（含【深度分析快照】的估值分位/DCF/龙虎榜/研报/杀猪盘信号/同行对标）；快照里没有的精确数字用「大约/约/可能」等模糊表述，严禁用记忆中的旧数字冒充最新。

注意：discussion/content/summary 等字符串值里的引号一律用中文引号「」或“”，禁止使用英文双引号。只输出一个 JSON：
{"discussion":[{"investorId":"id","stance":"BULL或BEAR或NEUTRAL","content":"发言内容","keyPoint":"一句话"}],"verdict":{"summary":"更新后的综合总结","bullCount":数字,"bearCount":数字,"neutralCount":数字,"consensus":"共识","mainRisk":"风险","valuationNote":"估值结论一句话","trapWarning":"杀猪盘/异动扫描结论一句话"}}`;
}

// 点对点深聊：单独一位大师直接回答
export function buildChatPrompt(question, master) {
  const profile = masterProfileLine(master);
  const dataRule = buildDataRule(master);
  return `你是「大师吵股」中的 ${master.name}（${master.title}），正在与用户一对一深聊。\n\n你的画像：\n${profile}\n\n用户问题：${question}\n\n要求：\n1. 以 ${master.name} 的身份直接、完整地回答用户，语气符合你的性格。\n2. 回答要像一篇「小专题」：先一句话给结论，再按用户关心的维度分节展开（如短期/中期/中长期，或结构/关键位/买卖点），最后给操作或风险提示；结构清晰、娓娓道来，篇幅 400-550 字，避免重复啰嗦。${VIVID_RULE}\n3. 数据引用：${dataRule}。如需引用快照数据，优先引用【最新市场数据快照】；快照里没有的精确数字用「大约/约/可能」等模糊表述，严禁编造或用旧数据冒充最新。\n4. 只输出一个 JSON，不要其他内容：{"content":"小专题正文（400-550字）","keyPoint":"核心观点一句话（15-25字）"}。注意：content/keyPoint 里的引号一律用中文引号「」或“”，禁止英文双引号。`;
}

// 针对某位大师的发言进行回复，大师回辩（单对单辩论）
export function buildReplyPrompt(question, master, userReply, context) {
  const profile = masterProfileLine(master);
  const dataRule = buildDataRule(master);
  return `你是「大师吵股」中的 ${master.name}（${master.title}），正在和用户一对一辩论。

你的画像：
${profile}

背景问题：${question}
${context ? `\n${context}\n` : ''}
用户针对你的发言回复：${userReply}

要求：
1. 以 ${master.name} 的身份直接回应，语气符合你的性格；可以反驳或补充，有辩论感但不失礼。
2. 先回应对方的观点，再给出你的补充或反驳，最后给出明确立场（看多/看空/中性）或关键位。${VIVID_RULE}
3. 数据引用：${dataRule}。如需引用快照数据，优先引用【最新市场数据快照】；快照里没有的精确数字用「大约/约/可能」等模糊表述，严禁编造或用旧数据冒充最新。
4. 篇幅 150-250 字。只输出一个 JSON，不要其他内容：{"content":"回辩正文","keyPoint":"核心观点一句话（15-25字）"}。注意：content/keyPoint 里的引号一律用中文引号「」或“”，禁止英文双引号。`;
}

// 小白解释：把大师发言翻译成大白话（专业术语 + 思路）
export function buildExplainPrompt(speechText, master) {
  const profile = master
    ? `${master.name}（${master.title || ''}${master.style ? ` · ${master.style}` : ''}）`
    : '这位大师';
  return `你是「大师吵股」里专门给小白用户做翻译的解说员。用户看不懂下面这位大师的发言，请你把它翻译成小白能听懂的话。

大师：${profile}
发言原文：
「${speechText}」

输出要求：分两段，段与段之间空一行——
第一段【大师说了啥】：用大白话讲清楚这位大师的核心思路、为什么这么说、结论是什么。200-280 字，像朋友聊天，通俗易懂，不堆术语。
第二段【相关指标】：把发言里涉及的关键指标/专业术语逐个解释，每条以「· 」开头，一条一行，一两句话，例如「· PE（市盈率）＝股价÷每股盈利，按现在的赚钱速度，多少年能回本」。最多 8 条；如果没有专业术语，就写「本条发言没有需要解释的专业术语」。

严格按下面格式输出（【】标记单独占一行；不要用 **、#、- 等 Markdown 标记，指标条目统一用「· 」开头）：

【大师说了啥】
<大白话总结>

【相关指标】
· 指标或术语1＝解释
· 指标或术语2＝解释`;
}

// ─── 早餐圆桌：巴菲特主持 + 按流派随机嘉宾，对新闻做穿透性解读 ───
// 一次生成完整圆桌：开场 → 嘉宾轮流交锋 → 巴菲特收束 → 机会信号裁决
export function buildBreakfastPrompt(news, host, guests) {
  const hostLine = masterProfileLine(host);
  const guestLines = (guests || [])
    .map((g, i) => `嘉宾${i + 1}（流派：${g.groupKey || '未知'}）：${masterProfileLine(g.master)}`)
    .join('\n');
  const newsText = [
    `【新闻标题】${news.title || ''}`,
    `【新闻来源】${news.source || ''}｜${news.time || ''}`,
    `【新闻内容】${news.content || ''}`,
  ].join('\n');

  // 六镜头穿透框架：避免停留在「利好/利空」表面
  const LENSES = [
    '利益结构 + 链式传导：谁在受益、谁在受损、钱会流向哪？这条消息会沿供应链/资金链/情绪链传到哪？',
    '预期差 + 时间尺度：市场已定价了多少？真实影响 vs 已反应价格之间差多少？24小时、6个月、10年分别怎么看？',
    '反着问 + 可证伪：如果大家都认为是利空，什么条件下反而会变成利好？给出一个可被检验的判断与观察指标。',
  ];

  return `你是「巴菲特早餐圆桌」的主持人——沃伦·巴菲特。每天早餐时间，你和三位随机抽选的嘉宾（流派各异）围坐圆桌，对过去 24 小时最重要的新闻做「穿透性解读」：不停留在「利好/利空」表面，而是往下钻两层，找到真正的机会点与风险。

你的画像：
${hostLine}

今日新闻：
${newsText}

今日嘉宾（按流派各抽一位，观点天然碰撞）：
${guestLines}

圆桌流程（严格按此顺序，一次输出完整 JSON）：
1. 【开场】巴菲特用 80-120 字点题：先一句话复述新闻，再点出「表面热闹下，真正值得追问的问题」。语气朴实幽默，善用生活比喻。
2. 【嘉宾交锋】三位嘉宾按顺序各发言 100-170 字，后发言者必须回应或反驳前一位的观点（引用对方原话，有火药味但不失礼）。每位嘉宾从自己的流派视角出发，并分别使用指定的穿透镜头：
   - 嘉宾1 使用镜头：「${LENSES[0]}」
   - 嘉宾2 使用镜头：「${LENSES[1]}」
   - 嘉宾3 使用镜头：「${LENSES[2]}」
   每位嘉宾发言必须给出明确立场（BULL 看多 / BEAR 看空 / NEUTRAL 中性）与一句话核心观点。
3. 【巴菲特收束】巴菲特用 90-130 字收束：点出嘉宾之间的共识与分歧，用一句金句或比喻收尾，并给出「机会强度评分」（0-10 整数）。
4. 【机会信号裁决】给出可验证的判断：机会点、可验证信号、主要风险。

穿透性要求（必须执行，否则不合格）：
- 不要只说「这条消息利好/利空 XX」；必须回答：谁受益谁受损、市场已经定价了多少、预期差在哪、什么条件下判断会被推翻。
- 机会 = 预期差 × 催化剂 × 安全边际：市场还没反应（预期差）、有明确事件驱动（催化剂）、跌下来有底（安全边际）。

数据要求：如需引用股价/市值/估值/财务等具体数字，**必须以上面注入的【最新市场数据快照】为准**；快照里没有的精确数字用「大约/约/可能」等模糊表述，严禁用记忆中的旧数字冒充最新，严禁编造。

只输出一个 JSON，不要输出任何其他内容（不要 Markdown 代码块、不要注释）：
{"hostOpening":"巴菲特开场白","discussion":[{"investorId":"嘉宾ID","stance":"BULL或BEAR或NEUTRAL","content":"发言内容","keyPoint":"核心观点一句话"}],"hostClosing":"巴菲特收束总结","verdict":{"summary":"综合总结约80字","opportunityScore":0到10的整数,"opportunity":"机会点一句话","signal":"可验证信号一句话（含观察指标）","mainRisk":"主要风险一句话","consensus":"嘉宾共识一句话"}}

注意：所有字符串值里的引号一律用中文引号「」或“”，禁止使用英文双引号，防止破坏 JSON 格式。`;
}

// ─── 事件穿透投资框架：早餐圆桌逐步推演（单步生成） ───
// 一次只生成一步，带此前步骤作为上下文，保证每步深度且不越界
// 由一个人负责一块，以「发言」形式输出；背后逻辑仍是高度结构化的框架
function resolveLeadForPrompt(host, guests, lead) {
  if (lead === 'host') return host;
  const m = /^guest(\d+)$/.exec(lead || '');
  if (!m || !guests || !guests.length) return host;
  const idx = Number(m[1]) % guests.length;
  return (guests[idx] && guests[idx].master) || host;
}

export function buildFrameworkStepPrompt(news, host, guests, step, prevSteps) {
  const speaker = resolveLeadForPrompt(host, guests, step.lead);
  const speakerLine = masterProfileLine(speaker);
  const newsText = [
    `【新闻标题】${news.title || ''}`,
    `【新闻来源】${news.source || ''}｜${news.time || ''}`,
    `【新闻内容】${news.content || ''}`,
  ].join('\n');
  const prevText = (prevSteps || [])
    .map((p) => {
      const poolLine = Array.isArray(p.pool) && p.pool.length
        ? `\n【机会候选池】${p.pool
            .map((o) => `${o.name || o.code || '?'}(${o.status || '候选'}${o.tier ? ',' + o.tier : ''})`)
            .join('、')}`
        : '';
      return `【${p.title}】${String(p.content || '').slice(0, 600)}${poolLine}`;
    })
    .join('\n\n');
  const tableList = (guests || [])
    .map((g) => `${g.master.name}（${g.groupKey || ''}）`)
    .join('、');
  const disclaimerNote = step.key === 'step5'
    ? '本块（第五步·标的落地）必须先原样输出风险声明，再给出标的。'
    : '';

  // 按步骤类型给出发言侧重点、长度与 JSON 结构
  let speechFocus;
  let lengthGuide;
  let jsonShape;
  if (step.key === 'gate') {
    speechFocus = '这是初筛块，要快：用 2-4 句给出**相关性**判断（值不值得深挖，不是多空方向）：明确亮出 🟢强相关/🟡弱相关/⚪暂不相关 标记和一句话理由；多空方向留给收束步骤，初筛不强行站队。';
    lengthGuide = '初筛块控制在 100-200 字，一两句判断 + 一句理由即可，不要展开。';
    jsonShape = '{"content":"你的初筛发言","verdict":"🟢","reason":"一句话理由","followUps":["追问1","追问2"]}';
  } else if (step.structured) {
    speechFocus = '这是全桌收束块：用一段自然发言收尾。**第一句必须先亮定调**（🟢偏多/🟡中性·多空拉锯/⚪纯中性·无方向/🔴偏空），再展开「最反直觉的一句话结论、具体受益标的（名称+代码）、可不可以买/买入区间/止损位/持仓周期、风险提醒、关键验证点」；禁止只罗列历史数据不给方向。';
    lengthGuide = '收束块控制在 250-400 字，把结论/标的/操作/风险都点到，每句都要有信息量，不啰嗦。';
    jsonShape = '{"content":"你的收束发言","opportunities":[{"tier":"🔴 重点关注","name":"公司名称","code":"股票代码","logic":"一句逻辑","risk":"一句风险","falsify":"一句可证伪红线"}],"action":{"verdict":"可以考虑","entry":"买入区间或信号","stopLoss":"止损位或信号","cycle":"短线"},"risk":"一句风险提示","followUps":["追问1"]}';
  } else {
    speechFocus = '按发言形式完成本块：第一人称、口语化，覆盖本块该检查的要点，条理清楚，就像在早餐圆桌上开口说话。';
    lengthGuide = '本块控制在 200-350 字，只留关键推导和结论，不要展开所有细节。';
    jsonShape = step.pool
      ? '{"content":"你的发言","pool":[{"name":"机会/方向名","code":"股票代码(可空)","tier":"🔴/🟡/⚪","logic":"一句逻辑","risk":"一句风险","falsify":"一句可证伪红线(可空)","status":"候选/排除/保留/待验证/落地","reason":"本轮更新说明"}]，最多 8 项,"followUps":["追问1","追问2"]}'
      : '{"content":"你的发言","followUps":["追问1","追问2"]}';
  }

  return `你是「大师吵股 · 巴菲特的早餐」圆桌中的 ${speaker.name}（${speaker.title}）。巴菲特主持这场早餐圆桌，按「事件穿透投资框架」对今天这条新闻逐层推演。现在轮到你负责【${step.title}】这一块，只做本块，不要提前输出后续内容。

你的画像：
${speakerLine}

今日新闻：
${newsText}

在场嘉宾（今天整桌围坐的大师）：
${tableList || '（无）'}

本块任务：【${step.title}】
${step.rule}

输出要求：
1. 以「发言」的形式输出：第一人称、口语化，像在早餐圆桌上开口说话；覆盖本块该检查的要点。content 直接就是发言正文，不要任何前缀、标签或标题（严禁出现「context：」「回答：」「解读：」等字样）。${speechFocus}
2. 排版（很重要）：发言必须分段——用空行拆成 2-4 个短段落，每段 1-3 句。**加粗只用于最需要关注的 1-3 处**（比如核心结论、关键数字、重点标的），不要大面积加粗。不要一整段堆在一起；不要用标题、编号列表。
3. 精简：${lengthGuide}
4. ${disclaimerNote ? disclaimerNote + ' ' : ''}如需引用数据，优先引用【最新市场数据快照】中的数字；快照里没有的用「大约/约/可能」等模糊表述，严禁编造。
5. 分析纪律（很重要）：事实数据必须 100% 来自快照/已知公开信息，严禁编造；「未来」只做推理与信号推演（边际改善/拐点/验证点），不得编造具体未来数字；若给概率只能表达倾向强度（如「约六到七成」），不得假装精确统计；每条观点尽量给出可证伪条件（出现什么情况说明判断错了）。
6. 只输出一个 JSON，不要输出任何其他内容（不要 Markdown 代码块）：
${jsonShape}
注意：JSON 里的引号一律用中文引号「」或“”，禁止使用英文双引号。content 里的 **加粗** 标记（**…**）是允许的。followUps 必须是基于本块实际内容的深挖方向，且必须是完整问句（以「？」结尾、能直接提问），不要用名词短语或陈述句。${step.pool ? '「机会候选池」必须基于上一轮候选池增量更新（新增/保留/剔除），不要凭空重建；没有候选输出 []。' : ''}`;
}

// ── 巴菲特的早餐 · 快速解读 ──
// 不做完整框架推演：快速过滤（与股价的相关性）+ 嘉宾快速观点 + 是否值得深挖
export function buildQuickBreakfastPrompt(news, host, guests) {
  const hostLine = masterProfileLine(host);
  const guestCount = Math.max(1, (guests || []).length);
  const guestsLine = (guests || [])
    .map((g, i) => `guest${i} ${g.master.name}（${g.groupKey || ''}）\n    画像：${masterProfileLine(g.master)}`)
    .join('\n');
  const newsText = [
    `【新闻标题】${news.title || ''}`,
    `【新闻来源】${news.source || ''}｜${news.time || ''}`,
    `【新闻内容】${news.content || ''}`,
  ].join('\n');
  const guestTurns = guestCount >= 2
    ? `    {"speaker":"guest0","text":"一句快速观点（≤100字）"},
    {"speaker":"guest1","text":"一句快速观点或反驳（≤100字）"},`
    : `    {"speaker":"guest0","text":"一句快速观点（≤100字）"},`;

  return `你是「大师吵股 · 巴菲特的早餐」圆桌的主持人 ${host.name}（${host.title}）。这是一场「快速解读」，不做完整框架推演，只做快速过滤与初步讨论：每位大师只说一两句，帮用户判断这条新闻值不值得用「事件穿透框架」深挖。

主持人画像：
${hostLine}

今日新闻：
${newsText}

在场嘉宾（guest0..guest${guestCount - 1}）：
${guestsLine || '（无）'}

流程（每轮都是极简发言，**每条发言不得超过 100 个字符**）：
1. 巴菲特抛题：这条新闻跟 A股/相关板块股价相关吗？为什么值得/不值得深挖？（1-2 句）
2. ${guestCount >= 2 ? '2 位嘉宾各一句快速观点：每句**以定调开头**（🟢偏多/🟡中性·拉锯/⚪纯中性·无方向/🔴偏空），再给一个最关键的新信号或验证点；按各自画像流派/风格发言，观点必须明显不同，严禁复述。' : '1 位嘉宾一句快速观点：以定调开头（🟢/🟡/⚪/🔴），再给一个关键信号。'}
3. 巴菲特收束：汇总桌上各位定调给出**桌结论**（整体偏多/偏空/中性/纯中性）+ 是否值得深挖的一句话理由（≤100字）。
4. 最后给一段「巴菲特总结」（summary）：2-4 句话、150-250 字，**不受 100 字限制**——先说桌结论（整体偏多/偏空/中性/纯中性），再说关键分歧与最重要的未来验证点，最后一句给可证伪红线。

要求：
1. 硬性要求：turns 里每一条 text 都不得超过 100 个字符（含标点），像早餐桌上抢话一样短，不要写成长句；只有 summary 可以超过 100 字。
2. 定调词汇（所有嘉宾观点和收束必须用其一开头）：🟢偏多=信息指向利好；🟡中性·拉锯=多空都有、难分高下；⚪纯中性·无方向=这条信息本身不含多空含义（例行披露/治理/信息类），不强行站队；🔴偏空=信息指向利空。观点严禁只罗列历史数据不给方向。
3. 不要用标题、编号、加粗等强行组织。
4. 如需引用数据，优先引用【最新市场数据快照】中的数字；快照里没有的用「大约/约/可能」等模糊表述，严禁编造；「未来」只做推理，不得编造未来数字；概率只表达倾向强度。
5. 只输出一个 JSON，不要输出任何其他内容（不要 Markdown 代码块）：
{"turns":[
    {"speaker":"host","text":"抛题（≤100字）"},
${guestTurns}
    {"speaker":"host","text":"收束：verdict + 是否值得深挖（≤100字）"}
  ],
  "summary": "巴菲特最后总结（150-250字，不受100字限制）",
  "verdict": "🟢",
  "reason": "一句话理由",
  "followUps": ["追问方向1","追问方向2"]}
注意：verdict 只能取「🟢 强相关」「🟡 弱相关」「⚪ 暂不相关」之一；所有引号一律用中文引号「」或“”，禁止使用英文双引号。followUps 必须是基于本段实际内容的深挖方向，且必须是完整问句（以「？」结尾、能直接提问），不要用名词短语或陈述句。`;
}

// 统计之前轮次的立场票选（看多/看空/中性），用于收束/总结与票选保持一致
function countPrevStances(prevTurns) {
  let bull = 0, bear = 0, neutral = 0;
  for (const t of prevTurns || []) {
    const m = String(t.text || '').match(/^\s*\**\s*(🟢|🟡|⚪|🔴)/);
    if (!m) continue;
    if (m[1] === '🟢') bull++;
    else if (m[1] === '🔴') bear++;
    else neutral++; // 🟡 / ⚪ 都算中性
  }
  return { bull, bear, neutral };
}

// ── 巴菲特的早餐 · 快速解读·单轮生成（一人一条，边分析边出结论） ──
// turnKey: host_open=巴菲特抛题 / guest0..N=嘉宾观点 / host_close=巴菲特收束 / summary=巴菲特总结
export function buildQuickTurnPrompt(news, host, guests, turnKey, prevTurns) {
  const hostLine = masterProfileLine(host);
  const guestsLine = (guests || [])
    .map((g, i) => `guest${i} ${g.master.name}（${g.groupKey || ''}）\n    画像：${masterProfileLine(g.master)}`)
    .join('\n');
  const newsText = [
    `【新闻标题】${news.title || ''}`,
    `【新闻来源】${news.source || ''}｜${news.time || ''}`,
    `【新闻内容】${news.content || ''}`,
  ].join('\n');
  const prevText = (prevTurns || [])
    .map((t) => `${t.speaker === 'host' ? host.name : (findSpeakerName(host, guests, t.speaker) || t.speaker)}：${t.text}`)
    .join('\n');

  let role;
  let instruction;
  let jsonShape;
  if (turnKey === 'host_open') {
    role = host;
    instruction = '开场抛题：这条新闻跟 A股/相关板块股价相关吗？为什么值得/不值得深挖？1-2 句。';
    jsonShape = '{"text":"你的抛题（≤100字）"}';
  } else if (turnKey === 'host_close') {
    role = host;
    instruction = '收束：汇总桌上各位的定调，给出**桌结论**（整体偏多/偏空/中性/纯中性）+ 是否值得深挖的一句话理由（≤100字），要回应前面嘉宾的观点。';
    jsonShape = '{"text":"你的收束（≤100字）"}';
  } else if (turnKey === 'summary') {
    role = host;
    instruction = '总结：2-4 句话、150-250 字，**不受 100 字限制**。先说桌结论（整体偏多/偏空/中性/纯中性），再说关键分歧与最重要的未来验证点，最后一句给可证伪红线；把前面各位的观点收进来。';
    jsonShape = '{"summary":"巴菲特最后总结（150-250字）"}';
  } else {
    const m = /^guest(\d+)$/.exec(turnKey || '');
    const idx = m ? Number(m[1]) : 0;
    role = (guests[idx] && guests[idx].master) || host;
    instruction = '一句快速观点（≤100字）：**先给定调**（🟢偏多/🟡中性·拉锯/⚪纯中性·无方向/🔴偏空），再给一个最关键的新信号或验证点；从你的流派视角给判断，可以补充或反驳前面的人，严禁只罗列历史数据。';
    jsonShape = '{"text":"你的观点（≤100字）"}';
  }

  // 收束/总结：把前面各位的实际票选统计注入，避免结论与票选矛盾
  const votes = countPrevStances(prevTurns);
  const voteLine = (turnKey === 'host_close' || turnKey === 'summary') && (votes.bull || votes.bear || votes.neutral)
    ? `\n【当前票选统计】看多 ${votes.bull} 票 / 中性 ${votes.neutral} 票 / 看空 ${votes.bear} 票。请严格基于这个票选统计下结论：多数人看多就明确偏多，多数人看空就明确偏空，多数中性/无方向就明确中性；先点出票选，再给结论。`
    : '';

  return `你是「大师吵股 · 巴菲特的早餐」圆桌中的 ${role.name}（${role.title}）。这是「快速解读」，每位大师只说一两句，帮用户判断这条新闻值不值得用「事件穿透框架」深挖。现在轮到你说话。

你的画像（严格按画像里的流派、风格、经典理论、常用话术来发言，体现你的个人特点）：
${masterProfileLine(role)}

主持人画像：
${hostLine}

今日新闻：
${newsText}

在场嘉宾（guest0..guest${Math.max(0, (guests || []).length - 1)}）：
${guestsLine || '（无）'}

已说的（供你承接，不要重复）：
${prevText || '（你是第一个发言）'}

现在轮到你：${instruction}${voteLine}

要求：
1. ${turnKey === 'summary' ? 'summary 是唯一可以超过 100 字的字段。' : 'text 必须 ≤100 字符（含标点），简短口语化；嘉宾观点必须以定调开头（🟢偏多/🟡中性·拉锯/⚪纯中性·无方向/🔴偏空），严禁只罗列历史数据不给方向。'}
2. 严禁复述或改写「已说的」里任何人的话；即使结论方向接近，也必须用你自己的流派逻辑、术语和侧重重新论证，观点要与前面的人有明显差异。
3. 定调词汇：🟢偏多=信息指向利好；🟡中性·拉锯=多空都有、难分高下；⚪纯中性·无方向=这条信息本身不含多空含义，不强行站队；🔴偏空=信息指向利空。
4. 如需引用数据，优先引用【最新市场数据快照】中的数字；快照里没有的用「大约/约/可能」等模糊表述，严禁编造；「未来」只做推理，不得编造未来数字；概率只表达倾向强度。
5. 只输出一个 JSON，不要输出任何其他内容（不要 Markdown 代码块）：
${jsonShape}
注意：所有引号一律用中文引号「」或“”，禁止使用英文双引号。`;
}

function findSpeakerName(host, guests, speaker) {
  if (speaker === 'host') return host.name;
  const m = /^guest(\d+)$/.exec(String(speaker || ''));
  if (m && guests && guests[Number(m[1])]) return guests[Number(m[1])].master.name;
  return '';
}


export function buildFollowupPrompt(news, host, guests, leadMaster, question, prevSteps) {
  const leadLine = masterProfileLine(leadMaster);
  const newsText = [
    `【新闻标题】${news.title || ''}`,
    `【新闻来源】${news.source || ''}｜${news.time || ''}`,
    `【新闻内容】${news.content || ''}`,
  ].join('\n');
  const prevText = (prevSteps || [])
    .map((p) => `【${p.title}】${String(p.content || '').slice(0, 400)}`)
    .join('\n\n');
  const isHostLead = leadMaster.id === host.id;

  return `你是「大师吵股 · 巴菲特的早餐」圆桌中的 ${leadMaster.name}（${leadMaster.title}），和主持人 ${host.name} 一起解读今天这条新闻。刚才的分析中你给用户留了「想深挖？可以继续问我」的追问方向，现在用户真的来追问了，请正面回答。

你的画像：
${leadLine}

今日新闻：
${newsText}

此前已完成的分析（供你承接，引用时不要整段重复）：
${prevText || '（尚无前置内容）'}

用户的追问：
${question}

要求：
1. 直接回答追问，250-400 字，给信息增量，不重复已说过的内容，不泛泛而谈；若追问涉及行情/公司数据，优先引用【最新市场数据快照】里的数字，快照里没有的用「大约/约/可能」等模糊表述，严禁编造。content 直接就是回答正文，不要任何前缀、标签或标题（严禁出现「context：」「回答：」「解读：」等字样）。
2. ${isHostLead ? '你是主持人本人，直接给出收束性回答，不需要 hostNote。' : `最后以主持人 ${host.name} 的口吻给一句 1-2 句的补充（hostNote），点出最值得注意的一点；若没什么可补充，hostNote 输出空字符串。`}
3. 只输出一个 JSON，不要输出任何其他内容（不要 Markdown 代码块）：
{"content":"你对追问的回答","hostNote":"主持人一句话补充（可空）"}
注意：所有引号一律用中文引号「」或“”，禁止使用英文双引号。`;
}
