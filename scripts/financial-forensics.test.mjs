import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiagnosis, buildFallbackDiagnosis } from '../src/app/api/chat/financialForensics.js';

function mockForensic() {
  return {
    hasData: true,
    stock: { name: '测试公司', symbol: '600000', market: 'A股' },
    asOf: '2025年报',
    businessModel: '测试经营模式',
    coverage: { structured: 2, filing: 1, missing: 0 },
    sources: [{ type: 'structured', title: '测试财报', date: '2025-12-31', url: null }],
    seeds: [
      {
        priorityHint: 'P0', domain: '利润质量', metric: '经营现金流/净利润', current: '0.60倍', trend: '上年1.00倍',
        evidence: '经营现金流低于净利润', nextStep: '核对应收和存货', statusHint: 'watch', source: '三表',
      },
      {
        priorityHint: 'P1', domain: '资产质量', metric: '存货增速-营收增速', current: '+20pct', trend: '存货快于收入',
        evidence: '存货增长较快', nextStep: '检查跌价准备', statusHint: 'watch', source: '年报附注',
      },
    ],
  };
}

test('normalizeDiagnosis maps status aliases and fills three follow-up questions', () => {
  const forensic = mockForensic();
  const result = normalizeDiagnosis({
    company: '测试公司（600000）',
    businessModel: '白酒',
    focus: ['利润质量'],
    rows: [
      { priority: 'P0', domain: '利润质量', metric: '经营现金流/净利润', current: '0.60倍', trend: '下滑', status: '🟡', finding: '利润含金量下降', next: '核对应收', source: '三表' },
    ],
    topQuestions: ['现金流为什么下降？'],
  }, forensic);
  assert.equal(result.rows[0].status, 'watch');
  assert.equal(result.rows.length, 2);
  assert.equal(result.topQuestions.length, 3);
  assert.equal(result.company, '测试公司（600000）');
  assert.equal(result.coverage.structured, 2);
});

test('buildFallbackDiagnosis keeps evidence-grounded rows when model output is absent', () => {
  const result = buildFallbackDiagnosis(mockForensic());
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].priority, 'P0');
  assert.equal(result.rows[0].status, 'watch');
  assert.match(result.rows[0].finding, /经营现金流/);
  assert.equal(result.topQuestions.length, 2);
});

test('normalizeDiagnosis returns null without forensic data', () => {
  assert.equal(normalizeDiagnosis({ rows: [] }, null), null);
});
