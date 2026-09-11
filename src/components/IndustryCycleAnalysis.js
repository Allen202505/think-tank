'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, BadgeCheck, BarChart3, CheckCircle2, ChevronDown, CircleDot, CircleHelp, Compass,
  Database, Gauge, Layers3, Minus, RefreshCw, Scale, ScanSearch, ShieldAlert, Target, TrendingUp,
} from 'lucide-react';
import { ensureAiReady, consumeFree, getAiConfig } from '../lib/aiGate';
import { markFeatureCompleted } from '../lib/shareInvite';
import { readApiResponse } from '../lib/apiResponse.mjs';
import ModuleHero from './ModuleHero';
import { CYCLE_STAGES, stageIndex } from '../lib/industryCycleMeta';
import styles from './IndustryCycleAnalysis.module.css';

const LS_KEY = 'thinktank_industry_cycle_state_v1';
const LOADING_STEPS = [
  '正在识别股票与行业口径…',
  '正在拉取行情、财报和行业指数…',
  '正在检验需求、库存、价格、供给与利润…',
  '正在判断周期阶段与拐点信号…',
  '正在核对公司周期与股票估值位置…',
];
const VERDICT_STEPS = ['否', '偏否', '中性', '偏是', '是'];
const QUADRANTS = [
  { id: 'A', title: 'A · 周期底部', desc: '行业低位 + 股票低位', tone: 'calm' },
  { id: 'B', title: 'B · 改善未定价', desc: '行业改善 + 股票尚未充分上涨', tone: 'good' },
  { id: 'C', title: 'C · 趋势交易', desc: '行业繁荣 + 股票大涨', tone: 'warm' },
  { id: 'D', title: 'D · 高位风险', desc: '行业高位 + 股票高位', tone: 'risk' },
];
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scoreTone(score) {
  if (score == null) return 'unknown';
  if (score >= 75) return 'strong';
  if (score >= 55) return 'medium';
  return 'weak';
}

function ScoreGauge({ value, stage }) {
  const pct = value == null ? 0 : clamp(Number(value), 0, 100);
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const dash = (pct / 100) * circumference;
  return (
    <div className={styles.scoreGauge} aria-label={value == null ? '综合评分不足' : `综合评分 ${value} 分`}>
      <svg viewBox="0 0 110 110" role="img">
        <circle cx="55" cy="55" r={radius} className={styles.gaugeTrack} />
        <circle
          cx="55"
          cy="55"
          r={radius}
          className={`${styles.gaugeValue} ${styles[`gauge_${scoreTone(value)}`] || ''}`}
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <div className={styles.gaugeText}>
        <strong>{value == null ? '—' : value}</strong>
        <span>/100</span>
      </div>
      <div className={styles.gaugeStage}>{stage || '数据不足'}</div>
    </div>
  );
}

const CYCLE_WAVE_POINTS = [
  { x: 80, y: 140 },
  { x: 240, y: 120 },
  { x: 400, y: 80 },
  { x: 560, y: 42 },
  { x: 720, y: 48 },
];
const CYCLE_WAVE_PATH = 'M0 158 C32 154 55 148 80 140 C136 142 184 130 240 120 C296 110 344 96 400 80 C456 64 504 46 560 42 C616 38 680 42 720 48 C750 52 780 48 800 38';

