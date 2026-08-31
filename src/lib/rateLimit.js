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


// ─── 免费体验兜底：按 IP 每日免费调用总量 ─────────────────────────────
// 前端 localStorage/cookie 配额在无痕/隐私模式下可被清空绕过，这里按 IP 给
// 「未配置用户 Key 的请求」一个每日总量上限作为兜底。
// 说明：Vercel 多实例为尽力而为（每实例独立计数），自建单实例下精确。
const dailyFree = new Map(); // ip -> { date, count }

// aiConfig 为空（未带用户 Key）→ 免费调用，计入每日配额；带 Key 不占用。
export function guardFreeDaily(request, aiConfig, { limit = 40 } = {}) {
  const hasKey = aiConfig && typeof aiConfig === 'object' && String(aiConfig.apiKey || '').trim();
  if (hasKey) return { ok: true, free: false };
  const ip = getClientIp(request);
  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const resetAt = new Date(now);
  resetAt.setHours(24, 0, 0, 0);
  const b = dailyFree.get(ip);
  if (!b || b.date !== today) {
    dailyFree.set(ip, { date: today, count: 1 });
    return { ok: true, free: true };
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((resetAt.getTime() - now) / 1000)), free: true, limit };
  }
  return { ok: true, free: true };
}

export function quotaResponse(retryAfter) {
  return Response.json(
    { error: '今日免费体验次数已达上限，请配置自己的 API Key 后继续使用，或明天再来' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  );
}

export function limitResponse(retryAfter) {
  return Response.json(
    { error: '请求过于频繁，请稍后再试' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  );
}
