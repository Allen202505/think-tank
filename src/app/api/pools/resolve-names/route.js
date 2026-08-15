// src/app/api/pools/resolve-names —— 把股票名称列表解析成 6 位代码
// POST { names: ["齐翔腾达", "安 纳 达", ...] } → { ok, result: { found: [{code,name}], missing: [names] } }
import { fetchACodeName } from '../../chat/marketData.js';

const EM_SUGGEST = 'https://searchapi.eastmoney.com/api/suggest/get';
const EM_TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MARKET_BY_CLASS = { AStock: 'CN' };

// 名称归一化（强规则）：去掉一切空白与不可见字符、代码括号、新股/除权/特殊标记前后缀，保留 ST/*ST。
// 覆盖：半角/全角空格、制表符、NBSP、零宽字符、BOM、N/C/XD/XR/DR/S 前缀、-U/-W 后缀、名称(代码) 写法。
function normalizeName(n) {
  let s = String(n || '')
    .replace(/[\s\u3000\u00a0\u200b-\u200f\u2028\u2029\u2060\ufeff\u00ad]+/g, '')
    .trim();
  const isST = /^(\*?ST)/i.test(s);
  // 新股/除权等前缀（后跟中文或字母才剥离，避免误伤）
  s = s.replace(/^(N|C|XD|XR|DR)(?=[\u4e00-\u9fa5A-Z])/i, '');
  if (!isST) s = s.replace(/^S(?=[\u4e00-\u9fa5])/, '');
  // 科创板未盈利 -U / 同股不同权 -W 后缀
  s = s.replace(/-(U|W)$/i, '');
  return s.trim();
}

// 把用户粘贴的原始文本拆成「名称/代码」条目：
// - 按换行/逗号/顿号/分号分行
// - 一行内全是 6 位代码 → 拆成多个代码
// - 一行内多个 ≥2 字名称 → 各自成条目（如「齐翔腾达 振华新材」）
// - 其余（含单字碎片，如「安 纳 达」）→ 去空格合并成一个名称
function splitInput(text) {
  const out = [];
  for (const rawLine of String(text || '').split(/[\n,，、;；]+/)) {
    // 括号换成空格：齐翔腾达(002408) → 齐翔腾达 002408，代码可被单独提取
    const line = String(rawLine || '').replace(/[()（）]/g, ' ');
    const parts = line.split(/\s+/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) continue;
    if (parts.every((p) => /^\d{6}$/.test(p))) { out.push(...parts); continue; }
    if (parts.length > 1 && parts.every((p) => p.length >= 2)) { out.push(...parts); continue; }
    out.push(parts.join(''));
  }
  return out;
}

async function suggestName(keyword) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const url = `${EM_SUGGEST}?input=${encodeURIComponent(keyword)}&type=14&token=${EM_TOKEN}&count=10`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' }, signal: ctrl.signal });
    if (!res.ok) return [];
    const json = await res.json();
    const rows = json?.QuotationCodeTable?.Data || [];
    return rows
      .filter((r) => r.QuoteID && r.Code && (r.Classify === 'AStock' || r.Classify === '23' || /^[01]\.\d{6}$/.test(String(r.QuoteID))))
      .map((r) => ({ code: String(r.Code), name: String(r.Name || '').trim(), classify: r.Classify }));
  } catch (e) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// 精确优先，其次唯一包含匹配（含 2 字短名；结果不唯一时宁可不配，避免误配）
function pickMatch(rows, normalized) {
  if (!rows.length) return null;
  const exact = rows.find((r) => r.name === normalized);
  if (exact) return exact;
  const contains = rows.filter((r) => r.name.includes(normalized) || normalized.includes(r.name));
  if (contains.length === 1) return contains[0];
  if (contains.length > 1) return contains.find((r) => r.name === normalized) || null;
  return null;
}

// 并发限制跑名称解析
async function resolveWithLimit(names, limit = 10) {
  const out = [];
  let i = 0;
  const worker = async () => {
    while (i < names.length) {
      const idx = i++;
      const raw = names[idx];
      const norm = normalizeName(raw);
      if (!norm) continue;
      if (/^\d{6}$/.test(norm)) {
        const nm = await fetchACodeName(norm);
        out.push({ input: raw, found: { code: norm, name: nm || '' } });
        continue;
      }
      const rows = await suggestName(norm);
      const hit = pickMatch(rows, norm);
      out.push({ input: raw, found: hit ? { code: hit.code, name: hit.name } : null });
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, names.length) }, worker));
  return out;
}

export async function POST(request) {
  try {
    const body = await request.json();
    // 兼容两种入参：{ names: [...] }（已拆好）或 { text: "原始粘贴文本" }（后端智能拆分）
    const rawNames = Array.isArray(body.names)
      ? body.names.map((n) => String(n).trim()).filter(Boolean)
      : splitInput(body.text);
    if (!rawNames.length) return Response.json({ error: '请提供要解析的股票名称' }, { status: 400 });

    const results = await resolveWithLimit(rawNames);
    const seen = new Set();
    const found = [];
    const missing = [];
    for (const r of results) {
      if (r.found) {
        if (!seen.has(r.found.code)) {
          seen.add(r.found.code);
          found.push(r.found);
        }
      } else {
        missing.push(r.input);
      }
    }
    return Response.json({ ok: true, result: { found, missing } });
  } catch (e) {
    return Response.json({ error: e.message || '名称解析失败，请稍后重试' }, { status: 500 });
  }
}
