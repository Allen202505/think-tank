'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Building2,
  CalendarClock,
  CircleDollarSign,
  Compass,
  Database,
  ExternalLink,
  Factory,
  GitBranch,
  Layers3,
  LoaderCircle,
  Network,
  Route,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  UserRound,
  Workflow,
} from 'lucide-react';
import {
  CHOKE_EXAMPLES,
  CHOKE_EXCLUSION_RULES,
  CHOKE_FRAMEWORK_STEPS,
  CHOKE_MARKETS,
  SERENITY_PROFILE,
  SERENITY_SKILL,
} from '../data/supplyChainBottleneck';
import { consumeFree, ensureAiReady, getAiConfig } from '../lib/aiGate';
import { readApiResponse } from '../lib/apiResponse.mjs';
import { markFeatureCompleted } from '../lib/shareInvite';
import { readJsonCache, researchCacheTtlMs, writeJsonCache } from '../lib/browserCache.mjs';
import ModuleHero from './ModuleHero';
import styles from './SupplyChainBottleneck.module.css';

const LOADING_STEPS = [
  '正在读取板块行情与周期位置…',
  '正在沿产业链向上游追溯卡点…',
  '正在执行真瓶颈 / 伪概念排除规则…',
  '正在回填候选标的实时行情…',
  '正在整理证伪条件与催化日历…',
];

function formatPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function formatNumber(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function formatMarketCap(value, currency = '') {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (currency === 'USD') return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}万亿`;
  return `${(n / 1e8).toFixed(1)}亿`;
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function scoreTone(score) {
  if (score == null) return 'unknown';
  if (score >= 80) return 'strong';
  if (score >= 60) return 'medium';
  return 'weak';
}

function verdictTone(verdict) {
  if (/排除/.test(verdict)) return 'excluded';
  if (/真瓶颈/.test(verdict)) return 'strong';
  return 'watch';
}

function SectionTitle({ icon: Icon, step, title, desc }) {
  return (
    <div className={styles.sectionTitle}>
      <span className={styles.sectionIcon}><Icon size={18} /></span>
      <div>
        <div className={styles.eyebrow}>{step}</div>
        <h3>{title}</h3>
        {desc ? <p>{desc}</p> : null}
      </div>
    </div>
  );
}

function IntroCard({ icon: Icon, eyebrow, title, children, className = '' }) {
  return (
    <article className={`${styles.introCard} ${className}`}>
      <div className={styles.introHead}>
        <span className={styles.introIcon}><Icon size={19} /></span>
        <div>
          <div className={styles.eyebrow}>{eyebrow}</div>
          <h3>{title}</h3>
        </div>
      </div>
      {children}
    </article>
  );
}

function QuoteRow({ label, children, tone = '' }) {
  return (
    <div className={`${styles.quoteRow} ${tone ? styles[`quote_${tone}`] : ''}`}>
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

export default function SupplyChainBottleneck() {
  const [industry, setIndustry] = useState('AI 算力链');
  const [market, setMarket] = useState('auto');
  const [focus, setFocus] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadStep, setLoadStep] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    if (!loading) {
      setLoadStep(0);
      return undefined;
    }
    const timer = setInterval(() => setLoadStep((current) => Math.min(current + 1, LOADING_STEPS.length - 1)), 12000);
    return () => clearInterval(timer);
  }, [loading]);

  const run = useCallback(async () => {
    const chain = industry.trim();
    if (loading || chain.length < 2) return;
    const cacheKey = `${chain}::${market}::${focus.trim()}`;
    const cached = readJsonCache('stock-choke', cacheKey);
    if (cached?.value?.result) {
      setResult(cached.value.result);
      setMeta(cached.value.meta || null);
      setError('');
      return;
    }
    if (!ensureAiReady()) return;
    consumeFree('供应链瓶颈分析');
    setLoading(true);
    setError('');
    setResult(null);
    setMeta(null);
    try {
      const response = await fetch('/api/stock-choke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ industry: chain, market, focus: focus.trim(), aiConfig: getAiConfig() }),
      });
      const data = await readApiResponse(response);
      if (!response.ok || data.error) throw new Error(data.error || '分析失败，请稍后重试');
      setResult(data.result);
      setMeta(data.meta || null);
      writeJsonCache('stock-choke', cacheKey, { result: data.result, meta: data.meta || null }, researchCacheTtlMs(1));
      markFeatureCompleted('供应链瓶颈分析');
    } catch (e) {
      const message = String(e?.message || e || '分析失败，请稍后重试');
      setError(/failed to fetch|network|load|timed? ?out|econn|reset|terminated/i.test(message)
        ? '网络异常或连接超时，请稍后重试'
        : message);
    } finally {
      setLoading(false);
    }
  }, [focus, industry, loading, market]);

  const analysis = result;
  const sectorSnapshot = meta?.sectorSnapshot;
  const topChoke = analysis?.supplyChain?.reduce((best, row) => (
    row.chokeScore != null && (!best || row.chokeScore > best.chokeScore) ? row : best
  ), null);

  return (
    <div className={styles.page}>
      <ModuleHero
        iconId="supply-chain"
        kicker="SERENITY CHOKE POINT · SKILL v3.2.1"
        title="供应链瓶颈分析"
        description="沿产业链向上游追溯，寻找“一旦断货、整条产业就会降速”的关键节点，再用主营、估值、资本与产业证据筛掉伪概念。"
      />

      <section className={styles.introGrid} aria-label="Skill 与分析框架介绍">
        <IntroCard
          icon={BookOpen}
          eyebrow="USED SKILL"
          title="serenity-stock-choke"
          className={styles.skillCard}
        >
          <p className={styles.introBody}>
            本模块接入 fadewalk 开源的 <strong>{SERENITY_SKILL.displayName}</strong>，复用其卡脖子选股、七条排除规则和跨市场信号设计。
          </p>
          <div className={styles.metaPills}>
            <span>v{SERENITY_SKILL.version}</span>
            <span>{SERENITY_SKILL.license}</span>
            <span>{SERENITY_SKILL.markets}</span>
          </div>
          <ul className={styles.compactList}>
            {SERENITY_SKILL.dataStrategy.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <a className={styles.sourceLink} href={SERENITY_SKILL.sourceUrl} target="_blank" rel="noreferrer">
            查看 Skill 原仓库 <ExternalLink size={13} />
          </a>
        </IntroCard>

        <IntroCard icon={UserRound} eyebrow="WHO IS SERENITY" title={`${SERENITY_PROFILE.name} ${SERENITY_PROFILE.handle}`}>
          <blockquote className={styles.quote}>{SERENITY_PROFILE.quote}</blockquote>
          <p className={styles.introBody}>{SERENITY_PROFILE.summary}</p>
          <p className={styles.caveat}><AlertTriangle size={13} /> {SERENITY_PROFILE.caveat}</p>
        </IntroCard>

        <IntroCard icon={Workflow} eyebrow="SIX-STEP FRAMEWORK" title="卡脖子六步法">
          <ol className={styles.stepList}>
            {CHOKE_FRAMEWORK_STEPS.map((step, index) => (
              <li key={step.id}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{step.label}</strong>
                  <p>{step.question}</p>
                </div>
              </li>
            ))}
          </ol>
        </IntroCard>
      </section>

      <aside className={styles.ruleStrip}>
        <ShieldAlert size={16} />
        <strong>七条排除规则：</strong>
        <span>{CHOKE_EXCLUSION_RULES.join(' · ')}</span>
      </aside>

      <section className={styles.inputCard}>
        <div className={styles.inputHeader}>
          <div>
            <div className={styles.eyebrow}>RESEARCH INPUT</div>
            <h3>输入产业链或板块</h3>
          </div>
          <span className={styles.methodBadge}><Database size={13} /> 候选行情自动回填</span>
        </div>

        <label className={styles.fieldLabel} htmlFor="choke-industry">产业链 / 板块</label>
        <div className={styles.searchRow}>
          <div className={styles.searchBox}>
            <Search size={17} />
            <input
              id="choke-industry"
              value={industry}
              maxLength={40}
              onChange={(event) => setIndustry(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') run(); }}
              placeholder="例如：AI 算力链、CPO、半导体设备、电力"
            />
          </div>
          <button type="button" className={styles.runBtn} disabled={loading || industry.trim().length < 2} onClick={run}>
            {loading ? <LoaderCircle className={styles.spin} size={17} /> : <Sparkles size={17} />}
            {loading ? '分析中…' : '开始分析'}
          </button>
        </div>

        <div className={styles.exampleRow}>
          <span>常用：</span>
          {CHOKE_EXAMPLES.map((item) => (
            <button key={item} type="button" onClick={() => setIndustry(item)}>{item}</button>
          ))}
        </div>

        <div className={styles.marketRow}>
          <span>市场范围</span>
          <div className={styles.marketTabs} role="tablist" aria-label="市场范围">
            {CHOKE_MARKETS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={market === item.id}
                className={market === item.id ? styles.marketActive : ''}
                onClick={() => setMarket(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <label className={styles.fieldLabel} htmlFor="choke-focus">补充关注（可选）</label>
        <input
          id="choke-focus"
          className={styles.focusInput}
          value={focus}
          maxLength={300}
          onChange={(event) => setFocus(event.target.value)}
          placeholder="例如：重点关注 1.6T 光模块、高纯石英、出口管制与扩产周期"
        />

        <p className={styles.inputNote}>
          <AlertTriangle size={14} />
          分析会优先读取板块行情并回填候选公司最新价格、估值与市值；产能、订单、份额等产业证据仍需按报告中的数据缺口继续核验。
        </p>
      </section>

      {error ? <div className={styles.error} role="alert"><AlertTriangle size={16} /> {error}</div> : null}

      {loading ? (
        <section className={styles.loadingCard} aria-live="polite">
          <div className={styles.loadingIcon}><Network size={25} /></div>
          <strong>{LOADING_STEPS[loadStep]}</strong>
          <p>正在执行完整六步法，通常需要 20–60 秒。</p>
          <div className={styles.loadingBar}><span /></div>
        </section>
      ) : null}

      {analysis ? (
        <div className={styles.results}>
          {sectorSnapshot ? (
            <section className={styles.snapshotBar}>
              <div className={styles.snapshotTitle}>
                <BarChart3 size={17} />
                <div>
                  <strong>{sectorSnapshot.available ? sectorSnapshot.name : '板块行情未回填'}</strong>
                  <span>{sectorSnapshot.available ? `${sectorSnapshot.code || ''} · ${sectorSnapshot.date || '最新交易日'}` : sectorSnapshot.reason}</span>
                </div>
              </div>
              {sectorSnapshot.available ? (
                <div className={styles.snapshotStats}>
                  <span>点位 <b>{formatNumber(sectorSnapshot.price)}</b></span>
                  <span>当日 <b className={Number(sectorSnapshot.changePct) >= 0 ? styles.up : styles.down}>{formatPct(sectorSnapshot.changePct)}</b></span>
                  <span>近5日 <b>{formatPct(sectorSnapshot.returns?.d5)}</b></span>
                  <span>近20日 <b>{formatPct(sectorSnapshot.returns?.d20)}</b></span>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className={styles.summaryCard}>
            <div className={styles.summaryCopy}>
              <div className={styles.eyebrow}>CHOKE POINT BRIEF</div>
              <h3>{industry} · {analysis.summary.cycleType}</h3>
              <p>{analysis.summary.thesis}</p>
              <div className={styles.badgeRow}>
                <span>{analysis.summary.cycleStage}</span>
                <span>置信度 {analysis.summary.confidence}</span>
                {topChoke ? <span>最高瓶颈强度 {topChoke.chokeScore ?? '—'} / 100</span> : null}
              </div>
            </div>
            <div className={`${styles.verdictBox} ${styles[`verdict_${analysis.summary.verdict.includes('明确') ? 'strong' : analysis.summary.verdict.includes('暂未') ? 'weak' : 'watch'}`]}`}>
              <Compass size={20} />
              <span>框架结论</span>
              <strong>{analysis.summary.verdict}</strong>
              <small>{analysis.summary.dataBasis?.[0] || '结论会随产业证据更新'}</small>
            </div>
          </section>

          <section className={styles.section}>
            <SectionTitle
              icon={Route}
              step="STEP 01–02 · SUPPLY CHAIN MAP"
              title="供应链卡脖子地图"
              desc="按上游材料到终端逐层展开；瓶颈强度是框架评分，不是涨跌预测。"
            />
            {analysis.supplyChain.length ? (
              <div className={styles.chain}>
                {analysis.supplyChain.map((row, index) => (
                  <article key={`${row.layer}-${row.node}-${index}`} className={styles.chainNode}>
                    <div className={styles.chainIndex}>{String(index + 1).padStart(2, '0')}</div>
                    <div className={styles.chainBody}>
                      <div className={styles.chainHead}>
                        <span>{row.layer}</span>
                        <h4>{row.node}</h4>
                        <b className={styles[`score_${scoreTone(row.chokeScore)}`]}>{row.chokeScore ?? '—'} 分</b>
                      </div>
                      <p>{row.role}</p>
                      <p className={styles.bottleneckText}><strong>瓶颈判断：</strong>{row.bottleneck}</p>
                      <div className={styles.tagRow}>
                        {row.chokeReasons.map((reason) => <span key={reason}>{reason}</span>)}
                        <em>{row.dataStatus}</em>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className={styles.empty}>模型未返回可用的供应链层级。</p>}
          </section>

          <section className={styles.section}>
            <SectionTitle
              icon={Target}
              step="STEP 03 · CHOKE POINTS"
              title="真正的卡点在哪里"
              desc="优先看不可替代、扩产慢、集中度高且能影响下游节奏的环节。"
            />
            {analysis.chokePoints.length ? (
              <div className={styles.chokeGrid}>
                {analysis.chokePoints.map((point) => (
                  <article key={`${point.rank}-${point.node}`} className={styles.chokeCard}>
                    <div className={styles.rankSeal}>#{point.rank}</div>
                    <h4>{point.node}</h4>
                    <p>{point.why}</p>
                    <dl className={styles.signalList}>
                      <div><dt>壁垒</dt><dd>{point.barrier}</dd></div>
                      <div><dt>替代难度</dt><dd>{point.substitution}</dd></div>
                      <div><dt>跟踪指标</dt><dd>{point.watchMetric}</dd></div>
                    </dl>
                    {point.evidenceNeeded.length ? (
                      <div className={styles.evidenceBox}>
                        <span>待核验证据</span>
                        <div>{point.evidenceNeeded.map((item) => <em key={item}>{item}</em>)}</div>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : <p className={styles.empty}>未生成卡点清单。</p>}
          </section>

          <section className={styles.section}>
            <SectionTitle
              icon={Building2}
              step="STEP 03–04 · CANDIDATE SIGNALS"
              title="候选标的四维信号卡"
              desc="卡脖子定位、估值水位、资本信号与机构关注度四项分开判断；行情已回填，产业结论仍需核验。"
            />
            {analysis.candidates.length ? (
              <div className={styles.candidateGrid}>
                {analysis.candidates.map((candidate, index) => (
                  <article key={`${candidate.name}-${candidate.symbol}-${index}`} className={styles.candidateCard}>
                    <div className={styles.candidateHead}>
                      <div>
                        <span className={styles.marketLabel}>{candidate.market}</span>
                        <h4>{candidate.name} <small>{candidate.symbol}</small></h4>
                        <p>{candidate.node} · {candidate.position}</p>
                      </div>
                      <span className={`${styles.verdictTag} ${styles[`tag_${verdictTone(candidate.verdict)}`]}`}>{candidate.verdict}</span>
                    </div>

                    <div className={styles.liveQuote}>
                      {candidate.quote ? (
                        <>
                          <QuoteRow label="价格" tone={Number(candidate.quote.changePct) >= 0 ? 'up' : 'down'}>
                            {formatNumber(candidate.quote.price, 2)} {candidate.quote.currency || ''}
                          </QuoteRow>
                          <QuoteRow label="涨跌" tone={Number(candidate.quote.changePct) >= 0 ? 'up' : 'down'}>{formatPct(candidate.quote.changePct)}</QuoteRow>
                          <QuoteRow label="PE / PB">{formatNumber(candidate.quote.pe, 2)} / {formatNumber(candidate.quote.pb, 2)}</QuoteRow>
                          <QuoteRow label="市值">{formatMarketCap(candidate.quote.marketCap, candidate.quote.currency)}</QuoteRow>
                          <p><Database size={12} /> {formatTime(candidate.quote.asOf)} · {candidate.dataStatus}</p>
                        </>
                      ) : (
                        <p><AlertTriangle size={12} /> {candidate.dataStatus}</p>
                      )}
                    </div>

                    <div className={styles.fourSignals}>
                      <div><span>卡脖子定位</span><p>{candidate.signals.chokePosition || '数据不足'}</p></div>
                      <div><span>估值水位</span><p>{candidate.signals.valuation}</p></div>
                      <div><span>资本信号</span><p>{candidate.signals.capital}</p></div>
                      <div><span>机构关注度</span><p>{candidate.signals.institution}</p></div>
                    </div>

                    {candidate.exclusionRule ? <p className={styles.exclusion}><ShieldAlert size={13} /> 排除规则：{candidate.exclusionRule}</p> : null}
                    {candidate.risks.length ? (
                      <ul className={styles.riskList}>
                        {candidate.risks.map((risk) => <li key={risk}>{risk}</li>)}
                      </ul>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : <p className={styles.empty}>本轮未形成可展示的候选标的。</p>}
          </section>

          <section className={styles.section}>
            <SectionTitle
              icon={GitBranch}
              step="STEP 05 · CROSS CHECK"
              title="多空双向确认"
              desc="真瓶颈也必须同时检查反证、拥挤与资金位置，避免只讲单边故事。"
            />
            <div className={styles.crossGrid}>
              <article className={`${styles.signalPanel} ${styles.bullPanel}`}>
                <div className={styles.panelHead}><TrendingUp size={17} /><strong>支持瓶颈逻辑</strong></div>
                {analysis.crossCheck.bull.length ? <ul>{analysis.crossCheck.bull.map((item) => <li key={item}>{item}</li>)}</ul> : <p className={styles.empty}>未生成做多证据。</p>}
              </article>
              <article className={`${styles.signalPanel} ${styles.bearPanel}`}>
                <div className={styles.panelHead}><TrendingDown size={17} /><strong>反证与拥挤信号</strong></div>
                {analysis.crossCheck.bear.length ? <ul>{analysis.crossCheck.bear.map((item) => <li key={item}>{item}</li>)}</ul> : <p className={styles.empty}>未生成反证信号。</p>}
              </article>
            </div>
            <article className={styles.capitalCard}>
              <div className={styles.panelHead}><CircleDollarSign size={17} /><strong>资金面与拥挤度</strong><span>{analysis.capital.crowding}</span></div>
              <p>{analysis.capital.summary}</p>
              {analysis.capital.watch.length ? <div className={styles.tagRow}>{analysis.capital.watch.map((item) => <span key={item}>{item}</span>)}</div> : null}
            </article>
          </section>

          <section className={styles.section}>
            <SectionTitle
              icon={CalendarClock}
              step="STEP 06 · VERIFICATION"
              title="催化日历、观察周期与组合约束"
              desc="把判断拆成未来可验证的事件，同时限制同一瓶颈环节的重复敞口。"
            />
            <div className={styles.verifyGrid}>
              <div className={styles.catalystCard}>
                <h4><CalendarClock size={15} /> 未来 90 天催化</h4>
                {analysis.catalysts.length ? (
                  <div className={styles.catalystList}>
                    {analysis.catalysts.map((item, index) => (
                      <div key={`${item.date}-${item.event}-${index}`}>
                        <span>{item.date}</span>
                        <div><strong>{item.event}</strong><p>{item.verification}</p></div>
                      </div>
                    ))}
                  </div>
                ) : <p className={styles.empty}>暂无明确催化事件。</p>}
              </div>
              <div className={styles.horizonCard}>
                <h4><Layers3 size={15} /> 研究观察周期</h4>
                <div className={styles.horizonItem}><span>短线</span><p>{analysis.horizons.short}</p></div>
                <div className={styles.horizonItem}><span>中线</span><p>{analysis.horizons.medium}</p></div>
                <div className={styles.horizonItem}><span>长线</span><p>{analysis.horizons.long}</p></div>
                <div className={`${styles.horizonItem} ${styles.riskItem}`}><span>风控</span><p>{analysis.horizons.riskControl}</p></div>
              </div>
            </div>
            <div className={styles.portfolioGrid}>
              <div><Factory size={15} /><span>组合敞口</span><p>{analysis.portfolio.exposureRule}</p></div>
              <div><ShieldAlert size={15} /><span>重新评估原则</span><p>{analysis.portfolio.stopRule}</p></div>
            </div>
          </section>

          <section className={styles.sourceSection}>
            <details open={analysis.dataGaps.length > 0}>
              <summary><AlertTriangle size={16} /><strong>关键数据缺口</strong><b>{analysis.dataGaps.length}</b></summary>
              <div className={styles.gapList}>
                {analysis.dataGaps.length ? analysis.dataGaps.map((item) => <span key={item}>{item}</span>) : <span>本轮未返回额外缺口。</span>}
              </div>
            </details>
            <details>
              <summary><Database size={16} /><strong>本轮数据口径</strong></summary>
              <div className={styles.sourceBody}>
                <p>{meta?.dataNote || '候选行情来自公开接口；供应链结论属于框架推演。'}</p>
                <p>生成时间：{formatTime(meta?.generatedAt)} · Skill 版本：v{meta?.skill?.version || SERENITY_SKILL.version}</p>
                <a href={SERENITY_SKILL.sourceUrl} target="_blank" rel="noreferrer">serenity-stock-choke 原仓库 <ExternalLink size={12} /></a>
              </div>
            </details>
            <p className={styles.disclaimer}>{analysis.disclaimer}</p>
          </section>
        </div>
      ) : null}
    </div>
  );
}
