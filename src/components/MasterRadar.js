'use client';

// 跟踪大师动态：左侧纵向大师列表 + 右侧按时间倒序的真实发言时间线
// - 不跨大师合并：每个大师各自一条时间线（可含雪球/知乎等多个自己的平台源）
// - 支持用户粘贴「大师昵称 + 原始网站链接」新增跟踪对象（本地保存）
// - 抓不到原文时降级为「仅链接」，跳转原平台/原页面
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RADAR_ACCOUNTS, findRadarAccount, DEFAULT_RADAR_ACCOUNT_ID, PLATFORM_LABEL } from '../data/radarAccounts';
import { PRESET_MASTERS } from '../data/masters';
import { MasterAvatar } from './ui';
import ModuleHero from './ModuleHero';

const SEL_KEY = 'thinktank_radar_master';
const CUSTOM_KEY = 'thinktank_radar_custom';

function loadSel() {
  try { return localStorage.getItem(SEL_KEY) || DEFAULT_RADAR_ACCOUNT_ID; } catch (e) { return DEFAULT_RADAR_ACCOUNT_ID; }
}
function saveSel(v) {
  try { localStorage.setItem(SEL_KEY, v); } catch (e) { /* ignore */ }
}
function loadCustom() {
  try {
    const arr = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter((x) => x && x.id && x.url) : [];
  } catch (e) { return []; }
}
function saveCustom(list) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}

const pad = (n) => String(n).padStart(2, '0');
function fmtFull(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - Number(ts);
  if (diff < 60 * 1000) return '刚刚';
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d === 1) return '昨天';
  if (d < 7) return `${d} 天前`;
  return fmtFull(ts).slice(0, 10);
}

function toMaster(acc) {
  const found = acc.masterId ? PRESET_MASTERS.find((m) => m.id === acc.masterId) : null;
  if (found) return found;
  return { name: acc.name, color: acc.color, avatar: acc.avatar || null, status: 'alive' };
}
function toCustomMaster(c) {
  return { name: c.name, color: '#5a6b7a', avatar: null, status: 'alive' };
}

const EXPAND_LIMIT = 240;

// 把一条内容源的结果展平成帖子（带来源标识）
function flattenSourcePosts(sourceRes, extra) {
  return (sourceRes.posts || []).map((p) => ({
    ...p,
    srcPlatform: sourceRes.platform,
    srcLabel: sourceRes.label || PLATFORM_LABEL[sourceRes.platform] || sourceRes.platform,
    srcNick: sourceRes.nick || extra.nick || '',
    srcProfileUrl: sourceRes.profileUrl || extra.profileUrl || '',
  }));
}

