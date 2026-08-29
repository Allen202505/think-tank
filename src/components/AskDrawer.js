'use client';

// 大师PK 同款「举手提问」侧边浮层，复用 .explain-drawer/.chat-drawer 样式
// onAsk(question, conversation) => Promise<{content, keyPoint?}>，由各页实现具体 API 调用
// 会话按「大师+上下文」持久化在模块级 Map，关闭浮层再打开时能恢复之前的提问与回答。
import { useEffect, useRef, useState } from 'react';
import { MasterAvatar } from './ui';

// 跨开合持久化会话
const convStore = new Map();
function hashStr(s) {
  let h = 5381; const t = String(s || '');
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function convKey(master, context) {
  return `${master?.id || 'guest'}::${hashStr(String(context || '').slice(0, 300))}`;
}

function renderRich(text) {
  const normalized = String(text || '').replace(/\*\*\*/g, '**');
  const parts = normalized.split(/\*\*([\s\S]+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : p));
}

export default function AskDrawer({ master, context, onClose, onAsk, placeholder }) {
  const key = convKey(master, context);
  const [messages, setMessagesState] = useState(() => convStore.get(key) || []);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(null); // {text}
  const [idx, setIdx] = useState(0);
  const bodyRef = useRef(null);
  const keyRef = useRef(key);

  // 更新会话并同步到持久化 Map
  const setMessages = (updater) => setMessagesState((prev) => {
    const next = typeof updater === 'function' ? updater(prev) : updater;
    convStore.set(key, next);
    return next;
  });

  // 切换目标（换大师/换上下文）时加载对应会话；关闭再开同一目标则恢复
  useEffect(() => {
    if (key !== keyRef.current) {
      keyRef.current = key;
      setMessagesState(convStore.get(key) || []);
      setInput(''); setPending(null); setIdx(0); setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, pending, idx]);

  // 打字机效果
  useEffect(() => {
    if (!pending) return;
    const full = pending.text || '';
    if (idx < full.length) {
      const iv = setInterval(() => setIdx((i) => Math.min(i + 1, full.length)), 16);
      return () => clearInterval(iv);
    }
    setMessages((prev) => [...prev, { role: 'master', text: full }]);
    setPending(null);
    setIdx(0);
  }, [pending, idx]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || loading || !onAsk) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: msg }]);
    setLoading(true);
    try {
      const res = await onAsk(msg, messages);
      const text = String(res?.content || '').trim();
      if (!text) throw new Error('回复为空，请重试');
      setPending({ text });
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'master', text: `⚠️ ${e.message || '回复失败，请重试'}` }]);
    }
    setLoading(false);
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="explain-drawer chat-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="chat-drawer-head">
          <MasterAvatar master={master} size={38} />
          <div className="chat-drawer-title-wrap">
            <div className="chat-drawer-title">与 {master?.name || '大师'} 单聊</div>
            <div className="chat-drawer-sub">{master?.title || ''}</div>
          </div>
          <button type="button" className="modal-close drawer-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <div className="chat-drawer-body" ref={bodyRef}>
          {context && (
            <div className="chat-drawer-context">
              <div className="chat-drawer-context-label">你在回复 {master?.name} 的发言：</div>
              <div className="chat-drawer-context-body">{renderRich(context)}</div>
            </div>
          )}
          {messages.map((m, i) => (
            m.role === 'user' ? (
              <div key={i} className="chat-msg chat-user">✋ {m.text}</div>
            ) : (
              <div key={i} className="chat-msg chat-master">
                <div className="chat-msg-head">{master?.name}</div>
                <div className="speech-content">{renderRich(m.text)}</div>
              </div>
            )
          ))}
          {pending && (
            <div className="chat-msg chat-master">
              <div className="chat-msg-head">{master?.name}</div>
              <div className="speech-content">
                {renderRich(pending.text.slice(0, idx))}
                {idx < pending.text.length && <span className="caret" />}
              </div>
            </div>
          )}
          {loading && !pending && <div className="chat-drawer-loading">{master?.name} 正在疯狂打字中....</div>}
        </div>
        <div className="chat-drawer-foot">
          <textarea
            className="chat-drawer-input"
            rows={2}
            placeholder={placeholder || `向 ${master?.name || '大师'} 提问…`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button type="button" className="btn-reply-send chat-drawer-send" onClick={send} disabled={loading || !input.trim()}>{loading ? '疯狂打字中…' : '发送'}</button>
        </div>
      </aside>
    </div>
  );
}
