'use client';

// 全局「词条添加」：网页任意处右键可快捷添加词条；弹窗里只需填词条名，保存到本机词条库（不立即生成讲解）。
// 词条库由「纳瓦尔知识学堂」展示；词条讲解在词条库弹窗里点击时才按需生成。
// 监听 window 'naval:add-term' 事件，供学堂「＋ 添加词条」等入口打开同一弹窗。
import { useState, useEffect, useCallback } from 'react';
import { loadTerms, saveTerms, notifyTermsChanged, pushTermsCloud } from '../lib/navalTerms';
import { useAuth } from '../lib/authProvider';
import { supabaseEnabled } from '../lib/supabaseClient';
import { ensureAiReady, consumeFree, getAiConfig } from '../lib/aiGate';
import { NAVAL } from '../lib/navalPrompts';
import AskDrawer from './AskDrawer';

export default function TermAddModal() {
  const { user } = useAuth();
  const loggedIn = supabaseEnabled && !!user?.id;
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [askOpen, setAskOpen] = useState(false);
  const [askContext, setAskContext] = useState('');
  const [askSeed, setAskSeed] = useState('');
  const [askInstance, setAskInstance] = useState(0);

  // 全局右键 → 自定义菜单
  useEffect(() => {
    let ignore = false;
    const onCtx = (e) => {
      if (ignore) return;
      const sel = (window.getSelection && window.getSelection().toString()) || '';
      setSelected(sel.trim());
      setMenuPos({ x: Math.min(e.clientX, Math.max(8, window.innerWidth - 200)), y: Math.min(e.clientY, Math.max(8, window.innerHeight - 70)) });
      setMenuOpen(true);
      e.preventDefault();
    };
    const onDown = (e) => {
      // 点击发生在自定义菜单内部 → 不关闭，避免 click 落在已移除元素上导致 onClick 不触发
      if (e.target && e.target.closest && e.target.closest('.ctx-menu')) return;
      setMenuOpen(false);
    };
    document.addEventListener('contextmenu', onCtx, true);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onDown);
    return () => {
      ignore = true;
      document.removeEventListener('contextmenu', onCtx, true);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', onDown);
    };
  }, []);

  // 接收外部「打开添加词条」请求
  useEffect(() => {
    const onOpen = (e) => {
      const prefill = (e && e.detail && e.detail.name) || '';
      openModal(prefill);
    };
    window.addEventListener('naval:add-term', onOpen);
    return () => window.removeEventListener('naval:add-term', onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openModal = useCallback((initial) => {
    setName(String(initial || '').trim());
    setModalOpen(true);
    setMenuOpen(false);
  }, []);

  const startNavalAsk = useCallback(() => {
    const term = String(selected || '').trim().slice(0, 240);
    if (!term) return;
    setMenuOpen(false);
    setAskContext(`选中的词条：${term}`);
    setAskSeed(`请用小白能听懂的方式解释“${term}”，并给一个通俗例子说明它在判断中怎么用。`);
    setAskInstance((value) => value + 1);
    setAskOpen(true);
  }, [selected]);

  const askNaval = useCallback(async (question, conversation) => {
    if (!ensureAiReady()) throw new Error('AI 免费体验次数已用完，请先配置 API Key');
    consumeFree();
    const context = [
      askContext,
      ...(conversation || []).map((message) => `${message.role === 'user' ? '我问' : NAVAL.name}：${String(message.text || '').slice(0, 200)}`),
    ].filter(Boolean).join('\n');
    const res = await fetch('/api/naval/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: question, context: context || undefined, aiConfig: getAiConfig() }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || '回复失败，请重试');
    return { content: data.result.content, keyPoint: data.result.keyPoint || '' };
  }, [askContext]);

  const saveTerm = (n) => {
    const term = { name: n, at: Date.now() };
    const next = [term, ...loadTerms().filter((t) => t.name !== n)].slice(0, 500);
    saveTerms(next);
    notifyTermsChanged();
    if (loggedIn) pushTermsCloud(user.id, next);
  };

  const doAdd = () => {
    const n = name.trim();
    if (!n) return;
    saveTerm(n);
    setModalOpen(false);
  };

  return (
    <>
      {menuOpen && (
        <div
          className="ctx-menu"
          style={{ left: menuPos.x, top: menuPos.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {selected && (
            <button type="button" className="ctx-item ctx-ask-naval" onClick={startNavalAsk}>
              <span className="ctx-icon">💬</span> 向纳瓦尔提问
            </button>
          )}
          <button type="button" className="ctx-item" onClick={() => openModal(selected)}>
            <span className="ctx-icon">📖</span> 添加词条
          </button>
          <div className="ctx-hint">选中词条可问纳瓦尔，也可以加入词条库</div>
        </div>
      )}

      {modalOpen && (
        <div className="modal-overlay term-add-overlay" onMouseDown={() => setModalOpen(false)}>
          <div className="modal-content term-add-modal" onMouseDown={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setModalOpen(false)} aria-label="关闭">✕</button>
            <div className="term-add-title">📖 添加词条</div>
            <div className="term-add-sub">保存到本机词条库；讲解会在你点开词条时生成。</div>
            <input
              className="mg-input mg-input-line term-add-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doAdd(); }}
              placeholder="词条名，如：安全边际 / 复利 / 市盈率"
              autoFocus
            />
            <div className="mg-foot term-add-foot">
              <button type="button" className="mg-btn" disabled={!name.trim()} onClick={doAdd}>保存词条</button>
            </div>
          </div>
        </div>
      )}

      {askOpen && (
        <AskDrawer
          key={`global-naval-ask-${askInstance}`}
          master={NAVAL}
          context={askContext}
          onClose={() => setAskOpen(false)}
          onAsk={askNaval}
          seedQuestion={askSeed}
        />
      )}
    </>
  );
}
