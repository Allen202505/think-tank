// src/lib/ai.js —— 共享 AI 调用与 JSON 解析（早餐/芒格/禅宗等路由复用）
// 基于 src/lib/llm.js 的统一 OpenAI 兼容层；支持 BYOK（用户自带 Key/模型）。
import { callChatCompletion, resolveAiConfig } from './llm.js';

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
