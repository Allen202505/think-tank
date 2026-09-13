import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStockFilters,
  buildMarketOverview,
  isTradableRow,
  matchIndustryBoards,
  normalizeSinaRows,
  parseSinaBoards,
  resolveIndustryFilters,
} from '../src/lib/marketSnapshot.mjs';
import { executeMasterLeagueTool, listMasterLeagueToolSchemas } from '../src/lib/masterLeagueTools.mjs';
import { isWeekendDate } from '../src/lib/masterLeagueCommentaryJob.js';
import {
  buildCommentaryPrompt,
  parseCommentaryPayload,
  pickCommenters,
} from '../src/lib/masterLeagueCommentary.mjs';
import {
  AGENT_LIMITS,
  MAX_TOOL_RESULT_CHARS,
  estimateCost,
  parseDecisionPayload,
  runMasterAgent,
  stringifyToolResult,
  validateAgentDecision,
} from '../src/lib/masterLeagueAgent.mjs';

const SINA_ROWS = [
  { code: '600276', name: '恒瑞医药', trade: '42.67', changepercent: -0.61, amount: 3394000000, volume: 80255100, turnoverratio: 1.26, per: 31.7, pb: 6.2, mktcap: 28320900, nmc: 25000000 },
  { code: '300142', name: '沃森生物', trade: '13.09', changepercent: 0.69, amount: 1016000000, volume: 77000000, turnoverratio: 2.1, per: 55, pb: 3.1, mktcap: 2000000, nmc: 1900000 },
  { code: '000636', name: '风华高科', trade: '18.20', changepercent: 10, amount: 9985000000, volume: 200000000, turnoverratio: 16.22, per: 44, pb: 2.4, mktcap: 1500000, nmc: 1400000 },
  { code: '600001', name: 'ST测试', trade: '3.10', changepercent: 5, amount: 500000000, volume: 10000000, turnoverratio: 3, per: null, pb: null, mktcap: 900000, nmc: 800000 },
  { code: '688001', name: 'N新股', trade: '88.00', changepercent: 120, amount: 900000000, volume: 9000000, turnoverratio: 40, per: 100, pb: 9, mktcap: 5000000, nmc: 4000000 },
];

test('新浪个股字段被正确归一化（市值万元→元）', () => {
  const rows = normalizeSinaRows(SINA_ROWS, '生物制药');
  assert.equal(rows.length, 5);
  assert.equal(rows[0].code, '600276');
  assert.equal(rows[0].price, 42.67);
  assert.equal(rows[0].changePct, -0.61);
  assert.equal(rows[0].marketCap, 283209000000);
  assert.equal(rows[0].industry, '生物制药');
});

test('行业板块列表解析（新浪 key":"value 结构）', () => {
  const text = 'var S_Finance_bankuai_sinaindustry = {"new_swzz":"new_swzz,生物制药,155,17.4,-0.05,-0.31,1026385049,22316435075,sh600184,10.022,19.980,1.820,光电股份","new_ylqx":"new_ylqx,医疗器械,31,20.1,0.02,0.12,530383262,10602452257,sh601890,-1.252,10.250,-0.130,振江股份"};';
  const boards = parseSinaBoards(text);
  assert.equal(boards.length, 2);
  assert.equal(boards[0].code, 'new_swzz');
  assert.equal(boards[0].name, '生物制药');
  assert.equal(boards[0].count, 155);
  assert.equal(boards[0].changePct, -0.31);
  assert.equal(boards[0].leader, '光电股份');
  assert.equal(boards[1].name, '医疗器械');
});

test('行业别名能把口语词映射到细分行业板块', () => {
  const boards = [
    { code: 'new_swzz', name: '生物制药' },
    { code: 'new_ylqx', name: '医疗器械' },
    { code: 'new_yh', name: '银行' },
  ];
  assert.equal(matchIndustryBoards(boards, '医药').length, 2);
  assert.equal(matchIndustryBoards(boards, '银行').length, 1);
  assert.ok(resolveIndustryFilters('医药').includes('生物制药'));
});

test('筛选默认剔除 ST 与新股，并能按涨跌幅/成交额过滤', () => {
  const rows = normalizeSinaRows(SINA_ROWS);
  assert.equal(isTradableRow(rows[3]), false); // ST
  assert.equal(isTradableRow(rows[4]), false); // N 开头新股
  assert.equal(isTradableRow(rows[0]), true);

  const byChange = applyStockFilters(rows, { minChangePct: 5, limit: 10 });
  assert.deepEqual(byChange.rows.map((row) => row.code), ['000636']);

  const byAmount = applyStockFilters(rows, { minAmount: 3e9, limit: 10 });
  assert.deepEqual(byAmount.rows.map((row) => row.code), ['000636', '600276']);
});

