import { generateJson } from '../../../../lib/ai.js';
import { getClientIp, guardFreeDailyKey, limitResponse, quotaResponse, rateLimit } from '../../../../lib/rateLimit.js';
import {
  MINI_RESEARCH_DISCLAIMER,
  buildMiniDewaterResult,
  buildMiniResearchMessages,
  buildMiniStockChokeResult,
  normalizeMiniResearchResult,
  validateMiniResearchRequest,
} from '../../../../lib/miniResearch.js';
import {
  authorizeMiniRequest,
  friendlyMiniAiError,
  getMiniDailyLimit,
  miniError,
  miniJson,
} from '../../../../lib/miniProgramApi.js';
import { resolveSymbols, getQuote, getFinancials } from '../../chat/marketData.js';
import { getFinHistory } from '../../chat/uziSkills.js';
import { buildStockChokeMessages, normalizeStockChokeResult } from '../../../../lib/stockChoke.js';
import { buildIndexDewaterReport } from '../../../../lib/indexDewater.mjs';
import { fetchPublicBuffer } from '../../../../lib/safeRemoteFetch.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const REPORT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function fmtNumber(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function fmtYi(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${(n / 1e8).toFixed(1)}亿` : '—';
}

function cleanLinkText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchReportText(link) {
  const { body, contentType, finalUrl } = await fetchPublicBuffer(link, {
    timeoutMs: 18000,
    maxBytes: 20 * 1024 * 1024,
    headers: { 'User-Agent': REPORT_UA, Accept: 'text/html,application/pdf,*/*' },
  });
  if (/pdf/i.test(contentType || '') || /\.pdf(\?|$)/i.test(finalUrl || '')) {
    const { extractPdfText } = await import('../../../../lib/pdfText.js');
    return (await extractPdfText(body)).slice(0, 12000);
  }
  return cleanLinkText(body.toString('utf8')).slice(0, 12000);
}

function latestFinancialLine(fin) {
  const row = fin?.latest;
  if (!row) return '最新财务：未取得';
  return [
    `最新财务（${row.reportName || row.reportDate || '最新报告期'}）`,
    `营收 ${fmtYi(row.revenue)}`,
    `营收同比 ${fmtNumber(row.revenueGrowth, 1)}%`,
    `净利 ${fmtYi(row.netProfit)}`,
    `净利同比 ${fmtNumber(row.netProfitGrowth, 1)}%`,
    `毛利率 ${fmtNumber(row.grossMargin, 1)}%`,
    `净利率 ${fmtNumber(row.netMargin, 1)}%`,
    `ROE ${fmtNumber(row.roe, 1)}%`,
  ].join('｜');
}

function buildCompanyContext(info, quote, fin, history) {
  const rows = (Array.isArray(history) ? history : []).slice(0, 8).map((row) => [
    row.reportName || row.reportDate || '报告期',
    `营收 ${fmtYi(row.revenue)}`,
    `净利 ${fmtYi(row.netProfit)}`,
    `ROE ${fmtNumber(row.roe, 1)}%`,
    `毛利率 ${fmtNumber(row.grossMargin, 1)}%`,
    `经营现金流 ${fmtYi(row.ocf)}`,
    `现金转化率 ${fmtNumber(row.ncoNetProfit, 2)}`,
    `负债率 ${fmtNumber(row.debtRatio, 1)}%`,
  ].join('｜'));

  return [
    `公司：${info.name || quote?.name || info.symbol}（${info.symbol}，${info.market}）`,
    quote
      ? `行情：价格 ${fmtNumber(quote.price)}｜涨跌 ${fmtNumber(quote.changePct)}%｜PE ${fmtNumber(quote.pe)}｜PB ${fmtNumber(quote.pb)}｜市值 ${fmtYi(quote.marketCap)}`
      : '行情：未取得，必须标注数据缺口',
    latestFinancialLine(fin),
    rows.length ? `财务历史：\n${rows.join('\n')}` : '财务历史：未取得，必须标注数据缺口',
  ].join('\n');
}

