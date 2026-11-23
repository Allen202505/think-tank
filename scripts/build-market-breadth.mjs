import fs from 'node:fs/promises';
import path from 'node:path';

const SINA_LIST = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData';
const SINA_KLINE = 'https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData';
const INDEX_KLINE = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
const OUTPUT = path.resolve('src/data/marketBreadthHistory.json');
const CONCURRENCY = 20;
const HISTORY_BARS = 320;

async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json,text/plain,*/*' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/plain,*/*' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry(fn, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try { return await fn(); } catch (error) { last = error; await new Promise((r) => setTimeout(r, 250 * (i + 1))); }
  }
  throw last;
}

async function fetchNode(node) {
  const rows = [];
  for (let page = 1; page <= 80; page += 1) {
    const query = new URLSearchParams({ page: String(page), num: '100', sort: 'symbol', asc: '1', node, symbol: '' });
    const batch = await withRetry(() => fetchJson(`${SINA_LIST}?${query}`));
    if (!Array.isArray(batch) || !batch.length) break;
    rows.push(...batch);
  }
  return rows;
}

async function fetchKline(code, market) {
  const symbol = `${market}${code}`;
  const query = new URLSearchParams({ symbol, scale: '240', ma: 'no', datalen: String(HISTORY_BARS) });
  const rows = await withRetry(() => fetchJson(`${SINA_KLINE}?${query}`));
  return Array.isArray(rows) ? rows : [];
}

async function fetchIndexQuote() {
  const text = await withRetry(() => fetchText('https://qt.gtimg.cn/q=sh000001', 10000));
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
    changePct: Number.isFinite(changePct) ? changePct : (prevClose > 0 ? Math.round((price / prevClose - 1) * 10000) / 100 : null),
  };
}

async function fetchIndexBars() {
  try {
    const payload = await withRetry(() => fetchJson(`${INDEX_KLINE}?param=sh000001,day,,,${HISTORY_BARS},qfq`));
    const rows = payload?.data?.sh000001?.qfqday || payload?.data?.sh000001?.day || [];
    if (rows.length) return rows.map((row) => ({ date: row[0], close: Number(row[2]), open: Number(row[1]) }))
      .filter((row) => row.date && Number.isFinite(row.close));
  } catch { /* 新浪兜底 */ }
  const query = new URLSearchParams({ symbol: 'sh000001', scale: '240', ma: 'no', datalen: String(HISTORY_BARS) });
  const rows = await withRetry(() => fetchJson(`${SINA_KLINE}?${query}`));
  return (Array.isArray(rows) ? rows : []).map((row) => ({ date: row.day, close: Number(row.close), open: Number(row.open) }))
    .filter((row) => row.date && Number.isFinite(row.close));
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

const startedAt = Date.now();
const [allRows, indexBars] = await Promise.all([fetchNode('hs_a'), fetchIndexBars()]);
const stocks = allRows.map((r) => {
  const symbol = String(r.symbol || '');
  const market = symbol.slice(0, 2);
  return { code: String(r.code), name: r.name, market };
})
  .filter((s) => /^\d{6}$/.test(s.code) && ['sh', 'sz', 'bj'].includes(s.market))
  .filter((s, i, all) => all.findIndex((x) => x.code === s.code) === i);
console.log('stocks', stocks.length, 'indexBars', indexBars.length);

const byDate = new Map();
let ok = 0;
let failed = 0;
let processed = 0;
await mapLimit(stocks, CONCURRENCY, async (stock) => {
  try {
    const bars = await fetchKline(stock.code, stock.market);
    if (bars.length >= 2) {
      ok += 1;
      for (let i = 1; i < bars.length; i += 1) {
        const close = Number(bars[i].close);
        const prev = Number(bars[i - 1].close);
        const date = String(bars[i].day || '');
        if (!date || !Number.isFinite(close) || !Number.isFinite(prev) || close <= 0 || prev <= 0) continue;
        const row = byDate.get(date) || { date, up: 0, down: 0, flat: 0, total: 0 };
        if (close > prev) row.up += 1;
        else if (close < prev) row.down += 1;
        else row.flat += 1;
        row.total += 1;
        byDate.set(date, row);
      }
    } else {
      failed += 1;
    }
  } catch {
    failed += 1;
  } finally {
    processed += 1;
    if (processed % 500 === 0) console.log('progress', processed, '/', stocks.length, 'ok', ok, 'failed', failed);
  }
});

const indexByDate = new Map(indexBars.map((bar, i) => {
  const prev = indexBars[i - 1];
  return [bar.date, {
    close: bar.close,
    changePct: prev?.close > 0 ? Math.round((bar.close / prev.close - 1) * 10000) / 100 : null,
  }];
}));
const liveIndex = await fetchIndexQuote();
if (liveIndex) {
  indexByDate.set(liveIndex.date, { close: liveIndex.close, changePct: liveIndex.changePct });
  const liveRows = allRows.filter((row) => Number(row.trade) > 0 && Number.isFinite(Number(row.changepercent)));
  const liveDay = liveRows.reduce((acc, row) => {
    const change = Number(row.changepercent);
    acc.total += 1;
    if (change > 0) acc.up += 1;
    else if (change < 0) acc.down += 1;
    else acc.flat += 1;
    return acc;
  }, { date: liveIndex.date, up: 0, down: 0, flat: 0, total: 0 });
  if (liveDay.total >= 1000) byDate.set(liveDay.date, liveDay);
}
const latestDate = liveIndex?.date || [...byDate.keys()].sort().at(-1) || '';
const days = [...byDate.values()]
  .filter((day) => day.total >= 1000 && day.date <= latestDate)
  .sort((a, b) => a.date.localeCompare(b.date))
  .map((day) => ({
    ...day,
    indexClose: indexByDate.get(day.date)?.close ?? null,
    indexChangePct: indexByDate.get(day.date)?.changePct ?? null,
  }))
  .slice(-260);

const payload = {
  generatedAt: new Date().toISOString(),
  source: '新浪财经：沪深北 A 股日线聚合',
  methodology: '按当前沪深北 A 股列表回溯日线，统计每日收盘价高于/低于/等于前收盘的股票数量；停牌或无当日行情的股票不计入。',
  universeCount: stocks.length,
  successCount: ok,
  failedCount: failed,
  startDate: days[0]?.date,
  endDate: days.at(-1)?.date,
  days,
};
await fs.writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log('written', OUTPUT, `${days.length} days`, `${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
