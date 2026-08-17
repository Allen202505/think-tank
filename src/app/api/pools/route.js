// src/app/api/pools/route.js —— 大师的选股池
// POST { symbols: ['300750','600519',...], days: 60 } → 当日涨跌 + 区间统计（vs 沪深300）
import { resolveSymbols, getYahoo } from '../chat/marketData.js';
import { getClientIp, rateLimit, limitResponse } from '../../../lib/rateLimit';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
let lastUSKlineErr = ''; // 诊断：最近一次美股/港股 K 线失败原因
const TENCENT = (code, days) => `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,,${days},qfq`;

function tencentCode(secid) {
  const [m, code] = String(secid || '').split('.');
  if (m === '105' || m === '106') return 'us' + code;
  if (m === '116') return 'hk' + code;
  if (m === '0' && /^[489]/.test(code)) return 'bj' + code; // 北交所
  return (m === '1' ? 'sh' : 'sz') + code;
}

// 东财前复权日K（快、已调权）；长区间也稳
async function fetchEmKline(secid, days) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3500);
  try {
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=101&fqt=1&beg=20200101&end=20500101&lmt=${days + 1}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' }, signal: ctrl.signal });
    if (!res.ok) return null;
    const json = await res.json();
    const klines = json?.data?.klines || [];
    const bars = klines
      .map((line) => {
        const p = String(line).split(',');
        return { date: p[0], close: Number(p[2]) };
      })
      .filter((b) => b.close > 0);
    return bars.slice(-(days + 1)); // 只取最近 days+1 条
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 腾讯兜底：短区间前复权，长区间不复权（东财不稳时）
async function fetchTencentKline(secid, days) {
  const [m] = String(secid || '').split('.');
  if (m === '105' || m === '106' || m === '116') return null; // 腾讯美股/港股K线接口不可靠，仅 A 股兜底
  const code = tencentCode(secid);
  const useQfq = days <= 250;
  const url = `${TENCENT(code, days)}${useQfq ? '' : ''}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://gu.qq.com/' }, signal: ctrl.signal });
    if (!res.ok) return null;
    const json = await res.json();
    const node = json?.data?.[code];
    const bars = useQfq ? (node?.qfqday || node?.day) : (node?.day || node?.qfqday);
    return (bars || [])
      .filter((b) => Array.isArray(b) && b.length >= 6)
      .map((b) => ({ date: String(b[0]), close: Number(b[2]) }))
      .filter((b) => b.close > 0);
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 统一入口：东财优先（前复权、快）；1.2s 内未返回则立刻并行请求腾讯兜底
// 正常时只发东财 1 个请求；东财慢/挂时 ~1.5s 内拿到腾讯数据，避免干等超时
// 新浪兜底：东财/腾讯被限流时使用（日K，scale=240 表示日线）
async function fetchSinaKline(secid, days) {
  const [m] = String(secid || '').split('.');
  if (m !== '0' && m !== '1') return null; // 新浪仅支持 A 股
  const symbol = tencentCode(secid);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const url = `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_data=/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=${days + 1}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn/' }, signal: ctrl.signal });
    if (!res.ok) return null;
    const text = await res.text();
    // JSONP：var _data=([...]) 或 var _data=({...})；用首尾括号截取更稳，避免正则误匹配
    const start = text.indexOf('(');
    const end = text.lastIndexOf(')');
    if (start < 0 || end <= start) return null;
    let arr;
    try { arr = JSON.parse(text.slice(start + 1, end)); } catch (e) { return null; }
    const list = Array.isArray(arr) ? arr : arr ? [arr] : [];
    return list
      .map((b) => ({ date: String(b.day || '').slice(0, 10), close: Number(b.close) }))
      .filter((b) => b.close > 0);
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Nasdaq 官方历史日K：美股（东财在海外被屏蔽、Yahoo 有时限流时用这个）
async function fetchNasdaqKline(secid, days) {
  const [m, code] = String(secid || '').split('.');
  if (m !== '105' && m !== '106') return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const end = new Date();
    const start = new Date(end.getTime() - days * 2 * 86400 * 1000);
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(code)}/historical?assetclass=stocks&fromdate=${fmt(start)}&todate=${fmt(end)}&limit=${days + 1}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' },
      signal: ctrl.signal,
    });
    if (!res.ok) { lastUSKlineErr = `nasdaq http ${res.status}`; return null; }
    const json = await res.json();
    const rows = json?.data?.tradesTable?.rows || [];
    const bars = rows
      .map((r) => {
        const parts = String(r.date || '').split('/');
        if (parts.length < 3) return null;
        const close = parseFloat(String(r.close || '').replace(/[^0-9.]/g, ''));
        if (!(close > 0)) return null;
        return { date: `${parts[2]}-${parts[0]}-${parts[1]}`, close };
      })
      .filter(Boolean)
      .reverse(); // Nasdaq 返回倒序（最新在前），转成时间正序
    return bars.slice(-(days + 1));
  } catch (e) {
    lastUSKlineErr = `nasdaq: ${String(e.message || e).slice(0, 60)}`;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Yahoo 兜底：美股/港股日K（Vercel 海外服务器可访问；东财在海外常被屏蔽）
async function fetchYahooKline(secid, days) {
  const [m, code] = String(secid || '').split('.');
  if (m !== '105' && m !== '106' && m !== '116') return null;
  try {
    const yf = await getYahoo();
    const symbol = m === '116' ? `${String(Number(code)).padStart(4, '0')}.HK` : code;
    const end = Math.floor(Date.now() / 1000);
    const start = end - days * 2 * 86400; // 多取一些，保证足够交易日
    const res = await yf.chart(symbol, { period1: start, period2: end, interval: '1d' });
    const ts = res?.timestamp || [];
    const close = res?.indicators?.quote?.[0]?.close || [];
    const bars = ts
      .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: close[i] != null ? Number(close[i]) : 0 }))
      .filter((b) => b.close > 0);
    return bars.slice(-(days + 1));
  } catch (e) {
    lastUSKlineErr = `yahoo: ${String(e.message || e).slice(0, 60)}`;
    return null;
  }
}

