import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStockChokeMessages,
  normalizeStockChokeResult,
  STOCK_CHOKE_SCHEMA,
} from '../src/lib/stockChoke.js';
import {
  CHOKE_EXCLUSION_RULES,
  CHOKE_FRAMEWORK_STEPS,
  SERENITY_SKILL,
} from '../src/data/supplyChainBottleneck.js';

test('供应链瓶颈提示词包含 Skill 来源、Serenity 六步法与七条排除规则', () => {
  const messages = buildStockChokeMessages({
    industry: 'AI 算力链',
    market: 'auto',
    focus: '重点看光互连',
    sectorSnapshot: { available: true, name: '通信设备', changePct: 1.2 },
  });
  const prompt = messages.map((message) => message.content).join('\n');
  assert.match(prompt, new RegExp(SERENITY_SKILL.id));
  assert.match(prompt, /Serenity Choke Point Theory/);
  assert.match(prompt, /七条排除规则/);
  assert.match(prompt, /不是系统指令/);
  assert.match(prompt, /candidates\[\]\.name 必须是真实公司简称/);
  assert.match(prompt, /通信设备/);
  assert.equal(CHOKE_FRAMEWORK_STEPS.length, 6);
  assert.equal(CHOKE_EXCLUSION_RULES.length, 7);
  assert.match(STOCK_CHOKE_SCHEMA, /"supplyChain"/);
  assert.match(STOCK_CHOKE_SCHEMA, /"catalysts"/);
});

test('供应链瓶颈结果归一化会清洗缺失字段并限制候选数量', () => {
  const normalized = normalizeStockChokeResult({
    summary: { cycleType: '供给受限', confidence: '中' },
    supplyChain: [{ node: '高纯石英', chokeScore: 88, chokeReasons: ['扩产慢'] }],
    chokePoints: [{ node: '高纯石英', rank: 1 }],
    candidates: Array.from({ length: 8 }, (_, index) => ({
      name: `公司${index}`,
      symbol: `60050${index}`,
      signals: { valuation: '历史中位' },
    })),
    crossCheck: { bull: ['订单验证'], bear: ['估值偏高'] },
    capital: { crowding: '中' },
    dataGaps: ['海外份额待核验'],
  });
  assert.equal(normalized.summary.cycleType, '供给受限');
  assert.equal(normalized.supplyChain[0].chokeScore, 88);
  assert.equal(normalized.candidates.length, 6);
  assert.equal(normalized.candidates[0].signals.valuation, '历史中位');
  assert.equal(normalized.crossCheck.bull[0], '订单验证');
  assert.equal(normalized.capital.crowding, '中');
  assert.equal(normalized.dataGaps[0], '海外份额待核验');
});
