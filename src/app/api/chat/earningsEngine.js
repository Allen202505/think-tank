// src/app/api/chat/earningsEngine.js
// 财报拆穿引擎：财报文本 → 识别公司 → 拉系统数据（行情/财务历史/业绩预告/机构预期/研报）
// → 生成「系统数据核验卡」，供「芒格教你读财报」做定量交叉验证。
// 方法论移植自推文里的 Earnings Analysis Skill：surprise 率、收入质量、评级情绪、财报节奏。
// 设计原则：全部用确定性计算产出硬数字，AI 只负责解读与质疑，不能编造。
import { resolveSymbols, getQuote, getForecast, withTimeout } from './marketData.js';
import { getFinHistory, getResearch } from './uziSkills.js';

const num = (v) => {
  if (v == null || v === '' || Number.isNaN(Number(v))) return null;
  return Number(v);
};

function pickAnnualRows(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((r) => r.reportName && /年报|年度/.test(r.reportName))
    .sort((a, b) => String(a.reportDate).localeCompare(String(b.reportDate)));
}

// 最近 N 个报告期趋势（MAINFINADATA 12 期里最新的几条就是最近几个报告期）
function trendLines(history) {
  if (!Array.isArray(history) || !history.length) return [];
  const rows = [...history]
    .sort((a, b) => String(b.reportDate || '').localeCompare(String(a.reportDate || '')))
    .slice(0, 4)
    .filter((r) => num(r.revenue) != null || num(r.netProfit) != null);
  const lines = [];
  for (const r of rows) {
    const bits = [];
    if (num(r.revenue) != null) bits.push(`营收 ${(num(r.revenue) / 1e8).toFixed(1)}亿`);
    if (num(r.revenueGrowth) != null) bits.push(`${num(r.revenueGrowth) > 0 ? '+' : ''}${num(r.revenueGrowth).toFixed(1)}%`);
    if (num(r.netProfit) != null) bits.push(`净利 ${(num(r.netProfit) / 1e8).toFixed(1)}亿`);
    if (num(r.netProfitGrowth) != null) bits.push(`${num(r.netProfitGrowth) > 0 ? '+' : ''}${num(r.netProfitGrowth).toFixed(1)}%`);
    if (num(r.roe) != null) bits.push(`ROE ${num(r.roe).toFixed(1)}%`);
    if (num(r.grossMargin) != null) bits.push(`毛利率 ${num(r.grossMargin).toFixed(1)}%`);
    if (num(r.netMargin) != null) bits.push(`净利率 ${num(r.netMargin).toFixed(1)}%`);
    lines.push(`· ${r.reportName || r.reportDate || '最新'}：${bits.join('，')}`);
  }
  return lines;
}

// 收入质量：经营现金流 / 净利润（>1 优，0.5-1 中，<0.5 差）
function revenueQualityLine(history) {
  const ann = pickAnnualRows(history);
  const latest = ann.length ? ann[ann.length - 1] : (Array.isArray(history) && history.length ? history[0] : null);
  if (!latest) return null;
  const ocf = num(latest.ocf);
  const np = num(latest.netProfit);
  if (ocf == null || np == null || np === 0) return null;
  const ratio = ocf / np;
  const level = ratio >= 1 ? '优（现金流能覆盖利润，赚的是真钱）' : ratio >= 0.5 ? '中（现金流与利润基本匹配）' : '差（利润含金量低，警惕应收/存货堆积）';
  return `· 收入质量：经营现金流/净利润 = ${ratio.toFixed(2)} → ${level}`;
}

// surprise：机构预期 vs 实际（业绩预告 vs 机构预期增速；或年报实际 vs 一致预期净利）
function surpriseLine(forecast, history) {
  if (!forecast) return null;
  const pre = forecast.preannouncement || null;
  const fc = (forecast.consensus && Array.isArray(forecast.consensus.forecasts) && forecast.consensus.forecasts.length)
    ? forecast.consensus.forecasts : [];
  const ann = pickAnnualRows(history);
  const latestAnn = ann.length ? ann[ann.length - 1] : null;

  // ① 年报业绩预告增幅 vs 机构一致预期同年度净利增速（只在预告期为年报时比较，避免季度/年度口径错配）
  if (pre && /12-31$/.test(String(pre.reportPeriod || '')) && (num(pre.ampLow) != null || num(pre.ampHigh) != null)) {
    const preYear = Number(String(pre.reportPeriod).slice(0, 4));
    const f = fc.find((x) => Number(x.year) === preYear && num(x.netProfitGrowth) != null);
    if (f) {
      const low = num(pre.ampLow) ?? num(pre.ampHigh);
      const high = num(pre.ampHigh) ?? num(pre.ampLow);
      const mid = (low + high) / 2;
      const diff = mid - num(f.netProfitGrowth);
      const label = diff > 5 ? '超预期' : diff < -5 ? '不及预期' : '基本符合预期';
      return `· 业绩 vs 预期：年报预告净利增速 ${low.toFixed(0)}%~${high.toFixed(0)}%（${pre.reportPeriod}），机构一致预期 ${num(f.netProfitGrowth).toFixed(1)}% → ${label}`;
    }
  }

  // ② 最新年报实际净利 vs 机构一致预期当年净利
  if (latestAnn && num(latestAnn.netProfit) != null && latestAnn.reportDate) {
    const y = Number(String(latestAnn.reportDate).slice(0, 4));
    const f = fc.find((x) => Number(x.year) === y && num(x.netProfit) != null);
    if (f && num(f.netProfit) !== 0) {
      const dev = (num(latestAnn.netProfit) / num(f.netProfit) - 1) * 100;
      const label = dev > 5 ? '超预期' : dev < -5 ? '不及预期' : '基本符合预期';
      return `· 业绩 vs 预期：${y}年报实际净利 ${(num(latestAnn.netProfit) / 1e8).toFixed(1)}亿 vs 机构一致预期 ${(num(f.netProfit) / 1e8).toFixed(1)}亿（${dev > 0 ? '+' : ''}${dev.toFixed(1)}%）→ ${label}`;
    }
  }
  return null;
}