export default function MasterRadar({ active = false }) {
  const [sel, setSel] = useState('__init__'); // 初始化后改为 localStorage / 默认
  const [custom, setCustom] = useState([]);
  const [builtinData, setBuiltinData] = useState({}); // accountId -> { sources }
  const [customData, setCustomData] = useState({});   // customId -> source result
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [expanded, setExpanded] = useState({});
  const loadedOnce = useRef(false);

  useEffect(() => {
    const s = loadSel();
    const validBuiltin = RADAR_ACCOUNTS.some((a) => a.id === s);
    if (!validBuiltin && !custom.some((c) => c.id === s)) setSel(DEFAULT_RADAR_ACCOUNT_ID);
    else setSel(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (sel && sel !== '__init__') saveSel(sel); }, [sel]);
  useEffect(() => { setCustom(loadCustom()); }, []);

  const fetchOneCustom = useCallback(async (c, force) => {
    try {
      const q = new URLSearchParams({ url: c.url, ...(force ? { refresh: '1' } : {}) });
      const res = await fetch(`/api/radar/source?${q.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setCustomData((d) => ({ ...d, [c.id]: j }));
    } catch (e) {
      setCustomData((d) => ({ ...d, [c.id]: { ok: true, fetchOk: false, linkOnly: true, error: String(e && e.message ? e.message : e), source: { label: '网页' }, posts: [] } }));
    }
  }, []);

  const loadAll = useCallback(async (force = false) => {
    setBusy(true);
    try {
      const ids = RADAR_ACCOUNTS.map((a) => a.id).join(',');
      const q = new URLSearchParams({ master: ids, ...(force ? { refresh: '1' } : {}) });
      const res = await fetch(`/api/radar/feed?${q.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const m = {};
      (j.accounts || []).forEach((acc) => { m[acc.accountId] = acc; });
      setBuiltinData(m);
      const customs = loadCustom();
      setCustom(customs);
      await Promise.all(customs.map((c) => fetchOneCustom(c, force)));
    } catch (e) {
      setBuiltinData((d) => ({ ...d, __error: String(e && e.message ? e.message : e) }));
    } finally {
      setBusy(false);
    }
  }, [fetchOneCustom]);

  // 只在用户首次切到本模块时自动拉一次
  useEffect(() => {
    if (active && !loadedOnce.current) {
      loadedOnce.current = true;
      loadAll(false);
    }
  }, [active, loadAll]);

  const selectedBuiltin = useMemo(() => (sel && sel !== '__init__' ? findRadarAccount(sel) : null), [sel]);
  const selectedCustom = useMemo(() => custom.find((c) => c.id === sel) || null, [custom, sel]);

  // 选中对象的时间线（该大师自己的多个平台源合并，不跨大师）
  const timeline = useMemo(() => {
    if (selectedBuiltin) {
      const acc = builtinData[selectedBuiltin.id];
      if (!acc) return [];
      return acc.sources
        .flatMap((s) => flattenSourcePosts(s, selectedBuiltin.sources[0] || {}))
        .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
    }
    if (selectedCustom) {
      const d = customData[selectedCustom.id];
      if (!d || !d.posts) return [];
      return (d.posts || [])
        .map((p) => ({ ...p, srcPlatform: d.source?.platform || 'custom', srcLabel: d.source?.label || '网页', srcNick: selectedCustom.name, srcProfileUrl: d.source?.profileUrl || selectedCustom.url }))
        .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
    }
    return [];
  }, [selectedBuiltin, selectedCustom, builtinData, customData]);

  const failedSources = useMemo(() => {
    if (selectedBuiltin) {
      const acc = builtinData[selectedBuiltin.id];
      if (!acc) return [];
      return acc.sources.filter((s) => !s.ok || s.count === 0).map((s) => ({ ...s, profileUrl: s.profileUrl || selectedBuiltin.sources[0]?.profileUrl || '' }));
    }
    if (selectedCustom) {
      const d = customData[selectedCustom.id];
      if (d && d.fetchOk === false) {
        return [{ label: d.source?.label || '网页', profileUrl: d.source?.profileUrl || selectedCustom.url, error: d.error, linkOnly: d.linkOnly }];
      }
    }
    return [];
  }, [selectedBuiltin, selectedCustom, builtinData, customData, custom]);

  const dataReady = selectedBuiltin
    ? !!builtinData[selectedBuiltin.id]
    : selectedCustom
      ? !!customData[selectedCustom.id]
      : false;
  const isEmpty = dataReady && timeline.length === 0 && failedSources.length === 0;

  const toggleExpand = (id) => setExpanded((s) => ({ ...s, [id]: !s[id] }));

  const openAdd = () => setModalOpen(true);
  const closeAdd = () => setModalOpen(false);

  const removeCustom = (id) => {
    if (!window.confirm('删除这个跟踪来源？')) return;
    const next = custom.filter((c) => c.id !== id);
    setCustom(next);
    saveCustom(next);
    setCustomData((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });
    if (sel === id) setSel(DEFAULT_RADAR_ACCOUNT_ID);
  };

  const countOf = (acc) => {
    const d = builtinData[acc.id];
    if (!d) return '…';
    return d.sources.reduce((n, s) => n + (s.count || 0), 0);
  };

  const busyText = busy ? '同步中…' : '立即刷新';
  const headerAccount = selectedBuiltin || selectedCustom;

  return (
    <div className="rd-workspace">
      <ModuleHero
        iconId="radar"
        kicker="MASTER TRACKER · LIVE SIGNALS"
        title="跟踪大师动态"
        description="跟踪大师在雪球、知乎的真实最新发言；抓不到原文时直接给出原始链接，也可以粘贴主页链接添加自己的跟踪来源。"
        actions={(
          <button
            type="button"
            className="rd-refresh"
            onClick={() => loadAll(true)}
            disabled={busy}
            title="强制重新抓取（绕过缓存）"
          >
            <span className={`rd-refresh-ico${busy ? ' spin' : ''}`} aria-hidden="true">⟳</span>
            {busyText}
          </button>
        )}
      />

      <div className="rd-layout">
        {/* ── 左侧：大师列表（纵向导航，按大师切换，不提供跨大师合并流） ── */}
        <div className="rd-side">
          <div className="rd-side-head">内置跟踪</div>
          {RADAR_ACCOUNTS.map((acc, i) => {
            const src = acc.sources[0] || {};
            const label = src.nick ? `${PLATFORM_LABEL[src.platform] || src.platform} @${src.nick}` : acc.role;
            return (
              <button
                key={acc.id}
                type="button"
                className={`rd-master${sel === acc.id ? ' active' : ''}`}
                onClick={() => setSel(acc.id)}
              >
                <MasterAvatar master={toMaster(acc)} size={34} />
                <span className="rd-master-info">
                  <span className="rd-master-name">{acc.name}</span>
                  <span className="rd-master-meta">{label}</span>
                </span>
                <span className="rd-count">{countOf(acc)}</span>
              </button>
            );
          })}

          {custom.length > 0 && (
            <>
              <div className="rd-side-head rd-side-head-mt">我添加的</div>
              {custom.map((c) => {
                const d = customData[c.id];
                const ok = !d || d.fetchOk !== false;
                const label = d && d.source && d.source.label ? d.source.label : '自定义链接';
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`rd-master rd-master-custom${sel === c.id ? ' active' : ''}`}
                    onClick={() => setSel(c.id)}
                  >
                    <MasterAvatar master={toCustomMaster(c)} size={34} />
                    <span className="rd-master-info">
                      <span className="rd-master-name">{c.name}</span>
                      <span className="rd-master-meta">{label}</span>
                    </span>
                    <span className={`rd-count${ok ? '' : ' rd-count-bad'}`}>
                      {d && Array.isArray(d.posts) ? d.posts.length : (ok ? '…' : '!')}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      className="rd-del"
                      title="删除"
                      aria-label={`删除 ${c.name}`}
                      onClick={(e) => { e.stopPropagation(); removeCustom(c.id); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); removeCustom(c.id); } }}
                    >✕</span>
                  </button>
                );
              })}
            </>
          )}

          <button type="button" className="rd-add" onClick={openAdd}>
            <span aria-hidden="true">＋</span> 添加跟踪来源
          </button>
          <div className="rd-side-foot">支持雪球 / 知乎主页链接；其他网站尽量发现 RSS</div>
        </div>

        {/* ── 右侧：该大师的时间线内容区 ── */}
        <div className="rd-main">
          {!headerAccount && (
            <div className="rd-status">
              <div className="rd-status-title">正在进入跟踪大师动态…</div>
            </div>
          )}

          {selectedCustom && !customData[selectedCustom.id] && !busy && (
            <div className="rd-status">
              <div className="rd-status-title">正在尝试抓取 {selectedCustom.name} 的来源</div>
              <div className="rd-status-sub">点「立即刷新」重试</div>
            </div>
          )}

          {/* 部分源失败但有内容：用小提示条补充 */}
          {headerAccount && failedSources.length > 0 && timeline.length > 0 && (
            <div className="rd-note">
              {failedSources.map((s, i) => (
                <div key={i} className="rd-note-row">
                  <span>
                    ⚠️ {selectedCustom ? '' : `${selectedBuiltin.name} · `}{s.label || '该来源'} 暂无法自动抓取
                    {s.error ? `（${s.error}）` : ''}
                    {s.linkOnly ? '，先提供原始链接' : ''}
                  </span>
                  {s.profileUrl && (
                    <a href={s.profileUrl} target="_blank" rel="noopener noreferrer" className="rd-go">前往查看 ↗</a>
                  )}
                </div>
              ))}
            </div>
          )}

          {busy && timeline.length === 0 && (
            <div className="rd-status">
              <div className="rd-status-title">正在同步 {headerAccount?.name || ''} 的最新动态…</div>
              <div className="rd-status-sub">从雪球 / 知乎拉取（走 RSSHub 通道）</div>
            </div>
          )}

          {/* 全部源都抓不到 → 「仅提供原始链接」卡片 */}
          {!busy && dataReady && headerAccount && timeline.length === 0 && failedSources.length > 0 && (
            <div className="rd-linkcard">
              <div className="rd-linkcard-head">
                {headerAccount && (selectedBuiltin ? <MasterAvatar master={toMaster(selectedBuiltin)} size={42} /> : <MasterAvatar master={toCustomMaster(selectedCustom)} size={42} />)}
                <div className="rd-linkcard-info">
                  <div className="rd-linkcard-name">{headerAccount.name}</div>
                  <div className="rd-linkcard-meta">
                    {failedSources.map((f) => f.label || '该来源').join(' / ')} · 暂仅提供原始链接
                  </div>
                </div>
              </div>
              <p className="rd-linkcard-text">
                {failedSources[0] && (failedSources[0].label === '知乎' || (failedSources[0].profileUrl || '').includes('zhihu.com'))
                  ? '知乎平台风控较严，目前暂无法自动抓取 TA 的最新回答 / 文章 / 想法。我们把原始主页链接给你：点下方按钮即可前往知乎查看 TA 的最新发言。原文版权归原作者，本站只做摘要与链接跳转，不转载全文。'
                  : '该来源目前暂无法自动抓取正文，以下提供原始链接：点下方按钮前往查看 TA 的最新动态。原文版权归原作者，本站只做摘要与链接跳转，不转载全文。'}
              </p>
              {failedSources.map((f, i) => f.profileUrl && (
                <a key={i} className="rd-linkcard-go" href={f.profileUrl} target="_blank" rel="noopener noreferrer">
                  前往{f.label ? ` ${f.label} ` : ''}主页查看最新发言 ↗
                </a>
              ))}
              <div className="rd-linkcard-hint">
                小提示：如果这位大师在雪球 / 微博等其他平台也发言，可在左侧「＋ 添加跟踪来源」再挂一个源，能抓到的内容会自动聚合到这里。
              </div>
            </div>
          )}

          {!busy && isEmpty && headerAccount && (
            <div className="rd-status">
              <div className="rd-status-title">这位大师最近没有可展示的新发言</div>
              <div className="rd-status-sub">稍后点「立即刷新」再试试</div>
            </div>
          )}

          <div className="rd-feed">
            {timeline.map((p) => {
              const accMaster = headerAccount ? (selectedBuiltin ? toMaster(selectedBuiltin) : toCustomMaster(selectedCustom)) : null;
              const isLong = p.text.length > EXPAND_LIMIT;
              const uid = `${sel}:${p.url}`;
              const isOpen = !!expanded[uid];
              return (
                <article key={uid} className="rd-card">
                  <header className="rd-card-head">
                    {accMaster && <MasterAvatar master={accMaster} size={34} />}
                    <div className="rd-card-who">
                      <div className="rd-card-name">
                        {headerAccount?.name}
                        <span className="rd-card-nick">{p.srcNick ? `${p.srcLabel} @${p.srcNick}` : p.srcLabel}</span>
                      </div>
                      <div className="rd-card-time">{p.srcLabel} · {timeAgo(p.publishedAt)}</div>
                    </div>
                    <a className="rd-ext" href={p.url} target="_blank" rel="noopener noreferrer" title="打开原文" aria-label="打开原文">↗</a>
                  </header>

                  <p className={`rd-text${isLong && !isOpen ? ' clamp' : ''}`}>{p.text}</p>
                  {isLong && (
                    <button type="button" className="rd-more" onClick={() => toggleExpand(uid)}>
                      {isOpen ? '收起' : '展开全文'}
                    </button>
                  )}

                  {p.images && p.images.length > 0 && (
                    <div className="rd-imgs">
                      {p.images.map((src, i) => (
                        <img key={`${p.url}-${i}`} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />
                      ))}
                    </div>
                  )}

                  <footer className="rd-card-foot">
                    <a className="rd-link" href={p.url} target="_blank" rel="noopener noreferrer">查看原文 ↗</a>
                    <span className="rd-full-time">{fmtFull(p.publishedAt)}</span>
                  </footer>
                </article>
              );
            })}
          </div>
        </div>
      </div>

      {modalOpen && (
        <AddSourceModal
          onClose={closeAdd}
          onAdd={(name, url) => {
            const id = `c${Date.now()}`;
            const next = [...custom, { id, name, url }];
            setCustom(next);
            saveCustom(next);
            setSel(id);
            closeAdd();
            fetchOneCustom({ id, name, url }, false);
          }}
        />
      )}
    </div>
  );
}

