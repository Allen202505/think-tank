import { searchStockSuggestions } from '../chat/marketData';
import { getClientIp, rateLimit, limitResponse } from '../../../lib/rateLimit';

export async function GET(request) {
  const rl = rateLimit(`stock-search:${getClientIp(request)}`, { limit: 60, windowMs: 60000 });
  if (!rl.ok) return limitResponse(rl.retryAfter);

  const q = String(new URL(request.url).searchParams.get('q') || '').trim();
  if (!q) return Response.json({ ok: true, results: [] });
  if (q.length > 30) return Response.json({ error: '搜索词过长' }, { status: 400 });

  try {
    const results = await searchStockSuggestions(q, 8);
    return Response.json({ ok: true, results });
  } catch (e) {
    return Response.json({ error: '股票搜索暂时不可用，请稍后重试' }, { status: 502 });
  }
}
