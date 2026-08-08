/**
 * marketData.js —— 统一市场数据层
 * ------------------------------------------------------------------
 * 目标：让「大师吵股」在辩论前拿到最新行情与财务数据，避免 AI 用训练记忆里的旧数字。
 *
 * 数据源（双源容错）：
 *  - 东方财富公开接口（国内可直连、免费、无需 Key）：
 *      · 搜索建议接口：公司名/代码 → 代码与市场归属（A股/港股/美股）
 *      · 实时行情接口：价格、涨跌、PE、PB、市值（f59 为小数位数，用于换算）
 *      · F10 财务主要指标：最新季报/年报的营收、净利、同比增速、毛利率、净利率、ROE、EPS 等
 *  - Yahoo Finance（yahoo-finance2，Vercel 美国服务器可访问）：
 *      · 美股/港股行情补充（PE、52 周区间、股息率）
 *      · 美股/港股财务与分析师评级（quoteSummary）
 *
 * 容错原则：任何单个请求失败都不致命，返回空即可；数据源挂了会自动降级/跳过。
 */

// ─── 常量 ────────────────────────────────────────────────
const EM_SUGGEST = 'https://searchapi.eastmoney.com/api/suggest/get';
const EM_QUOTE = 'https://push2.eastmoney.com/api/qt/stock/get';
const EM_F10 = 'https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew';
const EM_DATACENTER = 'https://datacenter.eastmoney.com/securities/api/data/v1/get';
// 东方财富网页版搜索框公开使用的固定 token（无需申请）
const EM_TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8';
const REQUEST_TIMEOUT_MS = 8000;

