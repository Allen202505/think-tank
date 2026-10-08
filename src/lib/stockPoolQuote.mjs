// 选股池行情：批量实时报价 → 合并到日线最新一根，供当日涨跌与现价统一使用。
const MARKET_TIME_ZONE = {
  CN: 'Asia/Shanghai',
  HK: 'Asia/Shanghai',
  US: 'America/New_York',
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positive(value) {
  const n = num(value);
  return n != null && n > 0 ? n : null;
}

function dateInTimeZone(epochMs, timeZone) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs)).forEach((part) => { parts[part.type] = part.value; });
  if (!parts.year || !parts.month || !parts.day) return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function quoteDateForMarket(quoteAt, market) {
  const raw = num(quoteAt);
  if (raw == null || raw <= 0) return null;
  const epochMs = raw > 1e12 ? raw : raw * 1000;
  return dateInTimeZone(epochMs, MARKET_TIME_ZONE[market] || MARKET_TIME_ZONE.CN);
}

export function parseEastmoneyQuotePayload(payload) {
  const diff = payload?.data?.diff;
  const rows = Array.isArray(diff) ? diff : Object.values(diff || {});
  const quotes = [];
  for (const row of rows) {
    const code = String(row?.f12 || '').trim();
    const marketCode = String(row?.f13 ?? '').trim();
    const price = positive(row?.f2);
    if (!code || !marketCode || price == null) continue;
    const quoteAtSec = num(row?.f124);
    quotes.push({
      secid: `${marketCode}.${code}`,
      symbol: code,
      name: String(row?.f14 || '').trim() || null,
      price,
      prevClose: positive(row?.f18),
      changePct: num(row?.f3),
      quoteAt: quoteAtSec != null && quoteAtSec > 0
        ? (quoteAtSec > 1e12 ? quoteAtSec : quoteAtSec * 1000)
        : null,
      source: 'eastmoney-batch',
    });
  }
  return quotes;
}

// 盘中报价优先：同一交易日覆盖日线收盘价，跨交易日追加一条当日虚拟日线。
// 这样“现价/今日涨跌/本周/区间统计”共享同一口径，不会出现表格现价是 T-1 的情况。
export function mergeQuoteIntoBars(bars, quote, market) {
  const clean = Array.isArray(bars) ? bars.filter((bar) => bar && bar.date && positive(bar.close) != null) : [];
  const price = positive(quote?.price);
  const date = quoteDateForMarket(quote?.quoteAt, market);
  if (!clean.length || price == null || !date) return clean;

  const last = clean[clean.length - 1];
  if (date < last.date) return clean;

  const quotedBar = {
    ...last,
    date,
    close: price,
    quoteAt: quote.quoteAt || null,
    isRealtimeQuote: true,
  };
  if (date === last.date) return [...clean.slice(0, -1), quotedBar];
  return [...clean, quotedBar];
}
