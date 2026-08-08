/**
 * quoteContext.js —— 根据用户问题生成「最新市场数据快照」，注入给 AI 引用
 * ------------------------------------------------------------------
 * 流程：解析问题里的公司（A股/港股/美股，支持中文名与代码）→ 拉实时行情
 *      + 财务快照（A股：最新季报/年报主要指标；美股/港股：Yahoo 财务数据）
 *      → 组装成带「数据截至日期」的提示文本。
 *
 * 依赖：marketData.js（统一数据层）
 */
import { resolveSymbols, getQuote, getFinancials, getForecast, needsCompanyData } from './marketData.js';

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

function formatFinancialLines(fin) {
  if (!fin) return [];
  const lines = [];
  const cur = fin.currency && fin.currency !== 'CNY' ? ` ${fin.currency}` : '';
  const latest = fin.latest;
  if (latest) {
    const head = latest.reportName && latest.reportDate
      ? `最新财报 ${latest.reportName}（${latest.reportDate}）`
      : '最新财报';
    lines.push(head);
    const row1 = [];
    if (latest.revenue != null) row1.push(`营业总收入 ${fmtMoney(latest.revenue)}${cur}${latest.revenueGrowth != null ? `（同比 ${fmtPct(latest.revenueGrowth)}）` : ''}`);
    if (latest.netProfit != null) row1.push(`归母净利润 ${fmtMoney(latest.netProfit)}${latest.netProfitGrowth != null ? `（同比 ${fmtPct(latest.netProfitGrowth)}）` : ''}`);
    if (row1.length) lines.push(row1.join(' | '));
    const row2 = [];
    if (latest.grossMargin != null) row2.push(`毛利率 ${fmtPct(latest.grossMargin)}`);
    if (latest.netMargin != null) row2.push(`净利率 ${fmtPct(latest.netMargin)}`);
    if (latest.roe != null) row2.push(`ROE ${fmtPct(latest.roe)}`);
    if (latest.eps != null) row2.push(`每股收益 ${latest.eps}`);
    if (latest.epsTTM != null) row2.push(`每股收益TTM ${Number(latest.epsTTM).toFixed(2)}`);
    if (latest.bps != null) row2.push(`每股净资产 ${Number(latest.bps).toFixed(2)}`);
    if (latest.cashFlowPerShare != null) row2.push(`每股经营现金流 ${Number(latest.cashFlowPerShare).toFixed(2)}`);
    if (latest.debtAssetRatio != null) row2.push(`资产负债率 ${fmtPct(latest.debtAssetRatio)}`);
    if (row2.length) lines.push(row2.join(' | '));
  }
  const annual = fin.annual;
  const sameAsLatest = annual && latest && annual.reportDate === latest.reportDate && annual.reportName === latest.reportName;
  if (annual && !sameAsLatest && annual.revenue != null) {
    const bits = [`${annual.reportName || '年报'}：营收 ${fmtMoney(annual.revenue)}${cur}${annual.revenueGrowth != null ? `（同比 ${fmtPct(annual.revenueGrowth)}）` : ''}`];
    if (annual.netProfit != null) bits.push(`净利 ${fmtMoney(annual.netProfit)}${annual.netProfitGrowth != null ? `（同比 ${fmtPct(annual.netProfitGrowth)}）` : ''}`);
    lines.push(bits.join(' | '));
  }
  if (fin.targetMeanPrice != null || fin.recommendationKey) {
    const bits = [];
    if (fin.targetMeanPrice != null) bits.push(`分析师目标价均值 ${fin.currency || 'USD'} ${Number(fin.targetMeanPrice).toFixed(2)}`);
    if (fin.recommendationKey) bits.push(`评级 ${fin.recommendationKey}`);
    if (fin.numberOfAnalystOpinions) bits.push(`覆盖分析师 ${fin.numberOfAnalystOpinions} 位`);
    if (bits.length) lines.push(bits.join(' | '));
  }
  return lines;
}

