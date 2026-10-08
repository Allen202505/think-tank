import { buildSupabaseUpstreamUrl } from '../../../../lib/supabaseProxy.mjs';
import { getClientIp, rateLimit, limitResponse } from '../../../../lib/rateLimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const REQUEST_SKIP_HEADERS = new Set([
  'host', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding', 'upgrade', 'te', 'trailer',
]);
const RESPONSE_SKIP_HEADERS = new Set([
  'connection', 'content-length', 'content-encoding', 'transfer-encoding', 'keep-alive',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'upgrade',
]);

async function proxy(request, { params }) {
  const limited = rateLimit(`supabase-proxy:${getClientIp(request)}`, { limit: 600, windowMs: 60000 });
  if (!limited.ok) return limitResponse(limited.retryAfter);
  if (!METHODS.has(request.method)) {
    return Response.json({ error: '不支持的请求方法' }, { status: 405 });
  }

  try {
    const requestUrl = new URL(request.url);
    const resolvedParams = await params;
    const upstreamUrl = buildSupabaseUpstreamUrl(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      resolvedParams?.path || [],
      requestUrl.search,
    );

    const headers = new Headers(request.headers);
    for (const name of REQUEST_SKIP_HEADERS) headers.delete(name);
    headers.set('Accept-Encoding', 'identity');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
        redirect: 'manual',
        cache: 'no-store',
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const responseHeaders = new Headers();
    upstream.headers.forEach((value, name) => {
      if (!RESPONSE_SKIP_HEADERS.has(name.toLowerCase()) && name.toLowerCase() !== 'set-cookie') {
        responseHeaders.set(name, value);
      }
    });
    const setCookies = upstream.headers.getSetCookie?.() || [];
    if (setCookies.length) {
      for (const cookie of setCookies) responseHeaders.append('set-cookie', cookie);
    } else {
      const cookie = upstream.headers.get('set-cookie');
      if (cookie) responseHeaders.append('set-cookie', cookie);
    }

    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (e) {
    return Response.json({ error: '认证服务暂时不可用，请稍后重试' }, { status: 503 });
  }
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
