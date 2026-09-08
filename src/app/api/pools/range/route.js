// src/app/api/pools/range/route.js —— 股票池 · 个股价格区间
// GET ?code=600519 → { ok, result: { code, name, histLow, histHigh, yLow, yHigh, ...日期 } }
// 供「我的股票池 / 大师的股票池」表格按需懒加载（前端对每只票拉一次，服务端 24h 缓存）。
// 口径：A股用东财前复权全历史（≈上市以来）；美股/港股用 Yahoo 全历史并按复权因子折算，
//      使历史价与现价同一口径；近一年 = 最近 250 个交易日的低/高。
import { resolveSymbols, getYahoo } from '../../chat/marketData.js';
import { getClientIp, rateLimit, limitResponse } from '../../../../lib/rateLimit';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const RANGE_TTL = 24 * 3600000;      // 成功缓存 24h
const ERROR_TTL = 60 * 60 * 1000;    // 失败负缓存 1h

const cache = new Map();
function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.error ? ERROR_TTL : ttlMs)) return hit.value;
  const p = Promise.resolve().then(loader);
  p.then(
    () => cache.set(key, { at: Date.now(), value: p }),
    () => cache.set(key, { at: Date.now(), value: p, error: true }),
  );
  cache.set(key, { at: Date.now(), value: p });
  return p;
}

async function fetchJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' }, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 东财全历史日K（A股/北交所主源）：date,open,close,high,low；fqt=1 前复权 / 0 不复权
async function fetchEmLong(secid, fqt = 1) {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55&klt=101&fqt=${fqt}&beg=19900101&end=20500101&lmt=100000`;
  const json = await fetchJson(url);
  const rows = json?.data?.klines || [];
  if (!rows.length) return null;
  const bars = [];
  for (const line of rows) {
    const p = String(line).split(',');
    const date = p[0];
    const high = Number(p[3]);
    const low = Number(p[4]);
    if (date && Number.isFinite(high) && Number.isFinite(low) && high > 0) bars.push({ date, high, low });
  }
  return bars.length ? bars : null;
}

function cnSymbol(secid) {
  const [m, code] = String(secid || '').split('.');
  if (!code || !/^\d{6}$/.test(code)) return null;
  if (m === '1') return `sh${code}`;
  if (m === '0') return /^[489]/.test(code) ? `bj${code}` : `sz${code}`;
  return null;
}

// 腾讯长日K兜底（fqt=true 取 qfq，否则取原始 day）
async function fetchTencentLong(secid, fqt = true) {
  const sym = cnSymbol(secid);
  if (!sym) return null;
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sym},day,,,8000,${fqt ? 'qfq' : ''}`;
  const json = await fetchJson(url);
  const node = (json?.data?.[sym] || {});
  const rows = fqt ? (node.qfqday || []) : (node.day || []);
  const bars = rows
    .filter((b) => Array.isArray(b) && b.length >= 5)
    .map((b) => ({ date: String(b[0]), high: Number(b[3]), low: Number(b[4]) }))
    .filter((b) => Number.isFinite(b.high) && Number.isFinite(b.low) && b.high > 0);
  return bars.length ? bars : null;
}

