'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { PRESET_POOLS } from '../data/masterPools';
import StockPoolImportModal from './StockPoolImportModal';
import { MasterAvatar } from './ui';
import { ensureAiReady, getAiConfig } from '../lib/aiGate';

import { loadUserPoolsLocal as loadUserPools, saveUserPoolsLocal as saveUserPools, fetchPoolsServer, syncPoolsOnLogin, upsertPoolServer, deletePoolServer } from '../lib/userPools';
import { useAuth } from '../lib/authProvider';

const HIDDEN_KEY = 'thinktank_hidden_presets';
function loadHiddenPresets() {
  try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'); } catch (e) { return []; }
}
function saveHiddenPresets(ids) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids)); } catch (e) { /* ignore */ }
}

// 页签持久化：刷新/重开页面后仍停留在「我的股票池」或「大师的股票池」
const POOL_TAB_KEY = 'thinktank_pool_tab';
function loadPoolTab() {
  try { return localStorage.getItem(POOL_TAB_KEY) === 'mine' ? 'mine' : 'master'; } catch (e) { return 'master'; }
}
function savePoolTab(t) {
  try { localStorage.setItem(POOL_TAB_KEY, t); } catch (e) { /* ignore */ }
}

// 本周是区间数据，标注「周一 ~ 最后交易日」，如 08-10 ~ 08-14
function weekRange(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const dow = (d.getDay() + 6) % 7; // 周一=0 … 周日=6
  const mon = new Date(d);
  mon.setDate(d.getDate() - dow);
  const mm = String(mon.getMonth() + 1).padStart(2, '0');
  const dd = String(mon.getDate()).padStart(2, '0');
  return `${mm}-${dd} ~ ${String(dateStr).slice(5)}`;
}

