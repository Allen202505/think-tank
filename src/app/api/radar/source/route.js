// src/app/api/radar/source/route.js —— 跟踪大师动态：用户提供的原始网站链接
// GET /api/radar/source?url=<原始链接>&refresh=1
// 支持：雪球/知乎主页（走 RSSHub）；其他网站尝试 RSS/Atom 自动发现；
//       都不行则如实返回仅链接（linkOnly），由前端展示「前往原页面」降级
import { detectSourceByUrl, fetchSourcePosts, radarCacheClear, PLATFORM_LABELS } from '../../../../lib/radarFetch';

export async function GET(request) {
  const sp = request.nextUrl.searchParams;
  const url = (sp.get('url') || '').trim();
  const refresh = sp.get('refresh') === '1';
  if (!url) {
    return Response.json({ ok: false, error: '缺少 url 参数' }, { status: 400 });
  }
  const desc = detectSourceByUrl(url);
  if (!desc.ok) {
    return Response.json({ ok: false, error: '无法识别该链接，请粘贴 http(s) 开头的原始页面地址' }, { status: 400 });
  }
  const source = {
    platform: desc.platform,
    uid: desc.uid,
    type: desc.platform === 'xueqiu' ? 0 : undefined,
    profileUrl: desc.profileUrl || desc.rawUrl,
  };
  if (refresh) radarCacheClear(`radar:${source.platform}:${source.uid}`);
  const r = await fetchSourcePosts(source);
  return Response.json({
    ok: true,
    fetchedAt: Date.now(),
    source: {
      platform: desc.platform,
      label: PLATFORM_LABELS[desc.platform] || '网页',
      profileUrl: source.profileUrl,
      rawUrl: desc.rawUrl,
    },
    fetchOk: r.ok,
    linkOnly: !!r.linkOnly,
    error: r.error || '',
    posts: r.posts,
  });
}
