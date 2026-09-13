// 大师智能体的工具层（零 token）：把「全市场感知」封装成模型可调用的几个函数。
// 设计要点：
//  - 模型不接收全市场数据，只能按需调用；每次调用只把查询结果放进上下文，所以视野不设限、token 可控。
//  - 每个工具最多 1~3 个网络请求（板块索引已缓存），比一次拉 56 页全市场友好得多。
import {
  applyStockFilters,
  buildMarketOverview,
  fetchIndustryBoards,
  fetchIndexSummary,
  fetchLimitUpPool,
  fetchStockHistory,
  fetchStockList,
  fetchStockQuote,
  matchIndustryBoards,
} from './marketSnapshot.mjs';

const toYi = (value) => (value == null || !Number.isFinite(value) ? null : Math.round((value / 1e8) * 100) / 100);
const round = (value, digits = 2) => (value == null || !Number.isFinite(value) ? null : Math.round(value * 10 ** digits) / 10 ** digits);

function compactStock(row) {
  if (!row) return null;
  return {
    code: row.code,
    name: row.name,
    industry: row.industry || '未分类',
    price: round(row.price),
    changePct: round(row.changePct),
    turnoverPct: round(row.turnover),
    amountYi: toYi(row.amount),
    marketCapYi: toYi(row.marketCap),
    pe: round(row.pe, 1),
  };
}

function compactBoard(board) {
  return {
    industry: board.name,
    avgChangePct: round(board.changePct, 2),
    amountYi: toYi(board.amount),
    stocksUp: board.up,
    stocksDown: board.down,
    leader: board.leader || null,
    leaderCode: board.leaderCode || null,
  };
}

