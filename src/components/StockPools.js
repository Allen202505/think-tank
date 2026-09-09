'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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

// ── 本地持久缓存：收盘/非交易时段"拿过一次"就不再重复请求（刷新/重启也不丢） ──
// 有效期来自服务端 meta.cacheUntilMs（收盘后=下一开盘；盘中≈60s）
const POOL_LS_CACHE = 'thinktank_pool_cache_v2';
function poolCacheGet(key) {
  try {
    const all = JSON.parse(localStorage.getItem(POOL_LS_CACHE) || '{}');
    const it = all[key];
    if (it && it.u && it.u > Date.now()) return it.v;
    if (it) { delete all[key]; localStorage.setItem(POOL_LS_CACHE, JSON.stringify(all)); }
  } catch (e) { /* ignore */ }
  return null;
}
function poolCacheSet(key, untilMs, value) {
  try {
    const all = JSON.parse(localStorage.getItem(POOL_LS_CACHE) || '{}');
    all[key] = { u: untilMs || 0, v: value };
    const keys = Object.keys(all);
    if (keys.length > 600) {
      // 超出上限：先清已过期，再删最早过期的一批
      const now = Date.now();
      keys.filter((k) => all[k].u <= now).forEach((k) => delete all[k]);
      let rest = Object.keys(all);
      if (rest.length > 600) {
        rest.sort((a, b) => (all[a].u || 0) - (all[b].u || 0));
        rest.slice(0, rest.length - 600).forEach((k) => delete all[k]);
      }
    }
    localStorage.setItem(POOL_LS_CACHE, JSON.stringify(all));
  } catch (e) { /* ignore */ }
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

// 机构评级：仅支持 A 股 6 位代码（0/3/6 开头）
function isACode(code) {
  return /^\d{6}$/.test(code || '') && /^(0|3|6)/.test(code);
}
function fmtPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n >= 100) return n.toFixed(0);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
function hasRating(summary) {
  if (!summary) return false;
  if (summary.short || summary.long) return true;
  const r = summary.rating;
  if (r && (r.rating || r.orgNum || r.eps)) return true;
  return false;
}
function fmtRatingSummary(summary) {
  const parts = [];
  if (summary && summary.short) parts.push(`短 ¥${fmtPrice(summary.short.price)}`);
  if (summary && summary.long) parts.push(`长 ¥${fmtPrice(summary.long.price)}`);
  if (summary && summary.rating) {
    const r = summary.rating;
    if (r.orgNum) parts.push(`${r.orgNum}家机构`);
    if (r.rating) parts.push(r.rating);
    if (!r.orgNum && !r.rating && r.eps) parts.push(`EPS ${fmtPrice(r.eps)}`);
  }
  return parts.join(' · ') || '—';
}
function fmtNum2(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}
function curSym(market) {
  return market === 'US' ? '$' : market === 'HK' ? 'HK$' : '¥';
}

// 历史分位 / 近一年分位：可点击 chip（样式同机构评级），点击弹出区间明细
function rangeChipCell(r, type, onOpen) {
  const label = type === 'hist' ? '历史分位' : '近一年分位';
  if (!r) return <span className="sp-rating-loading">…</span>;
  if (r.ok === false) return <span className="sp-rating-na">—</span>;
  const pct = type === 'hist' ? r.histPct : r.yPct;
  if (pct == null || !Number.isFinite(Number(pct))) return <span className="sp-rating-na">—</span>;
  const n = Math.round(Number(pct));
  return (
    <button type="button" className="sp-rating-btn" onClick={onOpen} title={`${label} ${n}%（点击查看区间明细）`}>
      {n}%
    </button>
  );
}