// 常见公司中文名/别名 → 东财 secid（形如 "1.600519"，1=沪 0=深 105/106=美股 116=港股）
// key 用于匹配用户问题文本；value 提供代码、市场与 secid
const COMMON_SYMBOLS = {
  // ── A股 ──
  '贵州茅台': { symbol: '600519', market: 'CN', secid: '1.600519' },
  '茅台':     { symbol: '600519', market: 'CN', secid: '1.600519' },
  '五粮液':   { symbol: '000858', market: 'CN', secid: '0.000858' },
  '泸州老窖': { symbol: '000568', market: 'CN', secid: '0.000568' },
  '山西汾酒': { symbol: '600809', market: 'CN', secid: '1.600809' },
  '洋河股份': { symbol: '002304', market: 'CN', secid: '0.002304' },
  '宁德时代': { symbol: '300750', market: 'CN', secid: '0.300750' },
  '比亚迪':   { symbol: '002594', market: 'CN', secid: '0.002594' },
  '中国平安': { symbol: '601318', market: 'CN', secid: '1.601318' },
  '招商银行': { symbol: '600036', market: 'CN', secid: '1.600036' },
  '平安银行': { symbol: '000001', market: 'CN', secid: '0.000001' },
  '工商银行': { symbol: '601398', market: 'CN', secid: '1.601398' },
  '建设银行': { symbol: '601939', market: 'CN', secid: '1.601939' },
  '农业银行': { symbol: '601288', market: 'CN', secid: '1.601288' },
  '中国银行': { symbol: '601988', market: 'CN', secid: '1.601988' },
  '兴业银行': { symbol: '601166', market: 'CN', secid: '1.601166' },
  '中信证券': { symbol: '600030', market: 'CN', secid: '1.600030' },
  '东方财富': { symbol: '300059', market: 'CN', secid: '0.300059' },
  '中国石油': { symbol: '601857', market: 'CN', secid: '1.601857' },
  '中国神华': { symbol: '601088', market: 'CN', secid: '1.601088' },
  '陕西煤业': { symbol: '601225', market: 'CN', secid: '1.601225' },
  '中远海控': { symbol: '601919', market: 'CN', secid: '1.601919' },
  '中芯国际': { symbol: '688981', market: 'CN', secid: '1.688981' },
  '寒武纪':   { symbol: '688256', market: 'CN', secid: '1.688256' },
  '海光信息': { symbol: '688041', market: 'CN', secid: '1.688041' },
  '中际旭创': { symbol: '300308', market: 'CN', secid: '0.300308' },
  '新易盛':   { symbol: '300502', market: 'CN', secid: '0.300502' },
  '立讯精密': { symbol: '002475', market: 'CN', secid: '0.002475' },
  '韦尔股份': { symbol: '603501', market: 'CN', secid: '1.603501' },
  '北方华创': { symbol: '002371', market: 'CN', secid: '0.002371' },
  '隆基绿能': { symbol: '601012', market: 'CN', secid: '1.601012' },
  '通威股份': { symbol: '600438', market: 'CN', secid: '1.600438' },
  '阳光电源': { symbol: '300274', market: 'CN', secid: '0.300274' },
  '汇川技术': { symbol: '300124', market: 'CN', secid: '0.300124' },
  '药明康德': { symbol: '603259', market: 'CN', secid: '1.603259' },
  '恒瑞医药': { symbol: '600276', market: 'CN', secid: '1.600276' },
  '片仔癀':   { symbol: '600436', market: 'CN', secid: '1.600436' },
  '长江电力': { symbol: '600900', market: 'CN', secid: '1.600900' },
  '美的集团': { symbol: '000333', market: 'CN', secid: '0.000333' },
  '格力电器': { symbol: '000651', market: 'CN', secid: '0.000651' },
  '万科':     { symbol: '000002', market: 'CN', secid: '0.000002' },
  '中国中免': { symbol: '601888', market: 'CN', secid: '1.601888' },
  '伊利股份': { symbol: '600887', market: 'CN', secid: '1.600887' },
  '海天味业': { symbol: '603288', market: 'CN', secid: '1.603288' },
  '牧原股份': { symbol: '002714', market: 'CN', secid: '0.002714' },
  '温氏股份': { symbol: '300498', market: 'CN', secid: '0.300498' },
  '三一重工': { symbol: '600031', market: 'CN', secid: '1.600031' },
  '中国移动': { symbol: '600941', market: 'CN', secid: '1.600941' },
  '紫金矿业': { symbol: '601899', market: 'CN', secid: '1.601899' },
  // ── 港股 ──
  '腾讯控股': { symbol: '00700', market: 'HK', secid: '116.00700' },
  '腾讯':     { symbol: '00700', market: 'HK', secid: '116.00700' },
  '阿里巴巴': { symbol: '09988', market: 'HK', secid: '116.09988' },
  '阿里':     { symbol: '09988', market: 'HK', secid: '116.09988' },
  '美团':     { symbol: '03690', market: 'HK', secid: '116.03690' },
  '小米':     { symbol: '01810', market: 'HK', secid: '116.01810' },
  '京东':     { symbol: '09618', market: 'HK', secid: '116.09618' },
  '快手':     { symbol: '01024', market: 'HK', secid: '116.01024' },
  '网易':     { symbol: '09999', market: 'HK', secid: '116.09999' },
  '百度':     { symbol: '09888', market: 'HK', secid: '116.09888' },
  '药明生物': { symbol: '02269', market: 'HK', secid: '116.02269' },
  '海底捞':   { symbol: '06862', market: 'HK', secid: '116.06862' },
  '农夫山泉': { symbol: '09633', market: 'HK', secid: '116.09633' },
  // ── 美股 ──
  '苹果':     { symbol: 'AAPL', market: 'US', secid: '105.AAPL' },
  '微软':     { symbol: 'MSFT', market: 'US', secid: '105.MSFT' },
  '谷歌':     { symbol: 'GOOGL', market: 'US', secid: '105.GOOGL' },
  '亚马逊':   { symbol: 'AMZN', market: 'US', secid: '105.AMZN' },
  '特斯拉':   { symbol: 'TSLA', market: 'US', secid: '105.TSLA' },
  '英伟达':   { symbol: 'NVDA', market: 'US', secid: '105.NVDA' },
  '脸书':     { symbol: 'META', market: 'US', secid: '105.META' },
  'Meta':     { symbol: 'META', market: 'US', secid: '105.META' },
  '奈飞':     { symbol: 'NFLX', market: 'US', secid: '105.NFLX' },
  '伯克希尔': { symbol: 'BRK-B', market: 'US', secid: '106.BRK-B' },
  '台积电':   { symbol: 'TSM', market: 'US', secid: '106.TSM' },
  '可口可乐': { symbol: 'KO', market: 'US', secid: '106.KO' },
  '麦当劳':   { symbol: 'MCD', market: 'US', secid: '106.MCD' },
  '星巴克':   { symbol: 'SBUX', market: 'US', secid: '105.SBUX' },
  '英特尔':   { symbol: 'INTC', market: 'US', secid: '105.INTC' },
  'AMD':      { symbol: 'AMD', market: 'US', secid: '105.AMD' },
  '高通':     { symbol: 'QCOM', market: 'US', secid: '105.QCOM' },
  '博通':     { symbol: 'AVGO', market: 'US', secid: '105.AVGO' },
  '甲骨文':   { symbol: 'ORCL', market: 'US', secid: '106.ORCL' },
  '迪士尼':   { symbol: 'DIS', market: 'US', secid: '106.DIS' },
  '耐克':     { symbol: 'NKE', market: 'US', secid: '106.NKE' },
  '波音':     { symbol: 'BA', market: 'US', secid: '106.BA' },
  '强生':     { symbol: 'JNJ', market: 'US', secid: '106.JNJ' },
  '辉瑞':     { symbol: 'PFE', market: 'US', secid: '106.PFE' },
  '礼来':     { symbol: 'LLY', market: 'US', secid: '106.LLY' },
  '摩根大通': { symbol: 'JPM', market: 'US', secid: '106.JPM' },
  '高盛':     { symbol: 'GS', market: 'US', secid: '106.GS' },
  '优步':     { symbol: 'UBER', market: 'US', secid: '106.UBER' },
  '拼多多':   { symbol: 'PDD', market: 'US', secid: '105.PDD' },
  '蔚来':     { symbol: 'NIO', market: 'US', secid: '106.NIO' },
  '理想汽车': { symbol: 'LI', market: 'US', secid: '105.LI' },
  '小鹏':     { symbol: 'XPEV', market: 'US', secid: '106.XPEV' },
};

