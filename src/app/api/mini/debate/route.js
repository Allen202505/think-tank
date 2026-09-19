import { resolveAiConfig, callChatCompletion } from '../../../../lib/llm.js';
import { getClientIp, guardFreeDailyKey, limitResponse, quotaResponse, rateLimit } from '../../../../lib/rateLimit.js';
import {
  MINI_DISCLAIMER,
  MINI_PERSPECTIVES,
  buildMiniDebateMessages,
  normalizeDebateResult,
  pickMiniPerspectives,
  validateMiniQuestion,
} from '../../../../lib/miniProgramPolicy.js';
import {
  authorizeMiniRequest,
  friendlyMiniAiError,
  getMiniDailyLimit,
  miniError,
  miniJson,
} from '../../../../lib/miniProgramApi.js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const authorized = await authorizeMiniRequest(request, 'debate');
  if (!authorized.ok) return miniError(authorized.error, authorized.status);

  const identity = authorized.auth.identity || `ip:${getClientIp(request)}`;
  const rapid = rateLimit(`mini-debate:${identity}`, { limit: 6, windowMs: 60_000 });
  if (!rapid.ok) return limitResponse(rapid.retryAfter);

  const dailyLimit = getMiniDailyLimit();
  const daily = guardFreeDailyKey(identity, { limit: dailyLimit });
  if (!daily.ok) return quotaResponse(daily.retryAfter);

  const question = validateMiniQuestion(authorized.body?.question);
  if (!question.ok) return miniError(question.reason, 400);

  const perspectiveIds = pickMiniPerspectives(authorized.body?.perspectives);
  const messages = buildMiniDebateMessages(question.text, perspectiveIds);
  const cfg = resolveAiConfig();

  try {
    const raw = await callChatCompletion(cfg, messages, 2200);
    const data = normalizeDebateResult(raw, perspectiveIds);
    if (!data) return miniError('输出未通过内容安全检查，请换个通识问题重试', 502);

    const selected = MINI_PERSPECTIVES.filter((item) => perspectiveIds.includes(item.id)).map((item) => ({
      id: item.id,
      label: item.label,
      subtitle: item.subtitle,
    }));

    return miniJson({ ok: true, data, perspectives: selected, disclaimer: MINI_DISCLAIMER });
  } catch (error) {
    return miniError(friendlyMiniAiError(error), 502);
  }
}
