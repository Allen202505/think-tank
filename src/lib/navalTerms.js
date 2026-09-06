// 纳瓦尔知识学堂 · 词条（glossary）本机存取
// 词条结构：{ name, at, q?, content?, keyPoint? }；content 可选（点击后才按需生成并缓存）
const TERMS_KEY = 'thinktank_naval_terms';
const TERMS_MAX = 500;

export function loadTerms() {
  try { return JSON.parse(localStorage.getItem(TERMS_KEY) || '[]') || []; } catch (e) { return []; }
}
export function saveTerms(list) {
  try { localStorage.setItem(TERMS_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}
// 新增/去重/更新一个词条（同名替换，返回新数组）
export function upsertTerm(list, term) {
  return [term, ...(list || []).filter((t) => t.name !== term.name)].slice(0, TERMS_MAX);
}
// 更新某个词条内容（按名字）
export function updateTermContent(name, patch) {
  const list = loadTerms();
  const next = list.map((t) => (t.name === name ? { ...t, ...patch } : t));
  saveTerms(next);
  return next;
}
export function notifyTermsChanged() {
  window.dispatchEvent(new CustomEvent('thinktank:terms-changed'));
}

// 给词条添加一划线摘记（text 为该段原文）；若无该词条，则用 base 创建（带原文 content）
export function addTermHighlight(name, text, base = {}) {
  const list = loadTerms();
  const clean = String(text || '').trim();
  if (!clean || !name) return list;
  const existing = list.find((t) => t.name === name);
  const hs = (existing && Array.isArray(existing.highlights)) ? existing.highlights : [];
  if (hs.some((h) => h.text === clean)) return list; // 去重
  const newHs = [{ text: clean, at: Date.now() }, ...hs];
  const term = existing
    ? { ...existing, highlights: newHs }
    : { name, q: base.q || '', content: base.content || '', keyPoint: base.keyPoint || '', formula: base.formula || '', at: Date.now(), highlights: newHs };
  const next = [term, ...list.filter((t) => t.name !== name)].slice(0, TERMS_MAX);
  saveTerms(next);
  return next;
}


// ─── 云端同步（Supabase user_terms，每用户一行 JSONB） ───
import { getSupabase, supabaseEnabled } from './supabaseClient';

export function isTermCloudEnabled() {
  return supabaseEnabled;
}

export async function fetchTermsCloud(userId) {
  if (!supabaseEnabled || !userId) return null;
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb.from('user_terms').select('terms').eq('user_id', userId).maybeSingle();
    if (error) { console.warn('[navalTerms] fetch error', error.message); return null; }
    return Array.isArray(data?.terms) ? data.terms : null;
  } catch (e) { return null; }
}

export async function pushTermsCloud(userId, terms) {
  if (!supabaseEnabled || !userId) return;
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { error } = await sb.from('user_terms').upsert(
      { user_id: userId, terms: Array.isArray(terms) ? terms : [], updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
    if (error) console.warn('[navalTerms] push error', error.message);
  } catch (e) { /* ignore */ }
}

// 登录/查看词条库时：合并本地 + 云端，落本地，并把合并结果推上云
export async function syncTermsOnLogin(userId) {
  const local = loadTerms();
  const server = await fetchTermsCloud(userId);
  const localNames = new Set(local.map((t) => t.name));
  const merged = [...local];
  if (Array.isArray(server)) {
    for (const st of server) {
      if (st && st.name && !localNames.has(st.name)) merged.push(st);
    }
  }
  saveTerms(merged);
  await pushTermsCloud(userId, merged);
  return merged;
}
