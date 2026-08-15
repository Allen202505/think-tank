// src/lib/ai.js —— 共享 DeepSeek 调用与 JSON 解析（早餐/芒格/禅宗等路由复用）
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate);
  } catch (e) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}

export async function callDeepSeek(messages, maxTokens = 2000) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('未配置 DEEPSEEK_API_KEY，请在 .env.local 中填写');
  const attempt = async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    try {
      const res = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          max_tokens: maxTokens,
          messages,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `DeepSeek API 错误: ${res.status}`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timer);
    }
  };
  // 网络/服务偶发抖动或排队：最多尝试 3 次，间隔递增
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      return await attempt();
    } catch (e) {
      lastErr = e;
      if (i < 2) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

// 请求 AI 并尽量解析出 JSON；解析失败自动修复重试一次
export async function generateJson(messages, schemaHint = '{"content":"正文"}', maxTokens = 2000, requireContent = true) {
  const isValid = (obj) => {
    if (!obj || typeof obj !== 'object') return false;
    if (requireContent) return typeof obj.content === 'string' && obj.content.trim();
    return Object.keys(obj).length > 0;
  };
  let raw = await callDeepSeek(messages, maxTokens);
  let parsed = extractJson(raw);
  if (!isValid(parsed)) {
    messages.push(
      { role: 'assistant', content: raw },
      { role: 'user', content: `你刚才的输出不是合法 JSON。请严格只输出一个 JSON 对象，不要任何解释、不要 Markdown 代码块：${schemaHint}。所有字符串内只允许中文引号「」或“”。` },
    );
    raw = await callDeepSeek(messages, maxTokens);
    parsed = extractJson(raw);
  }
  return { raw, parsed };
}
