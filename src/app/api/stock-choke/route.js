// POST { industry, market, focus, aiConfig } → Serenity 供应链瓶颈研究。
// 真实行情用于回填候选标的；供应链结论由 Skill 框架生成，并明确标注待核验数据。
import { SYSTEM_GUARD } from '../../../lib/security';
import { generateJson } from '../../../lib/ai';
import { getClientIp, guardFreeDaily, limitResponse, quotaResponse, rateLimit } from '../../../lib/rateLimit';
import { buildStockChokeMessages, normalizeStockChokeResult } from '../../../lib/stockChoke';
import { getQuote } from '../chat/marketData';

export const runtime = 'nodejs';

const EM_SUGGEST = 'https://searchapi.eastmoney.com/api/suggest/get';
const EM_BOARD_QUOTE = 'https://push2.eastmoney.com/api/qt/stock/get';
const EM_BOARD_KLINE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const EM_TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sectorCache = new Map();

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const round = (value, digits = 2) => {
  const n = num(value);
  return n == null ? null : Math.round(n * 10 ** digits) / 10 ** digits;
};

async function fetchJson(url, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://quote.eastmoney.com/',
      },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function calcReturn(rows, days) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const latest = rows[rows.length - 1];
  const base = rows[Math.max(0, rows.length - 1 - days)];
  if (!latest?.close || !base?.close) return null;
  return round((latest.close / base.close - 1) * 100, 2);
}

async function searchSectorBoard(keyword) {
  const url = `${EM_SUGGEST}?input=${encodeURIComponent(keyword)}&type=14&token=${EM_TOKEN}&count=10`;
  const json = await fetchJson(url, 7000);
  const rows = (json?.QuotationCodeTable?.Data || []).filter((row) => /BK\d+/.test(String(row?.QuoteID || row?.Code || '')));
  if (!rows.length) return null;
  const exact = rows.find((row) => String(row.Name || '').trim() === String(keyword).trim());
  const picked = exact || rows[0];
  const match = String(picked.QuoteID || picked.Code || '').match(/BK\d+/);
  return match ? { code: match[0], name: picked.Name || keyword } : null;
}

function sectorSearchTerms(keyword) {
  const key = String(keyword || '').trim();
  const terms = [key];
  const compact = key.replace(/\s+/g, '');
  if (compact && compact !== key) terms.push(compact);
  if (/CPO/i.test(key) || /光模块/.test(key)) terms.push('光通信模块', '光通信');
  if (/AI.*算力|算力链/i.test(key)) terms.push('算力概念', '通信设备');
  if (/电力|电网/.test(key)) terms.push('电网设备', '电力行业');
  if (/军工|国防/.test(key)) terms.push('国防军工');
  if (/新能源车|电动车/.test(key)) terms.push('汽车零部件');
  if (/半导体设备/.test(key)) terms.push('半导体');
  if (/创新药/.test(key)) terms.push('生物制品');
  const pieces = key.split(/[\/|、,，+]+/).map((item) => item.trim()).filter((item) => item.length >= 2);
  return Array.from(new Set([...terms, ...pieces]));
}

async function getSectorSnapshot(keyword) {
  const key = String(keyword || '').trim();
  if (!key) return null;
  const cached = sectorCache.get(key);
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) return cached.value;

  const value = await (async () => {
    let board = null;
    for (const term of sectorSearchTerms(key)) {
      board = await searchSectorBoard(term).catch(() => null);
      if (board?.code) break;
    }
    if (!board?.code) return { available: false, query: key, reason: '未匹配到东方财富行业/概念板块' };
    const secid = `90.${board.code}`;
    const [quoteJson, klineJson] = await Promise.all([
      fetchJson(`${EM_BOARD_QUOTE}?secid=${encodeURIComponent(secid)}&fields=f43,f57,f58,f59,f170&fltt=2`, 8000).catch(() => null),
      fetchJson(`${EM_BOARD_KLINE}?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53&klt=101&fqt=1&end=20500101&lmt=90`, 10000).catch(() => null),
    ]);
    const quote = quoteJson?.data || null;
    const scale = 10 ** (quote?.f59 ?? 2);
    const rows = (klineJson?.data?.klines || [])
      .map((line) => {
        const [date, close] = String(line).split(',');
        return { date, close: num(close) };
      })
      .filter((row) => row.date && row.close != null);
    const latest = rows[rows.length - 1] || null;
    return {
      available: !!(quote || latest),
      query: key,
      name: quote?.f58 || board.name || key,
      code: board.code,
      price: quote?.f43 != null ? quote.f43 / scale : (latest?.close ?? null),
      changePct: num(quote?.f170) ?? calcReturn(rows, 1),
      date: latest?.date || null,
      returns: {
        d5: calcReturn(rows, 5),
        d20: calcReturn(rows, 20),
      },
      source: '东方财富行业板块公开行情',
    };
  })().catch((error) => ({ available: false, query: key, reason: error?.message || '板块行情暂不可得' }));

  sectorCache.set(key, { at: Date.now(), value });
  return value;
}