async function fetchKline(secid, days) {
  const emP = fetchEmKline(secid, days);
  const em = await Promise.race([emP, new Promise((r) => setTimeout(() => r(null), 1200))]);
  if (em && em.length > 1) return em;
  // 美股/港股：东财在海外常被屏蔽，东财失败后直接走 Yahoo（腾讯/新浪不支持或不可靠）
  if (/^(105|106)\./.test(String(secid))) {
    lastUSKlineErr = '';
    const nd = await fetchNasdaqKline(secid, days);
    if (nd && nd.length > 1) return nd;
    const yh = await fetchYahooKline(secid, days);
    if (yh && yh.length > 1) return yh;
  } else if (/^116\./.test(String(secid))) {
    lastUSKlineErr = '';
    const yh = await fetchYahooKline(secid, days);
    if (yh && yh.length > 1) return yh;
  }
  const tc = await fetchTencentKline(secid, days);
  if (tc && tc.length > 1) return tc;
  const sn = await fetchSinaKline(secid, days);
  if (sn && sn.length > 1) return sn;
  return em; // 东财稍后才返回的非空结果
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// 单只股票/指数的日K → 今天/昨天/本周收益（本周 = 最近一个周一起至今）
function barsPeriods(bars) {
  if (!bars || bars.length < 3) return null;
  const n = bars.length;
  const last = bars[n - 1], prev = bars[n - 2], prev2 = bars[n - 3];
  const today = prev.close > 0 ? (last.close - prev.close) / prev.close : null;
  const yesterday = prev2.close > 0 ? (prev.close - prev2.close) / prev2.close : null;
  const lastDt = new Date(`${last.date}T00:00:00`);
  const dow = (lastDt.getDay() + 6) % 7; // 周一=0 ... 周日=6
  const monday = new Date(lastDt);
  monday.setDate(lastDt.getDate() - dow);
  const mondayStr = fmtDate(monday);
  const preIdx = bars.findIndex((b) => b.date >= mondayStr) - 1;
  const preBar = preIdx >= 0 ? bars[preIdx] : bars.find((b) => b.date >= mondayStr);
  const week = preBar && preBar.close > 0 ? (last.close / preBar.close - 1) : null;
  return { today, yesterday, week, lastDate: last.date, prevDate: prev.date };
}

// 按选中区间截取日K窗口：返回 bar 数 = 区间交易日数 + 1（含区间首日的前一交易日），
// 使「上涨天数」的分母正好等于所选区间天数（本周=本周交易日数，如周一~周五=5）
function sliceWindow(bars, period) {
  if (!bars || !bars.length) return [];
  if (period === 'week') {
    const last = bars[bars.length - 1];
    const lastDt = new Date(`${last.date}T00:00:00`);
    const dow = (lastDt.getDay() + 6) % 7; // 周一=0 … 周日=6
    const monday = new Date(lastDt);
    monday.setDate(lastDt.getDate() - dow);
    const mondayStr = fmtDate(monday);
    const idx = bars.findIndex((b) => b.date >= mondayStr);
    return bars.slice(Math.max(0, idx - 1)); // 从周一前一交易日开始，周一也计入涨跌统计
  }
  if (period === 'today') return bars.slice(-2);
  if (period === 'yesterday') return bars.slice(-3, -1);
  const n = Number(period);
  if (Number.isFinite(n) && n > 0) return bars.slice(-(n + 1));
  return bars;
}

function poolPeriodStat(stockRets) {
  const ret = stockRets.length ? (stockRets.reduce((a, b) => a + b, 0) / stockRets.length) * 100 : null;
  const up = stockRets.filter((r) => r > 0).length;
  const down = stockRets.filter((r) => r < 0).length;
  return { ret, up, down };
}

export async function POST(request) {
  try {
  const _rl = rateLimit('pools:' + getClientIp(request), { limit: 120, windowMs: 60000 });
  if (!_rl.ok) return limitResponse(_rl.retryAfter);

    const body = await request.json();
    const symbols = Array.isArray(body.symbols) ? body.symbols.map((s) => String(s).trim()).filter(Boolean).slice(0, 100) : []; // 上限 100 只（寒武纪等预置池超 50 只）
    const days = Math.min(800, Math.max(2, Number(body.days) || 60));
    const period = String(body.period || 'today'); // today | yesterday | week | 30/60/120/250/500/750
    if (!symbols.length) return Response.json({ error: '请先提供股票代码列表' }, { status: 400 });

    // 解析代码 → 名称/secid
    const infos = await Promise.all(symbols.map((c) => resolveSymbols(c).then((r) => (r && r[0]) || null).catch(() => null)));
    const valid = infos.filter(Boolean);
    if (!valid.length) return Response.json({ error: '未能识别这些股票，请使用 6 位代码，如 300750' }, { status: 404 });

    // 拉每只股票 + 沪深300 的日K
    const data = await Promise.all(valid.map(async (info) => ({ info, bars: await fetchKline(info.secid, days + 1) })));
    const indexBars = await fetchKline('1.000001', days + 1); // 上证指数

    // 短周期：今天 / 昨天 / 本周（等权，自动取最近交易日）
    const periods = { today: [], yesterday: [], week: [] };
    for (const { bars } of data) {
      const pp = barsPeriods(bars);
      if (!pp) continue;
      if (pp.today != null) periods.today.push(pp.today);
      if (pp.yesterday != null) periods.yesterday.push(pp.yesterday);
      if (pp.week != null) periods.week.push(pp.week);
    }
    const idxP = barsPeriods(indexBars) || {};
    const firstBars = data.find((d) => d.bars && d.bars.length >= 2)?.bars;
    const lastDate = idxP.lastDate || (firstBars && firstBars[firstBars.length - 1]?.date) || null;
    const short = {
      today: { ...poolPeriodStat(periods.today), date: lastDate, indexRet: idxP.today != null ? idxP.today * 100 : null },
      yesterday: { ...poolPeriodStat(periods.yesterday), date: idxP.prevDate || lastDate, indexRet: idxP.yesterday != null ? idxP.yesterday * 100 : null },
      week: { ...poolPeriodStat(periods.week), date: lastDate, indexRet: idxP.week != null ? idxP.week * 100 : null },
    };

    // 每只股票：现价/当日涨跌/上涨天数/区间涨幅
    const stocks = data.map(({ info, bars }) => {
      if (!bars || bars.length < 2) return { code: info.symbol, name: info.name, error: /^(105|106|116)\./.test(info.secid || '') && lastUSKlineErr ? `无行情数据（${lastUSKlineErr}）` : '无行情数据' };
      const wb = sliceWindow(bars, period);
      if (wb.length < 2) return { code: info.symbol, name: info.name, error: '区间数据不足' };
      const closes = wb.map((b) => b.close);
      const last = closes[closes.length - 1];
      const prev = closes[closes.length - 2];
      // 现价/今日 始终取全量最后一根（不受选中区间影响）
      const fLast = bars[bars.length - 1].close;
      const fPrev = bars[bars.length - 2].close;
      let upDays = 0;
      for (let i = 1; i < closes.length; i++) if (closes[i] > closes[i - 1]) upDays++;
      return {
        code: info.symbol,
        name: info.name,
        price: fLast,
        changePct: fPrev ? ((fLast - fPrev) / fPrev) * 100 : null,
        ret: prev ? (last / closes[0] - 1) * 100 : null,
        upDays,
        totalDays: closes.length - 1,
        startDate: wb[0].date,
        endDate: wb[wb.length - 1].date,
      };
    });
    const okStocks = stocks.filter((s) => !s.error);

    // 等权日收益（按日期对齐）用于和沪深300逐日比较
    const dailyRets = {};
    for (const { bars } of data) {
      if (!bars) continue;
      for (let i = 1; i < bars.length; i++) {
        const prevC = bars[i - 1].close;
        const c = bars[i].close;
        if (prevC > 0 && c > 0) {
          const d = bars[i].date;
          (dailyRets[d] = dailyRets[d] || []).push((c - prevC) / prevC);
        }
      }
    }
    let beatDays = 0;
    let cmpDays = 0;
    const idxWin = sliceWindow(indexBars, period);
    if (idxWin && idxWin.length > 1) {
      for (let i = 1; i < idxWin.length; i++) {
        const d = idxWin[i].date;
        const pool = dailyRets[d];
        if (!pool || !pool.length) continue;
        const idxPrev = idxWin[i - 1].close;
        const idxRet = idxPrev > 0 ? (idxWin[i].close - idxPrev) / idxPrev : 0;
        cmpDays++;
        if (pool.reduce((a, b) => a + b, 0) / pool.length > idxRet) beatDays++;
      }
    }

    const upToday = okStocks.filter((s) => (s.changePct || 0) > 0).length;
    const downToday = okStocks.filter((s) => (s.changePct || 0) < 0).length;
    const upInRange = okStocks.filter((s) => (s.ret || 0) > 0).length;
    const downInRange = okStocks.filter((s) => (s.ret || 0) < 0).length;
    const intervalRet = okStocks.length ? okStocks.reduce((a, s) => a + (s.ret || 0), 0) / okStocks.length : 0;
    const indexRet = idxWin && idxWin.length > 1 ? (idxWin[idxWin.length - 1].close / idxWin[0].close - 1) * 100 : null;

    return Response.json({
      ok: true,
      result: {
        window: { days, start: okStocks[0]?.startDate || null, end: okStocks[0]?.endDate || null },
        stocks,
        index: {
          name: '上证指数',
          ret: indexRet,
          last: indexBars ? indexBars[indexBars.length - 1].close : null,
        },
        stats: {
          intervalRet,
          indexRet,
          upToday,
          downToday,
          upInRange,
          downInRange,
          beatDays,
          cmpDays,
          beatRatio: cmpDays ? beatDays / cmpDays : null,
          avgUpDaysRatio: okStocks.length ? okStocks.reduce((a, s) => a + (s.totalDays ? s.upDays / s.totalDays : 0), 0) / okStocks.length : null,
        },
        short,
      },
    });
  } catch (e) {
    return Response.json({ error: e.message || '服务器内部错误' }, { status: 500 });
  }
}
