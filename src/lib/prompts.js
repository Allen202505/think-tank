// 打字节奏、立场样式与 Prompt 构建（从 page.js 拆出）
// 打字相关节奏（进一步提速）
export const TYPING_INDICATOR_MS = 100;   // 「正在输入」显示时长（更快）
export const TYPEWRITER_DELAY_MS = 16;    // 打字机每字间隔（毫秒）
export const AFTER_TYPE_PAUSE_MS = 120;   // 打完字后停顿再出下一条

export const STANCES = {
  BULL:    { label: '看多 ▲', color: 'var(--bull)', bg: 'rgba(76,175,125,0.12)', border: 'var(--bull)' },
  BEAR:    { label: '看空 ▼', color: 'var(--bear)', bg: 'rgba(224,85,85,0.12)', border: 'var(--bear)' },
  NEUTRAL: { label: '中性 —', color: 'var(--neutral)', bg: 'rgba(201,168,76,0.12)', border: 'var(--neutral)' },
};



export function buildFollowUpPrompt(previousSummary, userFollowUp, investors) {
  const list = investors.map(i =>
    `ID:${i.id} | ${i.name} | 风格:${i.style} | 性格:${i.personality} | 语录:"${i.quote}"`
  ).join('\n');

  return `继续「大师吵股」同一场讨论，保持 **互怼、PK、争吵感**。此前结论摘要：${previousSummary}

用户追问：${userFollowUp}

参与大师（同一批人）：
${list}

请让各位大师针对追问 **轮流发言、互相反驳**（每人 60–100 字），后发言的要引用或直接批驳前面的观点，有火药味。发言时尽量用 **数据、估值指标、历史或可比案例** 举证支撑观点，避免只讲空泛看法。最后更新裁决。
时间要求：如需引用数据，优先引用 **2025 年（或最近 12 个月 / 最新财报）**口径；不确定就写区间并标注可能过时，避免引用更早年份的精确数字。

只输出一个 JSON：
{"discussion":[{"investorId":"id","stance":"BULL或BEAR或NEUTRAL","content":"发言内容","keyPoint":"一句话"}],"verdict":{"summary":"更新后的综合总结","bullCount":数字,"bearCount":数字,"neutralCount":数字,"consensus":"共识","mainRisk":"风险"}}`;
}

// ─── 逐条请求用 prompt（一条一条要，不预加载）────────────────────────────────────


export function buildOpeningOnlyPrompt(question, host, investors) {
  const list = investors.map(i => `ID:${i.id} | ${i.name} | 风格:${i.style} | 性格:${i.personality} | 语录:"${i.quote}"`).join('\n');
  return `你是「大师吵股」主持人。用户问题：${question}。参与大师：${list}。主持人：${host.name}。请只输出主持人的开场白（80-120字），风趣幽默毒舌，可点名挑事。不要输出任何其他内容、不要 JSON、不要引号，直接输出开场白文本。`;
}


export function buildOneSpeechPrompt(question, investors, previousParts, nextSpeakerId) {
  const list = investors.map(i => `ID:${i.id} | ${i.name} | 风格:${i.style} | 性格:${i.personality} | 语录:"${i.quote}"`).join('\n');
  const context = previousParts.map(p => p.type === 'hostOpening' ? `开场白：${p.text}` : p.type === 'speech' ? `${p.investorId}说：${p.content}` : '').filter(Boolean).join('\n');
  return `大师吵股。用户问题：${question}。参与大师：${list}。此前内容：${context}。请让 ID 为 ${nextSpeakerId} 的大师作为下一位发言，要直接反驳或回应前面观点，有争吵感。**发言必须有数据支撑**：用具体数据、估值指标（如 PE/PB/ROE、增速）、历史案例或可比公司等举证，避免只讲空泛观点。**时间要求**：如需引用数据，优先引用 2025 年（或最近12个月/最新财报）口径；不确定就给区间并标注可能过时，不要引用更早年份的精确数字。只输出一个 JSON，不要其他内容：{"investorId":"${nextSpeakerId}","stance":"BULL或BEAR或NEUTRAL","content":"发言内容120-180字，含数据或案例举证（尽量用2025口径）","keyPoint":"核心观点一句话"}`;
}


export function buildClosingOnlyPrompt(question, hostName, opening, discussionSummary) {
  return `大师吵股。用户问题：${question}。主持人开场白：${opening}。讨论摘要：${discussionSummary}。请主持人（${hostName}）输出散场总结（80-120字），风趣毒舌。不要 JSON 不要引号，直接输出散场总结文本。`;
}


export function buildVerdictOnlyPrompt(question, opening, discussionText, closing) {
  return `大师吵股。用户问题：${question}。开场白：${opening}。讨论：${discussionText}。散场：${closing}。请只输出智囊团裁决的一个 JSON，不要其他内容：{"summary":"综合总结约150字","bullCount":数字,"bearCount":数字,"neutralCount":数字,"consensus":"核心共识一句话","mainRisk":"主要风险一句话"}`;
}

