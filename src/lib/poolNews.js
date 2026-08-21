// src/lib/poolNews.js —— 自选股 × 新闻 匹配工具（早报 / 股票池新闻列表共用）
// 两个新闻来源：
//  ① 滚动快讯（财联社 + 东方财富 7x24）按名称/代码匹配
//  ② 东方财富「个股新闻搜索」（按代码检索该股自己的新闻，提升召回）
import { resolveSymbols } from '../app/api/chat/marketData.js';
import { fetchNewsList } from './newsSource.js';

const MAX_WATCHLIST = 20;
const PER_STOCK_LIMIT = 5;
const MAX_TOTAL = 20;

// 名称匹配变体：去掉常见公司后缀，提高「茅台/宁德时代」这类简称命中率
const COMPANY_SUFFIXES = ['股份有限公司', '有限责任公司', '有限公司', '控股', '集团', '股份', '科技', '电子', '生物', '医药', '能源', '汽车', '银行', '证券', '保险'];
// 2 字短名黑名单：过于通用，不做简称匹配（避免误伤）
const GENERIC_SHORT_NAMES = new Set([
  '银行', '证券', '保险', '基金', '科技', '电子', '医药', '生物', '能源', '汽车', '股份', '集团', '控股',
  '中国', '国际', '时代', '有限', '公司', '地产', '材料', '化工', '传媒', '软件', '通信', '食品', '零售',
  '物流', '电力', '钢铁', '黄金', '稀土', '农业', '旅游', '航空', '铁路', '船舶', '机械', '装备', '重工',
  '智能', '数科', '数字', '产业', '投资', '建设', '发展', '医药', '环保', '水务', '燃气', '白酒', '医疗',
]);
// 短名后面跟着这些后缀 → 大概率是另一家公司（如「招商基金」「招商证券」≠「招商银行」）
const ENTITY_SUFFIXES = ['基金', '证券', '保险', '银行', '控股', '集团', '股份', '科技', '汽车', '能源', '药业', '生物', '电子', '通信', '期货', '资管', '信托'];

// ── 自选股规范化：名称/代码 → {symbol, market, secid, name} ──
export async function normalizeWatchlist(list) {
  const rawItems = (list || []).slice(0, MAX_WATCHLIST)
    .map((raw) => {
      if (!raw) return '';
      const v = (raw && (raw.symbol || raw.name || raw.code)) || (typeof raw === 'string' ? raw : '');
      return String(v || '').trim();
    })
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  await Promise.all(rawItems.map(async (item) => {
    try {
      const infos = await resolveSymbols(item);
      const info = infos && infos[0];
      if (info && info.secid && !seen.has(info.secid)) {
        // 东财部分名称带回空格（如「五 粮 液」），A 股名称去掉内部空格
        if (info.market === 'CN' && info.name) info.name = String(info.name).replace(/\s+/g, '');
        seen.add(info.secid);
        out.push(info);
      }
    } catch (e) { /* 单个解析失败跳过 */ }
  }));
  return out;
}

export function nameVariants(info) {
  const name = String(info.name || '');
  const set = new Set();
  if (name) {
    set.add(name);
    for (const sfx of COMPANY_SUFFIXES) {
      if (name.length > sfx.length && name.endsWith(sfx)) set.add(name.slice(0, name.length - sfx.length));
    }
    // 4 字以上名称取末 2 字作为简称（非通用词才收），提升「茅台」「平安」这类简称召回
    if (name.length >= 4) {
      const short = name.slice(-2);
      if (!GENERIC_SHORT_NAMES.has(short)) set.add(short);
    }
  }
  set.add(String(info.symbol || ''));
  return [...set].filter(Boolean);
}

