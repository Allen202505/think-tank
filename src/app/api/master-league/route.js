// GET /api/master-league
// 用真实 A 股日线开盘价执行计划、收盘价计算资产和排名；行情源失败时明确降级为初始资金，不伪造收益。
import {
  LEAGUE_BENCHMARK,
  LEAGUE_INITIAL_CAPITAL,
  LEAGUE_MASTERS,
  LEAGUE_PLANS,
  LEAGUE_SYMBOLS,
  PUBLIC_LEAGUE,
} from '../../../data/masterLeague.js';
import { buildPendingLeague, settleMasterLeague } from '../../../lib/masterLeagueEngine.mjs';
import { loadPublicLeagueSnapshot, savePublicLeagueSnapshot } from '../../../lib/masterLeagueDb.js';
import { getClientIp, limitResponse, rateLimit } from '../../../lib/rateLimit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function parseNumber(value) {
  const number = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function normalizeBars(rows) {
  return (rows || [])
    .map((row) => ({
      date: String(row.date || ''),
      open: parseNumber(row.open),
      close: parseNumber(row.close),
    }))
    .filter((bar) => /^\d{4}-\d{2}-\d{2}$/.test(bar.date) && bar.open > 0 && bar.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchEastmoneyBars(secid, limit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const fields = 'f51,f52,f53';
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6&fields2=${fields}&klt=101&fqt=1&beg=20200101&end=20500101&lmt=${limit}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return { bars: [], source: '' };
    const payload = await response.json();
    const rows = (payload?.data?.klines || []).map((line) => {
      const parts = String(line).split(',');
      return { date: parts[0], open: parts[1], close: parts[2] };
    });
    const bars = normalizeBars(rows).slice(-limit);
    return { bars, source: bars.length ? '东方财富' : '' };
  } catch {
    return { bars: [], source: '' };
  } finally {
    clearTimeout(timer);
  }
}

function tencentCode(secid) {
  const [market, code] = String(secid || '').split('.');
  return `${market === '1' ? 'sh' : 'sz'}${code}`;
}

async function fetchTencentBars(secid, limit) {
  const code = tencentCode(secid);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,,${limit},qfq`;
    const response = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://gu.qq.com/' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return { bars: [], source: '' };
    const payload = await response.json();
    const node = payload?.data?.[code];
    const rows = (node?.qfqday || node?.day || []).map((row) => ({
      date: row[0],
      open: row[1],
      close: row[2],
    }));
    const bars = normalizeBars(rows).slice(-limit);
    return { bars, source: bars.length ? '腾讯证券' : '' };
  } catch {
    return { bars: [], source: '' };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSinaBars(secid, limit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const symbol = tencentCode(secid);
    const url = `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_data=/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=${limit}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn/' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return { bars: [], source: '' };
    const text = await response.text();
    const match = text.match(/=\((\[[\s\S]*\])\)\s*;?\s*$/);
    if (!match) return { bars: [], source: '' };
    const rows = JSON.parse(match[1]).map((row) => ({
      date: row.day,
      open: row.open,
      close: row.close,
    }));
    const bars = normalizeBars(rows).slice(-limit);
    return { bars, source: bars.length ? '新浪财经' : '' };
  } catch {
    return { bars: [], source: '' };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBars(secid, limit = 40) {
  const cached = cache.get(`${secid}:${limit}`);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const primary = await fetchEastmoneyBars(secid, limit);
  let resolved = primary.bars.length >= 5 ? primary : await fetchTencentBars(secid, limit);
  if (resolved.bars.length < 5) resolved = await fetchSinaBars(secid, limit);
  const value = resolved.bars.length >= 5 ? resolved : { bars: [], source: '' };
  cache.set(`${secid}:${limit}`, { at: Date.now(), value });
  return value;
}

function jsonResponse(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'Cache-Control': 'private, max-age=0, s-maxage=120, stale-while-revalidate=300',
    },
  });
}

export async function GET(request) {
  const limited = rateLimit(`master-league:${getClientIp(request)}`, { limit: 30, windowMs: 60000 });
  if (!limited.ok) return limitResponse(limited.retryAfter);

  const symbols = Object.entries(LEAGUE_SYMBOLS);
  const requests = [
    ...symbols.map(([code, meta]) => fetchBars(meta.secid).then((result) => ({ code, ...result }))),
    fetchBars(LEAGUE_BENCHMARK.secid).then((result) => ({ code: LEAGUE_BENCHMARK.code, benchmark: true, ...result })),
  ];
  const settled = await Promise.all(requests);
  const successful = settled.filter((item) => item.bars.length >= 5);
  const tradeResults = settled.filter((item) => !item.benchmark && item.bars.length >= 5);
  const benchmark = settled.find((item) => item.benchmark && item.bars.length >= 5);
  const canSettle = tradeResults.length >= 6 && Boolean(benchmark);

  if (!canSettle) {
    const stored = await loadPublicLeagueSnapshot(PUBLIC_LEAGUE.id);
    if (stored) {
      return jsonResponse({
        ok: true,
        data: {
          ...stored,
          competition: PUBLIC_LEAGUE,
          dataQuality: 'stored',
          dataSource: [],
          note: '实时行情暂不可用，当前展示公共底表中的最近一次公开快照。',
          persistence: { enabled: true, source: 'database' },
        },
      });
    }
    const degraded = buildPendingLeague({
      masters: LEAGUE_MASTERS,
      plansByMaster: LEAGUE_PLANS,
      symbolMeta: LEAGUE_SYMBOLS,
      initialCapital: LEAGUE_INITIAL_CAPITAL,
      reason: '行情源暂时不可用，账户保持初始资金，系统不会伪造收益',
    });
    return jsonResponse({
      ok: true,
      data: {
        ...degraded,
        competition: PUBLIC_LEAGUE,
        dataQuality: 'degraded',
        dataSource: successful.map((item) => item.source).filter(Boolean),
        note: '行情连接失败时仅展示待执行计划，不生成虚构交易和收益。',
        persistence: { enabled: false, source: 'memory', reason: 'missing_service_role' },
      },
    });
  }

  const barsBySymbol = Object.fromEntries(tradeResults.map((item) => [item.code, item.bars]));
  const latestDate = benchmark.bars[benchmark.bars.length - 1].date;
  const league = settleMasterLeague({
    masters: LEAGUE_MASTERS,
    plansByMaster: LEAGUE_PLANS,
    barsBySymbol,
    symbolMeta: LEAGUE_SYMBOLS,
    latestDate,
    dateList: benchmark.bars.map((bar) => bar.date),
    initialCapital: LEAGUE_INITIAL_CAPITAL,
  });
  const sources = [...new Set(tradeResults.map((item) => item.source).filter(Boolean))];
  const missingSymbols = symbols
    .map(([code, meta]) => ({ code, ...meta }))
    .filter((item) => !barsBySymbol[item.code]);
  const dataQuality = missingSymbols.length ? 'partial' : 'live';
  const persistence = await savePublicLeagueSnapshot({
    competition: PUBLIC_LEAGUE,
    league,
    dataSource: sources,
    dataQuality,
  });

  return jsonResponse({
    ok: true,
    data: {
      ...league,
      competition: PUBLIC_LEAGUE,
      dataQuality,
      dataSource: sources,
      missingSymbols,
      note: missingSymbols.length ? '部分标的缺少行情，相关交易计划已标记为未执行。' : '账户按真实日线开盘价执行、收盘价结算。',
      persistence,
    },
  });
}