test('市场概览：不做会被误读的跨指数家数相加', () => {
  const overview = buildMarketOverview({
    boards: [
      { name: '生物制药', changePct: 2.1, amount: 1e10, count: 155 },
      { name: '银行', changePct: -0.5, amount: 8e9, count: 42 },
    ],
    indices: [
      { name: '上证指数', up: 277, down: 2058, flat: 17, amount: 9.5e11 },
      { name: '深证成指', up: 342, down: 2561, flat: 29, amount: 1.0e12 },
    ],
    limitUp: { count: 40 },
  });
  assert.equal(overview.breadth.byIndex.length, 2);
  assert.equal(overview.breadth.up, undefined);
  assert.equal(overview.breadth.limitUpCount, 40);
  assert.equal(overview.breadth.risingBoards, 1);
  assert.equal(overview.breadth.fallingBoards, 1);
  assert.equal(overview.hottestIndustries[0].name, '生物制药');
});

test('工具清单包含 5 个工具且带 JSON Schema', () => {
  const schemas = listMasterLeagueToolSchemas();
  assert.equal(schemas.length, 5);
  assert.deepEqual(schemas.map((item) => item.function.name), [
    'get_market_overview', 'screen_stocks', 'get_stock_quote', 'get_stock_history', 'get_my_positions',
  ]);
  assert.ok(schemas.every((item) => item.type === 'function' && item.function.parameters));
});

test('工具执行：注入假数据时不发网络请求', async () => {
  const deps = {
    fetchIndustryBoards: async () => [{ code: 'new_swzz', name: '生物制药', changePct: 2.1, amount: 1e10, count: 155 }],
    fetchIndexSummary: async () => [{ name: '上证指数', price: 3888.11, changePct: -1.18, up: 277, down: 2058, amount: 9.5e11 }],
    fetchLimitUpPool: async () => ({ count: 40, date: '20260911', stocks: [{ code: '000993', name: '闽东电力', changePct: 9.98, limitUpDays: 2, openCount: 0, amount: 6.6e8 }] }),
    fetchStockList: async ({ industry }) => normalizeSinaRows(SINA_ROWS.slice(0, 2), industry || ''),
    fetchStockQuote: async () => normalizeSinaRows([SINA_ROWS[0]])[0],
    fetchStockHistory: async () => ({ code: '600276', name: '恒瑞医药', bars: Array.from({ length: 30 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, open: 40, close: 41, high: 42, low: 39, volume: 1000 })) }),
  };

  const overview = await executeMasterLeagueTool('get_market_overview', {}, { deps });
  assert.equal(overview.indices[0].name, '上证指数');
  assert.equal(overview.breadth.limitUpCount, 40);
  assert.equal(overview.limitUp.leaders[0].name, '闽东电力');

  const screen = await executeMasterLeagueTool('screen_stocks', { industry: '医药', limit: 5 }, { deps });
  assert.equal(screen.scope, '生物制药');
  assert.equal(screen.returned, 2);

  const quote = await executeMasterLeagueTool('get_stock_quote', { code: '600276' }, { deps });
  assert.equal(quote.stock.name, '恒瑞医药');

  const history = await executeMasterLeagueTool('get_stock_history', { code: '600276', days: 30 }, { deps });
  assert.equal(history.days, 30);

  const positions = await executeMasterLeagueTool('get_my_positions', {}, {
    account: { cash: 50000, totalAsset: 101000, profitRate: 0.01, positions: [{ symbol: '600276', name: '恒瑞医药', quantity: 1000, averagePrice: 40, marketPrice: 42.67, marketValue: 42670, profit: 2670, profitRate: 0.066, weight: 0.42 }] },
  });
  assert.equal(positions.positions[0].code, '600276');
  assert.equal(positions.positions[0].weightPct, 42);

  await assert.rejects(() => executeMasterLeagueTool('not_a_tool', {}, { deps }), /未知工具/);
});

// ── 大师智能体（成本与决策校验） ───────────────────────────────
test('智能体成本估算按缓存命中/未命中分别计价', () => {
  const usage = estimateCost({ prompt_tokens: 10000, prompt_cache_hit_tokens: 8000, completion_tokens: 500 });
  assert.equal(usage.cachedTokens, 8000);
  assert.equal(usage.missTokens, 2000);
  assert.equal(usage.totalTokens, 10500);
  // 8000×0.2 + 2000×2 + 500×3 = 1600 + 4000 + 1500 = 7100（元/百万）→ 0.0071 元
  assert.equal(usage.cost, 0.0071);
});