function fmtPct(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

// 轻量渲染：AI 输出里的 **加粗** 转成 <strong>
function renderInline(text, keyBase) {
  const normalized = String(text || '').replace(/\*\*\*/g, '**');
  const parts = normalized.split(/\*\*([\s\S]+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={`${keyBase}-${i}`}>{p}</strong> : p));
}

const REVIEW_CACHE_KEY = 'thinktank_review_cache';
function loadReviewCache() {
  try { return JSON.parse(localStorage.getItem(REVIEW_CACHE_KEY) || '{}'); } catch (e) { return {}; }
}
function saveReviewCache(cache) {
  try { localStorage.setItem(REVIEW_CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* ignore */ }
}

const COST_KEY = 'thinktank_costs';
function loadCosts() {
  try { return JSON.parse(localStorage.getItem(COST_KEY) || '{}'); } catch (e) { return {}; }
}
function saveCosts(c) {
  try { localStorage.setItem(COST_KEY, JSON.stringify(c)); } catch (e) { /* ignore */ }
}

const DAY_OPTIONS = [
  { label: '今天', v: 'today' },
  { label: '昨天', v: 'yesterday' },
  { label: '本周', v: 'week' },
  { label: '30天', v: 30 },
  { label: '60天', v: 60 },
  { label: '120天', v: 120 },
  { label: '半年', v: 120 },
  { label: '一年', v: 250 },
  { label: '两年', v: 500 },
  { label: '三年', v: 750 },
];

// 大师的选股池：预置大师池可切换 + AI 检索/手动粘贴添加 → 当日涨跌 + 区间统计（等权 vs 沪深300）
export default function StockPools() {
  const { user, loading: authLoading } = useAuth();
  const [userPools, setUserPools] = useState([]);
  const [activeId, setActiveId] = useState(null); // 默认选中列表第一项（hydration 完成后设置）
  const [importOpen, setImportOpen] = useState(false);
  const [importType, setImportType] = useState('mine'); // 传给共享导入弹窗的初始类型（mine | master）
  const [poolTab, setPoolTab] = useState('master'); // 左侧列表页签：master=大师的股票池 | mine=我的股票池
  const [searchOpen, setSearchOpen] = useState(false);
  const [suggestQuery, setSuggestQuery] = useState('');
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestResult, setSuggestResult] = useState(null);
  const [suggestError, setSuggestError] = useState('');
  const [suggestEmptied, setSuggestEmptied] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [reviewResult, setReviewResult] = useState(null);
  const [reviewCache, setReviewCache] = useState({});
  const [days, setDays] = useState('today'); // 默认选中今天（非交易日自动取最近交易日数据）
  const [daysMenuOpen, setDaysMenuOpen] = useState(false);
  const [costs, setCosts] = useState({});
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hiddenPresetIds, setHiddenPresetIds] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, name, isPreset }
  // 标记本地数据是否已加载完成：加载完成前禁止写 localStorage，避免用初始空数组覆盖已保存的数据
  const [hydrated, setHydrated] = useState(false);

  const masterPools = PRESET_POOLS.filter((p) => !hiddenPresetIds.includes(p.id)); // 大师的股票池（可隐藏）
  const pools = poolTab === 'mine' ? userPools : masterPools; // 页签：我的股票池 / 大师的股票池
  const active = pools.find((p) => p.id === activeId) || null;

  const switchPoolTab = (t) => {
    setPoolTab(t);
    setReviewOpen(false);
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 900;
    if (isMobile) { setActiveId(null); setDetail(null); return; } // 移动端切页签先看列表
    const list = t === 'mine' ? userPools : PRESET_POOLS.filter((p) => !hiddenPresetIds.includes(p.id));
    if (!list.some((p) => p.id === activeId)) {
      setActiveId(list.length ? list[0].id : null);
      setDetail(null);
    }
  };

  useEffect(() => {
    setUserPools(loadUserPools());
    setHiddenPresetIds(loadHiddenPresets());
    setCosts(loadCosts());
    setPoolTab(loadPoolTab());
    setReviewCache(loadReviewCache());
    setHydrated(true);
  }, []);

  // 登录后：从云端拉取我的股票池并合并到本地
  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) return;
    let alive = true;
    (async () => {
      const merged = await syncPoolsOnLogin(user.id);
      if (alive) { setUserPools(merged); setHydrated(true); }
    })();
    return () => { alive = false; };
  }, [authLoading, user?.id]);
  useEffect(() => {
    if (hydrated) saveUserPools(userPools);
  }, [userPools, hydrated]);
  useEffect(() => {
    if (hydrated) saveHiddenPresets(hiddenPresetIds);
  }, [hiddenPresetIds, hydrated]);
  useEffect(() => {
    if (hydrated) savePoolTab(poolTab);
  }, [poolTab, hydrated]);

  // 默认选中列表第一项；当前选中项被删除/隐藏时，也自动落到列表第一项
  useEffect(() => {
    if (!hydrated) return; // 等本地池子加载完成后再设默认，避免刷新后固定落在预置池（如巴菲特）上
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 900;
    if (isMobile) return; // 移动端不自动选中：先展示列表，点进才看详情
    if (pools.length && !pools.find((p) => p.id === activeId)) setActiveId(pools[0].id);
  }, [pools, activeId, hydrated]);

  const loadSeq = useRef(0); // 请求序号：丢弃过期响应，避免大池子加载慢时旧数据覆盖新选中的池子
  const loadDetail = useCallback(async (pool, d) => {
    if (!pool || !pool.symbols || !pool.symbols.length) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setError('');
    setDetail(null);
    try {
      const res = await fetch('/api/pools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: pool.symbols, days: typeof d === 'number' ? d : 30, period: String(d) }),
      });
      const data = await res.json();
      if (loadSeq.current !== seq) return; // 已切到别的池子，丢弃
      if (!res.ok || data.error) throw new Error(data.error || '加载失败，请重试');
      setDetail(data.result);
    } catch (e) {
      if (loadSeq.current !== seq) return;
      setError(e.message || '加载失败，请重试');
    } finally {
      if (loadSeq.current === seq) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) loadDetail(active, days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, days]);

  const createPool = (name, source, symbols) => {
    const pool = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name,
      source: source || '手动导入',
      createdAt: new Date().toISOString().slice(0, 10),
      symbols: [...new Set(symbols)],
    };
    setUserPools((prev) => [...prev, pool]);
    setActiveId(pool.id);
    if (user?.id) upsertPoolServer(pool, user.id); // 登录后同步到云端
    return pool;
  };

  const runSuggest = async () => {
    const q = suggestQuery.trim();
    if (!q || suggestLoading) return;
    if (!ensureAiReady()) return; // 免费次数用尽且未配置 Key → 弹设置
    setSuggestLoading(true);
    setSuggestError('');
    setSuggestEmptied(false);
    setSuggestResult(null);
    try {
      const res = await fetch('/api/pools/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, aiConfig: getAiConfig() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '生成失败，请重试');
      setSuggestResult(data.result);
    } catch (e) {
      setSuggestError(e.message || '生成失败，请重试');
    } finally {
      setSuggestLoading(false);
    }
  };

  const importSuggest = () => {
    if (!suggestResult || !suggestResult.stocks || !suggestResult.stocks.length) return;
    createPool(suggestResult.name, suggestResult.source, suggestResult.stocks.map((s) => s.code));
    setSearchOpen(false);
    setSuggestQuery('');
    setSuggestResult(null);
    setError('');
  };

  const removeSuggestStock = (code) => {
    setSuggestResult((prev) => {
      if (!prev) return prev;
      const stocks = prev.stocks.filter((s) => s.code !== code);
      if (stocks.length === 0) setSuggestEmptied(true);
      return { ...prev, stocks };
    });
  };

  const closeDrawers = () => { setImportOpen(false); setSearchOpen(false); setReviewOpen(false); };

  const goImportMaster = () => {
    setSearchOpen(false);
    setImportOpen(true);
    setImportType('master');
    setSuggestQuery('');
    setSuggestResult(null);
    setError('');
  };

  // 求大师评价我的票：随机邀请大师，结合最新行情给持仓做心理按摩
  const reviewTargetPool = () => {
    if (poolTab === 'mine' && active && active.symbols && active.symbols.length) return active;
    if (poolTab === 'mine' && userPools.length) return userPools.find((p) => p.symbols && p.symbols.length) || null;
    return null;
  };

  const runMasterReview = async () => {
    if (reviewLoading) return;
    const target = reviewTargetPool();
    if (!target) {
      setReviewError('请先在「我的股票池」创建一个含股票的池子');
      setReviewResult(null);
      return;
    }
    if (!ensureAiReady()) return;
    setReviewLoading(true);
    setReviewError('');
    setReviewResult(null);
    try {
      const res = await fetch('/api/pools/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: target.symbols, poolName: target.name, aiConfig: getAiConfig() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '生成失败，请重试');
      setReviewResult(data.result);
      setReviewCache((prev) => {
        const next = { ...prev, [target.id]: data.result };
        saveReviewCache(next);
        return next;
      });
    } catch (e) {
      setReviewError(e.message || '生成失败，请重试');
    } finally {
      setReviewLoading(false);
    }
  };

  const openMasterReview = () => {
    setSearchOpen(false);
    setImportOpen(false);
    setReviewOpen(true);
    setError('');
    setReviewError('');
    const target = reviewTargetPool();
    if (target && reviewCache[target.id]) {
      // 已有点评：直接恢复，不重新生成；除非点「再换一批大师」
      setReviewResult(reviewCache[target.id]);
      return;
    }
    runMasterReview();
  };

  const deletePool = (id) => {
    const isPreset = PRESET_POOLS.some((p) => p.id === id);
    if (isPreset) {
      setHiddenPresetIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    } else {
      setUserPools((prev) => prev.filter((p) => p.id !== id));
      if (user?.id) deletePoolServer(id, user.id); // 登录后从云端删除
    }
    if (activeId === id) { setActiveId(null); setDetail(null); }
  };

  // 持仓价：手动填入，保存到本地，用于校验/计算持仓盈亏
  const setCost = (poolId, code, val) => {
    const num = parseFloat(val);
    setCosts((prev) => {
      const pool = { ...(prev[poolId] || {}) };
      if (Number.isFinite(num) && num > 0) pool[code] = num;
      else delete pool[code];
      const next = { ...prev, [poolId]: pool };
      saveCosts(next);
      return next;
    });
  };

  const stats = detail ? detail.stats : null;
  const short = detail ? detail.short : null;
  const SHORT_OPTIONS = DAY_OPTIONS.slice(0, 3); // 今天/昨天/本周
  const RANGE_OPTIONS = DAY_OPTIONS.slice(3); // 30天~三年，收进「更多」下拉
  const rangeActive = RANGE_OPTIONS.find((o) => o.v === days);
  const isShort = typeof days !== 'number';

  return (
    <div className={`sp-workspace${active ? ' has-active' : ''}`}>
      <div className="mg-top">
        <button
          type="button"
          className={`sp-back${active ? '' : ' sp-back-hidden'}`}
          onClick={() => { setActiveId(null); setDetail(null); }}
          aria-label="返回列表"
          title="返回列表"
        >←</button>
        <div className="mg-title">大师的选股池</div>
      </div>

      <div className="sp-layout">
        {/* 左侧：池子列表 */}
        <div className="sp-side">
          <div className="sp-tabs" role="tablist" aria-label="池子类型">
            <button type="button" role="tab" className={poolTab === 'master' ? 'active' : ''} aria-selected={poolTab === 'master'} onClick={() => switchPoolTab('master')}>大师的股票池</button>
            <button type="button" role="tab" className={poolTab === 'mine' ? 'active' : ''} aria-selected={poolTab === 'mine'} onClick={() => switchPoolTab('mine')}>我的股票池</button>
          </div>
          <div className="sp-side-actions">
            <button type="button" className="sp-new" onClick={() => { setImportType(poolTab === 'mine' ? 'mine' : 'master'); setImportOpen(true); setSearchOpen(false); setReviewOpen(false); setError(''); }}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
              导入股票池
            </button>
            {poolTab === 'master' ? (
              <button type="button" className="sp-new sp-new-ai" onClick={() => { setSearchOpen(true); setImportOpen(false); setReviewOpen(false); setError(''); }}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
                搜寻大师股票池
              </button>
            ) : (
              <button type="button" className="sp-new sp-new-ai" onClick={openMasterReview}>
                <span className="sp-review-ico" aria-hidden="true">🙏</span>
                求大师评价我的票
              </button>
            )}
          </div>

          {pools.length === 0 && !importOpen && !searchOpen && !reviewOpen && (
            <div className="sp-empty">{poolTab === 'mine' ? '还没有「我的股票池」，点上方「导入股票池」创建' : '还没有池子，导入或搜寻一个'}</div>
          )}

          {pools.map((p) => (
            <div key={p.id} className={`sp-pool${activeId === p.id ? ' active' : ''}${p.preset ? ' preset' : ''}`} onClick={() => { setActiveId(p.id); setError(''); setReviewOpen(false); }}>
              <div className="sp-pool-name">{p.name}</div>
              <div className="sp-pool-meta">{p.symbols.length} 只 · {p.source}</div>
              <button type="button" className="sp-del" onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete({ id: p.id, name: p.name, isPreset: PRESET_POOLS.some((x) => x.id === p.id) });
              }} title="删除">✕</button>
            </div>
          ))}
        </div>

        {/* 右侧：池子详情 */}
        <div className="sp-main">
          {reviewOpen && (
            <div className="sp-review">
              <div className="sp-review-head">
                <div className="sp-review-pool">
                  <div className="sp-review-title">大师评价我的持仓</div>
                </div>
                <button type="button" className="mg-btn sp-review-refresh" onClick={runMasterReview} disabled={reviewLoading}>
                  {reviewLoading ? '大师正在发言…' : '↻ 再换一批大师'}
                </button>
              </div>

              {reviewError && <div className="mg-error">⚠ {reviewError}</div>}

              {reviewLoading && !reviewResult && (
                <div className="sp-review-loading">
                  <div className="sp-review-loading-inner">
                    <svg className="sp-loading-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                    <span className="sp-review-loading-text">正在邀请大师轮流点评你的持仓<span className="sp-loading-dots"><span>.</span><span>.</span><span>.</span></span></span>
                  </div>
                </div>
              )}

              {reviewResult && (
                <div className="sp-review-list">
                  {reviewResult.masters.map((m, i) => (
                    <div key={m.id || i} className="sp-review-master">
                      <div className="sp-review-master-head">
                        <MasterAvatar master={m} size={44} />
                        <div className="sp-review-master-info">
                          <div className="sp-review-master-name">{m.emoji ? `${m.emoji} ` : ''}{m.name}</div>
                          <div className="sp-review-master-title">{m.title || m.style || ''}</div>
                        </div>
                      </div>
                      <div className="sp-review-speech">{renderInline(m.speech, `svc-${i}`)}</div>
                      {m.risk && <div className="sp-review-risk">⚠ {m.risk}</div>}
                    </div>
                  ))}
                  {reviewResult.summary && (
                    <div className="sp-review-summary">{renderInline(reviewResult.summary, 'svc-sum')}</div>
                  )}
                  <div className="sp-review-disclaimer">本内容由 AI 生成，仅供学习交流与娱乐参考，不构成任何投资建议或意见，据此操作风险自负。</div>
                </div>
              )}
            </div>
          )}
          {!reviewOpen && (
            <>
          {!importOpen && !searchOpen && error && <div className="mg-error">⚠ {error}</div>}

          {active && (
            <div className="sp-detail">
              <div className="sp-detail-head">
                <div>
                  <div className="sp-detail-name">{active.name}</div>
                  <div className="sp-detail-meta">{active.source}{active.note ? ` · ${active.note}` : ''} · {active.symbols.length} 只股票</div>
                </div>
                <div className="sp-days-wrap">
                  <div className="sp-days" role="group" aria-label="统计区间">
                    {SHORT_OPTIONS.map((o) => (
                      <button key={o.label} type="button" className={days === o.v ? 'active' : ''} onClick={() => setDays(o.v)}>{o.label}</button>
                    ))}
                    <button type="button" className={`sp-days-more${daysMenuOpen ? ' open' : ''}${rangeActive ? ' has-val' : ''}`} onClick={() => setDaysMenuOpen((v) => !v)}>
                      {rangeActive ? `${rangeActive.label} ▾` : '更多 ▾'}
                    </button>
                  </div>
                  {daysMenuOpen && <div className="sp-days-overlay" onClick={() => setDaysMenuOpen(false)} />}
                  {daysMenuOpen && (
                    <div className="sp-days-menu" role="menu">
                      {RANGE_OPTIONS.map((o) => (
                        <button key={o.label} type="button" role="menuitem" className={days === o.v ? 'active' : ''} onClick={() => { setDays(o.v); setDaysMenuOpen(false); }}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="sp-disclaimer">⚠ 预置池按公开资料整理、可能不完整或过时；统计按当前池内股票回溯，未考虑期间调仓。数据来自公开行情，仅供学习参考，不构成投资建议。</div>

              {loading && (
                <div className="sp-loading">
                  <div className="sp-loading-inner">
                    <svg className="sp-loading-icon" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                    <span className="sp-loading-text">正在拉取行情与统计<span className="sp-loading-dots"><span>.</span><span>.</span><span>.</span></span></span>
                  </div>
                </div>
              )}

              {!loading && detail && stats && (
                <>
                  {isShort && short ? (
                    <div className="sp-short">
                      {[
                        { key: 'today', label: '今天', d: short.today },
                        { key: 'yesterday', label: '昨天', d: short.yesterday },
                        { key: 'week', label: '本周', d: short.week, range: true },
                      ].map((it) => (
                        <div key={it.key} className="sp-stat sp-stat-short">
                          <div className="sp-stat-label">{it.label}{it.d && it.d.date ? <span className="sp-stat-date"> · {it.range ? weekRange(it.d.date) : it.d.date.slice(5)}</span> : null}</div>
                          <div className="sp-stat-val-row">
                            <div className={`sp-stat-val${it.d && it.d.ret != null && it.d.ret >= 0 ? ' up' : ' down'}`}>{fmtPct(it.d ? it.d.ret : null)}</div>
                            <div className="sp-stat-count">{it.d ? `${it.d.up} 涨 / ${it.d.down} 跌` : ''}</div>
                          </div>
                          <div className="sp-stat-sub">vs 上证指数 {fmtPct(it.d ? it.d.indexRet : null)}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="sp-stats">
                      <div className="sp-stat">
                        <div className="sp-stat-label">区间等权涨幅</div>
                        <div className={`sp-stat-val${stats.intervalRet >= 0 ? ' up' : ' down'}`}>{fmtPct(stats.intervalRet)}</div>
                        <div className="sp-stat-sub">vs 上证指数 {fmtPct(stats.indexRet)}</div>
                      </div>
                      <div className="sp-stat">
                        <div className="sp-stat-label">跑赢大盘天数</div>
                        <div className="sp-stat-val">{stats.beatDays}<span className="sp-stat-unit">/ {stats.cmpDays} 日</span></div>
                        <div className="sp-stat-sub">占比 {stats.beatRatio != null ? `${(stats.beatRatio * 100).toFixed(0)}%` : '—'}</div>
                      </div>
                      <div className="sp-stat">
                        <div className="sp-stat-label">区间内上涨/下跌</div>
                        <div className="sp-stat-val"><span className="up">{stats.upInRange} 涨</span><span className="down"> {stats.downInRange} 跌</span></div>
                        <div className="sp-stat-sub">上涨天数占比均值 {(stats.avgUpDaysRatio != null ? (stats.avgUpDaysRatio * 100).toFixed(0) : '—')}%</div>
                      </div>
                    </div>
                  )}

                  <table className="sp-table">
                    <thead>
                      <tr>
                        <th>代码</th><th>名称</th><th>现价</th><th>今日</th><th>区间涨幅</th><th>上涨天数</th><th>持仓价</th><th>持仓盈亏</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.stocks.map((s) => {
                        const cost = costs[active.id] && costs[active.id][s.code];
                        // 持仓价：优先用户已保存的成本；其次预置池已知的持仓价（如巴菲特公开报道的估算成本）；查不到则留空手动填
                        const poolCost = active.costs && active.costs[s.code] != null ? active.costs[s.code] : null;
                        const effCost = cost != null ? cost : poolCost;
                        const pnl = effCost != null && effCost > 0 && s.price != null ? ((s.price - effCost) / effCost) * 100 : null;
                        return (
                          <tr key={s.code || s.name}>
                            <td className="mono" data-label="代码">{s.code}</td>
                            <td data-label="名称">{s.name || '—'}</td>
                            <td data-label="现价">{s.price != null ? s.price.toFixed(2) : '—'}</td>
                            <td data-label="今日" className={s.changePct >= 0 ? 'up' : 'down'}>{s.changePct != null ? fmtPct(s.changePct) : '—'}</td>
                            <td data-label="区间涨幅" className={s.ret >= 0 ? 'up' : 'down'}>{s.ret != null ? fmtPct(s.ret) : '—'}</td>
                            <td data-label="上涨天数">{s.totalDays ? `${s.upDays} / ${s.totalDays}（${((s.upDays / s.totalDays) * 100).toFixed(0)}%）` : '—'}</td>
                            <td data-label="持仓价">
                              <input
                                className="sp-cost-input"
                                type="number"
                                step="0.01"
                                placeholder="—"
                                value={effCost != null ? effCost : ''}
                                onChange={(e) => setCost(active.id, s.code, e.target.value)}
                                title="填入你的持仓成本价"
                              />
                            </td>
                            <td data-label="持仓盈亏" className={pnl != null ? (pnl >= 0 ? 'up' : 'down') : ''}>{pnl != null ? fmtPct(pnl) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
            </>
          )}
      </div>

      {searchOpen && <div className="invite-drawer-backdrop" onClick={closeDrawers} />}
      {searchOpen && (
        <div className="invite-drawer" role="dialog" aria-modal="true" aria-labelledby="poolDrawerTitle" onClick={(e) => e.stopPropagation()}>
          <div className="invite-head invite-drawer-head">
            <h3 className="invite-title" id="poolDrawerTitle">搜寻大师股票池</h3>
            <button type="button" className="modal-close" onClick={closeDrawers} aria-label="关闭">×</button>
          </div>
          <div className="invite-drawer-body">
            {error && <div className="mg-error">⚠ {error}</div>}



            {searchOpen && (
              <div className="sp-form sp-form-drawer">
                <div className="sp-form-label">输入大师关键词，检索其公开可查证的 A 股选股池</div>
                <input className="mg-input mg-input-line" placeholder="如：寒武纪的鳄鱼 / 高瓴 / 但斌" value={suggestQuery} onChange={(e) => setSuggestQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runSuggest()} />
                <button type="button" className="mg-btn" onClick={runSuggest} disabled={!suggestQuery.trim() || suggestLoading}>
                  {suggestLoading ? '正在检索…' : '检索生成'}
                </button>
                {suggestError && <div className="mg-error">⚠ {suggestError}</div>}
                {suggestResult && suggestResult.stocks && suggestResult.stocks.length > 0 && (
                  <div className="sp-suggest">
                    <div className="sp-suggest-name">{suggestResult.name}</div>
                    <div className="sp-suggest-source">{suggestResult.source}</div>
                    <div className="sp-suggest-stocks">
                      {suggestResult.stocks.map((st) => (
                        <div key={st.code} className="sp-suggest-stock">
                          <span className="mono">{st.code}</span>
                          <span className="sp-suggest-stock-name">{st.name}</span>
                          <button type="button" className="sp-extract-del sp-suggest-del" onClick={() => removeSuggestStock(st.code)} aria-label="删除">✕</button>
                          {st.reason && <span className="sp-suggest-reason">{st.reason}</span>}
                        </div>
                      ))}
                    </div>
                    <button type="button" className="mg-btn" onClick={importSuggest} disabled={!suggestResult.stocks.length}>导入此池</button>
                  </div>
                )}
                {suggestResult && (!suggestResult.stocks || suggestResult.stocks.length === 0) && (
                  <div className="sp-suggest-empty">
                    <div className="sp-suggest-empty-title">
                      {suggestEmptied ? '已移除全部标的' : `搜不到「${suggestQuery.trim() || suggestResult.name}」的公开选股池`}
                    </div>
                    <p className="sp-suggest-empty-desc">
                      {suggestEmptied
                        ? '可换个关键词重新搜索，或去手动导入填写。'
                        : '只会返回可查证的公开持仓，不会凭空编造。可换个更常见的名字再搜，或用「导入股票池」手动填写 / 粘贴报道提取。'}
                    </p>
                    <button type="button" className="mg-btn" onClick={goImportMaster}>去手动导入</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="modal-overlay" onMouseDown={() => setConfirmDelete(null)}>
          <div className="modal-content sp-del-modal" onMouseDown={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setConfirmDelete(null)} aria-label="关闭">✕</button>
            <div className="sp-del-modal-title">⚠ 删除股票池</div>
            <div className="sp-del-modal-text">
              {confirmDelete.isPreset ? (
                <>确定要删除「<strong>{confirmDelete.name}</strong>」吗？删除后左侧列表不再显示。</>
              ) : (
                <>确定要删除「<strong>{confirmDelete.name}</strong>」吗？删除后不可恢复。</>
              )}
            </div>
            <div className="mg-foot sp-del-modal-foot">
              <button type="button" className="mg-btn sp-del-cancel" onClick={() => setConfirmDelete(null)}>取消</button>
              <button type="button" className="mg-btn sp-del-confirm" onClick={() => { deletePool(confirmDelete.id); setConfirmDelete(null); }}>确认删除</button>
            </div>
          </div>
        </div>
      )}
      <StockPoolImportModal
        open={importOpen}
        initialType={importType}
        onClose={() => setImportOpen(false)}
        onCreated={(pool) => { setUserPools(loadUserPools()); setActiveId(pool.id); setError(''); setReviewOpen(false); }}
      />
    </div>
    </div>
  );
}