function CycleWave({ activeStage }) {
  return (
    <div className={styles.cycleWave}>
      <div className={styles.cycleWaveCanvas}>
        <svg className={styles.cycleWaveSvg} viewBox="0 0 800 190" role="img" aria-label="周期阶段波浪图">
          <defs>
            <linearGradient id="cycle-wave-line" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="var(--text-muted)" stopOpacity="0.45" />
              <stop offset="54%" stopColor="var(--accent)" stopOpacity="0.86" />
              <stop offset="100%" stopColor="var(--accent-strong)" />
            </linearGradient>
            <linearGradient id="cycle-wave-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.17" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className={styles.cycleWaveArea} d={`${CYCLE_WAVE_PATH} L800 176 L0 176 Z`} />
          <path className={styles.cycleWaveGlow} d={CYCLE_WAVE_PATH} />
          <path className={styles.cycleWaveLine} d={CYCLE_WAVE_PATH} />
          {CYCLE_WAVE_POINTS.map((point, index) => {
            const passed = activeStage > index;
            const active = activeStage === index;
            return (
              <g key={CYCLE_STAGES[index].id}>
                <line className={styles.cycleWaveStem} x1={point.x} x2={point.x} y1={point.y + 12} y2="176" />
                <circle className={`${styles.cycleWaveNode} ${passed ? styles.cycleWaveNodePassed : ''} ${active ? styles.cycleWaveNodeActive : ''}`} cx={point.x} cy={point.y} r={active ? 11 : passed ? 8 : 7} />
                <circle className={styles.cycleWaveCore} cx={point.x} cy={point.y} r={active ? 4 : 3} />
              </g>
            );
          })}
        </svg>
        <div className={styles.cycleWaveLabels}>
          {CYCLE_STAGES.map((stage, index) => (
            <div key={stage.id} className={`${styles.cycleWaveLabel} ${index === activeStage ? styles.cycleWaveLabelActive : ''} ${index < activeStage ? styles.cycleWaveLabelPassed : ''}`}>
              <strong>{stage.label}</strong>
              <p>{stage.short}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, eyebrow, title, desc }) {
  return (
    <div className={styles.sectionTitle}>
      <span className={styles.sectionIcon}><Icon size={17} /></span>
      <div>
        {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
        <h3>{title}</h3>
        {desc ? <p>{desc}</p> : null}
      </div>
    </div>
  );
}

function companyTone(trend) {
  const value = String(trend || '');
  if (/改善|修复|上升|增长|提高|利好/.test(value)) return 'good';
  if (/恶化|下降|下滑|承压|减少|利空/.test(value)) return 'bad';
  if (/稳定|持平|中性|不变/.test(value)) return 'neutral';
  return 'unknown';
}

function TransmissionCard({ row, index }) {
  const tone = companyTone(row.trend);
  const Icon = tone === 'good' ? ArrowUpRight : tone === 'bad' ? ArrowDownRight : tone === 'neutral' ? Minus : CircleHelp;
  return (
    <article className={`${styles.transmissionCard} ${styles[`transmission_${tone}`]}`}>
      <div className={styles.transmissionTop}>
        <span className={styles.transmissionStep}>{String(index + 1).padStart(2, '0')}</span>
        <strong>{row.metric || `指标 ${index + 1}`}</strong>
        <span className={styles.transmissionTrend}><Icon size={14} />{row.trend || '数据不足'}</span>
      </div>
      <div className={styles.transmissionBody}>
        <div className={styles.transmissionStatus}>{row.status || '数据不足'}</div>
        <p>{row.conclusion || '暂无可验证结论。'}</p>
      </div>
    </article>
  );
}

function CycleRadar({ rows }) {
  const data = (rows || []).filter((row) => row.weight > 0);
  if (!data.length) return null;
  const center = 170;
  const radius = 96;
  const count = data.length;
  const point = (index, value) => {
    const angle = -Math.PI / 2 + index * (Math.PI * 2 / count);
    return {
      x: center + Math.cos(angle) * radius * value,
      y: center + Math.sin(angle) * radius * value,
      angle,
    };
  };
  const ring = (value) => data.map((_, index) => {
    const p = point(index, value);
    return `${p.x},${p.y}`;
  }).join(' ');
  const radarPoints = data.map((row, index) => {
    const p = point(index, Math.max(0.04, row.score ?? 0));
    return `${p.x},${p.y}`;
  }).join(' ');

  return (
    <div className={styles.radarWrap}>
      <svg className={styles.radarSvg} viewBox="0 0 340 300" role="img" aria-label="七维周期评分雷达图">
        {[0.25, 0.5, 0.75, 1].map((level) => <polygon key={level} points={ring(level)} className={styles.radarGrid} />)}
        {data.map((row, index) => {
          const p = point(index, 1);
          const label = point(index, 1.28);
          const anchor = Math.cos(label.angle) > 0.25 ? 'start' : Math.cos(label.angle) < -0.25 ? 'end' : 'middle';
          return (
            <g key={row.key}>
              <line className={styles.radarAxis} x1={center} y1={center} x2={p.x} y2={p.y} />
              <text className={styles.radarLabel} x={label.x} y={label.y} textAnchor={anchor} dominantBaseline="middle">{row.label}</text>
            </g>
          );
        })}
        <polygon className={styles.radarArea} points={radarPoints} />
        {data.map((row, index) => {
          const p = point(index, Math.max(0.04, row.score ?? 0));
          return <circle key={`${row.key}-point`} className={`${styles.radarPoint} ${row.score == null ? styles.radarPointMissing : ''}`} cx={p.x} cy={p.y} r="3.6" />;
        })}
      </svg>
      <div className={styles.radarLegend}>
        <span><i className={styles.radarLegendArea} />越靠外，周期条件越有利</span>
        <span><i className={styles.radarLegendMissing} />空心点表示数据不足</span>
      </div>
    </div>
  );
}

function DimensionRow({ row, index }) {
  const tone = row.score == null ? (row.weight ? 'unknown' : 'aux') : scoreTone(row.score * 100);
  const scorePct = row.score == null ? 0 : Math.round(row.score * 100);
  return (
    <details className={`${styles.dimensionRow} ${styles[`dim_${tone}`]}`}>
      <summary>
        <span className={styles.dimensionIndex}>{String(index + 1).padStart(2, '0')}</span>
        <span className={styles.dimensionSummaryMain}>
          <strong>{row.label}</strong>
          <small>{row.status || '数据不足'}</small>
        </span>
        <span className={styles.dimensionMiniTrack}><i style={{ width: `${scorePct}%` }} /></span>
        <span className={styles.dimensionPoints}>
          <b>{row.points == null ? '—' : row.points}</b>
          <small>{row.weight ? ` / ${row.weight}` : '辅助'}</small>
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      <div className={styles.dimensionDetailBody}>
        <div>
          <label>周期含义</label>
          <p>{row.periodMeaning || '—'}</p>
        </div>
        <div>
          <label>观察证据</label>
          <p>{row.evidence || '—'}</p>
        </div>
        <div className={styles.dimensionSource}>
          <span>{row.dataDate || '未获取'}</span>
          <span>{row.source || '未注明'}</span>
        </div>
      </div>
    </details>
  );
}

function SignalGroup({ icon: Icon, title, items, empty, tone = '', defaultOpen = false }) {
  const rows = Array.isArray(items) ? items : [];
  return (
    <details className={`${styles.signalCol} ${tone ? styles[tone] : ''}`} open={defaultOpen || undefined}>
      <summary className={styles.signalHead}>
        <Icon size={16} />
        <span>{title}</span>
        <b>{rows.length}</b>
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      <div className={styles.signalBody}>
        {rows.length ? rows.map((x, i) => <p key={i}>{x}</p>) : <p className={styles.muted}>{empty}</p>}
      </div>
    </details>
  );
}

function positionIcon(metric) {
  const value = String(metric || '');
  if (/价格|涨幅|位置/.test(value)) return TrendingUp;
  if (/成交|量能/.test(value)) return Activity;
  if (/估值|PE|PB/.test(value)) return Gauge;
  if (/预期/.test(value)) return Target;
  return Compass;
}

function PositionCard({ row, index }) {
  const Icon = positionIcon(row.metric);
  return (
    <article className={styles.positionCard}>
      <div className={styles.positionHead}>
        <span className={styles.positionIcon}><Icon size={15} /></span>
        <label>{row.metric || `位置 ${index + 1}`}</label>
      </div>
      <strong>{row.value || '待验证'}</strong>
      <p>{row.read || '暂无可验证说明。'}</p>
    </article>
  );
}

function EmptyState() {
  return (
    <div className={styles.emptyGrid}>
      <div className={styles.emptyCard}>
        <ScanSearch size={22} />
        <strong>周期属性</strong>
        <p>先区分强周期、弱周期、防御型、成长或周期+成长，避免用同一把尺子衡量所有行业。</p>
      </div>
      <div className={styles.emptyCard}>
        <Gauge size={22} />
        <strong>六阶段定位</strong>
        <p>从衰退、筑底、复苏到繁荣、过热，结合评分与领先指标判断当前周期位置。</p>
      </div>
      <div className={styles.emptyCard}>
        <Layers3 size={22} />
        <strong>三重验证</strong>
        <p>行业周期、公司盈利周期、股票预期分别判断，重点寻找三者错位形成的机会。</p>
      </div>
    </div>
  );
}

export default function IndustryCycleAnalysis() {
  const [symbol, setSymbol] = useState('');
  const [industryData, setIndustryData] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadStep, setLoadStep] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const hydratedRef = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const state = JSON.parse(raw);
        if (state?.result && typeof state.result === 'object') setResult(state.result);
        if (typeof state?.symbol === 'string') setSymbol(state.symbol);
        if (typeof state?.industryData === 'string') setIndustryData(state.industryData);
      }
    } catch (e) { /* ignore broken local state */ }
    const timer = setTimeout(() => { hydratedRef.current = true; }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ result, symbol, industryData }));
    } catch (e) { /* ignore quota errors */ }
  }, [result, symbol, industryData]);

  useEffect(() => {
    if (!loading) {
      setLoadStep(0);
      return undefined;
    }
    const timer = setInterval(() => setLoadStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)), 7000);
    return () => clearInterval(timer);
  }, [loading]);

  const run = useCallback(async () => {
    if (loading || !symbol.trim()) return;
    if (!ensureAiReady()) return;
    consumeFree();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/industry-cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          symbol: symbol.trim(),
          industryData: industryData.trim(),
          aiConfig: getAiConfig(),
        }),
      });
      const data = await readApiResponse(res);
      if (!res.ok || data.error) throw new Error(data.error || '分析失败，请重试');
      setResult(data.result);
      markFeatureCompleted('行业周期分析');
    } catch (e) {
      const message = String(e?.message || e || '');
      setError(/failed to fetch|network|load|timed? ?out|econn|reset/i.test(message) ? '网络异常或连接超时，请稍后重试' : (message || '分析失败，请重试'));
    } finally {
      setLoading(false);
    }
  }, [industryData, loading, symbol]);

  const analysis = result?.analysis;
  const activeStage = analysis ? stageIndex(analysis.summary?.stage) : -1;
  const dashboardRows = analysis?.dashboard || [];
  const scoredDimensions = dashboardRows.filter((row) => row.weight > 0);
  const availableDimensions = scoredDimensions.filter((row) => row.score != null);
  const missingDimensions = scoredDimensions.filter((row) => row.score == null);
  const companyRows = analysis?.company || [];
  const companyCounts = companyRows.reduce((acc, row) => {
    const tone = companyTone(row.trend);
    acc[tone] += 1;
    return acc;
  }, { good: 0, neutral: 0, bad: 0, unknown: 0 });
  const companyRanked = companyRows
    .map((row, index) => ({ row, index, tone: companyTone(row.trend) }))
    .sort((a, b) => ({ good: 0, bad: 1, neutral: 2, unknown: 3 }[a.tone] - { good: 0, bad: 1, neutral: 2, unknown: 3 }[b.tone]) || a.index - b.index);
  const highlightedCompanyIndexes = new Set(companyRanked.slice(0, 4).map((item) => item.index));
  const companyVisible = companyRows.map((row, index) => ({ row, index })).filter((item) => highlightedCompanyIndexes.has(item.index));
  const companyRemaining = companyRows.map((row, index) => ({ row, index })).filter((item) => !highlightedCompanyIndexes.has(item.index));
  const judgement = analysis?.final?.judgement || '中性';
  const verdictIndex = Math.max(0, VERDICT_STEPS.indexOf(judgement));
  const verdictTone = judgement.includes('是') ? 'positive' : judgement.includes('否') ? 'negative' : 'neutral';
  const VerdictIcon = verdictTone === 'positive' ? BadgeCheck : verdictTone === 'negative' ? ShieldAlert : Scale;

  return (
    <div className={styles.page}>
      <ModuleHero
        iconId="industry-cycle"
        kicker="CYCLE RESEARCH DESK"
        title="行业周期分析"
        description="输入一只 A 股，按「周期属性 → 传导链 → 九维仪表盘 → 周期阶段 → 公司传导 → 股票位置」做三重交叉验证。"
      />

      <section className={styles.inputCard}>
        <div className={styles.inputMain}>
          <label htmlFor="industry-cycle-symbol">股票名称或代码</label>
          <div className={styles.inputRow}>
            <div className={styles.searchBox}>
              <Target size={18} />
              <input
                id="industry-cycle-symbol"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); } }}
                placeholder="例如：中盐化工 / 600328 / 中国神华"
                autoComplete="off"
              />
            </div>
            <button type="button" className={styles.runBtn} onClick={run} disabled={loading || !symbol.trim()}>
              {loading ? <RefreshCw size={17} className={styles.spin} /> : <BarChart3 size={17} />}
              {loading ? '分析中…' : '开始周期分析'}
            </button>
          </div>
        </div>
        <details className={styles.supplement}>
          <summary>补充行业数据（可选，但会明显提高置信度）</summary>
          <textarea
            value={industryData}
            onChange={(e) => setIndustryData(e.target.value)}
            placeholder="可粘贴：产品价格/价差及日期、行业库存、开工率、产能投放、订单、政策变化等。请尽量保留来源与日期，系统会优先使用。
