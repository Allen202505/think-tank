import { getClientIp, limitResponse, rateLimit } from '../../../lib/rateLimit';
import { buildIndexDewaterReport, DEFAULT_INDUSTRIES, DEFAULT_RANGE } from '../../../lib/indexDewater.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  const rl = rateLimit(`index-dewater:${getClientIp(request)}`, { limit: 30, windowMs: 60000 });
  if (!rl.ok) return limitResponse(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '请求参数格式错误' }, { status: 400 });
  }

  const range = String(body?.range || DEFAULT_RANGE);
  const industries = Array.isArray(body?.industries) ? body.industries.map(String).slice(0, 80) : DEFAULT_INDUSTRIES;
  const stocks = Array.isArray(body?.stocks) ? body.stocks.slice(0, 500) : [];

  try {
    const report = await buildIndexDewaterReport({
      range,
      startDate: String(body?.startDate || ''),
      endDate: String(body?.endDate || ''),
      industries,
      stocks,
      force: Boolean(body?.force),
    });
    return Response.json(report, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Data-Mode': 'index-dewater-replica-v1',
      },
    });
  } catch (error) {
    const message = String(error?.message || '');
    if (/参数|日期|最多|开始|结束|至少|区间/.test(message)) {
      return Response.json({ error: message }, { status: 400 });
    }
    if (/abort|timeout|fetch|network|HTTP|行情|样本列表/i.test(message)) {
      return Response.json({ error: '行情数据源暂时不可用，请稍后重试' }, { status: 503 });
    }
    return Response.json({ error: '上证指数脱水计算失败，请稍后重试' }, { status: 500 });
  }
}
