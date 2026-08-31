// src/app/api/match-masters/route.js
// 智能选角：根据用户问题，从大师名单中挑选最适合回答的 1-5 位（最多 5 位）
// 用 DeepSeek 做语义匹配（风格/能力圈 vs 问题类型）；失败时返回空数组，前端回退随机
import { PRESET_MASTERS } from '../../../data/masters.js';
import { getClientIp, rateLimit, limitResponse } from '../../../lib/rateLimit';
import { resolveLlmUrl, buildProviderHeaders, buildProviderBody } from '../../../lib/llm.js';

const CACHE_TTL_MS = 30 * 60000; // 同一问题 30 分钟缓存

const cache = new Map();

export async function POST(request) {

  const _rl = rateLimit('match-masters:' + getClientIp(request), { limit: 90, windowMs: 60000 });
  if (!_rl.ok) return limitResponse(_rl.retryAfter);
  const body = await request.json().catch(() => ({}));
  const question = String(body?.question || '').trim();
  const requestMasters = Array.isArray(body?.masters) && body.masters.length ? body.masters : null;
  const cfg = {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  };
  if (!cfg.apiKey || !question) return Response.json({ ids: [], fallback: true });

  const cacheKey = question.slice(0, 120);
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Response.json({ ids: hit.ids });

  const pool = requestMasters || PRESET_MASTERS.map((m) => ({ id: m.id, name: m.name, title: m.title, style: m.style }));
  const listText = pool
    .map((m) => `${m.id}|${m.name}（${m.title || '大师'}）风格：${m.style || '—'}${m.tags && m.tags.length ? `；标签：${m.tags.join('/')}` : ''}`)
    .join('\n');

  const prompt = `你是「大师吵股」的选角导演。用户提出一个股票投资问题，请从下面的大师名单里，挑选最适合回答这个问题的 1-5 位大师（最多 5 位，宁缺毋滥，至少有 1 位）。

选人原则：问题类型要与大师的风格/能力圈匹配。
- 短线/打板/情绪/游资/龙头/连板类问题 → 优先短线游资、技术派大师
- 价值/长期/护城河/低估/分红/基本面类 → 优先价值派大师
- 成长/科技/赛道/增长/新经济类 → 优先成长派大师
- 宏观/利率/汇率/美联储/经济周期类 → 优先宏观对冲大师
- 技术面/趋势/均线/K线/突破类 → 优先技术派大师
- 困境/危机/抄底/破产重整类 → 优先困境投资大师
- 债券/利率/固收类 → 优先债券大师
- 量化/模型/数据/回测类 → 优先量化派大师
- 组合/仓位/资产配置/风险管理类 → 优先配置型大师
不要选与问题明显不搭的大师（例如短线问题不要选纯价值长线大师）。

用户问题：${question}

大师名单：
${listText}

只输出一个 JSON，不要任何其他内容：{"ids":["id1","id2","id3"]}`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(resolveLlmUrl(cfg.baseUrl), {
      method: 'POST',
      headers: buildProviderHeaders(cfg),
      body: JSON.stringify(buildProviderBody(cfg, [{ role: 'user', content: prompt }], 200, { temperature: 0.2 })),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return Response.json({ ids: [], fallback: true });
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return Response.json({ ids: [], fallback: true });
    const obj = JSON.parse(m[0]);
    const validIds = new Set(pool.map((p) => p.id));
    const ids = (Array.isArray(obj.ids) ? obj.ids : [])
      .map((x) => String(x).trim())
      .filter((id) => validIds.has(id))
      .slice(0, 5);
    if (!ids.length) return Response.json({ ids: [], fallback: true });
    cache.set(cacheKey, { at: Date.now(), ids });
    return Response.json({ ids });
  } catch (e) {
    return Response.json({ ids: [], fallback: true });
  }
}
