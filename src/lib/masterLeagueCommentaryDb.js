// AI 互评的持久化（仅服务端）。让「服务器重启/多实例」不再丢失当天的点评。
//  读：优先 service role；没有则用 anon key（该表对匿名只读开放）
//  写：必须 service role（RLS 不给匿名/登录用户写权限）
//  未配置时静默返回空/未持久化，页面继续走内存缓存 + 预置文案。
import { createClient } from '@supabase/supabase-js';

const COMPETITION_ID = 'public-2026-09-14';

let writeClient;
let readClient;

function url() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || '';
}

export function getCommentaryWriteClient() {
  if (writeClient !== undefined) return writeClient;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url() || !serviceKey) { writeClient = null; return null; }
  writeClient = createClient(url(), serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return writeClient;
}

export function getCommentaryReadClient() {
  if (readClient !== undefined) return readClient;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url() || !anonKey) { readClient = null; return null; }
  readClient = createClient(url(), anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return readClient;
}

function rowToPayload(row) {
  if (!row) return null;
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    masterId: row.target_master_id,
    date: row.commentary_date,
    persistedAt: row.updated_at,
  };
}

// 读一位（masterId）或全部（masterId 省略）当天的互评
export async function loadCommentaryFromDb(date, masterId = '') {
  const db = getCommentaryWriteClient() || getCommentaryReadClient();
  if (!db) return masterId ? null : {};
  try {
    let query = db.from('master_league_commentary').select('*').eq('commentary_date', date);
    if (masterId) query = query.eq('target_master_id', masterId);
    const { data, error } = await query;
    if (error) return masterId ? null : {};
    if (masterId) return rowToPayload((data || [])[0]);
    return Object.fromEntries((data || []).map((row) => [row.target_master_id, rowToPayload(row)]));
  } catch {
    return masterId ? null : {};
  }
}

export async function saveCommentaryToDb({ date, masterId, payload, model = '', cost = 0 }) {
  const db = getCommentaryWriteClient();
  if (!db) return { enabled: false, reason: 'missing_service_role' };
  const row = {
    id: `${date}:${masterId}`,
    competition_id: COMPETITION_ID,
    commentary_date: date,
    target_master_id: masterId,
    payload,
    model: model || null,
    cost: Number(cost) || 0,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from('master_league_commentary').upsert(row, { onConflict: 'id' });
  if (error) return { enabled: false, reason: error.message };
  return { enabled: true, source: 'database' };
}