function formatForecastLines(info, fin, forecast) {
  const lines = [];
  if (info.market === 'CN' && forecast) {
    // 业绩预告：仅当预告的报告期比已披露实际报表更新时才展示
    const pre = forecast.preannouncement;
    if (pre && pre.content && (!fin?.latest?.reportDate || String(pre.reportPeriod || '') > String(fin.latest.reportDate))) {
      const bits = [`业绩预告（${pre.reportPeriod}，公告 ${pre.noticeDate}）`];
      if (pre.type) bits.push(`类型：${pre.type}`);
      lines.push(bits.join(' | '));
      lines.push(`  ${pre.content}`);
    }
    // 机构一致预期（未来年度）
    const con = forecast.consensus;
    if (con && con.forecasts && con.forecasts.length) {
      const headBits = ['机构一致预期'];
      if (con.rating) headBits.push(`综合评级 ${con.rating}`);
      if (con.orgCount) headBits.push(`${con.orgCount} 家机构`);
      lines.push(headBits.join('｜'));
      for (const f of con.forecasts) {
        if (String(f.mark || '').toUpperCase() === 'A') continue; // 只展示预测年份
        const bits = [];
        if (f.year) bits.push(`${f.year}E`);
        if (f.revenue != null) bits.push(`营收 ${fmtMoney(f.revenue)}${f.revenueGrowth != null ? `（${fmtPct(f.revenueGrowth)}）` : ''}`);
        if (f.netProfit != null) bits.push(`净利 ${fmtMoney(f.netProfit)}${f.netProfitGrowth != null ? `（${fmtPct(f.netProfitGrowth)}）` : ''}`);
        if (f.eps != null) bits.push(`EPS ${Number(f.eps).toFixed(2)}`);
        if (f.roe != null) bits.push(`ROE ${fmtPct(f.roe)}`);
        if (f.pe != null) bits.push(`PE ${Number(f.pe).toFixed(1)}`);
        if (bits.length > 1) lines.push(bits.join(' | '));
      }
    }
  } else if (fin?.forecast) {
    const fy = fin.forecast.thisYear;
    const ny = fin.forecast.nextYear;
    if (fy || ny) {
      const bits = ['机构预测'];
      if (fy) bits.push(`本财年 EPS ≈${Number(fy.eps).toFixed(2)}${fy.growth != null ? `（${fmtPct(fy.growth * 100)}）` : ''}`);
      if (ny) bits.push(`下财年 EPS ≈${Number(ny.eps).toFixed(2)}${ny.growth != null ? `（${fmtPct(ny.growth * 100)}）` : ''}`);
      lines.push(bits.join('｜'));
    }
  }
  return lines;
}

function formatEntry(info, quote, fin, forecast) {
  const headParts = [];
  const displayName = quote?.name || info.name || info.symbol;
  const mktLabel = info.market === 'CN' ? 'A股' : info.market === 'HK' ? '港股' : '美股';
  headParts.push(`${displayName}（${formatSymbolTag(info)}｜${mktLabel}）`);
  const qLine = formatQuoteLine(info, quote);
  if (qLine) headParts.push(qLine);
  const lines = [headParts.join('\n   ')];
  const finLines = formatFinancialLines(fin);
  if (finLines.length) lines.push(...finLines.map((l) => `  ${l}`));
  const fcLines = formatForecastLines(info, fin, forecast);
  if (fcLines.length) lines.push(...fcLines.map((l) => `  ${l}`));
  return lines.join('\n');
}

// ─── 主入口 ──────────────────────────────────────────────
/**
 * 信息层梳理：解析公司 → 拉最新行情/财务 → 生成快照文本
 * @param {string} userQuery 用户问题
 * @returns {Promise<{snapshot: string, notice: string}>}
 */
