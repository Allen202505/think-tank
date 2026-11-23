import history from '../../../data/marketBreadthHistory.json';
import { computeMarketBreadthStats, mergeLiveBreadthDay } from '../../../lib/marketBreadth.mjs';
import { getClientIp, limitResponse, rateLimit } from '../../../lib/rateLimit';

export const runtime = 'nodejs';

const SINA_LIST = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';
let liveCache = { at: 0, value: null };

async function fetchJson(url, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchIndexQuote() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch('https://qt.gtimg.cn/q=sh000001', { headers: { 'User-Agent': UA }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const match = text.match(/v_sh000001="([^"]*)"/);
    if (!match) return null;
    const f = match[1].split('~');
    const price = Number(f[3]);
    const prevClose = Number(f[4]);
    const changePct = Number(f[32]);
    const time = String(f[30] || '');
    const date = /^\d{8}/.test(time) ? `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)}` : '';
    if (!date || !Number.isFinite(price) || !Number.isFinite(prevClose)) return null;
    return {
      date,
      close: price,
      changePct: Number.isFinite(changePct) ? changePct : Math.round((price / prevClose - 1) * 10000) / 100,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLiveBreadthDay() {
  if (liveCache.value && Date.now() - liveCache.at < 2 * 60 * 1000) return liveCache.value;
  const [pages, indexQuote] = await Promise.all([
    Promise.allSettled(Array.from({ length: 60 }, (_, index) => {
      const query = new URLSearchParams({ page: String(index + 1), num: '100', sort: 'symbol', asc: '1', node: 'hs_a', symbol: '' });
      return fetchJson(`${SINA_LIST}?${query}`);
    })),
    fetchIndexQuote(),
  ]);
  const rows = pages.flatMap((item) => item.status === 'fulfilled' && Array.isArray(item.value) ? item.value : []);
  if (rows.length < 1000) throw new Error('实时全 A 股列表不可用');
  const counts = rows.reduce((acc, row) => {
    const trade = Number(row.trade);
    const change = Number(row.changepercent);
    if (!(trade > 0) || !Number.isFinite(change)) return acc;
    acc.total += 1;
    if (change > 0) acc.up += 1;
    else if (change < 0) acc.down += 1;
    else acc.flat += 1;
    return acc;
  }, { up: 0, down: 0, flat: 0, total: 0 });
  if (!indexQuote) throw new Error('指数实时行情不可用');
  const value = {
    ...counts,
    date: indexQuote.date,
    indexClose: indexQuote.close,
    indexChangePct: indexQuote.changePct,
  };
  liveCache = { at: Date.now(), value };
  return value;
}

export async function POST(request) {
  const rl = rateLimit(`market-breadth:${getClientIp(request)}`, { limit: 60, windowMs: 60000 });
  if (!rl.ok) return limitResponse(rl.retryAfter);
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: '请求参数格式错误' }, { status: 400 }); }
  try {
    let sourceHistory = history;
    try {
      const liveDay = await Promise.race([
        fetchLiveBreadthDay(),
        new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
      if (liveDay) sourceHistory = mergeLiveBreadthDay(history, liveDay);
    } catch {
      /* 静态快照兜底 */
    }
    const result = computeMarketBreadthStats(sourceHistory, {
      range: body?.range || '1y',
      startDate: body?.startDate || '',
      endDate: body?.endDate || '',
    });
    return Response.json({ ok: true, ...result }, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=120, stale-while-revalidate=300' },
    });
  } catch (error) {
    const message = String(error?.message || '');
    if (/日期|区间|开始|结束/.test(message)) return Response.json({ error: message }, { status: 400 });
    return Response.json({ error: '涨跌家数数据暂不可用' }, { status: 503 });
  }
}
