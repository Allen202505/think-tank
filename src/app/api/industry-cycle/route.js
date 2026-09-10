// POST { symbol, industryData, aiConfig } → A 股行业周期定位
// 真实数据优先：行情/财报/行业指数/估值来自公开数据层，缺口明确降置信度，不用模型记忆补数。
import { SYSTEM_GUARD } from '../../../lib/security';
import { getClientIp, rateLimit, limitResponse, guardFreeDaily, quotaResponse } from '../../../lib/rateLimit';
import { generateJson } from '../../../lib/ai';
import { resolveSymbols, getQuote, getFinancials } from '../chat/marketData';
import { getDeepAnalysis } from '../chat/uziSkills';
import { CYCLE_DIMENSIONS, buildIndustryCyclePrompt, computeCycleTotal } from '../../../lib/industryCycle';

const EM_SUGGEST = 'https://searchapi.eastmoney.com/api/suggest/get';
const EM_BOARD_QUOTE = 'https://push2.eastmoney.com/api/qt/stock/get';
const EM_BOARD_KLINE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const EM_TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const boardCache = new Map();

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, d = 2) => (num(v) == null ? null : Math.round(num(v) * 10 ** d) / 10 ** d);
const fmtPct = (v, d = 1) => (num(v) == null ? '—' : `${num(v) > 0 ? '+' : ''}${num(v).toFixed(d)}%`);
const fmtYi = (v, d = 1) => (num(v) == null ? '—' : `${(num(v) / 1e8).toFixed(d)}亿`);
const fmtNum = (v, d = 2) => (num(v) == null ? '—' : num(v).toFixed(d));
const clean = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const todayCN = () => new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });

function buildMessages(prompt, userAsk) {
  return [{ role: 'system', content: SYSTEM_GUARD }, { role: 'system', content: prompt }, { role: 'user', content: userAsk }];
}

async function fetchJson(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', Referer: 'https://quote.eastmoney.com/' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function cachedBoard(key, fn, ttlMs = 30 * 60000) {
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  boardCache.set(key, { at: Date.now(), value });
  return value;
}

async function searchBoardCode(boardName) {
  if (!boardName) return null;
  const url = `${EM_SUGGEST}?input=${encodeURIComponent(boardName)}&type=14&token=${EM_TOKEN}&count=8`;
  const json = await fetchJson(url, 8000);
  const rows = (json?.QuotationCodeTable?.Data || []).filter((r) => /BK\d+/.test(String(r?.QuoteID || r?.Code || '')));
  if (!rows.length) return null;
  const exact = rows.find((r) => String(r.Name || '') === String(boardName));
  const picked = exact || rows[0];
  const m = String(picked.QuoteID || picked.Code || '').match(/BK\d+/);
  return m ? { code: m[0], name: picked.Name || boardName } : null;
}

function calcReturns(rows, n) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const latest = rows[rows.length - 1];
  const base = rows[Math.max(0, rows.length - 1 - n)];
  if (!latest?.close || !base?.close) return null;
  return round((latest.close / base.close - 1) * 100, 2);
}

async function getIndustryBoard(boardName) {
  if (!boardName) return null;
  return cachedBoard(`board:${boardName}`, async () => {
    const found = await searchBoardCode(boardName).catch(() => null);
    if (!found?.code) return { name: boardName, code: null, available: false };
    const secid = `90.${found.code}`;
    const [quoteJson, klineJson] = await Promise.all([
      fetchJson(`${EM_BOARD_QUOTE}?secid=${encodeURIComponent(secid)}&fields=f43,f57,f58,f59,f170&fltt=2`, 8000).catch(() => null),
      fetchJson(`${EM_BOARD_KLINE}?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53&klt=101&fqt=1&end=20500101&lmt=260`, 10000).catch(() => null),
    ]);
    const q = quoteJson?.data || null;
    const scale = 10 ** (q?.f59 ?? 2);
    const rows = (klineJson?.data?.klines || [])
      .map((line) => {
        const [date, close] = String(line).split(',');
        return { date, close: num(close) };
      })
      .filter((r) => r.date && r.close != null);
    const last = rows[rows.length - 1] || null;
    return {
      available: !!(q || rows.length),
      name: q?.f58 || found.name || boardName,
      code: found.code,
      price: q?.f43 != null ? q.f43 / scale : null,
      changePct: num(q?.f170),
      date: last?.date || null,
      returns: {
        d20: calcReturns(rows, 20),
        d60: calcReturns(rows, 60),
        d120: calcReturns(rows, 120),
        d250: calcReturns(rows, 250),
      },
    };
  }).catch(() => ({ name: boardName, code: null, available: false }));
}

