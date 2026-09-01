// src/app/api/pools/ratings/route.js
// GET /api/pools/ratings?code=600519
// 机构评级 + 目标价（短期/长期）：东方财富研报中心公开接口（真实数据、无需 Key）
// 只支持 A 股；返回 summary（短/长期最新目标价）+ items（各机构明细）
import { getClientIp, rateLimit, limitResponse } from '../../../../lib/rateLimit';

const REPORT_API = 'https://reportapi.eastmoney.com/report/list';
const CACHE_TTL = 30 * 60 * 1000; // 30 分钟
const cache = new Map(); // code -> { at, payload }

function fmtDay(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function fetchReports(code) {
  const end = new Date();
  const begin = new Date(end.getTime() - 400 * 24 * 3600 * 1000);
  const url = `${REPORT_API}?industryCode=*&pageSize=200&beginTime=${fmtDay(begin)}&endTime=${fmtDay(end)}&pageNo=1&qType=0&code=${encodeURIComponent(code)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
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
    const json = await fetchReports(code);
    const { summary, items } = build(code, json?.data || []);
    const payload = { summary, items };
    cache.set(code, { at: Date.now(), payload });
    return Response.json({ ok: true, ...payload });
  } catch (e) {
    return Response.json({ ok: true, summary: null, items: [], error: e.message });
  }
}
