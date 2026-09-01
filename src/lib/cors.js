// src/lib/cors.js —— 给公开读接口加 CORS，供桌面组件/第三方页面直连
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export function withCors(json, init = {}) {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return Response.json(json, { ...init, headers });
}

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
