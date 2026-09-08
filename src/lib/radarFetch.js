// src/lib/radarFetch.js —— 跟踪大师动态：多平台内容源抓取与解析（服务端）
// 通道策略：
//  - 雪球 / 知乎：走 RSSHub（/xueqiu/user/:uid/:type、/zhihu/people/activities/:uid）
//  - 其他网站（用户自提供链接）：尝试 RSS/Atom 自动发现；找不到则仅提供原始链接
// 注意：知乎用户内容在公共 RSSHub 实例上常被 403（需自建 RSSHub 并配置 ZHIHU_COOKIE），
//       失败时本模块会如实返回 error + 原始主页链接，不编造内容。

export const PLATFORM_LABEL = {
  xueqiu: '雪球',
  zhihu: '知乎',
  x: 'X',
  custom: '网页',
};

function rsshubBase() {
  return String(process.env.RSSHUB_BASE || 'https://rsshub.pseudoyu.com').replace(/\/+$/, '');
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// ── 缓存（模块级，Vercel 单实例内有效；正常 5 分钟 / 失败 1 分钟） ──
const FEED_TTL = 5 * 60 * 1000;
const ERROR_TTL = 60 * 1000;
const cache = new Map();

// 手动刷新时清掉对应前缀的缓存（强制重新抓取）
export function radarCacheClear(prefix) {
  for (const k of [...cache.keys()]) {
    if (!prefix || k.startsWith(prefix)) cache.delete(k);
  }
}
export function radarCached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.error ? ERROR_TTL : ttlMs)) return hit.value;
  const p = Promise.resolve().then(loader);
  p.then(
    (v) => cache.set(key, { at: Date.now(), value: p, error: !!(v && v.ok === false) }),
    () => cache.set(key, { at: Date.now(), value: p, error: true }),
  );
  cache.set(key, { at: Date.now(), value: p });
  return p;
}

async function fetchText(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*' },
      signal: ctrl.signal,
      cache: 'no-store',
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    return { res, body };
  } finally {
    clearTimeout(timer);
  }
}

function decodeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|section|li|h1|h2|h3)>/gi, '\n');
  s = s.replace(/<img[^>]*>/gi, ' ').replace(/<[^>]+>/g, '');
  s = decodeXml(s);
  s = s.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
  s = s.replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

function imagesFromHtml(html) {
  const out = [];
  const re = /<img[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) && out.length < 4) {
    let src = m[1];
    if (/face|emoji|\.gif/i.test(src) || /assets\.imedao\.com\/ugc\/images\/face/i.test(src)) continue;
    if (src.startsWith('//')) src = `https:${src}`;
    out.push(src);
  }
  return out;
}

function toTs(v) {
  if (!v) return 0;
  const ts = new Date(v).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

// 通用 RSS 2.0 / Atom 解析 → 归一化 post
export function parseFeed(xml) {
  const posts = [];
  const isAtom = /<feed[ >]/i.test(xml);
  const wrapRe = isAtom ? /<entry>([\s\S]*?)<\/entry>/g : /<item>([\s\S]*?)<\/item>/g;
  const pickTag = (s, tag) => {
    const m = s.match(new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
    return m ? decodeXml(m[1]) : '';
  };
  let m;
  while ((m = wrapRe.exec(xml))) {
    const s = m[1];
    let url = '';
    if (isAtom) {
      const lm = s.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i) || s.match(/<link[^>]*href=["']([^"']+)["']/i);
      url = lm ? decodeXml(lm[1]) : '';
    } else {
      url = pickTag(s, 'link').trim();
    }
    const title = (isAtom ? pickTag(s, 'title') : pickTag(s, 'title')).trim();
    const html =
      pickTag(s, 'content:encoded') || pickTag(s, 'content') || pickTag(s, 'description') || pickTag(s, 'summary');
    const text = htmlToText(html) || title;
    if (!url || !text) continue;
    const pub = toTs(isAtom ? (pickTag(s, 'published') || pickTag(s, 'updated')) : pickTag(s, 'pubDate'));
    posts.push({
      id: (isAtom ? pickTag(s, 'id') : '').trim(),
      url,
      title,
      text,
      images: imagesFromHtml(html),
      publishedAt: pub,
    });
  }
  posts.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  return posts;
}

// ── 平台源 → RSSHub 路径 ──
export function rsshubPath(source) {
  if (!source || !source.platform) return '';
  if (source.platform === 'xueqiu') {
    const type = typeof source.type === 'number' ? source.type : 0;
    return `/xueqiu/user/${encodeURIComponent(source.uid)}/${type}`;
  }
  if (source.platform === 'zhihu') {
    return `/zhihu/people/activities/${encodeURIComponent(source.uid)}`;
  }
  return '';
}

// 抓一个平台源（雪球/知乎）→ 帖子
async function fetchRsshubSource(source) {
  const path = rsshubPath(source);
  if (!path) return { ok: false, error: '不支持的平台源', posts: [] };
  try {
    const { body } = await fetchText(`${rsshubBase()}${path}`);
    const posts = parseFeed(body);
    return { ok: true, error: '', posts };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 180), posts: [] };
  }
}

