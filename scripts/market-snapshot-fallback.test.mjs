import test from 'node:test';
import assert from 'node:assert/strict';

function tencentLine(symbol, name, code, price, changePct) {
  const fields = Array(88).fill('');
  Object.assign(fields, {
    1: name,
    2: code,
    3: String(price),
    4: String(price),
    5: String(price),
    6: '100',
    31: '1.00',
    32: String(changePct),
    33: String(price),
    34: String(price),
    35: `${price}/100/1000000`,
    37: '100',
    38: '1.2',
    44: '100',
    45: '120',
    46: '2.5',
    52: '15',
  });
  return `v_${symbol}="${fields.join('~')}";`;
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.includes('push2.eastmoney.com')) return new Response('bad gateway', { status: 502 });
  if (target.includes('qt.gtimg.cn/q=sh600519')) {
    return new Response(tencentLine('sh600519', 'Moutai', '600519', 1245.5, -1.04));
  }
  if (target.includes('qt.gtimg.cn/q=sh000001')) {
    return new Response([
      tencentLine('sh000001', 'SSE', '000001', 3823.39, -0.49),
      tencentLine('sz399001', 'SZSE', '399001', 12683.03, -1.59),
      tencentLine('sz399006', 'ChiNext', '399006', 3052.17, -2.65),
    ].join(''));
  }
  throw new Error(`unexpected fetch: ${target}`);
};

const { fetchIndexSummary, fetchStockQuote } = await import('../src/lib/marketSnapshot.mjs');

test('东财 push2 不可用时，单股快照回退腾讯行情', async () => {
  const quote = await fetchStockQuote('600519');
  assert.equal(quote.source, 'tencent');
  assert.equal(quote.name, 'Moutai');
  assert.equal(quote.price, 1245.5);
  assert.equal(quote.changePct, -1.04);
});

test('东财 push2 不可用时，指数摘要回退腾讯行情', async () => {
  const rows = await fetchIndexSummary();
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.name), ['SSE', 'SZSE', 'ChiNext']);
  assert.equal(rows[0].price, 3823.39);
  assert.equal(rows[2].changePct, -2.65);
});

test.after(() => { globalThis.fetch = originalFetch; });
