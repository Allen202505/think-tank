// src/app/api/pools/marketTime.js
// 按股票所属市场的交易时段，决定数据缓存有效期：
//  - 正在交易 → 短缓存（约 60s），保证盘中数据接近实时但不打爆源
//  - 已收盘/休市 → 缓存到「下一开盘时刻」，收盘价已定稿，无需反复拉取
// 覆盖：A股/北交所（UTC+8）、港股（UTC+8）、美股（美东时间，含夏令时近似）。
export function marketOfSecid(secid) {
  const m = String(secid || '').split('.')[0];
  if (m === '105' || m === '106') return 'US';
  if (m === '116') return 'HK';
  return 'CN'; // 0/1/4/8/9 等 A股/北交所
}

// 美股：用「美东时间」墙钟；A股/港股用 UTC+8 墙钟
function nyWall(epochMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const parts = {};
  dtf.formatToParts(new Date(epochMs)).forEach((p) => { parts[p.type] = p.value; });
  return {
    weekday: parts.weekday,
    y: +parts.year, mo: +parts.month, d: +parts.day,
    h: (+parts.hour) % 24, mi: +parts.minute,
  };
}

function nyOffsetMs(epochMs) {
  const p = nyWall(epochMs);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - epochMs;
}

// 把「美东墙钟」日期时刻换算成 epoch（通过一次性修正 offset，覆盖夏令时）
function epochAtNyWall(y, mo, d, h, mi) {
  let off = -4 * 3600000; // 初始按 EDT 猜测
  let est = Date.UTC(y, mo - 1, d, h, mi) - off;
  off = nyOffsetMs(est);
  est = Date.UTC(y, mo - 1, d, h, mi) - off;
  off = nyOffsetMs(est);
  return Date.UTC(y, mo - 1, d, h, mi) - off;
}

export function inSession(market, now = new Date()) {
  if (market === 'US') {
    const w = nyWall(now.getTime());
    const mins = w.h * 60 + w.mi;
    const isWk = !/Sun|Sat/.test(w.weekday);
    return isWk && mins >= 570 && mins < 960; // 09:30–16:00 美东
  }
  const w = new Date(now.getTime() + 8 * 3600000); // UTC+8 墙钟
  const day = w.getUTCDay();
  const mins = w.getUTCHours() * 60 + w.getUTCMinutes();
  return day >= 1 && day <= 5 && ((mins >= 570 && mins <= 690) || (mins >= 780 && mins <= 900)); // 09:30–11:30 / 13:00–15:00
}

function msUntilNextOpen(market, now) {
  if (market === 'US') {
    const w = nyWall(now.getTime());
    const isWk = !/Sun|Sat/.test(w.weekday);
    const mins = w.h * 60 + w.mi;
    if (isWk && mins < 570) return epochAtNyWall(w.y, w.mo, w.d, 9, 30) - now.getTime();
    for (let i = 1; i <= 8; i++) {
      const base = new Date(Date.UTC(w.y, w.mo - 1, w.d + i, 0, 0));
      const cand = epochAtNyWall(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), 9, 30);
      if (cand > now.getTime() && !/Sun|Sat/.test(nyWall(cand).weekday)) return cand - now.getTime();
    }
    return 3600000;
  }
  // CN / HK
  const w = new Date(now.getTime() + 8 * 3600000);
  const day = w.getUTCDay();
  const mins = w.getUTCHours() * 60 + w.getUTCMinutes();
  const ep = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi) - 8 * 3600000;
  const isWk = day >= 1 && day <= 5;
  if (isWk) {
    if (mins < 570) return ep(w.getUTCFullYear(), w.getUTCMonth() + 1, w.getUTCDate(), 9, 30) - now.getTime();
    if (mins > 690 && mins < 780) return ep(w.getUTCFullYear(), w.getUTCMonth() + 1, w.getUTCDate(), 13, 0) - now.getTime();
  }
  for (let i = 1; i <= 8; i++) {
    const d = new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate() + i, 0, 0));
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) {
      const t = ep(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 9, 30);
      if (t > now.getTime()) return t - now.getTime();
    }
  }
  return 3600000;
}

// 返回该市场当前的缓存 TTL（毫秒）
export function ttlForMarket(market, now = new Date()) {
  if (inSession(market, now)) return 60 * 1000; // 盘中 60s
  return Math.max(120 * 1000, msUntilNextOpen(market, now)); // 收盘 → 下一开盘才失效
}