// 出现在问题里但几乎不可能是股票代码的英文词（防止误解析）
const TICKER_STOPWORDS = new Set([
  'AI', 'THE', 'AND', 'ETF', 'IPO', 'PE', 'PB', 'ROE', 'EPS', 'GDP', 'CEO', 'CFO',
  'US', 'UK', 'OK', 'GO', 'NO', 'TO', 'AT', 'ON', 'IN', 'IS', 'IT', 'AS', 'OR',
  'OF', 'BY', 'BE', 'WE', 'HE', 'SHE', 'YOU', 'ARE', 'WAS', 'HAS', 'HAD', 'NOT',
  'BUT', 'FOR', 'WITH', 'FROM', 'THIS', 'THAT', 'THEN', 'THAN', 'WHAT', 'WHEN',
  'WHY', 'HOW', 'MUCH', 'MANY', 'MORE', 'MOST', 'SELL', 'BUY', 'LONG', 'SHORT',
  'RISK', 'FUND', 'LTD', 'INC', 'NYSE', 'NASDAQ', 'USD', 'CNY', 'HKD', 'A股', 'B股',
]);

// ─── 简单 TTL 缓存（带失败负缓存，避免打爆接口） ──────────
const cache = new Map();
const ERROR_TTL_MS = 60000; // 失败后 1 分钟内不再重试同一个 key