test('决策校验：拦住非法动作、缺代码、超仓位与过短理由', () => {
  assert.equal(validateAgentDecision({ action: '梭哈', symbol: '600276', targetPct: 50, reason: '因为我觉得会涨' }).ok, false);
  assert.equal(validateAgentDecision({ action: '买入', targetPct: 30, reason: '突破关键点，放量确认' }).ok, false);
  assert.equal(validateAgentDecision({ action: '买入', symbol: '600276', targetPct: 130, reason: '突破关键点，放量确认' }).ok, false);
  assert.equal(validateAgentDecision({ action: '买入', symbol: '600276', targetPct: 30, reason: '太短' }).ok, false);

  const ok = validateAgentDecision({ action: '买入', symbol: '600276', targetPct: 30.26, reason: '放量突破关键点，量能配合', risk: '跌回平台' });
  assert.equal(ok.ok, true);
  assert.equal(ok.decision.targetPct, 30.3);

  const hold = validateAgentDecision({ action: '持有', symbol: '600276', targetPct: 30, reason: '没有新的关键点，保持观察' });
  assert.equal(hold.ok, true);
  assert.equal(hold.decision.symbol, null);
  assert.equal(hold.decision.targetPct, 0);
});

test('决策 JSON 解析能处理代码块与前后解释文字', () => {
  assert.equal(parseDecisionPayload('```json\n{"action":"持有"}\n```').value.action, '持有');
  assert.equal(parseDecisionPayload('我的判断是：{"action":"卖出","symbol":"300059"}，以上就是结论。').value.symbol, '300059');
  assert.equal(parseDecisionPayload('模型今天不想说话').ok, false);
});

test('工具结果超长会被截断，避免上下文与账单失控', () => {
  const long = { bars: Array.from({ length: 500 }, (_, i) => [i, 1, 2, 3, 4, 5]) };
  const text = stringifyToolResult(long);
  assert.ok(text.length <= MAX_TOOL_RESULT_CHARS + 40);
  assert.ok(text.endsWith('[结果已截断，如需更多请缩小查询范围]'));
  assert.ok(stringifyToolResult({ ok: true }).length < 60);
});

test('智能体循环：调工具 → 校验 → 产出决策，且不越过 token 上限', async () => {
  const master = { id: 'livermore', name: '杰西·利弗莫尔', title: '趋势投机之王', styleDetail: '关键点', intro: '', personality: '' };
  const calls = [];
  const deps = {
    callLlm: async ({ messages, tools }) => {
      calls.push(tools.length);
      // 第一次要求调工具，第二次直接给结论
      if (calls.length === 1) {
        return {
          message: { content: '', tool_calls: [{ id: 'call_1', function: { name: 'get_stock_quote', arguments: '{"code":"600276"}' } }] },
          usage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 600, completion_tokens: 50 },
        };
      }
      return {
        message: { content: '{"action":"买入","symbol":"600276","targetPct":20,"reason":"放量突破关键点，量价配合","risk":"跌回平台"}', tool_calls: [] },
        usage: { prompt_tokens: 1200, prompt_cache_hit_tokens: 1000, completion_tokens: 60 },
      };
    },
    runTool: async (name, args) => ({ called: name, args }),
  };

  const result = await runMasterAgent({
    master,
    account: { cash: 100000, totalAsset: 100000, profitRate: 0, positions: [] },
    date: '2026-09-14',
    aiConfig: { apiKey: 'test', baseUrl: 'https://example.com/v1', model: 'deepseek-chat' },
    deps,
  });

  assert.equal(result.stopReason, 'final');
  assert.equal(result.rounds, 2);
  assert.equal(result.trace.length, 1);
  assert.equal(result.trace[0].tool, 'get_stock_quote');
  assert.equal(result.decision.action, '买入');
  assert.equal(result.decision.targetPct, 20);
  assert.equal(result.validation.ok, true);
  assert.equal(result.usage.totalTokens, 2310);
  assert.ok(result.usage.cost > 0);
  assert.equal(calls.length, 2, '两次模型调用：一次调工具，一次给结论');
  assert.ok(calls[0] > 0, '第一轮应带上工具');
});

test('智能体循环：轮次用尽时强制收口，不会烧着钱没有决策', async () => {
  const master = { id: 'livermore', name: '杰西·利弗莫尔' };
  let calls = 0;
  const deps = {
    callLlm: async ({ tools, forceNoTools }) => {
      calls += 1;
      if (!forceNoTools && tools.length) {
        return {
          message: { content: '', tool_calls: [{ id: `c${calls}`, function: { name: 'get_my_positions', arguments: '{}' } }] },
          usage: { prompt_tokens: 500, completion_tokens: 10 },
        };
      }
      return {
        message: { content: '{"action":"持有","symbol":null,"targetPct":0,"reason":"今天的额度已用完，没有足够依据，保持空仓观察","risk":"错过机会"}', tool_calls: [] },
        usage: { prompt_tokens: 600, completion_tokens: 40 },
      };
    },
    runTool: async () => ({ cash: 100000, positions: [] }),
  };

  const result = await runMasterAgent({
    master,
    account: { cash: 100000, totalAsset: 100000, positions: [] },
    date: '2026-09-14',
    aiConfig: { apiKey: 'test', baseUrl: 'https://example.com/v1', model: 'deepseek-chat' },
    deps,
    limits: { ...AGENT_LIMITS, maxRounds: 2, maxCallsPerRun: 5 },
  });

  assert.equal(result.stopReason, 'forced_final');
  assert.equal(result.decision.action, '持有');
  assert.equal(result.rounds, 2);
  assert.equal(result.calls, 3); // 2 轮工具 + 1 次强制收口
});

