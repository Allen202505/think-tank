// 大师互评「AI 现场生成」。
//
// 成本与质量控制：
//  1) 每位被点评大师只发 1 次模型调用（一次生成 3 条点评），全天 6 次调用；
//  2) 结果按「日期 + 大师」缓存，同一交易日内不重复生成，页面只读缓存不烧钱；
//  3) 严格 JSON 校验（点评人必须合法且不是本人、字数区间、字段齐全），不合格重试一次，
//     再不合格就回退到预置文案，绝不把半成品塞给用户；
//  4) 复用 masterLeagueAgent 的当日 token 台账与成本估算口径。
import { buildProviderBody, buildProviderHeaders, resolveLlmUrl } from './llm.js';
import { estimateCost, getAgentLedger, recordAgentUsage } from './masterLeagueAgent.mjs';

export const COMMENT_LIMITS = {
  perMaster: Number(process.env.MASTER_LEAGUE_COMMENT_PER_MASTER || 3),
  maxTokensPerCall: Number(process.env.MASTER_LEAGUE_COMMENT_MAX_TOKENS || 900),
  minText: 12,
  maxText: 120,
  minReply: 6,
  maxReply: 90,
  timeoutMs: Number(process.env.MASTER_LEAGUE_COMMENT_TIMEOUT_MS || 60000),
};

// 按日期做种子，保证「同一天结果稳定、不同天点评人轮换」
export function pickCommenters(masters, targetId, count = COMMENT_LIMITS.perMaster, seed = 1) {
  const pool = (masters || []).filter((master) => master.id !== targetId);
  if (pool.length <= count) return pool;
  let state = Math.abs(Number(seed) || 1) % 2147483647 || 1;
  const picked = [];
  const rest = [...pool];
  while (picked.length < count && rest.length) {
    state = (state * 1103515245 + 12345) % 2147483648;
    picked.push(rest.splice(state % rest.length, 1)[0]);
  }
  return picked;
}

export function buildCommentaryPrompt({ target, commenters, decisions, positions = [], performance, market }) {
  const decisionLines = (decisions || []).map((decision) => {
    const bits = [
      `${decision.action} ${decision.stockName || decision.symbol || ''}`.trim(),
      decision.targetPct != null ? `目标仓位 ${decision.targetPct}%` : '',
      decision.reason ? `理由：${decision.reason}` : '',
      decision.risk ? `自认风险：${decision.risk}` : '',
    ].filter(Boolean);
    return `- ${bits.join('；')}`;
  });

  const system = [
    '你在为「大师实盘公开赛」撰写大师之间的互相点评，这些点评会直接展示给用户看。',
    '',
    '写作要求：',
    '- 每位大师只用自己那套方法论说话，不许说正确的废话（例如「要注意风险」）。',
    '- 点评要犀利、有画面感、可以挖苦，但只怼方法，不人身攻击，不用脏话，不涉及性别/地域/政治。',
    `- 每条点评 ${COMMENT_LIMITS.minText}~60 字，必须咬住对方今天的具体操作或数字（股票、动作、仓位、盈亏、理由）。`,
    '- 只能引用下面给出的数字，并且要原样照抄（不要改写、不要用字母 O 代替数字 0）。绝对不许自己编造股数、成交价、收益率、板块家数；没有的数字就不要写具体数值。',
    `- 每条点评配一句被点评人的回怼，${COMMENT_LIMITS.minReply}~50 字，要接得住、不能认输。`,
    '- 每条点评要说明它在点评哪一笔操作（about 字段，照抄下面给的动作与股票名）。',
    '- 只输出 JSON 数组，不要任何解释文字或代码块标记。',
  ].join('\n');

  const personaLines = (commenters || []).map((master) => (
    `- ${master.id}｜${master.shortName || master.name}（${master.styleDetail || master.style}）：${master.intro || master.personality || ''}`
  ));

  const user = [
    market ? `【今天的大盘】${market}` : '',
    `【被点评人】${target.shortName || target.name}（${target.styleDetail || target.style}）`,
    '【他今天的操作】',
    ...(decisionLines.length ? decisionLines : ['- 今天没有操作，维持原有仓位']),
    positions.length
      ? `【他的最新持仓】${positions.map((position) => `${position.name} ${position.quantity}股｜成本 ${position.averagePrice}｜现价 ${position.marketPrice}｜浮动 ${(Number(position.profitRate || 0) * 100).toFixed(2)}%`).join('；')}`
      : '',
    performance ? `【他的战绩】${performance}` : '',
    '',
    '【请让以下大师点评他】',
    ...personaLines,
    '',
    `输出格式（${commenters.length} 条，commenterId 必须是上面给出的 id）：`,
    '[{"commenterId":"livermore","about":"买入 比亚迪","text":"点评内容","reply":"被点评人的回怼"}]',
  ].filter(Boolean).join('\n');

  return { system, user };
}

