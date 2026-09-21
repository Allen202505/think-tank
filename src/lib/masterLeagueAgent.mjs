// 大师智能体：一位大师 × 一次决策 = 「人设 + 记忆 + 工具调用 + 结构化输出」。
//
// 成本纪律（这块最重要）：
//  1) 硬闸门：单次运行最多 N 轮工具调用、每次最多 maxTokens、整轮最多 maxRunTokens；
//     任何一项超限立即停止，降级为「持有」，不继续烧钱。
//  2) 前缀稳定：system prompt 只包含固定人设与规则，配合 prompt 缓存命中更便宜。
//  3) 每次运行都返回真实 usage + 成本估算，并累加到进程内当日台账，超日预算直接拒绝运行。
//  4) LLM 只出「意图」，成交价/持仓/收益永远由结算引擎算。
import { buildProviderBody, buildProviderHeaders, resolveLlmUrl } from './llm.js';
import { executeMasterLeagueTool, listMasterLeagueToolSchemas } from './masterLeagueTools.mjs';

// ── 价格表（元 / 百万 token）。默认按 DeepSeek-V4.1-Flash 峰值价折算 ──
// 官方峰值 USD：0.30 / 0.006 / 1.20，按 USD/CNY=7.2 折算；可用环境变量覆盖。
export const PRICING = {
  inputCacheMiss: Number(process.env.MASTER_LEAGUE_PRICE_INPUT_MISS || 2.16),
  inputCacheHit: Number(process.env.MASTER_LEAGUE_PRICE_INPUT_HIT || 0.0432),
  output: Number(process.env.MASTER_LEAGUE_PRICE_OUTPUT || 8.64),
};

export const AGENT_LIMITS = {
  maxRounds: Number(process.env.MASTER_LEAGUE_AGENT_MAX_ROUNDS || 3),
  maxTokensPerCall: Number(process.env.MASTER_LEAGUE_AGENT_MAX_TOKENS || 1200),
  maxRunTokens: Number(process.env.MASTER_LEAGUE_AGENT_MAX_RUN_TOKENS || 30000),
  callTimeoutMs: Number(process.env.MASTER_LEAGUE_AGENT_TIMEOUT_MS || 90000),
  maxCallsPerRun: Number(process.env.MASTER_LEAGUE_AGENT_MAX_CALLS || 5),
  // 一次运行最多允许多少次工具调用（模型可能在一轮里并行发起多个，必须单独设闸）
  maxToolCalls: Number(process.env.MASTER_LEAGUE_AGENT_MAX_TOOL_CALLS || 8),
};

// 当日台账（进程内）。serverless 会随实例重启，属于「第一道闸门」；
// 真正的持久化预算控制放到后续接底表时做。
const ledger = { day: '', tokens: 0, cost: 0, runs: 0 };
const DAILY_TOKEN_CAP = Number(process.env.MASTER_LEAGUE_AGENT_DAILY_TOKEN_CAP || 200000);

function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function getAgentLedger(now = new Date()) {
  if (ledger.day !== todayKey(now)) {
    ledger.day = todayKey(now);
    ledger.tokens = 0;
    ledger.cost = 0;
    ledger.runs = 0;
  }
  return { ...ledger, dailyTokenCap: DAILY_TOKEN_CAP, remainingTokens: Math.max(0, DAILY_TOKEN_CAP - ledger.tokens) };
}

// 供其他会烧 token 的模块（如互评生成）把用量并入同一个当日台账
export function recordAgentUsage(usage = {}) {
  getAgentLedger();
  const total = Number(usage.totalTokens) || 0;
  ledger.tokens += total;
  ledger.cost += Number(usage.cost) || 0;
  ledger.runs += 1;
  return getAgentLedger();
}

export function estimateCost(usage = {}) {
  const prompt = Number(usage.prompt_tokens) || 0;
  const cached = Math.min(prompt, Number(usage.prompt_cache_hit_tokens) || 0);
  const miss = Math.max(0, prompt - cached);
  const completion = Number(usage.completion_tokens) || 0;
  const cost = (miss * PRICING.inputCacheMiss + cached * PRICING.inputCacheHit + completion * PRICING.output) / 1e6;
  return {
    promptTokens: prompt,
    cachedTokens: cached,
    missTokens: miss,
    completionTokens: completion,
    totalTokens: prompt + completion,
    cost: Math.round(cost * 1e6) / 1e6, // 保留 6 位小数：单次约 0.00x 元
    breakdown: { miss, cached, completion },
  };
}

