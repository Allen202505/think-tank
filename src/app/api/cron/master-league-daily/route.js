// 收盘每日任务：先让六位大师各自生成下一交易日计划，再基于这些真实操作生成互评。
// 顺序很重要 —— 互评要点评「今天的新操作」，所以决策必须先跑完。
//   Vercel Cron 会带 Authorization: Bearer $CRON_SECRET；本地/预览可直接调用。
import { isWeekendDate, todayShanghai } from '../../../../lib/masterLeagueCommentaryJob.js';
import { runDecisionJob } from '../../../../lib/masterLeagueDecisionJob.js';
import { runCommentaryJob } from '../../../../lib/masterLeagueCommentaryJob.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

function jsonResponse(payload, status = 200) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

function authorize(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) return request.headers.get('authorization') === `Bearer ${secret}`;
  return process.env.NODE_ENV !== 'production';
}

export async function GET(request) {
  if (!authorize(request)) return jsonResponse({ ok: false, error: '未授权' }, 401);

  const { origin, searchParams } = new URL(request.url);
  const date = searchParams.get('date') || todayShanghai();
  if (isWeekendDate(date)) {
    return jsonResponse({ ok: true, skipped: true, reason: '周末不开市', date });
  }

  const force = searchParams.get('force') === '1';
  // 调试用：?master=livermore 只跑一位；?skipCommentary=1 只跑决策
  const masterIds = searchParams.get('master') ? searchParams.get('master').split(',').map((item) => item.trim()).filter(Boolean) : [];
  const skipCommentary = searchParams.get('skipCommentary') === '1';

  // 1) 先生成决策（失败不阻断互评：互评还会用当天已有操作或预置文案兜底）
  const decisions = await runDecisionJob({ origin, date, masterIds, force });
  const decisionsByMaster = Object.fromEntries(
    (decisions.results || [])
      .filter((item) => item.ok && item.decisions?.length)
      .map((item) => [item.masterId, item.decisions]),
  );
  // 2) 再生成互评
  const commentary = skipCommentary
    ? { ok: true, skipped: true, spent: 0, results: [] }
    : await runCommentaryJob({ origin, date, force, masterIds, decisionsByMaster });

  return jsonResponse({
    ok: Boolean(decisions.ok || commentary.ok),
    date,
    steps: {
      decisions: {
        ok: decisions.ok,
        skipped: decisions.skipped || false,
        reason: decisions.reason,
        executeDate: decisions.executeDate,
        spent: decisions.spent,
        masters: (decisions.results || []).map((item) => ({ masterId: item.masterId, ok: item.ok, actions: item.decisions?.length || 0, error: item.error, persistence: item.persistence, cost: item.usage?.cost })),
      },
      commentary: {
        ok: commentary.ok,
        spent: commentary.spent,
        masters: (commentary.results || []).map((item) => ({ masterId: item.masterId, ok: item.ok, comments: item.comments?.length || 0 })),
      },
    },
    totalSpent: Math.round(((decisions.spent || 0) + (commentary.spent || 0)) * 1e6) / 1e6,
    ledger: commentary.ledger || decisions.ledger,
  }, 200);
}
