'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { PRESET_POOLS } from '../data/masterPools';
import { PRESET_MASTERS } from '../data/masters';

const LS_KEY = 'thinktank_user_pools';

function loadUserPools() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; }
}
function saveUserPools(pools) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(pools)); } catch (e) { /* ignore */ }
}

const HIDDEN_KEY = 'thinktank_hidden_presets';
function loadHiddenPresets() {
  try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'); } catch (e) { return []; }
}
function saveHiddenPresets(ids) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids)); } catch (e) { /* ignore */ }
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

const COST_KEY = 'thinktank_costs';
function loadCosts() {
  try { return JSON.parse(localStorage.getItem(COST_KEY) || '{}'); } catch (e) { return {}; }
}
function saveCosts(c) {
  try { localStorage.setItem(COST_KEY, JSON.stringify(c)); } catch (e) { /* ignore */ }
}

// 大师选项：仅来自大师PK的现役大师名单，导入大师股票池时必须先选定
const MASTER_OPTIONS = PRESET_MASTERS.map((m) => ({ value: m.name, label: m.name }));

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
  const [userPools, setUserPools] = useState([]);
  const [activeId, setActiveId] = useState(null); // 默认选中列表第一项（hydration 完成后设置）
  const [importOpen, setImportOpen] = useState(false);
  const [importType, setImportType] = useState('mine'); // mine | master
  const [importMode, setImportMode] = useState('manual'); // manual | extract
  const [masterSelect, setMasterSelect] = useState('');
  const [form, setForm] = useState({ name: '', source: '', stocks: '' });
  const [extractInput, setExtractInput] = useState('');
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [extracted, setExtracted] = useState([]); // [{code,name}]
  const [extractSource, setExtractSource] = useState('');
  const [extractEmpty, setExtractEmpty] = useState(false);
  const [manualPreview, setManualPreview] = useState([]); // [{code,name}]
  const [manualMissing, setManualMissing] = useState([]); // 未能识别的名称
  const [manualResolving, setManualResolving] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [suggestQuery, setSuggestQuery] = useState('');
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestResult, setSuggestResult] = useState(null);
  const [suggestError, setSuggestError] = useState('');
  const [suggestEmptied, setSuggestEmptied] = useState(false);
  // 默认区间：交易日默认「今天」；周末非交易日默认「本周」，避免「今天」回退数据块被默认高亮
  const [days, setDays] = useState(() => {
    const dow = new Date().getDay(); // 0=周日 6=周六
    return dow === 0 || dow === 6 ? 'week' : 'today';
  });
  const [daysMenuOpen, setDaysMenuOpen] = useState(false);
  const [costs, setCosts] = useState({});
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hiddenPresetIds, setHiddenPresetIds] = useState([]);
  // 标记本地数据是否已加载完成：加载完成前禁止写 localStorage，避免用初始空数组覆盖已保存的数据
  const [hydrated, setHydrated] = useState(false);

  const pools = [...userPools, ...PRESET_POOLS.filter((p) => !hiddenPresetIds.includes(p.id))]; // 用户导入/新建的池子排在最前，预置池可隐藏
  const active = pools.find((p) => p.id === activeId) || null;

  useEffect(() => {
    setUserPools(loadUserPools());
    setHiddenPresetIds(loadHiddenPresets());
    setCosts(loadCosts());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) saveUserPools(userPools);
  }, [userPools, hydrated]);
  useEffect(() => {
    if (hydrated) saveHiddenPresets(hiddenPresetIds);
  }, [hiddenPresetIds, hydrated]);

  // 默认选中列表第一项；当前选中项被删除/隐藏时，也自动落到列表第一项
  useEffect(() => {
    if (!hydrated) return; // 等本地池子加载完成后再设默认，避免刷新后固定落在预置池（如巴菲特）上
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
    return pool;
  };

  // 池子名称自动生成：大师池用选定的大师名；其余按「我的股票池 N / 大师的股票池 N」
  const selectedMasterName = () => masterSelect.trim();
  const nextPoolName = (isMaster) => {
    if (isMaster && selectedMasterName()) return `${selectedMasterName()} · 选股池`;
    const prefix = isMaster ? '大师的股票池' : '我的股票池';
    const n = userPools.filter((p) => p.name.startsWith(prefix)).length + 1;
    return `${prefix} ${n}`;
  };

  // 手动填写：支持股票名称或 6 位代码，先解析成代码列表再预览
  const parseManual = async () => {
    if (!form.stocks.trim()) { setError('请填写至少一只股票（名称或 6 位代码）'); return; }
    setManualResolving(true);
    setManualPreview([]);
    setManualMissing([]);
    setError('');
    try {
      const res = await fetch('/api/pools/resolve-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: form.stocks }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '解析失败，请重试');
      setManualPreview(data.result.found || []);
      setManualMissing(data.result.missing || []);
    } catch (e) {
      setError(e.message || '解析失败，请重试');
    } finally {
      setManualResolving(false);
    }
  };

  const removeManualStock = (code) => setManualPreview((prev) => prev.filter((st) => st.code !== code));

  const submitManual = () => {
    const codes = manualPreview.map((st) => st.code);
    if (!codes.length) { setError('请先解析出至少一只股票'); return; }
    const isMaster = importType === 'master';
    if (isMaster && !selectedMasterName()) { setError('请先选择大师'); return; }
    const source = isMaster ? '手动整理' : '手动导入';
    createPool(nextPoolName(isMaster), source, codes);
    setImportOpen(false);
    setForm({ name: '', source: '', stocks: '' });
    setMasterSelect('');
    setManualPreview([]);
    setManualMissing([]);
    setError('');
  };

  const runExtract = async () => {
    const val = extractInput.trim();
    if (!val || extractLoading) return;
    setExtractLoading(true);
    setExtractError('');
    setExtracted([]);
    setExtractEmpty(false);
    const isUrl = /^https?:\/\/\S+$/i.test(val);
    try {
      const res = await fetch('/api/pools/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isUrl ? { url: val } : { text: val }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '提取失败，请重试');
      const stocks = (data.result && data.result.stocks) || [];
      setExtracted(stocks);
      setExtractSource((data.result && data.result.source) || '');
      setExtractEmpty(stocks.length === 0);
    } catch (e) {
      setExtractError(e.message || '提取失败，请重试');
    } finally {
      setExtractLoading(false);
    }
  };

  const removeExtracted = (code) => setExtracted((prev) => prev.filter((st) => st.code !== code));

  const submitExtracted = () => {
    const codes = extracted.map((st) => st.code);
    if (!codes.length) { setError('请先提取出至少一只股票'); return; }
    const isMaster = importType === 'master';
    if (isMaster && !selectedMasterName()) { setError('请先选择大师'); return; }
    const source = extractSource || (isMaster ? '手动整理' : '手动导入');
    createPool(nextPoolName(isMaster), source, codes);
    setImportOpen(false);
    setForm({ name: '', source: '', stocks: '' });
    setMasterSelect('');
    setExtractInput('');
    setExtracted([]);
    setExtractSource('');
    setExtractError('');
    setExtractEmpty(false);
    setError('');
  };

  const runSuggest = async () => {
    const q = suggestQuery.trim();
    if (!q || suggestLoading) return;
    setSuggestLoading(true);
    setSuggestError('');
    setSuggestEmptied(false);
    setSuggestResult(null);
    try {
      const res = await fetch('/api/pools/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
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

  const closeDrawers = () => { setImportOpen(false); setSearchOpen(false); };

  const goImportMaster = () => {
    setSearchOpen(false);
    setImportOpen(true);
    setImportType('master');
    const q = suggestQuery.trim();
    const known = MASTER_OPTIONS.find((m) => m.value === q || (q && m.value.includes(q)));
    if (known) setMasterSelect(known.value);
    setSuggestQuery('');
    setSuggestResult(null);
    setError('');
  };

  const deletePool = (id) => {
    const isPreset = PRESET_POOLS.some((p) => p.id === id);
    if (isPreset) {
      setHiddenPresetIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    } else {
      setUserPools((prev) => prev.filter((p) => p.id !== id));
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
    <div className="sp-workspace">
      <div className="mg-top">
        <div className="mg-title">大师的选股池</div>
      </div>

      <div className="sp-layout">
        {/* 左侧：池子列表 */}
        <div className="sp-side">
          <div className="sp-side-actions">
            <button type="button" className="sp-new" onClick={() => { setImportOpen(true); setSearchOpen(false); setError(''); }}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
              导入股票池
            </button>
            <button type="button" className="sp-new sp-new-ai" onClick={() => { setSearchOpen(true); setImportOpen(false); setError(''); }}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
              搜寻大师股票池
            </button>
          </div>

          {pools.length === 0 && !importOpen && !searchOpen && <div className="sp-empty">还没有池子，导入或搜寻一个</div>}

          {pools.map((p) => (
            <div key={p.id} className={`sp-pool${activeId === p.id ? ' active' : ''}${p.preset ? ' preset' : ''}`} onClick={() => { setActiveId(p.id); setError(''); }}>
              <div className="sp-pool-name">{p.name}</div>
              <div className="sp-pool-meta">{p.symbols.length} 只 · {p.source}</div>
              <button type="button" className="sp-del" onClick={(e) => { e.stopPropagation(); deletePool(p.id); }} title="删除">✕</button>
            </div>
          ))}
        </div>

        {/* 右侧：池子详情 */}
        <div className="sp-main">
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
                          <div className={`sp-stat-val${it.d && it.d.ret != null && it.d.ret >= 0 ? ' up' : ' down'}`}>{fmtPct(it.d ? it.d.ret : null)}</div>
                          <div className="sp-stat-sub">vs 沪深300 {fmtPct(it.d ? it.d.indexRet : null)}</div>
                          <div className="sp-stat-sub">{it.d ? `${it.d.up} 涨 / ${it.d.down} 跌` : ''}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="sp-stats">
                      <div className="sp-stat">
                        <div className="sp-stat-label">区间等权涨幅</div>
                        <div className={`sp-stat-val${stats.intervalRet >= 0 ? ' up' : ' down'}`}>{fmtPct(stats.intervalRet)}</div>
                        <div className="sp-stat-sub">vs 沪深300 {fmtPct(stats.indexRet)}</div>
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
                        // 持仓价：优先用户已保存的成本；否则默认用现价（网上可查到），查不到则留空手动填
                        const effCost = cost != null ? cost : s.price != null ? s.price : null;
                        const pnl = effCost != null && effCost > 0 && s.price != null ? ((s.price - effCost) / effCost) * 100 : null;
                        return (
                          <tr key={s.code || s.name}>
                            <td className="mono">{s.code}</td>
                            <td>{s.name || '—'}</td>
                            <td>{s.price != null ? s.price.toFixed(2) : '—'}</td>
                            <td className={s.changePct >= 0 ? 'up' : 'down'}>{s.changePct != null ? fmtPct(s.changePct) : '—'}</td>
                            <td className={s.ret >= 0 ? 'up' : 'down'}>{s.ret != null ? fmtPct(s.ret) : '—'}</td>
                            <td>{s.totalDays ? `${s.upDays} / ${s.totalDays}（${((s.upDays / s.totalDays) * 100).toFixed(0)}%）` : '—'}</td>
                            <td>
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
                            <td className={pnl != null ? (pnl >= 0 ? 'up' : 'down') : ''}>{pnl != null ? fmtPct(pnl) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
      </div>

      {(importOpen || searchOpen) && <div className="invite-drawer-backdrop" onClick={closeDrawers} />}
      {(importOpen || searchOpen) && (
        <div className="invite-drawer" role="dialog" aria-modal="true" aria-labelledby="poolDrawerTitle" onClick={(e) => e.stopPropagation()}>
          <div className="invite-head invite-drawer-head">
            <h3 className="invite-title" id="poolDrawerTitle">{importOpen ? '导入股票池' : '搜寻大师股票池'}</h3>
            <button type="button" className="modal-close" onClick={closeDrawers} aria-label="关闭">×</button>
          </div>
          <div className="invite-drawer-body">
            {error && <div className="mg-error">⚠ {error}</div>}

            {importOpen && (
              <div className="sp-form sp-form-drawer">
                <div className="sp-form-label">导入类型</div>
                <div className="mg-mode" role="group" aria-label="导入类型">
                  <button type="button" className={importType === 'mine' ? 'active' : ''} onClick={() => setImportType('mine')}>我的股票池</button>
                  <button type="button" className={importType === 'master' ? 'active' : ''} onClick={() => setImportType('master')}>大师的股票池</button>
                </div>
                {importType === 'master' && (
                  <>
                    <div className="sp-form-label">选择大师</div>
                    <select className="mg-input mg-input-line sp-master-select" value={masterSelect} onChange={(e) => setMasterSelect(e.target.value)}>
                      <option value="">请选择大师…</option>
                      {MASTER_OPTIONS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </>
                )}
                <div className="sp-form-label">输入方式</div>
                <div className="mg-mode" role="group" aria-label="输入方式">
                  <button type="button" className={importMode === 'manual' ? 'active' : ''} onClick={() => setImportMode('manual')}>手动填写</button>
                  <button type="button" className={importMode === 'extract' ? 'active' : ''} onClick={() => setImportMode('extract')}>文本或链接提取</button>
                </div>

                {importMode === 'manual' && (
                  <>
                    <textarea className="mg-input" rows={6} placeholder="输入股票名称或 6 位代码，一行一个或用逗号/空格分隔，如：\n齐翔腾达\n300750 600519" value={form.stocks} onChange={(e) => { setForm({ ...form, stocks: e.target.value }); setManualPreview([]); setManualMissing([]); }} />
                    <button type="button" className="mg-btn" onClick={parseManual} disabled={!form.stocks.trim() || manualResolving}>
                      {manualResolving ? '正在解析…' : (manualPreview.length ? '重新解析' : '解析并预览')}
                    </button>
                    {manualMissing.length > 0 && (
                      <div className="sp-manual-missing">⚠ 以下名称未能识别，未纳入：{manualMissing.join('、')}</div>
                    )}
                    {manualPreview.length > 0 && (
                      <div className="sp-extract">
                        <div className="sp-extract-head">已解析 {manualPreview.length} 只，可删除不需要的：</div>
                        <div className="sp-extract-list">
                          {manualPreview.map((st) => (
                            <div key={st.code} className="sp-extract-item">
                              <span className="mono">{st.code}</span>
                              <span className="sp-extract-name">{st.name || '—'}</span>
                              <button type="button" className="sp-extract-del" onClick={() => removeManualStock(st.code)} aria-label="删除">✕</button>
                            </div>
                          ))}
                        </div>
                        <button type="button" className="mg-btn" onClick={submitManual} disabled={!manualPreview.length}>创建股票池</button>
                      </div>
                    )}
                  </>
                )}

                {importMode === 'extract' && (
                  <>
                    <textarea className="mg-input" rows={4} placeholder="粘贴报道全文，或云文档 / 网页链接（https://…）" value={extractInput} onChange={(e) => { setExtractInput(e.target.value); setExtractEmpty(false); }} />
                    <button type="button" className="mg-btn" onClick={runExtract} disabled={!extractInput.trim() || extractLoading}>
                      {extractLoading ? '正在提取…' : '提取股票'}
                    </button>
                    {extractError && <div className="mg-error">⚠ {extractError}</div>}
                    {extracted.length > 0 && (
                      <div className="sp-extract">
                        <div className="sp-extract-head">提取到 {extracted.length} 只标的，可删除不需要的：</div>
                        <div className="sp-extract-list">
                          {extracted.map((st) => (
                            <div key={st.code} className="sp-extract-item">
                              <span className="mono">{st.code}</span>
                              <span className="sp-extract-name">{st.name || '待确认'}</span>
                              <button type="button" className="sp-extract-del" onClick={() => removeExtracted(st.code)} aria-label="删除">✕</button>
                            </div>
                          ))}
                        </div>
                        <button type="button" className="mg-btn" onClick={submitExtracted} disabled={!extracted.length}>提交到选股池</button>
                      </div>
                    )}
                    {extractEmpty && (
                      <div className="sp-suggest-empty">
                        <div className="sp-suggest-empty-title">没有提取到 A 股标的</div>
                        <p className="sp-suggest-empty-desc">可换个链接或文本重试，或切换到「手动填写」直接输入 6 位代码。</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

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
    </div>
    </div>
  );
}
