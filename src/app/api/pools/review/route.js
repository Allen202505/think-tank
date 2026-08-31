// src/app/api/pools/review —— 求大师评价我的票
// POST { symbols: ['603977',...], poolName, aiConfig } → { ok, result: { poolName, masters: [{...master, speech, risk}], summary } }
// 随机邀请几位大师，轮流发言：结合最新市场行情，尽可能夸奖用户的持仓（心理按摩），并略带一句潜在风险。
import { getClientIp, rateLimit, limitResponse, guardFreeDaily, quotaResponse } from '../../../../lib/rateLimit';
import { generateJson } from '../../../../lib/ai';
import { PRESET_MASTERS } from '../../../../data/masters';
import { resolveSymbols, getQuote, getMarketOverview } from '../../chat/marketData';

const MAX_SYMBOLS = 12;     // 最多评价的持仓数
const MASTER_COUNT = 4;     // 随机邀请的大师人数

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickMasters() {
  // 从全部预设大师里均匀随机，不区分中外/流派
  return shuffle(PRESET_MASTERS).slice(0, MASTER_COUNT);
}

function masterLine(m) {
  let line = `ID:${m.id} | ${m.name} | 称号:${m.title} | 风格:${m.style} | 性格:${m.personality} | 金句:"${m.quote}"`;
  if (m.classicTheory) line += ` | 经典理论:${m.classicTheory}`;
  if (m.knowledge) line += ` | 知识域:${m.knowledge}`;
  if (m.coreViews) line += ` | 核心观点:${m.coreViews}`;
  if (m.phrases) line += ` | 常用话术:${m.phrases}`;
  if (m.riskPref) line += ` | 风险偏好:${m.riskPref}`;
  if (m.styleSample) line += ` | 风格示范:${m.styleSample.slice(0, 180)}`;
  return line;
}

// 构建最新市场数据快照：大盘环境 + 每只持仓的行情/估值/行业
async function buildSnapshot(symbols) {
  const lines = [];
  const market = await getMarketOverview().catch(() => '');
  if (market) lines.push(`【大盘环境】\n${market}`);

  const infos = [];
  for (const code of symbols) {
    try {
      const list = await resolveSymbols(String(code));
      if (list && list[0]) infos.push(list[0]);
    } catch (e) { /* 单只失败不影响其它 */ }
  }
  const quotes = await Promise.all(infos.slice(0, MAX_SYMBOLS).map(async (info) => {
    try { return { info, quote: await getQuote(info).catch(() => null) }; }
    catch (e) { return { info, quote: null }; }
  }));

  const stockLines = [];
  for (const { info, quote } of quotes) {
    if (!quote) continue;
    const name = quote.name || info.name || info.symbol;
    const bits = [`${name}（${info.symbol}）`];
    if (quote.price != null) bits.push(`现价 ${quote.price}`);
    if (quote.changePct != null) bits.push(`今日 ${Number(quote.changePct) > 0 ? '+' : ''}${Number(quote.changePct).toFixed(2)}%`);
    if (quote.pe != null) bits.push(`PE(TTM) ${Number(quote.pe).toFixed(1)}`);
    if (quote.pb != null) bits.push(`PB ${Number(quote.pb).toFixed(2)}`);
    if (quote.marketCap != null) bits.push(`市值 ${(Number(quote.marketCap) / 1e8).toFixed(0)}亿`);
    if (quote.industry) bits.push(`行业 ${quote.industry}`);
    stockLines.push(bits.join(' | '));
  }
  if (stockLines.length) lines.push(`【持仓快照】\n${stockLines.join('\n')}`);
  return lines.join('\n\n');
}