function AddSourceModal({ onClose, onAdd }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');

  const submit = (e) => {
    e.preventDefault();
    const n = name.trim();
    const u = url.trim();
    if (!n) { setErr('请填写大师昵称'); return; }
    if (!/^https?:\/\/.+/i.test(u) && !/^[a-zA-Z0-9.-]+\.[a-z]{2,}/i.test(u)) { setErr('请粘贴原始链接，如 https://xueqiu.com/u/xxx 或 https://www.zhihu.com/people/xxx'); return; }
    onAdd(n, u);
  };

  return (
    <>
      <div className="rd-backdrop" onClick={onClose} />
      <div className="rd-modal" role="dialog" aria-modal="true" aria-label="添加跟踪来源" onClick={(e) => e.stopPropagation()}>
        <div className="rd-modal-title">添加跟踪来源</div>
        <form onSubmit={submit}>
          <label className="rd-field">
            <span className="rd-field-label">大师昵称</span>
            <input className="rd-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：伍治坚 / 段永平" autoFocus />
          </label>
          <label className="rd-field">
            <span className="rd-field-label">原始链接</span>
            <input className="rd-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…（雪球/知乎个人主页或任意网站）" />
          </label>
          {err && <div className="rd-form-err">{err}</div>}
          <p className="rd-form-hint">
            支持雪球 xueqiu.com/u/… 、知乎 zhihu.com/people/… 主页；其他网站会尝试自动发现 RSS 订阅；都没有则先给原始链接。
          </p>
          <div className="rd-modal-foot">
            <button type="button" className="rd-btn rd-btn-ghost" onClick={onClose}>取消</button>
            <button type="submit" className="rd-btn">添加并跟踪</button>
          </div>
        </form>
      </div>
    </>
  );
}