// 评级情绪：近30日买入/增持占比 vs 近一年占比
function ratingMoodLine(research) {
  if (!research || !Array.isArray(research.recent) || !research.recent.length || !research.ratingDist) return null;
  const days30 = Date.now() - 30 * 86400000;
  const recent30 = research.recent.filter((r) => {
    if (!r.date) return false;
    const t = new Date(String(r.date).replace(/-/g, '/')).getTime();
    return !Number.isNaN(t) && t >= days30;
  });
  if (!recent30.length) return null;
  const isBullish = (rt) => /买入|增持|强烈推荐/.test(String(rt || ''));
  const cur = recent30.filter((r) => isBullish(r.rating)).length / recent30.length;
  const dist = research.ratingDist || {};
  const total = Object.values(dist).reduce((a, b) => a + (num(b) || 0), 0) || 0;
  let base = 0;
  for (const [k, v] of Object.entries(dist)) if (isBullish(k)) base += num(v) || 0;
  base = total ? base / total : 0;
  const diff = cur - base;
  const mood = diff > 0.05 ? '升温' : diff < -0.05 ? '降温' : '平稳';
  return `· 机构评级：近30日 ${recent30.length} 份研报，买入/增持占比 ${(cur * 100).toFixed(0)}%（近一年 ${(base * 100).toFixed(0)}%）→ 机构情绪${mood}`;
}

// 财报节奏：由历史披露日期推导下一报告期（估算，明确标注）
function cadenceLine(history) {
  const dates = (history || []).map((r) => r.reportDate).filter(Boolean);
  const uniq = [...new Set(dates)].sort();
  if (uniq.length < 4) return null;
  const gaps = [];
  for (let i = 1; i < uniq.length; i++) {
    const a = new Date(String(uniq[i - 1]).replace(/-/g, '/')).getTime();
    const b = new Date(String(uniq[i]).replace(/-/g, '/')).getTime();
    if (!Number.isNaN(a) && !Number.isNaN(b)) gaps.push((b - a) / 86400000);
  }
  gaps.sort((a, b) => a - b);
  if (!gaps.length) return null;
  const med = gaps[Math.floor(gaps.length / 2)] || 90;
  const last = new Date(String(uniq[uniq.length - 1]).replace(/-/g, '/')).getTime();
  const next = new Date(last + med * 86400000);
  return `· 财报节奏：下一财报期预计 ${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}（按历史披露节奏估算）`;
}

function fmtMoney(v) {
  if (num(v) == null) return null;
  const n = num(v);
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}万亿`;
  if (abs >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  return `${n.toFixed(0)}`;
}

async function buildInner(text) {
  const symbols = await resolveSymbols(String(text || '').slice(0, 6000));
  const info = symbols && symbols[0];
  if (!info || !info.secid) return { hasData: false };
  const [quote, forecast, history, research] = await Promise.all([
    getQuote(info).catch(() => null),
    getForecast(info).catch(() => null),
    getFinHistory(info).catch(() => null),
    getResearch(info).catch(() => null),
  ]);

  const lines = [];
  const head = info.name && !/^\d{6}$/.test(String(info.name)) ? `${info.name}（${info.symbol}）` : info.symbol;

  if (quote) {
    const bits = [];
    if (num(quote.price) != null) bits.push(`股价 ${quote.price}${quote.changePct != null ? `（${num(quote.changePct) > 0 ? '+' : ''}${num(quote.changePct).toFixed(2)}%）` : ''}`);
    if (num(quote.pe) != null) bits.push(`PE(TTM) ${num(quote.pe).toFixed(1)}`);
    if (num(quote.pb) != null) bits.push(`PB ${num(quote.pb).toFixed(2)}`);
    if (num(quote.marketCap) != null) bits.push(`总市值 ${fmtMoney(quote.marketCap)}`);
    if (num(quote.dividendYield) != null) bits.push(`股息率 ${num(quote.dividendYield).toFixed(2)}%`);
    if (bits.length) lines.push(`· 行情：${bits.join('｜')}`);
  }

  const trend = trendLines(history);
  for (const l of trend) lines.push(l);
  const rq = revenueQualityLine(history);
  if (rq) lines.push(rq);
  const sp = surpriseLine(forecast, history);
  if (sp) lines.push(sp);
  const rm = ratingMoodLine(research);
  if (rm) lines.push(rm);
  const cd = cadenceLine(history);
  if (cd) lines.push(cd);

  if (!lines.length) return { hasData: false };
  return {
    hasData: true,
    stock: { name: info.name, symbol: info.symbol, market: info.market },
    text: `【系统数据核验 · ${head}】\n${lines.join('\n')}`,
  };
}

/**
 * 财报文本 → 系统数据核验卡（整体 9s 超时，失败静默降级，不影响主流程）。
 * @returns {Promise<{hasData:boolean, stock?:object, text?:string}>}
 */
export async function buildEarningsDataCard(text) {
  try {
    return await withTimeout(buildInner(text), 9000);
  } catch (e) {
    return { hasData: false };
  }
}