export async function POST(request) {
  try {
    const _rl = rateLimit('pools-review:' + getClientIp(request), { limit: 20, windowMs: 60000 });
    if (!_rl.ok) return limitResponse(_rl.retryAfter);

    const body = await request.json();
    const _gq = guardFreeDaily(request, body.aiConfig, { limit: 40 });
    if (!_gq.ok) return quotaResponse(_gq.retryAfter);
    const symbols = [...new Set((Array.isArray(body.symbols) ? body.symbols : []).map((s) => String(s).trim()).filter((s) => /^\d{6}$/.test(s)))].slice(0, MAX_SYMBOLS);
    const poolName = String(body.poolName || '我的股票池').trim() || '我的股票池';
    const aiConfig = body.aiConfig || null;

    if (!symbols.length) return Response.json({ error: '请先选择一个含股票的池子' }, { status: 400 });

    const masters = pickMasters();
    if (!masters.length) return Response.json({ error: '暂无可用大师，请重试' }, { status: 500 });

    const snapshot = await buildSnapshot(symbols).catch(() => '');
    const symbolList = symbols
      .map((code, i) => `${i + 1}. ${code}`)
      .join('\n');
    const masterList = masters.map(masterLine).join('\n');

    const prompt = `你是「大师吵股」的王牌心理按摩团。用户在【我的股票池】持有一批股票，请随机邀请的几位大师轮流发言，给用户做一次「心理按摩」。

【持仓股票池】${poolName}
${symbolList}

【参与大师】
${masterList}

${snapshot ? `【最新市场数据快照】\n${snapshot}\n` : ''}

任务要求（非常重要）：
1. 整体基调：**大力夸奖、肯定用户的持仓**，让用户安心、有信心。像心理按摩一样温暖，先肯定用户的眼光、耐心和持仓逻辑，再顺势夸一夸每只票。
2. **要风趣幽默**：每位大师的发言要鲜活俏皮、接地气，像老朋友唠嗑或相声/脱口秀一样，多用比喻、段子、自嘲和接地气的梗，别端着、别念报表。幽默是点缀，夸奖才是主菜——可以打趣但绝不毒舌、绝不吓人。
3. 务必**结合最新市场行情**：引用快照中的真实数据（大盘环境、个股今日涨跌、估值、行业），让夸奖有据可依；快照里没有的精确数字用「大约/约/可能」等模糊表述，严禁编造或使用记忆中的旧数据。
4. **略带潜在风险**：每位大师最后用一两句委婉点一下潜在风险（如短期波动、估值、行业周期），语气克制、点到为止，不吓人，给用户信心而非焦虑。
5. 每位大师**独立轮流发言**，口吻必须贴合其人物画像（性格、风格、金句、常用话术、风险偏好）。发言之间不要雷同，角度要有差异。
6. 不做具体买卖操作建议，不承诺收益；赞美要真诚、有据，避免空洞。

只输出一个 JSON，不要任何其他内容（不要 Markdown 代码块、不要注释）：
{"masters":[{"masterId":"大师ID","speech":"这位大师风趣幽默地夸奖持仓的发言(150-220字，贴合人设，尽量引用市场数据)","risk":"一句委婉的风险提示(30字内)"}],"summary":"整体收尾的心理按摩总结(60-100字，温暖鼓励，可带点俏皮)"}

注意：所有字符串值里的引号一律用中文引号「」或“”，禁止使用英文双引号，防止破坏 JSON 格式。`;

    const { raw, parsed } = await generateJson(
      [
        { role: 'system', content: prompt },
        { role: 'user', content: `我的持仓：${symbolList}\n请大师们轮流发言，给我做心理按摩。` },
      ],
      '{"masters":[{"masterId":"buffett","speech":"...","risk":"..."}],"summary":"..."}',
      3200,
      false,
      aiConfig,
    );

    const d = parsed && typeof parsed === 'object' ? parsed : null;
    const items = Array.isArray(d?.masters) ? d.masters : [];
    const masterMap = new Map(masters.map((m) => [m.id, m]));
    const usedIds = new Set();
    const reviews = [];
    for (const it of items) {
      const id = String(it?.masterId || '').trim();
      const master = masterMap.get(id);
      if (!master || usedIds.has(id)) continue;
      const speech = String(it?.speech || '').trim();
      const risk = String(it?.risk || '').trim();
      if (!speech) continue;
      usedIds.add(id);
      reviews.push({ ...master, speech, risk });
      if (reviews.length >= masters.length) break;
    }

    // 兜底：若 AI 漏掉某位大师，用一句通用赞美补位，保证每个人都有发言
    for (const m of masters) {
      if (reviews.length >= masters.length) break;
      if (usedIds.has(m.id)) continue;
      reviews.push({
        ...m,
        speech: `看到你持有的这几只票，我心里踏实。选股就是选公司，能拿住就是赢了一半。${snapshot ? '结合最新行情看，整体是很稳的节奏，' : ''}多一点耐心，时间会给出答案。`,
        risk: '注意短期波动，控制好仓位就好。',
      });
    }

    const summary = String(d?.summary || '').trim() ||
      '你的持仓在逻辑上站得住，剩下的交给时间。相信自己的判断，也别忘了给生活留点空间，投资是为了更好的生活。';

    return Response.json({ ok: true, result: { poolName, masters: reviews, summary } });
  } catch (e) {
    return Response.json({ error: e.message || '服务器内部错误' }, { status: 500 });
  }
}