// 区间抽屉内容：历史分位→历史低/高；近一年分位→近一年低/高
function rangeDetailBlock(r, type) {
  const pct = type === 'hist' ? r.histPct : r.yPct;
  const lowKey = type === 'hist' ? 'histLow' : 'yLow';
  const highKey = type === 'hist' ? 'histHigh' : 'yHigh';
  const lowDateKey = type === 'hist' ? 'histLowDate' : 'yLowDate';
  const highDateKey = type === 'hist' ? 'histHighDate' : 'yHighDate';
  const sym = curSym(r.market);
  const pctN = Number(pct);
  return (
    <div className="sp-rating-summary">
      <div className="sp-rating-chip sp-rating-chip--stat">
        <span className="sp-rating-chip-label">{type === 'hist' ? '历史分位' : '近一年分位'}</span>
        <span className="sp-rating-chip-price">{Number.isFinite(pctN) ? `${Math.round(pctN)}%` : '—'}</span>
        <span className="sp-rating-chip-meta">{Number.isFinite(pctN) ? `现价高于 ${Math.round(pctN)}% 交易日收盘价` : ''}</span>
      </div>
      <div className="sp-rating-chip">
        <span className="sp-rating-chip-label">{type === 'hist' ? '历史最低价' : '近一年最低价'}</span>
        <span className="sp-rating-chip-price">{sym}{fmtNum2(r[lowKey])}</span>
        <span className="sp-rating-chip-meta">{r[lowDateKey] ? `日期 ${r[lowDateKey]}` : ''}</span>
      </div>
      <div className="sp-rating-chip">
        <span className="sp-rating-chip-label">{type === 'hist' ? '历史最高价' : '近一年最高价'}</span>
        <span className="sp-rating-chip-price">{sym}{fmtNum2(r[highKey])}</span>
        <span className="sp-rating-chip-meta">{r[highDateKey] ? `日期 ${r[highDateKey]}` : ''}</span>
      </div>
    </div>
  );
}

// 温度档位：0-100 → 滚烫/温热/常温/偏凉/冰冷
function tempMeta(score) {
  if (score == null || !Number.isFinite(score)) return { key: 'na', label: '—', hint: '' };
  if (score >= 80) return { key: 'hot', label: '滚烫', hint: '池水太热，注意别追高' };
  if (score >= 60) return { key: 'warm', label: '温热', hint: '池水温热，趋势尚可' };
  if (score >= 40) return { key: 'normal', label: '常温', hint: '不冷不热，随大盘波动' };
  if (score >= 20) return { key: 'cool', label: '偏凉', hint: '池水偏凉，留意错杀机会' };
  return { key: 'cold', label: '冰冷', hint: '池水冰冷，多看少动等回暖' };
}

// 表格里的紧凑评级：只留结论+机构数（短/长目标价等明细在抽屉里看），避免挤占名称列
function fmtRatingCompact(summary) {
  if (!summary) return '评级';
  const r = summary.rating;
  if (r && (r.rating || r.orgNum)) return [r.rating, r.orgNum ? `${r.orgNum}家` : ''].filter(Boolean).join('·') || '评级';
  if (summary.short) return `目标 ¥${fmtPrice(summary.short.price)}`;
  if (summary.long) return `目标 ¥${fmtPrice(summary.long.price)}`;
  return '评级';
}

// 轻量渲染：AI 输出里的 **加粗** 转成 <strong>
function renderInline(text, keyBase) {
  const normalized = String(text || '').replace(/\*\*\*/g, '**');
  const parts = normalized.split(/\*\*([\s\S]+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={`${keyBase}-${i}`}>{p}</strong> : String(p).replace(/\*\*/g, '')));
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
  { label: '一年', v: 250 },
  { label: '两年', v: 500 },
  { label: '三年', v: 750 },
  { label: '五年', v: 1250 },
];

// 表头列（支持排序）；排序值由组件内 sortValue 按 key 取
const HEADER_COLS = [
  { key: 'code', label: '代码' },
  { key: 'name', label: '名称' },
  { key: 'price', label: '现价' },
  { key: 'ret', label: '区间涨幅' },
  { key: 'histPct', label: '历史分位' },
  { key: 'yPct', label: '近一年分位' },
  { key: 'rating', label: '机构评级' },
  { key: 'upDays', label: '上涨天数' },
  { key: 'cost', label: '持仓价' },
  { key: 'pnl', label: '持仓盈亏' },
];

// 仅「寒武纪的鳄鱼」鱼池展示的四档价位列（放在【区间涨幅】右侧，从 Excel 整理录入）
const LEVEL_COLS = [
  { key: 'lvEntry', label: '入场价格' },
  { key: 'lvHeavy', label: '重仓价格' },
  { key: 'lvTp1', label: '第一次止盈价格' },
  { key: 'lvTp2', label: '第二次止盈价格' },
];
function fmtLevel(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return String(Math.round(Number(v) * 100) / 100);
}

