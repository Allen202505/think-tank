import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePoolFreezeCount, removeSymbolFromPool } from '../src/lib/stockPoolUi.mjs';

test('我的股票池可从池内移除单只股票且保留其他标的顺序', () => {
  const pool = { id: 'mine', name: '我的股票池', symbols: ['600519', '000858', '300750'] };
  const next = removeSymbolFromPool(pool, '000858');
  assert.deepEqual(next.symbols, ['600519', '300750']);
  assert.deepEqual(pool.symbols, ['600519', '000858', '300750']);
  assert.equal(removeSymbolFromPool(pool, '601318'), pool);
});

test('冻结列数量可配置并限制在 0-5 列', () => {
  assert.equal(normalizePoolFreezeCount('0'), 0);
  assert.equal(normalizePoolFreezeCount('3'), 3);
  assert.equal(normalizePoolFreezeCount(99), 5);
  assert.equal(normalizePoolFreezeCount(-2), 0);
  assert.equal(normalizePoolFreezeCount('bad'), 2);
});
