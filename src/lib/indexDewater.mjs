// 上证指数脱水计算层
//
// V1 口径：
//  - 官方指数点位/区间收益：东方财富上证指数日线。
//  - 样本：当前在沪市上市的 A/B 股（不含基金、债券）；用东财 f21 流通市值作为指数权重代理。
//  - 行业：东方财富行业字段，按申万一级行业名称做映射。
//  - 个股区间收益：东方财富前复权日线。
//  - 点位贡献：固定当前权重归因；独立脱水指数：从区间首个交易日归一到官方点位后，
//    用“官方日收益 - 被剔除股票加权收益”倒推剩余股票收益。
//
// 该实现不伪造历史股本与历史成分股。接口会明确返回数据质量边界，历史精确复刻需要
// 接入带历史成分、历史股本和指数除数的授权数据源。

import { parseTencentQuote } from './tencentQuote.mjs';

export const INDEX_DEWATER_INDEX = {
  code: '000001',
  secid: '1.000001',
  name: '上证指数',
};

export const RANGE_OPTIONS = [
  { id: 'today', label: '今天', days: 0 },
  { id: 'yesterday', label: '昨天', offsetDays: -1 },
  { id: '7d', label: '近7天', days: 7 },
  { id: '1m', label: '近一个月', months: 1, bars: 35 },
  { id: '3m', label: '近三个月', months: 3, bars: 80 },
  { id: '6m', label: '近半年', months: 6, bars: 150 },
  { id: 'ytd', label: '年初至今', ytd: true, bars: 320 },
  { id: '1y', label: '近一年', months: 12, bars: 320 },
  { id: 'custom', label: '自定义日期' },
];

export const INDUSTRY_GROUPS = [
  { id: 'bank', label: '银行', aliases: ['银行', '银行Ⅱ'] },
  { id: 'securities', label: '证券', aliases: ['证券', '证券Ⅱ'] },
  { id: 'insurance', label: '保险', aliases: ['保险', '保险Ⅱ'] },
  { id: 'oil', label: '石油石化', aliases: ['石油石化', '油气开采', '油气开采Ⅱ', '油服工程', '炼化及贸易'] },
  { id: 'coal', label: '煤炭', aliases: ['煤炭', '煤炭开采', '焦炭', '焦炭Ⅱ'] },
  { id: 'baijiu', label: '白酒', aliases: ['白酒', '白酒Ⅱ'] },
  { id: 'real-estate', label: '房地产', aliases: ['房地产', '房地产开发', '房地产服务'] },
  { id: 'construction', label: '建筑装饰', aliases: ['建筑装饰', '房屋建设Ⅱ', '基础建设', '专业工程', '工程咨询服务Ⅱ', '装修装饰Ⅱ'] },
];

export const QUICK_STOCKS = [
  { code: '601857', name: '中国石油' },
  { code: '600028', name: '中国石化' },
  { code: '600519', name: '贵州茅台' },
  { code: '600941', name: '中国移动' },
  { code: '601088', name: '中国神华' },
  { code: '601668', name: '中国建筑' },
];

export const DEEP_DEWATER_STOCK_CODES = ['601857'];
export const DEFAULT_RANGE = '1y';
export const DEFAULT_INDUSTRIES = ['bank'];
export const MAX_DEWATER_SELECTION = 500;

const EM_CLIST = 'https://push2.eastmoney.com/api/qt/clist/get';
const EM_KLINE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const SINA_LIST = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData';
const SINA_KLINE = 'https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData';
const TENCENT_KLINE = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGE_SIZE = 100;

const BANK_CODES = new Set([
  '600000', '600015', '600016', '600036', '600908', '600919', '600926', '600928',
  '601009', '601077', '601128', '601166', '601169', '601187', '601229', '601288',
  '601328', '601398', '601528', '601577', '601658', '601665', '601818', '601825',
  '601838', '601860', '601916', '601939', '601963', '601988', '601997', '601998', '603323',
]);
const INSURANCE_CODES = new Set(['601318', '601319', '601336', '601601', '601628']);

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const positive = (value) => {
  const n = num(value);
  return n != null && n > 0 ? n : null;
};
const weightCapOf = (row) => positive(row?.weightCap) || positive(row?.floatCap) || positive(row?.marketCap) || 0;
const round = (value, digits = 2) => {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const p = 10 ** digits;
  return Math.round(Number(value) * p) / p;
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function shanghaiParts(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

export function shanghaiDateString(date = new Date()) {
  const { year, month, day } = shanghaiParts(date);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatDateUtc(year, month, day) {
  const d = new Date(Date.UTC(year, month, day));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function subtractDays(dateString, days) {
  const [year, month, day] = String(dateString).split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1, day));
  target.setUTCDate(target.getUTCDate() - Math.max(0, Number(days) || 0));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(target.getUTCDate()).padStart(2, '0')}`;
}

function subtractMonths(dateString, months) {
  const [year, month, day] = String(dateString).split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const daysInTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, daysInTarget));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(target.getUTCDate()).padStart(2, '0')}`;
}

export function resolveRange({ range = DEFAULT_RANGE, startDate = '', endDate = '', now = new Date() } = {}) {
  const option = RANGE_OPTIONS.find((item) => item.id === range) || RANGE_OPTIONS.find((item) => item.id === DEFAULT_RANGE);
  const today = shanghaiDateString(now);
  let resolvedStart = '';
  let resolvedEnd = endDate || today;

  if (option.id === 'custom') {
    resolvedStart = String(startDate || '').trim();
    resolvedEnd = String(endDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(resolvedStart) || !/^\d{4}-\d{2}-\d{2}$/.test(resolvedEnd)) {
      throw new Error('自定义区间需要有效的开始和结束日期');
    }
    if (resolvedStart > resolvedEnd) throw new Error('开始日期不能晚于结束日期');
    if (resolvedEnd > today) throw new Error('结束日期不能晚于今天');
  } else if (option.ytd) {
    const { year } = shanghaiParts(now);
    resolvedStart = `${year}-01-01`;
  } else if (option.days === 0) {
    resolvedEnd = endDate || today;
    resolvedStart = resolvedEnd;
  } else if (option.offsetDays != null) {
    resolvedEnd = endDate || subtractDays(today, Math.abs(option.offsetDays));
    resolvedStart = resolvedEnd;
  } else if (option.days) {
    resolvedEnd = endDate || today;
    resolvedStart = subtractDays(resolvedEnd, option.days - 1);
  } else {
    resolvedStart = subtractMonths(resolvedEnd, option.months);
  }

  return {
    id: option.id,
    label: option.label,
    startDate: resolvedStart,
    endDate: resolvedEnd,
    bars: option.bars || 320,
  };
}

export function parseEastmoneyKline(payload) {
  const rows = payload?.data?.klines;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const parts = String(row || '').split(',');
    if (parts.length < 9) return null;
    const close = positive(parts[2]);
    if (!parts[0] || close == null) return null;
    return {
      date: parts[0],
      open: positive(parts[1]),
      close,
      high: positive(parts[3]),
      low: positive(parts[4]),
      volume: num(parts[5]),
      amount: num(parts[6]),
      amplitudePct: num(parts[7]),
      changePct: num(parts[8]),
      change: num(parts[9]),
      turnoverPct: num(parts[10]),
    };
  }).filter(Boolean);
}