示例：2026-08-30 华东纯碱现货价 1,420 元/吨，环比 +3%；行业企业库存连续 4 周下降。"
          />
        </details>
        <div className={styles.inputNote}>
          <Database size={14} />
          <span>自动数据来自公开行情、财报与行业指数；商品库存、现货价格、开工率等通用接口不覆盖时，会明确标为数据不足，不会补造数字。</span>
        </div>
      </section>

      {error ? <div className={styles.error}><AlertTriangle size={16} /> {error}</div> : null}

      {loading ? (
        <section className={styles.loadingCard}>
          <div className={styles.loadingPulse}><Activity size={24} /></div>
          <strong>{LOADING_STEPS[loadStep]}</strong>
          <p>系统正在逐项核对数据，通常需要 30–90 秒。</p>
          <div className={styles.loadingBar}><span /></div>
        </section>
      ) : null}

      {!loading && !analysis && !result?.fallback ? <EmptyState /> : null}

      {!loading && result?.fallback ? (
        <section className={styles.fallback}>
          <div className={styles.fallbackHead}><AlertTriangle size={17} /> 模型未返回结构化结果，以下为原始研究内容</div>
          <pre>{result.content || '未获得有效内容'}</pre>
        </section>
      ) : null}

      {!loading && analysis ? (
        <div className={styles.results}>
          <section className={styles.summaryCard}>
            <div className={styles.stockBlock}>
              <div className={styles.stockMeta}>A股 · {result.stock?.industry || '行业未识别'}</div>
              <h3>{result.stockName || result.stock?.name || symbol}</h3>
              <div className={styles.stockCodes}>{result.stock?.symbol || '—'} · 数据快照 {new Date(result.analysis.asOf || Date.now()).toLocaleString('zh-CN', { hour12: false })}</div>
              <div className={styles.badgeRow}>
                <span className={styles.badge}>{analysis.summary.cycleCategory}</span>
                <span className={styles.badge}>周期强度 {analysis.summary.cycleStrength}</span>
                <span className={`${styles.badge} ${styles[`confidence_${analysis.summary.confidence}`] || ''}`}>置信度 {analysis.summary.confidence}</span>
              </div>
              <div className={styles.confidenceNote}>{analysis.summary.confidenceReason}</div>
            </div>
            <ScoreGauge value={analysis.total} stage={analysis.summary.stage} />
          </section>

          <section className={styles.oneLine}>
            <div className={styles.quoteMark}>“</div>
            <p>{analysis.summary.oneLine}</p>
            <div className={styles.oneLineMeta}>
              <span>方向：<b>{analysis.summary.direction}</b></span>
              <span>评分阶段：<b>{analysis.stageFromScore || '数据不足'}</b></span>
              <span>核心覆盖：<b>{analysis.coverage}%</b></span>
            </div>
          </section>

          <div className={styles.twoCols}>
            <div className={`${styles.insightCard} ${styles.opportunity}`}>
              <TrendingUp size={18} />
              <div><label>最大机会</label><p>{analysis.summary.opportunity}</p></div>
            </div>
            <div className={`${styles.insightCard} ${styles.risk}`}>
              <ShieldAlert size={18} />
              <div><label>最大风险</label><p>{analysis.summary.mainRisk}</p></div>
            </div>
          </div>

          <section className={styles.section}>
            <SectionTitle icon={Gauge} eyebrow="STEP 01" title="周期阶段定位" desc="分数是辅助判断，阶段解释来自多个领先、同步与滞后指标的交叉验证。" />
            <CycleWave activeStage={activeStage} />
            <div className={styles.stageReason}>
              <CircleDot size={16} />
              <p>{analysis.stageReason}</p>
            </div>
          </section>

          <section className={styles.section}>
            <SectionTitle icon={Layers3} eyebrow="STEP 02" title="周期传导链" desc="不同产业必须替换为自己的周期发动机，而不是机械套用价格或库存。" />
            <div className={styles.driverBox}>
              <label>核心驱动变量</label>
              <p>{analysis.driver}</p>
            </div>
            <div className={styles.chain}>
              {(analysis.chain?.steps || []).map((step, index) => (
                <div className={styles.chainItem} key={`${step}-${index}`}>
                  <span>{step}</span>
                  {index < (analysis.chain.steps.length - 1) ? <ArrowRight size={17} /> : null}
                </div>
              ))}
            </div>
            {analysis.chain?.logic ? <p className={styles.chainLogic}>{analysis.chain.logic}</p> : null}
          </section>

          <section className={styles.section}>
            <SectionTitle icon={BarChart3} eyebrow="STEP 03" title="九维周期仪表盘" desc="雷达图先看整体强弱，展开任一指标再看证据。" />
            <div className={styles.dashboardVisual}>
              <CycleRadar rows={scoredDimensions} />
              <div className={styles.dashboardSummaryPanel}>
                <div className={styles.dashboardSummary}>
                  <div><span>评分维度</span><strong>{scoredDimensions.length}</strong></div>
                  <div><span>已获数据</span><strong>{availableDimensions.length}<small> / {scoredDimensions.length}</small></strong></div>
                  <div><span>覆盖权重</span><strong>{analysis.coverage}<small>%</small></strong></div>
                  <div><span>待补数据</span><strong>{missingDimensions.length}</strong></div>
                </div>
                <p className={styles.dashboardHint}>雷达面积越向外扩张，代表周期条件越有利；中间空心点表示该维度数据不足。</p>
              </div>
            </div>
            <div className={styles.dimensionList}>
              {dashboardRows.map((row, index) => <DimensionRow key={row.key} row={row} index={index} />)}
            </div>
          </section>

          <section className={styles.section}>
            <SectionTitle icon={Activity} eyebrow="STEP 04" title="周期拐点识别" desc="至少三个领先指标同时转向，才比单一价格信号更可信。" />
            <div className={styles.signalGrid}>
              <SignalGroup icon={CheckCircle2} title="已反转" items={analysis.inflection?.reversed} empty="暂无已确认反转信号" tone="signalGood" defaultOpen />
              <SignalGroup icon={CircleDot} title="尚未确认" items={analysis.inflection?.notYet} empty="暂无数据" />
              <SignalGroup icon={ScanSearch} title="等待观察" items={analysis.inflection?.awaiting} empty="暂无数据" />
            </div>
            <div className={styles.keySignal}><Target size={16} /><span>最关键领先指标：</span><strong>{analysis.inflection?.keyIndicator || '待确认'}</strong></div>
          </section>

          <section className={styles.section}>
            <SectionTitle icon={TrendingUp} eyebrow="STEP 05" title="行业 → 公司传导" desc="行业改善不等于公司盈利改善，必须检查价格、销量、成本、库存、现金流和资本开支。" />
            {companyRows.length ? (
              <>
                <div className={styles.transmissionRail}>
                  <div className={styles.transmissionRailTrack}>
                    {companyRows.map((row, index) => {
                      const tone = companyTone(row.trend);
                      return (
                        <span
                          key={`${row.metric}-${index}`}
                          className={`${styles.transmissionRailNode} ${styles[`transmission_${tone}`]}`}
                          title={`${row.metric}：${row.trend}`}
                        >
                          {index + 1}
                        </span>
                      );
                    })}
                  </div>
                  <div className={styles.transmissionLegend}>
                    <span><i className={styles.legendGood} />改善 {companyCounts.good}</span>
                    <span><i className={styles.legendNeutral} />稳定 {companyCounts.neutral}</span>
                    <span><i className={styles.legendBad} />恶化 {companyCounts.bad}</span>
                    <span><i className={styles.legendUnknown} />待验证 {companyCounts.unknown}</span>
                  </div>
                </div>
                <div className={styles.transmissionGrid}>
                  {companyVisible.map(({ row, index }) => <TransmissionCard key={`${row.metric}-${index}`} row={row} index={index} />)}
                </div>
                {companyRemaining.length ? (
                  <details className={styles.expandBlock}>
                    <summary>
                      <span>展开其余 {companyRemaining.length} 项公司传导</span>
                      <ChevronDown size={15} aria-hidden="true" />
                    </summary>
                    <div className={styles.transmissionGrid}>
                      {companyRemaining.map(({ row, index }) => <TransmissionCard key={`${row.metric}-${index}`} row={row} index={index} />)}
                    </div>
                  </details>
                ) : null}
              </>
            ) : <p className={styles.muted}>暂无可用的公司传导数据。</p>}
          </section>

          <section className={styles.section}>
            <SectionTitle icon={Target} eyebrow="STEP 06" title="股票位置：市场定价了多少？" desc="股价经常领先利润，关键是识别行业改善是否已经被估值和一致预期充分反映。" />
            <div className={styles.positionGrid}>
              {(analysis.stockPosition || []).map((row, index) => <PositionCard key={`${row.metric}-${index}`} row={row} index={index} />)}
            </div>
          </section>

          <section className={styles.section}>
            <SectionTitle icon={Target} eyebrow="STEP 07" title="行业周期 × 股票周期" desc="A 区找拐点，B 区找错位，C 区看预期还能否超预期，D 区警惕周期见顶。" />
            <div className={styles.matrixSummary}>
              <span>行业：<b>{analysis.matrix?.industryCycle}</b></span>
              <span>公司：<b>{analysis.matrix?.companyCycle}</b></span>
              <strong>{analysis.matrix?.label}</strong>
            </div>
            <div className={styles.quadrants}>
              {QUADRANTS.map((q) => (
                <div key={q.id} className={`${styles.quadrant} ${styles[`q${q.id}`]} ${analysis.matrix?.quadrant === q.id ? styles.quadrantActive : ''}`}>
                  <span>{q.id}</span>
                  <strong>{q.title}</strong>
                  <p>{q.desc}</p>
                </div>
              ))}
            </div>
            <div className={styles.matrixRead}><Compass size={16} /> {analysis.matrix?.interpretation}</div>
          </section>

          <div className={styles.finalGrid}>
            <details className={styles.listCard} open>
              <summary className={styles.listHead}>
                <ScanSearch size={17} />
                <strong>未来观察清单</strong>
                <b>{(analysis.watchlist || []).length}</b>
                <ChevronDown size={15} aria-hidden="true" />
              </summary>
              <div className={styles.listBody}>
                {(analysis.watchlist || []).length ? <ol>{analysis.watchlist.map((x, i) => <li key={i}>{x}</li>)}</ol> : <p className={styles.muted}>未生成观察指标。</p>}
              </div>
            </details>
            <details className={styles.listCard}>
              <summary className={styles.listHead}>
                <ShieldAlert size={17} />
                <strong>证伪条件</strong>
                <b>{(analysis.falsification || []).length}</b>
                <ChevronDown size={15} aria-hidden="true" />
              </summary>
              <div className={styles.listBody}>
                {(analysis.falsification || []).length ? <ul>{analysis.falsification.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className={styles.muted}>未生成证伪条件。</p>}
              </div>
            </details>
          </div>

          <section className={`${styles.finalCard} ${styles[`judge_${judgement}`]} ${styles[`verdictTone_${verdictTone}`]}`}>
            <div className={styles.verdictMain}>
              <div className={styles.verdictSeal}>
                <VerdictIcon size={24} aria-hidden="true" />
                <span>最终判断</span>
                <strong>{judgement}</strong>
              </div>
              <div className={styles.verdictContent}>
                <p className={styles.verdictReason}>{analysis.final?.reason || '暂未形成最终判断。'}</p>
                <div className={styles.verdictMeta}>
                  <span>周期阶段 <b>{analysis.summary?.stage || '待确认'}</b></span>
                  <span>置信度 <b>{analysis.summary?.confidence || '中'}</b></span>
                  <span>四象限 <b>{analysis.matrix?.label || '待定位'}</b></span>
                  <span>关键指标 <b>{analysis.inflection?.keyIndicator || '待确认'}</b></span>
                </div>
              </div>
            </div>
            <div className={styles.verdictScale} aria-label={`最终判断：${judgement}`}>
              {VERDICT_STEPS.map((step, index) => (
                <span key={step} className={`${styles.verdictStep} ${index === verdictIndex ? styles.verdictStepActive : ''} ${index < verdictIndex ? styles.verdictStepPassed : ''}`}>
                  <i />
                  {step}
                </span>
              ))}
            </div>
          </section>

          {result.dataCard ? (
            <details className={styles.dataDetails}>
              <summary><Database size={16} /> 系统数据核验快照（展开查看原始口径）</summary>
              <pre>{result.dataCard}</pre>
            </details>
          ) : null}

          <section className={styles.sourceSection}>
            <details className={styles.sourceDetails}>
              <summary>
                <Database size={16} />
                <strong>数据来源</strong>
                <b>{(analysis.sources || []).length}</b>
                <ChevronDown size={15} aria-hidden="true" />
              </summary>
              <div className={styles.sourceDetailsBody}>
                <div className={styles.sourceList}>
                  {(analysis.sources || []).map((s, i) => <span key={`${s.name}-${i}`}>{s.name}{s.date ? ` · ${s.date}` : ''}</span>)}
                </div>
              </div>
            </details>
            {(analysis.missingData || []).length ? (
              <details className={`${styles.sourceDetails} ${styles.sourceDetailsAlert}`}>
                <summary>
                  <AlertTriangle size={16} />
                  <strong>关键数据缺口</strong>
                  <b>{analysis.missingData.length}</b>
                  <ChevronDown size={15} aria-hidden="true" />
                </summary>
                <div className={styles.sourceDetailsBody}>
                  <div className={styles.missingList}>
                    {analysis.missingData.map((x, i) => <span key={i}>{x}</span>)}
                  </div>
                </div>
              </details>
            ) : null}
            <p className={styles.disclaimer}>本模块用于周期性研究框架展示，不构成投资建议。实时与历史数据以页面标注日期为准，缺失指标不参与评分。</p>
          </section>
        </div>
      ) : null}
    </div>
  );
}
