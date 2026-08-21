// src/app/api/pool-news/route.js
// 巴菲特的早餐 · 我的股票池新闻
// POST { watchlist: [code/name | {symbol,name}] } → 返回命中自选股的新闻列表（按时间倒序）
// 只返回与自选股/关注股相关的新闻；无自选池或当天无命中 → items: []（前端展示空态）
import { getClientIp, rateLimit, limitResponse } from '../../../lib/rateLimit';
import { fetchPoolNews } from '../../../lib/poolNews';
import { withTimeout } from '../chat/marketData.js';

export async function POST(request) {
  const _rl = rateLimit('poolnews:' + getClientIp(request), { limit: 40, windowMs: 60000 });
  if (!_rl.ok) return limitResponse(_rl.retryAfter);

  try {
    const body = await request.json().catch(() => ({}));
    const watchlist = Array.isArray(body.watchlist) ? body.watchlist : [];
    const { items, resolved, total } = await withTimeout(fetchPoolNews(watchlist), 15000).catch(() => ({ items: [], resolved: [], total: 0 }));

    // 精简返回：只带前端需要字段 + 命中的自选股名
    const slim = items.map((n) => ({
      id: n.id,
      title: n.title,
      summary: n.summary,
      time: n.time,
      ts: n.ts,
      source: n.source,
      related: (n.related || []).map((w) => ({ name: w.name || w.symbol, symbol: w.symbol })),
    }));

    return Response.json({
      ok: true,
      items: slim,
      resolvedWatchlist: resolved.map((w) => ({ name: w.name || w.symbol, symbol: w.symbol })),
      total,
      matchedCount: slim.length,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e.message || '获取股票池新闻失败' }, { status: 500 });
  }
}
