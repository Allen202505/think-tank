// src/lib/poolNews.js —— 自选股 × 新闻 匹配工具（早报 / 股票池新闻列表共用）
// 三个新闻来源：
//  ① 滚动快讯（财联社 + 东方财富 7x24）按名称/代码匹配
//  ② 东方财富「个股新闻搜索」（按代码检索该股自己的新闻，提升召回）
//  ③ 东方财富「公司公告」（业绩预告/定期报告/中标/回购/增减持等，补公告型新闻）
import { resolveSymbols } from '../app/api/chat/marketData.js';
import { fetchNewsList } from './newsSource.js';

const MAX_WATCHLIST = 20;
const PER_STOCK_LIMIT = 5;
const ANN_PER_STOCK = 10;          // 每只自选股最多拉取的公告条数
const PER_STOCK_CONCURRENCY = 6;   // 自选股并发上限（避免自选股多时瞬时请求过多）
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

// 东财时间串（"2026-08-27 16:53:09:546" / "2026-08-28 00:00:00"）→ unix 秒
function parseEmTime(str) {
  if (!str) return 0;
  const m = String(str).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return 0;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
  return Number.isNaN(d.getTime()) ? 0 : d.getTime() / 1000;
}

// unix 秒 → "HH:MM"（今天）或 "MM-DD HH:MM"（更早）
function fmtTime(unixSec, now = new Date()) {
  if (!unixSec) return '';
  const d = new Date(Number(unixSec) * 1000);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? hm : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`;
}

function normSpace(s) { return String(s || '').replace(/\s+/g, ''); }

// 公告分类白名单：只保留与投资机会相关的公告（业绩/定期报告/合同/资本运作等），
// 丢弃法律意见书、募集资金、资金占用、董监高任免、董事会/股东大会决议等模板公告
const ANN_KEEP = [
  '业绩预告', '业绩快报', '业绩说明会',
  '半年度报告', '年度报告', '一季度报告', '三季度报告',
  '月度经营', '经营情况',
  '中标', '重大合同', '订单',
  '回购', '增持', '减持',
  '重组', '收购', '出售', '资产置换',
  '分红', '权益分派', '利润分配', '送转', '派息',
  '股权激励',
  '澄清', '停牌', '复牌',
  '立案', '处罚', '风险警示',
  '可转债', '可转换公司债券',
];
function isRelevantAnn(text) {
  return ANN_KEEP.some((w) => text.includes(w));
}

// 带并发上限的 map（单只失败降级为空数组，不影响其他自选股）
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx).catch(() => []);
    }
  });
  await Promise.all(workers);
  return results;
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
    // 标题相关性校验：标题须出现公司名/简称，过滤「概念板块涨跌」这类只列代码的噪音文章
    const relVariants = nameVariants(info)
      .filter((v) => v && String(v) !== String(info.symbol || '') && v.length >= 2)
      .map(normSpace);
    return arr
      .map((a) => {
        const title = stripTags(a.title);
        const summary = stripTags(a.content || a.digest || '');
        let ts = 0;
        if (a.date) {
          const t = new Date(String(a.date).replace(/-/g, '/'));
          if (!Number.isNaN(t.getTime())) ts = t.getTime() / 1000;
        }
        return {
          id: String(a.id || `s${info.symbol}-${title}`),
          title: title || summary.slice(0, 60),
          summary: summary.slice(0, 200),
          time: fmtTime(ts),
          ts,
          source: '个股新闻',
          related: [{ name: info.name || info.symbol, symbol: info.symbol }],
        };
      })
      .filter((n) => {
        if (!n.title || n.title.length <= 4) return false;
        if (relVariants.length) {
          const t = normSpace(n.title);
          if (!relVariants.some((v) => t.includes(v))) return false;
        }
        return true;
      });
  } catch (e) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ── 东方财富个股公告（业绩预告/定期报告/中标/回购/增减持等，补公告型新闻） ──
async function fetchStockAnnouncements(info, limit = ANN_PER_STOCK) {
  const code = String(info.symbol || '');
  if (!code || info.market !== 'CN') return [];
  const url = `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=${limit}&page_index=1&ann_type=A&client_source=web&stock_list=${code}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', Referer: 'https://data.eastmoney.com/' },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const json = await res.json();
    const list = (json && json.data && json.data.list) || [];
    const out = [];
    for (const a of list) {
      const colName = (a.columns || []).map((c) => c.column_name || '').filter(Boolean).join(' ');
      if (!isRelevantAnn(`${colName}\n${a.title || ''}`)) continue;
      // 用 display_time（真实发布时间）排序；notice_date 常标成次日零点
      const ts = parseEmTime(a.display_time || a.eiTime || a.notice_date);
      if (!ts) continue;
      const title = stripTags(a.title);
      if (!title || title.length < 5) continue;
      out.push({
        id: `ann-${a.art_code || `${code}-${title}`}`,
        title,
        summary: colName ? `【${colName}】` : '',
        time: fmtTime(ts),
        ts,
        source: '公告',
        related: [{ name: info.name || info.symbol, symbol: info.symbol }],
      });
    }
    return out;
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
 * 拉取「我的股票池新闻」：滚动快讯匹配 + 个股新闻搜索 + 公司公告合并去重，按时间倒序。
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

  // ② 每只自选股：个股新闻（按代码搜资讯）+ 公司公告（业绩预告/定期报告/合同/回购等）
  // 并发上限控制请求量；单只失败降级为空数组，不影响其他自选股
  const perStock = (await mapLimit(resolved, PER_STOCK_CONCURRENCY, async (w) => {
    const [news, anns] = await Promise.all([
      fetchStockNews(w).catch(() => []),
      fetchStockAnnouncements(w).catch(() => []),
    ]);
    return [...news, ...anns];
  })).flat();

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
