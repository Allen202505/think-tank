import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPageContent,
  htmlToText,
  isPrivateNetworkHost,
  normalizeStrategyDraft,
  normalizeStrategyUrl,
} from '../src/lib/strategyExtraction.mjs';
import { STRATEGY_CATEGORIES, STRATEGY_GALLERY } from '../src/data/strategyGallery.js';
import { STRATEGY_DETAILS } from '../src/data/strategyDetails.js';

test('HTML 清洗保留正文并移除脚本样式', () => {
  const html = '<html><head><title>测试策略</title><meta name="author" content="张三"></head><body><script>alert(1)</script><h1>低估值选股</h1><p>PE 低于历史 20% 分位。</p><style>.x{}</style></body></html>';
  const text = htmlToText(html);
  assert.match(text, /低估值选股/);
  assert.match(text, /PE 低于历史/);
  assert.doesNotMatch(text, /alert|\.x/);
  const page = extractPageContent(html, 'https://example.com/a');
  assert.equal(page.title, '测试策略');
  assert.equal(page.author, '张三');
});

test('策略链接只允许公开 http(s) 地址', () => {
  assert.equal(normalizeStrategyUrl('https://www.zhihu.com/question/1/answer/2#comments'), 'https://www.zhihu.com/question/1/answer/2');
  assert.equal(isPrivateNetworkHost('127.0.0.1'), true);
  assert.equal(isPrivateNetworkHost('192.168.1.10'), true);
  assert.equal(isPrivateNetworkHost('10.0.0.2'), true);
  assert.equal(isPrivateNetworkHost('::1'), true);
  assert.equal(isPrivateNetworkHost('www.zhihu.com'), false);
  assert.throws(() => normalizeStrategyUrl('file:///etc/passwd'));
  assert.throws(() => normalizeStrategyUrl('http://localhost/test'));
});

test('AI 结果归一化限制字段长度并保留固定来源链接', () => {
  const strategy = normalizeStrategyDraft({
    title: ' 低估值策略 ',
    category: '长线价值',
    author: '李四',
    description: '等待估值回落到低位',
    keyPoints: ['PE 低位', '现金流为正'],
    risk: '等待周期长',
  }, 'https://example.com/answer');
  assert.equal(strategy.title, '低估值策略');
  assert.equal(strategy.category, '长线价值');
  assert.deepEqual(strategy.points, ['PE 低位', '现金流为正']);
  assert.equal(strategy.url, 'https://example.com/answer');
  assert.equal(strategy.userAdded, true);
});

test('预置策略卡片字段完整且只收录三类方法', () => {
  assert.equal(STRATEGY_GALLERY.length, 18);
  assert.deepEqual(STRATEGY_CATEGORIES, ['长线价值', '短线波段', '交易心法']);
  for (const strategy of STRATEGY_GALLERY) {
    assert.ok(strategy.id && strategy.title && strategy.description);
    assert.ok(strategy.author && strategy.source && strategy.url);
    assert.ok(STRATEGY_CATEGORIES.includes(strategy.category));
    assert.ok(Array.isArray(strategy.points) && strategy.points.length >= 2);
    assert.match(strategy.url, /^https:\/\/www\.zhihu\.com\//);
  }
});

test('18 条预置策略都带源文档详细拆解', () => {
  const detailIds = Object.keys(STRATEGY_DETAILS);
  assert.equal(detailIds.length, 18);
  for (const strategy of STRATEGY_GALLERY) {
    const detail = STRATEGY_DETAILS[strategy.id];
    assert.ok(detail, `${strategy.id} 缺少详细拆解`);
    assert.ok(Array.isArray(detail.sections) && detail.sections.length >= 1);
    assert.ok(detail.sections.every((section) => section.title && Array.isArray(section.items) && section.items.length));
  }
});
