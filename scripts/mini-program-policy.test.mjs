import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMiniProxySignature,
  inspectMiniOutput,
  normalizeDebateResult,
  normalizeReadingResult,
  parseJsonObject,
  pickMiniPerspectives,
  validateMiniQuestion,
  validateMiniReading,
  verifyMiniProxyRequest,
} from '../src/lib/miniProgramPolicy.js';

test('mini program rejects stock codes and actionable trading prompts', () => {
  assert.equal(validateMiniQuestion('分析一下 600519 的估值').ok, false);
  assert.equal(validateMiniQuestion('这只股票建议买入吗？').ok, false);
  assert.equal(validateMiniQuestion('目标价能到多少？').ok, false);
});

test('mini program accepts financial literacy questions', () => {
  const result = validateMiniQuestion('利率变化为什么会推动资产估值变化？');
  assert.equal(result.ok, true);
  assert.match(result.text, /利率变化/);
});

test('mini program reading rejects stock codes and keeps general material', () => {
  assert.equal(validateMiniReading('贵州茅台 600519 今日涨停，建议继续买入。').ok, false);
  const result = validateMiniReading('央行发布公开市场操作公告，市场关注短端利率和流动性变化对债券估值的影响。');
  assert.equal(result.ok, true);
});

test('mini program output guard blocks direct investment advice', () => {
  assert.equal(inspectMiniOutput('建议买入该股票，目标价 100 元。').ok, false);
  assert.equal(inspectMiniOutput('这段材料说明利率变化可能影响资产估值，但传导存在时滞。').ok, true);
});

test('mini program perspective selection sanitizes and fills defaults', () => {
  assert.deepEqual(pickMiniPerspectives(['value', 'unknown']), ['value', 'contrarian']);
  assert.deepEqual(pickMiniPerspectives(['risk', 'value', 'macro', 'growth', 'contrarian']), [
    'risk',
    'value',
    'macro',
    'growth',
  ]);
});

test('mini program parses fenced JSON and normalizes debate output', () => {
  const raw = '```json\n{"title":"利率与估值","summary":"利率影响贴现率","sections":[{"id":"value","heading":"价值视角","content":"利率变化会影响未来现金流的现值，但企业定价能力也会改变结果。","question":"哪些企业更能转嫁成本？"}],"takeaway":"先看假设","keywords":["利率","估值"]}\n```';
  assert.ok(parseJsonObject(raw));
  const result = normalizeDebateResult(raw, ['value', 'contrarian']);
  assert.equal(result.title, '利率与估值');
  assert.equal(result.sections[0].id, 'value');
  assert.equal(result.sections.length, 1);
});

test('mini program normalizes reading cards', () => {
  const raw = JSON.stringify({
    title: '流动性观察',
    summary: '公开市场操作会影响短端资金价格。',
    points: [{ label: '发生了什么', content: '央行开展公开市场操作。' }],
    concepts: [{ term: '流动性', explanation: '资金在市场中的可获取程度。' }],
    uncertainties: ['后续操作规模仍需观察'],
    takeaway: '区分操作事实与市场解读。',
  });
  const result = normalizeReadingResult(raw);
  assert.equal(result.points[0].label, '发生了什么');
  assert.equal(result.concepts[0].term, '流动性');
  assert.equal(result.uncertainties.length, 1);
});

test('mini program proxy signature verifies the exact request and rejects tampering', () => {
  const previous = process.env.MINI_PROXY_SECRET;
  process.env.MINI_PROXY_SECRET = 'test-secret-1234567890';
  const timestamp = String(Date.now());
  const nonce = 'nonce-1';
  const openid = 'openid-1';
  const rawBody = JSON.stringify({ question: '什么是周期？' });
  const signature = buildMiniProxySignature({
    action: 'debate',
    timestamp,
    nonce,
    openid,
    rawBody,
    secret: process.env.MINI_PROXY_SECRET,
  });
  const request = new Request('https://example.com/api/mini/debate', {
    method: 'POST',
    headers: {
      'x-mini-timestamp': timestamp,
      'x-mini-nonce': nonce,
      'x-mini-openid': openid,
      'x-mini-signature': signature,
    },
  });
  assert.equal(verifyMiniProxyRequest(request, rawBody, 'debate').ok, true);
  assert.equal(verifyMiniProxyRequest(request, `${rawBody} `, 'debate').ok, false);
  if (previous === undefined) delete process.env.MINI_PROXY_SECRET;
  else process.env.MINI_PROXY_SECRET = previous;
});
