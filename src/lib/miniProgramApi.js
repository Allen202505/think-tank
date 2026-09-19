import { verifyMiniProxyRequest } from './miniProgramPolicy.js';

export async function authorizeMiniRequest(request, action) {
  let rawBody = '';
  try {
    rawBody = await request.text();
  } catch {
    return { ok: false, status: 400, error: '无法读取小程序请求' };
  }

  const auth = verifyMiniProxyRequest(request, rawBody, action);
  if (!auth.ok) return auth;

  let body = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return { ok: false, status: 400, error: '小程序请求格式错误' };
  }

  return { ok: true, body, auth };
}

export function miniJson(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function miniError(error, status = 500) {
  return miniJson({ ok: false, error: error || '服务暂时不可用，请稍后重试' }, status);
}

export function friendlyMiniAiError(error) {
  const message = String(error?.message || '');
  if (/未配置 API Key/.test(message)) return 'AI 服务尚未配置';
  if (/401|403|API Key/.test(message)) return 'AI 服务配置无效';
  if (/fetch|network|ECONN|ENOTFOUND|ETIMEDOUT|abort/i.test(message)) return '网络繁忙，请稍后重试';
  return '生成失败，请稍后重试';
}

export function getMiniDailyLimit() {
  const value = Number(process.env.MINI_DAILY_FREE_LIMIT || 8);
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 8;
}
