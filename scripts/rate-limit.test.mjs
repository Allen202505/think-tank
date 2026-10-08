import test from 'node:test';
import assert from 'node:assert/strict';
import { getClientIp } from '../src/lib/rateLimit.js';

test('限流优先使用 Cloudflare 真实客户端 IP，避免伪造 X-Forwarded-For', () => {
  const request = new Request('https://example.com', {
    headers: {
      'cf-connecting-ip': '203.0.113.9',
      'x-real-ip': '198.51.100.8',
      'x-forwarded-for': '10.0.0.1, 198.51.100.8',
    },
  });
  assert.equal(getClientIp(request), '203.0.113.9');
});

test('无 Cloudflare 头时回退 X-Real-IP 和 X-Forwarded-For', () => {
  assert.equal(getClientIp(new Request('https://example.com', { headers: { 'x-real-ip': '198.51.100.8' } })), '198.51.100.8');
  assert.equal(getClientIp(new Request('https://example.com', { headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' } })), '198.51.100.7');
});
