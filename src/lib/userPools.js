// src/lib/userPools.js —— 用户股票池统一存取：本地(localStorage) + 云端(Supabase) 双向同步
// 未登录：只读写本地；登录后：读写本地 + 同步到云端（RLS 保证只读自己的）。
'use client';

import { getSupabase, supabaseEnabled } from './supabaseClient';

const LS_KEY = 'thinktank_user_pools';

export function loadUserPoolsLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; }
}
export function saveUserPoolsLocal(pools) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(pools)); } catch (e) { /* ignore */ }
}

// 把一条 pool 写入 Supabase（upsert 按 id）
export async function upsertPoolServer(pool, userId) {
  if (!supabaseEnabled || !userId) return;
  const sb = getSupabase();
  if (!sb) return;
  const row = {
    id: pool.id,
    user_id: userId,
    name: pool.name,
    source: pool.source || '',
    created_at: pool.createdAt || new Date().toISOString().slice(0, 10),
    symbols: pool.symbols || [],
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('user_stock_pools').upsert(row, { onConflict: 'id' });
  if (error) console.warn('[userPools] upsert 失败', error.message);
}

export async function deletePoolServer(id, userId) {
  if (!supabaseEnabled || !userId) return;
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from('user_stock_pools').delete().eq('id', id);
  if (error) console.warn('[userPools] delete 失败', error.message);
}

// 从云端拉取当前用户全部股票池
export async function fetchPoolsServer(userId) {
  if (!supabaseEnabled || !userId) return [];
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from('user_stock_pools').select('*').order('created_at', { ascending: false });
  if (error) { console.warn('[userPools] fetch 失败', error.message); return []; }
  return (data || []).map((r) => ({
    id: r.id,
    name: r.name,
    source: r.source || '',
    createdAt: r.created_at || '',
    symbols: Array.isArray(r.symbols) ? r.symbols : [],
  }));
}

// 登录时：把本地池子合并上云（云端优先，本地缺失的池子补传上去）
export async function syncPoolsOnLogin(userId) {
  const local = loadUserPoolsLocal();
  const server = await fetchPoolsServer(userId);
  const serverIds = new Set(server.map((p) => p.id));
  // 云端有、本地没有的 → 补到本地（不覆盖本地已有同名）
  const localIds = new Set(local.map((p) => p.id));
  const merged = [...local];
  for (const sp of server) {
    if (!localIds.has(sp.id)) merged.push(sp);
  }
  const mergedIds = new Set(merged.map((p) => p.id));
  saveUserPoolsLocal(merged);
  // 本地有、云端没有的 → 补传上云
  for (const lp of local) {
    if (!serverIds.has(lp.id)) await upsertPoolServer(lp, userId);
  }
  return merged;
}
