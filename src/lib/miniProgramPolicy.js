import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const MINI_DISCLAIMER =
  '本内容仅用于财经通识学习，不构成投资建议、收益承诺或交易依据。请独立判断并注意风险。';

export const MINI_PERSPECTIVES = [
  {
    id: 'value',
    label: '价值视角',
    subtitle: '企业、现金流与安全边际',
    prompt: '从商业模式、自由现金流、竞争优势和安全边际出发解释概念，不评价任何具体证券。',
  },
  {
    id: 'contrarian',
    label: '逆向视角',
    subtitle: '反过来想，先看风险',
    prompt: '优先指出常见误判、反例、失败路径和风险清单，不使用绝对化判断。',
  },
  {
    id: 'growth',
    label: '成长视角',
    subtitle: '增长质量与持续性',
    prompt: '从增长来源、单位经济模型、竞争格局和持续性出发解释概念，不做收益预测。',
  },
  {
    id: 'macro',
    label: '宏观视角',
    subtitle: '利率、周期与流动性',
    prompt: '从利率、通胀、经济周期、政策和流动性传导出发解释可能影响，强调不确定性。',
  },
  {
    id: 'risk',
    label: '风险视角',
    subtitle: '边界、概率与反脆弱',
    prompt: '从概率、最大损失、相关性、流动性和行为偏差出发拆解风险，不给出买卖结论。',
  },
];

const MAX_QUESTION_LENGTH = 360;
const MAX_READING_LENGTH = 6000;
const MAX_CONTEXT_LENGTH = 4000;
const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;
const usedNonces = new Map();

const REQUEST_BLOCK_RULES = [
  {
    pattern: /(?:^|[^\d])(?:[0368]\d{5}|(?:sh|sz|bj)\d{6})(?:[^\d]|$)/i,
    reason: '请勿输入股票代码；个人提审版仅支持财经通识话题。',
  },
  {
    pattern: /(推荐|建议|帮我选|该不该买|能不能买|要不要卖|买哪|卖哪|目标价|止损位|止盈位|加仓|减仓|抄底|逃顶|梭哈|满仓|荐股)/,
    reason: '请改为财经概念、现象或风险框架类问题；本工具不提供荐买荐卖或交易指令。',
  },
  {
    pattern: /(明天|下周|下月|今年).{0,8}(涨|跌|翻倍)|(?:能|会).{0,4}(涨到|跌到).{0,8}\d/i,
    reason: '本工具不做价格和收益预测，请改为学习相关概念或分析方法。',
  },
];

const OUTPUT_BLOCK_RULES = [
  /(?:建议|应当|可以考虑|不妨).{0,6}(?:买入|卖出|加仓|减仓|持有|清仓)/,
  /(?:买入|卖出|加仓|减仓|持有|清仓).{0,6}(?:该股|这只|股票|标的|代码)/,
  /(?:目标价|止损位|止盈位|保证收益|稳赚|必涨|必跌|翻倍收益)/,
  /(?:预计|预测).{0,8}(?:上涨|下跌|涨幅|跌幅|收益率).{0,8}\d/,
  /(?:建议|推荐).{0,4}(?:买入|卖出|持有)/,
];

function cleanText(value, maxLength) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function matchesAny(text, rules) {
  return rules.some((rule) => (rule instanceof RegExp ? rule.test(text) : rule.pattern.test(text)));
}

function matchedRequestRule(text) {
  return REQUEST_BLOCK_RULES.find((rule) => rule.pattern.test(text)) || null;
}

export function validateMiniQuestion(value, { maxLength = MAX_QUESTION_LENGTH } = {}) {
  const text = cleanText(value, maxLength + 1);
  if (!text) return { ok: false, reason: '请输入一个财经通识问题。' };
  if (text.length > maxLength) return { ok: false, reason: `问题请控制在 ${maxLength} 字以内。` };
  const matched = matchedRequestRule(text);
  if (matched) return { ok: false, reason: matched.reason };
  return { ok: true, text };
}

export function validateMiniReading(value) {
  const text = cleanText(value, MAX_READING_LENGTH + 1);
  if (!text) return { ok: false, reason: '请粘贴一段公开财经资讯或概念说明。' };
  if (text.length < 20) return { ok: false, reason: '内容太短，请补充到 20 字以上。' };
  if (text.length > MAX_READING_LENGTH) return { ok: false, reason: `内容请控制在 ${MAX_READING_LENGTH} 字以内。` };
  const matched = matchedRequestRule(text);
  if (matched) {
    return { ok: false, reason: '这段内容包含交易指令或收益预测，请改用宏观、行业或概念类材料。' };
  }
  return { ok: true, text };
}