function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit) {
    const ttl = hit.error ? ERROR_TTL_MS : ttlMs;
    if (Date.now() - hit.at < ttl) return hit.value;
    cache.delete(key);
  }
  const p = Promise.resolve().then(loader);
  p.then(
    () => cache.set(key, { at: Date.now(), value: p }),
    () => cache.set(key, { at: Date.now(), value: p, error: true }),
  );
  cache.set(key, { at: Date.now(), value: p });
  return p;
}

// ─── 通用请求 ────────────────────────────────────────────
async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MasterDebate/1.0)',
        Accept: 'application/json, text/plain, */*',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ─── 名称/代码解析 ───────────────────────────────────────
const MARKET_BY_CLASS = { AStock: 'CN', HK: 'HK', UsStock: 'US' };

async function searchEastMoney(keyword) {
  const url = `${EM_SUGGEST}?input=${encodeURIComponent(keyword)}&type=14&token=${EM_TOKEN}&count=10`;
  const json = await fetchJson(url);
  const rows = json?.QuotationCodeTable?.Data || [];
  return rows
    .filter((r) => MARKET_BY_CLASS[r.Classify] && r.QuoteID && r.Code)
    .map((r) => ({
      symbol: String(r.Code),
      market: MARKET_BY_CLASS[r.Classify],
      secid: String(r.QuoteID),
      name: r.Name || null,
      exchange: r.SecurityTypeName || null,
    }));
}

function looksLikeAStockCode(t) {
  return /^\d{6}$/.test(t);
}

function secidFromACode(code) {
  // 沪市：6/68/60 开头；深市：0/3 开头
  return code.startsWith('6') ? `1.${code}` : `0.${code}`;
}

async function resolveTicker(t) {
  // 用东财搜索解析代码（美股需要知道交易所前缀，A股数字代码可直接推导）
  if (looksLikeAStockCode(t)) {
    return { symbol: t, market: 'CN', secid: secidFromACode(t) };
  }
  return cached(`resolve:${t}`, 86400000, async () => {
    const list = await searchEastMoney(t);
    if (!list.length) return null;
    const exact = list.find((x) => x.symbol.toUpperCase() === t.toUpperCase());
    return exact || list[0];
  });
}

/**
 * 从用户问题中解析出要拉取的公司列表（最多 5 个）
 * @returns {Promise<Array<{symbol, market, secid, name?, source?}>>}
 */
export async function resolveSymbols(query) {
  if (!query || typeof query !== 'string') return [];
  const found = new Map(); // secid -> info

  // 1) 中文名/别名词典匹配（按长度倒序，避免短名先命中）
  const names = Object.keys(COMMON_SYMBOLS).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (query.includes(name)) {
      const info = COMMON_SYMBOLS[name];
      if (!found.has(info.secid)) found.set(info.secid, { ...info, name, source: 'dict' });
    }
  }

  // 2) 英文代码匹配（美股代码 / 数字 A 股代码）
  const tickers = new Set();
  const matches = query.match(/\b[A-Z]{2,5}\b/g) || [];
  matches.forEach((t) => {
    if (!TICKER_STOPWORDS.has(t)) tickers.add(t);
  });
  const codeMatches = query.match(/\b\d{6}\b/g) || [];
  codeMatches.forEach((c) => {
    if (/^(6|0|3)\d{5}$/.test(c)) tickers.add(c);
  });

  for (const t of tickers) {
    try {
      const info = await resolveTicker(t);
      if (info && !found.has(info.secid)) found.set(info.secid, { ...info, source: 'ticker' });
    } catch (e) {
      // 单个解析失败不影响其他
    }
  }

  return Array.from(found.values()).slice(0, 5);
}

