import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTencentQuote, tencentPrefixForCode } from '../src/lib/tencentQuote.mjs';
import { getMarketOverview, getQuote } from '../src/app/api/chat/marketData.js';

function quoteText(overrides = {}) {
  const fields = Array(88).fill('');
  Object.assign(fields, {
    1: '贵州茅台',
    2: '600519',
    3: '1258.62',
    4: '1235.58',
    5: '1239.53',
    6: '38331',
    31: '23.04',
    32: '1.86',
    33: '1268.00',
    34: '1236.05',
    35: '1258.62/38331/4797246636',
    37: '479725',
    38: '0.31',
    39: '19.32',
    44: '15733.78',
    45: '15733.78',
    46: '6.26',
    52: '17.67',
  }, overrides);
  return `v_sh600519="${fields.join('~')}";`;
}


function indexQuoteText(symbol, name, price, changePct) {
  return quoteText({
    1: name,
    2: symbol.slice(-6),
    3: String(price),
    4: String(price),
    5: String(price),
    31: '1.00',
    32: String(changePct),
    33: String(price),
    34: String(price),
    35: `${price}/100/1000000`,
    45: '100',
    52: '15',
  }).replace('v_sh600519=', `v_${symbol}=`);
}

test('腾讯行情映射价格、估值和市值字段', () => {
  const quote = parseTencentQuote(quoteText());
  assert.equal(quote.symbol, '600519');
  assert.equal(quote.name, '贵州茅台');
  assert.equal(quote.price, 1258.62);
  assert.equal(quote.changePct, 1.86);
  assert.equal(quote.pe, 17.67);
  assert.equal(quote.pb, 6.26);
  assert.equal(quote.marketCap, 15733.78 * 1e8);
  assert.equal(quote.source, 'tencent');
});

test('腾讯行情在盘中价缺失时使用昨收并标记降级', () => {
  const quote = parseTencentQuote(quoteText({ 3: '0', 4: '1235.58' }));
  assert.equal(quote.price, 1235.58);
  assert.equal(quote.isPreviousClose, true);
  assert.equal(quote.changePct, null);
});

test('A 股代码能映射到沪、深、北交易所前缀', () => {
  assert.equal(tencentPrefixForCode('600519'), 'sh');
  assert.equal(tencentPrefixForCode('000001'), 'sz');
  assert.equal(tencentPrefixForCode('920599'), 'bj');
  assert.equal(tencentPrefixForCode('ABC'), null);
});

test('东财行情失败时 getQuote 自动回退到腾讯', async () => {
  const originalFetch = globalThis.fetch;
  let emCalls = 0;
  let txCalls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('push2.eastmoney.com')) {
      emCalls += 1;
      return new Response('bad gateway', { status: 502 });
    }
    if (target.includes('qt.gtimg.cn')) {
      txCalls += 1;
      return new Response(quoteText().replace('贵州茅台', 'Moutai'));
    }
    throw new Error(`unexpected fetch: ${target}`);
  };

  try {
    const quote = await getQuote({ symbol: '600519', market: 'CN', secid: '1.600519' });
    assert.equal(quote.source, 'tencent');
    assert.equal(quote.price, 1258.62);
    assert.equal(emCalls, 2);
    assert.equal(txCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('东财指数接口失败时 getMarketOverview 自动回退腾讯', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('push2.eastmoney.com')) return new Response('bad gateway', { status: 502 });
    if (target.includes('qt.gtimg.cn/q=sh000001')) return new Response(indexQuoteText('sh000001', 'SSE', 3823.39, -0.49));
    if (target.includes('qt.gtimg.cn/q=sz399001')) return new Response(indexQuoteText('sz399001', 'SZSE', 12683.03, -1.59));
    if (target.includes('qt.gtimg.cn/q=sz399006')) return new Response(indexQuoteText('sz399006', 'ChiNext', 3052.17, -2.65));
    if (target.includes('qt.gtimg.cn/q=sh000688')) return new Response(indexQuoteText('sh000688', 'STAR50', 1000, 0.5));
    throw new Error(`unexpected fetch: ${target}`);
  };
  try {
    const text = await getMarketOverview();
    assert.match(text, /SSE 3823\.39/);
    assert.match(text, /SZSE 12683\.03/);
    assert.match(text, /ChiNext 3052\.17/);
    assert.match(text, /STAR50 1000/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