async function resolveCompany(symbol, { cnOnly = false } = {}) {
  const infos = await resolveSymbols(symbol).catch(() => []);
  const list = cnOnly ? infos.filter((item) => item.market === 'CN') : infos;
  return list[0] || null;
}

async function generateResearchResult(tool, data, context, meta, maxTokens) {
  const messages = buildMiniResearchMessages(tool, data, context);
  const schemaHint = '严格符合系统消息中的研究 JSON Schema';
  const first = await generateJson(messages, schemaHint, maxTokens, false);
  let result = normalizeMiniResearchResult(first.parsed || first.raw, tool, meta);
  if (result) return result;

  const retryMessages = [
    ...messages,
    { role: 'assistant', content: String(first.raw || '').slice(0, 12000) },
    {
      role: 'user',
      content: '上一版输出触发安全限制。请完全重写，删除任何买入、卖出、加仓、减仓、持有、目标价、止损止盈、收益预测或交易建议表述；只保留公开事实、分析框架、风险和需要继续核查的问题。仍按原 JSON Schema 只输出 JSON。',
    },
  ];
  const retry = await generateJson(retryMessages, schemaHint, maxTokens, false);
  result = normalizeMiniResearchResult(retry.parsed || retry.raw, tool, meta);
  if (!result) throw new Error('OUTPUT_SAFETY');
  return result;
}

async function handleNews(data) {
  const result = await generateResearchResult(
    'news',
    data,
    '本轮按用户提供的公开新闻材料分析。没有实时行情快照时，不推断具体公司价格反应。',
    { source: '用户提供的公开新闻材料' },
    2800,
  );
  return { data: result, meta: result.meta };
}

async function handleIndustry(data) {
  const info = await resolveCompany(data.symbol, { cnOnly: true });
  if (!info) return { error: '未识别到 A 股公司，请检查名称或 6 位代码。', status: 400 };
  const [quote, fin, history] = await Promise.all([
    getQuote(info).catch(() => null),
    getFinancials(info).catch(() => null),
    getFinHistory(info).catch(() => null),
  ]);
  if (!quote && !fin && !data.industryData) {
    return { error: '暂时没有取得该公司的公开数据，请补充行业供需、价格或产能信息后重试。', status: 503 };
  }
  const context = [
    buildCompanyContext(info, quote, fin, history),
    data.industryData ? `用户补充行业材料：\n${data.industryData}` : '用户未补充行业材料。',
    '请优先使用上述公开数据；缺失字段必须明确写“数据不足”。',
  ].join('\n\n');
  const result = await generateResearchResult(
    'industry',
    data,
    context,
    {
      company: info.name,
      symbol: info.symbol,
      dataSources: ['东方财富/腾讯公开行情', '公开财务指标', data.industryData ? '用户补充行业材料' : ''],
    },
    3400,
  );
  return { data: result, meta: result.meta };
}

async function handleFundamental(data) {
  const info = await resolveCompany(data.symbol);
  if (!info) return { error: '未识别到该公司，请检查名称或代码。', status: 400 };
  const [quote, fin, history] = await Promise.all([
    getQuote(info).catch(() => null),
    getFinancials(info).catch(() => null),
    info.market === 'CN' ? getFinHistory(info).catch(() => null) : Promise.resolve(null),
  ]);
  if (!quote && !fin && !history?.length) {
    return { error: '暂时没有取得该公司的公开财务数据，请稍后重试。', status: 503 };
  }
  const context = [
    buildCompanyContext(info, quote, fin, history),
    data.note ? `用户补充关注：${data.note}` : '用户未指定额外关注点。',
    '本工具输出基本面研究，不输出买卖评级、目标价或收益预测。',
  ].join('\n\n');
  const result = await generateResearchResult(
    'fundamental',
    data,
    context,
    {
      company: info.name,
      symbol: info.symbol,
      market: info.market,
      dataSources: ['东方财富/腾讯/Yahoo 公开行情与财务指标'],
    },
    4000,
  );
  return { data: result, meta: result.meta };
}

