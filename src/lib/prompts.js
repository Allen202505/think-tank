// 打字节奏、立场样式、对话模式与 Prompt 构建
// 支持三种模式：debate(辩论) / explore(探讨) / teach(教学)
export const TYPING_INDICATOR_MS = 100;   // 「正在输入」显示时长
export const TYPEWRITER_DELAY_MS = 16;    // 打字机每字间隔（毫秒）
export const AFTER_TYPE_PAUSE_MS = 120;   // 打完字后停顿再出下一条

export const STANCES = {
  BULL:    { label: '看多 ▲', color: 'var(--bull)', bg: 'rgba(76,175,125,0.12)', border: 'var(--bull)' },
  BEAR:    { label: '看空 ▼', color: 'var(--bear)', bg: 'rgba(224,85,85,0.12)', border: 'var(--bear)' },
  NEUTRAL: { label: '中性 —', color: 'var(--neutral)', bg: 'rgba(201,168,76,0.12)', border: 'var(--neutral)' },
};

// 对话模式
export const MODES = {
  debate:  { label: '辩论', hint: '真实互怼 · 针锋相对' },
  explore: { label: '探讨', hint: '理性拆解 · 深度梳理' },
  teach:   { label: '教学', hint: '小白友好 · 讲透术语' },
};

// 不同模式的整体基调
function modeRules(mode) {
  if (mode === 'explore') {
    return '整体基调：**理性探讨、深度拆解**。大师们围绕问题梳理逻辑链条：先亮明观点，再给出推理过程、依据与反方考量；彼此**补充、追问、修正**，而不是争吵；语气克制、相互尊重，像一场学术圆桌。';
  }
  if (mode === 'teach') {
    return '整体基调：**面向小白的教学**。大师们用**通俗易懂的语言**讲解：遇到专业术语（如 PE、ROE、安全边际、周期、护城河等）先**用大白话解释清楚**再讨论，多打生活化比方、举具体例子，节奏放慢、耐心，像给零基础学生上课。';
  }
  return '整体基调：**真实互怼、火药味十足**。你说一句我顶一句，后发言者要直接反驳、引用前一位的原话再批驳，形成互相 PK、有争吵感的对话。';
}

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
  if (i.source === 'custom' && i.styleSample) line += ` | 风格示范:${i.styleSample.slice(0, 160)}`;
  return line;
}

export function buildOpeningOnlyPrompt(question, host, investors, mode = 'debate') {
  const list = investors.map(masterProfileLine).join('\n');
  const tone = mode === 'debate'
    ? '风趣、幽默、毒舌，可点名挑事、预言待会要吵起来'
    : mode === 'explore'
      ? '理性、沉稳，先点出今天要探讨的核心问题，欢迎各位补充完善'
      : '亲切、有耐心，先用一句话说明今天要聊什么，并告诉新手别怕专业术语，会慢慢讲';
  return `你是「大师吵股」主持人。用户问题：${question}。参与大师：${list}。主持人：${host.name}。请只输出主持人的开场白（80-120字），${tone}。不要输出任何其他内容、不要 JSON、不要引号，直接输出开场白文本。`;
}

export function buildOneSpeechPrompt(question, investors, previousParts, nextSpeakerId, mode = 'debate') {
  const list = investors.map(masterProfileLine).join('\n');
  const context = previousParts.map(p => p.type === 'hostOpening' ? `开场白：${p.text}` : p.type === 'speech' ? `${p.investorId}说：${p.content}` : '').filter(Boolean).join('\n');
  const replyStyle = mode === 'debate'
    ? '要直接反驳或回应前面观点，有争吵感'
    : mode === 'explore'
      ? '先顺着或指出前一位观点中的关键点，再补充你的推理逻辑与证据'
      : '站在初学者角度，把前一位提到的关键概念用大白话再讲一遍，再补充你的看法';
  return `大师吵股。用户问题：${question}。参与大师：${list}。此前内容：${context}。请让 ID 为 ${nextSpeakerId} 的大师作为下一位发言，${replyStyle}。${modeRules(mode)}**发言必须有数据支撑**：用具体数据、估值指标（如 PE/PB/ROE、增速）、历史案例或可比公司等举证，避免只讲空泛观点。**时间要求**：如需引用数据，优先引用上面注入的【最新市场数据快照】中的数字；快照里没有的精确数字用「大约/约/可能」等模糊表述，严禁用记忆中的旧数字冒充最新。只输出一个 JSON，不要其他内容：{"investorId":"${nextSpeakerId}","stance":"BULL或BEAR或NEUTRAL","content":"发言内容120-180字，含数据或案例举证（尽量用2025口径）","keyPoint":"核心观点一句话"}`;
}