// 判断一条新闻文本是否真的提到该自选股（防「招商基金」误伤「招商银行」）
function newsMentions(info, text) {
  const name = String(info.name || '');
  const code = String(info.symbol || '');
  const hasFull = name && text.includes(name);
  for (const k of nameVariants(info)) {
    if (!k) continue;
    if (!text.includes(k)) continue;
    // 短名（比全名短、不是代码）：若后面紧跟其它公司后缀且全文没出现全名 → 判定为误伤
    if (k !== name && k !== code && k.length < name.length && !hasFull) {
      const bad = ENTITY_SUFFIXES.some((sfx) => text.includes(k + sfx));
      if (bad) continue;
    }
    return true;
  }
  return false;
}

// 滚动快讯 × 自选股匹配
export function matchNews(items, watchlist) {
  return (items || []).map((n) => {
    const text = `${n.title}\n${n.summary}`;
    const related = watchlist.filter((w) => newsMentions(w, text));
    return { ...n, related };
  });
}

// ── 东方财富个股新闻搜索（按代码检索该股自己的新闻） ──
function stripTags(str) {
  return String(str || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchStockNews(info, limit = PER_STOCK_LIMIT) {
  const keyword = String(info.symbol || '');
  if (!keyword) return [];
  const param = JSON.stringify({
    uid: '',
    keyword,
    type: ['cmsArticleWebOld'],
    client: 'web',
    clientType: 'web',
    clientVersion: 'curr',
    param: { cmsArticleWebOld: { searchScope: 'default', sort: 'time', pageIndex: 1, pageSize: limit, preTag: '', postTag: '' } },
  });
  const url = `https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=${encodeURIComponent(param)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', Referer: 'https://so.eastmoney.com/' },
      signal: ctrl.signal,
    });
    const text = await res.text();
    const m = text.match(/\((\{[\s\S]*\})\)\s*;?\s*$/);
    if (!m) return [];
    const json = JSON.parse(m[1]);
    const arr = (json && json.result && json.result.cmsArticleWebOld) || [];
    return arr
      .map((a) => {
        const title = stripTags(a.title);
        const summary = stripTags(a.content || a.digest || '');
        let ts = 0;
        if (a.date) {
          const t = new Date(String(a.date).replace(/-/g, '/'));
          if (!Number.isNaN(t.getTime())) ts = t.getTime() / 1000;
        }
        const d = new Date(Number(ts) * 1000);
        const now = new Date();
        const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
        const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const time = sameDay ? hm : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`;
        return {
          id: String(a.id || `s${info.symbol}-${title}`),
          title: title || summary.slice(0, 60),
          summary: summary.slice(0, 200),
          time,
          ts,
          source: '个股新闻',
          related: [{ name: info.name || info.symbol, symbol: info.symbol }],
        };
      })
      .filter((n) => n.title && n.title.length > 4);
  } catch (e) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function normTitle(t) {
  return String(t || '').trim().replace(/\s+/g, '');
}

/**
 * 拉取「我的股票池新闻」：滚动快讯匹配 + 个股新闻搜索合并去重，按时间倒序。
 * @param {Array} watchlist 自选股（名称或代码）
 * @returns {Promise<{items: object[], resolved: object[], total: number}>}
 */
export async function fetchPoolNews(watchlist) {
  const [resolved, newsResult] = await Promise.all([
    normalizeWatchlist(watchlist).catch(() => []),
    fetchNewsList(1).catch(() => ({ items: [] })),
  ]);

  // ① 滚动快讯匹配
  const matched = matchNews(newsResult.items || [], resolved)
    .filter((n) => n.related.length > 0);

  // ② 每只自选股检索自己的新闻（并行，单只失败降级）
  const perStock = (await Promise.all(
    resolved.slice(0, 8).map((w) => fetchStockNews(w).catch(() => [])),
  )).flat();

  // 合并去重（标题归一）
  const seen = new Set();
  const merged = [];
  const push = (n) => {
    const key = normTitle(n.title);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(n);
  };
  for (const n of perStock) push(n);
  for (const n of matched) push(n);

  merged.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return {
    items: merged.slice(0, MAX_TOTAL),
    resolved,
    total: (newsResult.items || []).length,
  };
}
