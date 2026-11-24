import { getClientIp, limitResponse, rateLimit } from '../../../../lib/rateLimit.js';
import { buildMiniSessionToken } from '../../../../lib/miniProgramPolicy.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const rapid = rateLimit(`mini-session:${getClientIp(request)}`, { limit: 20, windowMs: 60_000 });
  if (!rapid.ok) return limitResponse(rapid.retryAfter);

  let body = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: '请求参数格式错误' }, { status: 400 });
  }

  const code = String(body?.code || '').trim();
  if (!code || code.length > 512) {
    return Response.json({ ok: false, error: '微信登录 code 无效' }, { status: 400 });
  }

  const appid = String(process.env.MINI_APPID || process.env.FITRY_APPID || '').trim();
  const appSecret = String(process.env.MINI_APPSECRET || process.env.FITRY_APPSECRET || '').trim();
  const signingSecret = String(process.env.MINI_PROXY_SECRET || '').trim();
  if (!appid || !appSecret || signingSecret.length < 16) {
    return Response.json({ ok: false, error: '小程序登录服务尚未配置' }, { status: 503 });
  }

  try {
    const params = new URLSearchParams({
      appid,
      secret: appSecret,
      js_code: code,
      grant_type: 'authorization_code',
    });
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${params.toString()}`, {
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    const openid = String(data?.openid || '').trim();
    if (!openid) {
      return Response.json({ ok: false, error: '微信登录凭证已失效，请重试' }, { status: 401 });
    }
    const session = buildMiniSessionToken(openid, signingSecret, 2 * 60 * 60 * 1000);
    return Response.json(
      { ok: true, ...session },
      { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
    );
  } catch (error) {
    return Response.json({ ok: false, error: '微信登录服务暂时不可用，请稍后重试' }, { status: 503 });
  }
}
