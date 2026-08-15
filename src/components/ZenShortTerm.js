'use client';

import { useState, useCallback } from 'react';
import { MasterAvatar } from './ui';

const ZEN_MASTER = {
  id: 'zen',
  name: '缠中说禅',
  title: '缠论缠师',
  emoji: '☯️',
  color: '#33415c',
  status: 'deceased',
  style: '缠论：分型/笔/线段/中枢/背驰，多级别联立，三类买卖点',
};

function renderInline(text, keyBase) {
  const normalized = String(text || '').replace(/\*\*\*/g, '**');
  const parts = normalized.split(/\*\*([\s\S]+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={`${keyBase}-${i}`}>{p}</strong> : p));
}

// 缠中说禅 · 看短线：输入股票，用缠论做短线分析评估
export default function ZenShortTerm() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const run = useCallback(async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/zen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '分析失败，请重试');
      setResult(data.result);
    } catch (e) {
      setError(e.message || '分析失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [query, loading]);

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
                  <div key={fi} className="mg-fu-item">· {f}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
