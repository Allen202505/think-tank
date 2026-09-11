import test from 'node:test';
import assert from 'node:assert/strict';
import { readApiResponse } from '../src/lib/apiResponse.mjs';

test('parses a JSON API response', async () => {
  const res = new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  assert.deepEqual(await readApiResponse(res), { ok: true });
});

test('converts an HTML gateway page into a friendly error', async () => {
  const res = new Response('<!DOCTYPE html><html><body>Bad gateway</body></html>', {
    status: 502,
    headers: { 'Content-Type': 'text/html' },
  });
  await assert.rejects(() => readApiResponse(res), /分析服务暂时不可用/);
});

test('converts a text gateway error into a friendly error', async () => {
  const res = new Response('error code: 502', {
    status: 502,
    headers: { 'Content-Type': 'text/plain' },
  });
  await assert.rejects(() => readApiResponse(res), /分析服务暂时不可用/);
});

test('keeps valid JSON error payloads for the caller to handle', async () => {
  const res = new Response(JSON.stringify({ error: '暂时没有行情' }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' },
  });
  assert.deepEqual(await readApiResponse(res), { error: '暂时没有行情' });
});