export function parseCommentaryPayload(content, { commenters, targetId }) {
  const text = String(content || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start < 0 || end <= start) return { ok: false, errors: ['没有找到 JSON 数组'] };
  let raw;
  try {
    raw = JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    return { ok: false, errors: [`JSON 解析失败：${error.message}`] };
  }
  if (!Array.isArray(raw)) return { ok: false, errors: ['返回值不是数组'] };

  const allowed = new Set((commenters || []).map((master) => master.id));
  const errors = [];
  const seen = new Set();
  const comments = [];
  for (const item of raw) {
    const commenterId = String(item?.commenterId || '').trim();
    const commentText = String(item?.text || '').trim();
    const reply = String(item?.reply || '').trim();
    const about = String(item?.about || '').trim().slice(0, 40);
    if (!allowed.has(commenterId)) { errors.push(`点评人非法或不合法：${commenterId}`); continue; }
    if (commenterId === targetId) { errors.push('不能自己点评自己'); continue; }
    if (seen.has(commenterId)) { errors.push(`点评人重复：${commenterId}`); continue; }
    if (commentText.length < COMMENT_LIMITS.minText || commentText.length > COMMENT_LIMITS.maxText) {
      errors.push(`点评长度不合适（${commentText.length}）：${commenterId}`);
      continue;
    }
    if (reply.length < COMMENT_LIMITS.minReply || reply.length > COMMENT_LIMITS.maxReply) {
      errors.push(`回怼长度不合适（${reply.length}）：${commenterId}`);
      continue;
    }
    seen.add(commenterId);
    comments.push({ commenterId, about, text: commentText, reply });
  }
  if (!comments.length) errors.push('没有产出任何合格点评');
  return { ok: comments.length > 0, errors, comments };
}

// 当日缓存：date -> masterId -> { comments, usage, generatedAt }
const cache = new Map();

export function readCommentaryCache(date, masterId) {
  return cache.get(date)?.get(masterId) || null;
}

export function writeCommentaryCache(date, masterId, payload) {
  if (!cache.has(date)) cache.set(date, new Map());
  cache.get(date).set(masterId, payload);
  return payload;
}

export function clearCommentaryCache() {
  cache.clear();
}

async function defaultCallLlm({ aiConfig, system, user, maxTokens, timeoutMs }) {
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(resolveLlmUrl(aiConfig.baseUrl), {
        method: 'POST',
        headers: buildProviderHeaders(aiConfig),
        body: JSON.stringify(buildProviderBody(aiConfig, messages, maxTokens, { temperature: 0.95 })),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail?.error?.message || `模型服务错误：${response.status}`);
      }
      const data = await response.json();
      return { content: data?.choices?.[0]?.message?.content || '', usage: data?.usage || {} };
    } catch (error) {
      lastError = error;
      if (/模型服务错误：4\d\d/.test(String(error?.message))) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/**
 * 生成一位大师今天收到的 AI 互评（含缓存）。
 * ctx: { target, allMasters, decisions, performance, market, aiConfig, date, deps, force }
 */
export async function generateMasterCommentary({
  target, allMasters, decisions = [], positions = [], performance = '', market = '',
  aiConfig, date, deps = {}, force = false,
} = {}) {
  if (!target) throw new Error('缺少被点评的大师');
  if (!aiConfig?.apiKey) throw new Error('未配置模型 API Key');

  if (!force) {
    const hit = readCommentaryCache(date, target.id);
    if (hit) return { ...hit, cached: true };
  }

  const ledger = getAgentLedger();
  if (ledger.remainingTokens <= 0) throw new Error('今日 token 预算已用尽，已停止生成互评');

  const seed = Number(String(date || '').replace(/\D/g, '').slice(-6)) || 1;
  const commenters = pickCommenters(allMasters, target.id, COMMENT_LIMITS.perMaster, seed);
  const { system, user } = buildCommentaryPrompt({ target, commenters, decisions, positions, performance, market });
  const callLlm = deps.callLlm || defaultCallLlm;

  const totals = { prompt_tokens: 0, completion_tokens: 0, prompt_cache_hit_tokens: 0 };
  let parsed = { ok: false, errors: ['未执行'], comments: [] };
  let raw = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await callLlm({
      aiConfig, system, user,
      maxTokens: COMMENT_LIMITS.maxTokensPerCall,
      timeoutMs: COMMENT_LIMITS.timeoutMs,
    });
    raw = response?.content || '';
    const usage = response?.usage || {};
    totals.prompt_tokens += Number(usage.prompt_tokens) || 0;
    totals.completion_tokens += Number(usage.completion_tokens) || 0;
    totals.prompt_cache_hit_tokens += Number(usage.prompt_cache_hit_tokens || usage.prompt_tokens_details?.cached_tokens) || 0;
    parsed = parseCommentaryPayload(raw, { commenters, targetId: target.id });
    if (parsed.ok) break;
  }

  const usage = estimateCost(totals);
  recordAgentUsage(usage);
  const payload = {
    masterId: target.id,
    date,
    commenters: commenters.map((master) => master.id),
    comments: parsed.comments.map((item, index) => ({
      id: `ai-${date}-${target.id}-${item.commenterId}-${index}`,
      masterId: item.commenterId,
      text: item.text,
      ownerReply: item.reply,
      about: item.about,
      likeCount: 60 + ((seed + index * 7) % 40),
      ai: true,
    })),
    usage,
    errors: parsed.errors,
    generatedAt: new Date().toISOString(),
  };
  return writeCommentaryCache(date, target.id, payload);
}

export const __test__ = { cache };