// ── 识别用户粘贴的原始链接 ──
export function detectSourceByUrl(input) {
  let url = String(input || '').trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return { ok: false };
  }
  const host = u.hostname.replace(/^www\./, '');
  const path = u.pathname;
  const mXq = path.match(/^\/u\/([A-Za-z0-9_]+)/);
  if (host.includes('xueqiu.com') && mXq) {
    const uid = mXq[1];
    return {
      ok: true,
      platform: 'xueqiu',
      uid,
      profileUrl: `https://xueqiu.com/u/${uid}`,
      rawUrl: u.href,
    };
  }
  const mZh = path.match(/^\/people\/([^/?#]+)/);
  if (host.includes('zhihu.com') && mZh) {
    const uid = mZh[1];
    return {
      ok: true,
      platform: 'zhihu',
      uid,
      profileUrl: `https://www.zhihu.com/people/${uid}`,
      rawUrl: u.href,
    };
  }
  const mX = (host === 'x.com' || host.includes('twitter.com')) && path.match(/^\/([A-Za-z0-9_]{1,15})(?:\/|$)/);
  if (mX) {
    return {
      ok: true,
      platform: 'x',
      uid: mX[1],
      profileUrl: `https://x.com/${mX[1]}`,
      rawUrl: u.href,
    };
  }
  return { ok: true, platform: 'custom', uid: u.href, profileUrl: u.href, rawUrl: u.href };
}

// 网页 RSS 自动发现
async function discoverFeed(url) {
  try {
    const { body } = await fetchText(url, 12000);
    // 本身就是 RSS/Atom（用户直接贴订阅地址）
    if (/^\s*<\?xml|^\s*<feed[ >]|^\s*<rss[ >]/i.test(body)) {
      return { ok: true, error: '', posts: parseFeed(body), feedUrl: url };
    }
    const rels = [...body.matchAll(/<link[^>]*>/gi)];
    let href = '';
    for (const rm of rels) {
      const tag = rm[0];
      const type = (tag.match(/type=["']([^"']+)["']/i) || [])[1] || '';
      if (!/rss|atom|xml/i.test(type)) continue;
      const hm = tag.match(/href=["']([^"']+)["']/i);
      if (hm) { href = hm[1]; break; }
    }
    if (!href) return { ok: false, error: '该页面未发现 RSS/Atom 订阅源', posts: [] };
    const base = new URL(url);
    const abs = new URL(href, base).href;
    const { body: feedBody } = await fetchText(abs, 12000);
    const posts = parseFeed(feedBody);
    return { ok: true, error: '', posts, feedUrl: abs };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 180), posts: [] };
  }
}

// 统一入口：任意源描述 → { ok, linkOnly, error, posts }
export function fetchSourcePosts(source) {
  const platform = source.platform;
  if (platform === 'xueqiu' || platform === 'zhihu') {
    return radarCached(`radar:${platform}:${source.uid}:${source.type ?? 0}`, FEED_TTL, () => fetchRsshubSource(source));
  }
  if (platform === 'x') {
    // X 官方/社区通道需要 Cookie（二期自建通道），先降级为链接
    return Promise.resolve({ ok: false, linkOnly: true, error: 'X 的自动抓取通道尚未接入（需专用 API/Cookie），先提供原始链接', posts: [] });
  }
  // custom：RSS 自动发现
  return radarCached(`radar:custom:${source.uid}`, FEED_TTL, () => discoverFeed(source.uid));
}

export { PLATFORM_LABEL as PLATFORM_LABELS };
