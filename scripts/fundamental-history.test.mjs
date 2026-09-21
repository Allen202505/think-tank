import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addFundamentalHistoryEntry,
  findRecentFundamentalHistory,
  fundamentalHistoryKey,
  groupFundamentalHistoryByStock,
  normalizeFundamentalHistory,
} from '../src/lib/fundamentalHistory.mjs';

function entry(id, at, symbol, stockName, total = 80) {
  return {
    id,
    at,
    symbol,
    stockName,
    note: `${stockName}备注`,
    result: { stock: { symbol, name: stockName }, stockName, total },
  };
}

test('基础面历史记录按股票归档并按时间倒序', () => {
  const list = normalizeFundamentalHistory([
    entry('a-1', '2026-09-20T08:00:00.000Z', '600519', '贵州茅台', 75),
    entry('b-1', '2026-09-21T08:00:00.000Z', '000858', '五粮液', 82),
    entry('a-2', '2026-09-21T09:00:00.000Z', '600519', '贵州茅台', 88),
  ]);
  assert.equal(list.length, 3);
  assert.equal(fundamentalHistoryKey(list[0]), '600519');
  assert.equal(list[0].id, 'a-2');
  const groups = groupFundamentalHistoryByStock(list);
  assert.equal(groups.length, 2);
  assert.equal(groups.find((group) => group.key === '600519').records.length, 2);
  assert.equal(groups[0].key, '600519');
});

test('新增基础面历史最多保留 30 条', () => {
  let history = [];
  for (let index = 0; index < 35; index += 1) {
    history = addFundamentalHistoryEntry(history, entry(`id-${index}`, `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`, '600519', '贵州茅台'));
  }
  assert.equal(history.length, 30);
  assert.equal(history[0].id, 'id-34');
});

test('再次查询同一股票时追加一条新的历史记录', () => {
  const first = addFundamentalHistoryEntry([], entry('old', '2026-09-20T08:00:00.000Z', '000707', '双环科技', 51.2));
  const next = addFundamentalHistoryEntry(first, entry('new', '2026-09-21T12:00:00.000Z', '000707', '双环科技', 66.5));
  assert.equal(next.length, 2);
  assert.deepEqual(next.map((item) => item.id), ['new', 'old']);
});

test('七天内的同股票查询可直接命中本地历史记录', () => {
  const now = new Date('2026-09-21T12:00:00.000Z').getTime();
  const history = [
    entry('recent', '2026-09-18T12:00:00.000Z', '000707', '双环科技', 66.5),
    entry('expired', '2026-09-10T12:00:00.000Z', '600519', '贵州茅台', 80),
  ];
  assert.equal(findRecentFundamentalHistory(history, '双环科技', now)?.id, 'recent');
  assert.equal(findRecentFundamentalHistory(history, '000707', now)?.id, 'recent');
  assert.equal(findRecentFundamentalHistory(history, '贵州茅台', now), null);
  assert.equal(findRecentFundamentalHistory(history, '中钢国际', now), null);
});
