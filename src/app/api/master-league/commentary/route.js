// 大师互评「AI 现场生成」入口。
//   GET  /api/master-league/commentary?master=livermore[&date=YYYY-MM-DD]  → 只读（数据库 → 内存缓存），不花钱
//   POST /api/master-league/commentary  {master|all:true, date?, force?}   → 生成并落库（花钱，需授权）
//
// 页面永远只走 GET；生成交给收盘定时任务或站长手动触发，避免访客刷新把账单刷上去。
import { LEAGUE_MASTERS } from '../../../../data/masterLeague.js';
import { COMMENT_LIMITS, readCommentaryCache } from '../../../../lib/masterLeagueCommentary.mjs';
import { loadCommentaryFromDb } from '../../../../lib/masterLeagueCommentaryDb.js';
import { runCommentaryJob, todayShanghai } from '../../../../lib/masterLeagueCommentaryJob.js';
import { getClientIp, limitResponse, rateLimit } from '../../../../lib/rateLimit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 120;

function jsonResponse(payload, status = 200) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function authorizeCronOrAdmin(request) {
  const expected = process.env.MASTER_LEAGUE_AGENT_TOKEN;
  if (expected) return request.headers.get('x-agent-token') === expected;
  return process.env.NODE_ENV !== 'production';
}

// 读库加超时保护：数据库/网络抖动时不让页面干等，直接回退内存缓存与预置点评
function withTimeout(promise, ms = 5000) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]).catch(() => null);
}

export async function GET(request) {
  const limited = rateLimit(`master-league-commentary:${getClientIp(request)}`, { limit: 90, windowMs: 60000 });
  if (!limited.ok) return limitResponse(limited.retryAfter);

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || todayShanghai();
  const masterId = searchParams.get('master');

  if (!masterId) {
    const stored = await withTimeout(loadCommentaryFromDb(date));
    const byMaster = Object.fromEntries(LEAGUE_MASTERS.map((master) => [
      master.id,
      stored?.[master.id]?.comments || readCommentaryCache(date, master.id)?.comments || [],
    ]));
    return jsonResponse({ ok: true, date, commentary: byMaster });
  }

  // 优先级：数据库（重启不丢）→ 进程内存 → 空（前端回退预置文案）
  const fromDb = await withTimeout(loadCommentaryFromDb(date, masterId));
  if (fromDb?.comments?.length) {
    return jsonResponse({ ok: true, date, masterId, cached: true, source: 'database', comments: fromDb.comments, usage: fromDb.usage || null });
  }
  const fromMemory = readCommentaryCache(date, masterId);
  return jsonResponse({
    ok: true,
    date,
    masterId,
    cached: Boolean(fromMemory),
    source: fromMemory ? 'memory' : 'none',
    comments: fromMemory?.comments || [],
    usage: fromMemory?.usage || null,
  });
}

export async function POST(request) {
  if (!authorizeCronOrAdmin(request)) {
    return jsonResponse({ ok: false, error: '未授权：生产环境需配置 MASTER_LEAGUE_AGENT_TOKEN 并带 x-agent-token' }, 401);
  }
  const limited = rateLimit(`master-league-commentary-gen:${getClientIp(request)}`, { limit: 12, windowMs: 60000 });
  if (!limited.ok) return limitResponse(limited.retryAfter);

  const { origin } = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const date = body.date || todayShanghai();
  const masterIds = body.all ? [] : [body.master || 'livermore'];
  const result = await runCommentaryJob({ origin, date, masterIds, force: Boolean(body.force) });
  return jsonResponse({ limits: COMMENT_LIMITS, ...result }, result.ok ? 200 : 400);
}
