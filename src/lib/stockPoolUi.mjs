export const STOCK_POOL_FREEZE_OPTIONS = [0, 1, 2, 3, 4, 5];

export function normalizePoolFreezeCount(value, max = 5) {
  const count = Math.floor(Number(value));
  if (!Number.isFinite(count)) return 2;
  return Math.max(0, Math.min(Math.max(0, max), count));
}

export function removeSymbolFromPool(pool, symbol) {
  if (!pool || !symbol) return pool;
  const code = String(symbol).trim();
  const symbols = Array.isArray(pool.symbols) ? pool.symbols : [];
  const nextSymbols = symbols.filter((item) => String(item).trim() !== code);
  if (nextSymbols.length === symbols.length) return pool;
  return { ...pool, symbols: nextSymbols };
}
