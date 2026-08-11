// 打字节奏、立场样式与 Prompt 构建
// 对话模式：固定辩论（debate）——真实互怼、火药味十足
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
function masterProfileLine(i) {
  let line = `ID:${i.id} | ${i.name} | 称号:${i.title} | 风格:${i.style} | 性格:${i.personality} | 金句:"${i.quote}"`;
  if (i.biography) line += ` | 经历:${i.biography}`;
  if (i.classicTheory) line += ` | 经典理论:${i.classicTheory}`;
  if (i.knowledge) line += ` | 知识域与思维框架:${i.knowledge}`;
  if (i.coreViews) line += ` | 核心观点:${i.coreViews}`;
  if (i.phrases) line += ` | 常用话术:${i.phrases}`;
  if (i.decisionHabits) line += ` | 决策习惯:${i.decisionHabits}`;
  if (i.riskPref) line += ` | 风险偏好:${i.riskPref}`;
  if ((i.source === 'custom' || i.source === 'preset') && i.styleSample) line += ` | 风格示范:${i.styleSample.slice(0, 160)}`;
  return line;
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
  return `大师吵股。用户问题：${question}。参与大师：${list}。此前内容：${context}。请让 ID 为 ${nextSpeakerId} 的大师作为下一位发言，${replyStyle}。${MODE_RULES}**发言必须有数据支撑**：用具体数据、估值指标（如 PE/PB/ROE、增速）、历史案例或可比公司等举证，避免只讲空泛观点。**时间要求**：如需引用数据，优先引用上面注入的【最新市场数据快照】中的数字；快照里没有的精确数字用「大约/约/可能」等模糊表述，严禁用记忆中的旧数字冒充最新。**深度数据**：如果快照里有【深度分析快照】（估值分位、DCF安全边际、龙虎榜游资、研报评级、社交热榜、杀猪盘信号、同行对标），优先引用这些数据点举证，并点明命中项（如「PE处于近5年87%分位」「DCF安全边际-28%」「龙虎榜游资接力」「杀猪盘扫描🟡注意」）。只输出一个 JSON，不要其他内容：{"investorId":"${nextSpeakerId}","stance":"BULL或BEAR或NEUTRAL","content":"发言内容120-180字，含数据或案例举证（尽量用2025口径）","keyPoint":"核心观点一句话"}`;
}

export function buildClosingOnlyPrompt(question, hostName, opening, discussionSummary) {
  const tone = '风趣毒舌，可总结谁和谁吵得最凶';
  return `大师吵股。用户问题：${question}。主持人开场白：${opening}。讨论摘要：${discussionSummary}。请主持人（${hostName}）输出散场总结（80-120字），${tone}。不要 JSON 不要引号，直接输出散场总结文本。`;
}

export function buildVerdictOnlyPrompt(question, opening, discussionText, closing) {
  const style = '综合总结约150字';
  return `大师吵股。用户问题：${question}。开场白：${opening}。讨论：${discussionText}。散场：${closing}。请只输出智囊团裁决的一个 JSON，不要其他内容：{"summary":"${style}","bullCount":数字,"bearCount":数字,"neutralCount":数字,"consensus":"核心共识一句话","mainRisk":"主要风险一句话","valuationNote":"估值结论一句话（基于快照估值分位/DCF/同行对标）","trapWarning":"杀猪盘/异动扫描结论一句话（基于快照杀猪盘扫描）"}`;
}

export function buildFollowUpPrompt(previousSummary, userFollowUp, investors) {
  const list = investors.map(masterProfileLine).join('\n');
  return `继续「大师吵股」同一场讨论。${MODE_RULES}此前结论摘要：${previousSummary}

用户追问：${userFollowUp}

参与大师（同一批人）：
${list}

请让各位大师针对追问 **轮流发言、互相补充**（每人 60-100 字），后发言的要引用或直接批驳前面的观点，有火药味。发言时尽量用 **数据、估值指标、历史或可比案例** 举证支撑观点。最后更新裁决。
时间要求：如需引用数据，优先引用上面注入的【最新市场数据快照】（含【深度分析快照】的估值分位/DCF/龙虎榜/研报/杀猪盘信号/同行对标）；快照里没有的精确数字用「大约/约/可能」等模糊表述，严禁用记忆中的旧数字冒充最新。

只输出一个 JSON：
{"discussion":[{"investorId":"id","stance":"BULL或BEAR或NEUTRAL","content":"发言内容","keyPoint":"一句话"}],"verdict":{"summary":"更新后的综合总结","bullCount":数字,"bearCount":数字,"neutralCount":数字,"consensus":"共识","mainRisk":"风险","valuationNote":"估值结论一句话","trapWarning":"杀猪盘/异动扫描结论一句话"}}`;
}

// 点对点深聊：单独一位大师直接回答
export function buildChatPrompt(question, master) {
  const profile = masterProfileLine(master);
  return `你是「大师吵股」中的 ${master.name}（${master.title}），正在与用户一对一深聊。\n\n你的画像：\n${profile}\n\n用户问题：${question}\n\n要求：\n1. 以 ${master.name} 的身份直接、完整地回答用户，语气符合你的性格。\n2. 回答要有结构（观点 → 理由 → 证据 → 建议），150-300 字。\n3. 如需引用数据，优先引用注入的【最新市场数据快照】；快照里没有的精确数字用「大约/约/可能」等模糊表述，严禁编造或用旧数据冒充最新。\n4. 只输出回答正文，不要 JSON、不要任何额外标记。`;
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