async function handleSupply(data) {
  const messages = buildStockChokeMessages({
    industry: data.industry,
    market: data.market,
    focus: data.focus,
    sectorSnapshot: null,
  });
  const { parsed } = await generateJson(messages, '符合系统消息中的供应链瓶颈 JSON Schema', 4600, false);
  if (!parsed || typeof parsed !== 'object') throw new Error('OUTPUT_SAFETY');
  const normalized = normalizeStockChokeResult(parsed);
  const result = buildMiniStockChokeResult(normalized, data);
  if (!result) throw new Error('OUTPUT_SAFETY');
  return { data: result, meta: result.meta };
}

async function handleMunger(data) {
  let reportText = data.content;
  let source = '用户粘贴的财报材料';
  if (data.link) {
    try {
      const linked = await fetchReportText(data.link);
      if (linked && linked.length >= 200) {
        reportText = linked;
        source = '用户提供的公开财报链接';
      }
    } catch (error) {
      if (!reportText) {
        return { error: '财报链接读取失败，请改为直接粘贴财报原文。', status: 400 };
      }
    }
  }
  if (!reportText || reportText.length < 200) {
    return { error: '财报正文过短，请补充到 200 字以上。', status: 400 };
  }
  const context = [
    '本轮没有额外接入实时财务核验卡，结论只能以用户提供的财报原文为准。',
    data.note ? `用户补充关注：${data.note}` : '用户未指定额外关注点。',
    `财报原文（最多 12000 字）：\n${reportText.slice(0, 12000)}`,
  ].join('\n\n');
  const result = await generateResearchResult(
    'munger',
    { link: data.link || '', note: data.note || '' },
    context,
    { source, reportChars: reportText.length },
    3800,
  );
  return { data: result, meta: result.meta };
}

async function handleDewater(data) {
  const report = await buildIndexDewaterReport({
    range: data.range,
    industries: data.industries,
    stocks: data.stocks.map((code) => ({ code, name: code })),
    force: false,
  });
  const result = buildMiniDewaterResult(report, data);
  if (!result) throw new Error('OUTPUT_SAFETY');
  return { data: result, meta: result.meta };
}

export async function POST(request) {
  const authorized = await authorizeMiniRequest(request, 'research');
  if (!authorized.ok) return miniError(authorized.error, authorized.status);

  const identity = authorized.auth.identity || `ip:${getClientIp(request)}`;
  const rapid = rateLimit(`mini-research:${identity}`, { limit: 8, windowMs: 60_000 });
  if (!rapid.ok) return limitResponse(rapid.retryAfter);

  const validation = validateMiniResearchRequest(authorized.body);
  if (!validation.ok) return miniError(validation.reason, 400);

  if (validation.tool !== 'dewater') {
    const daily = guardFreeDailyKey(identity, { limit: getMiniDailyLimit() });
    if (!daily.ok) return quotaResponse(daily.retryAfter);
  }

  try {
    let response;
    if (validation.tool === 'news') response = await handleNews(validation.data);
    else if (validation.tool === 'industry') response = await handleIndustry(validation.data);
    else if (validation.tool === 'dewater') response = await handleDewater(validation.data);
    else if (validation.tool === 'fundamental') response = await handleFundamental(validation.data);
    else if (validation.tool === 'supply') response = await handleSupply(validation.data);
    else response = await handleMunger(validation.data);

    if (response.error) return miniError(response.error, response.status || 500);
    return miniJson({
      ok: true,
      data: response.data,
      meta: response.meta || {},
      disclaimer: MINI_RESEARCH_DISCLAIMER,
    });
  } catch (error) {
    const message = String(error?.message || '');
    if (message === 'OUTPUT_SAFETY') {
      return miniError('输出未通过内容安全检查，请补充更具体的公开材料后重试。', 502);
    }
    if (/未识别|请输入|请补充|链接|财报正文|至少选择|数据不足/.test(message)) {
      return miniError(message, 400);
    }
    if (/abort|timeout|超时|fetch|network|ECONN|ENOTFOUND|ETIMEDOUT|行情|数据源/i.test(message)) {
      return miniError('连接公开数据或 AI 服务失败，请稍后重试。', 503);
    }
    return miniError(friendlyMiniAiError(error), 502);
  }
}
