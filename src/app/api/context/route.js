// src/app/api/context/route.js
// 信息层梳理：给定用户问题，返回最新市场数据快照 + 提示信息
// 前端在发起辩论前调用一次，之后把 snapshot 随每条请求带给 /api/chat
import { getQuoteContextInfo } from '../chat/quoteContext.js';
import { getClientIp, rateLimit, limitResponse } from '../../../lib/rateLimit';

export async function POST(request) {
  try {
  const _rl = rateLimit('context:' + getClientIp(request), { limit: 90, windowMs: 60000 });
  if (!_rl.ok) return limitResponse(_rl.retryAfter);

    const body = await request.json();
    const query = typeof body?.query === 'string' ? body.query : '';
    const info = await getQuoteContextInfo(query);
    return Response.json(info);
  } catch (e) {
    return Response.json({ snapshot: '', notice: '' });
  }
}
