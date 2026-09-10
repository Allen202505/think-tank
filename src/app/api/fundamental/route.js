// src/app/api/fundamental/route.js
// 鱼大基础面研究
// POST { mode:'research', symbol, note, aiConfig }
//   → 第 1 步：五位大师（鱼大 / 段永平 / 巴菲特 / 芒格 / 李录）联合深度研究
//   → 第 2 步：鱼大基于研究结论，按「选股10条」打分
// POST { mode:'followup', question, context, stockName, aiConfig } → 举手提问追加回答
import { SYSTEM_GUARD } from '../../../lib/security';
import { getClientIp, rateLimit, limitResponse, guardFreeDaily, quotaResponse } from '../../../lib/rateLimit';
import { generateJson, extractContentFromRaw, callDeepSeek } from '../../../lib/ai';
import { masterProfileLine } from '../../../lib/prompts';
import { findMasterById } from '../../../lib/breakfast';
import { resolveSymbols, getQuote, getFinancials } from '../chat/marketData';
import { getDeepAnalysis } from '../chat/uziSkills';
import { getQuoteContextInfo } from '../chat/quoteContext';
import { FUNDAMENTAL_CRITERIA, FUNDAMENTAL_MASTERS, scoreTo100, totalBand, rubricText } from '../../../lib/fundamental';

function buildMessages(prompt, userAsk) {
  return [{ role: 'system', content: SYSTEM_GUARD }, { role: 'system', content: prompt }, { role: 'user', content: userAsk }];
}

// 把快照里给 AI 看的指令行剥掉，只保留可展示的数据（用于「系统数据核验」折叠卡）
function cleanSnapshot(snapshot) {
  const lines = String(snapshot || '').split('\n');
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { out.push(''); continue; }
    if (/^-/.test(line)) continue; // AI 指令行
    if (line.includes('【深度分析使用规则】')) continue; // 尾部指令
    out.push(line);
  }
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join('\n').trim();
}

// 把结构化数据整理成前端可画的图表数据（不经过 AI，避免编造）
function buildCharts(info, quote, deep) {
  const out = {};
  const ann = (deep?.finHistory || [])
    .filter((r) => r.reportName && /年报|年度/.test(r.reportName))
    .sort((a, b) => String(a.reportDate).localeCompare(String(b.reportDate)))
    .slice(-5);
  if (ann.length) {
    out.financials = ann.map((r) => ({
      label: (r.reportDate || '').slice(0, 4),
      revenue: r.revenue != null ? +(r.revenue / 1e8).toFixed(2) : null,
      netProfit: r.netProfit != null ? +(r.netProfit / 1e8).toFixed(2) : null,
      grossMargin: r.grossMargin != null ? +Number(r.grossMargin).toFixed(2) : null,
      roe: r.roe != null ? +Number(r.roe).toFixed(2) : null,
    }));
  }
  const pv = deep?.positionVolume;
  if (pv && pv.low10y != null && pv.high10y != null && quote?.price != null) {
    out.position = {
      price: quote.price, low10y: pv.low10y, high10y: pv.high10y,
      pos10y: pv.pos10y, pos5y: pv.pos5y, pos3y: pv.pos3y,
      low5y: pv.low5y, high5y: pv.high5y, low3y: pv.low3y, high3y: pv.high3y,
      box3yWidthPct: pv.box3yWidthPct, monthsInLowerThird: pv.monthsInLowerThird,
    };
  }
  const val = deep?.valuation;
  if (val && (val.pePercentile != null || val.pbPercentile != null)) {
    out.valuation = {
      pe: quote?.pe ?? null, pb: quote?.pb ?? null,
      pePercentile: val.pePercentile ?? null, pbPercentile: val.pbPercentile ?? null,
      peBand: val.peBand || null, pbBand: val.pbBand || null,
    };
  }
  // 主营构成（分产品 / 分地区）
  const mb = deep?.mainBusiness;
  if (mb && (Array.isArray(mb.byProduct) ? mb.byProduct.length : false)) {
    out.mainBusiness = {
      reportDate: mb.reportDate || null,
      byProduct: (mb.byProduct || []).slice(0, 5).map((r) => ({ name: r.name, ratioPct: r.ratioPct, grossPct: r.grossPct })),
      byRegion: (mb.byRegion || []).map((r) => ({ name: r.name, ratioPct: r.ratioPct })),
      top3ProductRatioPct: mb.top3ProductRatioPct ?? null,
      overseasRatioPct: mb.overseasRatioPct ?? null,
    };
  }
  // 订单 vs 营收
  const os = deep?.orderInfo?.summary;
  const latestFin = (deep?.finHistory || [])[0];
  if (os && (os.backlogYi != null || os.newYi != null || os.h1NewYi != null)) {
    out.orders = {
      reportDate: os.reportDate,
      backlogYi: os.backlogYi, backlogCount: os.backlogCount,
      newYi: os.newYi, newCount: os.newCount,
      h1NewYi: os.h1NewYi,
      revenueYi: latestFin && latestFin.revenue != null ? +(latestFin.revenue / 1e8).toFixed(2) : null,
      revenueLabel: latestFin ? (latestFin.reportName || (latestFin.reportDate || '').slice(0, 10)) : null,
    };
  }
  // 现金转化率序列
  const cc = (deep?.finHistory || []).filter((r) => r.ncoNetProfit != null).slice(0, 6)
    .map((r) => ({ label: (r.reportDate || '').slice(0, 7), value: +Number(r.ncoNetProfit).toFixed(2) }))
    .reverse();
  if (cc.length) out.cashConversion = cc;
  // 股东户数序列（筹码集中度）
  if (deep?.holderStructure?.holderSeries) out.holders = deep.holderStructure.holderSeries;
  const b = deep?.balanceItems;
  if (b) {
    out.balance = {
      cashYi: b.cashYi ?? null, interestDebtYi: b.interestDebtYi ?? null, netCashYi: b.netCashYi ?? null,
      receivablesYi: b.receivablesYi ?? null, inventoryYi: b.inventoryYi ?? null, payablesYi: b.payablesYi ?? null,
      receivablesYoyPct: b.receivablesYoyPct ?? null, inventoryYoyPct: b.inventoryYoyPct ?? null,
      goodwillYi: b.goodwillYi ?? null,
    };
  }
  return Object.keys(out).length ? out : null;
}

