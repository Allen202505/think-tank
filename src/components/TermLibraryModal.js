'use client';

// 词条库弹窗：可搜索 / 滚动；点某个词条才按需生成讲解（缓存 content），左栏只放入口，方便管理 100+ 词条。
import { useState, useEffect } from 'react';
import { ensureAiReady, consumeFree, getAiConfig } from '../lib/aiGate';
import { useAuth } from '../lib/authProvider';
import { supabaseEnabled } from '../lib/supabaseClient';
import { loadTerms, saveTerms, updateTermContent, notifyTermsChanged, syncTermsOnLogin, pushTermsCloud } from '../lib/navalTerms';

// 内联/块级渲染（复用简单 markdown）
function inlineRich(seg, k) {
  const parts = String(seg || '').split(/\*\*([\s\S]+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={`${k}-${i}`}>{p}</strong> : p));
}

export default function TermLibraryModal({ open, onClose }) {
  const { user } = useAuth();
  const loggedIn = supabaseEnabled && !!user?.id;
  const [terms, setTerms] = useState([]);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(null); // { name, content?, keyPoint? }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 打开时：登录则从云端同步；未登录用本地（并提示注册）
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setActive(null);
    setError('');
    setLoading(false);
    let cancelled = false;
    const apply = (list) => { if (!cancelled) setTerms(list); };
    (async () => {
      if (loggedIn) {
        const merged = await syncTermsOnLogin(user.id);
        apply(merged);
      } else {
        apply(loadTerms());
      }
    })();
    const onTerms = () => setTerms(loadTerms());
    window.addEventListener('thinktank:terms-changed', onTerms);
    return () => { cancelled = true; window.removeEventListener('thinktank:terms-changed', onTerms); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loggedIn, user?.id]);

  const pushCloud = (list) => { if (loggedIn) pushTermsCloud(user.id, list); };

  if (!open) return null;

  const q = String(search || '').trim();
  const filtered = q ? terms.filter((t) => t.name.includes(q)) : terms;

  // 点词条 → 有缓存直接显示，否则按需生成讲解
  const viewTerm = async (t) => {
    setActive({ name: t.name, content: t.content || '', keyPoint: t.keyPoint || '' });
    if (t.content) return;
    if (loading) return;
    if (!ensureAiReady()) { setError('AI 免费体验次数已用完，请先配置 API Key 或稍后再试'); return; }
    consumeFree();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/naval/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: t.name, aiConfig: getAiConfig() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '生成讲解失败，请重试');
      const list = updateTermContent(t.name, { content: data.result.content, keyPoint: data.result.keyPoint || '' });
      setTerms(list);
      notifyTermsChanged();
      pushCloud(list);
      setActive({ name: t.name, content: data.result.content, keyPoint: data.result.keyPoint || '' });
    } catch (e) {
      const em = String((e && e.message) || e);
      setError(/failed to fetch|network|load|timed? ?out|econn|reset/i.test(em) ? '网络异常或连接超时，请重试' : (em || '生成讲解失败，请重试'));
    } finally {
      setLoading(false);
    }
  };

  const deleteTerm = (name) => {
    const next = loadTerms().filter((t) => t.name !== name);
    saveTerms(next);
    notifyTermsChanged();
    setTerms(next);
    pushCloud(next);
    if (active && active.name === name) { setActive(null); setError(''); }
  };

  return (
    <div className="drawer-overlay" onMouseDown={() => !loading && onClose()}>
      <aside className="explain-drawer chat-drawer term-lib-drawer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="chat-drawer-head">
          <div className="chat-drawer-title-wrap">
            <div className="chat-drawer-title">📚 词条库（{terms.length}）</div>
            <div className="chat-drawer-sub">点击词条生成讲解 · 支持搜索</div>
          </div>
          <button type="button" className="nv-clear" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('naval:add-term', { detail: { name: search } })); }}>＋ 添加词条</button>
          <button type="button" className="modal-close drawer-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        {supabaseEnabled && !user && (
          <div className="term-lib-auth">
            <div className="term-lib-auth-text">🔒 登录后词条会云端保存，换设备不丢失</div>
            <button type="button" className="mg-btn term-lib-auth-btn" onClick={() => window.dispatchEvent(new CustomEvent('open-auth'))}>去登录 / 注册</button>
          </div>
        )}
        <div className="term-lib-search-wrap">
          <input
            className="mg-input mg-input-line term-lib-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索已收录词条…"
          />
        </div>
        <div className="explain-drawer-body term-lib-body">
          {filtered.length === 0 ? (
            <div className="term-lib-empty">{q ? '没有匹配的词条' : '还没有词条。右键选中文字，或点上方「＋ 添加词条」收录。'}</div>
          ) : (
            <div className="term-lib-list">
              {filtered.map((t) => (
                <div key={t.name} className={`term-lib-item${active && active.name === t.name ? ' active' : ''}`} onClick={() => viewTerm(t)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') viewTerm(t); }}>
                  <span className="term-lib-item-name">📖 {t.name}</span>
                  <span className="term-lib-item-badge">{t.content ? '✓' : '·'}</span>
                  <button type="button" className="term-lib-del" title="删除词条" onClick={(e) => { e.stopPropagation(); deleteTerm(t.name); }}>🗑</button>
                </div>
              ))}
            </div>
          )}

          {(active || loading) && (
            <div className="term-lib-detail">
              {active && (
                <div className="term-lib-detail-head">
                  <span className="term-lib-detail-name">{active.name}</span>
                  <button type="button" className="nv-clear" onClick={() => { setActive(null); setError(''); }}>收起</button>
                </div>
              )}
              {loading && <div className="mg-loading nv-loading">正在生成讲解…</div>}
              {active && active.content && (
                <div className="term-lib-detail-body">{inlineRich(active.content, 'lib')}</div>
              )}
              {error && <div className="mg-error">{error}</div>}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
