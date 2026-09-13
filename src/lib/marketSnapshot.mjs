// 全市场 A 股感知层（大师智能体的数据底座）。
//
// 设计原则：
//  1) 不做「一次性拉全市场 5000 只」——按需查询，每个工具 1~3 个请求，服务端缓存。
//  2) 多源冗余：东财 clist 被限流过，主力改用新浪榜单接口，指数/涨停池/单股快照走东财，
//     日线走腾讯 + 新浪双源；任何一层失败返回空并标记，不抛给用户。
//  3) 纯函数（解析、过滤、概览）与网络分离，便于单测。
//
// 数据源现状（2026-09-13 实测）：
//   全市场/行业榜单  新浪 Market_Center.getHQNodeData   ✓
//   行业板块列表     新浪 newSinaHy.php（GBK）           ✓
//   指数 + 涨跌家数  东财 ulist.np/get                   ✓
//   涨停池           东财 push2ex getTopicZTPool          ✓
//   单股快照         东财 push2/stock/get（含行业）       ✓
//   日线             腾讯 ifzq → 新浪 CN_MarketDataService ✓
const SINA_LIST = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData';
const SINA_BOARDS = 'https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php';
const SINA_KLINE = 'https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData';
const EM_ULIST = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
const EM_STOCK = 'https://push2.eastmoney.com/api/qt/stock/get';
const EM_LIMIT_UP = 'https://push2ex.eastmoney.com/getTopicZTPool';
const TENCENT_KLINE = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TTL = { board: 5 * 60 * 1000, index: 60 * 1000, list: 3 * 60 * 1000, quote: 60 * 1000, kline: 10 * 60 * 1000, limitUp: 5 * 60 * 1000 };

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const round = (value, digits = 2) => (value == null || !Number.isFinite(value) ? null : Math.round(value * 10 ** digits) / 10 ** digits);
const toYi = (value) => (value == null || !Number.isFinite(value) ? null : Math.round((value / 1e8) * 100) / 100);

// ── 缓存 ───────────────────────────────────────────────────
const cache = new Map();
function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.error ? 30000 : ttlMs)) return hit.value;
  const promise = Promise.resolve().then(loader);
  promise.then(
    () => cache.set(key, { at: Date.now(), value: promise }),
    () => cache.set(key, { at: Date.now(), value: promise, error: true }),
  );
  cache.set(key, { at: Date.now(), value: promise });
  return promise;
}

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*' }, signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeoutMs = 10000, encoding = 'gbk') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    try {
      return new TextDecoder(encoding).decode(buffer);
    } catch {
      return new TextDecoder('utf-8').decode(buffer);
    }
  } finally {
    clearTimeout(timer);
  }
}

function diffRows(payload) {
  const diff = payload?.data?.diff;
  if (Array.isArray(diff)) return diff;
  return Object.values(diff || {});
}

// ── 行业别名：模型说「医药/芯片/券商」，数据源用的是细分行业名 ──
export const INDUSTRY_ALIASES = {
  医药: ['化学制药', '中药', '生物制药', '生物制品', '医疗器械', '医疗服务', '医药商业', '制药'],
  芯片: ['半导体', '元件', '光学光电子', '集成电路'],
  半导体: ['半导体', '元件', '集成电路'],
  算力: ['通信设备', '计算机设备', '软件开发', 'IT服务', '半导体', '消费电子', '互联网'],
  AI: ['通信设备', '计算机设备', '软件开发', 'IT服务', '半导体', '消费电子', '互联网', '游戏'],
  人工智能: ['通信设备', '计算机设备', '软件开发', 'IT服务', '半导体', '消费电子', '游戏'],
  新能源车: ['汽车整车', '汽车零部件', '电池', '能源金属', '电机', '汽车'],
  新能源: ['电池', '光伏设备', '风电设备', '能源金属', '电力'],
  光伏: ['光伏设备', '太阳能'],
  风电: ['风电设备', '风能'],
  券商: ['证券'],
  银行: ['银行'],
  保险: ['保险'],
  白酒: ['白酒', '酿酒'],
  消费: ['白酒', '酿酒', '食品', '饮料', '商业百货', '旅游', '家电', '零售'],
  食品饮料: ['食品', '饮料', '白酒'],
  军工: ['航天', '航空', '船舶', '军工', '兵装'],
  地产: ['房地产', '地产'],
  房地产: ['房地产', '地产'],
  基建: ['工程建设', '建筑材料', '水泥', '装修', '工程机械'],
  有色: ['有色', '金属', '贵金属', '小金属'],
  黄金: ['贵金属', '黄金'],
  煤炭: ['煤炭'],
  钢铁: ['钢铁'],
  化工: ['化学', '化工', '塑料', '橡胶', '化纤'],
  汽车: ['汽车'],
  机器人: ['通用设备', '专用设备', '自动化', '电机', '机器人'],
  电力: ['电力', '电网', '风电', '光伏'],
  传媒: ['传媒', '广告', '游戏', '影视', '文化'],
  农业: ['农业', '农牧', '农药', '化肥', '种植', '养殖'],
  航空: ['航空', '机场', '航天'],
  软件: ['软件', 'IT服务', '互联网'],
  通信: ['通信', '通讯'],
  家电: ['家电', '家用电器'],
  纺织: ['纺织', '服装', '化纤'],
};

