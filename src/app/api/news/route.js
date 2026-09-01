// src/app/api/news/route.js
// 巴菲特的早餐 · 实时新闻列表
// GET /api/news?page=1
// 数据源与过滤逻辑见 src/lib/newsSource.js（财联社 + 东方财富 7x24）
import { getClientIp, rateLimit, limitResponse } from '../../../lib/rateLimit';
import { fetchNewsList } from '../../../lib/newsSource';
import { withCors, corsPreflight } from '../../../lib/cors';

export async function GET(request) {
  if (request.method === 'OPTIONS') return corsPreflight();
  const _rl = rateLimit('news:' + getClientIp(request), { limit: 120, windowMs: 60000 });
  if (!_rl.ok) return withCors(await limitResponse(_rl.retryAfter).json(), { status: 429 });

  try {
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get('page') || 1) || 1);

    const { items, hasMore, source } = await fetchNewsList(page);
    if (!items.length) {
      // 两源都失败：前端回退示例
      return withCors({ ok: true, items: [], hasMore: false, source: 'empty' });
    }
    return withCors({ ok: true, items, hasMore, source });
  } catch (e) {
    return withCors({ ok: false, error: e.message || '获取新闻失败' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return corsPreflight();
}