// 新浪日K兜底（单次最多约 4~5 年）
async function fetchSinaLong(secid) {
  const sym = cnSymbol(secid);
  if (!sym) return null;
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sym}&scale=240&ma=no&datalen=1500`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn/' }, signal: ctrl.signal });
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json)) return null;
    const bars = json
      .map((b) => ({ date: String(b.day || '').slice(0, 10), high: Number(b.high), low: Number(b.low) }))
      .filter((b) => b.date && Number.isFinite(b.high) && Number.isFinite(b.low) && b.high > 0);
    return bars.length ? bars : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Yahoo 全历史（美股/港股）：用 adjclose/close 比例把高低点折算成与现价一致的前复权口径；
// useAdj=false 时用原始价（源通常已做拆股调整），用于复权数据出现异常（≤0）时的兜底
async function fetchYahooLong(info, useAdj = true) {
  const yf = await getYahoo();
  const m = String(info.secid || '').split('.')[0];
  let symbol = String(info.symbol || '').toUpperCase();
  if (m === '116') {
    const num = String(info.symbol || '').replace(/\D/g, '');
    symbol = `${String(Number(num)).padStart(4, '0')}.HK`;
  }
  const period2 = new Date();
  const period1 = new Date('1985-01-01');
  const chart = await yf.chart(symbol, { period1, period2, interval: '1d' });
  const res = chart?.result?.[0];
  if (!res || !res.timestamp) throw new Error('no data');
  const ts = res.timestamp;
  const q = res.indicators?.quote?.[0] || {};
  const adj = res.indicators?.adjclose?.[0]?.adjclose || [];
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q.close && q.close[i];
    if (close == null) continue;
    const rawH = q.high && q.high[i] != null ? q.high[i] : close;
    const rawL = q.low && q.low[i] != null ? q.low[i] : close;
    const f = useAdj && adj[i] != null && adj[i] > 0 && close > 0 ? adj[i] / close : 1;
    const high = rawH * f;
    const low = rawL * f;
    if (high > 0 && low > 0 && high >= low) bars.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), high, low });
  }
  if (bars.length < 20) throw new Error('bars too few');
  return bars;
}

async function fetchLongBars(info) {
  const secid = String(info.secid || '');
  const m = secid.split('.')[0];
  if (m === '105' || m === '106' || m === '116') {
    try {
      const rawBars = await fetchYahooLong(info, false);
      if (rawBars && rawBars.length) return rawBars;
    } catch (e) { /* fallthrough */ }
    try {
      const adjBars = await fetchYahooLong(info, true);
      if (adjBars && adjBars.length) return adjBars;
    } catch (e) { /* fallthrough */ }
    try {
      const bars = await fetchEmLong(secid);
      if (bars && bars.length) return bars;
    } catch (e) { /* fallthrough */ }
    return null;
  }
  // A股/北交所：东财主源，腾讯/新浪兜底
  const minLow = (bars) => (bars && bars.length ? Math.min(...bars.map((b) => b.low)) : 0);
  let em = await fetchEmLong(secid, 1);
  if (em && minLow(em) <= 0) em = await fetchEmLong(secid, 0); // 前复权把历史拨成负数 → 用不复权原始成交价
  if (em && em.length > 250) return em;
  let tc = await fetchTencentLong(secid, true);
  if (tc && minLow(tc) <= 0) tc = await fetchTencentLong(secid, false);
  if (tc && tc.length > 250) return tc;
  const sn = await fetchSinaLong(secid);
  if (sn && sn.length > 250) return sn;
  return em || tc || sn; // 上市未满一年的次新：给出已积累区间
}

function rangeStat(bars) {
  const valid = (bars || []).filter((b) => b.low > 0 && b.high > 0 && b.high >= b.low);
  if (!valid.length) return null;
  let histLow = valid[0], histHigh = valid[0];
  for (const b of valid) {
    if (b.low < histLow.low) histLow = b;
    if (b.high > histHigh.high) histHigh = b;
  }
  const y = valid.slice(-250);
  let yLow = y[0], yHigh = y[0];
  for (const b of y) {
    if (b.low < yLow.low) yLow = b;
    if (b.high > yHigh.high) yHigh = b;
  }
  return {
    histLow: histLow.low, histLowDate: histLow.date,
    histHigh: histHigh.high, histHighDate: histHigh.date,
    yLow: yLow.low, yLowDate: yLow.date,
    yHigh: yHigh.high, yHighDate: yHigh.date,
    barCount: bars.length,
  };
}

export async function GET(request) {
  try {
    const _rl = rateLimit('pools-range:' + getClientIp(request), { limit: 600, windowMs: 60000 });
    if (!_rl.ok) return limitResponse(_rl.retryAfter);
    const url = new URL(request.url);
    const code = String(url.searchParams.get('code') || '').trim();
    if (!code) return Response.json({ error: '缺少股票代码' }, { status: 400 });

    const info = await cached(`range-info:${code}`, RANGE_TTL, async () => {
      const list = await resolveSymbols(code).catch(() => []);
      return (list && list[0]) || null;
    });
    if (!info) return Response.json({ error: '未能识别该股票' }, { status: 404 });

    const key = `range:${info.secid}`;
    const bars = await cached(key, RANGE_TTL, () => fetchLongBars(info).then((b) => {
      if (!b || !b.length) throw new Error('无历史K线');
      return b;
    }));
    const stat = rangeStat(bars);
    if (!stat) return Response.json({ error: '历史区间数据不足' }, { status: 422 });
    return Response.json({
      ok: true,
      result: { code: info.symbol, name: info.name || info.symbol, market: info.market, ...stat },
    });
  } catch (e) {
    return Response.json({ error: e.message || '服务器内部错误' }, { status: 500 });
  }
}
