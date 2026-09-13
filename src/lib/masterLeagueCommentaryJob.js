// AI 互评的「生成任务」编排（仅服务端）：
// 拉当天联赛账户 → 组装每位大师的上下文 → 调模型生成 → 落库 + 内存缓存。
// 被两个入口复用：站长手动 POST /api/master-league/commentary，以及收盘定时任务 /api/cron/master-league-commentary。
import { LEAGUE_MASTERS, PUBLIC_LEAGUE } from '../data/masterLeague.js';
import { generateMasterCommentary, readCommentaryCache, writeCommentaryCache } from './masterLeagueCommentary.mjs';
import { saveCommentaryToDb } from './masterLeagueCommentaryDb.js';
import { buildMarketOverview, fetchIndustryBoards, fetchIndexSummary } from './marketSnapshot.mjs';
import { resolveAiConfig } from './llm.js';
import { getAgentLedger } from './masterLeagueAgent.mjs';

// 判断是否周末（只看日期本身，不受服务器时区影响）
export function isWeekendDate(date) {
  const [year, month, day] = String(date || '').split('-').map(Number);
  if (!year || !month || !day) return false;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function todayShanghai() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 该大师「今天」的操作：优先待执行计划，否则取最新决策日
function todayDecisions(account) {
  const decisions = account?.decisions || [];
  const pending = decisions.filter((item) => item.status === 'pending');
  if (pending.length) return pending.slice(0, 4);
  const latest = decisions[0]?.decisionDate || '';
  return decisions.filter((item) => item.decisionDate === latest).slice(0, 4);
}

function performanceLine(account, ranking = []) {
  if (!account) return '';
  const row = ranking.find((item) => (item.account?.id || item.id) === account.id);
  const rate = ((Number(account.profitRate) || 0) * 100).toFixed(2);
  const holdings = (account.positions || []).map((position) => `${position.name} ${position.quantity}股`).join('、');
  return `累计收益 ${rate}%，当前第 ${row?.rank || '?'} 名${holdings ? `；持仓：${holdings}` : '；当前空仓'}`;
}

export async function buildMarketLine() {
  try {
    const [boards, indices] = await Promise.all([fetchIndustryBoards(), fetchIndexSummary()]);
    const overview = buildMarketOverview({ boards, indices });
    const index = indices[0];
    return [
      index ? `${index.name} ${Number(index.changePct).toFixed(2)}%` : '',
      `行业 ${overview.breadth.risingBoards} 涨 / ${overview.breadth.fallingBoards} 跌`,
      overview.hottestIndustries[0] ? `最强板块 ${overview.hottestIndustries[0].name}（${Number(overview.hottestIndustries[0].changePct).toFixed(2)}%）` : '',
      overview.weakestIndustries[0] ? `最弱板块 ${overview.weakestIndustries[0].name}（${Number(overview.weakestIndustries[0].changePct).toFixed(2)}%）` : '',
    ].filter(Boolean).join('，');
  } catch {
    return '';
  }
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
 * 生成并持久化互评。
 * masterIds 为空时生成全部六位；force=false 时优先复用内存缓存与数据库里已有的当天结果。
 */
export async function runCommentaryJob({ origin, date = todayShanghai(), masterIds = [], force = false } = {}) {
  const aiConfig = resolveAiConfig(null);
  if (!aiConfig.apiKey) return { ok: false, error: '服务端未配置 DEEPSEEK_API_KEY' };

  const wanted = masterIds.length ? masterIds : LEAGUE_MASTERS.map((master) => master.id);
  const targets = LEAGUE_MASTERS.filter((master) => wanted.includes(master.id));
  if (!targets.length) return { ok: false, error: `未知大师：${wanted.join(',')}` };

  const [{ accounts, ranking }, market] = await Promise.all([
    loadLeague(origin),
    buildMarketLine(),
  ]);

  const results = [];
  for (const target of targets) {
    const account = accounts.find((item) => item.id === target.id);
    try {
      const payload = await generateMasterCommentary({
        target,
        allMasters: LEAGUE_MASTERS,
        decisions: todayDecisions(account),
        positions: account?.positions || [],
        performance: performanceLine(account, ranking),
        market,
        aiConfig,
        date,
        force,
      });
      if (!payload.cached) {
        // 落库（没有 service role 时静默跳过，内存缓存仍然有效）
        writeCommentaryCache(date, target.id, payload);
        const saved = await saveCommentaryToDb({ date, masterId: target.id, payload, model: aiConfig.model, cost: payload.usage?.cost || 0 });
        payload.persistence = saved;
      }
      results.push({ masterId: target.id, ok: true, cached: Boolean(payload.cached), comments: payload.comments, usage: payload.usage, errors: payload.errors, persistence: payload.persistence });
    } catch (error) {
      results.push({ masterId: target.id, ok: false, error: error?.message || '生成失败' });
    }
  }

  const spent = results.reduce((sum, item) => sum + (item.usage?.cost || 0), 0);
  return {
    ok: results.some((item) => item.ok),
    date,
    competition: PUBLIC_LEAGUE.id,
    spent: Math.round(spent * 1e6) / 1e6,
    ledger: getAgentLedger(),
    results,
  };
}

export { readCommentaryCache };