// ── 大师互评 AI 生成（成本与质量控制） ──────────────────────────
const COMMENT_MASTERS = [
  { id: 'livermore', name: '利弗莫尔' },
  { id: 'wyckoff', name: '威科夫' },
  { id: 'darvas', name: '达瓦斯' },
  { id: 'loeb', name: '勒布' },
  { id: 'kostolany', name: '科斯托拉尼' },
  { id: 'baruch', name: '巴鲁克' },
];

test('互评点评人按日期轮换，且不会点到本人', () => {
  const day1 = pickCommenters(COMMENT_MASTERS, 'loeb', 3, 1013).map((m) => m.id);
  const day2 = pickCommenters(COMMENT_MASTERS, 'loeb', 3, 1014).map((m) => m.id);
  assert.equal(day1.length, 3);
  assert.equal(new Set(day1).size, 3, '点评人不能重复');
  assert.ok(!day1.includes('loeb'), '不能点评自己');
  assert.ok(!day2.includes('loeb'));
  assert.notDeepEqual(day1, day2, '不同日期应轮换点评人');
  // 同一天同一大师结果稳定（缓存友好）
  assert.deepEqual(pickCommenters(COMMENT_MASTERS, 'loeb', 3, 1013).map((m) => m.id), day1);
});

test('互评输出校验：拦住非法点评人、自己点评自己、超短文案与缺 about', () => {
  const commenters = [{ id: 'wyckoff' }, { id: 'darvas' }];
  const good = parseCommentaryPayload(JSON.stringify([
    { commenterId: 'wyckoff', about: '卖出 招商银行', text: '银行浮盈4.16%就砍，你卖的是耐心不是主力筹码。', reply: '我赚相对强度，不赚心电图。' },
  ]), { commenters, targetId: 'loeb' });
  assert.equal(good.ok, true);
  assert.equal(good.comments[0].about, '卖出 招商银行');

  const bad = parseCommentaryPayload(JSON.stringify([
    { commenterId: 'unknown', about: 'x', text: '这是一条足够长的点评内容占位文本占位。', reply: '回怼内容占位。' },
    { commenterId: 'loeb', about: 'x', text: '自己点评自己的内容也要被拦住才行。', reply: '回怼内容占位。' },
    { commenterId: 'darvas', about: 'x', text: '太短', reply: '短' },
  ]), { commenters: [...commenters, { id: 'loeb' }], targetId: 'loeb' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length >= 3);

  const fenced = parseCommentaryPayload('```json\n[{"commenterId":"darvas","about":"加仓 恒瑞医药","text":"恒瑞浮亏7.34%你还加仓，倒金字塔是亏损加速器。","reply":"亏损是上一笔的账。"}]\n```', { commenters, targetId: 'loeb' });
  assert.equal(fenced.ok, true);
});

test('互评 prompt 带上真实持仓与数字，并要求只能引用给定数据', () => {
  const { system, user } = buildCommentaryPrompt({
    target: { id: 'loeb', shortName: '勒布', styleDetail: '机动成长' },
    commenters: [{ id: 'wyckoff', shortName: '威科夫', styleDetail: '量价博弈', intro: '看筹码' }],
    decisions: [{ action: '卖出', stockName: '招商银行', targetPct: 0, reason: '失去相对强势' }],
    positions: [{ name: '招商银行', quantity: 400, averagePrice: 17.5, marketPrice: 18.2, profitRate: 0.0416 }],
    performance: '累计收益 -1.35%，当前第 5 名',
    market: '上证指数 -1.18%，行业 0 涨 / 49 跌',
  });
  assert.match(system, /不许自己编造股数/);
  assert.match(user, /卖出 招商银行/);
  assert.match(user, /400股/);
  assert.match(user, /第 5 名/);
  assert.match(user, /49 跌/);
  assert.match(user, /wyckoff/);
});

test('定时任务的交易日判断：周末跳过，工作日放行', () => {
  // 2026-09-12 周六、09-13 周日、09-14 周一
  assert.equal(isWeekendDate('2026-09-12'), true);
  assert.equal(isWeekendDate('2026-09-13'), true);
  assert.equal(isWeekendDate('2026-09-14'), false);
  assert.equal(isWeekendDate(''), false);
});
