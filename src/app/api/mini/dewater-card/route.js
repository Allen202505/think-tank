import { buildIndexDewaterReport } from '../../../../lib/indexDewater.mjs';
import { buildMiniDewaterCard } from '../../../../lib/miniResearch.js';
import { getClientIp, limitResponse, rateLimit } from '../../../../lib/rateLimit.js';
import { authorizeMiniRequest, miniError } from '../../../../lib/miniProgramApi.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CARD_PARAMS = {
  range: '1y',
  industries: ['bank'],
  stocks: [],
};
const CARD_TTL_MS = 5 * 60 * 1000;
const cardCache = new Map();
const cardInflight = new Map();

function cacheKey(params) {
  return [
    params.range,
    [...(params.industries || [])].sort().join(','),
    [...(params.stocks || [])].sort().join(','),
  ].join('|');
}

async function getDewaterCard(params) {
  const key = cacheKey(params);
  const cached = cardCache.get(key);
  if (cached && Date.now() - cached.at < CARD_TTL_MS) return cached.card;
  if (cardInflight.has(key)) return cardInflight.get(key);

  const task = buildIndexDewaterReport({ ...params, force: false })
    .then((report) => {
      const card = buildMiniDewaterCard(report);
      if (!card) throw new Error('dewater card output unavailable');
      cardCache.set(key, { at: Date.now(), card });
      return card;
    })
    .finally(() => cardInflight.delete(key));

  cardInflight.set(key, task);
  return task;
}

export async function POST(request) {
  const authorized = await authorizeMiniRequest(request, 'dewater-card');
  if (!authorized.ok) return miniError(authorized.error, authorized.status);

  const identity = authorized.auth.identity || `ip:${getClientIp(request)}`;
  const rapid = rateLimit(`mini-dewater-card:${identity}`, { limit: 24, windowMs: 60_000 });
  if (!rapid.ok) return limitResponse(rapid.retryAfter);

  try {
    const card = await getDewaterCard(CARD_PARAMS);
    return Response.json(
      { ok: true, data: card, disclaimer: '数据为公开行情复刻口径，仅用于研究，不构成投资建议。' },
      {
        headers: {
          'Cache-Control': 'private, max-age=300, stale-while-revalidate=60',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  } catch (error) {
    const message = String(error?.message || '');
    if (/abort|timeout|fetch|network|HTTP|行情|样本列表/i.test(message)) {
      return miniError('行情数据源暂时不可用，请稍后重试', 503);
    }
    return miniError('上证指数脱水数据暂时不可用，请稍后重试', 500);
  }
}
