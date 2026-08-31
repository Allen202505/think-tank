// src/lib/llm.js —— 统一 LLM 调用层（OpenAI 兼容协议）
// 支持 BYOK：用户自带 apiKey/baseUrl/model；未提供时回退到服务端 env。
// 关键原则：用户 Key 即用即弃 —— 不落库、不打日志、不缓存。
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

// ─── OpenAI 兼容适配（MiMo 等厂商差异） ──────────────────────────────
// MiMo（小米）官方用 `api-key` 请求头 + `max_completion_tokens` 参数，
// 且默认开启思维链（产生额外 reasoning tokens 计费）；这里统一适配。
export function isMiMoProvider(baseUrl) {
  return /xiaomimimo/i.test(String(baseUrl || ''));
}

// 构造请求头：Authorization Bearer（OpenAI/DeepSeek 等）+ api-key（MiMo 等）双保险
export function buildProviderHeaders(cfg, extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  headers.Authorization = `Bearer ${cfg.apiKey}`;
  if (isMiMoProvider(cfg.baseUrl)) headers['api-key'] = cfg.apiKey;
  return headers;
}

// 构造请求体：MiMo 用 max_completion_tokens 并显式关闭思维链（省钱更稳）
export function buildProviderBody(cfg, messages, maxTokens, extra = {}) {
  const body = { model: cfg.model, messages, ...extra };
  if (isMiMoProvider(cfg.baseUrl)) {
    body.max_completion_tokens = maxTokens;
    body.thinking = { type: 'disabled' };
  } else {
    body.max_tokens = maxTokens;
  }
  return body;
}

// 解析完整 chat/completions URL（env 的 baseUrl 可能是域名根或已含 /chat/completions）
export function resolveLlmUrl(baseUrl) {
  const base = String(baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
}


// 清洗前端传来的 AI 配置，只保留安全字段
export function normalizeAiConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const apiKey = String(raw.apiKey || '').trim();
  const baseUrl = String(raw.baseUrl || '').trim().replace(/\/+$/, '');
  const model = String(raw.model || '').trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: baseUrl || 'https://api.deepseek.com/v1',
    model: model || 'deepseek-chat',
  };
}

// 解析最终生效的配置：用户配置优先，否则服务端 env
export function resolveAiConfig(userConfig) {
  const user = normalizeAiConfig(userConfig);
  if (user) return user;
  return {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  };
}

function buildUrl(baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(base)) return base;
  return `${base}/chat/completions`;
}

/**
 * 非流式调用 chat/completions，返回文本内容。
 * @param {object} cfg { apiKey, baseUrl, model }
 * @param {object[]} messages
 * @param {number} maxTokens
 */
export async function callChatCompletion(cfg, messages, maxTokens = 2000) {
  const url = buildUrl(cfg.baseUrl);
  const apiKey = cfg.apiKey;
  if (!apiKey) throw new Error('未配置 API Key，请在设置中填写');
  const attempt = async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: buildProviderHeaders(cfg),
        body: JSON.stringify(buildProviderBody(cfg, messages, maxTokens)),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err?.error?.message || `模型服务错误: ${res.status}`;
        // 401/403 → 明确提示 Key 问题
        if (res.status === 401 || res.status === 403) throw new Error('API Key 无效或无权限（401/403），请检查设置中的 Key');
        throw new Error(msg);
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content ?? '';
      if (!content) throw new Error('模型返回为空，请检查模型名是否正确');
      return content;
    } finally {
      clearTimeout(timer);
    }
  };
  // 网络/服务偶发抖动：最多尝试 3 次
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      return await attempt();
    } catch (e) {
      lastErr = e;
      if (i < 2 && !/401|403|400/.test(String(e.message))) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * 流式调用 chat/completions（SSE），返回 fetch Response 或 text 流迭代器。
 * 供 /api/explain、/api/virtual-master 等使用。
 */
export async function streamChatCompletion(cfg, messages, maxTokens = 2000) {
  const url = buildUrl(cfg.baseUrl);
  const apiKey = cfg.apiKey;
  if (!apiKey) throw new Error('未配置 API Key，请在设置中填写');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildProviderHeaders(cfg),
      body: JSON.stringify(buildProviderBody(cfg, messages, maxTokens, { stream: true })),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error?.message || `模型服务错误: ${res.status}`;
      if (res.status === 401 || res.status === 403) throw new Error('API Key 无效或无权限（401/403），请检查设置中的 Key');
      throw new Error(msg);
    }
    return { response: res, cleanup: () => clearTimeout(timer) };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// 兼容旧引用
export const DEEPSEEK_API_URL = DEEPSEEK_URL;
