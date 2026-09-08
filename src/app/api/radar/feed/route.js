// src/app/api/radar/feed/route.js —— 跟踪大师动态：内置大师的内容源（各大师独立返回，不跨大师合并）
// GET /api/radar/feed?master=duanyongping&refresh=1
// 返回每位大师各自的多平台源结果（雪球/知乎等），由前端按大师单独展示
import { RADAR_ACCOUNTS, PLATFORM_LABEL } from '../../../../data/radarAccounts';
import { fetchSourcePosts, radarCacheClear } from '../../../../lib/radarFetch';

export async function GET(request) {
  const sp = request.nextUrl.searchParams;
  const ids = (sp.get('master') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const refresh = sp.get('refresh') === '1';
  let accounts = RADAR_ACCOUNTS;
  if (ids.length) accounts = RADAR_ACCOUNTS.filter((a) => ids.includes(a.id));

  const results = await Promise.all(
    accounts.map(async (acc) => {
      const sources = await Promise.all(
        (acc.sources || []).map(async (src) => {
          if (refresh) radarCacheClear(`radar:${src.platform}:${src.uid}`);
          const r = await fetchSourcePosts(src);
          return {
            platform: src.platform,
            label: PLATFORM_LABEL[src.platform] || src.platform,
            nick: src.nick || '',
            profileUrl: src.profileUrl || '',
            ok: r.ok,
            linkOnly: !!r.linkOnly,
            error: r.error || '',
            count: r.posts.length,
            posts: r.posts,
          };
        }),
      );
      return {
        accountId: acc.id,
        ok: sources.some((s) => s.ok && s.count > 0),
        sources,
      };
    }),
  );

  return Response.json({ ok: true, fetchedAt: Date.now(), accounts: results });
}
