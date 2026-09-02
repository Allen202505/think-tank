// src/app/api/pools/ratings/route.js
// GET /api/pools/ratings?code=600519
// 机构评级 + 目标价（短期/长期）
//
// 双数据源（东财公开接口，无需 Key）：
//   1. 研报中心 report/list：取「目标价」（indvAimPriceT / indvAimPriceL）
//      —— 缺点：覆盖面窄。研报里只有少数分析师会明确写目标价，
//         且此接口对部分股票（如 000928）索引为空。
//   2. F10 盈利预测 ProfitForecast：取「机构评级统计 + 一致预期 EPS」
//      —— 覆盖面广很多，几乎所有被机构关注的股票都有。
//
// 前端用 summary.rating / summary.eps 做兜底展示，
// 避免大量股票因为「研报没写目标价」而整列空白。
import { getClientIp, rateLimit, limitResponse } from '../../../../lib/rateLimit';

const REPORT_API = 'https://reportapi.eastmoney.com/report/list';
const F10_API = 'https://emweb.securities.eastmoney.com/PC_HSF10/ProfitForecast/PageAjax';
const CACHE_TTL = 30 * 60 * 1000; // 30 分钟
const cache = new Map(); // code -> { at, payload }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function fmtDay(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// 6 开头 = 沪市 SH，其余（0/3）= 深市 SZ
function secid(code) {
  return /^6/.test(code) ? `SH${code}` : `SZ${code}`;
}

async function fetchJson(url, referer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Referer: referer },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// 数据源 1：研报中心 → 目标价
async function fetchReports(code) {
  const end = new Date();
  const begin = new Date(end.getTime() - 400 * 24 * 3600 * 1000);
  const url = `${REPORT_API}?industryCode=*&pageSize=100&beginTime=${fmtDay(begin)}&endTime=${fmtDay(end)}&pageNo=1&qType=0&code=${encodeURIComponent(code)}`;
  const json = await fetchJson(url, 'https://quote.eastmoney.com/');
  return json?.data || [];
}

// 数据源 2：F10 盈利预测 → 机构评级统计 + 一致预期 EPS
async function fetchF10Rating(code) {
  const url = `${F10_API}?code=${secid(code)}`;
  const json = await fetchJson(url, 'https://emweb.securities.eastmoney.com/');
  const rating = {};

  // 评级统计：优先取「1年内」窗口
  const pjtj = json?.pjtj || [];
  const yr = pjtj.find((r) => r.DATE_TYPE === '1年内') || pjtj[pjtj.length - 1];
  if (yr) {
    rating.rating = yr.COMPRE_RATING || '';
    rating.ratingNum = toNum(yr.COMPRE_RATING_NUM);
    rating.orgNum = toNum(yr.RATING_ORG_NUM);
    rating.buyNum = toNum(yr.RATING_BUY_NUM);
    rating.addNum = toNum(yr.RATING_ADD_NUM);
    rating.neutralNum = toNum(yr.RATING_NEUTRAL_NUM);
    rating.reduceNum = toNum(yr.RATING_REDUCE_NUM);
    rating.saleNum = toNum(yr.RATING_SALE_NUM);
  }

  // 一致预期 EPS：近六月平均（EPS2 = 次年预测）
  const jgyc = json?.jgyc || [];
  const avg = jgyc.find((r) => String(r.ORG_NAME_ABBR || '').includes('平均')) || jgyc[0];
  if (avg) {
    rating.epsYear = avg.YEAR2 || null;
    rating.eps = toNum(avg.EPS2);
    rating.epsYear2 = avg.YEAR3 || null;
    rating.eps2 = toNum(avg.EPS3);
  }

  return Object.keys(rating).length ? rating : null;
}

function build(code, list) {
  const items = (list || [])
    .filter((it) => String(it.stockCode || '') === code && (toNum(it.indvAimPriceT) || toNum(it.indvAimPriceL)))
    .map((it) => ({
      org: it.orgSName || it.orgName || '—',
      rating: it.emRatingName || '',
      short: toNum(it.indvAimPriceT),
      long: toNum(it.indvAimPriceL),
      date: String(it.publishDate || '').slice(0, 10),
      title: it.title || '',
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  // 汇总：短期/长期各取「最新一条有值的」
  const summary = {};
  for (const it of items) {
    if (!summary.short && it.short) summary.short = { price: it.short, org: it.org, date: it.date };
    if (!summary.long && it.long) summary.long = { price: it.long, org: it.org, date: it.date };
    if (summary.short && summary.long) break;
  }
  return { summary, items };
}

async function safe(fn, fallback) {
  try {
    return await fn();
  } catch (e) {
    return fallback;
  }
}

export async function GET(request) {
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '').trim();
  // 仅支持 A 股 6 位代码（美股/港股暂无目标价数据源）
  if (!/^\d{6}$/.test(code) || !/^(0|3|6)/.test(code)) {
    return Response.json({ ok: true, summary: null, items: [], reason: 'unsupported' });
  }

  const _rl = rateLimit('ratings:' + getClientIp(request), { limit: 120, windowMs: 60000 });
  if (!_rl.ok) return limitResponse(_rl.retryAfter);

  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return Response.json({ ok: true, ...hit.payload });
  }

  try {
    const [reportRows, rating] = await Promise.all([
      safe(() => fetchReports(code), []),
      safe(() => fetchF10Rating(code), null),
    ]);
    const { summary, items } = build(code, reportRows);
    if (rating) summary.rating = rating;
    const payload = { summary, items };
    cache.set(code, { at: Date.now(), payload });
    return Response.json({ ok: true, ...payload });
  } catch (e) {
    return Response.json({ ok: true, summary: null, items: [], error: e.message });
  }
}
