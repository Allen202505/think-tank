import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConclusion,
  buildDewaterSeries,
  computeDewaterAttribution,
  industryGroupFor,
  normalizeSinaUniverseRows,
  normalizeUniverseRows,
  parseEastmoneyKline,
  parseSinaKline,
  parseTencentKline,
  resolveRange,
  resolveSelection,
  sliceRange,
} from '../src/lib/indexDewater.mjs';

const universe = [
  { code: '600001', name: '甲银行', price: 12, marketCap: 50, floatCap: 50, industry: '银行Ⅱ' },
  { code: '600002', name: '乙石油', price: 18, marketCap: 30, floatCap: 30, industry: '炼化及贸易' },
  { code: '600003', name: '丙制造', price: 10, marketCap: 20, floatCap: 20, industry: '专用设备' },
];

const officialBars = [
  { date: '2026-01-02', close: 100 },
  { date: '2026-01-03', close: 107 },
];
const stockBarsByCode = new Map([
  ['600001', [{ date: '2026-01-02', close: 10 }, { date: '2026-01-03', close: 12 }]],
  ['600002', [{ date: '2026-01-02', close: 20 }, { date: '2026-01-03', close: 18 }]],
  ['600003', [{ date: '2026-01-02', close: 10 }, { date: '2026-01-03', close: 10 }]],
]);
const range = { id: 'custom', label: '自定义日期', startDate: '2026-01-02', endDate: '2026-01-03' };

test('自定义区间校验日期并保留交易日边界', () => {
  assert.throws(() => resolveRange({ range: 'custom', startDate: '2026-02-01', endDate: '2026-01-01' }), /开始日期/);
  const resolved = resolveRange({ range: 'custom', startDate: '2026-01-02', endDate: '2026-01-03', now: new Date('2026-01-05T00:00:00Z') });
  assert.equal(resolved.startDate, '2026-01-02');
  assert.equal(resolved.endDate, '2026-01-03');
});

test('今天、昨天和近7天区间按日历日解析', () => {
  const now = new Date('2026-11-20T12:00:00+08:00');
  assert.deepEqual(resolveRange({ range: 'today', now }), { id: 'today', label: '今天', startDate: '2026-11-20', endDate: '2026-11-20', bars: 320 });
  assert.deepEqual(resolveRange({ range: 'yesterday', now }), { id: 'yesterday', label: '昨天', startDate: '2026-11-19', endDate: '2026-11-19', bars: 320 });
  const week = resolveRange({ range: '7d', now });
  assert.equal(week.startDate, '2026-11-14');
  assert.equal(week.endDate, '2026-11-20');
});

test('东财日线和样本字段被归一化，无效行情被剔除', () => {
  const kline = parseEastmoneyKline({ data: { klines: ['2026-01-02,9,10,11,8,100,1000,2.1,1.2,0.12,0.8'] } });
  assert.equal(kline.length, 1);
  assert.equal(kline[0].close, 10);
  const rows = normalizeUniverseRows([
    { f12: '600001', f14: '甲', f2: 10, f20: 100, f21: 80, f100: '银行Ⅱ' },
    { f12: '600002', f14: '停牌', f2: '-', f20: 100, f21: 80, f100: '银行Ⅱ' },
    { f12: '600003', f14: '缺流通市值', f2: 10, f20: 100, f21: '-', f100: '银行Ⅱ' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, '600001');
  assert.equal(rows[0].weightCap, 80);
});

test('腾讯/新浪日线与新浪样本可作为东财故障时的降级数据', () => {
  const tencent = parseTencentKline({ data: { sh600001: { qfqday: [['2026-01-02', '9', '10', '11', '8', '100']] } } }, 'sh600001');
  const sina = parseSinaKline([{ day: '2026-01-03', open: '10', close: '10.5', high: '11', low: '9.8', volume: '123' }]);
  assert.equal(tencent[0].close, 10);
  assert.equal(sina[0].close, 10.5);
  const fallback = normalizeSinaUniverseRows([
    { code: '600001', name: '甲银行', trade: '10', changepercent: '1.2', mktcap: '100', nmc: '80' },
  ], new Map([['600001', '银行Ⅱ']]));
  assert.equal(fallback[0].weightCap, 800000);
  assert.equal(fallback[0].industry, '银行Ⅱ');
  assert.equal(fallback[0].source, 'sina');
});

test('行业与个股组合选择会去重，并标记非上证样本', () => {
  const selection = resolveSelection({
    universe,
    industries: ['bank'],
    stocks: [{ code: '600001', name: '甲银行' }, { code: '000001', name: '平安银行' }],
  });
  assert.equal(selection.finalCount, 1);
  assert.equal(selection.duplicateCount, 1);
  assert.equal(selection.outsideItems.length, 1);
  assert.deepEqual(selection.items[0].sources.sort(), ['industry', 'stock']);
  assert.equal(industryGroupFor('oil').label, '石油石化');
});

test('固定权重归因区分点位贡献与独立脱水指数', () => {
  const result = computeDewaterAttribution({
    officialBars,
    stockBarsByCode,
    universe,
    selectedCodes: ['600001'],
    range,
  });
  assert.equal(result.official.returnPct, 7);
  assert.equal(result.selection.items[0].weightPct, 50);
  assert.equal(result.selection.items[0].returnPct, 20);
  assert.equal(result.attribution.removedPoints, 10);
  assert.equal(result.attribution.remainingPoints, -3);
  assert.equal(result.dewater.returnPct, -5.99);
  assert.equal(result.dewater.endLevel, 53.5);
  assert.equal(result.dewater.endLevel, result.dewater.sameDivisorLevel);
  assert.equal(result.dewater.differencePp, -12.99);
  assert.equal(result.dewater.sameDivisorLevel, 53.5);
  assert.equal(result.dewater.pointsBelowOfficial, -53.5);
  assert.equal(result.chart.dates.length, 2);
});

test('脱水走势从区间首日官方点位归一，并能在无剔除时保持官方走势', () => {
  const series = buildDewaterSeries({
    officialBars,
    stockBarsByCode,
    universe,
    selectedCodes: [],
    startIndex: 0,
    endIndex: 1,
  });
  assert.deepEqual(series.official, [100, 107]);
  assert.deepEqual(series.dewater, [100, 107]);
  const sliced = sliceRange(officialBars, range);
  assert.equal(sliced.startBar.date, '2026-01-02');
  assert.equal(sliced.endBar.date, '2026-01-03');
});

test('结论根据真实涨跌方向输出权重股支撑/拖累语义', () => {
  const support = buildConclusion({
    selectionLabels: ['银行'],
    result: {
      dewater: { returnPct: -15.3, differencePp: -6.9, sameDivisorLevel: 2652, pointsBelowOfficial: -982 },
    },
    official: { returnPct: -8.4 },
  });
  assert.match(support.text, /官方指数表现好于其余股票/);
  assert.equal(support.tone, 'weighted');

  const divergence = buildConclusion({
    selectionLabels: ['银行'],
    result: {
      dewater: { returnPct: -2, differencePp: -5, sameDivisorLevel: 3900, pointsBelowOfficial: -100 },
    },
    official: { returnPct: 3 },
  });
  assert.equal(divergence.tone, 'divergence');
  assert.match(divergence.title, /官方上涨/);
  assert.match(divergence.text, /比官方指数低 100.00 点/);
  assert.doesNotMatch(divergence.text, /百分点|pp/);
});
