// src/app/api/explain/route.js
// 小白解释 · 流式接口：边生成边推送（SSE），避免等整段返回
// 比 /api/chat 轻量：不走快照注入、max_tokens 更小；含 45s 超时 + 首次请求重试
import { buildExplainPrompt } from '../../../lib/prompts.js';
import { getClientIp, rateLimit, limitResponse } from '../../../lib/rateLimit';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

export async function POST(request) {

  const _rl = rateLimit('explain:' + getClientIp(request), { limit: 60, windowMs: 60000 });
  if (!_rl.ok) return limitResponse(_rl.retryAfter);
  const body = await request.json().catch(() => ({}));
  const speech = typeof body?.speech === 'string' ? body.speech : '';
  const master = body?.master && typeof body.master === 'object' ? body.master : null;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return Response.json({ error: '未配置 DEEPSEEK_API_KEY' }, { status: 500 });
  if (!speech.trim()) return Response.json({ error: '缺少发言内容' }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch (e) { /* 客户端已断开 */ }
      };
      let sentAny = false;
      const sendDelta = (delta) => { sentAny = true; send({ delta }); };
      try {
        // 首次请求失败自动重试一次（DeepSeek 偶发慢/断）
        let res = null;
        for (let attempt = 0; attempt < 2 && !res; attempt++) {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 45000);
          try {
            res = await fetch(DEEPSEEK_API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
              body: JSON.stringify({
                model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
                max_tokens: 1500,
                stream: true,
                messages: [{ role: 'user', content: buildExplainPrompt(speech, master) }],
              }),
              signal: ctrl.signal,
            });
          } catch (e) {
            if (attempt === 0) continue; // 重试一次
            throw e;
          } finally {
            clearTimeout(timer);
          }
        }
        if (!res.ok || !res.body) {
          send({ error: `解释服务异常（${res.status}）` });
          controller.close();
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith('data:')) continue;
            const payload = t.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const j = JSON.parse(payload);
              const delta = j?.choices?.[0]?.delta?.content || '';
              if (delta) sendDelta(delta);
            } catch (e) { /* 忽略半行 */ }
          }
        }
        send({ done: true });
      } catch (e) {
        send({ error: sentAny ? '解释生成中断，可再次点击重试' : '解释生成失败，请稍后重试', partial: sentAny });
      } finally {
        try { controller.close(); } catch (e) { /* 已关闭 */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
