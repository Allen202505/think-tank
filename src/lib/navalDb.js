// 纳瓦尔的知识学堂 · 服务端 Supabase 存储助手（仅服务端路由使用）
// 说明：站点未配置 Supabase 或表缺失时，返回 { ok:false, local:true }，由前端走 localStorage 兜底。
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
export const navalDbEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let client = null;
function db() {
  if (!navalDbEnabled) return null;
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

// 上海时区今天的日期，格式 YYYY-MM-DD
export function shanghaiToday(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export async function listIssues() {
  const c = db();
  if (!c) return { ok: false, local: true };
  try {
    const { data, error } = await c
      .from('daily_knowledge_issues')
      .select('issue_date, issue_label, title, quiz_question, source, created_at')
      .order('issue_date', { ascending: false })
      .limit(300);
    if (error) return { ok: false, error: error.message };
    return { ok: true, issues: data || [] };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

export async function getIssue(date) {
  const c = db();
  if (!c) return { ok: false, local: true };
  try {
    const { data, error } = await c
      .from('daily_knowledge_issues')
      .select('*')
      .eq('issue_date', date)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, issue: data || null };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// 插入今日期数（RLS 只允许当天；重复插入静默忽略）
export async function insertIssue(issue) {
  const c = db();
  if (!c) return { ok: false, local: true };
  try {
    const { error } = await c
      .from('daily_knowledge_issues')
      .insert(issue, { ignoreDuplicates: true });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// 汇总所有期数已覆盖的指标/主题
export async function allCoveredTopics() {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c.from('daily_knowledge_issues').select('covered_topics');
    if (error) return [];
    const set = new Set();
    for (const row of data || []) {
      for (const t of row.covered_topics || []) set.add(String(t).trim());
    }
    return [...set].filter(Boolean);
  } catch (e) {
    return [];
  }
}
