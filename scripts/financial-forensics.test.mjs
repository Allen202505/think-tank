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
        key: 'ocfNp', priorityHint: 'P0', domain: '利润质量', metric: '经营现金流/净利润', current: '0.60倍', trend: '上年1.00倍',
        evidence: '经营现金流低于净利润', nextStep: '核对应收和存货', statusHint: 'watch', source: '三表',
      },
      {
        key: 'inventory', priorityHint: 'P1', domain: '资产质量', metric: '存货增速-营收增速', current: '+20pct', trend: '存货快于收入',
        evidence: '存货增长较快', nextStep: '检查跌价准备', statusHint: 'watch', source: '年报附注',
      },
    ],
  };
}

function normalizedRow(overrides = {}) {
  return {
    priority: 'P0', domain: '利润质量', question: '利润为什么没有变成现金？',
    evidence: ['经营现金流 -6.86 亿元', '净利润 3.98 亿元'], judgment: '利润与现金流明显背离，需要继续拆解。',
    nextCheck: { what: '查现金流量表附注', lookAt: '看销售商品收现与营收匹配度', judge: '判断利润卡在哪里' },
    status: '🟡', source: '三表',
    ...overrides,
  };
}

test('normalizeDiagnosis maps the PRD five-column schema and fills three follow-up questions', () => {
  const forensic = mockForensic();
  const result = normalizeDiagnosis({
    company: '测试公司（600000）',
    businessModel: '白酒',
    focus: ['利润质量'],
    coreContradiction: '收入与现金兑现存在偏差。',
    mainRisk: '经营现金流低于净利润。',
    keyLead: '主营仍保持盈利。',
    rows: [normalizedRow(), normalizedRow({ priority: 'P1', domain: '资产质量' }), normalizedRow({ priority: 'P1' }), normalizedRow({ priority: 'P2' })],
    topQuestions: ['现金流为什么下降？'],
  }, forensic);
  assert.equal(result.rows[0].status, 'watch');
  assert.equal(result.rows[0].question, '利润为什么没有变成现金？');
  assert.equal(result.rows[0].nextCheck.what, '查现金流量表附注');
  assert.equal(result.rows[0].evidence.length, 2);
  assert.equal(result.topQuestions.length, 3);
  assert.equal(result.company, '测试公司（600000）');
  assert.equal(result.coreContradiction, '收入与现金兑现存在偏差。');
  assert.equal(result.coverage.structured, 2);
});

test('buildFallbackDiagnosis keeps evidence-grounded rows and PRD action structure when model output is absent', () => {
  const result = buildFallbackDiagnosis(mockForensic());
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].priority, 'P0');
  assert.equal(result.rows[0].status, 'watch');
  assert.equal(result.rows[0].question, '利润为什么没有变成现金？');
  assert.equal(result.rows[0].nextCheck.what, '查现金流量表附注、应收、合同资产和存货');
  assert.match(result.rows[0].judgment, /重点核查/);
  assert.ok(result.coreContradiction);
  assert.ok(result.mainRisk);
  assert.ok(result.keyLead);
  assert.equal(result.topQuestions.length, 2);
});

test('normalizeDiagnosis returns null without forensic data', () => {
  assert.equal(normalizeDiagnosis({ rows: [] }, null), null);
});