// 大师的选股池：预置大师池可切换 + AI 检索/手动粘贴添加 → 当日涨跌 + 区间统计（等权 vs 沪深300）
export default function StockPools() {
  const { user, loading: authLoading } = useAuth();
  const [userPools, setUserPools] = useState([]);
  const [activeId, setActiveId] = useState(null); // 默认选中列表第一项（hydration 完成后设置）
  const [importOpen, setImportOpen] = useState(false);
  const [importType, setImportType] = useState('mine'); // 传给共享导入弹窗的初始类型（mine | master）
  const [addTarget, setAddTarget] = useState(null);      // 追加股票到已有池子的目标池
  const [detailVersion, setDetailVersion] = useState(0); // 池子内容变化后强制刷新行情
  const [notice, setNotice] = useState('');              // 轻提示（添加/创建成功）
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
  const [flowerOpen, setFlowerOpen] = useState(false);      // 小红花公益弹窗
  const flowerAutoRef = useRef(false);                      // 每天最多自动弹一次
  const [ratings, setRatings] = useState({});   // code -> { ok, summary, items }
  const [ratingDrawer, setRatingDrawer] = useState(null); // { code, name, r }
  const [rangeDrawer, setRangeDrawer] = useState(null); // { code, name, r, type: 'hist' | 'year' }
  const fetchedRatingCodes = useRef(new Set()); // 已请求过的代码（避免重复拉取）
  const [ranges, setRanges] = useState({});        // code -> { histLow, histHigh, yLow, yHigh, ... }（历史/近一年区间）
  const fetchedRangeCodes = useRef(new Set());     // 已请求过区间数据的代码
  const [sort, setSort] = useState({ key: null, dir: 'asc' }); // 表头排序（key 为 null 表示原始顺序）
  // 标记本地数据是否已加载完成：加载完成前禁止写 localStorage，避免用初始空数组覆盖已保存的数据
  const [hydrated, setHydrated] = useState(false);

  const masterPools = PRESET_POOLS.filter((p) => !hiddenPresetIds.includes(p.id)); // 大师的股票池（可隐藏）
  const pools = poolTab === 'mine' ? userPools : masterPools; // 页签：我的股票池 / 大师的股票池
  const active = pools.find((p) => p.id === activeId) || null;
  const isUserPool = !!active && userPools.some((p) => p.id === active.id);

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
    const cKey = `d:${pool.id}:${String(d)}:${[...pool.symbols].sort().join(',')}`;
    const cached = poolCacheGet(cKey);
    if (cached) { setDetail(cached); return; } // 有效期内直接用本地数据，不请求
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
      const until = data && data.meta && data.meta.cacheUntilMs;
      if (until && until > Date.now()) poolCacheSet(cKey, until, data.result);
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
  }, [activeId, days, detailVersion]);

  // 机构评级：池子加载后，为每只 A 股懒加载评级/目标价（点击可看明细）
  const fetchRatings = useCallback(async (code) => {
    const hit = poolCacheGet(`r:${code}`);
    if (hit) { setRatings((prev) => ({ ...prev, [code]: hit })); return; }
    try {
      const res = await fetch(`/api/pools/ratings?code=${code}`);
      const j = await res.json();
      setRatings((prev) => ({ ...prev, [code]: j }));
      const until = j && j.meta && j.meta.cacheUntilMs;
      if (until && until > Date.now()) {
        poolCacheSet(`r:${code}`, until, j);
      } else {
        poolCacheSet(`r:${code}`, Date.now() + 10 * 60 * 1000, j); // 无有效期=失败，短时负缓存
      }
    } catch (e) {
      setRatings((prev) => ({ ...prev, [code]: { ok: false, summary: null, items: [] } }));
      poolCacheSet(`r:${code}`, Date.now() + 10 * 60 * 1000, { ok: false, summary: null, items: [] });
    }
  }, []);

  useEffect(() => {
    if (detail && detail.stocks && detail.stocks.length) {
      detail.stocks.forEach((st) => {
        if (st.code && isACode(st.code) && !fetchedRatingCodes.current.has(st.code)) {
          fetchedRatingCodes.current.add(st.code);
          fetchRatings(st.code);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  // 历史/近一年区间：池子加载后按小批量懒加载（美股/港股/A股都支持），避免一次打爆数据源
  const fetchRange = useCallback(async (code, price) => {
    const rKey = `g:${code}:${price != null && Number.isFinite(Number(price)) ? String(price) : ''}`;
    const hit = poolCacheGet(rKey);
    if (hit) { setRanges((prev) => ({ ...prev, [code]: hit })); return; }
    try {
      const qs = new URLSearchParams({ code });
      if (price != null && Number.isFinite(Number(price))) qs.set('price', String(price));
      const res = await fetch(`/api/pools/range?${qs.toString()}`);
      const j = await res.json();
      const norm = j && j.ok ? { ok: true, ...j.result } : { ok: false };
      setRanges((prev) => ({ ...prev, [code]: norm }));
      const until = j && j.meta && j.meta.cacheUntilMs;
      if (until && until > Date.now()) {
        poolCacheSet(rKey, until, norm);
      } else if (!j || !j.ok) {
        // 失败/不支持：短时负缓存，避免每次进入都重试
        poolCacheSet(rKey, Date.now() + 10 * 60 * 1000, norm);
      }
    } catch (e) {
      setRanges((prev) => ({ ...prev, [code]: { ok: false } }));
      poolCacheSet(rKey, Date.now() + 10 * 60 * 1000, { ok: false });
    }
  }, []);

  useEffect(() => {
    if (detail && detail.stocks && detail.stocks.length) {
      const need = detail.stocks
        .map((st) => st.code)
        .filter((code) => code && !fetchedRangeCodes.current.has(code));
      if (need.length) {
        need.forEach((code) => fetchedRangeCodes.current.add(code));
        const runBatch = async (i) => {
          if (i >= need.length) return;
          await Promise.all(need.slice(i, i + 6).map((code) => {
            const st = detail.stocks.find((x) => x.code === code);
            return fetchRange(code, st && st.price);
          }));
          runBatch(i + 6);
        };
        runBatch(0);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

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

  // 从列表/详情把股票追加到已有池子（我的股票池）
  const openAddPool = (pool) => {
    setAddTarget(pool);
    setImportType('mine');
    setImportOpen(true);
    setSearchOpen(false);
    setReviewOpen(false);
    setError('');
    setNotice('');
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

  // 我的股票池今日红盘 → 小红花公益引导（🌸 仅当日盈利时出现）
  const dayRet =
    poolTab === 'mine' && isUserPool && detail && detail.short && detail.short.today
      ? Number(detail.short.today.ret)
      : null;
  const dayRed = Number.isFinite(dayRet) && dayRet > 0;

  // 当天第一次出现红盘时自动弹出一次温暖引导（每天最多一次）
  useEffect(() => {
    if (!dayRed || flowerAutoRef.current) return;
    flowerAutoRef.current = true;
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem('thinktank_flower_auto') !== today) {
        localStorage.setItem('thinktank_flower_auto', today);
        setFlowerOpen(true);
      }
    } catch (e) { /* ignore */ }
  }, [dayRed]);

  const SHORT_OPTIONS = DAY_OPTIONS.slice(0, 3); // 今天/昨天/本周
  const RANGE_OPTIONS = DAY_OPTIONS.slice(3); // 30天~三年，收进「更多」下拉
  const rangeActive = RANGE_OPTIONS.find((o) => o.v === days);
  const isShort = typeof days !== 'number';

  // 🌡️ 温度计称呼跟随持有人：仅「寒武纪的鳄鱼」叫鱼池；我的持仓→我的持仓温度计；其他大师→「XX的温度计」
  const isCambrian = !!active && active.id === 'pool_cambrian';
  const thermoName = isUserPool ? '我的持仓温度计' : isCambrian ? '鱼池温度计' : (active ? `${active.name}的温度计` : '温度计');
  const dayBase = isCambrian ? '鱼池' : ''; // 周期标签：鱼池池子保留「今日鱼池」，其余只显示「今日/昨日/本周」
  // 鱼池四档价位列仅寒武纪显示：插在【区间涨幅】之后
  const headers = isCambrian
    ? [...HEADER_COLS.slice(0, 4), ...LEVEL_COLS, ...HEADER_COLS.slice(4)]
    : HEADER_COLS;

  // 温度计条目：短周期同时给 今日/昨日/本周；区间模式给当前所选周期
  const tempItems = (() => {
    const items = [];
    if (!detail || !stats || !detail.temperature) return items;
    const t = detail.temperature;
    if (isShort && short) {
      // 只展示当前选中周期的那一支（今天→今日鱼池，昨天→昨日鱼池，本周→本周鱼池）
      const pick = {
        today: { label: `今日${dayBase}`, d: short.today },
        yesterday: { label: `昨日${dayBase}`, d: short.yesterday },
        week: { label: `本周${dayBase}`, d: short.week },
      }[days];
      if (pick && pick.d && t[days] != null) {
        items.push({
          key: days, label: pick.label, score: t[days],
          detail: `${fmtPct(pick.d.ret)} · 上涨 ${pick.d.up ?? 0} / 下跌 ${pick.d.down ?? 0} · vs 上证 ${fmtPct(pick.d.indexRet)}`,
        });
      }
    } else if (t.period != null) {
      const opt = DAY_OPTIONS.find((o) => o.v === days);
      items.push({
        key: 'period',
        label: opt ? `近${opt.label}` : '区间',
        score: t.period,
        detail: `${fmtPct(stats.intervalRet)} · 上涨 ${stats.upInRange} / 下跌 ${stats.downInRange} · 跑赢大盘 ${stats.beatDays}/${stats.cmpDays} 天`,
      });
    }
    return items;
  })();

  // 排序取数：每个表头 key 对应一个取值函数（含异步加载的区间/评级、持仓成本/盈亏）
  const costFor = (s) => {
    const c = costs[active.id] && costs[active.id][s.code];
    const pc = active && active.costs && active.costs[s.code] != null ? active.costs[s.code] : null;
    return c != null ? c : pc;
  };
  const sortValue = (key, s) => {
    switch (key) {
      case 'code': return s.code || '';
      case 'name': return s.name || '';
      case 'price': return s.price;
      case 'ret': return s.ret;
      case 'histPct': { const r = ranges[s.code]; return r && r.histPct != null ? Number(r.histPct) : null; }
      case 'yPct': { const r = ranges[s.code]; return r && r.yPct != null ? Number(r.yPct) : null; }
      case 'rating': {
        const rr = ratings[s.code];
        if (rr && rr.ok && rr.summary) {
          const r = rr.summary.rating;
          if (r && r.orgNum != null) return Number(r.orgNum);
          if (rr.summary.short) return Number(rr.summary.short.price);
          if (r && r.rating) return String(r.rating);
        }
        return null;
      }
      case 'upDays': return Number(s.upDays) || 0;
      case 'cost': { const c = costFor(s); return c != null ? Number(c) : null; }
      case 'pnl': {
        const c = costFor(s);
        return c != null && c > 0 && s.price != null ? ((s.price - c) / c) * 100 : null;
      }
      default: return null;
    }
  };
  const sortedStocks = useMemo(() => {
    const list = detail && detail.stocks ? [...detail.stocks] : [];
    if (!sort.key || !list.length) return list;
    const dir = sort.dir === 'desc' ? -1 : 1;
    list.sort((a, b) => {
      const va = sortValue(sort.key, a);
      const vb = sortValue(sort.key, b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const na = Number(va);
      const nb = Number(vb);
      const aNum = va !== '' && Number.isFinite(na);
      const bNum = vb !== '' && Number.isFinite(nb);
      let c;
      if (aNum && bNum) c = na - nb;
      else c = String(va).localeCompare(String(vb), 'zh-Hans-CN');
      return c * dir;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, sort, ranges, costs, active, ratings]);

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
          {dayRed && (
            <button type="button" className="sp-flower" onClick={() => setFlowerOpen(true)} title="今日盈利，去捐朵小红花吧">
              <span className="sp-flower-ico" aria-hidden="true">🌸</span>
              <span className="sp-flower-txt">今日 {fmtPct(dayRet)} · 捐朵小红花</span>
              <span className="sp-flower-arrow" aria-hidden="true">›</span>
            </button>
          )}
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

          {pools.map((p) => {
            const isUserOwned = userPools.some((up) => up.id === p.id);
            return (
              <div key={p.id} className={`sp-pool${activeId === p.id ? ' active' : ''}${p.preset ? ' preset' : ''}${isUserOwned ? ' can-add' : ''}`} onClick={() => { setActiveId(p.id); setError(''); setReviewOpen(false); }}>
                <div className="sp-pool-name">{p.name}</div>
                <div className="sp-pool-meta">{p.symbols.length} 只 · {p.source}</div>
                <div className="sp-pool-actions">
                  {isUserOwned && (
                    <button type="button" className="sp-pool-add" title={`向「${p.name}」添加股票`} aria-label={`向「${p.name}」添加股票`} onClick={(e) => { e.stopPropagation(); openAddPool(p); }}>
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                    </button>
                  )}
                  <button type="button" className="sp-del" onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelete({ id: p.id, name: p.name, isPreset: PRESET_POOLS.some((x) => x.id === p.id) });
                  }} title="删除">✕</button>
                </div>
              </div>
            );
          })}
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
          {!importOpen && !searchOpen && notice && <div className="mg-notice">✓ {notice}</div>}

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
                  {tempItems.length > 0 && (
                    <div className="sp-thermo-card">
                      <div className="sp-thermo-card-head">
                        <span className="sp-thermo-title">🌡️ {thermoName}</span>
                        <span className="sp-thermo-sub">0–100 综合分：收益跑赢大盘 + 赚钱效应 + 跑赢天数</span>
                      </div>
                      <div className="sp-thermos">
                        {tempItems.map((it) => {
                          const meta = tempMeta(it.score);
                          return (
                            <div key={it.key} className={`sp-thermo ${meta.key}`} title={meta.hint}>
                              <div className="sp-thermo-top">
                                <div className="sp-thermo-name">
                                  <span className="sp-thermo-label">{it.label}</span>
                                  <span className="sp-thermo-level">{meta.label}</span>
                                </div>
                                <div className="sp-thermo-score">{Math.round(it.score)}<span className="sp-thermo-deg">°</span></div>
                              </div>
                              <div className="sp-thermo-track">
                                <div className="sp-thermo-fill" style={{ width: `${Math.max(2, Math.min(100, it.score))}%` }} />
                              </div>
                              <div className="sp-thermo-detail">{it.detail}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
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

                  <div className="sp-table-scroll">
                  <table className="sp-table">
                    <thead>
                      <tr>
                        {headers.map((c) => (
                          <th key={c.key}>
                            <span className="sp-th-label">{c.label}</span>
                            {!String(c.key).startsWith('lv') && (
                            <span className="sp-sort">
                              <button
                                type="button"
                                className={`sp-sort-btn${sort.key === c.key && sort.dir === 'asc' ? ' active' : ''}`}
                                onClick={() => setSort(sort.key === c.key && sort.dir === 'asc' ? { key: null, dir: 'asc' } : { key: c.key, dir: 'asc' })}
                                aria-label={`${c.label}升序`}
                              >▲</button>
                              <button
                                type="button"
                                className={`sp-sort-btn${sort.key === c.key && sort.dir === 'desc' ? ' active' : ''}`}
                                onClick={() => setSort(sort.key === c.key && sort.dir === 'desc' ? { key: null, dir: 'asc' } : { key: c.key, dir: 'desc' })}
                                aria-label={`${c.label}降序`}
                              >▼</button>
                            </span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedStocks.map((s) => {
                        const cost = costs[active.id] && costs[active.id][s.code];
                        // 持仓价：优先用户已保存的成本；其次预置池已知的持仓价（如巴菲特公开报道的估算成本）；查不到则留空手动填
                        const poolCost = active.costs && active.costs[s.code] != null ? active.costs[s.code] : null;
                        const effCost = cost != null ? cost : poolCost;
                        const pnl = effCost != null && effCost > 0 && s.price != null ? ((s.price - effCost) / effCost) * 100 : null;
                        return (
                          <tr key={s.code || s.name}>
                            <td className="mono" data-label="代码">{s.code}</td>
                            <td data-label="名称"><span className="sp-name">{s.name || '—'}</span></td>
                            <td data-label="现价">{s.price != null ? s.price.toFixed(2) : '—'}</td>
                            <td data-label="区间涨幅" className={s.ret >= 0 ? 'up' : 'down'}>{s.ret != null ? fmtPct(s.ret) : '—'}</td>
                            {isCambrian && (() => {
                              const lv = (active.levels && active.levels[s.code]) || {};
                              return (
                                <>
                                  <td className="mono" data-label="入场价格">{fmtLevel(lv.entry)}</td>
                                  <td className="mono" data-label="重仓价格">{fmtLevel(lv.heavy)}</td>
                                  <td className="mono" data-label="第一次止盈价格">{fmtLevel(lv.tp1)}</td>
                                  <td className="mono" data-label="第二次止盈价格">{fmtLevel(lv.tp2)}</td>
                                </>
                              );
                            })()}
                            <td data-label="历史分位">{rangeChipCell(ranges[s.code], 'hist', () => setRangeDrawer({ code: s.code, name: s.name, r: ranges[s.code], type: 'hist' }))}</td>
                            <td data-label="近一年分位">{rangeChipCell(ranges[s.code], 'year', () => setRangeDrawer({ code: s.code, name: s.name, r: ranges[s.code], type: 'year' }))}</td>
                            <td data-label="机构评级">
  {s.code && isACode(s.code) ? (
    ratings[s.code] === undefined ? (
      <span className="sp-rating-loading">…</span>
    ) : ratings[s.code] && ratings[s.code].ok && ratings[s.code].summary && hasRating(ratings[s.code].summary) ? (
      <button
        type="button"
        className="sp-rating-btn"
        onClick={() => setRatingDrawer({ code: s.code, name: s.name, r: ratings[s.code] })}
        title={`${fmtRatingSummary(ratings[s.code].summary)}（点击查看明细）`}
      >
        {fmtRatingCompact(ratings[s.code].summary)}
      </button>
    ) : (
      <span className="sp-rating-na">—</span>
    )
  ) : (
    <span className="sp-rating-na">—</span>
  )}
</td>
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
                  </div>
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
      {rangeDrawer && (
        <>
          <div className="invite-drawer-backdrop" onClick={() => setRangeDrawer(null)} />
          <div
            className="invite-drawer sp-rating-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rangeDrawerTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="invite-head invite-drawer-head">
              <h3 className="invite-title" id="rangeDrawerTitle">{rangeDrawer.type === 'hist' ? '历史分位' : '近一年分位'} · {rangeDrawer.name}（{rangeDrawer.code}）</h3>
              <button type="button" className="modal-close" onClick={() => setRangeDrawer(null)} aria-label="关闭">×</button>
            </div>
            <div className="invite-drawer-body">
              {rangeDrawer.r && rangeDrawer.r.ok !== false ? (
                rangeDetailBlock(rangeDrawer.r, rangeDrawer.type)
              ) : (
                <p className="sp-rating-empty">该股暂无历史区间数据。</p>
              )}
            </div>
          </div>
        </>
      )}
      {flowerOpen && (
        <div className="modal-overlay" onMouseDown={() => setFlowerOpen(false)}>
          <div className="modal-content sp-del-modal" onMouseDown={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setFlowerOpen(false)} aria-label="关闭">✕</button>
            <div className="sp-del-modal-title">今日红利，兑换一朵小红花 🌸</div>
            <div className="sp-del-modal-text">
              <p>持仓飘红，是市场给你的小小回响。</p>
              <p>我们相信，好运是一种会流动的能量——分一点给需要的人，快乐便有了双倍的重量。</p>
              <p>一朵小红花、一顿简餐、一份暖冬包裹……心意没有大小，只有到达。</p>
              <p className="sp-flower-italic">公益纯属自愿，请依心意和能力而行。您的善意，已比涨幅更动人。</p>
            </div>
            <div className="mg-foot sp-del-modal-foot">
              <button type="button" className="mg-btn sp-del-cancel" onClick={() => setFlowerOpen(false)}>再想想</button>
              <a className="mg-btn sp-flower-go" href="https://gongyi.qq.com/" target="_blank" rel="noopener noreferrer" onClick={() => setFlowerOpen(false)}>去腾讯公益 →</a>
            </div>
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
      {ratingDrawer && (
        <>
          <div className="invite-drawer-backdrop" onClick={() => setRatingDrawer(null)} />
          <div
            className="invite-drawer sp-rating-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ratingDrawerTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="invite-head invite-drawer-head">
              <h3 className="invite-title" id="ratingDrawerTitle">机构评级 · {ratingDrawer.name}（{ratingDrawer.code}）</h3>
              <button type="button" className="modal-close" onClick={() => setRatingDrawer(null)} aria-label="关闭">×</button>
            </div>
            <div className="invite-drawer-body">
              {ratingDrawer.r && ratingDrawer.r.summary && hasRating(ratingDrawer.r.summary) && (
                <div className="sp-rating-summary">
                  {ratingDrawer.r.summary.short && (
                    <div className="sp-rating-chip">
                      <span className="sp-rating-chip-label">短期</span>
                      <span className="sp-rating-chip-price">¥{fmtPrice(ratingDrawer.r.summary.short.price)}</span>
                      <span className="sp-rating-chip-meta">{ratingDrawer.r.summary.short.org} · {ratingDrawer.r.summary.short.date}</span>
                    </div>
                  )}
                  {ratingDrawer.r.summary.long && (
                    <div className="sp-rating-chip">
                      <span className="sp-rating-chip-label">长期</span>
                      <span className="sp-rating-chip-price">¥{fmtPrice(ratingDrawer.r.summary.long.price)}</span>
                      <span className="sp-rating-chip-meta">{ratingDrawer.r.summary.long.org} · {ratingDrawer.r.summary.long.date}</span>
                    </div>
                  )}
                  {ratingDrawer.r.summary.rating && (
                    <div className="sp-rating-chip sp-rating-chip--stat">
                      <span className="sp-rating-chip-label">机构评级</span>
                      <span className="sp-rating-chip-price">
                        {ratingDrawer.r.summary.rating.orgNum ? `${ratingDrawer.r.summary.rating.orgNum}家` : '—'}
                        {ratingDrawer.r.summary.rating.rating ? ` ${ratingDrawer.r.summary.rating.rating}` : ''}
                      </span>
                      <span className="sp-rating-chip-meta">
                        {ratingDrawer.r.summary.rating.eps != null ? `一致预期EPS ${fmtPrice(ratingDrawer.r.summary.rating.eps)}` : ''}
                        {ratingDrawer.r.summary.rating.buyNum != null ? ` · 买入${ratingDrawer.r.summary.rating.buyNum}增持${ratingDrawer.r.summary.rating.addNum || 0}` : ''}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {ratingDrawer.r && ratingDrawer.r.items && ratingDrawer.r.items.length > 0 ? (
                <div className="sp-rating-list">
                  {ratingDrawer.r.items.map((it, i) => (
                    <div key={i} className="sp-rating-item">
                      <div className="sp-rating-item-head">
                        <span className="sp-rating-org">{it.org}</span>
                        {it.rating && <span className="sp-rating-badge">{it.rating}</span>}
                        <span className="sp-rating-date">{it.date}</span>
                      </div>
                      {it.title && <div className="sp-rating-title">{it.title}</div>}
                      <div className="sp-rating-prices">
                        {it.short != null && <span>短期 <b>¥{fmtPrice(it.short)}</b></span>}
                        {it.long != null && <span>长期 <b>¥{fmtPrice(it.long)}</b></span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="sp-rating-empty">
                {ratingDrawer.r && ratingDrawer.r.summary && ratingDrawer.r.summary.rating
                  ? '该股有机构评级覆盖，但近期研报未给出具体目标价。'
                  : '该股近期无机构研报覆盖。'}
              </div>
              )}
              <div className="sp-rating-note">数据源：东方财富（研报中心 + F10 盈利预测）· 评级与目标价为机构观点，仅供学习参考，不构成投资建议</div>
            </div>
          </div>
        </>
      )}
      <StockPoolImportModal
        open={importOpen}
        initialType={importType}
        target={addTarget}
        onClose={() => { setImportOpen(false); setAddTarget(null); }}
        onCreated={(pool, info) => {
          setUserPools(loadUserPools());
          setActiveId(pool.id);
          setAddTarget(null);
          setDetailVersion((v) => v + 1);
          if (info && info.mode === 'add') {
            const n = info.added || 0;
            setNotice(n > 0 ? `已向「${pool.name}」添加 ${n} 只股票` : `「${pool.name}」已包含这些股票，无需重复添加`);
          } else {
            const n = info && info.added ? info.added : (pool.symbols ? pool.symbols.length : 0);
            setNotice(`已创建「${pool.name}」，共 ${n} 只股票`);
          }
          setError('');
          setReviewOpen(false);
        }}
      />
    </div>
    </div>
  );
}
