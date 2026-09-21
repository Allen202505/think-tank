const CACHE_PREFIX = 'thinktank_query_cache_v1:';
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export function stableHash(value) {
  let hash = 5381;
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export function cacheStorageKey(scope, key = '') {
  return `${CACHE_PREFIX}${scope}:${stableHash(key)}`;
}

export function readJsonCache(scope, key = '', storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(cacheStorageKey(scope, key));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry !== 'object') return null;
    if (entry.expiresAt && Date.now() >= entry.expiresAt) {
      storage.removeItem(cacheStorageKey(scope, key));
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export function writeJsonCache(scope, key = '', value, ttlMs, storage = globalThis.localStorage) {
  const now = Date.now();
  const entry = { at: now, expiresAt: now + Math.max(0, Number(ttlMs) || 0), value };
  try {
    storage?.setItem(cacheStorageKey(scope, key), JSON.stringify(entry));
    return entry;
  } catch {
    return null;
  }
}

function nextWeekdayOpen(year, month, date) {
  const next = new Date(Date.UTC(year, month, date, 1, 15, 0, 0));
  do {
    next.setUTCDate(next.getUTCDate() + 1);
  } while (next.getUTCDay() === 0 || next.getUTCDay() === 6);
  return next.getTime();
}

// 盘中 5 分钟；盘前等开盘；收盘后/周末缓存到下一个工作日 09:15。
export function marketAwareTtlMs(now = Date.now()) {
  const shanghai = new Date(now + SHANGHAI_OFFSET_MS);
  const day = shanghai.getUTCDay();
  const minutes = shanghai.getUTCHours() * 60 + shanghai.getUTCMinutes();
  const year = shanghai.getUTCFullYear();
  const month = shanghai.getUTCMonth();
  const date = shanghai.getUTCDate();
  const todayOpen = Date.UTC(year, month, date, 1, 15, 0, 0); // 09:15 Asia/Shanghai
  if (day === 0 || day === 6) return Math.max(MINUTE_MS, nextWeekdayOpen(year, month, date) - now);
  if (minutes < 9 * 60 + 15) return Math.max(MINUTE_MS, todayOpen - now);
  if (minutes < 15 * 60 + 15) return 5 * MINUTE_MS;
  return Math.max(MINUTE_MS, nextWeekdayOpen(year, month, date) - now);
}

export function researchCacheTtlMs(days = 7) {
  return Math.max(1, Number(days) || 7) * 24 * 60 * 60 * 1000;
}
