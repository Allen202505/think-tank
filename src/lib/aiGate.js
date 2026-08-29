// src/lib/aiGate.js —— 前端 BYOK 配置 + 免费体验配额
// Key 只保存在用户本地浏览器（localStorage），随请求带给服务端即用即弃。
'use client';

export const CONFIG_KEY = 'thinktank_ai_config';
export const QUOTA_KEY = 'thinktank_free_quota';
export const FREE_LIMIT = 10;

// 常用 OpenAI 兼容服务预设（用户可自定义 Base URL 与模型名）
export const PROVIDERS = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  moonshot: { label: 'Kimi（月之暗面）', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  qwen: { label: '通义千问（阿里云）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  custom: { label: '自定义（OpenAI 兼容）', baseUrl: '', model: '' },
};

export function loadAiConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    if (raw && typeof raw === 'object') return raw;
  } catch (e) { /* ignore */ }
  return { provider: 'deepseek', apiKey: '', baseUrl: '', model: '' };
}

export function saveAiConfig(cfg) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
}

// 返回要随请求发送的 aiConfig（无 Key 时返回 null）
export function getAiConfig() {
  const cfg = loadAiConfig();
  const apiKey = String(cfg.apiKey || '').trim();
  if (!apiKey) return null;
  const preset = PROVIDERS[cfg.provider] || PROVIDERS.deepseek;
  return {
    apiKey,
    baseUrl: String(cfg.baseUrl || '').trim() || preset.baseUrl,
    model: String(cfg.model || '').trim() || preset.model,
  };
}

export function hasUserKey() {
  return !!getAiConfig();
}

// 免费体验次数（未配置 Key 时用站长 Key 的次数）
export function getFreeRemaining() {
  try {
    const used = Number(localStorage.getItem(QUOTA_KEY) || 0);
    return Math.max(0, FREE_LIMIT - used);
  } catch (e) { return FREE_LIMIT; }
}

export function consumeFree() {
  if (hasUserKey()) return true; // 用户自带 Key，不占免费次数
  try {
    const used = Number(localStorage.getItem(QUOTA_KEY) || 0);
    localStorage.setItem(QUOTA_KEY, String(used + 1));
    return getFreeRemaining() > 0;
  } catch (e) { return false; }
}

// 全局"打开 AI 设置"回调：由页面顶层注册（弹设置弹窗）
let onNeedConfig = null;
export function setOnNeedConfig(fn) {
  onNeedConfig = fn;
}
export function openAiSettings() {
  if (onNeedConfig) onNeedConfig();
}

// 发起 AI 前的统一检查：未配置 Key 且免费次数用尽 → 弹设置并返回 false
export function ensureAiReady() {
  if (hasUserKey()) return true;
  if (getFreeRemaining() > 0) return true;
  openAiSettings();
  return false;
}