export function resolveIndustryFilters(industry) {
  const raw = String(industry || '').trim();
  if (!raw) return [];
  return INDUSTRY_ALIASES[raw] || [raw];
}

// 把模型给的行业词解析成板块清单（可能命中多个，如「医药」= 若干细分行业）
export function matchIndustryBoards(boards, industry) {
  const matchers = resolveIndustryFilters(industry);
  if (!matchers.length) return [];
  const core = (name) => String(name || '').replace(/行业$|服务$|设备$|制造$|产业$/, '');
  return (boards || []).filter((board) => matchers.some((matcher) => (
    String(board.name).includes(matcher) || matcher.includes(core(board.name))
  )));
}

export function isTradableRow(row) {
  const name = String(row?.name || '');
  if (!name) return false;
  if (/^(N|C)\s?/.test(name)) return false;
  if (/ST|退/.test(name)) return false;
  if (!(num(row?.price) > 0)) return false;
  return true;
}

// ── 纯函数：解析 ───────────────────────────────────────────
// 新浪个股字段：code/name/trade/changepercent/amount/volume/per/pb/mktcap(万元)/nmc(万元)/turnoverratio
export function normalizeSinaRows(rows, industry = '') {
  return (rows || []).map((row) => ({
    code: String(row?.code || ''),
    name: String(row?.name || ''),
    price: num(row?.trade),
    changePct: num(row?.changepercent),
    volume: num(row?.volume),
    amount: num(row?.amount),
    turnover: num(row?.turnoverratio),
    pe: num(row?.per),
    pb: num(row?.pb),
    marketCap: num(row?.mktcap) == null ? null : num(row.mktcap) * 1e4,
    floatCap: num(row?.nmc) == null ? null : num(row.nmc) * 1e4,
    industry,
  })).filter((row) => row.code && row.name);
}

// 新浪行业板块：code,name,家数,均价,涨跌额,涨跌幅%,成交量,成交额,领涨股代码,领涨涨幅,领涨价,领涨涨跌额,领涨名
export function parseSinaBoards(text) {
  const match = String(text || '').match(/\{([\s\S]*)\}/);
  if (!match) return [];
  return match[1].split('","').map((chunk) => {
    // 每项形如：new_swzz":"new_swzz,生物制药,155,...  —— 冒号前是 key，冒号后才是值
    const raw = chunk.replace(/^"|"$/g, '');
    const value = raw.includes('":"') ? raw.split('":"')[1] : raw;
    const parts = value.split(',');
    if (parts.length < 13) return null;
    const [code, name, count, , , changePct, , amount, leaderSymbol, leaderChangePct, , , leaderName] = parts;
    return {
      code: String(code || ''),
      name: String(name || ''),
      count: num(count),
      changePct: num(changePct),
      amount: num(amount),
      leader: String(leaderName || ''),
      leaderCode: String(leaderSymbol || ''),
      leaderChangePct: num(leaderChangePct),
    };
  }).filter((board) => board && board.code && board.name);
}

// ── 纯函数：本地过滤 + 概览 ────────────────────────────────
const SORT_KEYS = {
  amount: (row) => row.amount || 0,
  changePct: (row) => row.changePct ?? -Infinity,
  turnover: (row) => row.turnover || 0,
  marketCap: (row) => row.marketCap || 0,
  pe: (row) => (row.pe != null && row.pe > 0 ? row.pe : Infinity),
};

