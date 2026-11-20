'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight, ArrowUpRight, BadgeCheck, ChartNoAxesCombined, ChevronDown,
  CircleHelp, Database, Droplets, Filter, Info, Landmark, ListFilter, LoaderCircle,
  Minus, Plus, RefreshCw, Search, ShieldCheck, X,
} from 'lucide-react';
import ModuleHero from './ModuleHero';
import { readApiResponse } from '../lib/apiResponse.mjs';
import { marketAwareTtlMs, readJsonCache, writeJsonCache } from '../lib/browserCache.mjs';
import {
  DEFAULT_INDUSTRIES, DEFAULT_RANGE, INDUSTRY_GROUPS,
  QUICK_STOCKS, RANGE_OPTIONS, resolveRange, shanghaiDateString,
} from '../lib/indexDewater.mjs';
import styles from './IndexDewater.module.css';

const LS_KEY = 'thinktank_index_dewater_state_v2';
const ANALYSIS_RANGE = '1y';
const DEFAULT_CUSTOM_START = resolveRange({ range: '1y' }).startDate;
const RESULT_CACHE_SCOPE = 'index-dewater-v5';
const RESULT_SCHEMA_VERSION = 5;
const BREADTH_CACHE_SCOPE = 'market-breadth-v1';
const LOADING_STEPS = [
  '正在拉取上证指数与全市场样本…',
  '正在校验行业、个股与指数样本资格…',
  '正在对齐区间交易日与复权价格…',
  '正在拆解权重股点位贡献…',
  '正在生成独立脱水指数…',
];

function fmt(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toFixed(digits);
}

function pct(value, withSign = true) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const sign = withSign && n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function toneFor(value) {
  if (value == null) return styles.flat;
  if (Number(value) > 0.0001) return styles.up;
  if (Number(value) < -0.0001) return styles.down;
  return styles.flat;
}

function customIndustryLabel(id) {
  try {
    return decodeURIComponent(String(id || '').slice(7));
  } catch {
    return String(id || '').slice(7);
  }
}

function selectionKey(rangeId, startDate, endDate, industries, stocks) {
  return JSON.stringify({
    range: rangeId,
    startDate: rangeId === 'custom' ? startDate : '',
    endDate: rangeId === 'custom' ? endDate : '',
    industries: [...industries].sort(),
    stocks: stocks.map((stock) => stock.code).sort(),
  });
}

function MetricCard({ card, icon: Icon }) {
  const available = card?.available;
  const isOfficial = card?.key === 'official';
  const mainLevel = isOfficial ? card?.level : card?.remainingPointLevel;
  const pointDelta = card?.pointsBelowOfficial;
  return (
    <article className={`${styles.metricCard} ${isOfficial ? styles.metricOfficial : ''}`}>
      <div className={styles.metricTop}>
        <span className={styles.metricIcon}><Icon size={17} /></span>
        <span className={styles.metricMode}>{card?.mode || '同除数剩余点位'}</span>
      </div>
      <div className={styles.metricLabel}>{card?.label || '数据加载中'}</div>
      <div className={styles.metricLevel}>{available ? fmt(mainLevel) : '—'}</div>
      <div className={styles.metricPointLine}>
        {isOfficial ? (
          <span>当前官方点位</span>
        ) : (
          <>
            <span className={toneFor(pointDelta)}>较官方 {pointDelta > 0 ? '+' : ''}{fmt(pointDelta)} 点</span>
            <span>保留官方除数</span>
          </>
        )}
      </div>
      <div className={styles.metricBottom}>
        <span className={`${styles.metricReturn} ${toneFor(card?.returnPct)}`}>
          {card?.returnPct > 0 ? <ArrowUpRight size={14} /> : card?.returnPct < 0 ? <ArrowDownRight size={14} /> : <Minus size={14} />}
          <small>{isOfficial ? '区间' : '独立区间'}</small>
          {available ? pct(card.returnPct) : '—'}
        </span>
        <span className={styles.metricDiff}>
          {isOfficial ? '对比基准' : `实际剔除 ${card?.removedCount ?? 0} 只`}
        </span>
      </div>
      <div className={styles.metricFoot}>
        <span>{card?.selectionText || '—'}</span>
        <span>{card?.cutoff || '—'}</span>
      </div>
    </article>
  );
}

