'use client';

import { useState, useCallback } from 'react';
import { MasterAvatar } from './ui';
import { ensureAiReady, consumeFree, getAiConfig } from '../lib/aiGate';
import AskDrawer from './AskDrawer';

const ZEN_MASTER = {
  id: 'zen',
  name: '缠中说禅',
  title: '缠论缠师',
  emoji: '☯️',
  color: '#33415c',
  status: 'deceased',
  style: '缠论：分型/笔/线段/中枢/背驰，多级别联立，三类买卖点',
};

// 把会话历史拼成追问上下文
function buildZenContext(base, convo) {
  const lines = [String(base || '')];
  for (const m of convo || []) lines.push(`${m.role === 'user' ? '我问' : ZEN_MASTER.name}：${String(m.text || '').slice(0, 200)}`);
  return lines.filter(Boolean).join('\n');
}

function renderInline(text, keyBase) {
  const normalized = String(text || '').replace(/\*\*\*/g, '**');
  const parts = normalized.split(/\*\*([\s\S]+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={`${keyBase}-${i}`}>{p}</strong> : p));
}

// ── 短线分析记忆：同一只股票短时（30 分钟）重复分析不再消耗 token ──
function hashText(s) {
  let h = 5381; const t = String(s || '').trim();
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return `n${(h >>> 0).toString(36)}`;
}
const ZEN_KEY = 'thinktank_zen_memory';
const ZEN_MAX = 20;
const ZEN_TTL = 30 * 60 * 1000; // 30 分钟（行情会变，短缓存）
function loadZenMemory() {
  try {
    const raw = JSON.parse(localStorage.getItem(ZEN_KEY) || '{}') || {};
    const cutoff = Date.now() - ZEN_TTL; const out = {};
    for (const k in raw) { const e = raw[k]; if (e && e.at >= cutoff) out[k] = e; }
    const keys = Object.keys(out).sort((a, b) => (out[b].at || 0) - (out[a].at || 0));
    keys.slice(ZEN_MAX).forEach((k) => delete out[k]);
    return out;
  } catch (e) { return {}; }
}
function saveZenMemory(map) {
  try {
    const cutoff = Date.now() - ZEN_TTL; const out = {};
    for (const k in map) { const e = map[k]; if (e && e.at >= cutoff) out[k] = e; }
    const keys = Object.keys(out).sort((a, b) => (out[b].at || 0) - (out[a].at || 0));
    keys.slice(ZEN_MAX).forEach((k) => delete out[k]);
    localStorage.setItem(ZEN_KEY, JSON.stringify(out));
  } catch (e) { /* ignore */ }
}

