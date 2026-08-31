// src/app/api/chat/route.js
// 后端代理：前端 → Next.js API Route → DeepSeek API（解决 CORS）
// 支持传入 query：拉取最新行情注入 prompt，让专家引用实时数据

import { getQuoteContext } from './quoteContext.js';
import { getClientIp, rateLimit, limitResponse, guardFreeDaily, quotaResponse } from '../../../lib/rateLimit';
import { SYSTEM_GUARD } from '../../../lib/security';
import { resolveAiConfig, buildProviderHeaders, buildProviderBody, resolveLlmUrl } from '../../../lib/llm.js';

export async function POST(request) {
  try {
  const _rl = rateLimit('chat:' + getClientIp(request), { limit: 40, windowMs: 60000 });
  if (!_rl.ok) return limitResponse(_rl.retryAfter);

    const body = await request.json();
    const _gq = guardFreeDaily(request, body.aiConfig, { limit: 40 });
    if (!_gq.ok) return quotaResponse(_gq.retryAfter);
    const aiCfg = resolveAiConfig(body.aiConfig);

    if (!aiCfg.apiKey) {
      return Response.json(
        { error: '未配置 API Key，请在设置中填写' },
        { status: 500 }
      );
    }

    let messages = Array.isArray(body.messages) ? [...body.messages] : [];
    messages = [{ role: 'system', content: SYSTEM_GUARD }, ...messages];

    // 信息层梳理：优先使用前端已生成的最新数据快照；否则按 query 现拉
    const userQuery = body.query || body.userQuery || '';
    const providedSnapshot = typeof body.snapshot === 'string' ? body.snapshot : '';
    const quoteText = providedSnapshot || (await getQuoteContext(userQuery).catch(() => ''));
    if (quoteText && messages.length > 0) {
      messages = [
        { role: 'user', content: quoteText },
        { role: 'assistant', content: '我已收到参考数据，将基于这些最新数据参与讨论。' },
        ...messages,
      ];
    }

    // 网络偶发抖动时重试一次；带 60s 超时，避免挂死
    const url = resolveLlmUrl(aiCfg.baseUrl);
    const callDeepSeek = () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60000);
      return fetch(url, {
        method: 'POST',
        headers: buildProviderHeaders(aiCfg),
        body: JSON.stringify(buildProviderBody(aiCfg, messages, 8192)),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
    };
    let response;
    try {
      response = await callDeepSeek();
    } catch (e) {
      response = await callDeepSeek();
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const message = err?.error?.message || err?.message || `模型服务错误: ${response.status}`;
      return Response.json({ error: message }, { status: response.status });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';

    // 返回与前端约定格式一致：content 数组，每项含 text
    return Response.json({ content: [{ text: content }] });
  } catch (e) {
    const isNet = e && (e.name === 'TypeError' || /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(String(e.message)));
    return Response.json(
      { error: isNet ? '连接 AI 服务失败（网络异常），请稍后重试' : (e.message || '服务器内部错误') },
      { status: 500 },
    );
  }
}