export function parseTencentKline(payload, symbol) {
  const node = payload?.data?.[symbol];
  const rows = node?.qfqday || node?.day || [];
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const close = positive(row?.[2]);
    if (!row?.[0] || close == null) return null;
    return {
      date: String(row[0]),
      open: positive(row[1]),
      close,
      high: positive(row[3]),
      low: positive(row[4]),
      volume: num(row[5]),
    };
  }).filter(Boolean);
}

export function parseSinaKline(payload) {
  return (Array.isArray(payload) ? payload : []).map((row) => {
    const close = positive(row?.close);
    if (!row?.day || close == null) return null;
    return {
      date: String(row.day),
      open: positive(row.open),
      close,
      high: positive(row.high),
      low: positive(row.low),
      volume: num(row.volume),
    };
  }).filter(Boolean);
}

function filterKlineWindow(bars, startDate, endDate) {
  return (Array.isArray(bars) ? bars : []).filter((bar) => (
    bar?.date
    && bar?.close > 0
    && (!startDate || bar.date >= startDate)
    && (!endDate || bar.date <= endDate)
  ));
}

export function normalizeSinaUniverseRows(rows = [], industryByCode = new Map()) {
  const seen = new Set();
  const result = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = String(row?.code || '').trim();
    if (!/^\d{6}$/.test(code) || seen.has(code)) continue;
    const price = positive(row?.trade);
    const floatCap = positive(row?.nmc) ? Number(row.nmc) * 10000 : null;
    if (price == null || floatCap == null) continue;
    const marketCap = positive(row?.mktcap) ? Number(row.mktcap) * 10000 : null;
    seen.add(code);
    result.push({
      code,
      name: String(row?.name || code).trim(),
      price,
      changePct: num(row?.changepercent),
      marketCap,
      floatCap,
      weightCap: floatCap,
      industry: String(industryByCode.get(code) || '未分类'),
      source: 'sina',
    });
  }
  return result;
}

function inferFinancialIndustry(code, name) {
  const value = String(name || '');
  if (BANK_CODES.has(code) || /银行|农商行/.test(value)) return '银行Ⅱ';
  if (INSURANCE_CODES.has(code) || /保险|人寿|太保|人保/.test(value)) return '保险Ⅱ';
  if (/证券/.test(value)) return '证券Ⅱ';
  return '未分类';
}

function inferBaijiu(row) {
  const name = String(row?.name || '');
  return /茅台|五粮液|泸州老窖|洋河|汾酒|古井|今世缘|口子窖|迎驾|舍得|水井坊|酒鬼|老白干|金种子|岩石股份/.test(name);
}

export function normalizeUniverseRows(rows = []) {
  const seen = new Set();
  const result = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = String(row?.f12 || '').trim();
    if (!/^\d{6}$/.test(code) || seen.has(code)) continue;
    const price = positive(row?.f2);
    const marketCap = positive(row?.f20);
    const floatCap = positive(row?.f21);
    if (price == null || floatCap == null) continue;
    seen.add(code);
    result.push({
      code,
      name: String(row?.f14 || code).trim(),
      price,
      changePct: num(row?.f3),
      marketCap,
      floatCap,
      // 上证指数权重与东财指数 f117 流通市值口径对齐；不能用 f20 总市值，
      // 否则建行、工行等 A+H 公司会把 H 股也带入权重。
      weightCap: floatCap,
      industry: String(row?.f100 || row?.f127 || '未分类').trim() || '未分类',
    });
  }
  return result;
}

export function normalizeManualStocks(input = []) {
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(input) ? input : []) {
    const rawCode = typeof item === 'string' ? item : item?.code;
    const code = String(rawCode || '').trim();
    if (!/^\d{6}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    result.push({
      code,
      name: String((typeof item === 'object' && item?.name) || code).trim() || code,
    });
  }
  return result;
}

export function industryGroupFor(id) {
  return INDUSTRY_GROUPS.find((group) => group.id === id) || null;
}

function customIndustryName(id) {
  if (!String(id || '').startsWith('custom:')) return '';
  try {
    return decodeURIComponent(String(id).slice(7));
  } catch {
    return String(id).slice(7);
  }
}