export const MASTER_LEAGUE_TOOLS = [
  {
    name: 'get_market_overview',
    description: '查看今天 A 股整体情况：三大指数、全市场上涨/下跌家数、行业板块强弱排行、成交额最大的行业。用于判断今天该往哪个方向找机会。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'screen_stocks',
    description: '按条件筛选个股。行业可用口语词（医药/芯片/券商/白酒/军工/新能源车…）或概览里返回的细分行业名；也可按涨跌幅、成交额、换手率、市值、市盈率过滤并排序。默认剔除 ST、退市、新股。',
    parameters: {
      type: 'object',
      properties: {
        industry: { type: 'string', description: '行业关键词，如「医药」「半导体」「银行」「白酒」' },
        keyword: { type: 'string', description: '股票名称或代码关键词' },
        minChangePct: { type: 'number', description: '当日涨跌幅下限，如 5 表示涨幅≥5%' },
        maxChangePct: { type: 'number', description: '当日涨跌幅上限，如 -3 表示跌幅≥3%' },
        minAmountYi: { type: 'number', description: '成交额下限（亿元）' },
        minTurnover: { type: 'number', description: '换手率下限（%）' },
        maxTurnover: { type: 'number', description: '换手率上限（%）' },
        minMarketCapYi: { type: 'number', description: '总市值下限（亿元）' },
        maxMarketCapYi: { type: 'number', description: '总市值上限（亿元）' },
        minPe: { type: 'number', description: '市盈率下限' },
        maxPe: { type: 'number', description: '市盈率上限（只保留正值）' },
        sortBy: { type: 'string', enum: ['amount', 'changePct', 'turnover', 'marketCap', 'pe'], description: '排序字段，默认 amount' },
        order: { type: 'string', enum: ['desc', 'asc'], description: '排序方向，默认 desc' },
        limit: { type: 'number', description: '返回条数，默认 15，最多 100' },
      },
      required: [],
    },
  },
  {
    name: 'get_stock_quote',
    description: '查单只 A 股的实时快照：价格、涨跌幅、成交额、换手率、市值、市盈率、所属行业。',
    parameters: {
      type: 'object',
      properties: { code: { type: 'string', description: '6 位股票代码，如 600276' } },
      required: ['code'],
    },
  },
  {
    name: 'get_stock_history',
    description: '查单只 A 股的日线（前复权），用于判断趋势、量能、关键价位。返回最近 N 个交易日的开高低收和成交量。',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '6 位股票代码' },
        days: { type: 'number', description: '取最近多少个交易日，默认 40，最多 120（建议一次取够，别反复拉）' },
      },
      required: ['code'],
    },
  },
  {
    name: 'get_my_positions',
    description: '查看自己当前的账户状态：可用现金、持仓明细（成本、市值、浮盈亏、仓位）、总资产和累计收益率。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

const TOOL_NAMES = new Set(MASTER_LEAGUE_TOOLS.map((tool) => tool.name));

export function listMasterLeagueToolSchemas() {
  return MASTER_LEAGUE_TOOLS.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

/**
 * 执行一次工具调用。
 * ctx: { account, deps? } —— deps 允许注入假的取数函数用于测试。
 */
export async function executeMasterLeagueTool(name, args = {}, ctx = {}) {
  if (!TOOL_NAMES.has(name)) throw new Error(`未知工具：${name}`);
  const deps = {
    fetchIndustryBoards,
    fetchIndexSummary,
    fetchLimitUpPool,
    fetchStockList,
    fetchStockQuote,
    fetchStockHistory,
    ...(ctx.deps || {}),
  };

  if (name === 'get_market_overview') {
    // 数据源失败要如实暴露给调用方（而不是假装「0 个行业涨」），方便排查与降级。
    let boardsError = '';
    let indicesError = '';
    const [boards, indices, limitUp] = await Promise.all([
      deps.fetchIndustryBoards().catch((error) => { boardsError = error?.message || '行业数据获取失败'; return []; }),
      deps.fetchIndexSummary().catch((error) => { indicesError = error?.message || '指数数据获取失败'; return []; }),
      deps.fetchLimitUpPool().catch(() => null),
    ]);
    const overview = buildMarketOverview({ boards, indices, limitUp });
    return {
      indices: overview.indices.map((item) => ({ name: item.name, price: round(item.price), changePct: round(item.changePct), amountYi: toYi(item.amount), up: item.up, down: item.down })),
      breadth: {
        byIndex: overview.breadth.byIndex,
        risingIndustries: overview.breadth.risingBoards,
        fallingIndustries: overview.breadth.fallingBoards,
        limitUpCount: overview.breadth.limitUpCount,
      },
      hottestIndustries: overview.hottestIndustries.slice(0, 6).map(compactBoard),
      weakestIndustries: overview.weakestIndustries.slice(0, 4).map(compactBoard),
      activeIndustries: overview.industriesByAmount.slice(0, 10).map(compactBoard),
      industryCount: overview.breadth.boardCount,
      dataWarnings: [
        boardsError ? `行业板块数据暂不可用（${boardsError}），行业强弱与行业筛选本次为空。` : '',
        indicesError ? `指数数据暂不可用（${indicesError}）。` : '',
        limitUp ? '' : '涨停池数据暂不可用，涨停家数未知。',
      ].filter(Boolean),
      limitUp: limitUp ? {
        count: limitUp.count,
        date: limitUp.date,
        leaders: limitUp.stocks.slice(0, 10).map((stock) => ({
          code: stock.code, name: stock.name, industry: stock.industry || null,
          changePct: round(stock.changePct), limitUpDays: stock.limitUpDays, openCount: stock.openCount,
          amountYi: toYi(stock.amount), firstLimitTime: stock.firstLimitTime,
        })),
      } : null,
      hint: '行业名可直接用于 screen_stocks 的 industry 参数；也支持口语别名（医药/芯片/券商/白酒/军工/新能源车…）。',
    };
  }

  if (name === 'screen_stocks') {
    const limit = Math.max(1, Math.min(100, Number(args.limit) || 15));
    const sortBy = args.sortBy || 'amount';
    const order = args.order === 'asc' ? 'asc' : 'desc';
    const filters = {
      keyword: args.keyword,
      minChangePct: args.minChangePct,
      maxChangePct: args.maxChangePct,
      minAmount: args.minAmountYi == null ? null : Number(args.minAmountYi) * 1e8,
      minTurnover: args.minTurnover,
      maxTurnover: args.maxTurnover,
      minMarketCap: args.minMarketCapYi == null ? null : Number(args.minMarketCapYi) * 1e8,
      maxMarketCap: args.maxMarketCapYi == null ? null : Number(args.maxMarketCapYi) * 1e8,
      minPe: args.minPe,
      maxPe: args.maxPe,
      sortBy,
      order,
      limit,
    };

    let rows = [];
    let scope = '全市场';
    let scopeNote = '';
    if (args.industry) {
      const boards = await deps.fetchIndustryBoards();
      const matched = matchIndustryBoards(boards, args.industry);
      if (!matched.length) {
        return {
          matched: 0, returned: 0, stocks: [],
          message: `没有找到行业「${args.industry}」。可以先调 get_market_overview 看当天有哪些行业名，或用更通用的词（医药/科技/消费）。`,
        };
      }
      const picked = matched.slice(0, 3);
      const lists = await Promise.all(picked.map((board) => deps.fetchStockList({ node: board.code, sortBy, order, limit: 100, industry: board.name }).catch(() => [])));
      rows = lists.flat();
      scope = picked.map((board) => board.name).join(' + ');
      if (matched.length > picked.length) scopeNote = `（该词命中 ${matched.length} 个细分行业，本次取了前 ${picked.length} 个）`;
    } else {
      // 按排序字段直接取全市场榜单（1 请求），再本地过滤：覆盖绝大多数「找最强的/最活跃的」需求
      rows = await deps.fetchStockList({ sortBy, order, limit: 100 });
      // 想找「涨幅靠前 + 成交额也要够」这类组合时，再补一份涨幅榜，避免池子里全是权重股
      if (args.minChangePct != null && args.minChangePct >= 5 && sortBy !== 'changePct') {
        const gainers = await deps.fetchStockList({ sortBy: 'changePct', order: 'desc', limit: 100 }).catch(() => []);
        rows = [...rows, ...gainers];
      }
    }

    // 多路榜单合并后去重（同一只股票可能同时出现在成交额榜和涨幅榜）
    const deduped = [...new Map(rows.map((row) => [row.code, row])).values()];
    const { total, rows: hits } = applyStockFilters(deduped, filters);
    return {
      scope,
      scopeNote: scopeNote || undefined,
      matched: total,
      returned: hits.length,
      stocks: hits.map(compactStock),
    };
  }

  if (name === 'get_stock_quote') {
    const quote = await deps.fetchStockQuote(args.code);
    if (!quote) return { found: false, message: `未取到 ${args.code} 的行情，可能停牌或代码有误。` };
    return { found: true, stock: compactStock(quote) };
  }

  if (name === 'get_stock_history') {
    const days = Math.max(5, Math.min(120, Number(args.days) || 40));
    const history = await deps.fetchStockHistory(args.code, days);
    // 紧凑数组格式：[日期, 开, 收, 高, 低, 量]，比对象数组省 50%+ 上下文
    return {
      code: history.code,
      name: history.name,
      days: history.bars.length,
      format: '[date, open, close, high, low, volume]',
      bars: history.bars.map((bar) => [bar.date, bar.open, bar.close, bar.high, bar.low, bar.volume]),
    };
  }

  if (name === 'get_my_positions') {
    const account = ctx.account || {};
    return {
      cash: round(account.cash),
      totalAsset: round(account.totalAsset),
      profitRate: account.profitRate,
      positions: (account.positions || []).map((position) => ({
        code: position.symbol,
        name: position.name,
        quantity: position.quantity,
        averagePrice: round(position.averagePrice),
        marketPrice: round(position.marketPrice),
        marketValue: round(position.marketValue),
        profit: round(position.profit),
        profitRate: position.profitRate,
        weightPct: round((position.weight || 0) * 100, 1),
      })),
    };
  }

  throw new Error(`工具未实现：${name}`);
}

export const __test__ = { compactStock, compactBoard, toYi };