// ─── 实时行情（东方财富） ────────────────────────────────
async function fetchQuoteEM(secid) {
  const fields = 'f43,f57,f58,f59,f60,f116,f162,f167,f170';
  const url = `${EM_QUOTE}?secid=${encodeURIComponent(secid)}&fields=${fields}`;
  const json = await fetchJson(url);
  const d = json?.data;
  if (!d || d.f57 == null) throw new Error('无行情数据');
  const scale = 10 ** (d.f59 ?? 2); // f59 为小数位数
  return {
    symbol: String(d.f57),
    name: d.f58 || null,
    price: d.f43 != null ? d.f43 / scale : null,
    prevClose: d.f60 != null ? d.f60 / scale : null,
    changePct: d.f170 != null ? d.f170 / 100 : null,
    pe: d.f162 && d.f162 > 0 ? d.f162 / 100 : null, // PE 固定两位小数
    pb: d.f167 && d.f167 > 0 ? d.f167 / 100 : null, // PB 固定两位小数
    marketCap: d.f116 || null,
    currency: null,
  };
}


// 给 Promise 加超时（Yahoo 在某些网络不可达时可能卡住）
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Yahoo 请求超时')), ms)),
  ]);
}

// ─── Yahoo Finance（美股/港股补充） ──────────────────────
let yfPromise;
function getYahoo() {
  if (!yfPromise) {
    yfPromise = import('yahoo-finance2').then(
      (m) => new m.default({ suppressNotices: ['yahooSurvey'] }),
    );
  }
  return yfPromise;
}

async function fetchQuoteYahoo(symbol) {
  const yf = await getYahoo();
  const q = await yf.quote(symbol);
  if (!q || !q.regularMarketPrice) throw new Error('Yahoo 无行情');
  return {
    symbol: q.symbol || symbol,
    name: q.shortName || q.longName || null,
    price: q.regularMarketPrice ?? null,
    changePct: q.regularMarketChangePercent ?? null,
    pe: q.trailingPE ?? q.forwardPE ?? null,
    forwardPe: q.forwardPE ?? null,
    pb: q.priceToBook ?? null,
    marketCap: q.marketCap ?? null,
    dividendYield: q.dividendYield != null ? q.dividendYield * 100 : null,
    fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? null,
    currency: q.currency || null,
  };
}

async function fetchFinancialsYahoo(symbol) {
  const yf = await getYahoo();
  const s = await yf.quoteSummary(symbol, {
    modules: ['financialData', 'defaultKeyStatistics', 'summaryDetail', 'recommendationTrend'],
  });
  const fd = s?.financialData || {};
  const dk = s?.defaultKeyStatistics || {};
  const sd = s?.summaryDetail || {};
  const rt = s?.recommendationTrend?.[0] || {};
  return {
    source: 'yahoo',
    currency: sd.currency || fd.currency || 'USD',
    revenue: fd.totalRevenue ?? null,
    revenueGrowth: fd.totalRevenueGrowth != null ? fd.totalRevenueGrowth * 100 : null,
    grossMargin: fd.grossMargins != null ? fd.grossMargins * 100 : null,
    operatingMargin: fd.operatingMargins != null ? fd.operatingMargins * 100 : null,
    netMargin: fd.profitMargins != null ? fd.profitMargins * 100 : null,
    roe: fd.returnOnEquity != null ? fd.returnOnEquity * 100 : null,
    roa: fd.returnOnAssets != null ? fd.returnOnAssets * 100 : null,
    freeCashflow: fd.freeCashflow ?? null,
    operatingCashflow: fd.operatingCashflow ?? null,
    eps: dk.trailingEps ?? null,
    forwardEps: dk.forwardEps ?? null,
    bookValue: dk.bookValue ?? null,
    priceToBook: dk.priceToBook ?? null,
    forwardPe: sd.forwardPE ?? null,
    dividendYield: sd.dividendYield != null ? sd.dividendYield * 100 : null,
    beta: sd.beta ?? null,
    targetMeanPrice: fd.targetMeanPrice ?? null,
    recommendationKey: fd.recommendationKey ?? null,
    numberOfAnalystOpinions: fd.numberOfAnalystOpinions ?? null,
  };
}