function stockReturns(kline) {
  const rows = (Array.isArray(kline) ? kline : [])
    .map((r) => ({ date: r.date || r.day || '', close: num(r.close) }))
    .filter((r) => r.close != null)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return {
    d20: calcReturns(rows, 20),
    d60: calcReturns(rows, 60),
    d120: calcReturns(rows, 120),
    d250: calcReturns(rows, 250),
  };
}

function volumeRead(kline) {
  if (!Array.isArray(kline) || kline.length < 25) return null;
  const rows = kline.slice(-25);
  const lastVol = num(rows[rows.length - 1]?.vol ?? rows[rows.length - 1]?.volume);
  const prev = rows.slice(0, -1).map((r) => num(r.vol ?? r.volume)).filter((v) => v != null && v > 0);
  if (lastVol == null || !prev.length) return null;
  const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
  if (!avg) return null;
  const ratio = lastVol / avg;
  return { ratio: round(ratio, 2), state: ratio > 1.35 ? '显著放量' : ratio < 0.7 ? '明显缩量' : '量能平稳' };
}

function buildDataSection({ info, quote, fin, deep, board }) {
  const latest = deep?.finHistory?.[0] || fin?.latest || null;
  const annual = (deep?.finHistory || [])
    .filter((r) => r.reportDate && /年报|年度/.test(String(r.reportName || '')))
    .sort((a, b) => String(a.reportDate).localeCompare(String(b.reportDate)))
    .slice(-5);
  const balance = deep?.balanceItems || null;
  const val = deep?.valuation || null;
  const pv = deep?.positionVolume || null;
  const comps = deep?.comps || null;
  const orders = deep?.orderInfo?.summary || null;
  const mainBusiness = deep?.mainBusiness || null;
  const income = deep?.incomeExtras || null;
  const sReturns = stockReturns(deep?.kline);
  const volume = volumeRead(deep?.kline);
  const industryName = quote?.industry || board?.name || deep?.industry?.emIndustry || '未识别';
  const lines = [];

  lines.push(`【标的与行业】${quote?.name || info.name || info.symbol}（${info.symbol}）；A股；申万/东财行业口径：${industryName}；CSRC：${deep?.industry?.csrcIndustry || '未获取'}。`);
  lines.push(`【行情快照｜本次拉取 ${todayCN()}】现价 ${fmtNum(quote?.price)} 元；当日 ${fmtPct(quote?.changePct, 2)}；PE ${fmtNum(quote?.pe)}；PB ${fmtNum(quote?.pb)}；总市值 ${fmtYi(quote?.marketCap)}；流通市值 ${fmtYi(quote?.floatMarketCap)}。`);
  lines.push(`【股价周期】近20日 ${fmtPct(sReturns.d20, 2)}；近60日 ${fmtPct(sReturns.d60, 2)}；近120日 ${fmtPct(sReturns.d120, 2)}；近250日 ${fmtPct(sReturns.d250, 2)}；量能 ${volume ? `${volume.state}（最新/前20日均量 ${volume.ratio}倍）` : '未获取'}。`);
  if (pv) lines.push(`【历史位置】10年分位 ${pv.pos10y ?? '—'}%；5年分位 ${pv.pos5y ?? '—'}%；3年分位 ${pv.pos3y ?? '—'}%；10年区间 ${pv.low10y ?? '—'}—${pv.high10y ?? '—'} 元；近3年箱体宽度 ${pv.box3yWidthPct ?? '—'}%；低位区停留 ${pv.monthsInLowerThird ?? '—'} 个月。`);
  if (val) lines.push(`【估值分位】PE ${fmtNum(quote?.pe)}，历史分位 ${val.pePercentile ?? '—'}%；PB ${fmtNum(quote?.pb)}，历史分位 ${val.pbPercentile ?? '—'}%；${val.peBand || ''}${val.peBand && val.pbBand ? '；' : ''}${val.pbBand || ''}`);

  if (latest) {
    lines.push(`【最新财务｜${latest.reportName || latest.reportDate || '报告期未明'}】营收同比 ${fmtPct(latest.revenueGrowth)}；归母净利同比 ${fmtPct(latest.netProfitGrowth)}；毛利率 ${fmtNum(latest.grossMargin)}%；净利率 ${fmtNum(latest.netMargin)}%；ROE ${fmtNum(latest.roe)}%；现金转化率 ${fmtNum(latest.ncoNetProfit)}。`);
  } else {
    lines.push('【最新财务】未获取到。');
  }
  if (annual.length) {
    lines.push('【年度趋势】' + annual.map((r) => `${String(r.reportDate).slice(0, 4)}：营收 ${fmtYi(r.revenue)}（${fmtPct(r.revenueGrowth)}），归母 ${fmtYi(r.netProfit)}（${fmtPct(r.netProfitGrowth)}），毛利率 ${fmtNum(r.grossMargin)}%，ROE ${fmtNum(r.roe)}%`).join('；') + '。');
  }
  if (balance) {
    lines.push(`【资产负债表｜${balance.reportDate || '报告期未明'}】存货 ${balance.inventoryYi ?? '—'}亿，同比 ${fmtPct(balance.inventoryYoyPct)}；应收 ${balance.receivablesYi ?? '—'}亿，同比 ${fmtPct(balance.receivablesYoyPct)}；应付 ${balance.payablesYi ?? '—'}亿；有息负债 ${balance.interestDebtYi ?? '—'}亿；货币资金 ${balance.cashYi ?? '—'}亿；净现金 ${balance.netCashYi ?? '—'}亿。`);
  }
  if (income) {
    lines.push(`【盈利质量｜${income.reportDate || '报告期未明'}】扣非归母 ${income.deductParentProfitYi ?? '—'}亿，同比 ${fmtPct(income.deductYoyPct)}；扣非/归母差 ${fmtPct(income.deductVsParentPct)}；政府补助代理占归母 ${income.subsidyishToProfitPct ?? '—'}%。`);
  }
  if (mainBusiness?.byProduct?.length) {
    lines.push('【主营构成】' + mainBusiness.byProduct.slice(0, 5).map((x) => `${x.name} ${x.ratioPct ?? '—'}%${x.grossPct != null ? `（毛利率 ${x.grossPct}%）` : ''}`).join('；') + '。');
  }
  if (orders) {
    lines.push(`【订单/合同｜${orders.reportDate || '日期未明'}】在手订单 ${orders.backlogYi ?? '—'}亿；新签 ${orders.newYi ?? orders.h1NewYi ?? '—'}亿。`);
  }
  if (comps) {
    lines.push(`【同行估值】行业 ${comps.industry || industryName}；同行中位 PE ${comps.medianPe ?? '—'}；中位 PB ${comps.medianPb ?? '—'}；本股 PE 高于 ${comps.pePercentile ?? '—'}% 同行；${comps.verdict || ''}。`);
  }
  if (deep?.businessReview?.text) {
    lines.push(`【管理层经营评述｜${deep.businessReview.reportDate || '日期未明'}】${clean(deep.businessReview.text).slice(0, 1600)}`);
  }

  if (board?.available) {
    lines.push(`【行业指数｜${board.name} ${board.code || ''}｜${board.date || '日期未明'}】当日 ${fmtPct(board.changePct, 2)}；近20日 ${fmtPct(board.returns?.d20, 2)}；近60日 ${fmtPct(board.returns?.d60, 2)}；近120日 ${fmtPct(board.returns?.d120, 2)}；近250日 ${fmtPct(board.returns?.d250, 2)}。`);
    const rel60 = num(sReturns.d60) != null && num(board.returns?.d60) != null ? num(sReturns.d60) - num(board.returns.d60) : null;
    lines.push(`【相对行业】个股近60日相对行业 ${fmtPct(rel60, 2)}。`);
  } else {
    lines.push(`【行业指数】${industryName}：未获取到可靠的行业指数快照。`);
  }

  lines.push('【通用数据缺口】公开通用接口通常不覆盖：行业社会库存、主导产品现货/期货价格、行业开工率、产能扩张/退出、行业资本开支、最新政策冲击。上述维度若用户未补充，必须标为数据不足，不能凭模型记忆补写当前精确值。');
  lines.push('【可使用的已有领先/同步代理】需求可参考营收增速、订单/合同和管理层经营评述；库存可参考公司存货同比（仅公司库存代理，不等同行业社会库存）；价格只能用现有毛利率和营收变化作弱代理，不能声称是商品价格；利润可参考净利增速、毛利率、扣非和现金转化；市场预期可参考行业指数、个股相对涨幅、PE/PB历史分位与同行估值；股价位置可参考近3/5/10年分位与量能。');
  return lines.join('\n');
}

