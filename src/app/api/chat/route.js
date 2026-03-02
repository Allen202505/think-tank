// src/app/api/chat/route.js
// 后端代理：前端 → Next.js API Route → DeepSeek API（解决 CORS）
// 支持传入 query：拉取最新行情注入 prompt，让专家引用实时数据

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
import { getQuoteContext } from './quoteContext.js';

export async function POST(request) {
  try {
    const body = await request.json();
    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (!apiKey) {
      return Response.json(
        { error: '未配置 DEEPSEEK_API_KEY，请在 .env.local 中填写' },
        { status: 500 }
      );
    }

    let messages = Array.isArray(body.messages) ? [...body.messages] : [];

    // 若前端传入用户问题，拉取最新行情并注入首条前，供模型引用
    const userQuery = body.query || body.userQuery || '';
    if (userQuery && messages.length > 0) {
      try {
        const quoteText = await getQuoteContext(userQuery);
        if (quoteText) {
          messages = [
            { role: 'user', content: quoteText },
            { role: 'assistant', content: '我已收到参考数据，将基于这些最新数据参与讨论。' },
            ...messages,
          ];
        }
      } catch (e) {
        // 行情拉取失败不影响对话，继续用原 messages
      }
    }

    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        max_tokens: 8192,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const message = err?.error?.message || err?.message || `DeepSeek API 错误: ${response.status}`;
      return Response.json({ error: message }, { status: response.status });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';

    // 返回与前端约定格式一致：content 数组，每项含 text
    return Response.json({ content: [{ text: content }] });
  } catch (e) {
    return Response.json({ error: e.message || '服务器内部错误' }, { status: 500 });
  }
}
