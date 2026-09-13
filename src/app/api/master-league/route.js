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
import { loadPlansFromDb } from '../../../lib/masterLeaguePlansDb.js';
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

function secidOf(code) {
  return `${/^(6|9)/.test(String(code)) ? '1' : '0'}.${String(code)}`;
}

// AI 计划一天只变一次：进程内缓存 60 秒，避免每次请求都打一次数据库；
// 同时加超时保护——数据库抖动时回退到预置剧本，页面不能干等。
const PLAN_CACHE_TTL_MS = 60 * 1000;
let planCache = { at: 0, value: null };

async function loadPlansSafely() {
  if (planCache.value && Date.now() - planCache.at < PLAN_CACHE_TTL_MS) return planCache.value;
  try {
    const result = await Promise.race([
      loadPlansFromDb(),
      new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    if (Array.isArray(result)) {
      planCache = { at: Date.now(), value: result };
      return result;
    }
    // 超时：先用上一次的结果（如果有），否则空数组
    return planCache.value || [];
  } catch {
    return planCache.value || [];
  }
}

/**
 * 把「AI 生成的计划（按真实日期）」翻译成结算引擎认识的 offset 计划。
 * 引擎里 offset = 距最后一个交易日的天数：0 表示下一交易日待执行，1 表示最后一个交易日执行。
 */
export function toEnginePlans(aiPlans, dateList) {
  const indexOf = new Map((dateList || []).map((date, index) => [date, index]));
  const total = (dateList || []).length;
  return (aiPlans || []).map((plan, index) => {
    // 生成时「下一交易日」可能还没发生（execute_date 为空），
    // 这里按真实交易日历补：计划日之后的第一个交易日就是执行日（自动跳过周末与节假日）
    const resolvedExecuteDate = plan.executeDate || (dateList || []).find((date) => date > plan.planDate) || '';
    const executedIndex = resolvedExecuteDate ? indexOf.get(resolvedExecuteDate) : undefined;
    // 找不到执行日（还没到那个交易日）就是待执行计划
    const offset = executedIndex == null ? 0 : total - executedIndex;
    return {
      id: plan.id || `${plan.masterId}-${index}`,
      offset: Math.max(0, offset),
      action: plan.action,
      symbol: plan.symbol,
      targetPct: plan.targetPct,
      reason: plan.reason,
      risk: plan.risk,
      changed: false,
      changeNote: '',
      comments: [],
      source: 'ai',
      executeDate: resolvedExecuteDate,
    };
  });
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

  // AI 生成的每日计划（读不到就全部走预置剧本，页面不受影响）
  const aiPlans = await loadPlansSafely();
  const aiSymbols = [...new Set(aiPlans.map((plan) => plan.symbol).filter((code) => /^\d{6}$/.test(String(code || ''))))]
    .filter((code) => !LEAGUE_SYMBOLS[code]);
  const symbolMeta = {
    ...LEAGUE_SYMBOLS,
    ...Object.fromEntries(aiPlans.filter((plan) => plan.symbol && plan.stockName).map((plan) => [plan.symbol, { name: plan.stockName, secid: secidOf(plan.symbol) }])),
  };

  const baseSymbols = Object.entries(LEAGUE_SYMBOLS);
  const requests = [
    ...baseSymbols.map(([code, meta]) => fetchBars(meta.secid).then((result) => ({ code, ...result }))),
    ...aiSymbols.map((code) => fetchBars(secidOf(code)).then((result) => ({ code, ...result }))),
    fetchBars(LEAGUE_BENCHMARK.secid).then((result) => ({ code: LEAGUE_BENCHMARK.code, benchmark: true, ...result })),
  ];
  const settled = await Promise.all(requests);
  const successful = settled.filter((item) => item.bars.length >= 5);
  const tradeResults = settled.filter((item) => !item.benchmark && item.bars.length >= 5);
  const benchmark = settled.find((item) => item.benchmark && item.bars.length >= 5);
  // 只要预置的 9 只里拿到 6 只以上就能结算（AI 选的票缺行情只影响那一笔，不拖垮整场比赛）
  const canSettle = tradeResults.filter((item) => LEAGUE_SYMBOLS[item.code]).length >= 6 && Boolean(benchmark);

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
  const dateList = benchmark.bars.map((bar) => bar.date);

  // 有 AI 计划的大师走 AI 计划，其余大师继续用预置剧本兜底
  const aiByMaster = new Map();
  for (const plan of aiPlans) {
    if (!aiByMaster.has(plan.masterId)) aiByMaster.set(plan.masterId, []);
    aiByMaster.get(plan.masterId).push(plan);
  }
  const plansByMaster = Object.fromEntries(LEAGUE_MASTERS.map((master) => {
    const own = aiByMaster.get(master.id) || [];
    return [master.id, own.length ? toEnginePlans(own, dateList) : (LEAGUE_PLANS[master.id] || [])];
  }));

  const league = settleMasterLeague({
    masters: LEAGUE_MASTERS,
    plansByMaster,
    barsBySymbol,
    symbolMeta,
    latestDate,
    dateList,
    initialCapital: LEAGUE_INITIAL_CAPITAL,
  });
  const sources = [...new Set(tradeResults.map((item) => item.source).filter(Boolean))];
  const allSymbols = [...baseSymbols.map(([code, meta]) => [code, meta]), ...aiSymbols.map((code) => [code, symbolMeta[code] || { name: code, secid: secidOf(code) }])];
  const missingSymbols = allSymbols
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
      aiPlanCount: aiPlans.length,
      aiMasters: [...aiByMaster.keys()],
      persistence,
    },
  });
}