export function validateMiniContext(value) {
  const text = cleanText(value, MAX_CONTEXT_LENGTH + 1);
  if (text.length > MAX_CONTEXT_LENGTH) return { ok: true, text: text.slice(0, MAX_CONTEXT_LENGTH) };
  const matched = matchedRequestRule(text);
  if (matched) return { ok: false, reason: matched.reason };
  return { ok: true, text };
}

export function pickMiniPerspectives(ids, { min = 2, max = 4 } = {}) {
  const allowed = new Set(MINI_PERSPECTIVES.map((item) => item.id));
  const picked = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (allowed.has(id) && !picked.includes(id)) picked.push(id);
  }
  if (picked.length < min) {
    for (const item of MINI_PERSPECTIVES) {
      if (!picked.includes(item.id)) picked.push(item.id);
      if (picked.length >= min) break;
    }
  }
  return picked.slice(0, max);
}

export function inspectMiniOutput(value) {
  const text = cleanText(value, 12000);
  if (!text) return { ok: false, reason: '模型未返回有效内容。' };
  if (matchesAny(text, OUTPUT_BLOCK_RULES)) {
    return { ok: false, reason: '输出触及投资建议边界，已阻止展示。' };
  }
  return { ok: true, text };
}

export function stripJsonFence(value) {
  return String(value || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

export function parseJsonObject(value) {
  const text = stripJsonFence(value);
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

export function buildMiniProxySignature({ action, timestamp, nonce, openid, rawBody, secret }) {
  return createHmac('sha256', String(secret || ''))
    .update([action, timestamp, nonce, openid, rawBody].map((item) => String(item ?? '')).join('\n'))
    .digest('hex');
}

export function hashOpenId(openid) {
  return createHash('sha256').update(String(openid || '')).digest('hex');
}

function safeEqualHex(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

export function verifyMiniProxyRequest(request, rawBody, action) {
  const secret = process.env.MINI_PROXY_SECRET || '';
  if (!secret || secret.length < 16) {
    return { ok: false, status: 503, error: '小程序代理签名密钥未配置或过短' };
  }

  const timestamp = request.headers.get('x-mini-timestamp') || '';
  const nonce = request.headers.get('x-mini-nonce') || '';
  const openid = request.headers.get('x-mini-openid') || '';
  const signature = request.headers.get('x-mini-signature') || '';
  const ts = Number(timestamp);

  if (!timestamp || !nonce || !openid || !signature) {
    return { ok: false, status: 401, error: '小程序请求签名缺失' };
  }
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > SIGNATURE_WINDOW_MS) {
    return { ok: false, status: 401, error: '小程序请求已过期' };
  }

  const expected = buildMiniProxySignature({ action, timestamp, nonce, openid, rawBody, secret });
  if (!safeEqualHex(signature, expected)) {
    return { ok: false, status: 401, error: '小程序请求签名无效' };
  }

  const now = Date.now();
  for (const [key, expiresAt] of usedNonces) {
    if (expiresAt <= now) usedNonces.delete(key);
  }
  const nonceKey = `${openid}:${nonce}`;
  if (usedNonces.has(nonceKey)) return { ok: false, status: 409, error: '重复的小程序请求' };
  usedNonces.set(nonceKey, now + SIGNATURE_WINDOW_MS);

  return { ok: true, identity: hashOpenId(openid) };
}

export function buildMiniDebateMessages(question, perspectiveIds) {
  const selected = pickMiniPerspectives(perspectiveIds);
  const perspectives = selected
    .map((id) => MINI_PERSPECTIVES.find((item) => item.id === id))
    .filter(Boolean)
    .map((item) => `- ${item.label}：${item.prompt}`)
    .join('\n');

  return [
    {
      role: 'system',
      content:
        '你是财经通识教育应用的内容编辑。你的任务是帮助普通读者理解财经概念、商业现象和不同分析框架，' +
        '不是提供证券、期货投资咨询。禁止荐买荐卖，禁止给出目标价、仓位建议、止损止盈位、收益预测，' +
        '禁止评价任何具体证券是否值得交易。只输出 JSON，不要 Markdown 代码块。',
    },
    {
      role: 'user',
      content:
        `学习主题：${question}\n\n请选择以下视角进行解释：\n${perspectives}\n\n` +
        '输出结构：{"title":"12字内标题","summary":"一句话说明这个问题为什么重要",' +
        '"sections":[{"id":"视角id","heading":"视角名称","content":"120-220字解释，包含一个反例或边界","question":"留给读者继续思考的问题"}],' +
        '"takeaway":"不超过60字的学习提示","keywords":["关键词1","关键词2","关键词3"]}。' +
        '全文使用中性、克制的中文；如果问题涉及具体公司或行业，只讨论通用分析维度，不给出交易结论。',
    },
  ];
}

export function buildMiniReadingMessages(text) {
  return [
    {
      role: 'system',
      content:
        '你是财经通识教育应用的内容编辑。你只做公开资讯摘要、概念解释和影响维度梳理，' +
        '不提供证券期货投资咨询，不荐买荐卖，不预测价格或收益，不给交易动作。只输出 JSON，不要 Markdown 代码块。',
    },
    {
      role: 'user',
      content:
        `请阅读以下材料，并为普通读者整理一张学习卡片。\n\n材料：\n${text}\n\n` +
        '输出结构：{"title":"12字内标题","summary":"80字内摘要","points":[{"label":"发生了什么","content":"80字内"}] ,' +
        '"concepts":[{"term":"概念名","explanation":"80字内通俗解释"}],"uncertainties":["仍需核实或持续观察的点"],' +
        '"takeaway":"不超过60字的学习提示"}。points 固定包含“发生了什么、为什么重要、可能影响、不同解读”四部分；' +
        '不要推断具体交易方向，不夸大数据，不把可能性写成确定性。',
    },
  ];
}

export function normalizeDebateResult(raw, perspectiveIds) {
  const parsed = parseJsonObject(raw);
  const selected = pickMiniPerspectives(perspectiveIds);
  const fallbackSections = selected.map((id) => {
    const item = MINI_PERSPECTIVES.find((entry) => entry.id === id);
    return {
      id,
      heading: item?.label || '观察视角',
      content: '当前内容未通过结构校验，请稍后重试。',
      question: '这个概念在真实场景中的边界是什么？',
    };
  });
  const candidate = parsed || {
    title: '财经圆桌',
    summary: '从一个问题出发，比较不同分析框架。',
    sections: fallbackSections,
    takeaway: '先理解假设和边界，再判断结论是否可靠。',
    keywords: [],
  };
  const sections = Array.isArray(candidate.sections)
    ? candidate.sections
        .map((section, index) => ({
          id: selected.includes(section?.id) ? section.id : selected[index] || selected[0],
          heading: cleanText(section?.heading, 30),
          content: cleanText(section?.content, 800),
          question: cleanText(section?.question, 120),
        }))
        .filter((section) => section.heading && section.content)
    : [];
  if (!sections.length) sections.push(...fallbackSections);

  const result = {
    title: cleanText(candidate.title, 30) || '财经圆桌',
    summary: cleanText(candidate.summary, 180),
    sections,
    takeaway: cleanText(candidate.takeaway, 120) || '先理解假设和边界，再判断结论是否可靠。',
    keywords: Array.isArray(candidate.keywords)
      ? candidate.keywords.map((item) => cleanText(item, 20)).filter(Boolean).slice(0, 6)
      : [],
  };
  const inspected = inspectMiniOutput(JSON.stringify(result));
  return inspected.ok ? result : null;
}

export function normalizeReadingResult(raw) {
  const parsed = parseJsonObject(raw) || {};
  const points = Array.isArray(parsed.points)
    ? parsed.points
        .map((point) => ({ label: cleanText(point?.label, 30), content: cleanText(point?.content, 500) }))
        .filter((point) => point.label && point.content)
    : [];
  const concepts = Array.isArray(parsed.concepts)
    ? parsed.concepts
        .map((item) => ({ term: cleanText(item?.term, 30), explanation: cleanText(item?.explanation, 500) }))
        .filter((item) => item.term && item.explanation)
    : [];
  const uncertainties = Array.isArray(parsed.uncertainties)
    ? parsed.uncertainties.map((item) => cleanText(item, 180)).filter(Boolean).slice(0, 5)
    : [];
  const result = {
    title: cleanText(parsed.title, 30) || '财经学习卡片',
    summary: cleanText(parsed.summary, 240),
    points,
    concepts,
    uncertainties,
    takeaway: cleanText(parsed.takeaway, 120) || '区分事实、解释与判断，是阅读财经信息的第一步。',
  };
  if (!result.summary && !result.points.length && !result.concepts.length) return null;
  const inspected = inspectMiniOutput(JSON.stringify(result));
  return inspected.ok ? result : null;
}
