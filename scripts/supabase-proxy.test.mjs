import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSupabaseUpstreamUrl } from '../src/lib/supabaseProxy.mjs';

test('Supabase 代理只拼接到固定项目域名并保留查询参数', () => {
  const url = buildSupabaseUpstreamUrl('https://example.supabase.co', ['auth', 'v1', 'token'], '?grant_type=password');
  assert.equal(url, 'https://example.supabase.co/auth/v1/token?grant_type=password');
});

test('Supabase 代理拒绝路径穿越和畸形路径', () => {
  assert.throws(() => buildSupabaseUpstreamUrl('https://example.supabase.co', ['auth', '..', 'secrets']));
  assert.throws(() => buildSupabaseUpstreamUrl('https://example.supabase.co', ['auth', 'v1', 'x/y']));
  assert.throws(() => buildSupabaseUpstreamUrl('not-a-url', ['auth', 'v1']));
});