const SCORE_SCHEMA = '{"scores":[{"score":8.5,"reason":"评分理由"}],"strongest":"最强项","weakest":"最弱项","coreConflict":"核心矛盾","buyPrice":"推荐买入价","heavyPrice":"推荐重仓价","sellPrice":"预计卖出价","upside":"盈利空间","followUps":["完整问句1？","完整问句2？","完整问句3？"]}';

// ── 五位大师联合研究框架（移植并适配自 xbtlin/ai-berkshire 的四大师投研框架，加入鱼大的周期/生产资料视角）──
function buildResearchPrompt(snapshot, masters) {
  const roster = FUNDAMENTAL_MASTERS.map((m) => `- ${m.name}（${m.role}）：${m.focus}`).join('\n');
  const lines = masters.filter(Boolean).map((m) => masterProfileLine(m)).join('\n');
  return `你是「五位大师基础面研究小组」的联合研究员。这个小组由 5 位成员组成，各负责一个视角，最终由主理人寒武纪的鳄鱼（鱼大）汇总：

【小组成员与分工】
${roster}

【五位的画像（严格按各自的方法论与口吻出力，不要混成一个人）】
${lines}

【最新市场数据快照】（唯一数据来源，来源：东方财富 / Yahoo Finance；禁止使用训练记忆里的旧数据或编造数字）
${snapshot}

数据铁律：
- **下笔写「快照未提供 / 待验证」之前，必须先逐项回看快照**：凡是快照里已有的字段（主营构成、股权与实控人、有息负债、应收/存货、商誉、扣非、现金转化率、月线位置与盘整、量能换手、筹码、订单公告、承诺类公告、政府补助等），必须直接引用具体数字，**严禁把已有数据写成"快照未提供"**。
- 引用股价、市值、估值倍数、财务数据时，必须以上面快照为准；快照里确实没有的精确数字，才写「待验证」或用「约/可能」模糊表述。
- 【业绩预告】【机构预测】必须标注为「预测/预计」。
- 任何计算只能用快照里的数字，禁止心算，禁止编造。
- 这些铁律要贯彻到你输出的每一段分析里，不要只在开头提一句就忘了。

【研究框架】严格按下面 8 个模块输出，每个模块用「【①…】」这类中文方括号标题独占一行，标题下用 3-5 条要点（以「- 」开头）把逻辑讲完整（不要只写结论、不要泛泛而谈）。整体 1800-2600 字，宁可少而深，不要多而空。

【① 生意本质】（段永平）
- 一句话定义这门生意：卖什么、客户为什么付钱、有没有替代选择、复购或粘性靠什么驱动。
- 收入与利润来自哪里：直接引用快照「主营构成（分产品）」的收入占比与毛利率，点出前三大合计占比；哪块业务真正决定估值。
- 若快照有「经营评述」（定期报告的管理层讨论），从中提取经营要点：新签合同额、重大项目进展、研发投入、风险应对等。
- 段永平式追问：这门生意好在哪？「竞争对手拿 100 亿，能不能复制它？」

【② 护城河与唯一性】（巴菲特 + 鱼大）
- 逐一验证：品牌/定价权、转换成本、网络效应、规模效应、技术/专利/资源/牌照壁垒——有的说清楚，没有的直接说没有。
- 鱼大视角：它占有什么「用钱也买不到」的生产资料？是否「资本别无选择」（市占率、认证周期、资源储量、牌照、不可替代性）？
- 追问：10 年后这条护城河还在吗？什么能摧毁它？

【③ 股东、治理与管理层】（鱼大 + 巴菲特 + 段永平）
- 直接引用快照「股权」段：实际控制人是谁、持股多少，第一大股东与主要股东构成，前十大股东合计比例；据此判断实控人性质（国务院国资委/省国资委/央企集团/地市国资/民营）与「大集团、小公司」的程度。
- 有无同业竞争承诺/资产注入安排：若快照有「承诺/重组类公告」段，直接引用公告标题与年份（注意这是巨潮标题检索的结果，检索不到不等于没有）；没有就写「快照未检索到，待验证」，不要脑补。
- 管理层关键决策与资本配置能力、股权激励/员工持股/回购、减持记录。
- 追问：如果 CEO 退休，公司还能保持竞争力吗？

【④ 行业、周期与文明趋势】（李录 + 鱼大）
- 行业阶段（导入/成长/成熟/周期下行）与周期位置（底部/复苏/过热/衰退）；供需、库存、开工率、新增与淘汰产能、成本曲线位置。
- 在手订单与新增合同：若快照有「公告」段的订单信息，直接引用在手订单（累计已签约未完工订单金额）、新签合同额及其同比变化——这是工程/设备类公司最重要的前瞻指标，比当期营收更能反映景气度。
- 政策与需求端驱动；主导产品价格处在历史什么位置。
- 李录式追问：站在 20 年后回看，它是「这个时代的标准石油」还是「昙花一现的 3Com」？

【⑤ 财务质量与造假排查】（芒格）
- 营收/归母/扣非净利的趋势与拐点；毛利率、净利率、ROE、ROIC。
- 现金流质量：经营现金流/净利润、每股经营现金流。
- 引用快照「负债与现金」段：有息负债规模（短期借款/一年内到期/长期借款）、货币资金、净现金；以及「营运资产」段的应收票据及应收账款、存货、应付票据及应付账款。账龄明细快照不含，写「待验证」。
- 盈利质量：引用快照「盈利质量」段的扣非归母净利及其同比、扣非与归母的差异；引用「现金转化率」段判断利润含金量（<0.8 说明利润没变成现金）。
- 营运质量：引用「营运资产」段的应收/存货同比（应收增速 > 收入增速是危险信号），以及「商誉」段。
- 政府补助：引用「政府补助（代理值）」段的占比，并注明这是代理口径（精确值需年报附注）。
- 造假排查信号，逐条对照并点明命中项：应计比率偏高、现金转化率长期 <0.8、应收增速 > 收入增速、商誉/净资产过高、「非经常性」项目反复出现、政府补助占净利 >30%。
- 追问：这份报表我最可能在哪里看错？

【⑥ 估值与安全边际】（巴菲特 + 段永平 + 鱼大）
- 先判断公司类型（高成长/稳健成长/周期/价值/资源/金融），再选适用框架（PE/PEG/PB/EV-EBITDA/分部/周期中枢估值），并解释「为什么是它」。
- 拆解「股价里已经包含了什么预期」；与自身历史分位、同行对比。
- 周期股以 PB 为主（低 PE 见顶、高 PE 见底）。
- 硬锚：若快照有「价格锚公告」段，直接引用其中的回购价/增持价/股权激励行权价/定增价作为安全边际锚；没有就写「快照未检索到」，不要编造具体价位。
- 段永平式追问：如果股市明天关闭 5 年，你愿意以这个价格持有吗？
- 涉及计算只能用快照数字，禁止心算。

【⑦ 买点位置与量能】（鱼大）
- 先说清这一节回答的是「现在是不是买点」，不是「买什么」。
- 月线位置：直接引用快照「位置与量能」里的「月线位置」数字（近10年分位、近3年分位、距10年高/低点幅度），判断是历史大底、中位还是高位。
- 盘整：引用「近3年箱体宽度、连续处于箱体下1/3的月数、距最近一次3年高点的时间」，判断是否满足「盘整 2-3 年、筹码充分吸收」。
- 量能：引用「20日均量/120日均量倍数、换手率及其变化、近60日量价相关性、量能信号」，判断是底部放量、温和放量、缩量还是高位放量。
- 筹码集中度：引用快照里的「筹码（股东户数）」与「十大流通股东」——股东户数减少=筹码趋于集中（通常对应吸筹），增加=趋于分散；结合前十大流通股东合计持股比例与机构席位数判断筹码锁定程度。
- 快照里没有的写「待验证」，不要编造；技术面信号没出现就坦白说没有。

【⑧ 逆向思考与五大师会诊】（芒格 + 全体）
- 列出「这家公司可能失败的所有路径」，并给出反证条件（出现什么就说明逻辑错了）。
- 聪明人为什么会不买/做空它？空方核心论点是什么？
- 五大师会诊：共识是什么、分歧在哪里、谁的视角最关键；最后用一句话给出方向（值得深入 / 观察 / 回避），不要回避结论。

输出要求：
- 全程按「事实、逻辑、预期、风险」四层写，少用形容词，多写驱动因素；允许得出中性甚至谨慎的结论，不要默认看多。
- **图表锚点（这条必须严格照做）**：系统会在锚点出现的位置插入数据图。
  ① 锚点要**紧跟在"讲了这项数据的那一条要点"的下一行**，不要把小节里的锚点都堆到末尾——堆到末尾就等于没起到作用；
  ② 一条要点后面最多跟一个锚点；③ 每张图最多用一次；④ 正文没提到的数据就不要埋锚点。
  正确示范（注意锚点是紧贴在对应数据下面的）：
  - 工程总承包占 89.05%、毛利率 11.49%，前三大合计 99.79%，业务高度集中。
  [[CHART:mainBusiness]]
  - 二季度新签合同 50.74 亿元，6 月末在手订单 463.58 亿元，是半年营收的 6.9 倍。
  [[CHART:orders]]
  可用锚点：[[CHART:mainBusiness]]=主营构成占比 ｜ [[CHART:revenue]]=营业收入趋势 ｜ [[CHART:holders]]=股东户数/筹码集中度 ｜ [[CHART:orders]]=在手订单与新签合同 ｜ [[CHART:margin]]=毛利率与ROE ｜ [[CHART:cash]]=现金转化率 ｜ [[CHART:balance]]=货币资金/有息负债/应收/存货 ｜ [[CHART:valuation]]=估值历史分位 ｜ [[CHART:position]]=月线位置与量能
- 正文必须把该节最重要的数据结论用文字讲清楚，图的锚点只是告诉系统"图放哪儿"；不要写"数据见下图"这类空话。
- 每个模块末尾的大师追问要真的问在点子上，不要写套话。
- 直接输出 Markdown 正文，不要输出 JSON、不要输出代码块围栏、不要写「以下是报告」这类开场白。`;
}