function normalizeResult(parsed, computed, sourceNotes, asOf) {
  const summary = parsed?.summary && typeof parsed.summary === 'object' ? parsed.summary : {};
  let confidence = ['高', '中', '低'].includes(summary.confidence) ? summary.confidence : '中';
  if (computed.coverage < 50) confidence = '低';
  else if (computed.coverage < 75 && confidence === '高') confidence = '中';
  const aiStage = String(summary.stage || '').trim();
  const stage = aiStage || computed.stageFromScore || '数据不足';
  const dashboard = computed.dashboard.map((d) => {
    const dim = CYCLE_DIMENSIONS.find((x) => x.key === d.key) || {};
    return {
      key: d.key,
      label: d.label || dim.label || d.key,
      weight: dim.weight ?? 0,
      status: clean(d.status) || (d.score == null ? '数据不足' : '—'),
      trend: clean(d.trend) || '→',
      periodMeaning: clean(d.periodMeaning) || dim.scoreHint || '',
      score: d.score,
      points: d.points,
      evidence: clean(d.evidence) || '未提供证据',
      dataDate: clean(d.dataDate) || '未获取',
      source: clean(d.source) || '未注明',
      missing: d.missing === true || d.score == null && dim.weight > 0,
    };
  });
  return {
    summary: {
      oneLine: clean(summary.oneLine) || '本次未能形成可靠的一句话结论。',
      cycleCategory: clean(summary.cycleCategory) || '未分类',
      cyclical: summary.cyclical !== false,
      cycleStrength: clean(summary.cycleStrength) || '中',
      stage,
      direction: clean(summary.direction) || '稳定',
      opportunity: clean(summary.opportunity) || '待验证',
      mainRisk: clean(summary.mainRisk) || '待验证',
      confidence,
      confidenceReason: clean(summary.confidenceReason) || `七项核心维度覆盖 ${computed.coverage}%。`,
    },
    driver: clean(parsed?.driver) || '待补充周期发动机。',
    chain: {
      steps: Array.isArray(parsed?.chain?.steps) ? parsed.chain.steps.map(clean).filter(Boolean) : [],
      logic: clean(parsed?.chain?.logic) || '待补充传导逻辑。',
    },
    dashboard,
    total: computed.total,
    coverage: computed.coverage,
    stageFromScore: computed.stageFromScore,
    stageReason: clean(parsed?.stageReason) || '缺少阶段解释。',
    inflection: {
      reversed: Array.isArray(parsed?.inflection?.reversed) ? parsed.inflection.reversed.map(clean).filter(Boolean) : [],
      notYet: Array.isArray(parsed?.inflection?.notYet) ? parsed.inflection.notYet.map(clean).filter(Boolean) : [],
      awaiting: Array.isArray(parsed?.inflection?.awaiting) ? parsed.inflection.awaiting.map(clean).filter(Boolean) : [],
      keyIndicator: clean(parsed?.inflection?.keyIndicator) || '待确认',
    },
    company: Array.isArray(parsed?.company) ? parsed.company.map((x) => ({
      metric: clean(x.metric), status: clean(x.status), trend: clean(x.trend), conclusion: clean(x.conclusion),
    })).filter((x) => x.metric) : [],
    stockPosition: Array.isArray(parsed?.stockPosition) ? parsed.stockPosition.map((x) => ({
      metric: clean(x.metric), value: clean(x.value), read: clean(x.read),
    })).filter((x) => x.metric) : [],
    matrix: {
      industryCycle: clean(parsed?.matrix?.industryCycle) || stage,
      companyCycle: clean(parsed?.matrix?.companyCycle) || '待验证',
      quadrant: /^[ABCD]$/.test(String(parsed?.matrix?.quadrant || '').toUpperCase()) ? String(parsed.matrix.quadrant).toUpperCase() : '',
      label: clean(parsed?.matrix?.label) || '待定位',
      interpretation: clean(parsed?.matrix?.interpretation) || '待补充二维判断。',
    },
    watchlist: Array.isArray(parsed?.watchlist) ? parsed.watchlist.map(clean).filter(Boolean).slice(0, 6) : [],
    falsification: Array.isArray(parsed?.falsification) ? parsed.falsification.map(clean).filter(Boolean).slice(0, 6) : [],
    final: {
      judgement: ['是', '偏是', '中性', '偏否', '否'].includes(clean(parsed?.final?.judgement)) ? clean(parsed.final.judgement) : '中性',
      reason: clean(parsed?.final?.reason) || '待补充最终判断原因。',
    },
    missingData: Array.isArray(parsed?.missingData) ? parsed.missingData.map(clean).filter(Boolean).slice(0, 10) : [],
    sources: [
      ...(Array.isArray(parsed?.sources) ? parsed.sources.map((s) => ({
        name: clean(s.name), date: clean(s.date), url: clean(s.url),
      })).filter((s) => s.name) : []),
      ...sourceNotes,
    ],
    asOf,
  };
}