function marketFromClassify(classify, code) {
  if (classify === 'AStock' || /^\d{6}$/.test(code)) return 'CN';
  if (classify === 'HK') return 'HK';
  if (classify === 'UsStock') return 'US';
  return '';
}

async function resolveCandidateTarget(candidate) {
  const symbol = String(candidate?.symbol || '').trim();
  const name = String(candidate?.name || '').trim();
  const keyword = symbol && symbol !== '待核实' ? symbol : name;
  if (!keyword) return null;
  const url = `${EM_SUGGEST}?input=${encodeURIComponent(keyword)}&type=14&token=${EM_TOKEN}&count=12`;
  const json = await fetchJson(url, 7000);
  const rows = (json?.QuotationCodeTable?.Data || []).filter((row) => row?.QuoteID && row?.Code && !/^BK\d+/.test(String(row.Code)));
  if (!rows.length) return null;
  const normalizedSymbol = symbol.replace(/\s+/g, '').toUpperCase();
  const exact = rows.find((row) => String(row.Code || '').toUpperCase() === normalizedSymbol);
  const picked = exact || rows[0];
  const code = String(picked.Code || '');
  const market = marketFromClassify(picked.Classify, code);
  if (!market) return null;
  return {
    symbol: code,
    market,
    secid: String(picked.QuoteID),
    name: picked.Name || name || code,
  };
}

async function enrichCandidates(candidates) {
  await Promise.all((Array.isArray(candidates) ? candidates : []).map(async (candidate) => {
    try {
      const target = await resolveCandidateTarget(candidate);
      if (!target) {
        candidate.quote = null;
        candidate.dataStatus = '行情未回填，需手动核查';
        return;
      }
      const quote = await getQuote(target);
      if (!quote) {
        candidate.quote = null;
        candidate.dataStatus = '行情接口暂不可得';
        return;
      }
      candidate.name = quote.name || target.name || candidate.name;
      candidate.symbol = target.symbol;
      candidate.market = target.market === 'CN' ? 'A股' : target.market === 'HK' ? '港股' : target.market === 'US' ? '美股' : candidate.market;
      candidate.quote = {
        price: quote.price ?? null,
        changePct: quote.changePct ?? null,
        pe: quote.pe ?? null,
        pb: quote.pb ?? null,
        marketCap: quote.marketCap ?? null,
        floatMarketCap: quote.floatMarketCap ?? null,
        turnoverRate: quote.turnoverRate ?? null,
        currency: quote.currency || null,
        industry: quote.industry || null,
        isPreviousClose: !!quote.isPreviousClose,
        asOf: new Date().toISOString(),
      };
      candidate.dataStatus = '行情已回填；供应链证据仍需核验';
    } catch (error) {
      candidate.quote = null;
      candidate.dataStatus = '行情未回填，需手动核查';
    }
  }));
}

export async function POST(request) {
  const ip = getClientIp(request);
  const limited = rateLimit(`stock-choke:${ip}`, { limit: 8, windowMs: 60 * 1000 });
  if (!limited.ok) return limitResponse(limited.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return Response.json({ error: '请求格式错误' }, { status: 400 });
  }

  const industry = String(body.industry || '').trim().slice(0, 40);
  const focus = String(body.focus || '').trim().slice(0, 300);
  const allowedMarkets = new Set(['auto', 'CN', 'HK', 'US', 'global']);
  const market = allowedMarkets.has(body.market) ? body.market : 'auto';
  if (industry.length < 2) return Response.json({ error: '请输入至少 2 个字的产业链或板块名称' }, { status: 400 });

  const quota = guardFreeDaily(request, body.aiConfig, { limit: 20 });
  if (!quota.ok) return quotaResponse(quota.retryAfter);

  try {
    const sectorSnapshot = market === 'CN' || market === 'auto'
      ? await getSectorSnapshot(industry)
      : null;
    const messages = buildStockChokeMessages({ industry, market, focus, sectorSnapshot });
    messages.unshift({ role: 'system', content: SYSTEM_GUARD });
    const { parsed } = await generateJson(
      messages,
      '符合系统消息中定义的供应链瓶颈 JSON Schema',
      5200,
      false,
      body.aiConfig,
    );
    if (!parsed || typeof parsed !== 'object') throw new Error('模型未返回有效报告');

    const result = normalizeStockChokeResult(parsed);
    await enrichCandidates(result.candidates);
    return Response.json({
      ok: true,
      result,
      meta: {
        generatedAt: new Date().toISOString(),
        market,
        sectorSnapshot: sectorSnapshot || null,
        skill: {
          id: 'serenity-stock-choke',
          version: '3.2.1',
          source: 'https://github.com/fadewalk/serenity-stock-choke',
        },
        dataNote: '板块行情与候选行情来自东方财富公开接口；供应链结论属于框架推演，必须继续核验订单、产能、公告与政策证据。',
      },
    });
  } catch (error) {
    const message = String(error?.message || '分析失败，请稍后重试');
    const status = /timeout|超时|abort/i.test(message) ? 504 : 502;
    return Response.json({ error: message }, { status });
  }
}