// 缠中说禅 · 看短线：输入股票，用缠论做短线分析评估
export default function ZenShortTerm() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [fu, setFu] = useState(null);            // 追问回答
  const [fuLoading, setFuLoading] = useState(false);
  const [fuError, setFuError] = useState('');
  const [askOpen, setAskOpen] = useState(false); // 大师PK 同款「举手提问」侧边浮层

  const run = useCallback(async () => {
    const q = query.trim();
    if (!q || loading) return;
    const memKey = `zen::${hashText(q)}`;
    const hit = loadZenMemory()[memKey];
    if (hit && hit.result) { setResult(hit.result); setError(''); return; }
    if (!ensureAiReady()) return; // 免费次数用尽且未配置 Key → 弹设置
    consumeFree();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/zen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, aiConfig: getAiConfig() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '分析失败，请重试');
      setResult(data.result);
      const mem = loadZenMemory();
      mem[memKey] = { result: data.result, at: Date.now() };
      saveZenMemory(mem);
    } catch (e) {
      setError(e.message || '分析失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [query, loading]);

  // 追问：基于当前分析结果，向缠师继续问
  const askFollowUp = useCallback(async (q) => {
    const qq = String(q || '').trim();
    if (!qq || fuLoading) return;
    if (!ensureAiReady()) return;
    setFuLoading(true);
    setFuError('');
    try {
      const res = await fetch('/api/zen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), followUp: qq, prevContent: (result && result.content) || '', aiConfig: getAiConfig() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '追问失败，请重试');
      const content = String((data.result && data.result.content) || '').trim();
      if (!content) throw new Error('追问无内容，请重试');
      setFu({ q: qq, content });
    } catch (e) {
      setFuError(e.message || '追问失败，请重试');
    } finally {
      setFuLoading(false);
    }
  }, [query, result, fuLoading]);

  // 大师PK 同款举手提问：侧边浮层单聊
  const onAskZen = useCallback(async (q, convo) => {
    const res = await fetch('/api/zen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query.trim(), followUp: q, prevContent: buildZenContext(result.content, convo), aiConfig: getAiConfig() }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || '回复失败，请重试');
    return data.result;
  }, [query, result]);

  return (
    <div className="mg-workspace">
      <div className="mg-top">
        <div className="mg-title">缠中说禅 · 看短线</div>
      </div>
      <p className="mg-intro">输入股票名称或代码，缠中说禅会用缠论框架评估短线结构（中枢 / 背驰 / 买卖点）。分析基于实时行情与缠论逻辑推导，实操前请对照实时 K 线验证。</p>

      <div className="mg-card">
        <div className="mg-card-label">输入一只股票，缠中说禅用缠论帮你评估短线</div>
        <div className="zen-input-row">
          <input
            className="mg-input mg-input-line"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            placeholder="股票名称或代码，如：宁德时代 / 600519"
          />
          <button type="button" className="mg-btn" onClick={run} disabled={!query.trim() || loading}>
            {loading ? '正在观缠…' : '▶ 开始分析'}
          </button>
        </div>
        <div className="zen-note">基于实时行情 + 缠论框架逻辑推导，实际交易前请对照实时 K 线验证</div>
      </div>

      {error && <div className="mg-error">⚠ {error}</div>}

      {loading && (
        <div className="mg-loading">
          <MasterAvatar master={ZEN_MASTER} size={36} />
          <span>缠中说禅 正在观缠…</span>
        </div>
      )}

      {result && !loading && (
        <div className="mg-result">
          <div className="mg-speech">
            <div className="mg-speech-head">
              <MasterAvatar master={ZEN_MASTER} size={40} />
              <span className="mg-speech-name">{ZEN_MASTER.name}</span>
              <span className="mg-speech-tag">{result.name ? `看短线 · ${result.name}` : '看短线'}</span>
            </div>
            <div className="mg-speech-body">{renderInline(result.content, 'z')}</div>
            {Array.isArray(result.followUps) && result.followUps.length > 0 && (
              <div className="mg-followups">
                <div className="mg-fu-label">想深挖？可以继续问缠师：</div>
                {result.followUps.map((f, fi) => (
                  <button key={fi} type="button" className="mg-fu-item" onClick={() => askFollowUp(f)} disabled={fuLoading}>＋ {f}</button>
                ))}
              </div>
            )}
            {fuLoading && (
              <div className="mg-fu-loading"><span className="bk-loading-speech-dots"><span /><span /><span /></span> 正在追问缠师…</div>
            )}
            {fuError && <div className="mg-fu-error">⚠ {fuError} <button type="button" className="mg-fu-retry" onClick={() => askFollowUp(fu ? fu.q : '') }>↻ 重试</button></div>}
            {fu && !fuLoading && !fuError && (
              <div className="mg-fu-answer">
                <div className="mg-fu-label">💬 追问</div>
                <div className="mg-fu-q">问：{fu.q}</div>
                <div className="mg-speech-body">{renderInline(fu.content, 'zf')}</div>
              </div>
            )}
            <div className="mg-ask-row">
              <button type="button" className="reply-btn" onClick={() => setAskOpen(true)}>✋ 举手提问</button>
            </div>
          </div>
        </div>
      )}

      {askOpen && result && (
        <AskDrawer master={ZEN_MASTER} context={result.content} onClose={() => setAskOpen(false)} onAsk={onAskZen} />
      )}
    </div>
  );
}