export async function POST(request) {
  try {
    const _rl = rateLimit('fundamental:' + getClientIp(request), { limit: 30, windowMs: 60000 });
    if (!_rl.ok) return limitResponse(_rl.retryAfter);

    const body = await request.json();
    const _gq = guardFreeDaily(request, body.aiConfig, { limit: 40 });
    if (!_gq.ok) return quotaResponse(_gq.retryAfter);

    const crocodile = findMasterById('crocodile');
    if (!crocodile) return Response.json({ error: '寒武纪的鳄鱼大师缺失' }, { status: 400 });
    const masters = FUNDAMENTAL_MASTERS.map((m) => findMasterById(m.id));

    const mode = body.mode === 'followup' ? 'followup' : 'research';

    if (mode === 'followup') {
      const question = typeof body.question === 'string' ? body.question.trim() : '';
      const context = typeof body.context === 'string' ? body.context.trim() : '';
      const stockName = typeof body.stockName === 'string' ? body.stockName.trim() : '';
      if (!question) return Response.json({ error: '缺少追问内容' }, { status: 400 });

      const prompt = `你是「五位大师基础面研究小组」（寒武纪的鳄鱼/鱼大、段永平、巴菲特、芒格、李录）。用户在【鱼大基础面研究】模块里针对${stockName ? `「${stockName}」` : '这只股票'}追问，此前小组已经给过一份联合深度研究与「选股10条」评分（见下）。

【小组画像】
${masters.filter(Boolean).map((m) => masterProfileLine(m)).join('\n')}

【此前的研究与评分】
${context || '（无前置内容）'}

【用户的追问】
${question}

要求：
1. 直接回答追问，250-450 字，给信息增量，不重复已说过的内容；如果某个视角最相关，用「（巴菲特视角）」「（芒格视角）」这样点明是谁在回答，其余用鱼大的口吻收口。
2. 引用数据只能用此前研究里出现过的数字；没有的用「大约/约/可能」或直接说「需要验证」，严禁编造精确数字。
3. content 直接就是回答正文，不要任何前缀、标签或标题；只输出一个 JSON：{"content":"你对追问的回答"}。
注意：所有引号一律用中文引号「」或“”，禁止英文双引号。`;
      const { raw, parsed } = await generateJson(buildMessages(prompt, question), '{"content":"回答"}', 1400, true, body.aiConfig);
      if (parsed && typeof parsed.content === 'string' && parsed.content.trim()) {
        return Response.json({ ok: true, result: { mode: 'followup', content: parsed.content.trim() } });
      }
      if (raw && raw.trim()) {
        return Response.json({ ok: true, result: { mode: 'followup', content: extractContentFromRaw(raw) || raw.trim() } });
      }
      return Response.json({ error: 'AI 输出格式异常，请重试一次' }, { status: 502 });
    }

    // ── research ──
    const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : '';
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!symbol) return Response.json({ error: '请输入股票名称或代码' }, { status: 400 });

    let infos = [];
    try { infos = await resolveSymbols(symbol); } catch (e) { infos = []; }
    if (!infos.length) {
      return Response.json({ error: '未识别到该公司：请确认名称或代码（如：中盐化工 / 600328 / 中密控股），再试一次。' }, { status: 400 });
    }
    const info = infos[0];
    const stockName = info.name && !/^\d{6}$/.test(String(info.name)) ? info.name : symbol;

    let snapshot = '';
    let notice = '';
    let charts = null;
    try {
      const [q, f] = await Promise.all([getQuote(info).catch(() => null), getFinancials(info).catch(() => null)]);
      const deep = await getDeepAnalysis(info, q, f).catch(() => null);
      charts = buildCharts(info, q, deep);
    } catch (e) { charts = null; }
    try {
      const ctx = await getQuoteContextInfo(symbol);
      snapshot = ctx.snapshot || '';
      notice = ctx.notice || '';
    } catch (e) { snapshot = ''; }
    const dataSection = snapshot || '（本次未获取到可核验的系统数据：数据源暂不可用。请只做框架性研究，所有精确数字一律标注「待验证」，严禁编造。）';

    // ── 第 1 步：五位大师联合深度研究（纯文本输出，避免长 JSON 转义风险）──
    const researchPrompt = buildResearchPrompt(dataSection, masters) + (note ? `\n\n【用户补充说明】${note.slice(0, 1000)}` : '');
    let research = '';
    try {
      research = String(await callDeepSeek(buildMessages(researchPrompt, `请研究这家公司：${stockName}（${info.symbol}）`), 5200, body.aiConfig) || '').trim();
    } catch (e) {
      research = '';
    }
    if (!research) {
      return Response.json({ error: '深度研究生成失败，请稍后重试' }, { status: 502 });
    }
    // 去掉模型偶尔加上的代码块围栏
    research = research.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/, '').trim();

    // ── 第 2 步：鱼大基于研究结论，按「选股10条」打分 ──
    const scorePrompt = `你是 ${crocodile.name}（${crocodile.title}），五位大师基础面研究小组的主理人。刚才你和段永平、巴菲特、芒格、李录一起完成了对「${stockName}」的联合深度研究（见下）。现在请你以鱼大的身份，基于这份研究结论，按你自己的「选股10条」标准打分。

你的画像：
${masterProfileLine(crocodile)}

【选股10条评分标准】（每条按 10 分制打分，权重由系统固定，你只需给出 0-10 的评分，可保留 0.5）
${rubricText()}

百分制得分 = 10分制评分 × 权重(%) ÷ 10；总分 = 10 条得分之和（满分 100）。
总分区间：>90 绝佳买入机会 / 80-90 稀有买入机会 / 70-80 合理或优异买入机会 / <70 等待区间。

【五位大师的联合研究结论】
${research.slice(0, 12000)}

【数据快照（补充核对用）】
${dataSection.slice(0, 6000)}

【要求】
1. 评分必须与前文研究结论一致，不能自相矛盾；如果某一项研究里明确说「数据缺失/待验证」，就在 reason 里如实说明，不要硬给高分。
2. scores：严格按上面 10 条的顺序，输出恰好 10 个对象，每项 {score, reason}；score 为 0-10 数字（可 0.5），reason 是一句话（40字内，尽量引用具体数据）。
3. strongest / weakest / coreConflict：各一句话。
4. buyPrice / heavyPrice / sellPrice / upside：推荐买入价、推荐重仓价、预计卖出价（元）、盈利空间（如「100%」）；结合 PB 历史底部、回购价、商品价格底部、周期高位来给。
5. followUps：3 个完整问句（以「？」结尾、能直接追问），围绕这份研究里最值得深挖的点。
6. 只输出一个 JSON，不要输出任何其他内容（不要 Markdown 代码块）：
${SCORE_SCHEMA}
注意：所有引号一律用中文引号「」或“”，禁止英文双引号；scores 数组必须恰好 10 项。`;

    const { raw, parsed } = await generateJson(buildMessages(scorePrompt, `请给 ${stockName} 打分`), SCORE_SCHEMA, 2200, false, body.aiConfig);
    const normalized = parsed && typeof parsed === 'object' ? parsed : null;
    if (!normalized) {
      // 研究成功但评分失败：仍然把研究结果给用户，评分留空由前端提示
      return Response.json({
        ok: true,
        result: {
          mode: 'research', stockName, stock: { symbol: info.symbol, market: info.market, name: stockName },
          research, scores: [], total: null, band: '',
          strongest: '', weakest: '', coreConflict: '', buyPrice: '', heavyPrice: '', sellPrice: '', upside: '',
          followUps: [], dataCard: cleanSnapshot(snapshot), notice: notice || '', scoreFailed: true, charts,
        },
      });
    }

    const rawScores = Array.isArray(normalized.scores) ? normalized.scores : [];
    const scores = FUNDAMENTAL_CRITERIA.map((c, idx) => {
      const s = rawScores[idx] || {};
      const parsedScore = Number(s.score);
      const valid = Number.isFinite(parsedScore) && String(s.score).trim() !== '';
      const score10 = valid ? Math.max(0, Math.min(10, parsedScore)) : 0;
      return { no: c.no, name: c.name, weight: c.weight, score10: valid ? score10 : 0, score100: valid ? scoreTo100(score10, c.weight) : 0, reason: typeof s.reason === 'string' ? s.reason.trim() : '' };
    });
    const total = Math.round(scores.reduce((a, s) => a + s.score100, 0) * 100) / 100;

    const followUps = Array.isArray(normalized.followUps)
      ? normalized.followUps.filter((f) => typeof f === 'string' && f.trim()).slice(0, 3)
      : [];

    return Response.json({
      ok: true,
      result: {
        mode: 'research',
        stockName,
        stock: { symbol: info.symbol, market: info.market, name: stockName },
        research,
        scores,
        total,
        band: totalBand(total),
        strongest: typeof normalized.strongest === 'string' ? normalized.strongest.trim() : '',
        weakest: typeof normalized.weakest === 'string' ? normalized.weakest.trim() : '',
        coreConflict: typeof normalized.coreConflict === 'string' ? normalized.coreConflict.trim() : '',
        buyPrice: normalized.buyPrice != null ? String(normalized.buyPrice).trim() : '',
        heavyPrice: normalized.heavyPrice != null ? String(normalized.heavyPrice).trim() : '',
        sellPrice: normalized.sellPrice != null ? String(normalized.sellPrice).trim() : '',
        upside: normalized.upside != null ? String(normalized.upside).trim() : '',
        followUps,
        dataCard: cleanSnapshot(snapshot),
        notice: notice || '',
        charts,
      },
    });
  } catch (e) {
    const isNet = e && (e.name === 'TypeError' || /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(String(e.message)));
    return Response.json({ error: isNet ? '连接 AI 服务失败（网络异常），请稍后重试' : (e.message || '服务器内部错误') }, { status: 500 });
  }
}
