// src/app/api/zen/route.js
// 缠中说禅 · 看短线：用缠论方法对单只股票做短线分析评估
// POST { query: '股票名称或代码' }
import { extractJson, generateJson, extractContentFromRaw } from '../../../lib/ai';
import { SYSTEM_GUARD } from '../../../lib/security';
import { getClientIp, rateLimit, limitResponse, guardFreeDaily, quotaResponse } from '../../../lib/rateLimit';
import { masterProfileLine } from '../../../lib/prompts';
import { resolveSymbols, getQuote, getMarketOverview } from '../chat/marketData.js';
import { getKline } from '../chat/uziSkills.js';
import { buildChanContextLines } from './chanContext.js';

// 「缠中说禅」大师画像（缠论禅师；能力域复用 chan_czsc）
const ZEN_MASTER = {
  id: 'zen',
  name: '缠中说禅',
  title: '缠论缠师',
  emoji: '☯️',
  color: '#33415c',
  tag: '技术趋势',
  status: 'deceased',
  style: '缠论：分型/笔/线段/中枢/背驰，多级别联立，三类买卖点',
  personality: '只按缠论体系解读走势，强调"先结构、后结论"，给出明确的级别与买卖点依据。说话像缠师点化，短句、留白、不轻易给结论。',
  quote: '走势终将完美，结构说明一切。',
  biography: '以"缠中说禅"之姿，融合缠中说禅的走势结构理论：走势必完美，任何走势终将完成；买点买、卖点卖，结构之外无多言。',
  classicTheory: '分型与笔、线段与特征序列、中枢理论、背驰判断、多级别联立、三类买卖点（一二三买/卖）',
  capability: 'chan_czsc',
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// 腾讯行情（qt.gtimg.cn，国内稳定）：secid "0.300750"→sz300750 / "1.600519"→sh600519
async function fetchTencentQuote(secid) {
  const [market, code] = String(secid || '').split('.');
  if (!code || !/^\d{6}$/.test(code)) return null;
  const prefix = market === '1' ? 'sh' : 'sz';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://qt.gtimg.cn/q=${prefix}${code}`, {
      headers: { 'User-Agent': UA, Referer: 'https://gu.qq.com/' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    const m = text.match(/"([^"]+)"/);
    if (!m) return null;
    const f = m[1].split('~');
    return {
      price: f[3], prevClose: f[4], open: f[5], volume: f[6],
      change: f[31], changePct: f[32], high: f[33], low: f[34],
      amountWan: f[37], turnoverPct: f[38], pe: f[39], totalMvYi: f[45],
    };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 腾讯大盘指数（上证/深成/创业板）
async function fetchTencentMarket() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch('https://qt.gtimg.cn/q=sh000001,sz399001,sz399006', {
      headers: { 'User-Agent': UA, Referer: 'https://gu.qq.com/' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = [];
    const re = /"([^"]+)"/g;
    let m;
    while ((m = re.exec(text))) {
      const f = m[1].split('~');
      if (f[2]) lines.push(`${f[2]} ${f[3]} (${f[32]}%)`);
    }
    return lines.length ? lines.join(' | ') : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 行情 → 可读文本（东财/腾讯/Yahoo 字段兼容；缺失字段显示 —，不把 undefined 喂给模型）
function fmtNum(v, digits = 2) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : null;
}
// 成交额 → 亿元：腾讯 amountWan 单位万元，东财 amount 单位元
function amountYi(q) {
  if (q.amountWan != null) return Number(q.amountWan) / 10000;
  if (q.amount != null) return Number(q.amount) / 1e8;
  return null;
}
function quoteLine(q) {
  if (!q || (q.price == null && q.f2 == null)) return '（行情获取失败）';
  const parts = [];
  const price = q.price != null ? q.price : q.f2;
  if (price != null) parts.push(`最新价 ${fmtNum(price) ?? '—'}`);
  const pct = q.changePct != null ? q.changePct : q.f3;
  if (pct != null) parts.push(`涨跌幅 ${fmtNum(pct) ?? '—'}%`);
  if (q.open != null || q.f17 != null) parts.push(`今开 ${fmtNum(q.open ?? q.f17) ?? '—'}`);
  if (q.prevClose != null || q.f18 != null) parts.push(`昨收 ${fmtNum(q.prevClose ?? q.f18) ?? '—'}`);
  if (q.high != null || q.f15 != null) parts.push(`最高 ${fmtNum(q.high ?? q.f15) ?? '—'}`);
  if (q.low != null || q.f16 != null) parts.push(`最低 ${fmtNum(q.low ?? q.f16) ?? '—'}`);
  const vol = q.volume != null ? q.volume : q.f5;
  if (vol != null && Number.isFinite(Number(vol))) parts.push(`成交量 ${Number(vol).toLocaleString()}手`);
  const amount = amountYi(q);
  if (amount != null && Number.isFinite(amount)) parts.push(`成交额 ${amount.toFixed(2)}亿`);
  if (q.turnoverPct != null) parts.push(`换手率 ${fmtNum(q.turnoverPct) ?? '—'}%`);
  if (q.pe != null) parts.push(`PE ${fmtNum(q.pe) ?? '—'}`);
  const mvYi = q.totalMvYi != null ? Number(q.totalMvYi) : (q.marketCap != null ? Number(q.marketCap) / 1e8 : null);
  if (mvYi != null && Number.isFinite(mvYi)) parts.push(`总市值 ${mvYi.toFixed(0)}亿`);
  return parts.length ? parts.join(' | ') : '（行情获取失败）';
}

// 行情双源并行：东财给价格/涨跌幅/PE，腾讯补 开高低/量额/总市值（任一失败不影响另一）
async function loadQuote(info) {
  const [em, tx] = await Promise.all([
    getQuote(info).catch(() => null),
    fetchTencentQuote(info.secid),
  ]);
  if (!em || em.price == null) return tx || em; // 东财失败 → 腾讯
  if (!tx) return em;
  const q = { ...em };
  for (const k of ['open', 'high', 'low', 'volume', 'amountWan', 'totalMvYi', 'turnoverPct']) {
    if (q[k] == null && tx[k] != null) q[k] = tx[k];
  }
  return q;
}

// 模型偶尔把内层 JSON 整体塞进 content 字符串：解包并合并字段
function unwrapNested(parsed) {
  if (!parsed || typeof parsed.content !== 'string') return parsed;
  const c = parsed.content.trim();
  if (!c.startsWith('{')) return parsed;
  const inner = extractJson(c);
  if (!inner || typeof inner.content !== 'string') return parsed;
  return { ...parsed, ...inner, content: inner.content.trim() };
}

export async function POST(request) {
  try {
  const _rl = rateLimit('zen:' + getClientIp(request), { limit: 30, windowMs: 60000 });
  if (!_rl.ok) return limitResponse(_rl.retryAfter);

    const body = await request.json();
    const _gq = guardFreeDaily(request, body.aiConfig, { limit: 40 });
    if (!_gq.ok) return quotaResponse(_gq.retryAfter);
    const query = String(body.query || '').trim();
    if (!query) return Response.json({ error: '请先输入股票名称或代码' }, { status: 400 });

    const symbols = await resolveSymbols(query).catch(() => []);
    const info = (symbols || [])[0];
    if (!info) return Response.json({ error: '未能识别该股票，请尝试输入股票名称或 6 位代码（如 600519）' }, { status: 404 });

    const [quote, market, kline] = await Promise.all([
      loadQuote(info),
      (async () => (await getMarketOverview().catch(() => null)) || (await fetchTencentMarket()))(),
      getKline(info).catch(() => null),
    ]);

    const dataBlock = [
      `【标的】${info.name || info.symbol}（${info.secid}，${info.market}）`,
      `【最新行情】${quoteLine(quote)}`,
      ...buildChanContextLines(quote, kline),
      `【大盘环境】${market || '（获取失败）'}`,
    ].join('\n');

    // ── 追问：想深挖？可以继续问缠师（基于此前分析 + 行情，正面回答） ──
    const followUp = typeof body.followUp === 'string' ? body.followUp.trim() : '';
    if (followUp) {
      const prevContent = typeof body.prevContent === 'string' ? body.prevContent.trim() : '';
      const prompt = `你是「缠中说禅」，一位用缠论点化短线的禅师。用户针对你刚才的短线分析追问，请正面回答。

你的画像：
${masterProfileLine(ZEN_MASTER)}

你刚才的分析：
${prevContent || '（暂无）'}

已知数据：
${dataBlock}

用户的追问：
${followUp}

要求（以发言形式，像缠师点化，先结构后结�论）：
1. 直接回答追问，250-400 字，给信息增量，不重复已说过的内容；用缠论语言但要讲人话，标注「需对照实时K线验证」。
2. content 直接就是回答正文，不要任何前缀、标签或标题。
3. 只输出一个 JSON：{"content":"你的回答"}，不要 Markdown 代码块，所有引号用中文引号「」或“”。`;
      const { raw, parsed } = await generateJson(
        [{ role: 'system', content: SYSTEM_GUARD }, { role: 'system', content: prompt }, { role: 'user', content: `追问：${followUp}` }],
        '{"content":"回答"}',
        1200,
        true,
        body.aiConfig,
      );
      const unwrapped = unwrapNested(parsed);
      const normalized = unwrapped && typeof unwrapped.content === 'string' && unwrapped.content.trim() ? unwrapped : null;
      if (!normalized) {
        if (raw && raw.trim()) return Response.json({ ok: true, result: { name: info.name, content: extractContentFromRaw(raw) || raw.trim() } });
        return Response.json({ error: 'AI 输出格式异常，请重试一次' }, { status: 502 });
      }
      return Response.json({ ok: true, result: { name: info.name || info.symbol, content: normalized.content.trim() } });
    }

    const prompt = `你是「缠中说禅」，一位用缠论点化短线的禅师。用户想让你对一只股票做短线分析评估。

你的画像：
${masterProfileLine(ZEN_MASTER)}

已知数据：
${dataBlock}

要求（以发言形式，像缠师点化，先结构后结论，分段、可加粗）：
1. 开头注明：「以下基于现有数据与缠论框架逻辑推导，实际操作前须对照实时K线验证」。
2. 【结构判断】基于涨跌幅/量能/位置推断：当前大概率处于什么走势结构（上涨/下跌/盘整），可能的笔或中枢位置，是否接近背驰段——用缠论语言但讲人话，注明"待K线确认"。
3. 【关键位】给出短线需要盯的支撑与压力（若数据不足，说明需对照K线确认的具体信号）。
4. 【短线倾向】判断当前属于哪类情况：等待一买/二买/三买机会、仍在下跌途中不可抄底、盘整观望；给一句话倾向，不追高。
5. 【缠语收尾】用一句话收尾（留白、不啰嗦）。
6. 整体 300-500 字，用空行分段，关键结论可用 **加粗**。不要用标题、编号列表。

只输出一个 JSON，不要输出任何其他内容：
{"content":"你的分析发言","followUps":["追问方向1","方向2"]}
注意：所有引号用中文引号「」或“”，禁止英文双引号。`;
    const { raw, parsed } = await generateJson(
      [{ role: 'system', content: SYSTEM_GUARD }, { role: 'system', content: prompt }, { role: 'user', content: `请对 ${info.name || info.symbol} 做缠论短线分析。` }],
      '{"content":"分析","followUps":["追问1"]}',
      1800,
      true,
      body.aiConfig,
    );
    const unwrapped = unwrapNested(parsed);
    const normalized = unwrapped && typeof unwrapped.content === 'string' && unwrapped.content.trim() ? unwrapped : null;
    if (!normalized) {
      if (raw && raw.trim()) return Response.json({ ok: true, result: { name: info.name, content: extractContentFromRaw(raw) || raw.trim(), followUps: [] } });
      return Response.json({ error: 'AI 输出格式异常，请重试一次' }, { status: 502 });
    }
    const followUps = Array.isArray(normalized.followUps)
      ? normalized.followUps.filter((f) => typeof f === 'string' && f.trim()).slice(0, 3)
      : [];
    return Response.json({ ok: true, result: { name: info.name || info.symbol, content: normalized.content.trim(), followUps } });
  } catch (e) {
    const isNet = e && (e.name === 'TypeError' || /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(String(e.message)));
    return Response.json({ error: isNet ? '连接 AI 服务失败（网络异常），请稍后重试' : (e.message || '服务器内部错误') }, { status: 500 });
  }
}
