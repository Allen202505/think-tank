import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMarketBreadthStats } from '../src/lib/marketBreadth.mjs';

const history = {
  startDate: '2026-01-01',
  endDate: '2026-01-04',
  universeCount: 5223,
  source: 'test',
  methodology: 'test',
  days: [
    { date: '2026-01-01', up: 100, down: 5001, flat: 5, total: 5106, indexChangePct: -2 },
    { date: '2026-01-02', up: 500, down: 4001, flat: 5, total: 4506, indexChangePct: -1 },
    { date: '2026-01-03', up: 1200, down: 3001, flat: 5, total: 4206, indexChangePct: -0.5 },
    { date: '2026-01-04', up: 1500, down: 2999, flat: 5, total: 4504, indexChangePct: 0.1 },
  ],
};

test('统计区间内下跌家数阈值、分布桶和排名', () => {
  const result = computeMarketBreadthStats(history, {
    range: 'custom',
    startDate: '2026-01-01',
    endDate: '2026-01-04',
    now: new Date('2026-01-05T00:00:00Z'),
  });
  assert.equal(result.range.tradingDays, 4);
  assert.deepEqual(result.thresholds.map((row) => [row.threshold, row.count]), [[5000, 1], [4000, 2], [3000, 3]]);
  assert.deepEqual(result.buckets.map((row) => [row.id, row.count]), [
    ['lt1000', 0], ['1000', 0], ['2000', 1], ['3000', 1], ['4000', 1], ['5000', 1],
  ]);
  assert.equal(result.latest.down, 2999);
  assert.equal(result.ranks.downCount.rank, 4);
  assert.equal(result.ranks.indexDecline.rank, 4);
  assert.equal(result.latest.isLatestTradingDay, true);
});

test('自定义截止日排名按所选区间计算', () => {
  const result = computeMarketBreadthStats(history, {
    range: 'custom',
    startDate: '2026-01-01',
    endDate: '2026-01-01',
    now: new Date('2026-01-05T00:00:00Z'),
  });
  assert.equal(result.latest.down, 5001);
  assert.equal(result.ranks.downCount.rank, 1);
  assert.equal(result.ranks.indexDecline.rank, 1);
  assert.equal(result.latest.isLatestTradingDay, false);
});


test('今天、昨天只统计最近一个交易日，近7天按自然日过滤', () => {
  const extended = {
    ...history,
    days: [
      { date: '2026-01-01', up: 100, down: 5001, flat: 5, total: 5106, indexChangePct: -2 },
      { date: '2026-01-02', up: 500, down: 4001, flat: 5, total: 4506, indexChangePct: -1 },
      { date: '2026-01-05', up: 1200, down: 3001, flat: 5, total: 4206, indexChangePct: -0.5 },
    ],
    endDate: '2026-01-05',
  };
  const today = computeMarketBreadthStats(extended, { range: 'today', now: new Date('2026-01-05T12:00:00+08:00') });
  const yesterday = computeMarketBreadthStats(extended, { range: 'yesterday', now: new Date('2026-01-05T12:00:00+08:00') });
  const week = computeMarketBreadthStats(extended, { range: '7d', now: new Date('2026-01-05T12:00:00+08:00') });
  assert.equal(today.range.tradingDays, 1);
  assert.equal(today.latest.date, '2026-01-05');
  assert.equal(yesterday.latest.date, '2026-01-02');
  assert.equal(week.range.tradingDays, 3);
  assert.equal(week.range.startDate, '2026-01-01');
});
