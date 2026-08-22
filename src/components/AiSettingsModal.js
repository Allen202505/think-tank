'use client';

// AI 设置弹窗（BYOK）：配置自己的 API Key / Base URL / 模型
// Key 只保存在浏览器本地（localStorage），请求时即用即弃，不落服务器。
import { useEffect, useState } from 'react';
import { PROVIDERS, loadAiConfig, saveAiConfig, getFreeRemaining, FREE_LIMIT } from '../lib/aiGate';

export default function AiSettingsModal({ open, onClose }) {
  const [provider, setProvider] = useState('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [freeLeft, setFreeLeft] = useState(FREE_LIMIT);

  useEffect(() => {
    if (!open) return;
    const cfg = loadAiConfig();
    setProvider(cfg.provider || 'deepseek');
    setApiKey(cfg.apiKey || '');
    setBaseUrl(cfg.baseUrl || '');
    setModel(cfg.model || '');
    setSaved(false);
    setFreeLeft(getFreeRemaining());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const preset = PROVIDERS[provider] || PROVIDERS.deepseek;

  const onProviderChange = (p) => {
    setProvider(p);
    if (p !== 'custom') {
      setBaseUrl(PROVIDERS[p].baseUrl);
      setModel(PROVIDERS[p].model);
    }
  };

  const doSave = () => {
    saveAiConfig({ provider, apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), model: model.trim() });
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 600);
  };

  const keyReady = apiKey.trim().length > 0;

  return (
    <div className="ai-settings-overlay" onClick={onClose}>
      <div className="ai-settings-panel" role="dialog" aria-modal="true" aria-label="AI 设置" onClick={(e) => e.stopPropagation()}>
        <div className="ai-settings-head">
          <div className="ai-settings-title">🔑 AI 设置</div>
          <button type="button" className="ai-settings-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        <p className="ai-settings-note">
          免费体验剩余 <strong>{freeLeft}</strong> 次；之后需要配置你自己的 API Key。
          你的 Key 只保存在本机浏览器，仅用于本次请求调用，不会上传保存。
        </p>

        <div className="ai-settings-field">
          <label className="ai-settings-label">服务商</label>
          <div className="ai-settings-providers">
            {Object.entries(PROVIDERS).map(([k, v]) => (
              <button key={k} type="button" className={provider === k ? 'active' : ''} onClick={() => onProviderChange(k)}>
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <div className="ai-settings-field">
          <label className="ai-settings-label">API Key</label>
          <div className="ai-settings-keyrow">
            <input
              type={showKey ? 'text' : 'password'}
              className="ai-settings-input"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck="false"
            />
            <button type="button" className="ai-settings-show" onClick={() => setShowKey((v) => !v)} aria-label="显示/隐藏">{showKey ? '隐藏' : '显示'}</button>
          </div>
        </div>

        <div className="ai-settings-field">
          <label className="ai-settings-label">Base URL（OpenAI 兼容，可改）</label>
          <input
            type="text"
            className="ai-settings-input"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={preset.baseUrl || 'https://api.example.com/v1'}
            autoCapitalize="off"
            spellCheck="false"
          />
        </div>

        <div className="ai-settings-field">
          <label className="ai-settings-label">模型名（可改）</label>
          <input
            type="text"
            className="ai-settings-input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={preset.model || 'model-name'}
            autoCapitalize="off"
            spellCheck="false"
          />
        </div>

        <div className="ai-settings-foot">
          <button type="button" className="ai-settings-cancel" onClick={onClose}>取消</button>
          <button type="button" className="ai-settings-save" onClick={doSave} disabled={!keyReady}>
            {saved ? '✓ 已保存' : '保存'}
          </button>
        </div>
        {!keyReady && <div className="ai-settings-tip">填写 API Key 后即可保存使用你自己的模型额度</div>}
      </div>
    </div>
  );
}
