import 'server-only';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { normalizeShareDraft } from './shareResults.mjs';

const SHARE_ID_RE = /^[A-Za-z0-9_-]{20,64}$/;
const devStore = globalThis.__thinkTankShareResults ||= new Map();

function dbConfig() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  };
}

function getAdminClient() {
  // 本地开发直接使用进程内快照，避免因为本机网络无法访问 Supabase 阻塞页面；
  // 生产环境始终走 Supabase service_role 持久化。
  if (process.env.NODE_ENV !== 'production') return null;
  const { url, serviceKey } = dbConfig();
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isMissingTable(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42P01' || code === 'PGRST205' || /share_results.*(does not exist|not found)/i.test(message);
}

function isDevFallbackAvailable() {
  return process.env.NODE_ENV !== 'production';
}

function isNetworkError(error) {
  const message = String(error?.message || error || '');
  return error?.name === 'TypeError' && /fetch failed|network|connection|socket|econn/i.test(message);
}

export function shareResultsDbEnabled() {
  const { url, serviceKey } = dbConfig();
  return Boolean(url && serviceKey);
}

export function isShareId(value) {
  return SHARE_ID_RE.test(String(value || ''));
}

export async function createShareResult(draft) {
  const normalized = normalizeShareDraft(draft);
  if (!normalized.ok) return normalized;

  const id = randomBytes(18).toString('base64url').slice(0, 24);
  const row = {
    id,
    kind: normalized.value.kind,
    title: normalized.value.title,
    payload: normalized.value.payload,
  };

  const client = getAdminClient();
  if (!client) {
    if (isDevFallbackAvailable()) {
      devStore.set(id, { ...row, created_at: new Date().toISOString() });
      return { ok: true, value: { id } };
    }
    return { ok: false, code: 'not_configured', error: '分享服务尚未配置' };
  }

  const { error } = await client.from('share_results').insert(row);
  if (!error) return { ok: true, value: { id } };

  if (isDevFallbackAvailable()) {
    devStore.set(id, { ...row, created_at: new Date().toISOString() });
    return { ok: true, value: { id } };
  }
  if (isMissingTable(error) || isNetworkError(error)) {
    return { ok: false, code: 'db_not_ready', error: '分享服务尚未初始化' };
  }
  console.error('[share-results] create failed:', error?.message || error);
  return { ok: false, code: 'db_error', error: '分享链接生成失败，请稍后重试' };
}

export async function getShareResult(id) {
  const shareId = String(id || '');
  if (!isShareId(shareId)) return { ok: false, code: 'not_found' };

  const client = getAdminClient();
  if (!client) {
    if (isDevFallbackAvailable() && devStore.has(shareId)) {
      return { ok: true, value: devStore.get(shareId) };
    }
    return { ok: false, code: 'not_configured' };
  }

  const { data, error } = await client
    .from('share_results')
    .select('id, kind, title, payload, created_at')
    .eq('id', shareId)
    .maybeSingle();

  if (!error && data) return { ok: true, value: data };
  if (!error) {
    if (isDevFallbackAvailable() && devStore.has(shareId)) return { ok: true, value: devStore.get(shareId) };
    return { ok: false, code: 'not_found' };
  }
  if (isDevFallbackAvailable() && devStore.has(shareId)) {
    return { ok: true, value: devStore.get(shareId) };
  }
  if (isMissingTable(error) || isNetworkError(error)) return { ok: false, code: 'db_not_ready' };

  console.error('[share-results] read failed:', error?.message || error);
  return { ok: false, code: 'db_error' };
}