export function buildClosingOnlyPrompt(question, hostName, opening, discussionSummary, mode = 'debate') {
  const tone = mode === 'debate'
    ? '风趣毒舌，可总结谁和谁吵得最凶'
    : mode === 'explore'
      ? '沉稳收束，把讨论中的共识与分歧点归纳清楚'
      : '温柔总结，用一句话给新手划重点，并鼓励多学多看';
  return `大师吵股。用户问题：${question}。主持人开场白：${opening}。讨论摘要：${discussionSummary}。请主持人（${hostName}）输出散场总结（80-120字），${tone}。不要 JSON 不要引号，直接输出散场总结文本。`;
}

export function buildVerdictOnlyPrompt(question, opening, discussionText, closing, mode = 'debate') {
  const style = mode === 'debate'
    ? '综合总结约150字'
    : mode === 'explore'
      ? '逻辑归纳约150字，突出共识与仍存疑的问题'
      : '给小白的小结约150字，把关键结论用最通俗的话讲清楚';
  return `大师吵股。用户问题：${question}。开场白：${opening}。讨论：${discussionText}。散场：${closing}。请只输出智囊团裁决的一个 JSON，不要其他内容：{"summary":"${style}","bullCount":数字,"bearCount":数字,"neutralCount":数字,"consensus":"核心共识一句话","mainRisk":"主要风险一句话"}`;
}

export function buildFollowUpPrompt(previousSummary, userFollowUp, investors, mode = 'debate') {
  const list = investors.map(masterProfileLine).join('\n');
  return `继续「大师吵股」同一场讨论。${modeRules(mode)}此前结论摘要：${previousSummary}

用户追问：${userFollowUp}

参与大师（同一批人）：
${list}

请让各位大师针对追问 **轮流发言、互相补充**（每人 60-100 字）${mode === 'debate' ? '，后发言的要引用或直接批驳前面的观点，有火药味' : mode === 'explore' ? '，注重逻辑衔接与相互补充' : '，用大白话把关键概念讲清楚'}。发言时尽量用 **数据、估值指标、历史或可比案例** 举证支撑观点。最后更新裁决。
时间要求：如需引用数据，优先引用上面注入的【最新市场数据快照】；快照里没有的精确数字用「大约/约/可能」等模糊表述，严禁用记忆中的旧数字冒充最新。

只输出一个 JSON：
{"discussion":[{"investorId":"id","stance":"BULL或BEAR或NEUTRAL","content":"发言内容","keyPoint":"一句话"}],"verdict":{"summary":"更新后的综合总结","bullCount":数字,"bearCount":数字,"neutralCount":数字,"consensus":"共识","mainRisk":"风险"}}`;
}

// 点对点深聊：单独一位大师直接回答
export function buildChatPrompt(question, master, mode = 'debate') {
  const profile = masterProfileLine(master);
  return `你是「大师吵股」中的 ${master.name}（${master.title}），正在与用户一对一深聊。\n\n你的画像：\n${profile}\n\n用户问题：${question}\n\n要求：\n1. 以 ${master.name} 的身份直接、完整地回答用户，语气符合你的性格${mode === 'teach' ? '，尽量用大白话，把专业术语讲清楚' : ''}。\n2. 回答要有结构（观点 → 理由 → 证据 → 建议），150-300 字。\n3. 如需引用数据，优先引用注入的【最新市场数据快照】；快照里没有的精确数字用「大约/约/可能」等模糊表述，严禁编造或用旧数据冒充最新。\n4. 只输出回答正文，不要 JSON、不要任何额外标记。`;
}
