// 根据用户问题拉取最新行情，供模型引用，减少陈旧数据
// 使用 yahoo-finance2（Yahoo Finance 非官方 API）

const COMMON_SYMBOLS = {
  英伟达: 'NVDA', 苹果: 'AAPL', 特斯拉: 'TSLA', 微软: 'MSFT', 亚马逊: 'AMZN',
  谷歌: 'GOOGL', 脸书: 'META', 奈飞: 'NFLX', 茅台: '600519.SS',
  宁德时代: '300750.SZ', 比亚迪: '002594.SZ', 海南橡胶: '601118.SS',
};

function extractSymbolsFromQuery(query) {
  if (!query || typeof query !== 'string') return [];
  const symbols = new Set();
  // 1) 美股代码：2–5 个大写字母（如 NVDA, AAPL）
  const usTickers = query.match(/\b[A-Z]{2,5}\b/g);
  if (usTickers) usTickers.forEach(t => symbols.add(t));
  // 2) 中文常见名称映射
  Object.entries(COMMON_SYMBOLS).forEach(([name, sym]) => {
    if (query.includes(name)) symbols.add(sym);
  });
  return Array.from(symbols);
}

function formatQuote(symbol, q) {
  if (!q) return null;
  const price = q.regularMarketPrice ?? q.price ?? '';
  const currency = q.currency || 'USD';
  const change = q.regularMarketChangePercent ?? q.regularMarketChange ?? null;
  const changeStr = change != null ? ` 涨跌 ${change > 0 ? '+' : ''}${(Number(change).toFixed(2))}%` : '';
  const pe = q.trailingPE ?? q.forwardPE ?? null;
  const peStr = pe != null ? ` PE(TTM) ${Number(pe).toFixed(1)}` : '';
  const mcap = q.marketCap;
  const mcapStr = mcap != null ? ` 市值约 ${(mcap / 1e9).toFixed(2)}B ${currency}` : '';
  const name = q.shortName || q.longName || symbol;
  return `${name}(${symbol}): 股价 ${price} ${currency}${changeStr}${peStr}${mcapStr}`.trim();
}

export async function getQuoteContext(userQuery) {
  const symbols = extractSymbolsFromQuery(userQuery);
  if (symbols.length === 0) return '';

  let YahooFinance;
  try {
    const mod = await import('yahoo-finance2');
    YahooFinance = mod.default;
  } catch (e) {
    return '';
  }

  const yahooFinance = new YahooFinance();
  const lines = [];
  const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });

  for (const symbol of symbols.slice(0, 5)) {
    try {
      const q = await yahooFinance.quote(symbol);
      const line = formatQuote(symbol, q);
      if (line) lines.push(line);
    } catch (err) {
      // 单只失败不影响其他
    }
  }

  if (lines.length === 0) return '';
  return [
    `【以下为截至 ${today} 的最新行情快照】`,
    `- 你在后续发言、分析、给出结论时，如需引用「股价、市值、估值倍数、涨跌幅」等具体数字，**必须优先以上述数据为准，不要使用你记忆中的旧数据或自行编造数字**。`,
    `- 如果上述列表里没有某个具体数字，请用「大约」「约」「区间」等模糊表述，不要给出看起来精确的过往年份数据。`,
    `- 如需引用历史情况，可以用「过去几年」「上一轮周期」等整体描述，而不要写出具体年份 + 精确数值。`,
    '',
    ...lines,
  ].join('\\n');
}