export function applyStockFilters(rows, filters = {}) {
  const {
    keyword, minChangePct, maxChangePct, minAmount, maxAmount,
    minTurnover, maxTurnover, minMarketCap, maxMarketCap, minPe, maxPe,
    sortBy = 'amount', order = 'desc', limit = 30, includeRisky = false,
  } = filters;
  const sortKey = SORT_KEYS[sortBy] || SORT_KEYS.amount;

  const matched = (rows || [])
    .filter((row) => (includeRisky ? num(row.price) > 0 : isTradableRow(row)))
    .filter((row) => {
      if (keyword) {
        const text = `${row.code}${row.name}`.toLowerCase();
        if (!text.includes(String(keyword).toLowerCase())) return false;
      }
      if (row.changePct == null) return false;
      if (minChangePct != null && row.changePct < minChangePct) return false;
      if (maxChangePct != null && row.changePct > maxChangePct) return false;
      if (minAmount != null && (row.amount || 0) < minAmount) return false;
      if (maxAmount != null && (row.amount || 0) > maxAmount) return false;
      if (minTurnover != null && (row.turnover || 0) < minTurnover) return false;
      if (maxTurnover != null && (row.turnover || 0) > maxTurnover) return false;
      if (minMarketCap != null && (row.marketCap || 0) < minMarketCap) return false;
      if (maxMarketCap != null && (row.marketCap || 0) > maxMarketCap) return false;
      if (minPe != null && !(row.pe >= minPe)) return false;
      if (maxPe != null && !(row.pe > 0 && row.pe <= maxPe)) return false;
      return true;
    });

  const sorted = matched.sort((a, b) => (order === 'asc' ? sortKey(a) - sortKey(b) : sortKey(b) - sortKey(a)));
  return { total: sorted.length, rows: sorted.slice(0, Math.max(1, Math.min(100, limit))) };
}

export function buildMarketOverview({ boards = [], indices = [], limitUp = null } = {}) {
  const ranked = [...boards].filter((board) => board.changePct != null);
  const byChangeDesc = [...ranked].sort((a, b) => b.changePct - a.changePct);
  const byAmount = [...ranked].sort((a, b) => (b.amount || 0) - (a.amount || 0));

  return {
    indices,
    // 注意：指数成分股有重叠（创业板已含在深证里），相加会重复计数，
    // 所以这里只给「每个指数各自的口径」，不做一个会被误读的市场总家数。
    breadth: {
      byIndex: indices.map((item) => ({ name: item.name, up: item.up, down: item.down, flat: item.flat, amountYi: toYi(item.amount) })),
      boardCount: boards.length,
      risingBoards: ranked.filter((board) => board.changePct > 0).length,
      fallingBoards: ranked.filter((board) => board.changePct < 0).length,
      limitUpCount: limitUp?.count ?? null,
    },
    limitUp,
    hottestIndustries: byChangeDesc.slice(0, 8),
    weakestIndustries: byChangeDesc.slice(-5).reverse(),
    industriesByAmount: byAmount.slice(0, 40),
  };
}

const INDEX_SECIDS = [
  { secid: '1.000001', name: '上证指数' },
  { secid: '0.399001', name: '深证成指' },
  { secid: '0.399006', name: '创业板指' },
];

// ── 网络：指数摘要（东财） ─────────────────────────────────
export async function fetchIndexSummary() {
  return cached('index', TTL.index, async () => {
    const url = `${EM_ULIST}?secids=${INDEX_SECIDS.map((i) => i.secid).join(',')}&fields=f2,f3,f6,f12,f14,f104,f105,f106&fltt=2&invt=2`;
    const payload = await fetchJson(url);
    return diffRows(payload).map((row) => ({
      code: String(row?.f12 || ''),
      name: String(row?.f14 || ''),
      price: num(row?.f2),
      changePct: num(row?.f3),
      amount: num(row?.f6),
      up: num(row?.f104),
      down: num(row?.f105),
      flat: num(row?.f106),
    }));
  });
}

// ── 网络：涨停池（东财） ───────────────────────────────────
// 最新交易日：从新浪上证指数日线取最后一根 K 线日期（1 请求，缓存 10 分钟）
export async function fetchLatestTradeDate() {
  return cached('latestTradeDate', TTL.kline, async () => {
    const payload = await fetchJson(`${SINA_KLINE}?symbol=sh000001&scale=240&ma=no&datalen=3`);
    const rows = Array.isArray(payload) ? payload : [];
    return String(rows[rows.length - 1]?.day || '');
  });
}

function limitUpUrl(date = '') {
  return `${EM_LIMIT_UP}?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=80&sort=fbt%3Aasc${date ? `&date=${date}` : ''}`;
}

// 涨停池属于「锦上添花」的数据：拿不到就返回 null，让上层如实告诉模型数据缺失，
// 绝不能返回 0 家涨停——那会把「没数据」误导成「今天没有涨停」。
export async function fetchLimitUpPool() {
  return cached('limitup', TTL.limitUp, async () => {
    let payload = await fetchJson(limitUpUrl(), 8000).catch(() => null);
    if (!payload?.data?.pool) {
      const latest = await fetchLatestTradeDate().catch(() => '');
      if (latest) payload = await fetchJson(limitUpUrl(latest.replace(/-/g, '')), 8000).catch(() => null);
    }
    if (!Array.isArray(payload?.data?.pool)) return null;
    const pool = payload.data.pool;
    return {
      date: String(payload?.data?.qdate || ''),
      count: num(payload?.data?.tc) || pool.length,
      stocks: pool.slice(0, 60).map((item) => ({
        code: String(item?.c || ''),
        name: String(item?.n || ''),
        changePct: num(item?.zdp),
        amount: num(item?.amount),
        floatCap: num(item?.ltsz),
        firstLimitTime: String(item?.fbt || ''),
        lastLimitTime: String(item?.lbt || ''),
        openCount: num(item?.zbc),
        limitUpDays: num(item?.lbc),
        industry: String(item?.hybk || ''),
      })),
    };
  });
}

