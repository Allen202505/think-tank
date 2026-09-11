import test from 'node:test';
import assert from 'node:assert/strict';
import { isAShareQuotationRow } from '../src/lib/stockSearch.mjs';

test('accepts EastMoney class 23 STAR Market stocks', () => {
  assert.equal(isAShareQuotationRow({
    Classify: '23',
    Code: '688836',
    QuoteID: '1.688836',
    Name: '宇树科技-W',
  }), true);
});

test('accepts legacy AStock classification', () => {
  assert.equal(isAShareQuotationRow({
    Classify: 'AStock',
    Code: '000928',
    QuoteID: '0.000928',
    Name: '中钢国际',
  }), true);
});

test('rejects non-A-share quotation rows', () => {
  assert.equal(isAShareQuotationRow({
    Classify: 'HK',
    Code: '00700',
    QuoteID: '116.00700',
    Name: '腾讯控股',
  }), false);
  assert.equal(isAShareQuotationRow({
    Classify: '',
    Code: '123456',
    QuoteID: '1.123456',
    Name: '示例债券',
  }), false);
});