// 工具结果进上下文前做硬截断：单个结果最多 MAX_TOOL_RESULT_CHARS，
// 防止某次「话多」的查询把上下文和账单一起撑大。
export const MAX_TOOL_RESULT_CHARS = Number(process.env.MASTER_LEAGUE_MAX_TOOL_RESULT_CHARS || 4000);

export function stringifyToolResult(result) {
  const text = JSON.stringify(result);
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…[结果已截断，如需更多请缩小查询范围]`;
}

// ── 决策校验（纯函数，便于单测） ────────────────────────────
export const DECISION_ACTIONS = ['买入', '加仓', '减仓', '卖出', '持有'];
// 一天最多几个动作：一次调用生成，多了只会增加执行噪音，不增加成本
export const MAX_ACTIONS_PER_DAY = Number(process.env.MASTER_LEAGUE_MAX_ACTIONS || 3);

const SELL_ACTIONS = new Set(['卖出', '减仓']);
const BUY_ACTIONS = new Set(['买入', '加仓']);

function stableActionOrder(decisions = []) {
  const priority = (action) => (SELL_ACTIONS.has(action) ? 0 : BUY_ACTIONS.has(action) ? 1 : 2);
  return decisions
    .map((decision, index) => ({ decision, index }))
    .sort((a, b) => priority(a.decision.action) - priority(b.decision.action) || a.index - b.index)
    .map((item) => item.decision);
}

export function extractPriceHints(trace = [], account = {}) {
  const hints = {};
  for (const position of account?.positions || []) {
    const price = Number(position.marketPrice);
    if (position.symbol && price > 0) hints[position.symbol] = price;
  }
  for (const item of trace || []) {
    const result = item?.result;
    const stock = result?.stock;
    const stockPrice = Number(stock?.price);
    if (stock?.code && stockPrice > 0) hints[stock.code] = stockPrice;
    for (const row of result?.stocks || []) {
      const rowPrice = Number(row?.price);
      if (row?.code && rowPrice > 0) hints[row.code] = rowPrice;
    }
    const code = result?.code;
    const bars = result?.bars;
    if (code && Array.isArray(bars) && bars.length) {
      const close = Number(bars[bars.length - 1]?.[2]);
      if (close > 0) hints[code] = close;
    }
  }
  return hints;
}

// 生成阶段就按账户现金与已排在前面的卖出所得约束买入计划：
// 1) 卖出/减仓排在买入/加仓之前；2) 不能覆盖一手成本的买入会被移除；
// 3) 买入过重时按可用现金和整手成本下调 targetPct；4) 最终无动作则明确持有。
export function applyFundingConstraints(decisions = [], { account = {}, priceHints = {} } = {}) {
  const notes = [];
  const totalAsset = Math.max(0, Number(account?.totalAsset) || 0);
  let cash = Math.max(0, Number(account?.cash) || 0);
  const positions = new Map((account?.positions || []).map((position) => [position.symbol, position]));
  const output = [];

  for (const decision of stableActionOrder(decisions)) {
    const action = String(decision?.action || '');
    const symbol = String(decision?.symbol || '');

    if (SELL_ACTIONS.has(action)) {
      const position = positions.get(symbol);
      if (position) {
        const currentValue = Math.max(0, Number(position.marketValue) || 0);
        const targetPct = Math.max(0, Math.min(100, Number(decision.targetPct) || 0));
        const targetValue = action === '减仓' && totalAsset > 0 ? totalAsset * (targetPct / 100) : 0;
        cash += Math.max(0, currentValue - targetValue);
      }
      output.push(decision);
      continue;
    }

    if (BUY_ACTIONS.has(action)) {
      const position = positions.get(symbol);
      const currentValue = Math.max(0, Number(position?.marketValue) || 0);
      const currentQuantity = Math.max(0, Number(position?.quantity) || 0);
      const targetPct = Math.max(0, Math.min(100, Number(decision.targetPct) || 0));
      const desiredValue = totalAsset * (targetPct / 100);
      const requiredCash = Math.max(0, desiredValue - currentValue);
      const price = Math.max(0, Number(priceHints?.[symbol]) || 0);

      if (price > 0) {
        const lotCost = price * 100;
        const targetLots = Math.floor((desiredValue + 1e-6) / lotCost);
        const currentLots = Math.floor((currentQuantity + 1e-6) / 100);
        const deltaLots = Math.max(0, targetLots - currentLots);
        const affordableLots = Math.floor((cash + 1e-6) / lotCost);

        if (deltaLots <= 0) {
          notes.push(`${symbol} 目标仓位不足一手或不增加仓位，已移除无效买入`);
          continue;
        }
        if (affordableLots <= 0) {
          notes.push(`${symbol} 现金不足一手（约需 ${Math.round(lotCost)} 元），已取消买入`);
          continue;
        }
        if (deltaLots > affordableLots) {
          const adjustedValue = currentValue + affordableLots * lotCost;
          const adjustedPct = totalAsset > 0 ? Math.floor((adjustedValue / totalAsset) * 1000) / 10 : 0;
          output.push({ ...decision, targetPct: adjustedPct });
          cash = Math.max(0, cash - affordableLots * lotCost);
          notes.push(`${symbol} 按可用现金将目标仓位下调至 ${adjustedPct}%`);
          continue;
        }
        output.push(decision);
        cash = Math.max(0, cash - deltaLots * lotCost);
        continue;
      }

      if (requiredCash > cash + 0.01) {
        if (cash <= 0 || totalAsset <= 0) {
          notes.push(`${symbol} 现金不足，已取消买入`);
          continue;
        }
        const adjustedValue = currentValue + cash;
        const adjustedPct = Math.floor((adjustedValue / totalAsset) * 1000) / 10;
        output.push({ ...decision, targetPct: adjustedPct });
        notes.push(`${symbol} 缺少目标价格，已按可用现金将目标仓位下调至 ${adjustedPct}%`);
        cash = 0;
        continue;
      }
      output.push(decision);
      cash = Math.max(0, cash - requiredCash);
      continue;
    }

    output.push(decision);
  }

  if (!output.length) {
    output.push({
      action: '持有',
      symbol: null,
      targetPct: 0,
      reason: '当前可用现金不足以买入符合条件的整手标的，保持现金等待机会。',
      risk: '后续出现可负担标的或资金回笼后重新评估。',
    });
    notes.push('所有买入均不满足资金约束，已降级为持有');
  }
  return { decisions: output, notes };
}

export function validateAgentDecision(raw, { maxTargetPct = 100 } = {}) {
  const errors = [];
  const decision = { ...(raw || {}) };
  const action = String(decision.action || '').trim();
  if (!DECISION_ACTIONS.includes(action)) errors.push(`action 必须是 ${DECISION_ACTIONS.join('/')}`);

  if (action === '持有') {
    decision.symbol = null;
    decision.targetPct = 0;
  } else if (action) {
    const symbol = String(decision.symbol || '').trim();
    if (!/^\d{6}$/.test(symbol)) errors.push('非持有操作必须给出 6 位股票代码');
    decision.symbol = symbol;
    const target = Number(decision.targetPct);
    if (!Number.isFinite(target)) errors.push('targetPct 必须是数字');
    else if (target < 0 || target > maxTargetPct) errors.push(`targetPct 需在 0~${maxTargetPct}`);
    else decision.targetPct = action === '卖出' ? 0 : Math.round(target * 10) / 10;
  }

  const reason = String(decision.reason || '').trim();
  if (reason.length < 8) errors.push('reason 太短，必须说明依据');
  decision.reason = reason.slice(0, 400);
  decision.risk = String(decision.risk || '').trim().slice(0, 200);
  decision.action = action;

  return { ok: errors.length === 0, errors, decision };
}

// 模型可能把 JSON 包在 ```json 代码块里，或前后带解释文字
// 解析模型输出：优先数组（一次多个动作），兼容旧的单对象格式
export function parseDecisionPayload(content) {
  const text = String(content || '').trim();
  if (!text) return { ok: false, error: '模型返回为空' };
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;

  const arrayStart = candidate.indexOf('[');
  const arrayEnd = candidate.lastIndexOf(']');
  const objectStart = candidate.indexOf('{');
  const objectEnd = candidate.lastIndexOf('}');
  const useArray = arrayStart >= 0 && arrayEnd > arrayStart && (objectStart < 0 || arrayStart < objectStart);

  const start = useArray ? arrayStart : objectStart;
  const end = useArray ? arrayEnd : objectEnd;
  if (start < 0 || end <= start) return { ok: false, error: '没有找到 JSON 内容' };
  try {
    const value = JSON.parse(candidate.slice(start, end + 1));
    return { ok: true, value, multiple: useArray };
  } catch (error) {
    return { ok: false, error: `JSON 解析失败：${error.message}` };
  }
}

// 校验一组动作：逐条校验、同一只股票只能出现一次、最多 maxActions 条
export function validateAgentDecisions(rawList, { maxActions = MAX_ACTIONS_PER_DAY } = {}) {
  const list = Array.isArray(rawList) ? rawList : [rawList];
  const decisions = [];
  const errors = [];
  const seen = new Set();
  for (const item of list) {
    const result = validateAgentDecision(item);
    if (!result.ok) { errors.push(...result.errors); continue; }
    const key = result.decision.symbol || 'CASH';
    if (seen.has(key)) { errors.push(`同一只股票重复出现：${key}`); continue; }
    seen.add(key);
    decisions.push(result.decision);
    if (decisions.length >= maxActions) break;
  }
  if (decisions.length > 1) {
    // 多条动作里只允许一条「持有」，否则等于没动作
    const holds = decisions.filter((item) => item.action === '持有');
    if (holds.length > 1) {
      for (let i = decisions.length - 1; i >= 0 && decisions.filter((d) => d.action === '持有').length > 1; i -= 1) {
        if (decisions[i].action === '持有') { decisions.splice(i, 1); errors.push('多余的「持有」已移除'); }
      }
    }
  }
  return { ok: decisions.length > 0, errors, decisions, decision: decisions[0] || null };
}

// ── Prompt 组装 ────────────────────────────────────────────
// system 段保持稳定（人设 + 规则），让前缀缓存更容易命中；会变的东西放 user 段。
export function buildSystemPrompt(master) {
  return [
    `你是「${master.name}」（${master.title || master.style}），正在参加一个 A 股模拟实盘公开赛。`,
    `你的方法：${master.styleDetail || master.style}。${master.intro || ''}`,
    `你的性格：${master.personality || '按自己的方法独立判断，允许犯错并复盘。'}`,
    '',
    '比赛规则：',
    '- 初始资金 10 万元，只做 A 股，只能做多，不能融资、不能做空。',
    '- 100 股为一手，买入必须整手；T+1，当天买入的股票当天不能卖出。',
    '- 你提交的是「下一交易日开盘执行」的计划，成交价按真实开盘价、收盘价结算，你自己不能编造成交价或收益。',
    '- 你可以调用工具查看行情、行业和持仓。先看清楚数据再下判断，不要凭空猜价格或涨跌幅。',
    '',
    '决策要求：',
    '- 只做你有依据的操作。没有值得做的机会时，明确选择「持有」，不要为了交易而交易。',
    '- 买入/加仓前必须先确认可用现金和目标价格，计算「一手成本 = 目标价 × 100」。现金不足一手时不得买入。',
    '- 卖出/减仓用于腾挪资金时，必须把卖出/减仓放在买入/加仓之前；同日计划会按该顺序执行。',
    '- targetPct 对应的新增市值必须能被可用现金覆盖，且目标市值至少达到一手成本；否则降低目标仓位或先卖出其他持仓。',
    '- 每次操作都要说明依据（引用你查到的具体数据）和判断失效的条件。',
    '- 最终必须只输出一个 JSON 数组（1~3 个动作），不要输出任何解释文字，格式：',
    '[{"action":"买入|加仓|减仓|卖出|持有","symbol":"6位代码或null","targetPct":目标仓位百分比数字,"reason":"依据","risk":"什么情况说明你判断错了"}]',
    '- 一天最多 3 个动作，且同一只股票只能出现一次；没有值得做的操作就输出单个「持有」。',
    '- targetPct 是执行后该股票占账户总资产的目标比例（0~100）。卖出填 0，持有填 0 并把 symbol 设为 null。',
    `- 你最多有 ${AGENT_LIMITS.maxRounds} 轮、共 ${AGENT_LIMITS.maxToolCalls} 次工具调用额度。请在第 ${AGENT_LIMITS.maxRounds} 轮内给出最终 JSON 结论；额度用完后系统会强制你直接作答。`,
      '- 每次工具调用都要花成本，请一次问准：不要重复查询同一个数据，也不要为了『多看一点』反复拉取。',
  ].join('\n');
}

export function buildUserPrompt({ date, account, marketNote = '' }) {
  const positions = (account?.positions || []).map((position) => `${position.name || ''}(${position.symbol}) ${position.quantity}股 成本${position.averagePrice} 现价${position.marketPrice} 市值${position.marketValue} 盈亏${(Number(position.profitRate || 0) * 100).toFixed(2)}%`).join('；');
  const cash = Math.max(0, Number(account?.cash) || 0);
  const totalAsset = Math.max(0, Number(account?.totalAsset) || 0);
  const cashPct = totalAsset > 0 ? ((cash / totalAsset) * 100).toFixed(1) : '0.0';
  return [
    `今天是 ${date}，收盘后的决策时间。`,
    `你的账户：总资产 ${totalAsset || '未知'} 元，可用现金 ${cash} 元（占总资产 ${cashPct}%），累计收益率 ${((Number(account?.profitRate) || 0) * 100).toFixed(2)}%。`,
    positions ? `当前持仓：${positions}` : '当前持仓：空仓。',
    `资金检查：任何买入/加仓都必须先按目标股实时价格计算一手成本；新增仓位资金不得超过可用现金与同日卖出/减仓预计回笼资金之和。资金不足时，优先安排卖出/减仓，或只保留可负担的计划。`,
    marketNote ? `补充信息：${marketNote}` : '',
    '请先用工具了解市场和你关心的标的，再给出下一交易日的计划。',
  ].filter(Boolean).join('\n');
}

// ── Agent 主循环 ───────────────────────────────────────────
/**
 * 运行一位大师的一次决策。
 * deps 可注入 { callLlm, runTool } 便于测试（默认走真实 LLM 与工具层）。
 */
export async function runMasterAgent({
  master,
  account,
  date,
  aiConfig,
  marketNote = '',
  deps = {},
  limits = AGENT_LIMITS,
} = {}) {
  if (!master) throw new Error('缺少 master');
  if (!aiConfig?.apiKey) throw new Error('未配置模型 API Key（服务端 DEEPSEEK_API_KEY 或用户 Key）');

  const ledgerState = getAgentLedger();
  if (ledgerState.remainingTokens <= 0) {
    throw new Error(`今日 token 预算已用尽（上限 ${DAILY_TOKEN_CAP}），为避免继续扣费已停止运行`);
  }

  const callLlm = deps.callLlm || defaultCallLlm;
  const runTool = deps.runTool || ((name, args) => executeMasterLeagueTool(name, args, { account }));
  const tools = listMasterLeagueToolSchemas();

  const messages = [
    { role: 'system', content: buildSystemPrompt(master) },
    { role: 'user', content: buildUserPrompt({ date, account, marketNote }) },
  ];

  const trace = [];
  const totals = { prompt_tokens: 0, completion_tokens: 0, prompt_cache_hit_tokens: 0 };
  let rounds = 0;
  let calls = 0;
  let toolCallCount = 0;
  let stopReason = '';
  let finalContent = '';

  while (rounds < limits.maxRounds && calls < limits.maxCallsPerRun) {
    rounds += 1;
    calls += 1;
    const response = await callLlm({ aiConfig, messages, tools, maxTokens: limits.maxTokensPerCall, timeoutMs: limits.callTimeoutMs });
    const usage = response?.usage || {};
    totals.prompt_tokens += Number(usage.prompt_tokens) || 0;
    totals.completion_tokens += Number(usage.completion_tokens) || 0;
    totals.prompt_cache_hit_tokens += Number(usage.prompt_cache_hit_tokens || usage.prompt_tokens_details?.cached_tokens) || 0;

    const message = response?.message || {};
    const toolCalls = message.tool_calls || [];
    messages.push({ role: 'assistant', content: message.content || '', tool_calls: toolCalls.length ? toolCalls : undefined });

    if (!toolCalls.length) {
      finalContent = message.content || '';
      stopReason = 'final';
      break;
    }

    for (const call of toolCalls) {
      if (toolCallCount >= limits.maxToolCalls) {
        // 必须先回一条 tool 消息，否则下一轮会因 tool_calls 未配对而报错
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: '工具调用额度已用完，请直接给出结论' }) });
        continue;
      }
      toolCallCount += 1;
      const name = call?.function?.name;
      let args = {};
      try {
        args = call?.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }
      let result;
      try {
        result = await runTool(name, args);
      } catch (error) {
        result = { error: error?.message || '工具执行失败' };
      }
      trace.push({ round: rounds, tool: name, args, result });
      messages.push({ role: 'tool', tool_call_id: call.id, content: stringifyToolResult(result) });
    }

    if (toolCallCount >= limits.maxToolCalls) {
      stopReason = 'tool_cap';
      break;
    }
    if (estimateCost(totals).totalTokens >= limits.maxRunTokens) {
      stopReason = 'token_cap';
      break;
    }
  }

  if (!stopReason) stopReason = 'round_cap';

  // 轮次/预算用尽但还没给结论时，强制收口一次（禁用工具），避免「烧了钱却没有决策」。
  if (!finalContent && ['round_cap', 'token_cap', 'tool_cap'].includes(stopReason)) {
    messages.push({
      role: 'user',
      content: '工具调用额度已用完。请立刻只输出最终 JSON 结论，不要再调用工具。',
    });
    try {
      const finalCall = await callLlm({
        aiConfig,
        messages,
        tools: [],            // 不再提供工具
        forceNoTools: true,
        maxTokens: Math.min(600, limits.maxTokensPerCall),
        timeoutMs: limits.callTimeoutMs,
      });
      calls += 1;
      const usage = finalCall?.usage || {};
      totals.prompt_tokens += Number(usage.prompt_tokens) || 0;
      totals.completion_tokens += Number(usage.completion_tokens) || 0;
      totals.prompt_cache_hit_tokens += Number(usage.prompt_cache_hit_tokens || usage.prompt_tokens_details?.cached_tokens) || 0;
      finalContent = finalCall?.message?.content || '';
      stopReason = 'forced_final';
    } catch (error) {
      stopReason = 'forced_final_failed';
    }
  }

  const usageSummary = estimateCost(totals);
  ledger.tokens += usageSummary.totalTokens;
  ledger.cost += usageSummary.cost;
  ledger.runs += 1;

  const parsed = parseDecisionPayload(finalContent);
  const validation = parsed.ok
    ? validateAgentDecisions(parsed.value)
    : { ok: false, errors: [parsed.error], decisions: [], decision: null };
  const funding = validation.ok
    ? applyFundingConstraints(validation.decisions, {
        account,
        priceHints: extractPriceHints(trace, account),
      })
    : { decisions: [], notes: [] };
  const decisions = funding.decisions;
  const validationWithFunding = {
    ...validation,
    decision: decisions[0] || null,
    decisions,
    fundingNotes: funding.notes,
  };

  return {
    masterId: master.id,
    masterName: master.name,
    date,
    model: aiConfig.model,
    stopReason,
    rounds,
    calls,
    toolCalls: toolCallCount,
    trace,
    rawFinal: finalContent.slice(0, 2000),
    decision: decisions[0] || null,
    decisions,
    validation: validationWithFunding,
    usage: usageSummary,
    ledger: getAgentLedger(),
  };
}

