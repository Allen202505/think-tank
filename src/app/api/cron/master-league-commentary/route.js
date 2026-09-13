// 收盘定时任务：每个交易日 15:35（北京时间）自动生成六位大师的 AI 互评并落库。
//   Vercel Cron 会带上 Authorization: Bearer $CRON_SECRET
//   本地/预览：非生产环境可直接调用，方便手动测试
//
// 只在「今天确实是交易日」时执行：用最新交易日（上证指数最后一根日线）与今天比对，
// 周末或节假日直接跳过，避免白白调用模型。
import { fetchLatestTradeDate } from '../../../../lib/marketSnapshot.mjs';
import { isWeekendDate, runCommentaryJob, todayShanghai } from '../../../../lib/masterLeagueCommentaryJob.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

function jsonResponse(payload, status = 200) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

function authorize(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    return request.headers.get('authorization') === `Bearer ${secret}`;
  }
  // 本地/预览没有配 CRON_SECRET 时允许直接触发，方便测试
  return process.env.NODE_ENV !== 'production';
}

export async function GET(request) {
  if (!authorize(request)) return jsonResponse({ ok: false, error: '未授权' }, 401);

  const { origin } = new URL(request.url);
  const date = todayShanghai();

  // 周末直接跳过，不必依赖行情源（行情源抖动时也能挡住白花钱）
  if (isWeekendDate(date)) {
    return jsonResponse({ ok: true, skipped: true, reason: '周末不开市', date });
  }

  let tradeDate = '';
  try {
    tradeDate = await fetchLatestTradeDate();
  } catch {
    tradeDate = '';
  }
  if (tradeDate && tradeDate !== date) {
    return jsonResponse({ ok: true, skipped: true, reason: `今天不是交易日（最新交易日 ${tradeDate}）`, date });
  }

  const result = await runCommentaryJob({ origin, date, masterIds: [], force: false });
  return jsonResponse({ ...result, tradeDate }, result.ok ? 200 : 400);
}
