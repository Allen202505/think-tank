/**
 * uziSkills.js —— UZI-Skill 方法论移植（数据维度 + 机构方法）
 * ------------------------------------------------------------------
 * 借鉴 wbh604/UZI-Skill 开源项目的数据维度与分析方法，适配「大师吵股」
 * 现有架构（Next.js / Vercel serverless，Node 环境，纯免费公开接口）。
 *
 * 覆盖能力：
 *  1. 五年财务历史（营收/净利/增速/ROE/毛利率/现金流/总股本）——东财 MAINFINADATA
 *  2. PE/PB 近 5 年估值分位（K线年度收盘 × 年报 EPS/BPS 自算）
 *  3. K线 + 技术指标（MA/RSI/MACD/KDJ/波动率/回撤/放量）——东财 push2his
 *  4. 龙虎榜（游资席位、净买卖额）——东财 datacenter
 *  5. 研报评级（近 12 月评级分布 + 盈利预测）——东财 reportapi
 *  6. 北向资金整体净流入（个股持仓明细 2024-08 起已停发，只给整体）
 *  7. 6 平台社交热榜命中（微博/知乎/百度/抖音/头条/B站，单平台失败不影响）
 *  8. 杀猪盘量化扫描（K线异常 + 基本面热度脱节 + 跨平台联动）
 *  9. DCF 估值（WACC + 两段 FCF + 永续终值 + 安全边际）——移植 fin_models.py
 * 10. 同行对标（同行业板块市值 Top 可比 + 中位数分位）
 *
 * 数据安全：每个维度独立 try/catch + TTL 缓存 + 超时，单个维度失败只缺该项，
 * 不拖垮整个快照；快照里没有的字段不允许 AI 编造（提示词层约束）。
 */
import { getYahoo, withTimeout } from './marketData.js';

// ─── 常量 ────────────────────────────────────────────────
const DW = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const EM_F10_MAIN = 'https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew';
const EM_F10_COMPANY = 'https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax';
const EM_KLINE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const EM_CLIST = 'https://push2.eastmoney.com/api/qt/clist/get';
const EM_REPORT = 'https://reportapi.eastmoney.com/report/list';
const REQ_TIMEOUT = 8000;
const UA = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
};

// ─── 缓存（同 marketData.js 约定：失败负缓存 60s） ────────
const cache = new Map();
const ERROR_TTL_MS = 60000;

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

