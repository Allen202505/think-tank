// src/app/api/pools/suggest —— 输入大师关键词，检索其公开可查证的 A 股选股池
// POST { query: '巴菲特' } → { ok, result: { name, source, stocks: [{code,name,reason}] } }
// 原则：只返回有公开依据的真实持仓/推荐；搜不到就返回空列表，绝不按风格推断编造。
import { generateJson } from '../../../../lib/ai';
import { getClientIp, rateLimit, limitResponse } from '../../../../lib/rateLimit';
import { PRESET_POOLS } from '../../../../data/masterPools';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// A股代码 → 腾讯前缀（6/68/90→沪，0/3/20→深；北交所 8/4/920 暂不支持校验）
function aPrefix(code) {
  if (/^(60|68|90)/.test(code)) return 'sh';
  if (/^(00|30|20)/.test(code)) return 'sz';
  return '';
}

// 逐只校验 6 位代码是否真实存在，返回 { code: 真实股票名 }
// （腾讯批量接口在连续请求下会截断，逐只单请求稳定）
async function validateCodes(codes) {
  const unique = [...new Set(codes.filter((c) => aPrefix(c)))];
  const entries = await Promise.all(unique.map(async (c) => {
    const p = aPrefix(c);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(`https://qt.gtimg.cn/q=${p}${c}`, {
        headers: { 'User-Agent': UA, Referer: 'https://gu.qq.com/' },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      const text = new TextDecoder('gbk').decode(buf);
      const m = text.match(/v_[a-z]{2}\d{6}="([^"]*)"/);
      if (!m || !m[1]) return null;
      const name = String(m[1].split('~')[1] || '').trim();
      if (!name || /退/.test(name)) return null;
      return [c, name];
    } catch (e) { return null; }
  }));
  const valid = {};
  for (const e of entries) if (e) valid[e[0]] = e[1];
  return valid;
}

// 确定性命中：预置池大师（公开资料整理）直接返回，保证准确稳定。
// 匹配要严格：不能仅因查询里包含大师名就命中（如「巴菲特的小舅子」不是巴菲特）。
function matchPreset(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  return PRESET_POOLS.find((p) => {
    const short = p.name.split('·')[0].trim();
    const exact = q === short || q === p.name;
    const close = q.includes(short) && q.length - short.length <= 3; // 如「沃伦·巴菲特」这类相近叫法
    const labelHit = p.name.includes(q); // 如搜「高瓴」命中「张磊 · 高瓴」
    return exact || close || labelHit;
  }) || null;
}

export async function POST(request) {
  try {
  const _rl = rateLimit('pools-suggest:' + getClientIp(request), { limit: 30, windowMs: 60000 });
  if (!_rl.ok) return limitResponse(_rl.retryAfter);

    const body = await request.json();
    const query = String(body.query || '').trim();
    if (!query) return Response.json({ error: '请输入大师关键词' }, { status: 400 });

    // 预置池大师：直接返回公开资料整理的真实持仓
    const preset = matchPreset(query);
    if (preset) {
      const valid = await validateCodes(preset.symbols);
      const stocks = preset.symbols.map((code) => ({
        code,
        name: valid[code] || '',
        reason: preset.note || '预置池 · 公开资料整理',
      }));
      return Response.json({ ok: true, result: { name: preset.name, source: preset.source, stocks } });
    }

    const prompt = `你是投资研究员，帮用户查找「${query}」这位投资大师/人物公开可查证的 A 股选股池。

要求：
1. 只返回有公开依据的 A 股：公开披露的持仓（13F、上市公司公告、基金/资管季报）、本人访谈或著作中明确点名看好/买入的 A 股。
2. 严禁根据投资风格、行业偏好凭空推测或编造。无法确证某只股票确实是这位大师的持仓/推荐时，一律不要列入。
2b. 如果「${query}」不是一位有公开投资记录的真实投资人物（调侃/虚构/网名且无公开持仓记录等），直接返回空列表：{"name":"","source":"","stocks":[]}。
3. 如果没有查证到任何可靠的 A 股标的，直接返回空列表：{"name":"","source":"","stocks":[]}。不要为了凑数而编造。
4. 每只股票给 6 位代码 + 名称 + 一句「公开依据」（如：XX 年季报重仓 / XX 访谈点名）。
5. 最多返回 10 只。

只输出一个 JSON，不要输出任何其他内容：
{"name":"池子名称","source":"公开资料来源说明","stocks":[{"code":"600519","name":"贵州茅台","reason":"公开依据"}]}
注意：所有引号用中文引号「」或“”，禁止英文双引号；code 必须是 6 位数字。`;
    const { raw, parsed } = await generateJson(
      [{ role: 'system', content: prompt }, { role: 'user', content: `请查证「${query}」的公开 A 股选股池。` }],
      '{"name":"池名","source":"来源","stocks":[{"code":"600519","name":"贵州茅台","reason":"依据"}]}',
      1500,
      false,
    );
    const d = parsed && typeof parsed === 'object' ? parsed : null;
    const name = (d && typeof d.name === 'string' && d.name.trim()) || `${query} · 选股池`;
    const source = (d && typeof d.source === 'string' && d.source.trim()) || '公开资料整理';
    const candidates = (d && Array.isArray(d.stocks) ? d.stocks : [])
      .filter((s) => s && /^\d{6}$/.test(String(s.code || '')))
      .slice(0, 10)
      .map((s) => ({ code: String(s.code), name: String(s.name || '').trim(), reason: String(s.reason || '').trim() }));

    // 用真实行情校验：只保留真实存在的 A 股（顺带修正名称）
    const valid = await validateCodes(candidates.map((s) => s.code));
    const stocks = candidates
      .filter((s) => valid[s.code])
      .map((s) => ({ ...s, name: valid[s.code] || s.name }));

    if (!stocks.length) {
      return Response.json({ ok: true, result: { name: query, source: '', stocks: [] } });
    }
    return Response.json({ ok: true, result: { name, source, stocks } });
  } catch (e) {
    return Response.json({ error: e.message || '服务器内部错误' }, { status: 500 });
  }
}
