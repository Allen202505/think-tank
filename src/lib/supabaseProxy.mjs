const SAFE_SEGMENT = /^[A-Za-z0-9._~-]+$/;

export function buildSupabaseUpstreamUrl(baseUrl, segments, search = '') {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error('Supabase URL 未配置');
  if (!Array.isArray(segments) || !segments.length) throw new Error('代理路径为空');
  if (segments.some((segment) => !SAFE_SEGMENT.test(String(segment)) || segment === '.' || segment === '..')) {
    throw new Error('代理路径非法');
  }

  const url = new URL(`${base}/`);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
  if (search) url.search = String(search).replace(/^\?/, '');
  return url.toString();
}