export async function getQuoteContextInfo(userQuery) {
  if (!userQuery || typeof userQuery !== 'string') {
    return { snapshot: '', notice: '' };
  }

  let symbols = [];
  try {
    symbols = await resolveSymbols(userQuery);
  } catch (e) {
    // 解析失败不致命
  }

  if (!symbols.length) {
    // 快速规则：用户明显在说自己持有的某只股票/持仓，但没点名 → 需要公司
    const NEEDS_COMPANY_RE = /(?:我|自己).{0,8}(?:有|买|持|重仓|套牢|亏|被套).{0,10}(?:股票|股|票|仓位|持仓)|(?:重仓|套牢|深套|满仓|被套).{0,8}(?:股票|股|票)/;
    // 概念/方法论/风格/大盘宏观类问题不需要具体公司数据，不提示
    let notice = '';
    if (NEEDS_COMPANY_RE.test(userQuery)) {
      notice = '未识别到具体公司：如果这个问题涉及某只股票，请补充公司名称或代码（如：贵州茅台 / 600519 / NVDA），大师们才能引用最新行情与财务数据。';
    } else {
      const conceptLike = /什么是|怎么理解|介绍一下|讲解|解释|方法论|投资风格|投资体系|如何|怎样|怎么看懂|术语|概念|仓位管理|怎么做|应该怎么做/.test(userQuery);
      if (!conceptLike) {
        try {
          const need = await needsCompanyData(userQuery);
          if (need) {
            notice = '未识别到具体公司：如果这个问题涉及某只股票，请补充公司名称或代码（如：贵州茅台 / 600519 / NVDA），大师们才能引用最新行情与财务数据。';
          }
        } catch (e) { /* 判定失败不提示 */ }
      }
    }
    return { snapshot: '', notice };
  }

  const entries = await Promise.all(
    symbols.slice(0, 5).map(async (info) => {
      try {
        const [quote, fin, forecast] = await Promise.all([
          getQuote(info).catch(() => null),
          getFinancials(info).catch(() => null),
          getForecast(info).catch(() => null),
        ]);
        return { info, quote, fin, forecast };
      } catch (e) {
        return null;
      }
    }),
  );
  const valid = entries.filter(Boolean);
  if (!valid.length) {
    return { snapshot: '', notice: '未能获取到所选公司的实时数据，请稍后重试或换一家公司。' };
  }

  const today = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });

  const lines = [
    `【以下为截至 ${today} 的最新市场数据快照（来源：东方财富 / Yahoo Finance，均为公开行情数据）】`,
    '- 你在后续发言、分析、给出结论时，如需引用「股价、市值、估值倍数、财务数据（营收/净利/增速/利润率/ROE 等）」等具体数字，**必须以上述快照数据为准**，不要使用你记忆中的旧数据或自行编造数字。',
    '- **快照里没有的精确数字（例如某家公司的 PE、营收、净利、增速），一律不允许引用具体数值**，只能用「大约」「约」「可能」「区间」等模糊表述；宁可说「我没有这家公司的最新精确数据」，也不能用训练记忆里的旧数字冒充最新。',
    '- 各公司数据以快照标注的报告期为准（例如 2026 年一季报），不要自行假设有更新的报告期。',
    '- 【业绩预告】与【机构预测/一致预期】属于预测、预估数据：引用时**必须明确标注为"预测/预计/约"**，不得当作已披露的实际数据，也不要用机构预测反推"实际业绩已公布"。',
    '- 如需引用历史情况，可以用「过去几年」「上一轮周期」等整体描述；不要给出快照之外的具体年份精确数字。',
    '',
    ...valid.map((e, i) => `${i + 1}) ${formatEntry(e.info, e.quote, e.fin, e.forecast)}`),
  ];
  return { snapshot: lines.join('\n'), notice: '' };
}

/**
 * 兼容旧接口：只返回快照文本
 */
export async function getQuoteContext(userQuery) {
  const info = await getQuoteContextInfo(userQuery);
  return info.snapshot;
}
