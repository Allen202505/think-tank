// 腾讯 A 股实时行情解析：给东财 push2 在海外/跨境网络不可用时兜底。
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positive(value) {
  const n = num(value);
  return n != null && n > 0 ? n : null;
}

export function tencentPrefixForCode(code) {
  const value = String(code || '').trim();
  if (!/^\d{6}$/.test(value)) return null;
  if (/^(60|68|90)/.test(value)) return 'sh';
  if (/^(00|30|20)/.test(value)) return 'sz';
  if (/^[489]/.test(value)) return 'bj';
  return null;
}

export function parseTencentQuote(text) {
  const match = String(text || '').match(/v_[a-z]{2}\d{6}="([^"]*)"/i);
  if (!match?.[1]) return null;
  const fields = match[1].split('~');
  if (fields.length < 53) return null;

  const symbol = String(fields[2] || '').trim();
  if (!/^\d{6}$/.test(symbol)) return null;

  const latest = num(fields[3]);
  const prevClose = num(fields[4]);
  const isPreviousClose = !(latest > 0) && prevClose > 0;
  const price = latest > 0 ? latest : (isPreviousClose ? prevClose : null);
  if (price == null) return null;

  const amountParts = String(fields[35] || '').split('/');
  const marketCapYi = num(fields[45]);
  const floatMarketCapYi = num(fields[44]);

  return {
    symbol,
    name: String(fields[1] || '').trim() || null,
    price,
    prevClose,
    isPreviousClose,
    change: num(fields[31]),
    changePct: isPreviousClose ? null : num(fields[32]),
    open: num(fields[5]),
    high: num(fields[33]),
    low: num(fields[34]),
    volume: num(fields[6]),
    amount: num(amountParts[2]),
    amountWan: num(fields[37]),
    turnoverRate: num(fields[38]),
    pe: positive(fields[52]) ?? positive(fields[39]),
    pb: positive(fields[46]),
    marketCap: marketCapYi != null ? marketCapYi * 1e8 : null,
    floatMarketCap: floatMarketCapYi != null ? floatMarketCapYi * 1e8 : null,
    currency: 'CNY',
    industry: null,
    source: 'tencent',
  };
}
