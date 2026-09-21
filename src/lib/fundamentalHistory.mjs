export const FUNDAMENTAL_HISTORY_LIMIT = 30;

function cleanText(value) {
  return String(value || '').trim();
}

export function fundamentalHistoryKey(entry) {
  const result = entry?.result || {};
  return cleanText(result?.stock?.symbol)
    || cleanText(entry?.symbol)
    || cleanText(result?.symbol)
    || cleanText(result?.stockName)
    || cleanText(entry?.stockName)
    || 'unknown';
}

export function findRecentFundamentalHistory(history, query, now = Date.now(), maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const target = cleanText(query).toLowerCase();
  if (!target) return null;
  return normalizeFundamentalHistory(history).find((entry) => {
    const candidates = [
      entry.symbol,
      entry.stockName,
      entry.result?.stock?.symbol,
      entry.result?.stock?.name,
      entry.result?.stockName,
    ].map((value) => cleanText(value).toLowerCase()).filter(Boolean);
    if (!candidates.includes(target)) return false;
    const at = new Date(entry.at).getTime();
    return Number.isFinite(at) && now - at <= maxAgeMs && now - at >= 0;
  }) || null;
}

export function normalizeFundamentalHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === 'object' && entry.result && typeof entry.result === 'object')
    .map((entry) => ({
      ...entry,
      id: cleanText(entry.id) || `${cleanText(entry.at)}-${fundamentalHistoryKey(entry)}`,
      at: cleanText(entry.at) || new Date(0).toISOString(),
      symbol: cleanText(entry.symbol || entry.result?.stock?.symbol || entry.result?.stockName),
      stockName: cleanText(entry.stockName || entry.result?.stockName || entry.result?.stock?.name || entry.symbol),
      note: cleanText(entry.note),
    }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, FUNDAMENTAL_HISTORY_LIMIT);
}

export function addFundamentalHistoryEntry(history, entry, limit = FUNDAMENTAL_HISTORY_LIMIT) {
  const next = normalizeFundamentalHistory([entry, ...(Array.isArray(history) ? history : [])]);
  return next.slice(0, Math.max(1, Number(limit) || FUNDAMENTAL_HISTORY_LIMIT));
}

export function groupFundamentalHistoryByStock(history) {
  const groups = new Map();
  for (const entry of normalizeFundamentalHistory(history)) {
    const key = fundamentalHistoryKey(entry);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        symbol: cleanText(entry.result?.stock?.symbol || entry.symbol),
        label: cleanText(entry.stockName || entry.result?.stockName || entry.symbol || '未命名股票'),
        latestAt: entry.at,
        records: [],
      });
    }
    const group = groups.get(key);
    group.records.push(entry);
    if (String(entry.at) > String(group.latestAt)) group.latestAt = entry.at;
  }
  return [...groups.values()].sort((a, b) => String(b.latestAt).localeCompare(String(a.latestAt)));
}
