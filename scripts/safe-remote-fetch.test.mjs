import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPublicHostname,
  fetchPublicBuffer,
  isPrivateNetworkHost,
  normalizePublicHttpUrl,
} from '../src/lib/safeRemoteFetch.mjs';

test('公开链接抓取拦截本机、内网、云元数据和危险协议', () => {
  for (const host of ['localhost', '127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.2', '::1', 'fd00::1']) {
    assert.equal(isPrivateNetworkHost(host), true, host);
  }
  assert.equal(isPrivateNetworkHost('example.com'), false);
  assert.throws(() => normalizePublicHttpUrl('file:///etc/passwd'));
  assert.throws(() => normalizePublicHttpUrl('http://127.0.0.1/'), /内网或本机/);
});

test('DNS 解析到内网地址时拒绝抓取', async () => {
  await assert.rejects(
    () => assertPublicHostname('evil.example', { lookupFn: async () => [{ address: '10.0.0.8', family: 4 }] }),
    /内网地址/,
  );
});

test('公开链接抓取按上限读取并阻止重定向到内网', async () => {
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const ok = await fetchPublicBuffer('https://example.com/article', {
    lookupFn: publicLookup,
    maxBytes: 32,
    fetchImpl: async () => new Response('hello world', { status: 200, headers: { 'content-type': 'text/plain' } }),
  });
  assert.equal(ok.text ?? ok.body.toString('utf8'), 'hello world');

  await assert.rejects(
    () => fetchPublicBuffer('https://example.com/redirect', {
      lookupFn: publicLookup,
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
    }),
    /内网或本机/,
  );
});
