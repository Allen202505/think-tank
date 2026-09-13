// AI 生成的大师决策：读写封装（仅服务端）。
// 读：service role 优先，退化为 anon（该表匿名只读）；写：必须 service role。
import { createClient } from '@supabase/supabase-js';

const COMPETITION_ID = 'public-2026-09-14';
let writeClient;
let readClient;

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL || '';

export function resetPlansWriteClient() {
  writeClient = undefined;
}

export function getPlansWriteClient() {
  if (writeClient !== undefined) return writeClient;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  writeClient = url() && key ? createClient(url(), key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return writeClient;
}

export function getPlansReadClient() {
  if (readClient !== undefined) return readClient;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  readClient = url() && key ? createClient(url(), key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return readClient;
}

export function planRowToPlan(row) {
  return {
    id: row.id,
    masterId: row.master_id,
    planDate: row.plan_date,
    executeDate: row.execute_date,
    action: row.action,
    symbol: row.symbol || '',
    stockName: row.stock_name || '',
    targetPct: Number(row.target_pct) || 0,
    reason: row.reason || '',
    risk: row.risk || '',
    source: row.metadata?.source || 'ai',
    model: row.model || '',
    status: row.status || 'pending',
    createdAt: row.created_at,
  };
}

// 读取某比赛的全部 AI 计划（默认最近 N 天，避免越长越慢）
export async function loadPlansFromDb({ competitionId = COMPETITION_ID, sinceDays = 60 } = {}) {
  const db = getPlansWriteClient() || getPlansReadClient();
  if (!db) return [];
  try {
    let query = db.from('master_league_plans').select('*').eq('competition_id', competitionId);
    if (sinceDays) {
      const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
      query = query.gte('plan_date', since);
    }
    const { data, error } = await query.order('plan_date', { ascending: true });
    if (error) return [];
    return (data || []).map(planRowToPlan);
  } catch {
    return [];
  }
}

// 本机/服务器到 Supabase 偶发网络抖动（TypeError: fetch failed），写库失败重试一次
// 网络抖动（TypeError: fetch failed）时重建客户端再试：
// supabase-js 会复用底层连接，坏连接不重建会一直失败。
async function withRetry(fn, attempts = 3, delayMs = 1000) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      resetPlansWriteClient();
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
    }
  }
  throw last;
}

// 并发写库会把连接挤爆（实测 6 路并发时一半报 TypeError: fetch failed）：
// 生成保持并行，写库统一排队，一次只写一条。
let writeQueue = Promise.resolve();
function enqueue(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}

export function savePlansToDb(args) {
  return enqueue(() => savePlansToDbNow(args));
}

async function savePlansToDbNow({ competitionId = COMPETITION_ID, masterId, planDate, executeDate, decisions, model = '', cost = 0, metadata = {} }) {
  const db = getPlansWriteClient();
  if (!db) return { enabled: false, reason: 'missing_service_role' };

  // 同一大师同一天先清后写，保证「当天只有一组计划」
  let del;
  try {
    del = await withRetry(() => getPlansWriteClient().from('master_league_plans').delete().eq('competition_id', competitionId).eq('master_id', masterId).eq('plan_date', planDate));
  } catch (error) {
    return { enabled: false, reason: error?.message || 'delete failed' };
  }
  if (del.error) return { enabled: false, reason: del.error.message };

  const rows = (decisions || []).map((decision, index) => ({
    id: `${planDate}:${masterId}:${index}`,
    competition_id: competitionId,
    master_id: masterId,
    plan_date: planDate,
    execute_date: executeDate || null,
    action: decision.action,
    symbol: decision.symbol || null,
    stock_name: decision.stockName || null,
    target_pct: decision.targetPct ?? null,
    reason: decision.reason || '',
    risk: decision.risk || '',
    model: model || null,
    cost: Number(cost) || 0,
    status: 'pending',
    metadata: { ...metadata, index },
    updated_at: new Date().toISOString(),
  }));
  if (!rows.length) return { enabled: true, saved: 0 };
  try {
    const { error } = await withRetry(() => getPlansWriteClient().from('master_league_plans').upsert(rows, { onConflict: 'id' }));
    if (error) return { enabled: false, reason: error.message };
    return { enabled: true, saved: rows.length };
  } catch (error) {
    return { enabled: false, reason: error?.message || 'upsert failed' };
  }
}