export function industryAliasesForIds(ids = []) {
  const aliases = new Map();
  const labels = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const group = industryGroupFor(id);
    if (group) {
      for (const alias of group.aliases) aliases.set(alias, group.label);
      labels.push(group.label);
      continue;
    }
    const custom = customIndustryName(id);
    if (custom) {
      aliases.set(custom, custom);
      labels.push(custom);
    }
  }
  return { aliases, labels };
}

export function buildIndustryCatalog(universe = []) {
  const counts = new Map();
  for (const row of universe) {
    const industry = row.industry || '未分类';
    counts.set(industry, (counts.get(industry) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map(([name, count]) => ({
      id: `custom:${encodeURIComponent(name)}`,
      name,
      count,
    }));
}

export function resolveSelection({ universe = [], industries = [], stocks = [] } = {}) {
  const { aliases, labels: industryLabels } = industryAliasesForIds(industries);
  const manualStocks = normalizeManualStocks(stocks);
  const byCode = new Map(universe.map((row) => [row.code, row]));
  const selected = new Map();
  const sourceCount = new Map();

  for (const row of universe) {
    if (!aliases.has(row.industry)) continue;
    selected.set(row.code, {
      ...row,
      sources: ['industry'],
      industryLabels: [aliases.get(row.industry)],
    });
    sourceCount.set(row.code, 1);
  }

  const outsideItems = [];
  for (const stock of manualStocks) {
    const row = byCode.get(stock.code);
    if (!row) {
      outsideItems.push(stock);
      continue;
    }
    if (selected.has(stock.code)) {
      const current = selected.get(stock.code);
      const nextLabels = [...(current.industryLabels || [])];
      const mapped = aliases.get(row.industry) || row.industry;
      if (mapped && !nextLabels.includes(mapped)) nextLabels.push(mapped);
      selected.set(stock.code, {
        ...current,
        sources: [...new Set([...(current.sources || []), 'stock'])],
        industryLabels: nextLabels,
      });
      sourceCount.set(stock.code, (sourceCount.get(stock.code) || 0) + 1);
    } else {
      selected.set(stock.code, {
        ...row,
        sources: ['stock'],
        industryLabels: [row.industry],
      });
      sourceCount.set(stock.code, 1);
    }
  }

  const items = [...selected.values()];
  const duplicateCount = [...sourceCount.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const rawRequestedCount = manualStocks.length + universe.filter((row) => aliases.has(row.industry)).length;
  return {
    industries: industryLabels,
    manualStocks,
    items,
    finalCount: items.length,
    duplicateCount,
    outsideItems,
    rawRequestedCount,
  };
}

function closeAtOrBefore(bars, date) {
  if (!Array.isArray(bars) || !bars.length) return null;
  let low = 0;
  let high = bars.length - 1;
  let best = null;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (bars[mid].date <= date) {
      best = bars[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

function closeMapFor(bars) {
  const map = new Map();
  for (const bar of Array.isArray(bars) ? bars : []) {
    if (bar?.date && bar?.close > 0) map.set(bar.date, bar.close);
  }
  return map;
}

export function sliceRange(officialBars = [], range) {
  const bars = (Array.isArray(officialBars) ? officialBars : []).filter((bar) => bar?.date && bar?.close > 0);
  if (bars.length < 2) throw new Error('官方指数历史数据不足');
  const endIndex = (() => {
    for (let i = bars.length - 1; i >= 0; i -= 1) {
      if (bars[i].date <= range.endDate) return i;
    }
    return -1;
  })();
  if (endIndex < 0) throw new Error('所选截止日期没有可用的官方指数数据');
  let startIndex = bars.findIndex((bar) => bar.date >= range.startDate);
  if (startIndex < 0) startIndex = 0;
  if (startIndex >= endIndex) {
    if (endIndex > 0) startIndex = endIndex - 1;
    else throw new Error('所选区间内交易日不足');
  }
  return {
    startIndex,
    endIndex,
    startBar: bars[startIndex],
    endBar: bars[endIndex],
    bars: bars.slice(startIndex, endIndex + 1),
  };
}

export function buildDewaterSeries({
  officialBars = [],
  stockBarsByCode = new Map(),
  universe = [],
  selectedCodes = [],
  startIndex = 0,
  endIndex = 0,
  endLevel = null,
} = {}) {
  const totalWeight = universe.reduce((sum, row) => sum + weightCapOf(row), 0);
  if (!totalWeight) return { dates: [], official: [], dewater: [], gap: [], selectedWeight: 0, remainingWeight: 0 };
  const selected = new Set(selectedCodes);
  const selectedRows = universe.filter((row) => selected.has(row.code));
  const selectedWeight = selectedRows.reduce((sum, row) => sum + weightCapOf(row) / totalWeight, 0);
  const remainingWeight = 1 - selectedWeight;
  const maps = selectedRows.map((row) => ({
    row,
    weight: weightCapOf(row) / totalWeight,
    closes: closeMapFor(stockBarsByCode.get(row.code) || []),
    lastClose: null,
  }));

  if (remainingWeight <= 0.000001) {
    return { dates: [], official: [], dewater: [], gap: [], selectedWeight, remainingWeight: 0 };
  }

  const officialStart = officialBars[startIndex].close;
  let dewater = officialStart;
  const dates = [];
  const official = [];
  const rawDewaterSeries = [];
  const gap = [];

  for (let i = startIndex; i <= endIndex; i += 1) {
    const bar = officialBars[i];
    if (!bar) continue;
    if (i === startIndex) {
      for (const item of maps) {
        const barBefore = closeAtOrBefore(stockBarsByCode.get(item.row.code) || [], bar.date);
        item.lastClose = barBefore?.close ?? null;
      }
    } else {
      const prevOfficial = officialBars[i - 1]?.close;
      const officialDailyReturn = prevOfficial > 0 ? bar.close / prevOfficial - 1 : 0;
      let removedDailyContribution = 0;
      for (const item of maps) {
        const close = item.closes.get(bar.date) ?? item.lastClose;
        if (close > 0 && item.lastClose > 0) {
          removedDailyContribution += item.weight * (close / item.lastClose - 1);
        }
        if (close > 0) item.lastClose = close;
      }
      const remainingDailyReturn = (officialDailyReturn - removedDailyContribution) / remainingWeight;
      dewater *= 1 + remainingDailyReturn;
    }
    dates.push(bar.date);
    official.push(round(bar.close, 2));
    rawDewaterSeries.push(dewater);
  }

  const rawEnd = rawDewaterSeries[rawDewaterSeries.length - 1] || officialStart;
  const scale = positive(endLevel) ? Number(endLevel) / rawEnd : 1;
  const dewaterSeries = rawDewaterSeries.map((value) => round(value * scale, 2));
  for (let i = 0; i < dewaterSeries.length; i += 1) {
    gap.push(round(dewaterSeries[i] - official[i], 2));
  }
  return {
    dates,
    official,
    dewater: dewaterSeries,
    gap,
    selectedWeight: round(selectedWeight, 6),
    remainingWeight: round(remainingWeight, 6),
  };
}

export function computeDewaterAttribution({
  officialBars = [],
  stockBarsByCode = new Map(),
  universe = [],
  selectedCodes = [],
  range,
} = {}) {
  const sliced = sliceRange(officialBars, range);
  const totalWeight = universe.reduce((sum, row) => sum + weightCapOf(row), 0);
  if (!totalWeight) throw new Error('指数样本权重数据不足');
  const selectedSet = new Set(selectedCodes);
  const selectedUniverse = universe.filter((row) => selectedSet.has(row.code));
  const items = [];
  let matchedCount = 0;
  let missingHistoryCount = 0;

  for (const row of selectedUniverse) {
    const bars = stockBarsByCode.get(row.code) || [];
    const startBar = closeAtOrBefore(bars, sliced.startBar.date);
    const endBar = closeAtOrBefore(bars, sliced.endBar.date);
    if (!startBar || !endBar || startBar.date > sliced.startBar.date || startBar.close <= 0 || endBar.close <= 0) {
      missingHistoryCount += 1;
      continue;
    }
    const weight = weightCapOf(row) / totalWeight;
    const intervalReturn = endBar.close / startBar.close - 1;
    const contributionPoints = sliced.startBar.close * weight * intervalReturn;
    matchedCount += 1;
    items.push({
      code: row.code,
      name: row.name,
      industry: row.industry,
      weightPct: round(weight * 100, 3),
      returnPct: round(intervalReturn * 100, 2),
      contributionPoints: round(contributionPoints, 2),
      startPrice: round(startBar.close, 2),
      endPrice: round(endBar.close, 2),
      sources: row.sources || ['stock'],
      industryLabels: row.industryLabels || [row.industry],
    });
  }

  const selectedWeight = items.reduce((sum, row) => sum + (row.weightPct || 0) / 100, 0);
  const weightedReturn = selectedWeight > 0
    ? items.reduce((sum, row) => sum + ((row.weightPct || 0) / 100) * ((row.returnPct || 0) / 100), 0) / selectedWeight
    : 0;
  const officialReturn = sliced.endBar.close / sliced.startBar.close - 1;
  const remainingWeight = 1 - selectedWeight;
  const dewaterReturn = remainingWeight > 0.000001
    ? (officialReturn - selectedWeight * weightedReturn) / remainingWeight
    : officialReturn;
  const officialChangePoints = sliced.endBar.close - sliced.startBar.close;
  const sameDivisorLevel = sliced.endBar.close * (1 - selectedWeight);
  const series = buildDewaterSeries({
    officialBars,
    stockBarsByCode,
    universe,
    selectedCodes: items.map((row) => row.code),
    startIndex: sliced.startIndex,
    endIndex: sliced.endIndex,
    endLevel: sameDivisorLevel,
  });
  const chartStart = series.dewater[0] ?? sameDivisorLevel;
  const chartEnd = series.dewater[series.dewater.length - 1] ?? sameDivisorLevel;
  const dewaterLevel = chartEnd;
  const dewaterReturnFromSeries = chartStart > 0 ? chartEnd / chartStart - 1 : dewaterReturn;
  const pointsBelowOfficial = sameDivisorLevel - sliced.endBar.close;
  const removedPoints = sliced.startBar.close * selectedWeight * weightedReturn;
  const remainingPoints = officialChangePoints - removedPoints;

  items.sort((a, b) => Math.abs(b.contributionPoints || 0) - Math.abs(a.contributionPoints || 0));

  return {
    range: {
      id: range.id,
      label: range.label,
      requestedStartDate: range.startDate,
      requestedEndDate: range.endDate,
      startDate: sliced.startBar.date,
      endDate: sliced.endBar.date,
      tradingDays: sliced.endIndex - sliced.startIndex + 1,
    },
    official: {
      startLevel: round(sliced.startBar.close, 2),
      endLevel: round(sliced.endBar.close, 2),
      returnPct: round(officialReturn * 100, 2),
      changePoints: round(officialChangePoints, 2),
    },
    dewater: {
      startLevel: round(chartStart, 2),
      endLevel: round(dewaterLevel, 2),
      returnPct: round(dewaterReturnFromSeries * 100, 2),
      changePoints: round(chartEnd - chartStart, 2),
      differencePp: round((dewaterReturnFromSeries - officialReturn) * 100, 2),
      sameDivisorLevel: round(sameDivisorLevel, 2),
      pointsBelowOfficial: round(pointsBelowOfficial, 2),
    },
    selection: {
      matchedCount,
      missingHistoryCount,
      selectedWeightPct: round(selectedWeight * 100, 2),
      remainingWeightPct: round(remainingWeight * 100, 2),
      remainingCount: Math.max(0, universe.length - matchedCount),
      weightedReturnPct: round(weightedReturn * 100, 2),
      items,
    },
    attribution: {
      officialChangePoints: round(officialChangePoints, 2),
      removedPoints: round(removedPoints, 2),
      remainingPoints: round(remainingPoints, 2),
      removedShareOfAbsoluteMovePct: Math.abs(officialChangePoints) > 0.000001
        ? round((Math.abs(removedPoints) / Math.abs(officialChangePoints)) * 100, 1)
        : null,
    },
    chart: series,
    sliced,
  };
}

export function buildConclusion({ selectionLabels = [], result, official }) {
  if (!result) {
    return {
      tone: 'neutral',
      title: '当前区间暂无可计算的脱水结果',
      text: '请选择至少一个行业或个股后重新计算。',
    };
  }
  const difference = result.dewater.differencePp;
  const officialPct = official.returnPct;
  const dewaterPct = result.dewater.returnPct;
  const names = selectionLabels.length ? selectionLabels.join(' + ') : '所选股票';
  const dir = (value) => value > 0 ? '上涨' : value < 0 ? '下跌' : '持平';
  const absText = (value) => `${Math.abs(value).toFixed(2)}%`;
  const pointGap = result.dewater.pointsBelowOfficial;
  const pointText = pointGap == null
    ? ''
    : pointGap < 0
      ? `当前脱水点位 ${Number(result.dewater.sameDivisorLevel).toFixed(2)}，比官方指数低 ${Math.abs(pointGap).toFixed(2)} 点。`
      : `当前脱水点位 ${Number(result.dewater.sameDivisorLevel).toFixed(2)}，比官方指数高 ${Math.abs(pointGap).toFixed(2)} 点。`;
  const intervalText = `按当前分析区间、以首日为基准，官方指数${dir(officialPct)} ${absText(officialPct)}，脱水指数${dir(dewaterPct)} ${absText(dewaterPct)}。`;

  if (difference <= -0.15) {
    if (officialPct >= 0 && dewaterPct < 0) {
      return {
        tone: 'divergence',
        title: '官方上涨，剩余股票却在下跌',
        text: `${pointText}${intervalText}这说明官方指数的上涨主要由被剔除权重股贡献，市场结构存在明显背离。`,
      };
    }
    return {
      tone: 'weighted',
      title: '剔除后跌幅更大，权重股支撑了官方指数',
      text: `${pointText}${intervalText}被剔除股票跑赢剩余市场，因此官方指数表现好于其余股票。`,
    };
  }
  if (difference >= 0.15) {
    return {
      tone: 'drag',
      title: '剔除后表现更强，权重股拖累了官方指数',
      text: `${pointText}${intervalText}被剔除股票弱于剩余市场，因此官方指数被权重股拖累。`,
    };
  }
  return {
    tone: 'neutral',
    title: '权重股对指数结构影响有限',
    text: `${pointText}${intervalText}所选权重股没有显著改变市场整体的涨跌方向。`,
  };
}

export function summarizeSelectionLabels({ industryIds = [], stocks = [], universe = [] } = {}) {
  const { labels } = industryAliasesForIds(industryIds);
  const stockNames = normalizeManualStocks(stocks).map((stock) => {
    const row = universe.find((item) => item.code === stock.code);
    return row?.name || stock.name;
  });
  return [...labels, ...stockNames];
}

export function rangeForClient(rangeId, startDate, endDate, now = new Date()) {
  return resolveRange({ range: rangeId, startDate, endDate, now });
}

function cacheControl(maxAgeSeconds = 300) {
  return { 'Cache-Control': `public, max-age=0, s-maxage=${maxAgeSeconds}, stale-while-revalidate=60` };
}

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://quote.eastmoney.com/',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/plain,*/*', Referer: 'https://gu.qq.com/' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export function mergeLiveBar(bars, liveBar) {
  if (!liveBar?.date || !(liveBar.close > 0)) return bars;
  const next = (Array.isArray(bars) ? bars : []).filter((bar) => bar.date !== liveBar.date);
  next.push(liveBar);
  next.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return next;
}

async function fetchLiveIndexBar(startDate, endDate) {
  try {
    const text = await fetchText('https://qt.gtimg.cn/q=sh000001', 8000);
    const match = text.match(/v_sh000001="([^"]*)"/);
    if (!match) return null;
    const f = match[1].split('~');
    const close = positive(f[3]);
    const time = String(f[30] || '');
    if (close == null || !/^\d{8}/.test(time)) return null;
    const date = `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)}`;
    if ((startDate && date < startDate) || (endDate && date > endDate)) return null;
    return {
      date,
      open: positive(f[5]),
      close,
      high: positive(f[33]),
      low: positive(f[34]),
      volume: num(f[6]),
      source: 'tencent-live',
    };
  } catch {
    return null;
  }
}

async function fetchTencentLiveStockBars(codes, startDate, endDate) {
  const result = new Map();
  if (!codes.length) return result;
  const symbols = codes.filter((code) => /^\d{6}$/.test(code)).map((code) => `sh${code}`);
  if (!symbols.length) return result;
  try {
    const text = await fetchText(`https://qt.gtimg.cn/q=${symbols.join(',')}`, 10000);
    for (const match of text.matchAll(/v_(sh\d{6})="([^"]*)"/g)) {
      const code = match[1].slice(2);
      const quote = parseTencentQuote(`v_${match[1]}="${match[2]}"`);
      if (!quote || quote.isPreviousClose || !quote.tradeDate || !(quote.price > 0)) continue;
      if ((startDate && quote.tradeDate < startDate) || (endDate && quote.tradeDate > endDate)) continue;
      result.set(code, {
        date: quote.tradeDate,
        open: quote.open,
        close: quote.price,
        high: quote.high,
        low: quote.low,
        volume: quote.volume,
        source: 'tencent-live',
      });
    }
  } catch {
    /* live add-on is best effort */
  }
  return result;
}

const universeCache = new Map();
const klineCache = new Map();

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function universeQuery(page) {
  return new URLSearchParams({
    pn: String(page),
    pz: String(PAGE_SIZE),
    po: '0',
    np: '1',
    fltt: '2',
    invt: '2',
    fid: 'f12',
    fs: 'm:1+t:2,m:1+t:3,m:1+t:23',
    fields: 'f12,f14,f2,f3,f20,f21,f100,f127',
  }).toString();
}

function sinaListQuery(page, node = 'sh_a') {
  return new URLSearchParams({
    page: String(page),
    num: String(PAGE_SIZE),
    sort: 'symbol',
    asc: '1',
    node,
    symbol: '',
  }).toString();
}

async function fetchSinaRows(node, pages = 3) {
  const settled = await Promise.allSettled(
    Array.from({ length: pages }, (_, index) =>
      fetchJson(`${SINA_LIST}?${sinaListQuery(index + 1, node)}`, 12000),
    ),
  );
  return settled.flatMap((item) => (item.status === 'fulfilled' && Array.isArray(item.value) ? item.value : []));
}

async function fetchSinaFallbackUniverse() {
  const pageSettled = await Promise.allSettled(
    Array.from({ length: 30 }, (_, index) =>
      fetchJson(`${SINA_LIST}?${sinaListQuery(index + 1)}`, 12000),
    ),
  );
  const rows = pageSettled.flatMap((item) => (item.status === 'fulfilled' && Array.isArray(item.value) ? item.value : []));
  if (rows.length < 1000) throw new Error('新浪上证样本列表不可用');

  const [financialRows, oilRows, coalRows, liquorRows, realEstateRows, constructionRows] = await Promise.all([
    fetchSinaRows('new_jrhy'),
    fetchSinaRows('new_syhy'),
    fetchSinaRows('new_mthy'),
    fetchSinaRows('new_ljhy'),
    fetchSinaRows('new_fdc'),
    fetchSinaRows('new_jzjc'),
  ]);
  const industryByCode = new Map();
  // 先用完整沪市清单按代码/名称识别金融股，避免行业板块分页偶发失败漏掉银行。
  for (const row of rows) {
    const code = String(row?.code || '');
    const industry = inferFinancialIndustry(code, row?.name);
    if (industry !== '未分类') industryByCode.set(code, industry);
  }
  for (const row of financialRows) {
    const code = String(row?.code || '');
    const industry = inferFinancialIndustry(code, row?.name);
    if (industry !== '未分类') industryByCode.set(code, industry);
  }
  for (const row of oilRows) if (/^(?:60|68)/.test(String(row?.code || ''))) industryByCode.set(String(row.code), '石油石化');
  for (const row of coalRows) if (/^(?:60|68)/.test(String(row?.code || ''))) industryByCode.set(String(row.code), '煤炭开采');
  for (const row of liquorRows) if (/^(?:60|68)/.test(String(row?.code || '')) && inferBaijiu(row)) industryByCode.set(String(row.code), '白酒Ⅱ');
  for (const row of realEstateRows) if (/^(?:60|68)/.test(String(row?.code || ''))) industryByCode.set(String(row.code), '房地产开发');
  for (const row of constructionRows) if (/^(?:60|68)/.test(String(row?.code || ''))) industryByCode.set(String(row.code), '基础建设');

  const value = normalizeSinaUniverseRows(rows, industryByCode);
  if (!value.length) throw new Error('新浪上证样本解析失败');
  return value;
}

export async function fetchShanghaiUniverse({ force = false } = {}) {
  const cacheKey = 'shanghai-all';
  const hit = universeCache.get(cacheKey);
  if (!force && hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.value;

  try {
    const first = await fetchJson(`${EM_CLIST}?${universeQuery(1)}`);
    const total = Number(first?.data?.total || 0);
    if (!total) throw new Error('上证指数样本列表暂不可用');
    const pageCount = Math.ceil(total / PAGE_SIZE);
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
        fetchJson(`${EM_CLIST}?${universeQuery(index + 2)}`),
      ),
    );
    const rows = [...(first?.data?.diff || []), ...rest.flatMap((payload) => payload?.data?.diff || [])];
    const value = normalizeUniverseRows(rows);
    if (!value.length) throw new Error('上证指数样本解析失败');
    universeCache.set(cacheKey, { at: Date.now(), value, source: 'eastmoney' });
    return value;
  } catch {
    try {
      const value = await fetchSinaFallbackUniverse();
      universeCache.set(cacheKey, { at: Date.now(), value, source: 'sina' });
      return value;
    } catch {
      throw new Error('上证指数样本行情源均不可用');
    }
  }
}

export async function fetchIndexKline({ startDate, endDate, force = false } = {}) {
  const key = `index:${startDate}:${endDate}`;
  const hit = klineCache.get(key);
  if (!force && hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.value;
  const finalize = async (bars, source) => {
    const liveBar = await fetchLiveIndexBar(startDate, endDate);
    const value = mergeLiveBar(bars, liveBar);
    klineCache.set(key, { at: Date.now(), value, source });
    return value;
  };

  try {
    const params = new URLSearchParams({
      secid: INDEX_DEWATER_INDEX.secid,
      klt: '101',
      fqt: '0',
      lmt: '1000',
      end: String(endDate || '').replaceAll('-', '') || '20500101',
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    });
    if (startDate) params.set('beg', String(startDate).replaceAll('-', ''));
    const payload = await fetchJson(`${EM_KLINE}?${params.toString()}`);
    const bars = parseEastmoneyKline(payload);
    if (bars.length >= 2) {
      const value = filterKlineWindow(bars, startDate, endDate);
      if (value.length >= 2) return finalize(value, 'eastmoney');
    }
  } catch {
    /* 尝试腾讯/新浪指数日线 */
  }

  try {
    const payload = await fetchJson(`${TENCENT_KLINE}?param=sh000001,day,,,1000,qfq`, 12000);
    const value = filterKlineWindow(parseTencentKline(payload, 'sh000001'), startDate, endDate);
    if (value.length >= 2) return finalize(value, 'tencent');
  } catch {
    /* 继续新浪兜底 */
  }

  try {
    const params = new URLSearchParams({ symbol: 'sh000001', scale: '240', ma: 'no', datalen: '1000' });
    const payload = await fetchJson(`${SINA_KLINE}?${params.toString()}`, 12000);
    const value = filterKlineWindow(parseSinaKline(payload), startDate, endDate);
    if (value.length >= 2) return finalize(value, 'sina');
  } catch {
    /* 统一在下方报错 */
  }
  throw new Error('官方指数历史行情暂不可用');
}

export async function fetchStockKline(code, { startDate, endDate, force = false } = {}) {
  const target = String(code || '').trim();
  if (!/^\d{6}$/.test(target)) return [];
  const key = `stock:${target}:${startDate}:${endDate}`;
  const hit = klineCache.get(key);
  if (!force && hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.value;

  try {
    const params = new URLSearchParams({
      secid: `1.${target}`,
      klt: '101',
      fqt: '1',
      lmt: '1000',
      end: String(endDate || '').replaceAll('-', '') || '20500101',
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    });
    if (startDate) params.set('beg', String(startDate).replaceAll('-', ''));
    const payload = await fetchJson(`${EM_KLINE}?${params.toString()}`, 10000);
    const value = filterKlineWindow(parseEastmoneyKline(payload), startDate, endDate);
    if (value.length) {
      klineCache.set(key, { at: Date.now(), value, source: 'eastmoney' });
      return value;
    }
  } catch {
    /* 尝试腾讯/新浪个股日线 */
  }

  const symbol = `sh${target}`;
  try {
    const payload = await fetchJson(`${TENCENT_KLINE}?param=${symbol},day,,,1000,qfq`, 12000);
    const value = filterKlineWindow(parseTencentKline(payload, symbol), startDate, endDate);
    if (value.length) {
      klineCache.set(key, { at: Date.now(), value, source: 'tencent' });
      return value;
    }
  } catch {
    /* 继续新浪兜底 */
  }

  try {
    const params = new URLSearchParams({ symbol, scale: '240', ma: 'no', datalen: '1000' });
    const payload = await fetchJson(`${SINA_KLINE}?${params.toString()}`, 12000);
    const value = filterKlineWindow(parseSinaKline(payload), startDate, endDate);
    if (value.length) {
      klineCache.set(key, { at: Date.now(), value, source: 'sina' });
      return value;
    }
  } catch {
    /* 单只股票失败不阻断整体报告 */
  }
  return [];
}

export async function fetchStockBarsMap(codes = [], options = {}) {
  const unique = [...new Set((Array.isArray(codes) ? codes : []).filter((code) => /^\d{6}$/.test(code)))];
  const entries = await mapLimit(unique, 14, async (code) => [code, await fetchStockKline(code, options)]);
  const map = new Map(entries);
  const liveBars = await fetchTencentLiveStockBars(unique, options.startDate, options.endDate);
  for (const [code, liveBar] of liveBars) {
    map.set(code, mergeLiveBar(map.get(code) || [], liveBar));
  }
  return map;
}

function buildCard(key, label, mode, result, selectionText) {
  if (!result) {
    return {
      key,
      label,
      mode,
      selectionText,
      level: null,
      remainingPointLevel: null,
      pointsBelowOfficial: null,
      returnPct: null,
      differencePp: null,
      cutoff: null,
      available: false,
    };
  }
  return {
    key,
    label,
    mode,
    selectionText,
    level: result.dewater.endLevel,
    remainingPointLevel: result.dewater.sameDivisorLevel,
    pointsBelowOfficial: result.dewater.pointsBelowOfficial,
    returnPct: result.dewater.returnPct,
    differencePp: result.dewater.differencePp,
    cutoff: result.range.endDate,
    available: true,
    removedCount: result.selection.matchedCount,
  };
}

export async function buildIndexDewaterReport({
  range = DEFAULT_RANGE,
  startDate = '',
  endDate = '',
  industries = DEFAULT_INDUSTRIES,
  stocks = [],
  force = false,
  now = new Date(),
  fetchUniverse = fetchShanghaiUniverse,
  fetchIndexBars = fetchIndexKline,
  fetchBarsMap = fetchStockBarsMap,
} = {}) {
  const resolvedRange = resolveRange({ range, startDate, endDate, now });
  const historyStart = subtractMonths(resolvedRange.startDate, 0);
  // 多取日历日，覆盖春节等长假。
  const fetchStart = (() => {
    const [year, month, day] = historyStart.split('-').map(Number);
    const d = new Date(Date.UTC(year, month - 1, day));
    d.setUTCDate(d.getUTCDate() - 14);
    return d.toISOString().slice(0, 10);
  })();

  const [universe, officialBars] = await Promise.all([
    fetchUniverse({ force }),
    fetchIndexBars({ startDate: fetchStart, endDate: resolvedRange.endDate, force }),
  ]);
  const sliced = sliceRange(officialBars, resolvedRange);
  const currentSelection = resolveSelection({ universe, industries, stocks });

  if (currentSelection.finalCount > MAX_DEWATER_SELECTION) {
    throw new Error(`单次最多剔除 ${MAX_DEWATER_SELECTION} 只股票，请减少行业或个股条件`);
  }

  const unionCodes = [...new Set(currentSelection.items.map((row) => row.code))];
  const stockBarsByCode = await fetchBarsMap(unionCodes, {
    startDate: fetchStart,
    endDate: resolvedRange.endDate,
    force,
  });

  const applySelectionSources = (selection) => selection.items.map((row) => {
    const text = row.industryLabels?.length ? row.industryLabels.join(' / ') : row.industry;
    return { ...row, industryLabels: row.industryLabels?.length ? row.industryLabels : [text] };
  });

  const currentResult = currentSelection.finalCount
    ? computeDewaterAttribution({
        officialBars,
        stockBarsByCode,
        universe,
        selectedCodes: currentSelection.items.map((row) => row.code),
        range: resolvedRange,
      })
    : null;

  const selectionLabels = summarizeSelectionLabels({ industryIds: industries, stocks, universe });
  const conclusion = buildConclusion({
    selectionLabels,
    result: currentResult,
    official: {
      returnPct: currentResult?.official?.returnPct ?? (sliced.endBar.close / sliced.startBar.close - 1) * 100,
    },
  });
  const officialCard = {
    key: 'official',
    label: '官方上证指数',
    mode: '官方指数',
    selectionText: '上证综合指数',
    level: round(sliced.endBar.close, 2),
    returnPct: round((sliced.endBar.close / sliced.startBar.close - 1) * 100, 2),
    differencePp: 0,
    cutoff: sliced.endBar.date,
    available: true,
    removedCount: 0,
  };
  const schemeLabel = selectionLabels.length
    ? `${selectionLabels.slice(0, 4).join(' + ')}${selectionLabels.length > 4 ? ' 等' : ''}`
    : '当前方案';
  const currentCard = buildCard(
    'current',
    `${schemeLabel}脱水`,
    '同除数剩余点位',
    currentResult,
    currentResult ? `实际剔除 ${currentResult.selection.matchedCount} 只` : '未选择剔除条件',
  );
  const cards = [officialCard, currentCard];

  const currentSelectionItems = currentResult?.selection?.items || [];
  const matchedCodes = new Set(currentSelectionItems.map((row) => row.code));
  const selectedWithSources = applySelectionSources(currentSelection)
    .filter((row) => matchedCodes.has(row.code))
    .map((row) => {
      const stats = currentResult.selection.items.find((item) => item.code === row.code) || {};
      return {
        code: row.code,
        name: row.name,
        industry: row.industry,
        weightPct: stats.weightPct ?? null,
        returnPct: stats.returnPct ?? null,
        contributionPoints: stats.contributionPoints ?? null,
        sources: row.sources || ['stock'],
        industryLabels: row.industryLabels || [row.industry],
      };
    });
  if (currentResult) {
    currentResult.selection.items = selectedWithSources;
  }

  const sampleSource = universe.some((row) => row.source === 'sina') ? 'sina' : 'eastmoney';
  const industryCatalog = buildIndustryCatalog(universe);
  const industryGroups = INDUSTRY_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    count: universe.filter((row) => group.aliases.includes(row.industry)).length,
  }));
  const fixedIndustries = new Set(INDUSTRY_GROUPS.flatMap((group) => group.aliases));
  const customIndustryCount = universe.filter((row) => !fixedIndustries.has(row.industry)).length;

  return {
    ok: true,
    schemaVersion: 5,
    index: {
      ...INDEX_DEWATER_INDEX,
      universeCount: universe.length,
      methodology: '当前沪市样本 + 东财流通市值权重复刻',
    },
    asOf: sliced.endBar.date,
    updatedAt: new Date().toISOString(),
    range: {
      ...resolvedRange,
      startDate: sliced.startBar.date,
      endDate: sliced.endBar.date,
      tradingDays: currentResult?.range.tradingDays || sliced.endIndex - sliced.startIndex + 1,
    },
    cards,
    official: {
      level: officialCard.level,
      returnPct: officialCard.returnPct,
      startLevel: round(sliced.startBar.close, 2),
      changePoints: round(sliced.endBar.close - sliced.startBar.close, 2),
    },
    current: currentResult ? {
      ...currentResult,
      selection: {
        ...currentResult.selection,
        items: selectedWithSources,
        industries: currentSelection.industries,
        manualStocks: currentSelection.manualStocks,
        finalCount: currentSelection.finalCount,
        duplicateCount: currentSelection.duplicateCount,
        outsideItems: currentSelection.outsideItems,
        outsideCount: currentSelection.outsideItems.length,
      },
      conclusion,
    } : null,
    conclusion,
    industries: {
      groups: industryGroups,
      catalog: industryCatalog,
      customIndustryCount,
    },
    dataQuality: {
      level: '复刻口径',
      notes: [
        sampleSource === 'sina'
          ? '东方财富主源当前不可用，本次沪市样本已降级为新浪 A 股榜单；行业分组按名称与新浪行业板块规则估算。'
          : '沪市样本与行业字段来自东方财富；行业映射按申万一级行业名称归组。',
        '指数与个股日线依次尝试东方财富 → 腾讯证券 → 新浪财经，三类来源都使用同一交易日区间对齐。',
        '权重使用 f21/nmc 流通市值，全样本合计与上证指数流通市值口径对齐；不使用会混入 H 股的总市值。',
        'V1 使用当前沪市 A/B 股样本与当前指数权重，未接入历史成分股和历史股本。',
        '指标卡主数字为同除数剩余点位；区间收益来自独立脱水指数，按区间首日归一，两者标签分开展示。',
        '个股收益使用前复权日线；停牌、退市、新股及公司行为会造成复刻误差。',
      ],
      sources: sampleSource === 'sina'
        ? ['新浪财经：沪市 A 股样本', '新浪财经：行业板块', '腾讯/新浪：指数与个股日线']
        : ['东方财富：上证指数日线', '东方财富：沪市股票快照', '东方财富：个股前复权日线', '东方财富：行业分类字段'],
    },
    meta: {
      selectionLabels,
      maxSelection: MAX_DEWATER_SELECTION,
      cacheSeconds: 300,
    },
  };
}

export const __test__ = {
  num,
  round,
  positive,
  subtractMonths,
  formatDateUtc,
  closeAtOrBefore,
  buildCard,
  cacheControl,
};
