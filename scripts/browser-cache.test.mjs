import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheStorageKey,
  marketAwareTtlMs,
  readJsonCache,
  stableHash,
  writeJsonCache,
} from '../src/lib/browserCache.mjs';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test('本地 JSON 缓存可读写并带过期时间', () => {
  const storage = memoryStorage();
  writeJsonCache('demo', 'a', { ok: true }, 60_000, storage);
  assert.deepEqual(readJsonCache('demo', 'a', storage)?.value, { ok: true });
  assert.equal(storage.getItem(cacheStorageKey('demo', 'a')).includes('expiresAt'), true);
  assert.equal(stableHash('a'), stableHash('a'));
});

test('行情缓存盘中 5 分钟、收盘后覆盖到下一交易窗口', () => {
  assert.equal(marketAwareTtlMs(new Date('2026-09-21T02:00:00Z').getTime()), 5 * 60 * 1000);
  const afterClose = marketAwareTtlMs(new Date('2026-09-21T08:00:00Z').getTime());
  assert.ok(afterClose > 13 * 60 * 60 * 1000);
  const weekend = marketAwareTtlMs(new Date('2026-09-19T04:00:00Z').getTime());
  assert.ok(weekend > 40 * 60 * 60 * 1000);
});
