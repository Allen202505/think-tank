// 大师每日决策任务（仅服务端）：收盘后为每位大师生成下一交易日的操作计划。
// 与「互评」的区别：这里生成的是大师自己的意图，会真正驱动结算引擎执行。
import { LEAGUE_MASTERS } from '../data/masterLeague.js';
import { runMasterAgent } from './masterLeagueAgent.mjs';
import { savePlansToDb } from './masterLeaguePlansDb.js';
import { resolveAiConfig } from './llm.js';
import { getAgentLedger } from './masterLeagueAgent.mjs';
import { buildMarketLine, isWeekendDate, todayShanghai } from './masterLeagueCommentaryJob.js';
import { fetchStockHistory, fetchStockQuote } from './marketSnapshot.mjs';

// 下一交易日：用上证指数日线里的下一个日期（今天之后的第一根 K 线）
async function nextTradeDate(date) {
  try {
    const { bars } = await fetchStockHistory('000001', 30);
    const next = (bars || []).map((bar) => bar.date).find((item) => item > date);
    return next || '';
  } catch {
    return '';
  }
}

function historyNote(account) {
  const done = (account?.decisions || []).filter((item) => item.status !== 'pending').slice(0, 5);
  if (!done.length) return '';
  const lines = done.map((item) => {
    const price = item.executionPrice ? `执行价 ${item.executionPrice}` : '未成交';
    const note = item.note ? `（${item.note}）` : '';
    return `${item.decisionDate || ''} ${item.action} ${item.stockName || ''} ${price}${note}`;
  });
  return `你最近的操作：${lines.join('；')}`;
}

function performanceLine(account, ranking = []) {
  if (!account) return '';
  const row = ranking.find((item) => (item.account?.id || item.id) === account.id);
  const rate = ((Number(account.profitRate) || 0) * 100).toFixed(2);
  const holdings = (account.positions || []).map((position) => `${position.name} ${position.quantity}股（浮动 ${(Number(position.profitRate || 0) * 100).toFixed(2)}%）`).join('、');
  return `累计收益 ${rate}%，当前第 ${row?.rank || '?'} 名${holdings ? `；持仓：${holdings}` : '；当前空仓'}`;
}

async function loadLeague(origin) {
  try {
    const response = await fetch(`${origin}/api/master-league`, { cache: 'no-store' });
    const payload = await response.json();
    return { accounts: payload?.data?.accounts || [], ranking: payload?.data?.ranking || [] };
  } catch {
    return { accounts: [], ranking: [] };
  }
}

/**
 * 生成并落库六位大师的下一交易日计划。
 * masterIds 为空则全部；force=true 时即便当天已生成也重跑。
 */
export async function runDecisionJob({ origin, date = todayShanghai(), masterIds = [], force = false, save = true } = {}) {
  if (isWeekendDate(date)) return { ok: true, skipped: true, reason: '周末不开市', date };

  const aiConfig = resolveAiConfig(null);
  if (!aiConfig.apiKey) return { ok: false, error: '服务端未配置 DEEPSEEK_API_KEY' };

  const wanted = masterIds.length ? masterIds : LEAGUE_MASTERS.map((master) => master.id);
  const targets = LEAGUE_MASTERS.filter((master) => wanted.includes(master.id));
  if (!targets.length) return { ok: false, error: `未知大师：${wanted.join(',')}` };

  const [{ accounts, ranking }, market, executeDate] = await Promise.all([
    loadLeague(origin),
    buildMarketLine(),
    nextTradeDate(date),
  ]);

  const concurrency = Math.max(1, Math.min(6, Number(process.env.MASTER_LEAGUE_JOB_CONCURRENCY) || 6));
  const chunks = [];
  for (let i = 0; i < targets.length; i += concurrency) chunks.push(targets.slice(i, i + concurrency));

  const results = [];
  for (const chunk of chunks) {
    // 一批并行，批间串行：既能把 4 分钟压到 1 分多，又不会一次打出几十个外部请求
    const chunkResults = await Promise.all(chunk.map(async (target) => {
    const account = accounts.find((item) => item.id === target.id);
    try {
      const run = await runMasterAgent({
        master: target,
        account,
        date,
        aiConfig,
        marketNote: [market, performanceLine(account, ranking), historyNote(account)].filter(Boolean).join('\n'),
      });
      if (!run.decision) {
        return { masterId: target.id, ok: false, error: run.validation?.errors?.join('；') || '没有产出合格决策', usage: run.usage };
      }
      // 补上股票名（引擎和 UI 都要用），行情查不到就留空由引擎标记未执行
      const decisions = [];
      for (const decision of run.decisions) {
        let stockName = '';
        if (decision.symbol) {
          try {
            const quote = await fetchStockQuote(decision.symbol);
            stockName = quote?.name || '';
          } catch { /* 名字取不到不影响计划 */ }
        }
        decisions.push({ ...decision, stockName });
      }
      const persistence = save
        ? await savePlansToDb({ masterId: target.id, planDate: date, executeDate, decisions, model: aiConfig.model, cost: run.usage?.cost || 0, metadata: { source: 'ai', rounds: run.rounds, toolCalls: run.toolCalls, stopReason: run.stopReason } })
        : { enabled: false, reason: 'save_disabled' };
      return { masterId: target.id, ok: true, executeDate, decisions, usage: run.usage, rounds: run.rounds, toolCalls: run.toolCalls, stopReason: run.stopReason, persistence };
    } catch (error) {
      return { masterId: target.id, ok: false, error: error?.message || '生成失败' };
    }
    }));
    results.push(...chunkResults);
  }

  const spent = results.reduce((sum, item) => sum + (item.usage?.cost || 0), 0);
  return {
    ok: results.some((item) => item.ok),
    date,
    executeDate,
    spent: Math.round(spent * 1e6) / 1e6,
    ledger: getAgentLedger(),
    results,
  };
}
