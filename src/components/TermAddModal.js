'use client';

// 全局「词条添加」：网页任意处右键可快捷添加词条；弹窗里只需填词条名，保存到本机词条库（不立即生成讲解）。
// 词条库由「纳瓦尔知识学堂」展示；词条讲解在词条库弹窗里点击时才按需生成。
// 监听 window 'naval:add-term' 事件，供学堂「＋ 添加词条」等入口打开同一弹窗。
import { useState, useEffect, useCallback } from 'react';
import { loadTerms, saveTerms, notifyTermsChanged } from '../lib/navalTerms';

export default function TermAddModal() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');

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

  const saveTerm = (n) => {
    const term = { name: n, at: Date.now() };
    const next = [term, ...loadTerms().filter((t) => t.name !== n)].slice(0, 500);
    saveTerms(next);
    notifyTermsChanged();
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
          <button type="button" className="ctx-item" onClick={() => openModal(selected)}>
            <span className="ctx-icon">📖</span> 添加词条{selected ? `“${selected.slice(0, 12)}${selected.length > 12 ? '…' : ''}”` : ''}
          </button>
          <div className="ctx-hint">添加到「纳瓦尔知识学堂」词条库</div>
        </div>
      )}

      {modalOpen && (
        <div className="modal-overlay" onMouseDown={() => setModalOpen(false)}>
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
    </>
  );
}