// ── 网络：行业板块列表（新浪，GBK） ────────────────────────
export async function fetchIndustryBoards() {
  return cached('boards', TTL.board, async () => {
    const text = await fetchText(SINA_BOARDS, 10000, 'gbk');
    const boards = parseSinaBoards(text);
    if (!boards.length) throw new Error('行业板块解析为空');
    return boards;
  });
}

// ── 网络：个股榜单 / 行业成分股（新浪） ─────────────────────
const SINA_SORT = { amount: 'amount', changePct: 'changepercent', turnover: 'turnoverratio', marketCap: 'mktcap', pe: 'per' };

export async function fetchStockList({ node = 'hs_a', sortBy = 'amount', order = 'desc', limit = 100, industry = '' } = {}) {
  const sort = SINA_SORT[sortBy] || 'amount';
  const asc = order === 'asc' ? 1 : 0;
  const size = Math.max(1, Math.min(100, limit));
  const key = `list:${node}:${sort}:${asc}:${size}`;
  return cached(key, TTL.list, async () => {
    const url = `${SINA_LIST}?page=1&num=${size}&sort=${sort}&asc=${asc}&node=${encodeURIComponent(node)}&symbol=`;
    const payload = await fetchJson(url);
    return normalizeSinaRows(Array.isArray(payload) ? payload : [], industry);
  });
}

// ── 网络：单只快照（东财，含行业） ──────────────────────────
export async function fetchStockQuote(code) {
  const target = String(code || '').trim();
  if (!/^\d{6}$/.test(target)) throw new Error('股票代码需为 6 位数字');
  const secid = `${/^(6|9)/.test(target) ? '1' : '0'}.${target}`;
  return cached(`quote:${target}`, TTL.quote, async () => {
    const url = `${EM_STOCK}?secid=${secid}&fields=f43,f47,f48,f57,f58,f60,f116,f117,f127,f162,f168,f170&fltt=2&invt=2`;
    const data = (await fetchJson(url))?.data;
    if (!data) return null;
    return {
      code: String(data.f57 || target),
      name: String(data.f58 || ''),
      price: num(data.f43),
      changePct: num(data.f170),
      volume: num(data.f47),
      amount: num(data.f48),
      turnover: num(data.f168),
      marketCap: num(data.f116),
      floatCap: num(data.f117),
      pe: num(data.f162),
      industry: String(data.f127 || ''),
    };
  });
}

// ── 网络：日线（腾讯 → 新浪 双源） ──────────────────────────
async function fetchTencentKline(code, limit) {
  const symbol = `${/^(6|9)/.test(code) ? 'sh' : 'sz'}${code}`;
  const payload = await fetchJson(`${TENCENT_KLINE}?param=${symbol},day,,,${limit},qfq`);
  const node = payload?.data?.[symbol];
  const rows = node?.qfqday || node?.day || [];
  return rows.map((row) => ({ date: row[0], open: num(row[1]), close: num(row[2]), high: num(row[3]), low: num(row[4]), volume: num(row[5]) }));
}

async function fetchSinaKline(code, limit) {
  const symbol = `${/^(6|9)/.test(code) ? 'sh' : 'sz'}${code}`;
  const payload = await fetchJson(`${SINA_KLINE}?symbol=${symbol}&scale=240&ma=no&datalen=${limit}`);
  return (Array.isArray(payload) ? payload : []).map((row) => ({
    date: row.day, open: num(row.open), close: num(row.close), high: num(row.high), low: num(row.low), volume: num(row.volume),
  }));
}

export async function fetchStockHistory(code, days = 60) {
  const target = String(code || '').trim();
  if (!/^\d{6}$/.test(target)) throw new Error('股票代码需为 6 位数字');
  const limit = Math.max(5, Math.min(250, Number(days) || 60));
  return cached(`kline:${target}:${limit}`, TTL.kline, async () => {
    const sources = [
      { name: '腾讯证券', load: () => fetchTencentKline(target, limit) },
      { name: '新浪财经', load: () => fetchSinaKline(target, limit) },
    ];
    for (const source of sources) {
      try {
        const bars = (await source.load()).filter((bar) => bar.date && bar.close > 0);
        if (bars.length >= 5) return { code: target, name: '', source: source.name, bars };
      } catch {
        /* 换下一个源 */
      }
    }
    return { code: target, name: '', source: '', bars: [] };
  });
}

export const __test__ = { round, toYi, SORT_KEYS, diffRows, SINA_SORT };