function DewaterChart({ chart, officialReturn, dewaterReturn }) {
  const [active, setActive] = useState(null);
  const width = 820;
  const height = 324;
  const pad = { left: 48, right: 18, top: 34, bottom: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const n = chart?.dates?.length || 0;
  const all = [...(chart?.official || []), ...(chart?.dewater || [])].filter((v) => Number.isFinite(Number(v)));
  const minValue = all.length ? Math.min(...all) : 0;
  const maxValue = all.length ? Math.max(...all) : 1;
  const span = Math.max(1, maxValue - minValue);
  const yMin = minValue - span * 0.12;
  const yMax = maxValue + span * 0.12;
  const x = (index) => pad.left + (n <= 1 ? 0 : (index / (n - 1)) * plotW);
  const y = (value) => pad.top + ((yMax - Number(value)) / (yMax - yMin || 1)) * plotH;
  const pathFor = (values) => values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(' ');
  const areaPath = chart?.dewater?.length
    ? `${pathFor(chart.dewater)} L${x(n - 1).toFixed(2)},${(pad.top + plotH).toFixed(2)} L${pad.left},${(pad.top + plotH).toFixed(2)} Z`
    : '';
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const value = yMax - ((yMax - yMin) * index) / 4;
    return { value, y: pad.top + (plotH * index) / 4 };
  });
  const xLabels = n ? [0, Math.floor((n - 1) / 2), n - 1] : [];

  const onMove = (event) => {
    if (!n) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const local = ((event.clientX - rect.left) / Math.max(1, rect.width)) * width;
    const ratio = Math.max(0, Math.min(1, (local - pad.left) / plotW));
    setActive(Math.round(ratio * (n - 1)));
  };

  const activeData = active != null && n ? {
    date: chart.dates[active],
    official: chart.official[active],
    dewater: chart.dewater[active],
    gap: chart.gap[active],
  } : null;
  const tooltipX = active != null ? Math.min(width - 184, Math.max(10, x(active) - 84)) : 0;

  if (!n) {
    return (
      <div className={styles.chartEmpty}>
        <ChartNoAxesCombined size={26} />
        <strong>暂无走势数据</strong>
        <p>切换区间或减少剔除范围后重试。</p>
      </div>
    );
  }

  return (
    <div className={styles.chartWrap}>
      <div className={styles.chartLegend}>
        <span><i className={styles.legendOfficial} />上证指数</span>
        <span><i className={styles.legendDewater} />脱水后上证指数</span>
        <span className={styles.chartSpread}>官方 {pct(officialReturn)} · 脱水 <b className={toneFor(dewaterReturn)}>{pct(dewaterReturn)}</b></span>
      </div>
      <svg
        className={styles.chartSvg}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="官方上证指数与独立脱水指数走势对比"
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
      >
        <defs>
          <linearGradient id="dew-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.19" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick.y}>
            <line x1={pad.left} x2={width - pad.right} y1={tick.y} y2={tick.y} className={styles.chartGrid} />
            <text x={pad.left - 9} y={tick.y + 4} textAnchor="end" className={styles.chartAxisText}>{fmt(tick.value, 0)}</text>
          </g>
        ))}
        {xLabels.map((index, i) => (
          <text
            key={`${index}-${i}`}
            x={x(index)}
            y={height - 14}
            textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
            className={styles.chartAxisText}
          >
            {chart.dates[index]}
          </text>
        ))}
        <path d={areaPath} fill="url(#dew-area)" />
        <path d={pathFor(chart.official)} className={styles.officialLine} />
        <path d={pathFor(chart.dewater)} className={styles.dewaterLine} />
        <circle cx={x(n - 1)} cy={y(chart.official[n - 1])} r="3.5" className={styles.officialPoint} />
        <circle cx={x(n - 1)} cy={y(chart.dewater[n - 1])} r="4.5" className={styles.dewaterPoint} />
        {activeData && (
          <g pointerEvents="none">
            <line x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + plotH} className={styles.crosshair} />
            <circle cx={x(active)} cy={y(activeData.official)} r="4" className={styles.officialPoint} />
            <circle cx={x(active)} cy={y(activeData.dewater)} r="5" className={styles.dewaterPoint} />
            <g transform={`translate(${tooltipX}, 10)`}>
              <rect width="174" height="76" rx="10" className={styles.chartTooltipBg} />
              <text x="11" y="18" className={styles.chartTooltipDate}>{activeData.date}</text>
              <text x="11" y="39" className={styles.chartTooltipLabel}>官方</text>
              <text x="162" y="39" textAnchor="end" className={styles.chartTooltipValue}>{fmt(activeData.official)}</text>
              <text x="11" y="58" className={styles.chartTooltipLabel}>脱水</text>
              <text x="162" y="58" textAnchor="end" className={styles.chartTooltipValue}>{fmt(activeData.dewater)}</text>
              <text x="11" y="73" className={styles.chartTooltipMuted}>区间收益 {pct(officialReturn)}</text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

function ContributionList({ items = [] }) {
  const rows = items.slice(0, 8);
  const max = Math.max(0.001, ...rows.map((row) => Math.abs(Number(row.contributionPoints) || 0)));
  if (!rows.length) {
    return <div className={styles.emptyInline}>暂无可归因的剔除股票。</div>;
  }
  return (
    <div className={styles.contributionList}>
      {rows.map((row) => {
        const value = Number(row.contributionPoints) || 0;
        return (
          <div className={styles.contributionRow} key={row.code}>
            <div className={styles.contributionName}>
              <strong>{row.name}</strong>
              <span>{row.code} · {row.industry}</span>
            </div>
            <div className={styles.contributionTrack}>
              <i
                className={value >= 0 ? styles.contributionPositive : styles.contributionNegative}
                style={{ width: `${Math.max(4, (Math.abs(value) / max) * 100)}%` }}
              />
            </div>
            <div className={styles.contributionNum}>
              <b className={toneFor(value)}>{value > 0 ? '+' : ''}{fmt(value)}</b>
              <span>{pct(row.returnPct)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SelectionTable({ items = [] }) {
  if (!items.length) return <div className={styles.emptyInline}>没有通过样本与历史行情校验的剔除股票。</div>;
  return (
    <div className={styles.tableScroll}>
      <table className={styles.selectionTable}>
        <thead>
          <tr>
            <th>股票</th>
            <th>行业</th>
            <th className={styles.numCell}>当前权重</th>
            <th className={styles.numCell}>区间涨跌</th>
            <th className={styles.numCell}>点位贡献</th>
            <th>来源</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.code}>
              <td><strong>{row.name}</strong><small>{row.code}</small></td>
              <td>{row.industry}</td>
              <td className={styles.numCell}>{row.weightPct == null ? '—' : `${fmt(row.weightPct, 2)}%`}</td>
              <td className={`${styles.numCell} ${toneFor(row.returnPct)}`}>{pct(row.returnPct)}</td>
              <td className={`${styles.numCell} ${toneFor(row.contributionPoints)}`}>
                {row.contributionPoints == null ? '—' : `${row.contributionPoints > 0 ? '+' : ''}${fmt(row.contributionPoints)}`}
              </td>
              <td>
                <span className={styles.sourceTag}>
                  {row.sources?.includes('industry') && row.sources?.includes('stock') ? '行业+个股' : row.sources?.includes('industry') ? '行业' : '个股'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BreadthDashboard({
  data,
  loading,
  error,
  range,
  customStart,
  customEnd,
  onCustomStart,
  onCustomEnd,
  onRangeChange,
  onApplyCustom,
  onRetry,
}) {
  const buckets = data?.buckets || [];
  const maxBucket = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const latest = data?.latest;
  const latestLabel = range === 'today' ? '今天' : range === 'yesterday' ? '昨天' : latest?.isLatestTradingDay ? '今日' : '区间末日';
  const thresholdTone = ['bad', 'warm', 'calm'];
  const shortBucketLabel = (label) => label.replace('少于', '<').replace('1000-1999家', '1k-2k').replace('2000-2999家', '2k-3k').replace('3000-3999家', '3k-4k').replace('4000-4999家', '4k-5k').replace('5000家以上', '≥5k');
  return (
    <section className={`${styles.panel} ${styles.breadthPanel}`} aria-busy={loading}>
      <div className={styles.breadthHead}>
        <div>
          <span className={styles.panelKicker}><ChartNoAxesCombined size={14} /> MARKET BREADTH</span>
          <h3>全 A 股涨跌家数大盘</h3>
          <p>统计沪深北 A 股每日下跌家数，观察市场是普跌还是结构性下跌。</p>
        </div>
        <div className={styles.breadthRange}>
          {RANGE_OPTIONS.filter((option) => option.id !== 'ytd').map((option) => (
            <button
              key={option.id}
              type="button"
              className={range === option.id ? styles.rangeActive : ''}
              onClick={() => onRangeChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {range === 'custom' && (
        <div className={styles.breadthCustom}>
          <input type="date" value={customStart} max={customEnd || shanghaiDateString()} onChange={(event) => onCustomStart(event.target.value)} aria-label="大盘统计开始日期" />
          <span>至</span>
          <input type="date" value={customEnd} min={customStart} max={shanghaiDateString()} onChange={(event) => onCustomEnd(event.target.value)} aria-label="大盘统计结束日期" />
          <button type="button" onClick={onApplyCustom}>应用统计区间</button>
        </div>
      )}

      {error && !loading && (
        <div className={styles.breadthError}>
          <span>{error}</span>
          <button type="button" onClick={onRetry}>重试</button>
        </div>
      )}

      {loading && !data ? (
        <div className={styles.breadthLoading}>
          <LoaderCircle size={20} className={styles.spin} />
          <span>正在统计区间涨跌家数…</span>
        </div>
      ) : data ? (
        <>
          <div className={styles.breadthTodayLine}>
            <span className={styles.breadthTodayLabelInline}>{latestLabel} · {latest?.date}</span>
            <span>下跌 <strong>{fmt(latest?.down, 0)}</strong> 家</span>
            <span>上涨 {fmt(latest?.up, 0)} 家</span>
            <span>平盘 {fmt(latest?.flat, 0)} 家</span>
            <span className={styles.breadthRankInline}>{data.ranks?.downCount?.label}</span>
            <span>上证 <b className={toneFor(latest?.indexChangePct)}>{pct(latest?.indexChangePct)}</b> · {data.ranks?.indexDecline?.label}</span>
          </div>

          <div className={styles.breadthContentGrid}>
            <div className={styles.breadthDistribution}>
              <div className={styles.breadthDistHead}>
                <strong>下跌家数分布</strong>
                <span>{data.range?.startDate} → {data.range?.endDate} · {data.range?.tradingDays} 个交易日</span>
              </div>
              <div className={styles.breadthColumnChart}>
                {buckets.map((bucket) => (
                  <div key={bucket.id} className={`${styles.breadthColumn} ${latest?.bucket === bucket.label ? styles.breadthColumnToday : ''}`}>
                    <span className={styles.breadthColumnCount}>{fmt(bucket.count, 0)}天</span>
                    <div className={styles.breadthColumnTrack}>
                      <i style={{ height: `${Math.max(bucket.count ? 3 : 0, (bucket.count / maxBucket) * 100)}%` }} />
                    </div>
                    <span className={styles.breadthColumnLabel}>{shortBucketLabel(bucket.label)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className={styles.thresholdGrid}>
              {(data.thresholds || []).map((row, index) => (
                <div key={row.threshold} className={`${styles.thresholdCard} ${styles[`threshold_${thresholdTone[index] || 'calm'}`]}`}>
                  <span>下跌 {fmt(row.threshold, 0)} 家以上</span>
                  <div className={styles.thresholdValueRow}>
                    <strong>{fmt(row.count, 0)}<small> 天</small></strong>
                    <em className={styles.thresholdRatio}>占区间 {fmt(row.ratioPct, 1)}%</em>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className={styles.breadthNote}>
            <Info size={13} /> 数据按当前沪深北 A 股列表回溯日线聚合；停牌或无当日行情不计入。此处区间只影响涨跌家数统计，不改变上方指数对比与当前点位。
          </p>
        </>
      ) : null}
    </section>
  );
}

export default function IndexDewater() {
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [customStart, setCustomStart] = useState(DEFAULT_CUSTOM_START);
  const [customEnd, setCustomEnd] = useState(shanghaiDateString());
  const [industries, setIndustries] = useState(DEFAULT_INDUSTRIES);
  const [stocks, setStocks] = useState([]);
  const [result, setResult] = useState(null);
  const [breadth, setBreadth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [breadthLoading, setBreadthLoading] = useState(true);
  const [loadStep, setLoadStep] = useState(0);
  const [error, setError] = useState('');
  const [breadthError, setBreadthError] = useState('');
  const [lastSignature, setLastSignature] = useState('');
  const [stockQuery, setStockQuery] = useState('');
  const [stockSuggestions, setStockSuggestions] = useState([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [showMoreIndustries, setShowMoreIndustries] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [industryQuery, setIndustryQuery] = useState('');
  const requestIdRef = useRef(0);
  const bootedRef = useRef(false);

  const signature = useMemo(
    () => selectionKey(ANALYSIS_RANGE, '', '', industries, stocks),
    [industries, stocks],
  );
  const dirty = Boolean(result && lastSignature && signature !== lastSignature);
  const selectedCustomIndustryIds = industries.filter((id) => id.startsWith('custom:'));
  const customCatalog = result?.industries?.catalog || [];

  const requestAnalysis = useCallback(async ({
    rangeId,
    startDate = '',
    endDate = '',
    industryIds,
    stockList,
    force = false,
  }) => {
    const key = selectionKey(rangeId, startDate, endDate, industryIds, stockList);
    if (!force) {
      const cached = readJsonCache(RESULT_CACHE_SCOPE, key);
      if (cached?.value?.ok && cached.value.schemaVersion === RESULT_SCHEMA_VERSION) {
        setResult(cached.value);
        setLastSignature(key);
        setLoading(false);
        setError('');
        return cached.value;
      }
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError('');
    setLoadStep(0);
    try {
      const response = await fetch('/api/index-dewater', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          range: rangeId,
          startDate,
          endDate,
          industries: industryIds,
          stocks: stockList,
          force,
        }),
      });
      const data = await readApiResponse(response);
      if (!response.ok || data.error) throw new Error(data.error || '脱水计算失败，请稍后重试');
      if (requestIdRef.current !== requestId) return null;
      setResult(data);
      setLastSignature(key);
      writeJsonCache(RESULT_CACHE_SCOPE, key, data, marketAwareTtlMs());
      return data;
    } catch (e) {
      if (requestIdRef.current === requestId) setError(String(e?.message || '网络异常，请稍后重试'));
      return null;
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, []);

  const requestBreadth = useCallback(async ({
    rangeId,
    startDate = '',
    endDate = '',
    force = false,
  }) => {
    const key = selectionKey(rangeId, startDate, endDate, [], []);
    if (!force) {
      const cached = readJsonCache(BREADTH_CACHE_SCOPE, key);
      if (cached?.value?.ok) {
        setBreadth(cached.value);
        setBreadthLoading(false);
        setBreadthError('');
        return cached.value;
      }
    }
    setBreadthLoading(true);
    setBreadthError('');
    try {
      const response = await fetch('/api/market-breadth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ range: rangeId, startDate, endDate }),
      });
      const data = await readApiResponse(response);
      if (!response.ok || data.error) throw new Error(data.error || '涨跌家数统计失败');
      setBreadth(data);
      writeJsonCache(BREADTH_CACHE_SCOPE, key, data, 30 * 60 * 1000);
      return data;
    } catch (e) {
      setBreadthError(String(e?.message || '涨跌家数统计失败'));
      return null;
    } finally {
      setBreadthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    let saved = null;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch (e) { /* ignore broken local config */ }
    // 页面每次首次打开都从近一年开始；行业和个股条件仍可恢复。
    const nextRange = DEFAULT_RANGE;
    const nextStart = DEFAULT_CUSTOM_START;
    const nextEnd = shanghaiDateString();
    const nextIndustries = Array.isArray(saved?.industries) ? saved.industries.filter((id) => typeof id === 'string') : DEFAULT_INDUSTRIES;
    const nextStocks = Array.isArray(saved?.stocks) ? saved.stocks.filter((stock) => /^\d{6}$/.test(String(stock?.code || ''))) : [];
    setRange(nextRange);
    setCustomStart(nextStart);
    setCustomEnd(nextEnd);
    setIndustries(nextIndustries);
    setStocks(nextStocks);
    if (nextRange !== 'custom' || (nextStart && nextEnd)) {
      requestAnalysis({
        rangeId: ANALYSIS_RANGE,
        startDate: '',
        endDate: '',
        industryIds: nextIndustries,
        stockList: nextStocks,
      });
      requestBreadth({
        rangeId: nextRange,
        startDate: nextStart,
        endDate: nextEnd,
      });
    } else {
      setLoading(false);
      setBreadthLoading(false);
    }
  }, [requestAnalysis, requestBreadth]);

  useEffect(() => {
    if (!bootedRef.current) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ industries, stocks }));
    } catch (e) { /* ignore quota errors */ }
  }, [industries, stocks]);

  useEffect(() => {
    if (!loading) {
      setLoadStep(0);
      return undefined;
    }
    const timer = setInterval(() => setLoadStep((step) => Math.min(step + 1, LOADING_STEPS.length - 1)), 1600);
    return () => clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    const query = stockQuery.trim();
    const tooShort = query.length < 2 && !/[\u4e00-\u9fff]/.test(query);
    if (!suggestOpen || tooShort || /^\d{6}$/.test(query)) {
      setStockSuggestions([]);
      setSuggestLoading(false);
      return undefined;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSuggestLoading(true);
      try {
        const response = await fetch(`/api/stock-search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        const data = await response.json();
        if (!ctrl.signal.aborted) setStockSuggestions(Array.isArray(data.results) ? data.results : []);
      } catch (e) {
        if (!ctrl.signal.aborted) setStockSuggestions([]);
      } finally {
        if (!ctrl.signal.aborted) setSuggestLoading(false);
      }
    }, 260);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [stockQuery, suggestOpen]);

  const runCurrent = (overrides = {}) => {
    const nextIndustries = overrides.industryIds || industries;
    const nextStocks = overrides.stockList || stocks;
    if (!nextIndustries.length && !nextStocks.length) {
      setError('请至少选择一个行业或股票');
      return;
    }
    requestAnalysis({
      rangeId: ANALYSIS_RANGE,
      startDate: '',
      endDate: '',
      industryIds: nextIndustries,
      stockList: nextStocks,
      force: Boolean(overrides.force),
    });
  };

  const changeRange = (nextRange) => {
    setRange(nextRange);
    setError('');
    setBreadthError('');
    if (nextRange !== 'custom') {
      requestBreadth({ rangeId: nextRange, startDate: customStart, endDate: customEnd });
    }
  };

  const applyCustomRange = () => {
    if (!customStart || !customEnd) {
      setError('请选择自定义开始和结束日期');
      setBreadthError('请选择自定义开始和结束日期');
      return;
    }
    requestBreadth({ rangeId: 'custom', startDate: customStart, endDate: customEnd, force: true });
  };

  const addIndustry = (id) => {
    setIndustries((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const removeIndustry = (id) => {
    setIndustries((prev) => prev.filter((item) => item !== id));
  };

  const toggleIndustry = (id) => {
    setIndustries((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const addStock = (stock) => {
    const code = String(stock?.code || '').trim();
    if (!/^\d{6}$/.test(code)) {
      setError('股票代码需为 6 位数字');
      return;
    }
    setStocks((prev) => (prev.some((item) => item.code === code) ? prev : [...prev, { code, name: stock.name || code }]));
    setStockQuery('');
    setSuggestOpen(false);
    setError('');
  };

  const clearSelection = () => {
    setIndustries([]);
    setStocks([]);
    setError('');
  };

  const current = result?.current;
  const official = result?.official;
  const groups = result?.industries?.groups || INDUSTRY_GROUPS.map((group) => ({ ...group, count: null }));
  const industryLabels = [
    ...groups.filter((group) => industries.includes(group.id)).map((group) => group.label),
    ...selectedCustomIndustryIds.map(customIndustryLabel),
  ];
  const stockLabels = stocks.map((stock) => current?.selection?.items?.find((item) => item.code === stock.code)?.name || stock.name || stock.code);
  const selectionSummary = [...industryLabels, ...stockLabels].filter(Boolean);
  const filteredCatalog = customCatalog.filter((item) => {
    if (industries.includes(item.id)) return false;
    if (!industryQuery.trim()) return true;
    return item.name.includes(industryQuery.trim());
  }).slice(0, industryQuery.trim() ? 60 : 28);

  return (
    <div className={styles.page}>
      <ModuleHero
        iconId="index-dewater"
        kicker="SSE COMPOSITE · DEWATERING"
        title="上证指数脱水报告"
        description="剔除银行、石油等权重股，看看指数背后的真实市场表现。"
      />

      <div className={styles.statusStrip} aria-live="polite">
        <span className={styles.statusIndex}><Landmark size={14} /> 上证综合指数 · 000001</span>
        <span><Database size={14} /> 截止 {result?.asOf || '加载中'}</span>
        <span><RefreshCw size={14} className={loading ? styles.spin : ''} /> {result?.updatedAt ? new Date(result.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }) : '更新中'}</span>
        <span className={styles.statusMode}><BadgeCheck size={14} /> 同除数点位 + 独立区间 + 涨跌家数</span>
        <button type="button" className={`${styles.configEntry} ${dirty ? styles.configEntryDirty : ''}`} onClick={() => setConfigOpen(true)}>
          <Filter size={13} /> {dirty ? '条件已修改' : '脱水条件'} · {industries.length + stocks.length}
        </button>
        <details className={styles.sourceDetails}>
          <summary><Info size={14} /> 数据来源</summary>
          <div>
            <strong>行情与分类</strong>
            <p>{result?.dataQuality?.sources?.join('；') || '东方财富公开行情与行业字段'}</p>
            <strong>计算边界</strong>
            <p>{result?.index?.methodology || '当前沪市样本 + 东财流通市值权重复刻'}</p>
          </div>
        </details>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <ShieldCheck size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => runCurrent({ force: true })}>重试</button>
        </div>
      )}

      <section className={styles.metricsGrid} aria-label="核心指标">
        <MetricCard card={result?.cards?.[0]} icon={ChartNoAxesCombined} />
        <MetricCard card={result?.cards?.[1]} icon={Landmark} />
      </section>

      <div className={styles.workbench}>

        <main className={styles.resultColumn}>
          <section className={`${styles.panel} ${styles.chartPanel}`} aria-busy={loading}>
            <div className={styles.panelHead}>
              <div>
                <span className={styles.panelKicker}><ChartNoAxesCombined size={14} /> 指数对比</span>
                <h3>上证指数 VS 脱水后上证指数</h3>
              </div>
              <span className={styles.panelBadge}>固定近一年 · 剩余点位对齐</span>
            </div>
            {loading && !result ? (
              <div className={styles.chartSkeleton}>
                <LoaderCircle size={24} className={styles.spin} />
                <strong>{LOADING_STEPS[loadStep]}</strong>
                <span>首次计算需要拉取样本与个股历史行情，约 5–15 秒</span>
              </div>
            ) : (
              <DewaterChart
                chart={current?.chart}
                officialReturn={official?.returnPct}
                dewaterReturn={current?.dewater?.returnPct}
              />
            )}
            {current && (
              <div className={styles.currentCompare}>
                <div className={styles.currentCompareLabel}>
                  <span>当前方案</span>
                  <strong>{selectionSummary.join(' + ') || '未选择'}</strong>
                  {dirty && <em>待重算</em>}
                </div>
                <div><span>官方区间</span><b className={toneFor(official?.returnPct)}>{pct(official?.returnPct)}</b></div>
                <div><span>剩余点位</span><b>{fmt(current.dewater?.sameDivisorLevel)} 点</b></div>
                <div><span>独立区间</span><b className={toneFor(current.dewater?.returnPct)}>{pct(current.dewater?.returnPct)}</b></div>
                <div><span>{current.dewater?.pointsBelowOfficial < 0 ? '低于官方' : '高于官方'}</span><b>{fmt(Math.abs(current.dewater?.pointsBelowOfficial))} 点</b></div>
              </div>
            )}
          </section>

              <BreadthDashboard
                data={breadth}
                loading={breadthLoading}
                error={breadthError}
                range={range}
                customStart={customStart}
                customEnd={customEnd}
                onCustomStart={setCustomStart}
                onCustomEnd={setCustomEnd}
                onRangeChange={changeRange}
                onApplyCustom={applyCustomRange}
                onRetry={() => requestBreadth({ rangeId: range, startDate: customStart, endDate: customEnd, force: true })}
              />

          {loading && result && (
            <div className={styles.loadingInline}><LoaderCircle size={15} className={styles.spin} /> {LOADING_STEPS[loadStep]}</div>
          )}

          <section className={`${styles.panel} ${styles.detailPanel}`}>
            <details>
              <summary>
                <span><ListFilter size={15} /> 实际剔除股票明细</span>
                <span className={styles.detailCount}>
                  {current?.selection?.finalCount ?? 0} 只
                  {current?.selection?.duplicateCount > 0 ? ` · 去重 ${current.selection.duplicateCount} 次` : ''}
                  <ChevronDown size={15} />
                </span>
              </summary>
              <SelectionTable items={current?.selection?.items || []} />
            </details>
          </section>

        </main>
      </div>

      {configOpen && (
        <div className={styles.configOverlay} onClick={() => setConfigOpen(false)}>
          <aside className={`${styles.panel} ${styles.configPanel} ${styles.configDrawer}`} aria-busy={loading} onClick={(event) => event.stopPropagation()}>
            <div className={styles.panelHead}>
              <div>
                <span className={styles.panelKicker}><Filter size={14} /> 脱水条件</span>
                <h3>自由组合剔除范围</h3>
              </div>
              <div className={styles.drawerActions}>
                <button type="button" className={styles.clearBtn} onClick={clearSelection} disabled={!industries.length && !stocks.length}>清空</button>
                <button type="button" className={styles.drawerClose} onClick={() => setConfigOpen(false)} aria-label="关闭脱水条件">✕</button>
              </div>
            </div>


            <section className={styles.configSection}>
              <div className={styles.configTitle}><span>01 按行业剔除</span><small>可多选</small></div>
              <div className={styles.industryGrid}>
                {groups.map((group) => {
                  const active = industries.includes(group.id);
                  return (
                    <button
                      key={group.id}
                      type="button"
                      className={`${styles.industryChip} ${active ? styles.industryChipActive : ''}`}
                      onClick={() => toggleIndustry(group.id)}
                      aria-pressed={active}
                    >
                      <span>{group.label}</span>
                      <small>{group.count == null ? '—' : group.count}</small>
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={`${styles.industryChip} ${styles.customIndustryChip} ${showMoreIndustries ? styles.industryChipActive : ''}`}
                  onClick={() => setShowMoreIndustries((open) => !open)}
                >
                  <span><Plus size={12} /> 自定义行业</span>
                  <small>{selectedCustomIndustryIds.length || '全部'}</small>
                </button>
              </div>
              {selectedCustomIndustryIds.length > 0 && (
                <div className={styles.customSelected}>
                  {selectedCustomIndustryIds.map((id) => (
                    <span key={id}>
                      {customIndustryLabel(id)}
                      <button type="button" onClick={() => removeIndustry(id)} aria-label="移除行业">×</button>
                    </span>
                  ))}
                </div>
              )}
              {showMoreIndustries && (
                <div className={styles.customIndustryPanel}>
                  <label className={styles.smallSearch}>
                    <Search size={14} />
                    <input value={industryQuery} onChange={(event) => setIndustryQuery(event.target.value)} placeholder="搜索细分类行业，如 半导体、电力" />
                  </label>
                  <div className={styles.catalogList}>
                    {filteredCatalog.length ? filteredCatalog.map((item) => (
                      <button key={item.id} type="button" onClick={() => addIndustry(item.id)}>
                        <span>{item.name}</span><small>{item.count} 只</small><Plus size={13} />
                      </button>
                    )) : <p>{loading ? '正在加载行业清单…' : '没有匹配的行业'}</p>}
                  </div>
                </div>
              )}
            </section>

            <section className={styles.configSection}>
              <div className={styles.configTitle}><span>02 按个股剔除</span><small>名称 / 代码</small></div>
              <div className={styles.quickStocks}>
                {QUICK_STOCKS.map((stock) => {
                  const active = stocks.some((item) => item.code === stock.code);
                  return (
                    <button
                      key={stock.code}
                      type="button"
                      className={active ? styles.quickStockActive : ''}
                      onClick={() => active ? setStocks((prev) => prev.filter((item) => item.code !== stock.code)) : addStock(stock)}
                    >
                      {stock.name}<small>{stock.code}</small>
                    </button>
                  );
                })}
              </div>
              <div className={styles.stockSearchWrap}>
                <label className={styles.stockSearch}>
                  <Search size={15} />
                  <input
                    value={stockQuery}
                    onChange={(event) => { setStockQuery(event.target.value); setSuggestOpen(true); }}
                    onFocus={() => setSuggestOpen(true)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && /^\d{6}$/.test(stockQuery.trim())) addStock({ code: stockQuery.trim(), name: stockQuery.trim() });
                    }}
                    placeholder="输入股票名称或 6 位代码"
                  />
                  {suggestLoading && <LoaderCircle size={14} className={styles.spin} />}
                </label>
                <button
                  type="button"
                  className={styles.addManualBtn}
                  disabled={!/^\d{6}$/.test(stockQuery.trim())}
                  onClick={() => addStock({ code: stockQuery.trim(), name: stockQuery.trim() })}
                >
                  添加
                </button>
                {suggestOpen && (stockSuggestions.length > 0 || (stockQuery.trim().length >= 1 && !suggestLoading)) && (
                  <div className={styles.suggestPanel}>
                    {stockSuggestions.length ? stockSuggestions.map((item) => (
                      <button
                        key={`${item.symbol}-${item.secid}`}
                        type="button"
                        onClick={() => addStock({ code: item.symbol, name: item.name })}
                      >
                        <span>{item.name}</span>
                        <small>{item.symbol} · {String(item.secid || '').startsWith('1.') ? '沪市' : '非沪市'}</small>
                        <Plus size={13} />
                      </button>
                    )) : <p>没有匹配股票，可直接输入 6 位代码添加。</p>}
                  </div>
                )}
              </div>
              {stocks.length > 0 && (
                <div className={styles.stockChips}>
                  {stocks.map((stock) => (
                    <span key={stock.code}>
                      <strong>{current?.selection?.items?.find((item) => item.code === stock.code)?.name || stock.name}</strong>
                      <small>{stock.code}</small>
                      <button type="button" onClick={() => setStocks((prev) => prev.filter((item) => item.code !== stock.code))} aria-label="移除股票">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </section>

            <div className={styles.selectionSummary}>
              <div><span>已选行业</span><b>{industries.length}</b></div>
              <div><span>已选个股</span><b>{stocks.length}</b></div>
              <div><span>实际剔除</span><b>{current?.selection?.matchedCount ?? '—'}</b></div>
              <div><span>非样本</span><b>{current?.selection?.outsideCount ?? '—'}</b></div>
            </div>

            {current?.selection?.outsideCount > 0 && (
              <div className={styles.sampleWarning}>
                <Info size={15} />
                <p>{current.selection.outsideCount} 只股票不在上证样本中，已自动跳过：{current.selection.outsideItems.map((item) => `${item.name}(${item.code})`).join('、')}</p>
              </div>
            )}

            <button type="button" className={styles.runBtn} onClick={() => runCurrent({ force: true })} disabled={loading || (!industries.length && !stocks.length)}>
              {loading ? <LoaderCircle size={16} className={styles.spin} /> : <Droplets size={16} />}
              {loading ? '正在脱水…' : dirty ? '按新条件重新脱水' : '重新计算'}
            </button>
            <p className={styles.configHint}><CircleHelp size={13} /> 行业与个股会自动去重；所有股票都会校验上证样本资格。</p>
          </aside>
        </div>
      )}

    </div>
  );
}
