import history from '../../../data/marketBreadthHistory.json';
import { computeMarketBreadthStats } from '../../../lib/marketBreadth.mjs';
import { getClientIp, limitResponse, rateLimit } from '../../../lib/rateLimit';

export const runtime = 'nodejs';

export async function POST(request) {
  const rl = rateLimit(`market-breadth:${getClientIp(request)}`, { limit: 60, windowMs: 60000 });
  if (!rl.ok) return limitResponse(rl.retryAfter);
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: '请求参数格式错误' }, { status: 400 }); }
  try {
    const result = computeMarketBreadthStats(history, {
      range: body?.range || '1y',
      startDate: body?.startDate || '',
      endDate: body?.endDate || '',
    });
    return Response.json({ ok: true, ...result }, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    const message = String(error?.message || '');
    if (/日期|区间|开始|结束/.test(message)) return Response.json({ error: message }, { status: 400 });
    return Response.json({ error: '涨跌家数数据暂不可用' }, { status: 503 });
  }
}
