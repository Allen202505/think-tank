'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { MasterAvatar } from './ui';
import { findMasterById } from '../lib/breakfast';
import { ensureAiReady, consumeFree, getAiConfig } from '../lib/aiGate';

function renderInline(text, keyBase) {
  const normalized = String(text || '').replace(/\*\*\*/g, '**');
  const parts = normalized.split(/\*\*([\s\S]+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={`${keyBase}-${i}`}>{p}</strong> : p));
}

export default function MungerFinance() {
  const munger = findMasterById('munger');
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const [fileData, setFileData] = useState(null); // { base64, name }
  const [reportTab, setReportTab] = useState('link'); // link | file
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [fileName, setFileName] = useState('');
  const fileRef = useRef(null);

  // ── 举手提问 · 与芒格单聊浮层（样式与大师PK 一致） ──
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMsgs, setDrawerMsgs] = useState([]);
  const [drawerInput, setDrawerInput] = useState('');
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState('');
  const drawerBodyRef = useRef(null);
  useEffect(() => {
    if (drawerBodyRef.current) drawerBodyRef.current.scrollTop = drawerBodyRef.current.scrollHeight;
  }, [drawerMsgs, drawerLoading]);

  const openDrawer = useCallback((initialQuestion) => {
    setDrawerOpen(true);
    setDrawerMsgs([]);
    setDrawerInput('');
    setDrawerError('');
    if (initialQuestion) sendDrawer(initialQuestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerLoading, result]);

  const sendDrawer = useCallback(async (raw) => {
    const msg = String(raw || drawerInput || '').trim();
    if (!msg || drawerLoading || !result) return;
    if (!ensureAiReady()) return;
    setDrawerInput('');
    setDrawerError('');
    setDrawerMsgs((prev) => [...prev, { role: 'user', text: msg }]);
    setDrawerLoading(true);
    try {
      const res = await fetch('/api/munger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'followup', question: msg, report: note, prevContent: result.content, aiConfig: getAiConfig() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '追问失败，请重试');
      setDrawerMsgs((prev) => [...prev, { role: 'master', text: data.result.content }]);
    } catch (e) {
      setDrawerError(e.message || '追问失败，请重试');
    } finally {
      setDrawerLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerInput, drawerLoading, result]);

  const closeDrawer = () => {
    setDrawerOpen(false);
    setDrawerMsgs([]);
    setDrawerInput('');
    setDrawerError('');
  };

  // 附件：文本类读进输入框确认；PDF 直接上传解析并解读
  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setError('附件过大，请控制在 8MB 以内'); return; }
    setFileName(file.name);
    setError('');
    const b64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || '').split(',')[1] || '');
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    setFileData({ base64: b64, name: file.name });
    setFileName(file.name);
    setLink(''); // 二选一：选了附件就清空链接
    setError('');
  };

  // 财报解读：财报链接 或 附件上传 + 补充说明（非必填）
  const runReport = useCallback(async () => {
    if (loading) return;
    if (!link.trim() && !fileData) return;
    if (!ensureAiReady()) return; // 免费次数用尽且未配置 Key → 弹设置
    consumeFree();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const payload = { mode: 'report', note: note.trim(), aiConfig: getAiConfig() };
      if (fileData) {
        payload.file = fileData.base64;
        payload.filename = fileData.name;
      } else {
        payload.link = link.trim();
      }
      const res = await fetch('/api/munger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '生成失败，请重试');
      setResult(data.result);
    } catch (e) {
      setError(e.message || '生成失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [loading, link, note, fileData]);

  return (
    <div className="mg-workspace">
      <div className="mg-top">
        <div className="mg-title">芒格教你读财报</div>
      </div>
      <p className="mg-intro">把财报链接或附件丢给芒格，他会像讲课一样深入浅出地拆给你听，看完还能「✋ 举手提问」继续追问。</p>

        <div className="mg-card">
          <div className="mg-card-label">把一份财报丢给芒格，他会深入浅出地讲给你听</div>
          <div className="mg-mode" role="group" aria-label="上传方式">
            <button type="button" className={reportTab === 'link' ? 'active' : ''} onClick={() => setReportTab('link')}>财报链接</button>
            <button type="button" className={reportTab === 'file' ? 'active' : ''} onClick={() => setReportTab('file')}>附件上传</button>
          </div>
          {reportTab === 'link' ? (
            <input
              className="mg-input mg-input-line"
              value={link}
              onChange={(e) => { setLink(e.target.value); if (e.target.value.trim()) { setFileData(null); setFileName(''); } }}
              placeholder="https://…/半年报（支持 .pdf 链接）"
            />
          ) : (
            <div className="mg-upload-row">
              <button type="button" className="mg-upload" onClick={() => fileRef.current && fileRef.current.click()} disabled={loading}>
                📎 选择文件
              </button>
              {fileName && <span className="mg-file-name">{fileName}</span>}
              <input ref={fileRef} type="file" accept=".pdf,.txt,.csv,.md,.json" hidden onChange={onFile} />
            </div>
          )}
          <textarea
            className="mg-input"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="补充说明（非必填）：例如这份财报的疑点、想重点看的指标…"
          />
          <div className="mg-foot">
            <button type="button" className="mg-btn" onClick={runReport} disabled={loading || (reportTab === 'link' ? !link.trim() : !fileData)}>
              {loading ? '芒格正在解读…' : '▶ 开始解读'}
            </button>
          </div>
        </div>

      {error && <div className="mg-error">⚠ {error}</div>}

      {loading && (
        <div className="mg-loading">
          <MasterAvatar master={munger} size={36} />
          <span>芒格正在读财报…</span>
        </div>
      )}

      {result && !loading && (
        <div className="mg-result">
          <div className="mg-speech">
              <div className="mg-speech-head">
                <MasterAvatar master={munger} size={40} />
                <span className="mg-speech-name">{munger.name}</span>
                <span className="mg-speech-tag">财报解读</span>
              </div>
              <div className="mg-speech-body">{renderInline(result.content, 'c')}</div>
              {result.dataCard && (
                <details className="mg-data-card" open={false}>
                  <summary>
                    <span className="mg-data-card-title">📋 系统数据核验</span>
                    <span className="mg-data-card-hint">定量数据交叉验证（来自行情/财务数据层，非财报文本）</span>
                  </summary>
                  <div className="mg-data-card-body">{renderInline(result.dataCard, 'dc')}</div>
                </details>
              )}
              {Array.isArray(result.followUps) && result.followUps.length > 0 && (
                <div className="mg-followups">
                  <div className="mg-fu-label">想深挖？点击即可举手提问芒格：</div>
                  {result.followUps.map((f, fi) => (
                    <button key={fi} type="button" className="mg-fu-item" onClick={() => openDrawer(f)} title="点击举手提问芒格">
                      <span className="mg-fu-ask">＋</span> {f}
                    </button>
                  ))}
                </div>
              )}
              <div className="mg-ask-row">
                <button type="button" className="mg-btn mg-ask-btn" onClick={() => openDrawer()}>✋ 举手提问</button>
              </div>
          </div>
        </div>
      )}

      {/* 举手提问 · 与芒格单聊浮层（样式与大师PK 一致） */}
      {drawerOpen && (
        <div className="drawer-overlay" onClick={closeDrawer}>
          <aside className="explain-drawer chat-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="chat-drawer-head">
              <MasterAvatar master={munger} size={38} />
              <div className="chat-drawer-title-wrap">
                <div className="chat-drawer-title">与 {munger.name} 单聊</div>
                <div className="chat-drawer-sub">{munger.title}</div>
              </div>
              <button type="button" className="modal-close drawer-close" onClick={closeDrawer} aria-label="关闭">✕</button>
            </div>
            <div className="chat-drawer-body" ref={drawerBodyRef}>
              {result && result.content && (
                <div className="chat-drawer-context">
                  <div className="chat-drawer-context-label">你在向 {munger.name} 请教这份财报：</div>
                  <div className="chat-drawer-context-body">{renderInline(result.content, 'ctx')}</div>
                </div>
              )}
              {drawerMsgs.map((m, i) => (
                m.role === 'user' ? (
                  <div key={i} className="chat-msg chat-user">✋ {m.text}</div>
                ) : (
                  <div key={i} className="chat-msg chat-master">
                    <div className="chat-msg-head">{munger.name}</div>
                    <div className="speech-content">{renderInline(m.text, `dm-${i}`)}</div>
                  </div>
                )
              ))}
              {drawerLoading && <div className="chat-drawer-loading">{munger.name} 正在思考…</div>}
              {drawerError && <div className="mg-error">{drawerError}</div>}
            </div>
            <div className="chat-drawer-foot">
              <textarea
                className="chat-drawer-input"
                rows={2}
                placeholder={`向 ${munger.name} 提问…`}
                value={drawerInput}
                onChange={(e) => setDrawerInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDrawer(); } }}
              />
              <button type="button" className="btn-reply-send chat-drawer-send" onClick={() => sendDrawer()} disabled={drawerLoading || !drawerInput.trim()}>
                {drawerLoading ? '思考中…' : '发送'}
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
