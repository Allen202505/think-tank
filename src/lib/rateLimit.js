// src/lib/rateLimit.js —— 简单进程内限流（按 IP + 路由）
// 说明：Vercel 无服务器环境为多实例，进程内计数仅作基线防护；
// 生产可叠加 Cloudflare 频率限制 / Upstash Redis 计数器以获得全局一致限制。
const buckets = new Map();

export function getClientIp(request) {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'local';
}

// key: 例如 'chat:1.2.3.4'；limit: 窗口内最大请求数；windowMs: 窗口毫秒
export function rateLimit(key, { limit = 30, windowMs = 60000 } = {}) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000), limit };
  }
  return { ok: true };
}

export function limitResponse(retryAfter) {
  return Response.json(
    { error: '请求过于频繁，请稍后再试' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  );
}