// ─── 财务数据（A股：东方财富 F10；港股/美股：Yahoo） ─────
function secidToF10Code(secid) {
  const [mkt, code] = String(secid).split('.');
  if (mkt === '1') return `SH${code}`;
  if (mkt === '0') return `SZ${code}`;
  return null;
}

function pickFinancialRow(r) {
  if (!r) return null;
  return {
    reportName: r.REPORT_DATE_NAME || null,
    reportDate: r.REPORT_DATE ? String(r.REPORT_DATE).slice(0, 10) : null,
    revenue: r.TOTALOPERATEREVE ?? null,
    revenueGrowth: r.TOTALOPERATEREVETZ ?? null,
    netProfit: r.PARENTNETPROFIT ?? null,
    netProfitGrowth: r.PARENTNETPROFITTZ ?? null,
    grossMargin: r.XSMLL ?? null,
    netMargin: r.XSJLL ?? null,
    roe: r.ROEJQ ?? null,
    eps: r.EPSJB ?? null,
    bps: r.BPS ?? null,
    cashFlowPerShare: r.MGJYXJJE ?? null,
  };
}

async function fetchFinancialsCN(secid) {
  const code = secidToF10Code(secid);
  if (!code) throw new Error('非 A 股，无 F10');
  const url = `${EM_F10}?type=0&code=${code}`;
  const json = await fetchJson(url, 10000);
  const rows = json?.data || [];
  if (!rows.length) throw new Error('无财务数据');
  const latest = pickFinancialRow(rows[0]);
  const annual = pickFinancialRow(rows.find((r) => r.REPORT_TYPE === '年报') || null);
  return { source: 'eastmoney', latest, annual };
}

// 美股财务主要指标（东财 datacenter，国内可用）
async function resolveEMSecucode(symbol) {
  const params = new URLSearchParams({
    reportName: 'RPT_USF10_INFO_ORGPROFILE',
    columns: 'SECUCODE,SECURITY_CODE',
    filter: `(SECURITY_CODE="${symbol}")`,
    pageNumber: '1', pageSize: '200', source: 'SECURITIES', client: 'PC',
  });
  const json = await fetchJson(`${EM_DATACENTER}?${params}`);
  return json?.result?.data?.[0]?.SECUCODE || null;
}

function pickUSRow(r) {
  if (!r) return null;
  return {
    reportName: r.REPORT_DATA_TYPE || r.REPORT_TYPE || null,
    reportDate: r.REPORT_DATE ? String(r.REPORT_DATE).slice(0, 10) : null,
    revenue: r.OPERATE_INCOME ?? null,
    revenueGrowth: r.OPERATE_INCOME_YOY ?? null,
    netProfit: r.PARENT_HOLDER_NETPROFIT ?? null,
    netProfitGrowth: r.PARENT_HOLDER_NETPROFIT_YOY ?? null,
    grossMargin: r.GROSS_PROFIT_RATIO ?? null,
    netMargin: r.NET_PROFIT_RATIO ?? null,
    roe: r.ROE_AVG ?? null,
    roa: r.ROA ?? null,
    eps: r.BASIC_EPS ?? null,
    debtAssetRatio: r.DEBT_ASSET_RATIO ?? null,
  };
}

async function fetchFinancialsUS(symbol) {
  const secucode = await cached(`ussecu:${symbol}`, 86400000, () => resolveEMSecucode(symbol));
  if (!secucode) throw new Error('美股无财务代码');
  const params = new URLSearchParams({
    reportName: 'RPT_USF10_FN_GMAININDICATOR',
    columns: 'USF10_FN_GMAININDICATOR',
    filter: `(SECUCODE="${secucode}")`,
    pageNumber: '1', pageSize: '12', sortTypes: '-1', sortColumns: 'REPORT_DATE',
    source: 'SECURITIES', client: 'PC',
  });
  const json = await fetchJson(`${EM_DATACENTER}?${params}`);
  const rows = json?.result?.data || [];
  if (!rows.length) throw new Error('美股无财务数据');
  return {
    source: 'eastmoney-us',
    currency: rows[0].CURRENCY_ABBR || 'USD',
    latest: pickUSRow(rows[0]),
    annual: pickUSRow(rows.find((r) => String(r.DATE_TYPE_CODE) === '001') || null),
  };
}

