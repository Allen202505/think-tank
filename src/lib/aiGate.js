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
  mimo: { label: 'MiMo（小米）', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-pro' },
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

// 免费次数同时写入 localStorage + cookie（双写）。
// 无痕/隐私模式下 localStorage 可能被清空或不可靠，cookie 在同一会话内刷新/新开标签仍保留，
// 取两者中已用次数较大者，避免「刷新重置 10 次」绕过；服务端另有按 IP 的每日免费总量兜底。
function getQuotaCookie() {
  try {
    const m = document.cookie.match(new RegExp('(?:^|; )' + QUOTA_KEY.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  } catch (e) { return null; }
}
function setQuotaCookie(v) {
  try {
    const d = new Date();
    d.setTime(d.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 年
    document.cookie = `${QUOTA_KEY}=${encodeURIComponent(String(v))}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
  } catch (e) { /* ignore */ }
}
function getFreeUsed() {
  let used = 0;
  try { used = Math.max(used, Number(localStorage.getItem(QUOTA_KEY) || 0)); } catch (e) { /* ignore */ }
  try { used = Math.max(used, Number(getQuotaCookie() || 0)); } catch (e) { /* ignore */ }
  return Number.isFinite(used) ? used : 0;
}

// 免费体验次数（未配置 Key 时用站长 Key 的次数）
export function getFreeRemaining() {
  return Math.max(0, FREE_LIMIT - getFreeUsed());
}

export function consumeFree() {
  if (hasUserKey()) return true; // 用户自带 Key，不占免费次数
  const used = getFreeUsed();
  const next = used + 1;
  try { localStorage.setItem(QUOTA_KEY, String(next)); } catch (e) { /* ignore */ }
  setQuotaCookie(next);
  return next < FREE_LIMIT;
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
