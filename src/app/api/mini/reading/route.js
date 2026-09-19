import { resolveAiConfig, callChatCompletion } from '../../../../lib/llm.js';
import { getClientIp, guardFreeDailyKey, limitResponse, quotaResponse, rateLimit } from '../../../../lib/rateLimit.js';
import {
  MINI_DISCLAIMER,
  buildMiniReadingMessages,
  normalizeReadingResult,
  validateMiniReading,
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
  const authorized = await authorizeMiniRequest(request, 'reading');
  if (!authorized.ok) return miniError(authorized.error, authorized.status);

  const identity = authorized.auth.identity || `ip:${getClientIp(request)}`;
  const rapid = rateLimit(`mini-reading:${identity}`, { limit: 6, windowMs: 60_000 });
  if (!rapid.ok) return limitResponse(rapid.retryAfter);

  const dailyLimit = getMiniDailyLimit();
  const daily = guardFreeDailyKey(identity, { limit: dailyLimit });
  if (!daily.ok) return quotaResponse(daily.retryAfter);

  const material = validateMiniReading(authorized.body?.text);
  if (!material.ok) return miniError(material.reason, 400);

  const messages = buildMiniReadingMessages(material.text);
  const cfg = resolveAiConfig();

  try {
    const raw = await callChatCompletion(cfg, messages, 2600);
    const data = normalizeReadingResult(raw);
    if (!data) return miniError('输出未通过内容安全检查，请换一段通识材料重试', 502);
    return miniJson({ ok: true, data, disclaimer: MINI_DISCLAIMER });
  } catch (error) {
    return miniError(friendlyMiniAiError(error), 502);
  }
}