// 港股财务主要指标（东财 datacenter，国内可用）
function pickHKRow(r) {
  if (!r) return null;
  return {
    reportName: r.REPORT_TYPE || null,
    reportDate: r.REPORT_DATE ? String(r.REPORT_DATE).slice(0, 10) : null,
    revenue: r.OPERATE_INCOME ?? null,
    revenueGrowth: r.OPERATE_INCOME_YOY ?? null,
    netProfit: r.HOLDER_PROFIT ?? null,
    netProfitGrowth: r.HOLDER_PROFIT_YOY ?? null,
    grossMargin: r.GROSS_PROFIT_RATIO ?? null,
    netMargin: r.NET_PROFIT_RATIO ?? null,
    roe: r.ROE_AVG ?? null,
    eps: r.BASIC_EPS ?? null,
    bps: r.BPS ?? null,
    epsTTM: r.EPS_TTM ?? null,
  };
}

async function fetchFinancialsHK(symbol) {
  const code = String(symbol).padStart(5, '0');
  const params = new URLSearchParams({
    reportName: 'RPT_HKF10_FN_MAININDICATOR',
    columns: 'ALL',
    filter: `(SECUCODE="${code}.HK")`,
    pageNumber: '1', pageSize: '12', sortTypes: '-1', sortColumns: 'REPORT_DATE',
    source: 'HSF10', client: 'PC',
  });
  const json = await fetchJson(`${EM_DATACENTER}?${params}`);
  const rows = json?.result?.data || [];
  if (!rows.length) throw new Error('港股无财务数据');
  return {
    source: 'eastmoney-hk',
    currency: 'HKD',
    latest: pickHKRow(rows[0]),
    annual: pickHKRow(rows.find((r) => String(r.DATE_TYPE_CODE) === '001') || null),
  };
}

// ─── 对外主入口：行情 + 财务 ─────────────────────────────
/**
 * 获取单只股票的行情（东财为主，美股/港股用 Yahoo 补字段）
 */
export async function getQuote(info) {
  let em = null;
  try {
    em = await cached(`quote:${info.secid}`, 180000, () => fetchQuoteEM(info.secid));
  } catch (e) {
    // 东财失败则继续尝试 Yahoo
  }
  if (info.market === 'CN') return em;
  try {
    const y = await withTimeout(cached(`yquote:${info.symbol}`, 180000, () => fetchQuoteYahoo(info.symbol)), 2500);
    if (em) return { ...em, ...y };
    return y;
  } catch (e) {
    return em;
  }
}

/**
 * 获取单只股票的财务快照（A股：东财 F10；港股/美股：Yahoo，失败返回 null）
 */
export async function getFinancials(info) {
  if (info.market === 'CN') {
    return cached(`fin:${info.secid}`, 1800000, () => fetchFinancialsCN(info.secid));
  }
  if (info.market === 'HK') {
    return cached(`finhk:${info.symbol}`, 1800000, () => fetchFinancialsHK(info.symbol));
  }
  if (info.market === 'US') {
    const base = await cached(`finus:${info.symbol}`, 1800000, () => fetchFinancialsUS(info.symbol));
    // 生产环境用 Yahoo 补充分析师目标价/评级（国内不可达时忽略）
    try {
      const y = await withTimeout(cached(`yfin:${info.symbol}`, 3600000, () => fetchFinancialsYahoo(info.symbol)), 3000);
      if (y) {
        return {
          ...base,
          targetMeanPrice: y.targetMeanPrice,
          recommendationKey: y.recommendationKey,
          numberOfAnalystOpinions: y.numberOfAnalystOpinions,
        };
      }
    } catch (e) { /* 忽略 */ }
    return base;
  }
  return null;
}
