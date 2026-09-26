import { createShareResult } from '../../../lib/shareResultsDb';
import { getClientIp, limitResponse, rateLimit } from '../../../lib/rateLimit';

export const runtime = 'nodejs';

export async function POST(request) {
  const ip = getClientIp(request);
  const limited = rateLimit(`share-results:${ip}`, { limit: 30, windowMs: 60 * 60 * 1000 });
  if (!limited.ok) return limitResponse(limited.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '请求格式错误' }, { status: 400 });
  }

  const created = await createShareResult({
    kind: body?.kind,
    title: body?.title,
    payload: body?.payload,
  });

  if (!created.ok) {
    const status = created.code === 'not_configured' || created.code === 'db_not_ready'
      ? 503
      : created.code === 'db_error' ? 500 : 400;
    return Response.json({ error: created.error || '分享链接生成失败', code: created.code }, { status });
  }

  return Response.json({
    ok: true,
    id: created.value.id,
    path: `/share/${created.value.id}`,
  });
}
