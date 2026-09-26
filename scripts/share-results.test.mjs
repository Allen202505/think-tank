import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARE_RESULT_KINDS,
  buildBreakfastSharePayload,
  buildMasterPkSharePayload,
  buildMungerSharePayload,
  normalizeShareDraft,
} from '../src/lib/shareResults.mjs';

test('normalizes supported share snapshots and removes secrets recursively', () => {
  const result = normalizeShareDraft({
    kind: SHARE_RESULT_KINDS.MASTER_PK,
    title: '  茅台还能不能买？  ',
    payload: {
      question: '茅台还能不能买？',
      aiConfig: { apiKey: 'sk-secret' },
      nested: {
        apiKey: 'sk-secret',
        apiConfig: { baseUrl: 'private' },
        base64: 'private-file',
        content: '保留这段正文',
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.title, '茅台还能不能买？');
  assert.equal(result.value.payload.aiConfig, undefined);
  assert.equal(result.value.payload.nested.apiKey, undefined);
  assert.equal(result.value.payload.nested.apiConfig, undefined);
  assert.equal(result.value.payload.nested.base64, undefined);
  assert.equal(result.value.payload.nested.content, '保留这段正文');
});

test('rejects unknown share kinds and non-object payloads', () => {
  assert.equal(normalizeShareDraft({ kind: 'unknown', payload: {} }).ok, false);
  assert.equal(normalizeShareDraft({ kind: SHARE_RESULT_KINDS.BREAKFAST, payload: [] }).ok, false);
});

test('builds a master PK snapshot with full rounds and safe master metadata', () => {
  const payload = buildMasterPkSharePayload({
    question: '英伟达现在贵吗？',
    rounds: [{
      type: 'round',
      hostOpening: '先问估值。',
      discussion: [{ investorId: 'buffett', stance: 'NEUTRAL', content: '看现金流。', keyPoint: '估值要结合现金流' }],
      hostClosing: '分歧在增速。',
      verdict: { summary: '中性偏谨慎' },
    }],
    masters: [{
      id: 'buffett', name: '巴菲特', title: '奥马哈先知', emoji: '🎩', color: '#c9a84c',
      avatar: '/avatars/buffett.jpg', biography: '不应进入快照的长篇私有/冗余字段',
    }],
  });

  assert.equal(payload.question, '英伟达现在贵吗？');
  assert.equal(payload.rounds.length, 1);
  assert.equal(payload.rounds[0].discussion[0].content, '看现金流。');
  assert.equal(payload.masters[0].name, '巴菲特');
  assert.equal(payload.masters[0].biography, undefined);
});

test('builds breakfast and munger snapshots without uploaded file data', () => {
  const breakfast = buildBreakfastSharePayload({
    news: { title: '测试新闻', content: '新闻正文', source: '财联社', time: '09:00' },
    mode: 'quick',
    guests: [{ master: { id: 'munger', name: '芒格', avatar: '/avatars/munger.jpg' }, groupKey: '价值投资' }],
    steps: [{ stepKey: 'quick', type: 'quick', turns: [{ speaker: 'host', text: '先看影响。' }], summary: '值得关注。' }],
  });
  assert.equal(breakfast.news.title, '测试新闻');
  assert.equal(breakfast.steps[0].summary, '值得关注。');

  const munger = buildMungerSharePayload({
    link: '',
    fileName: '贵州茅台2025年报.pdf',
    note: '重点看现金流',
    result: {
      content: '芒格解读正文',
      followUps: ['现金流为什么改善？'],
      diagnosis: { company: '贵州茅台（600519）', rows: [] },
      dataCard: '结构化数据',
    },
  });
  assert.equal(munger.analysis.content, '芒格解读正文');
  assert.equal(munger.report.fileName, '贵州茅台2025年报.pdf');
  assert.equal(munger.analysis.diagnosis.company, '贵州茅台（600519）');
  assert.equal(munger.report.file, undefined);
  assert.equal(munger.report.base64, undefined);
});