export async function POST(request) {
  const ip = getClientIp(request);
  const rl = rateLimit(`industry-cycle:${ip}`, { limit: 10, windowMs: 60000 });
  if (!rl.ok) return limitResponse(rl.retryAfter);

  try {
    const body = await request.json();
    const free = guardFreeDaily(request, body.aiConfig, { limit: 40 });
    if (!free.ok) return quotaResponse(free.retryAfter);

    const symbolInput = typeof body.symbol === 'string' ? body.symbol.trim() : '';
    const userIndustryData = typeof body.industryData === 'string' ? body.industryData.trim() : '';
    if (!symbolInput) return Response.json({ error: '请输入一只 A 股名称或代码' }, { status: 400 });

    const infos = await resolveSymbols(symbolInput).catch(() => []);
    const info = infos.find((x) => x.market === 'CN') || null;
    if (!info) {
      return Response.json({ error: '未识别到 A 股，请检查股票名称或 6 位代码（当前模块仅支持 A 股）' }, { status: 400 });
    }

    const [quote, fin] = await Promise.all([
      getQuote(info).catch(() => null),
      getFinancials(info).catch(() => null),
    ]);
    if (!quote?.price) {
      return Response.json({ error: '暂时没有获取到该股票的最新行情，请稍后重试' }, { status: 502 });
    }
    const deep = await getDeepAnalysis(info, quote, fin).catch(() => null);
    const industryName = quote.industry || deep?.industry?.emIndustry || '';
    const board = await getIndustryBoard(industryName).catch(() => null);
    const stockName = quote.name || info.name || symbolInput;
    const asOf = new Date().toISOString();
    const dataSection = buildDataSection({ info, quote, fin, deep, board });
    const prompt = buildIndustryCyclePrompt({ stockName, symbol: info.symbol, dataSection, userIndustryData });
    const { raw, parsed } = await generateJson(
      buildMessages(prompt, `请判断 ${stockName}（${info.symbol}）所在行业的周期位置，并完成公司周期与股票位置的三重判断。`),
      '严格按提示词中的 JSON 结构输出',
      5600,
      false,
      body.aiConfig,
    );

    if (!parsed || typeof parsed !== 'object') {
      return Response.json({
        ok: true,
        result: {
          fallback: true,
          content: String(raw || '').replace(/^```(?:json|markdown)?\s*/i, '').replace(/```\s*$/, '').trim(),
          stockName,
          stock: { symbol: info.symbol, name: stockName, industry: industryName },
          dataCard: dataSection,
        },
      });
    }

    const computed = computeCycleTotal(parsed.dashboard);
    const sourceNotes = [
      { name: '东方财富行情与财务指标', date: todayCN(), url: '' },
      board?.available ? { name: `东方财富行业指数（${board.name || industryName}）`, date: board.date || todayCN(), url: '' } : null,
      userIndustryData ? { name: '用户补充行业数据', date: '以用户填写为准', url: '' } : null,
    ].filter(Boolean);
    const analysis = normalizeResult(parsed, computed, sourceNotes, asOf);
    return Response.json({
      ok: true,
      result: {
        stockName,
        stock: { symbol: info.symbol, name: stockName, industry: industryName, market: 'CN' },
        quote: {
          price: quote.price,
          changePct: quote.changePct,
          pe: quote.pe,
          pb: quote.pb,
          marketCap: quote.marketCap,
        },
        industryBoard: board || null,
        analysis,
        dataCard: dataSection,
      },
    });
  } catch (e) {
    const isNet = e && (e.name === 'TypeError' || /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT|abort/i.test(String(e.message)));
    return Response.json(
      { error: isNet ? '连接数据或 AI 服务失败（网络异常），请稍后重试' : (e.message || '服务器内部错误') },
      { status: 500 },
    );
  }
}