// 默认 LLM 调用：OpenAI 兼容 /chat/completions + tools。
// 网络抖动（本机 IPv6/代理场景常见）重试 2 次：只有「没拿到响应」才重试，
// HTTP 4xx（Key 无效、参数错误）不重试，避免无谓扣费。
async function defaultCallLlm(payload) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await callLlmOnce(payload);
    } catch (error) {
      lastError = error;
      const message = String(error?.message || '');
      if (/^模型服务错误：(4\d\d)/.test(message) || /API Key 无效/.test(message)) throw error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function callLlmOnce({ aiConfig, messages, tools, maxTokens, timeoutMs, forceNoTools = false }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const extra = forceNoTools || !tools?.length
      ? { temperature: 0.4 }              // 收口阶段：直接给结论，不再挂工具
      : { tools, tool_choice: 'auto', temperature: 0.7 };
    const body = buildProviderBody(aiConfig, messages, maxTokens, extra);
    const response = await fetch(resolveLlmUrl(aiConfig.baseUrl), {
      method: 'POST',
      headers: buildProviderHeaders(aiConfig),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail?.error?.message || `模型服务错误：${response.status}`);
    }
    const data = await response.json();
    return { message: data?.choices?.[0]?.message || {}, usage: data?.usage || {} };
  } finally {
    clearTimeout(timer);
  }
}

export const __test__ = { ledger, defaultCallLlm };
