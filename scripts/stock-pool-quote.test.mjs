import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeQuoteIntoBars,
  parseEastmoneyQuotePayload,
  quoteDateForMarket,
} from '../src/lib/stockPoolQuote.mjs';

const quotePayload = {
  data: {
    diff: [
      { f2: 1244.95, f3: -1.09, f12: '600519', f13: 1, f14: '贵州茅台', f18: 1258.62, f124: 1791424571 },
      { f2: 419.8, f3: -0.19, f12: '00700', f13: 116, f14: '腾讯控股', f18: 420.6, f124: 1791424573 },
    ],
  },
};

test('东财批量行情映射现价、昨收、涨跌与市场 secid', () => {
  const quotes = parseEastmoneyQuotePayload(quotePayload);
  assert.equal(quotes.length, 2);
  assert.deepEqual(quotes[0], {
    secid: '1.600519',
    symbol: '600519',
    name: '贵州茅台',
    price: 1244.95,
    prevClose: 1258.62,
    changePct: -1.09,
    quoteAt: 1791424571000,
    source: 'eastmoney-batch',
  });
  assert.equal(quotes[1].secid, '116.00700');
});

test('同一交易日实时价覆盖日 K 收盘价', () => {
  const bars = [
    { date: '2026-09-30', close: 1258.62 },
    { date: '2026-10-08', close: 1242.88 },
  ];
  const merged = mergeQuoteIntoBars(bars, {
    price: 1244.95,
    quoteAt: 1791424571000,
    source: 'eastmoney-batch',
  }, 'CN');
  assert.equal(merged.length, 2);
  assert.equal(merged[1].close, 1244.95);
  assert.equal(merged[1].isRealtimeQuote, true);
});

test('实时价进入新交易日时追加当日日线，现价不再停留在昨收', () => {
  const bars = [
    { date: '2026-09-29', close: 1235.58 },
    { date: '2026-09-30', close: 1258.62 },
  ];
  const merged = mergeQuoteIntoBars(bars, {
    price: 1244.95,
    quoteAt: 1791424571000,
  }, 'CN');
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.at(-1), {
    date: '2026-10-08',
    close: 1244.95,
    quoteAt: 1791424571000,
    isRealtimeQuote: true,
  });
});

test('报价偏离上限：串标的的实时价被忽略，指数不会被写成个股价格', () => {
  const indexBars = [
    { date: '2026-10-09', close: 3813.79 },
    { date: '2026-10-12', close: 3803.43 },
  ];
  const quote = { price: 11.76, quoteAt: 1791781617000, source: 'tencent' }; // 误映射成平安银行

  const guarded = mergeQuoteIntoBars(indexBars, quote, 'CN', { maxDeviation: 0.25 });
  assert.deepEqual(guarded, indexBars); // 原样返回日线，不合并错误价格

  const normal = mergeQuoteIntoBars(indexBars, { price: 3801.2, quoteAt: 1791781617000 }, 'CN', { maxDeviation: 0.25 });
  assert.equal(normal.at(-1).close, 3801.2);

  const unguarded = mergeQuoteIntoBars(indexBars, quote, 'CN'); // 不传上限时保持旧行为
  assert.equal(unguarded.at(-1).close, 11.76);
});

test('报价时间按交易市场时区归到正确交易日', () => {
  const utcMs = Date.parse('2026-10-07T20:30:00.000Z');
  assert.equal(quoteDateForMarket(utcMs, 'US'), '2026-10-07');
  assert.equal(quoteDateForMarket(utcMs, 'CN'), '2026-10-08');
});
