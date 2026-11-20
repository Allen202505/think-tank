import { resolveRange } from './indexDewater.mjs';

export const BREADTH_THRESHOLDS = [5000, 4000, 3000];
export const BREADTH_BUCKETS = [
  { id: 'lt1000', label: '少于1000家', min: 0, max: 999 },
  { id: '1000', label: '1000-1999家', min: 1000, max: 1999 },
  { id: '2000', label: '2000-2999家', min: 2000, max: 2999 },
  { id: '3000', label: '3000-3999家', min: 3000, max: 3999 },
  { id: '4000', label: '4000-4999家', min: 4000, max: 4999 },
  { id: '5000', label: '5000家以上', min: 5000, max: Infinity },
];

function pct(value, total) {
  if (!total) return null;
  return Math.round((value / total) * 1000) / 10;
}

function rankLargest(values, target) {
  if (target == null || !Number.isFinite(Number(target))) return null;
  return 1 + values.filter((value) => Number(value) > Number(target)).length;
}

function rankLargestDrop(values, target) {
  if (target == null || !Number.isFinite(Number(target))) return null;
  return 1 + values.filter((value) => Number(value) < Number(target)).length;
}

export function computeMarketBreadthStats(history, options = {}) {
  const range = resolveRange({
    range: options.range || '1y',
    startDate: options.startDate || '',
    endDate: options.endDate || '',
    now: options.now || new Date(),
  });
  const allDays = Array.isArray(history?.days) ? history.days.filter((day) => day?.date && Number(day.total) > 0) : [];
  if (!allDays.length) throw new Error('涨跌家数历史数据不可用');
  let days;
  if (range.id === 'today' || range.id === 'yesterday') {
    const latest = allDays.filter((day) => day.date <= range.endDate).at(-1);
    days = latest ? [latest] : [];
  } else {
    days = allDays.filter((day) => day.date >= range.startDate && day.date <= range.endDate);
  }
  if (!days.length) throw new Error('所选区间没有涨跌家数数据');

  const latest = days[days.length - 1];
  const tradingDays = days.length;
  const thresholdStats = BREADTH_THRESHOLDS.map((threshold) => {
    const count = days.filter((day) => Number(day.down) >= threshold).length;
    return {
      threshold,
      label: `${threshold}家以上`,
      count,
      ratioPct: pct(count, tradingDays),
    };
  });
  const buckets = BREADTH_BUCKETS.map((bucket) => {
    const count = days.filter((day) => Number(day.down) >= bucket.min && Number(day.down) <= bucket.max).length;
    return { ...bucket, count, ratioPct: pct(count, tradingDays) };
  });
  const todayBucket = buckets.find((bucket) => Number(latest.down) >= bucket.min && Number(latest.down) <= bucket.max) || null;
  const downValues = days.map((day) => Number(day.down) || 0);
  const indexChangeValues = days.map((day) => Number(day.indexChangePct)).filter(Number.isFinite);
  const todayDownRank = rankLargest(downValues, latest.down);
  const todayIndexDropRank = rankLargestDrop(indexChangeValues, latest.indexChangePct);

  return {
    range: {
      id: range.id,
      label: range.label,
      requestedStartDate: range.startDate,
      requestedEndDate: range.endDate,
      startDate: days[0].date,
      endDate: latest.date,
      tradingDays,
    },
    coverage: {
      sourceStartDate: history.startDate,
      sourceEndDate: history.endDate,
      universeCount: history.universeCount,
      source: history.source,
      methodology: history.methodology,
      partial: range.startDate < history.startDate,
    },
    latest: {
      date: latest.date,
      isLatestTradingDay: latest.date === history.endDate,
      up: Number(latest.up) || 0,
      down: Number(latest.down) || 0,
      flat: Number(latest.flat) || 0,
      total: Number(latest.total) || 0,
      indexChangePct: Number.isFinite(Number(latest.indexChangePct)) ? Number(latest.indexChangePct) : null,
      bucket: todayBucket?.label || null,
    },
    thresholds: thresholdStats,
    buckets,
    ranks: {
      downCount: {
        rank: todayDownRank,
        total: tradingDays,
        label: todayDownRank ? `区间内第 ${todayDownRank} 多 / ${tradingDays} 个交易日` : '暂无排名',
      },
      indexDecline: {
        rank: todayIndexDropRank,
        total: indexChangeValues.length,
        label: todayIndexDropRank ? `区间内第 ${todayIndexDropRank} 大单日跌幅 / ${indexChangeValues.length} 个交易日` : '暂无排名',
      },
    },
  };
}