async function fetchJson(url, timeoutMs = REQ_TIMEOUT) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const num = (v) => {
  if (v == null || v === '' || Number.isNaN(Number(v))) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const yi = (v) => (num(v) == null ? null : num(v) / 1e8); // 元 → 亿
const pct = (v, digits = 1) => (num(v) == null ? null : `${v > 0 ? '+' : ''}${num(v).toFixed(digits)}%`);
const f2 = (v) => (num(v) == null ? null : num(v).toFixed(2));

// ─── 1. 五年财务历史 ─────────────────────────────────────
/**
 * A股：东财 F10 主要财务指标历史（ZYZBAjaxNew 一次返回 9-12 期）
 */
export async function getFinHistory(info) {
  if (info.market !== 'CN') return null;
  return cached(`uzi:fin:${info.secid}`, 6 * 3600000, async () => {
    const code = secidToF10Code(info.secid);
    if (!code) throw new Error('非 A 股');
    // MAINFINADATA：一次返回 12 期，含营收/净利/ROE/现金流净额/总股本
    const p = new URLSearchParams({
      reportName: 'RPT_F10_FINANCE_MAINFINADATA',
      columns: 'ALL',
      filter: `(SECUCODE="${info.symbol}.${code.startsWith('SH') ? 'SH' : 'SZ'}")`,
      sortColumns: 'REPORT_DATE', sortTypes: '-1',
      pageNumber: '1', pageSize: '24',
      source: 'HSF10', client: 'PC',
    });
    let json;
    try {
      json = await fetchJson(`${DW}?${p}`, 10000);
    } catch (e) {
      // 兜底：F10 ZYZBAjaxNew
      json = await fetchJson(`${EM_F10_MAIN}?type=0&code=${code}`, 10000);
    }
    const rows = (json?.result?.data || json?.data || []);
    if (!rows.length) throw new Error('无财务历史');
    return rows.map((r) => ({
      reportDate: r.REPORT_DATE ? String(r.REPORT_DATE).slice(0, 10) : null,
      reportName: r.REPORT_DATE_NAME || null,
      reportType: r.REPORT_TYPE || null,
      revenue: num(r.TOTALOPERATEREVE),
      revenueGrowth: num(r.TOTALOPERATEREVETZ),
      netProfit: num(r.PARENTNETPROFIT),
      netProfitGrowth: num(r.PARENTNETPROFITTZ),
      roe: num(r.ROEJQ),
      grossMargin: num(r.XSMLL),
      netMargin: num(r.XSJLL),
      eps: num(r.EPSJB),
      bps: num(r.BPS),
      cashFlowPerShare: num(r.MGJYXJJE),
      debtRatio: num(r.ZCFZL),
      ocf: num(r.NETCASH_OPERATE_PK) != null ? num(r.NETCASH_OPERATE_PK) : (num(r.MGJYXJJE) != null ? num(r.MGJYXJJE) * (num(r.TOTAL_SHARE) || 1) : null),
      totalShare: num(r.TOTAL_SHARE),
      roic: num(r.ROIC),
    }));
  });
}

function secidToF10Code(secid) {
  const [mkt, code] = String(secid).split('.');
  if (mkt === '1') return `SH${code}`;
  if (mkt === '0') return `SZ${code}`;
  return null;
}

function pickAnnualRows(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((r) => r.reportName && /年报|年度/.test(r.reportName))
    .sort((a, b) => String(a.reportDate).localeCompare(String(b.reportDate)));
}

// ─── 3. K线（A股 push2his；美股/港股 Yahoo） ─────────────
export async function getKline(info) {
  return cached(`uzi:kl:${info.secid}`, 6 * 3600000, async () => {
    if (info.market === 'CN') return fetchKlineEM(info.secid);
    // 美股/港股：Yahoo 优先（Vercel 海外可用），东财 push2his 兜底（大陆可用）
    try {
      return await fetchKlineYahoo(info.symbol);
    } catch (e) {
      return await fetchKlineEM(info.secid);
    }
  });
}

function _secidToCn(secid) {
  // 东财 secid → 腾讯/新浪代码：1.600519→sh600519, 0.300308→sz300308
  const [mkt, code] = String(secid).split('.');
  if (mkt === '1') return `sh${code}`;
  if (mkt === '0') return `sz${code}`;
  return null;
}

async function fetchKlineEM(secid) {
  let kl = null;

  // 1) 东财 push2his（主源，大陆偶发反爬）
  try {
    const url = `${EM_KLINE}?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3&fields2=f51,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=320`;
    const json = await fetchJson(url, 12000);
    const rows = json?.data?.klines || [];
    if (rows.length) {
      kl = rows.map((k) => {
        const [date, close, high, low, vol] = k.split(',');
        return { date, close: Number(close), high: Number(high), low: Number(low), vol: Number(vol) };
      });
    }
  } catch (e) { /* 走备用 */ }

  // 2) 腾讯（备源）
  if (!kl) {
    const sym = _secidToCn(secid);
    if (sym) {
      try {
        const json = await fetchJson(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sym},day,,,320,qfq`, 10000);
        const rows = (((json?.data || {})[sym] || {}).qfqday) || [];
        if (rows.length) {
          kl = rows.map((x) => ({ date: x[0], close: Number(x[2]), high: Number(x[3]), low: Number(x[4]), vol: Number(x[5] || 0) }));
        }
      } catch (e) { /* 继续 */ }
    }
  }

  // 3) 新浪（兜底）
  if (!kl) {
    const sym = _secidToCn(secid);
    if (sym) {
      try {
        const json = await fetchJson(`https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sym}&scale=240&ma=no&datalen=320`, 10000);
        if (Array.isArray(json)) {
          kl = json.map((x) => ({ date: x.day, close: Number(x.close), high: Number(x.high), low: Number(x.low), vol: Number(x.volume || 0) }));
        }
      } catch (e) { /* 放弃 */ }
    }
  }

  if (!kl || !kl.length) throw new Error('K线源均失败');
  return kl;
}

async function fetchKlineYahoo(symbol) {
  const yf = await getYahoo();
  // yahoo-finance2 的 chart() 要求 period1/period2（Date 对象），range 会被 schema 拒绝
  const period2 = new Date();
  const period1 = new Date(period2.getTime() - 2 * 365 * 24 * 3600000);
  const chart = await withTimeout(yf.chart(symbol, { period1, period2, interval: '1d' }), 8000);
  const res = chart && chart.result && chart.result[0];
  if (!res || !res.timestamp || !res.indicators || !res.indicators.quote) throw new Error('Yahoo 无K线');
  const ts = res.timestamp;
  const q = res.indicators.quote[0];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q.close && q.close[i];
    if (close == null) continue;
    out.push({
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      close: Number(close),
      high: q.high && q.high[i] != null ? Number(q.high[i]) : Number(close),
      low: q.low && q.low[i] != null ? Number(q.low[i]) : Number(close),
      vol: q.volume && q.volume[i] != null ? Number(q.volume[i]) : 0,
    });
  }
  if (out.length < 5) throw new Error('Yahoo K线不足');
  return out;
}

// ─── 技术指标计算（移植 fetch_kline.py 思路） ─────────────
function ema(values, n) {
  if (!values.length) return null;
  const k = 2 / (n + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}
function sma(values, n) {
  if (values.length < n) return null;
  return values.slice(-n).reduce((a, b) => a + b, 0) / n;
}
function rsi14(closes) {
  if (closes.length < 15) return null;
  let gain = 0, loss = 0;
  for (let i = closes.length - 14; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = gain / 14 / (loss / 14);
  return 100 - 100 / (1 + rs);
}
function macd(closes) {
  if (closes.length < 35) return { dif: null, dea: null, hist: null };
  const difArr = [];
  let e12 = closes[0], e26 = closes[0];
  const k12 = 2 / 13, k26 = 2 / 27;
  for (const c of closes) {
    e12 = c * k12 + e12 * (1 - k12);
    e26 = c * k26 + e26 * (1 - k26);
    difArr.push(e12 - e26);
  }
  const dea = ema(difArr.slice(-9), 9);
  const dif = difArr[difArr.length - 1];
  return { dif, dea, hist: dea == null ? null : (dif - dea) * 2 };
}
function kdj(klines) {
  if (klines.length < 9) return { k: null, d: null, j: null };
  const window = klines.slice(-9);
  const low9 = Math.min(...window.map((k) => k.low));
  const high9 = Math.max(...window.map((k) => k.high));
  const rsv = high9 === low9 ? 50 : ((klines[klines.length - 1].close - low9) / (high9 - low9)) * 100;
  return { k: rsv, d: rsv, j: rsv };
}

export function computeIndicators(klines) {
  if (!Array.isArray(klines) || klines.length < 5) return null;
  const closes = klines.map((k) => k.close);
  const last = klines[klines.length - 1].close;
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  // 近 60/20 日涨幅
  const chg60d = closes.length > 60 ? (last / closes[closes.length - 61] - 1) * 100 : null;
  const chg20d = closes.length > 20 ? (last / closes[closes.length - 21] - 1) * 100 : null;
  // 年内涨幅
  const year = klines[klines.length - 1].date.slice(0, 4);
  const firstOfYear = klines.find((k) => k.date.slice(0, 4) === year);
  const ytd = firstOfYear ? (last / firstOfYear.close - 1) * 100 : null;
  // 年化波动率（近 60 日收益率标准差 × √252）
  let vol = null;
  if (closes.length > 30) {
    const rets = [];
    for (let i = closes.length - 60; i < closes.length; i++) {
      if (i > 0 && closes[i - 1] > 0) rets.push(closes[i] / closes[i - 1] - 1);
    }
    if (rets.length > 2) {
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
      vol = Math.sqrt(varr) * Math.sqrt(252) * 100;
    }
  }
  // 最大回撤（近一年）
  let maxDrawdown = null;
  const lastYear = klines.slice(-252);
  if (lastYear.length > 20) {
    let peak = lastYear[0].close;
    let mdd = 0;
    for (const k of lastYear) {
      if (k.close > peak) peak = k.close;
      const dd = (k.close - peak) / peak;
      if (dd < mdd) mdd = dd;
    }
    maxDrawdown = mdd * 100;
  }
  // 放量倍数（最新成交量 / 20 日均量）
  const vols = klines.map((k) => k.vol);
  const avgVol = sma(vols, 20);
  const volumeRatio = avgVol ? vols[vols.length - 1] / avgVol : null;
  // 52 周高低
  const win = klines.slice(-250);
  const high52w = Math.max(...win.map((k) => k.high));
  const low52w = Math.min(...win.map((k) => k.low));
  // 均线排列
  const trend = [ma5, ma10, ma20, ma60].every((x) => x != null) && ma5 > ma10 && ma10 > ma20 && ma20 > ma60 ? '多头排列' :
    ma5 < ma10 && ma10 < ma20 ? '空头排列' : '震荡';
  // 连续涨停（近 10 日）
  let limitUpStreak = 0;
  for (let i = klines.length - 1; i >= 1 && i >= klines.length - 10; i--) {
    const d = (klines[i].close / klines[i - 1].close - 1) * 100;
    if (d >= 9.5) limitUpStreak++;
    else break;
  }
  const macdV = macd(closes);
  const kdjV = kdj(klines);
  return {
    lastClose: last,
    lastDate: klines[klines.length - 1].date,
    ma5: f2(ma5), ma10: f2(ma10), ma20: f2(ma20), ma60: f2(ma60),
    trend,
    rsi14: f2(rsi14(closes)),
    macd: { dif: f2(macdV.dif), dea: f2(macdV.dea), hist: f2(macdV.hist) },
    kdj: { k: f2(kdjV.k), d: f2(kdjV.d), j: f2(kdjV.j) },
    chg20d: f2(chg20d), chg60d: f2(chg60d), ytd: f2(ytd),
    volatility: f2(vol), maxDrawdown: f2(maxDrawdown),
    volumeRatio: f2(volumeRatio), limitUpStreak,
    high52w, low52w,
  };
}

// ─── 缠论指标（分型/笔/中枢/背驰 · 能力包 chan_theory 的数据钩子） ───
// 简化公开实现：三根K线确认分型 → 交替顶底分型连笔 → 最近三笔重叠区为中枢 →
// 最近两笔力度（收盘-中价偏移累积）对比判背驰。仅移植公开数学规则，无第三方代码。
export function computeChanIndicators(klines) {
  if (!Array.isArray(klines) || klines.length < 30) return null;

  // K线包含关系处理（缠论标准步骤）：按方向合并包含的K线，避免分型被包含K线干扰
  const merged = [];
  for (const k of klines) {
    if (!merged.length) { merged.push({ high: k.high, low: k.low }); continue; }
    const last = merged[merged.length - 1];
    const lastContainsB = last.high >= k.high && last.low <= k.low;
    const bContainsLast = k.high >= last.high && k.low <= last.low;
    if (lastContainsB || bContainsLast) {
      const prev = merged[merged.length - 2];
      let dir = 'up';
      if (prev) dir = last.high > prev.high ? 'up' : 'down';
      if (dir === 'up') {
        last.high = Math.max(last.high, k.high);
        last.low = Math.max(last.low, k.low);
      } else {
        last.high = Math.min(last.high, k.high);
        last.low = Math.min(last.low, k.low);
      }
    } else {
      merged.push({ high: k.high, low: k.low });
    }
  }

  const highs = merged.map((m) => m.high);
  const lows = merged.map((m) => m.low);
  const closes = klines.map((k) => k.close);
  const mids = klines.map((k, i) => closes[i] - (klines[i].high + klines[i].low) / 2);

  // 分型（基于合并后的K线）
  const fractals = [];
  for (let i = 1; i < merged.length - 1; i++) {
    const isTop = highs[i] > highs[i - 1] && highs[i] > highs[i + 1] && lows[i] > lows[i - 1] && lows[i] > lows[i + 1];
    const isBottom = lows[i] < lows[i - 1] && lows[i] < lows[i + 1] && highs[i] < highs[i - 1] && highs[i] < highs[i + 1];
    if (isTop) fractals.push({ i, type: 'top', high: highs[i], low: lows[i] });
    else if (isBottom) fractals.push({ i, type: 'bottom', high: highs[i], low: lows[i] });
  }
  if (fractals.length < 2) return { note: 'K线不足以构成有效分型' };

  // 笔：交替顶底分型，合并K线间隔 ≥4（即一笔至少 5 根合并K线）
  const pens = [];
  let prev = fractals[0];
  for (const f of fractals.slice(1)) {
    if (f.type === prev.type) {
      if ((f.type === 'top' && f.high > prev.high) || (f.type === 'bottom' && f.low < prev.low)) prev = f;
      continue;
    }
    if (f.i - prev.i < 4) continue;
    pens.push({ start: prev, end: f, up: f.type === 'top' });
    prev = f;
  }
  if (pens.length < 2) return { note: 'K线不足以构成有效笔' };

  // 中枢：连续三笔价格区间重叠（ZG=三段高点取小，ZD=三段低点取大）
  const zhongs = [];
  for (let sIdx = 0; sIdx <= pens.length - 3; sIdx++) {
    const seg = pens.slice(sIdx, sIdx + 3);
    const hi = Math.min(...seg.map((p) => Math.max(p.start.high, p.end.high)));
    const lo = Math.max(...seg.map((p) => Math.min(p.start.low, p.end.low)));
    if (hi > lo) zhongs.push({ high: hi, low: lo });
  }
  const currentZhong = zhongs.length ? zhongs[zhongs.length - 1] : null;
  const lastClose = closes[closes.length - 1];
  const inZhong = currentZhong ? lastClose >= currentZhong.low && lastClose <= currentZhong.high : null;

  // 背驰：最近两笔力度（收盘-中价偏移累积）对比
  let divergence = null;
  const lastPen = pens[pens.length - 1];
  const prevPen = pens[pens.length - 2];
  const area = (p1, p2) => { let sum = 0; for (let i = p1.i; i <= p2.i; i++) sum += mids[i]; return sum; };
  const a1 = area(prevPen.start, prevPen.end);
  const a2 = area(lastPen.start, lastPen.end);
  const lastHigh = Math.max(lastPen.start.high, lastPen.end.high);
  const lastLow = Math.min(lastPen.start.low, lastPen.end.low);
  const prevHigh = Math.max(prevPen.start.high, prevPen.end.high);
  const prevLow = Math.min(prevPen.start.low, prevPen.end.low);
  if (lastPen.up && lastHigh > prevHigh && Math.abs(a2) < Math.abs(a1) * 0.9) divergence = '顶背驰（上涨力度减弱）';
  else if (!lastPen.up && lastLow < prevLow && Math.abs(a2) < Math.abs(a1) * 0.9) divergence = '底背驰（下跌力度减弱）';

  return {
    penDirection: lastPen.up ? '上升笔' : '下降笔',
    lastFractal: lastPen.end.type === 'top' ? '顶分型' : '底分型',
    currentZhong,
    inZhong,
    divergence,
    price: lastClose,
    // 诊断信息（对比用）
    _debug: { mergedBars: merged.length, pens: pens.length, zhongs: zhongs.length },
  };
}

// ─── 2. 估值分位（近 5 年 PE/PB 百分位） ──────────────────
export async function getValuation(info, quote, finHistory) {
  if (!quote || !finHistory) return null;
  const ann = pickAnnualRows(finHistory).slice(-5);
  if (ann.length < 3) return null;
  // 年度收盘价（不复权，避免分红前复权扭曲估值）
  let yearEndCloses = null;
  try {
    const code = secidToF10Code(info.secid);
    if (info.market === 'CN' && code) {
      const url = `${EM_KLINE}?secid=${encodeURIComponent(info.secid)}&fields1=f1,f2,f3&fields2=f51,f53&klt=101&fqt=0&end=20500101&lmt=1500`;
      const json = await fetchJson(url, 12000);
      const kl = json?.data?.klines || [];
      const byYear = {};
      for (const k of kl) {
        const [date, close] = k.split(',');
        byYear[date.slice(0, 4)] = Number(close);
      }
      yearEndCloses = byYear;
    }
  } catch (e) { /* 忽略 */ }
  if (!yearEndCloses) return null;

  const peHist = [];
  const pbHist = [];
  const years = [];
  for (const r of ann) {
    const y = r.reportDate ? r.reportDate.slice(0, 4) : null;
    const close = y && yearEndCloses[y];
    if (!y || !close) continue;
    if (r.eps && r.eps > 0) peHist.push(close / r.eps);
    if (r.bps && r.bps > 0) pbHist.push(close / r.bps);
    years.push(y);
  }
  if (!peHist.length && !pbHist.length) return null;

  const percentile = (cur, hist) => {
    const sorted = [...hist].sort((a, b) => a - b);
    let rank = 0;
    for (const v of sorted) if (v < cur) rank++;
    return Math.round((rank / sorted.length) * 100);
  };

  const curPe = num(quote.pe);
  const curPb = num(quote.pb);
  return {
    pePercentile: curPe && peHist.length ? percentile(curPe, peHist) : null,
    pbPercentile: curPb && pbHist.length ? percentile(curPb, pbHist) : null,
    peHistory: peHist.map((v) => f2(v)),
    pbHistory: pbHist.map((v) => f2(v)),
    years,
    peBand: curPe && peHist.length ? (percentile(curPe, peHist) >= 80 ? '偏高' : percentile(curPe, peHist) <= 20 ? '偏低' : '中性') : null,
    pbBand: curPb && pbHist.length ? (percentile(curPb, pbHist) >= 80 ? '偏高' : percentile(curPb, pbHist) <= 20 ? '偏低' : '中性') : null,
  };
}

// ─── 4. 龙虎榜 ───────────────────────────────────────────
const INSTITUTIONAL_SEAT = /机构专用|沪股通|深股通|陆股通|中信证券总部|国信证券总部|招商证券总部|中信建投总部/;
export async function getLhb(info) {
  if (info.market !== 'CN') return null;
  return cached(`uzi:lhb:${info.secid}`, 2 * 3600000, async () => {
    const since = new Date(Date.now() - 45 * 24 * 3600000);
    const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;
    const p = new URLSearchParams({
      reportName: 'RPT_BILLBOARD_DAILYDETAILSBUY',
      columns: 'ALL',
      filter: `(SECURITY_CODE="${info.symbol}")(TRADE_DATE>='${sinceStr}')`,
      sortColumns: 'TRADE_DATE',
      sortTypes: '-1',
      pageNumber: '1', pageSize: '30',
      source: 'WEB', client: 'WEB',
    });
    const json = await fetchJson(`${DW}?${p}`);
    const rows = json?.result?.data || [];
    if (!rows.length) throw new Error('近45日无龙虎榜数据');
    const byDate = new Map();
    for (const r of rows) {
      const d = r.TRADE_DATE ? String(r.TRADE_DATE).slice(0, 10) : null;
      if (!d) continue;
      if (!byDate.has(d)) byDate.set(d, { date: d, buy: 0, sell: 0, net: 0, seats: [] });
      const g = byDate.get(d);
      g.buy += num(r.BUY) || 0;
      g.sell += num(r.SELL) || 0;
      g.net += num(r.NET) || 0;
      if (r.OPERATEDEPT_NAME && g.seats.length < 5) {
        g.seats.push({ name: r.OPERATEDEPT_NAME, buy: num(r.BUY), sell: num(r.SELL), inst: INSTITUTIONAL_SEAT.test(r.OPERATEDEPT_NAME) });
      }
    }
    const dates = [...byDate.keys()].sort().reverse().slice(0, 5);
    const totalNet = [...byDate.values()].reduce((a, g) => a + g.net, 0);
    const last = dates[0] ? byDate.get(dates[0]) : null;
    return {
      count: byDate.size,
      dates,
      totalBuy: yi([...byDate.values()].reduce((a, g) => a + g.buy, 0)),
      totalSell: yi([...byDate.values()].reduce((a, g) => a + g.sell, 0)),
      totalNet: yi(totalNet),
      lastDate: dates[0] || null,
      lastNet: last ? yi(last.net) : null,
      lastSeats: last ? last.seats : [],
      instSeats: last ? last.seats.filter((s) => s.inst).length : 0,
      youziSeats: last ? last.seats.filter((s) => !s.inst).length : 0,
      explanation: last && rows.find((r) => String(r.TRADE_DATE).slice(0, 10) === last.date)?.EXPLANATION || null,
    };
  });
}

// ─── 5. 研报评级 ─────────────────────────────────────────
export async function getResearch(info) {
  if (info.market !== 'CN') return null;
  return cached(`uzi:research:${info.symbol}`, 6 * 3600000, async () => {
    const end = new Date();
    const begin = new Date(end.getTime() - 365 * 24 * 3600000);
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const url = `${EM_REPORT}?industryCode=*&pageSize=50&industry=*&rating=*&ratingChange=*&beginTime=${fmt(begin)}&endTime=${fmt(end)}&pageNo=1&fields=&qType=0&orgCode=&code=${encodeURIComponent(info.symbol)}&rcode=`;
    const json = await fetchJson(url, 12000);
    const rows = json?.data || [];
    if (!rows.length) throw new Error('无研报数据');
    const dist = {};
    for (const r of rows) {
      const rating = r.emRatingName || r.ratingName || '其他';
      dist[rating] = (dist[rating] || 0) + 1;
    }
    const recent = rows.slice(0, 6).map((r) => ({
      org: r.orgSName || r.orgName,
      date: r.publishDate ? String(r.publishDate).slice(0, 10) : null,
      title: r.title,
      rating: r.emRatingName || r.ratingName || null,
      thisEps: num(r.predictThisYearEps),
      thisPe: num(r.predictThisYearPe),
      targetPrice: num(r.predictTargetPrice) || num(r.targetPrice),
    }));
    const epsVals = rows.map((r) => num(r.predictThisYearEps)).filter((v) => v != null && v > 0);
    const peVals = rows.map((r) => num(r.predictThisYearPe)).filter((v) => v != null && v > 0);
    return {
      count: rows.length,
      ratingDist: dist,
      avgThisEps: epsVals.length ? epsVals.reduce((a, b) => a + b, 0) / epsVals.length : null,
      avgThisPe: peVals.length ? peVals.reduce((a, b) => a + b, 0) / peVals.length : null,
      recent,
    };
  });
}

// ─── 6. 北向资金整体 ─────────────────────────────────────
export async function getNorthboundAgg() {
  return cached('uzi:northbound', 30 * 60000, async () => {
    const p = new URLSearchParams({
      reportName: 'RPT_MUTUAL_DEAL_HISTORY',
      columns: 'ALL',
      filter: '(MUTUAL_TYPE="001")',
      sortColumns: 'TRADE_DATE', sortTypes: '-1',
      pageNumber: '1', pageSize: '5',
      source: 'WEB', client: 'WEB',
    });
    const json = await fetchJson(`${DW}?${p}`);
    const rows = json?.result?.data || [];
    // 交易所 2024 年起停发北向净买入明细：最近若干行常全为 null，此时不展示
    const row = rows.find((r) => num(r.NET_DEAL_AMT) != null);
    if (!row) throw new Error('北向净买入明细已停发');
    return {
      date: row.TRADE_DATE ? String(row.TRADE_DATE).slice(0, 10) : null,
      netDealAmt: yi(num(row.NET_DEAL_AMT)),
      buyAmt: yi(num(row.BUY_AMT)),
      sellAmt: yi(num(row.SELL_AMT)),
    };
  });
}

// ─── 7. 6 平台社交热榜命中 ───────────────────────────────
const HOT_UA = {
  PC: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  MOBILE: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
};
async function hotJson(url, uaType = 'PC', referer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': HOT_UA[uaType] || HOT_UA.PC,
        Accept: 'application/json, text/plain, */*',
        ...(referer ? { Referer: referer } : {}),
      },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const HOT_FETCHERS = {
  weibo: async () => {
    const d = await hotJson('https://weibo.com/ajax/side/hotSearch', 'PC', 'https://weibo.com/');
    return (d?.data?.realtime || []).slice(0, 50).map((it, i) => ({ rank: i + 1, title: it.word, url: `https://s.weibo.com/weibo?q=${encodeURIComponent(it.word)}`, platform: 'weibo', extra: it.category || '' }));
  },
  zhihu: async () => {
    const d = await hotJson('https://www.zhihu.com/api/v3/feed/topstory/hot-list-web?limit=50&desktop=true', 'PC');
    return (d?.data || []).slice(0, 50).map((it, i) => {
      const t = it.target || {};
      return { rank: i + 1, title: (t.title_area && t.title_area.text) || t.title || '', url: (t.link && t.link.url) || '', platform: 'zhihu', extra: (t.metrics_area && t.metrics_area.text) || '' };
    }).filter((x) => x.title);
  },
  baidu: async () => {
    const d = await hotJson('https://top.baidu.com/api/board?platform=wise&tab=realtime', 'MOBILE');
    const cards = d?.data?.cards || [];
    const items = cards[0] && cards[0].content ? cards[0].content : [];
    return items.slice(0, 50).map((it, i) => ({ rank: i + 1, title: it.word || it.query || '', url: it.url || `https://www.baidu.com/s?wd=${encodeURIComponent(it.word || '')}`, platform: 'baidu', extra: it.hotScore != null ? String(it.hotScore) : '' })).filter((x) => x.title);
  },
  douyin: async () => {
    const d = await hotJson('https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1&source=6', 'PC', 'https://www.douyin.com/');
    return (d?.data?.word_list || []).slice(0, 50).map((it, i) => ({ rank: i + 1, title: it.word || '', url: it.sentence_id ? `https://www.douyin.com/hot/${it.sentence_id}` : '', platform: 'douyin', extra: it.hot_value != null ? String(it.hot_value) : '' })).filter((x) => x.title);
  },
  toutiao: async () => {
    const d = await hotJson('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', 'PC');
    return (d?.data || []).slice(0, 50).map((it, i) => ({ rank: i + 1, title: it.Title || '', url: it.Url || '', platform: 'toutiao', extra: it.HotValue != null ? String(it.HotValue) : '' })).filter((x) => x.title);
  },
  bilibili: async () => {
    const d = await hotJson('https://s.search.bilibili.com/main/hotword', 'PC');
    return (d?.list || []).slice(0, 50).map((it, i) => ({ rank: i + 1, title: it.keyword || '', url: it.show_name ? `https://search.bilibili.com/all?keyword=${encodeURIComponent(it.show_name)}` : '', platform: 'bilibili', extra: it.score != null ? String(it.score) : '' })).filter((x) => x.title);
  },
};

function nameVariants(stockName) {
  const names = new Set([stockName]);
  // 贵州茅台 → 茅台（去常见前缀）
  const withoutPrefix = String(stockName || '').replace(/^(贵州|上海|深圳|广州|中国|新疆|西藏|内蒙|云南|四川|福建|浙江|江苏|山东|湖北|湖南|河南|河北|安徽|江西|广西|海南|陕西|甘肃|青海|宁夏|北京|天津|重庆|山西|辽宁|吉林|黑龙江|台湾|香港)/, '');
  if (withoutPrefix && withoutPrefix !== stockName) names.add(withoutPrefix);
  // 去掉结尾的公司词
  const withoutSuffix = String(stockName || '').replace(/(集团|股份|控股|科技|国际|银行|证券|医药|生物|电子|电力|汽车|食品|传媒|地产|航空|石油|化工|建设|发展|工业|材料|物流|电器|重工|装备|矿业|机械|软件|信息|环保|健康|医疗|商业|贸易|家居|服装|纺织|基建|半导体|光伏|风电|储能|芯片|面板|光学|旅游|酒店|餐饮|调味|化纤|塑料|橡胶|建材|黄金|稀土|煤炭|燃气|水务|港口|高速|租赁|期货|基金|装饰|园林|生态|新能源|智能|数据|网络|游戏|白酒|水泥|玻璃|家电|农牧|种业|电梯|电气|仪表)$/, '');
  if (withoutSuffix && withoutSuffix !== stockName) names.add(withoutSuffix);
  return [...names].filter(Boolean).map((n) => n.toLowerCase());
}

export async function getHotTrends(stockName) {
  if (!stockName) return null;
  const hits = [];
  const platformsOk = [];
  let totalHits = 0;
  await Promise.all(
    Object.entries(HOT_FETCHERS).map(async ([platform, fetcher]) => {
      try {
        const items = await fetcher();
        if (!items || !items.length) return;
        platformsOk.push(platform);
        const variants = nameVariants(stockName);
        for (const it of items) {
          const t = String(it.title || '').toLowerCase();
          if (variants.some((v) => v.length >= 2 && t.includes(v))) {
            totalHits++;
            hits.push(it);
            if (hits.length >= 8) break;
          }
        }
      } catch (e) { /* 单平台失败忽略 */ }
    }),
  );
  return { totalHits, platformCount: platformsOk.length, platformsOk, hits: hits.slice(0, 8) };
}

// ─── 8. 杀猪盘量化扫描 ───────────────────────────────────
export function computeTrapSignals({ kline, finHistory, hotTrends, quote }) {
  const signals = [];
  const ind = kline ? computeIndicators(kline) : null;
  const ann = pickAnnualRows(finHistory || []);
  const latestFin = (finHistory || [])[0] || null;
  const hotHits = hotTrends ? hotTrends.totalHits : 0;
  const hotPlatforms = hotTrends ? hotTrends.platformCount : 0;

  // 信号5 · K线异常配合
  if (ind && ind.chg60d != null && ind.chg60d >= 50) signals.push({ id: 5, name: `K线异常：近60日涨幅 ${ind.chg60d}%`, severity: 'high' });
  else if (ind && ind.chg20d != null && ind.chg20d >= 25) signals.push({ id: 5, name: `K线异动：近20日涨幅 ${ind.chg20d}%`, severity: 'medium' });
  if (ind && ind.limitUpStreak >= 3) signals.push({ id: 5, name: `连续涨停 ${ind.limitUpStreak} 天`, severity: 'high' });
  if (ind && ind.volumeRatio != null && ind.volumeRatio >= 2.5) signals.push({ id: 5, name: `放量异动：最新量为20日均量 ${ind.volumeRatio} 倍`, severity: 'medium' });

  // 信号4 · 基本面与热度脱节
  const roe = latestFin ? latestFin.roe : null;
  const np = latestFin ? latestFin.netProfit : null;
  if (hotHits > 0 && roe != null && roe < 5) signals.push({ id: 4, name: `基本面与热度脱节：ROE ${roe.toFixed(1)}% 但上热搜`, severity: 'medium' });
  if (hotHits > 0 && np != null && np < 0) signals.push({ id: 4, name: '基本面与热度脱节：亏损但上热搜', severity: 'high' });

  // 信号7 · 跨平台联动（对大盘白马降噪：需叠加涨幅异常/低ROE/小市值才有信号意义）
  const mcapYi = quote && quote.marketCap != null ? quote.marketCap / 1e8 : null;
  const hotAnomaly = (ind && ind.chg60d != null && ind.chg60d >= 25) || (roe != null && roe < 5) || (mcapYi != null && mcapYi < 300);
  // 必须实际在 ≥3 个平台热榜命中（不是"接口可用"），且叠加异常特征
  if (hotHits >= 3 && hotAnomaly) signals.push({ id: 7, name: `跨平台联动：${hotHits} 条热榜命中`, severity: 'medium' });

  const n = signals.length;
  let level, score, recommendation;
  if (n <= 1) { level = '🟢 安全'; score = 9; recommendation = '未发现明显异常信号。'; }
  else if (n <= 3) { level = '🟡 注意'; score = 7; recommendation = `发现 ${n} 个异动信号，建议核实后再决策。`; }
  else if (n <= 5) { level = '🟠 警惕'; score = 4; recommendation = `发现 ${n} 个异动信号，需谨慎对待。`; }
  else { level = '🔴 高度可疑'; score = 1; recommendation = `发现 ${n} 个异动信号，疑似杀猪盘特征，建议回避。`; }

  return { level, score, signalsHit: `${n}/8`, signals, recommendation, hotHits };
}

// ─── 9. DCF 估值（移植 fin_models.py） ───────────────────
const DCF_DEFAULTS = { rf: 0.025, erp: 0.06, beta: 1.0, tax: 0.25, terminalG: 0.025, stage1Growth: 0.10, stage2Growth: 0.05, stage1Years: 5, stage2Years: 5, costOfDebt: 0.045, targetDebtRatio: 0.30 };

export function computeDcf({ fcf, revenue, netMargin, marketCap, shares, price, beta }) {
  const a = { ...DCF_DEFAULTS, ...(beta != null ? { beta } : {}) };
  // 统一「亿元」口径（与 UZI fin_models 一致）：fcf/营收 传入元，这里换算成亿
  const fcf0Yi = num(fcf) != null ? num(fcf) / 1e8 : null;
  let fcfUsed = fcf0Yi;
  let fcfProxy = false;
  if (!fcfUsed || fcfUsed <= 0) {
    const revYi = num(revenue) != null ? num(revenue) / 1e8 : null;
    const nm = num(netMargin);
    if (revYi && nm) { fcfUsed = revYi * (nm / 100) * 0.8; fcfProxy = true; }
  }
  if (!fcfUsed || fcfUsed <= 0) {
    return { verdict: '⛔ 数据不足 · 无法 DCF', intrinsicPerShare: null, safetyMarginPct: null, error: 'FCF/营收/净利率均缺失' };
  }
  // WACC = 权益成本×权益权重 + 税后债务成本×债务权重
  const costOfEquity = a.rf + a.beta * a.erp;
  const afterTaxKd = a.costOfDebt * (1 - a.tax);
  const equityW = 1 - a.targetDebtRatio;
  const wacc = equityW * costOfEquity + a.targetDebtRatio * afterTaxKd;

  const projected = [];
  let cur = fcfUsed;
  for (let i = 0; i < a.stage1Years; i++) { cur *= (1 + a.stage1Growth); projected.push(cur); }
  for (let i = 0; i < a.stage2Years; i++) { cur *= (1 + a.stage2Growth); projected.push(cur); }
  let pvExplicit = 0;
  projected.forEach((f, idx) => { pvExplicit += f / (1 + wacc) ** (idx + 1); });
  const terminalFcf = projected[projected.length - 1] * (1 + a.terminalG);
  const tvAtEnd = wacc - a.terminalG > 0 ? terminalFcf / (wacc - a.terminalG) : 0;
  const tvPv = tvAtEnd / (1 + wacc) ** projected.length;
  const enterpriseValueYi = pvExplicit + tvPv;
  // 净债桥缺失：EV≈股权价值（同 UZI 约定，附注说明）
  const equityValueYi = enterpriseValueYi;
  let sharesYi = num(shares) != null ? num(shares) / 1e8 : 0;
  if (!sharesYi && marketCap && price) sharesYi = marketCap / price;
  const perShare = sharesYi > 0 ? equityValueYi / sharesYi : null;
  const curPrice = num(price);
  const safetyMargin = curPrice && perShare ? (perShare / curPrice - 1) * 100 : null;
  let verdict;
  if (perShare == null) verdict = '⛔ 数据不足 · 无法 DCF';
  else if (safetyMargin >= 30) verdict = '🟢 低估 · 安全边际充足';
  else if (safetyMargin >= 10) verdict = '🟢 略低估';
  else if (safetyMargin >= -10) verdict = '⚖️ 估值合理';
  else verdict = '🔴 高估';
  return {
    verdict,
    intrinsicPerShare: perShare != null ? Math.round(perShare * 100) / 100 : null,
    safetyMarginPct: safetyMargin != null ? Math.round(safetyMargin * 10) / 10 : null,
    wacc: Math.round(wacc * 10000) / 100,
    fcfBase: fcfUsed,
    fcfProxy,
    enterpriseValueYi,
    netDebtBridgeMissing: true,
    sharesYi,
    assumptions: a,
  };
}

// ─── 10. 同行对标（行业板块 + 可比公司） ─────────────────
const EM_SUGGEST = 'https://searchapi.eastmoney.com/api/suggest/get';
const EM_TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8';

/**
 * 用东财搜索接口把板块名（如 白酒Ⅱ/通信设备）解析成板块代码（BK1277/BK0448）
 */
async function searchBoardCode(boardName) {
  if (!boardName) return null;
  const url = `${EM_SUGGEST}?input=${encodeURIComponent(boardName)}&type=14&token=${EM_TOKEN}&count=8`;
  const json = await fetchJson(url, 8000);
  const rows = (json?.QuotationCodeTable?.Data || [])
    .filter((r) => r.QuoteID && /BK/.test(String(r.QuoteID)));
  if (!rows.length) return null;
  // 优先精确匹配板块名
  const exact = rows.find((r) => r.Name === boardName);
  const picked = exact || rows[0];
  const m = String(picked.QuoteID).match(/(BK\d+)/);
  return m ? { code: m[1], name: picked.Name } : null;
}

export async function getIndustry(info) {
  if (info.market !== 'CN') return null;
  return cached(`uzi:ind:${info.secid}`, 24 * 3600000, async () => {
    const code = secidToF10Code(info.secid);
    if (!code) return null;
    const json = await fetchJson(`${EM_F10_COMPANY}?code=${code}`, 10000);
    const jb = (json?.jbzl || [])[0] || {};
    return { emIndustry: jb.EM2016 || null, csrcIndustry: jb.INDUSTRYCSRC1 || null };
  });
}

export async function getComps(info, quote, finHistory) {
  if (info.market !== 'CN' || !quote) return null;
  // 板块名优先用行情 f127（白酒Ⅱ/通信设备…），缺失时退回 F10 EM2016
  let boardName = quote.industry || null;
  let board = null;
  if (boardName) {
    board = await searchBoardCode(boardName).catch(() => null);
  }
  if (!board) {
    const industry = await getIndustry(info).catch(() => null);
    const em = industry && industry.emIndustry ? String(industry.emIndustry).split('-').filter(Boolean) : [];
    for (const seg of em.reverse()) {
      board = await searchBoardCode(seg).catch(() => null);
      if (board) { boardName = seg; break; }
    }
  }
  if (!board) return null;

  return cached(`uzi:comps:${info.secid}`, 12 * 3600000, async () => {
    const url = `${EM_CLIST}?pn=1&pz=12&po=1&np=1&fltt=2&invt=2&fid=f20&fs=b:${board.code}&fields=f12,f14,f2,f3,f9,f23,f20`;
    const json = await fetchJson(url, 12000);
    const rows = json?.data?.diff || [];
    const peers = rows
      .filter((r) => r.f12 && r.f12 !== info.symbol && num(r.f9) != null)
      .slice(0, 8)
      .map((r) => ({
        code: r.f12, name: r.f14,
        price: num(r.f2), chgPct: num(r.f3),
        pe: num(r.f9), pb: num(r.f23), marketCap: num(r.f20),
      }));
    if (peers.length < 2) return null;
    const validPe = peers.map((p) => p.pe).filter((v) => v != null && v > 0 && v < 500);
    const validPb = peers.map((p) => p.pb).filter((v) => v != null && v > 0);
    const median = (arr) => {
      if (!arr.length) return null;
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    const medPe = median(validPe);
    const medPb = median(validPb);
    const curPe = num(quote.pe);
    const curPb = num(quote.pb);
    const percentile = (cur, arr) => {
      if (cur == null || !arr.length) return null;
      return Math.round((arr.filter((v) => v < cur).length / arr.length) * 100);
    };
    // 中位 PE × 目标 EPS → 隐含目标价
    const ann = pickAnnualRows(finHistory || []);
    const lastEps = ann.length ? ann[ann.length - 1].eps : null;
    let impliedPrice = null;
    if (medPe && lastEps && quote.price) impliedPrice = medPe * lastEps;
    let verdict = null;
    if (curPe != null && medPe != null) {
      const diff = ((curPe - medPe) / medPe) * 100;
      verdict = diff > 30 ? '估值高于同行' : diff < -30 ? '估值低于同行' : '与同行相当';
    }
    return {
      industry: boardName || board.name,
      peers,
      medianPe: medPe != null ? Math.round(medPe * 100) / 100 : null,
      medianPb: medPb != null ? Math.round(medPb * 100) / 100 : null,
      pePercentile: percentile(curPe, validPe),
      pbPercentile: percentile(curPb, validPb),
      impliedPrice,
      verdict,
    };
  });
}

// ─── 汇总：单只股票的深度分析 ────────────────────────────
export async function getDeepAnalysis(info, quote, fin) {
  if (!info || !quote) return null;
  const result = {};
  const isCN = info.market === 'CN';

  // 独立数据源并行拉取（每个维度独立失败降级）
  const tasks = [
    ['kline', getKline(info).catch(() => null)],
    ['finHistory', isCN ? getFinHistory(info).catch(() => null) : Promise.resolve(null)],
    ['industry', isCN ? getIndustry(info).catch(() => null) : Promise.resolve(null)],
    ['lhb', isCN ? getLhb(info).catch(() => null) : Promise.resolve(null)],
    ['research', isCN ? getResearch(info).catch(() => null) : Promise.resolve(null)],
    ['northbound', getNorthboundAgg().catch(() => null)],
  ];
  await Promise.all(tasks.map(async ([key, p]) => { result[key] = await p; }));

  // 依赖财务历史 + K线的计算（并行）
  await Promise.all([
    (async () => {
      if (result.finHistory && result.kline) {
        result.valuation = await getValuation(info, quote, result.finHistory).catch(() => null);
      }
    })(),
    (async () => {
      if (result.industry) {
        result.comps = await getComps(info, quote, result.finHistory).catch(() => null);
      }
    })(),
    (async () => {
      result.hotTrends = quote.name ? await getHotTrends(quote.name).catch(() => null) : null;
    })(),
  ]);

  // 缠论指标（能力包 chan_theory 数据钩子，依赖 K线）
  if (result.kline) {
    result.chan = computeChanIndicators(result.kline);
  }
  // 杀猪盘量化扫描
  result.trap = computeTrapSignals({ kline: result.kline, finHistory: result.finHistory, hotTrends: result.hotTrends, quote });
  // DCF（A股：经营现金流净额；美股/港股：Yahoo freeCashflow）
  if (isCN && result.finHistory && result.finHistory.length) {
    const annRows = pickAnnualRows(result.finHistory);
    const latest = annRows.length ? annRows[annRows.length - 1] : result.finHistory[0];
    result.dcf = computeDcf({
      fcf: latest.ocf,
      revenue: latest.revenue,
      netMargin: latest.netMargin,
      marketCap: quote.marketCap,
      shares: latest.totalShare,
      price: quote.price,
      beta: quote.beta,
    });
  } else if (!isCN && fin) {
    const lf = fin.latest || {};
    const fcfUs = fin.freeCashflow ?? null;
    const nmUs = fin.yahooNetMargin ?? lf.netMargin;
    if (fcfUs != null || nmUs != null || lf.revenue != null) {
      result.dcf = computeDcf({
        fcf: fcfUs,
        revenue: lf.revenue,
        netMargin: nmUs,
        marketCap: quote.marketCap,
        shares: fin.shares || (quote.marketCap && quote.price ? quote.marketCap / quote.price : null),
        price: quote.price,
        beta: quote.beta,
      });
    }
  }
  return result;
}

// ─── 快照格式化 ──────────────────────────────────────────
const fmtMoneyYi = (v) => (num(v) == null ? null : `${Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2)}亿`);

export function formatDeepSnapshot(info, quote, deep) {
  if (!deep) return [];
  const lines = [];
  const head = (s) => lines.push(`  ▸ ${s}`);
  // 五年财务
  if (Array.isArray(deep.finHistory) && deep.finHistory.length) {
    const ann = pickAnnualRows(deep.finHistory).slice(-5);
    if (ann.length) {
      const parts = ann.map((r) => {
        const y = (r.reportDate || '').slice(0, 4);
        const rev = num(r.revenue) != null ? `${fmtMoneyYi(yi(r.revenue))}` : '—';
        const g = num(r.revenueGrowth) != null ? `${num(r.revenueGrowth).toFixed(1)}%` : null;
        const np = num(r.netProfit) != null ? `${fmtMoneyYi(yi(r.netProfit))}` : '—';
        const roe = num(r.roe) != null ? `ROE ${num(r.roe).toFixed(1)}%` : null;
        return `${y} ${rev}${g ? `(${g})` : ''} 净利${np}${roe ? ` ${roe}` : ''}`;
      });
      head(`五年财务：${parts.join('；')}`);
    }
    const latest = deep.finHistory[0];
    if (latest) {
      const bits = [];
      if (num(latest.grossMargin) != null) bits.push(`毛利率 ${num(latest.grossMargin).toFixed(1)}%`);
      if (num(latest.netMargin) != null) bits.push(`净利率 ${num(latest.netMargin).toFixed(1)}%`);
      if (num(latest.debtRatio) != null) bits.push(`资产负债率 ${num(latest.debtRatio).toFixed(1)}%`);
      if (num(latest.cashFlowPerShare) != null) bits.push(`每股经营现金流 ${num(latest.cashFlowPerShare).toFixed(2)}`);
      if (bits.length) head(`最新财务（${latest.reportName || latest.reportDate || ''}）：${bits.join('，')}`);
    }
  }
  // 估值分位
  if (deep.valuation && (deep.valuation.pePercentile != null || deep.valuation.pbPercentile != null)) {
    const bits = [];
    if (deep.valuation.pePercentile != null && quote.pe != null) bits.push(`PE(TTM) ${Number(quote.pe).toFixed(1)}，近5年 ${deep.valuation.pePercentile}% 分位（${deep.valuation.peBand}）`);
    if (deep.valuation.pbPercentile != null && quote.pb != null) bits.push(`PB ${Number(quote.pb).toFixed(2)}，近5年 ${deep.valuation.pbPercentile}% 分位（${deep.valuation.pbBand}）`);
    if (bits.length) head(`估值分位：${bits.join('；')}`);
  }
  // K线指标
  if (deep.kline) {
    const ind = computeIndicators(deep.kline);
    if (ind) {
      const bits = [];
      if (ind.trend) bits.push(ind.trend);
      if (ind.rsi14 != null) bits.push(`RSI ${ind.rsi14}`);
      if (ind.macd && ind.macd.dif != null && ind.macd.dea != null) bits.push(ind.macd.dif > ind.macd.dea ? 'MACD 金叉' : 'MACD 死叉');
      if (ind.chg60d != null) bits.push(`近60日 ${ind.chg60d}%`);
      if (ind.ytd != null) bits.push(`年内 ${ind.ytd}%`);
      if (ind.volatility != null) bits.push(`年化波动率 ${ind.volatility}%`);
      if (ind.maxDrawdown != null) bits.push(`近一年最大回撤 ${ind.maxDrawdown}%`);
      if (ind.volumeRatio != null) bits.push(`量比 ${ind.volumeRatio}`);
      if (bits.length) head(`技术面：${bits.join('，')}`);
    }
  }
  // 缠论视角（能力包 chan_theory）
  if (deep.chan && deep.chan.penDirection) {
    const bits = [`${deep.chan.penDirection}${deep.chan.lastFractal ? `，末端${deep.chan.lastFractal}` : ''}`];
    if (deep.chan.currentZhong) {
      bits.push(`最近中枢 ${deep.chan.currentZhong.low.toFixed(2)}–${deep.chan.currentZhong.high.toFixed(2)}${deep.chan.inZhong ? '（价格在中枢内）' : '（价格离开中枢）'}`);
    }
    if (deep.chan.divergence) bits.push(deep.chan.divergence);
    head(`缠论视角：${bits.join('，')}`);
  }
  // 龙虎榜
  if (deep.lhb && deep.lhb.count > 0) {
    const bits = [`近30日上榜 ${deep.lhb.count} 次${deep.lhb.lastDate ? `（最近 ${deep.lhb.lastDate}）` : ''}`];
    if (deep.lhb.totalNet != null) bits.push(`净买入 ${deep.lhb.totalNet.toFixed(1)}亿`);
    if (deep.lhb.lastSeats && deep.lhb.lastSeats.length) {
      const seats = deep.lhb.lastSeats.slice(0, 3).map((s) => (s.inst ? `🏛️${s.name}` : `🃏${s.name}`)).join('、');
      bits.push(`席位：${seats}`);
    }
    head(`龙虎榜：${bits.join('，')}`);
  }
  // 研报
  if (deep.research && deep.research.count > 0) {
    const dist = Object.entries(deep.research.ratingDist || {}).map(([k, v]) => `${k}${v}`).join('/');
    head(`研报：近12月 ${deep.research.count} 份（${dist}），预测今年平均 EPS ${deep.research.avgThisEps != null ? deep.research.avgThisEps.toFixed(2) : '—'}`);
  }
  // 北向整体（数据停发时 getNorthboundAgg 返回 null，不显示）
  // 热榜
  if (deep.hotTrends && deep.hotTrends.totalHits > 0) {
    const plat = deep.hotTrends.hits.map((h) => `${h.title}`).slice(0, 3).join('、');
    head(`社交热榜：${deep.hotTrends.totalHits} 条命中（${deep.hotTrends.platformCount} 平台），如「${plat}」`);
  }
  // 杀猪盘
  if (deep.trap) {
    const sigs = deep.trap.signals.length ? `（${deep.trap.signals.map((s) => s.name).join('；')}）` : '';
    head(`杀猪盘扫描：${deep.trap.level} ${deep.trap.signalsHit}${sigs} —— ${deep.trap.recommendation}`);
  }
  // DCF（币种符号随市场：A股 ¥ / 港股 HK$ / 美股 $）
  const curSym = info.market === 'HK' ? 'HK$' : info.market === 'US' ? '$' : '¥';
  if (deep.dcf && deep.dcf.intrinsicPerShare != null) {
    const note = deep.dcf.fcfProxy ? '（FCF 按净利×0.8 估算）' : '';
    head(`DCF 估值：内在价值约 ${curSym}${deep.dcf.intrinsicPerShare}/股（WACC ${deep.dcf.wacc}%，g=2.5%），现价 ${curSym}${num(quote.price)?.toFixed(2)}，安全边际 ${deep.dcf.safetyMarginPct != null ? deep.dcf.safetyMarginPct + '%' : '—'} ${note}｜${deep.dcf.verdict}`);
  } else if (deep.dcf) {
    head(`DCF 估值：${deep.dcf.verdict || '数据不足'}`);
  }
  // 同行对标
  if (deep.comps) {
    const bits = [`行业「${deep.comps.industry}」`];
    if (deep.comps.medianPe != null) bits.push(`中位 PE ${deep.comps.medianPe}`);
    if (deep.comps.medianPb != null) bits.push(`中位 PB ${deep.comps.medianPb}`);
    if (deep.comps.pePercentile != null) bits.push(`本股 PE 高于 ${deep.comps.pePercentile}% 同行`);
    if (deep.comps.verdict) bits.push(deep.comps.verdict);
    if (deep.comps.impliedPrice != null && quote.price) bits.push(`按中位 PE 隐含价约 ¥${deep.comps.impliedPrice.toFixed(2)}`);
    if (deep.comps.peers) bits.push(`可比 ${deep.comps.peers.length} 家（${deep.comps.peers.map((p) => p.name).slice(0, 5).join('、')}${deep.comps.peers.length > 5 ? '…' : ''}）`);
    head(`同行对标：${bits.join('，')}`);
  }
  return lines;
}
