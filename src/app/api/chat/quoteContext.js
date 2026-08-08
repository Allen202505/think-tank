/**
 * quoteContext.js —— 根据用户问题生成「最新市场数据快照」，注入给 AI 引用
 * ------------------------------------------------------------------
 * 流程：解析问题里的公司（A股/港股/美股，支持中文名与代码）→ 拉实时行情
 *      + 财务快照（A股：最新季报/年报主要指标；美股/港股：Yahoo 财务数据）
 *      → 组装成带「数据截至日期」的提示文本。
 *
 * 依赖：marketData.js（统一数据层）
 */
import { resolveSymbols, getQuote, getFinancials } from './marketData.js';

// ─── 格式化工具 ──────────────────────────────────────────
function fmtMoney(v) {
  if (v == null || Number.isNaN(Number(v))) return null;
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}万亿`;
  if (abs >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (abs >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return n.toFixed(0);
}

function fmtPct(v) {
  if (v == null || Number.isNaN(Number(v))) return null;
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtPrice(v, market) {
  if (v == null || Number.isNaN(Number(v))) return null;
  const n = Number(v);
  const symbol = market === 'CN' ? '¥' : market === 'HK' ? 'HK$' : '$';
  return `${symbol}${n.toFixed(2)}`;
}

function fmtSignedPct(v) {
  if (v == null || Number.isNaN(Number(v))) return null;
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

// ─── 单只股票的快照文本 ──────────────────────────────────
function formatSymbolTag(info) {
  if (info.market === 'CN') {
    const suffix = info.secid.startsWith('1.') ? 'SH' : 'SZ';
    return `${info.symbol}.${suffix}`;
  }
  if (info.market === 'HK') return `${info.symbol}.HK`;
  return info.symbol;
}

function formatQuoteLine(info, q) {
  if (!q) return null;
  const curLabel = info.market === 'CN' ? 'CNY' : info.market === 'HK' ? 'HKD' : 'USD';
  const bits = [];
  const price = fmtPrice(q.price, info.market);
  if (price) bits.push(`股价 ${price}${q.changePct != null ? `（${fmtSignedPct(q.changePct)}）` : ''}`);
  if (q.marketCap) bits.push(`总市值 ${fmtMoney(q.marketCap)} ${curLabel}`);
  if (q.pe) bits.push(`PE(TTM) ${Number(q.pe).toFixed(1)}`);
  if (q.forwardPe) bits.push(`预测PE ${Number(q.forwardPe).toFixed(1)}`);
  if (q.pb) bits.push(`PB ${Number(q.pb).toFixed(2)}`);
  if (q.dividendYield != null) bits.push(`股息率 ${q.dividendYield.toFixed(2)}%`);
  if (q.fiftyTwoWeekHigh && q.fiftyTwoWeekLow) {
    bits.push(`52周区间 ${q.fiftyTwoWeekLow.toFixed(2)}–${q.fiftyTwoWeekHigh.toFixed(2)}`);
  }
  if (q.beta != null) bits.push(`Beta ${Number(q.beta).toFixed(2)}`);
  return bits.length ? bits.join(' | ') : null;
}

function formatFinancialLinesCN(fin) {
  if (!fin || fin.source !== 'eastmoney') return [];
  const lines = [];
  const latest = fin.latest;
  if (latest) {
    const head = latest.reportName && latest.reportDate
      ? `最新财报 ${latest.reportName}（${latest.reportDate}）`
      : '最新财报';
    lines.push(head);
    const row1 = [];
    if (latest.revenue != null) row1.push(`营业总收入 ${fmtMoney(latest.revenue)}${latest.revenueGrowth != null ? `（同比 ${fmtPct(latest.revenueGrowth)}）` : ''}`);
    if (latest.netProfit != null) row1.push(`归母净利润 ${fmtMoney(latest.netProfit)}${latest.netProfitGrowth != null ? `（同比 ${fmtPct(latest.netProfitGrowth)}）` : ''}`);
    if (row1.length) lines.push(row1.join(' | '));
    const row2 = [];
    if (latest.grossMargin != null) row2.push(`毛利率 ${fmtPct(latest.grossMargin)}`);
    if (latest.netMargin != null) row2.push(`净利率 ${fmtPct(latest.netMargin)}`);
    if (latest.roe != null) row2.push(`ROE ${fmtPct(latest.roe)}`);
    if (latest.eps != null) row2.push(`每股收益 ${latest.eps}`);
    if (latest.bps != null) row2.push(`每股净资产 ${Number(latest.bps).toFixed(2)}`);
    if (latest.cashFlowPerShare != null) row2.push(`每股经营现金流 ${Number(latest.cashFlowPerShare).toFixed(2)}`);
    if (row2.length) lines.push(row2.join(' | '));
  }
  const annual = fin.annual;
  if (annual && annual.revenue != null) {
    const bits = [`${annual.reportName || '年报'}：营收 ${fmtMoney(annual.revenue)}${annual.revenueGrowth != null ? `（同比 ${fmtPct(annual.revenueGrowth)}）` : ''}`];
    if (annual.netProfit != null) {
      bits.push(`净利 ${fmtMoney(annual.netProfit)}${annual.netProfitGrowth != null ? `（同比 ${fmtPct(annual.netProfitGrowth)}）` : ''}`);
    }
    lines.push(bits.join(' | '));
  }
  return lines;
}

function formatFinancialLinesYahoo(fin) {
  if (!fin || fin.source !== 'yahoo') return [];
  const lines = [];
  const cur = fin.currency || 'USD';
  const row1 = [];
  if (fin.revenue != null) row1.push(`营收(TTM) ${fmtMoney(fin.revenue)} ${cur}${fin.revenueGrowth != null ? `（同比 ${fmtPct(fin.revenueGrowth)}）` : ''}`);
  if (fin.netMargin != null) row1.push(`净利率 ${fmtPct(fin.netMargin)}`);
  if (fin.grossMargin != null) row1.push(`毛利率 ${fmtPct(fin.grossMargin)}`);
  if (fin.operatingMargin != null) row1.push(`经营利润率 ${fmtPct(fin.operatingMargin)}`);
  if (row1.length) lines.push(row1.join(' | '));
  const row2 = [];
  if (fin.roe != null) row2.push(`ROE ${fmtPct(fin.roe)}`);
  if (fin.eps != null) row2.push(`每股收益(TTM) ${fin.eps}`);
  if (fin.freeCashflow != null) row2.push(`自由现金流 ${fmtMoney(fin.freeCashflow)} ${cur}`);
  if (fin.operatingCashflow != null) row2.push(`经营现金流 ${fmtMoney(fin.operatingCashflow)} ${cur}`);
  if (fin.forwardPe != null) row2.push(`预测PE ${Number(fin.forwardPe).toFixed(1)}`);
  if (row2.length) lines.push(row2.join(' | '));
  if (fin.targetMeanPrice != null || fin.recommendationKey) {
    const bits = [];
    if (fin.targetMeanPrice != null) bits.push(`分析师目标价均值 ${cur}${Number(fin.targetMeanPrice).toFixed(2)}`);
    if (fin.recommendationKey) bits.push(`评级 ${fin.recommendationKey}`);
    if (fin.numberOfAnalystOpinions) bits.push(`覆盖分析师 ${fin.numberOfAnalystOpinions} 位`);
    if (bits.length) lines.push(bits.join(' | '));
  }
  return lines;
}

function formatEntry(info, quote, fin) {
  const headParts = [];
  const displayName = quote?.name || info.name || info.symbol;
  const mktLabel = info.market === 'CN' ? 'A股' : info.market === 'HK' ? '港股' : '美股';
  headParts.push(`${displayName}（${formatSymbolTag(info)}｜${mktLabel}）`);
  const qLine = formatQuoteLine(info, quote);
  if (qLine) headParts.push(qLine);
  const lines = [headParts.join('\n   ')];
  const finLines = info.market === 'CN'
    ? formatFinancialLinesCN(fin)
    : formatFinancialLinesYahoo(fin);
  if (finLines.length) lines.push(...finLines.map((l) => `  ${l}`));
  return lines.join('\n');
}

// ─── 主入口 ──────────────────────────────────────────────
/**
 * 根据用户问题生成最新市场数据快照文本；无法解析出任何公司时返回空字符串。
 * @param {string} userQuery 用户问题
 * @returns {Promise<string>}
 */
export async function getQuoteContext(userQuery) {
  if (!userQuery || typeof userQuery !== 'string') return '';

  let symbols = [];
  try {
    symbols = await resolveSymbols(userQuery);
  } catch (e) {
    return '';
  }
  if (!symbols.length) return '';

  const entries = await Promise.all(
    symbols.slice(0, 5).map(async (info) => {
      try {
        const [quote, fin] = await Promise.all([
          getQuote(info).catch(() => null),
          getFinancials(info).catch(() => null),
        ]);
        return { info, quote, fin };
      } catch (e) {
        return null;
      }
    }),
  );
  const valid = entries.filter(Boolean);
  if (!valid.length) return '';

  const today = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });

  const lines = [
    `【以下为截至 ${today} 的最新市场数据快照（来源：东方财富 / Yahoo Finance，均为公开行情数据）】`,
    '- 你在后续发言、分析、给出结论时，如需引用「股价、市值、估值倍数、财务数据（营收/净利/增速/利润率/ROE 等）」等具体数字，必须优先以上述数据为准，不要使用你记忆中的旧数据或自行编造数字。',
    '- 如果上面没有某个具体数字，请用「大约」「约」「区间」等模糊表述，不要给出看起来精确的过往年份数据。',
    '- 如需引用历史情况，可以用「过去几年」「上一轮周期」等整体描述；若必须给出年份数据，尽量使用 2025 年或最近 12 个月/最新财报口径，不确定就标注可能过时。',
    '',
    ...valid.map((e, i) => `${i + 1}) ${formatEntry(e.info, e.quote, e.fin)}`),
  ];
  return lines.join('\n');
}
