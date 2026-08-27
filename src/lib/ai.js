// src/lib/ai.js —— 共享 AI 调用与 JSON 解析（早餐/芒格/禅宗等路由复用）
// 基于 src/lib/llm.js 的统一 OpenAI 兼容层；支持 BYOK（用户自带 Key/模型）。
import { callChatCompletion, resolveAiConfig } from './llm.js';

export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const parseOnce = (s) => {
    const v = JSON.parse(s);
    // 模型偶尔把整个 JSON 用双引号包成字符串：解包后再解析一次
    if (typeof v === 'string' && v.trim().startsWith('{')) return JSON.parse(v);
    return v;
  };
  try {
    return parseOnce(candidate);
  } catch (e) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return parseOnce(candidate.slice(start, end + 1));
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}

// 兜底展示用：AI 输出 JSON 但解析失败时，只抠出可读的 content 正文，
// 避免把 content/opportunities 等 JSON 字段名原样展示给用户
export function extractContentFromRaw(raw) {
  if (!raw) return '';
  let text = String(raw).trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  if (!text.startsWith('{')) return '';
  // 1) 整体再解析一次（含「整个 JSON 被双引号包成字符串」）
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && typeof v.content === 'string' && v.content.trim()) return v.content.trim();
    if (typeof v === 'string' && v.trim().startsWith('{')) {
      const inner = extractJson(v);
      if (inner && typeof inner.content === 'string' && inner.content.trim()) return inner.content.trim();
    }
  } catch (e) { /* 落入正则兜底 */ }
  // 2) 正则匹配 "content":"..."（兼容字符串内转义引号），取第一个命中
  const m = text.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m && m[1]) {
    const s = m[1]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\\\/g, '\\')
      .trim();
    if (s) return s;
  }
  return '';
}

/**
 * 调用 LLM 并返回文本。
 * @param {object[]} messages
 * @param {number} maxTokens
 * @param {object|null} userConfig 用户自带 {apiKey, baseUrl, model}；为空回退服务端 env
 */
export async function callDeepSeek(messages, maxTokens = 2000, userConfig = null) {
  const cfg = resolveAiConfig(userConfig);
  return callChatCompletion(cfg, messages, maxTokens);
}

// 请求 AI 并尽量解析出 JSON；解析失败自动修复重试一次
export async function generateJson(messages, schemaHint = '{"content":"正文"}', maxTokens = 2000, requireContent = true, userConfig = null) {
  const isValid = (obj) => {
    if (!obj || typeof obj !== 'object') return false;
    if (requireContent) return typeof obj.content === 'string' && obj.content.trim();
    return Object.keys(obj).length > 0;
  };
  let raw = await callDeepSeek(messages, maxTokens, userConfig);
  let parsed = extractJson(raw);
  if (!isValid(parsed)) {
    messages.push(
      { role: 'assistant', content: raw },
      { role: 'user', content: `你刚才的输出不是合法 JSON。请严格只输出一个 JSON 对象，不要任何解释、不要 Markdown 代码块：${schemaHint}。所有字符串内只允许中文引号「」或“”。` },
    );
    raw = await callDeepSeek(messages, maxTokens, userConfig);
    parsed = extractJson(raw);
  }
  return { raw, parsed };
}
