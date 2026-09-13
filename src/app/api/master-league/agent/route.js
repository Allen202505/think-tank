// POST /api/master-league/agent  （GET 亦可，便于本地调试）
// 让一位大师跑一次完整决策：调工具 → 出计划。用于 Phase ③ 的人工验收。
//
// 成本与安全：
//  - 走服务端 DEEPSEEK_API_KEY，属于站长自付，因此默认只允许非生产环境调用；
//    生产环境需配置 MASTER_LEAGUE_AGENT_TOKEN 并在请求头带 x-agent-token。
//  - 单次运行的轮次/token 上限由 masterLeagueAgent 的 AGENT_LIMITS 硬性限制。
import { LEAGUE_MASTERS } from '../../../../data/masterLeague.js';
import { AGENT_LIMITS, getAgentLedger, runMasterAgent } from '../../../../lib/masterLeagueAgent.mjs';
import { resolveAiConfig } from '../../../../lib/llm.js';
import { getClientIp, limitResponse, rateLimit } from '../../../../lib/rateLimit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 120;

function jsonResponse(payload, status = 200) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

function authorize(request) {
  const expected = process.env.MASTER_LEAGUE_AGENT_TOKEN;
  if (expected) return request.headers.get('x-agent-token') === expected;
  // 没配 token 时，只允许非生产环境（本地/预览）使用
  return process.env.NODE_ENV !== 'production';
}

async function loadAccount(origin, masterId) {
  try {
    const response = await fetch(`${origin}/api/master-league`, { cache: 'no-store' });
    const payload = await response.json();
    const account = (payload?.data?.accounts || []).find((item) => item.id === masterId);
    if (account) return account;
  } catch {
    /* 取不到就用占位账户，至少能验证智能体链路 */
  }
  return { id: masterId, cash: 100000, totalAsset: 100000, profitRate: 0, positions: [], decisions: [] };
}

async function handle(request) {
  if (!authorize(request)) {
    return jsonResponse({ ok: false, error: '未授权：生产环境需配置 MASTER_LEAGUE_AGENT_TOKEN 并带上 x-agent-token' }, 401);
  }
  const limited = rateLimit(`master-league-agent:${getClientIp(request)}`, { limit: 6, windowMs: 60000 });
  if (!limited.ok) return limitResponse(limited.retryAfter);

  const { searchParams, origin } = new URL(request.url);
  let body = {};
  if (request.method === 'POST') {
    body = await request.json().catch(() => ({}));
  }
  const masterId = body.masterId || searchParams.get('master') || 'livermore';
  const master = LEAGUE_MASTERS.find((item) => item.id === masterId);
  if (!master) {
    return jsonResponse({ ok: false, error: `未找到大师 ${masterId}`, available: LEAGUE_MASTERS.map((item) => item.id) }, 400);
  }

  const aiConfig = resolveAiConfig(null);
  if (!aiConfig.apiKey) {
    return jsonResponse({ ok: false, error: '服务端未配置 DEEPSEEK_API_KEY，无法运行智能体' }, 400);
  }

  const date = body.date || searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const startedAt = Date.now();
  try {
    const account = await loadAccount(origin, masterId);
    const result = await runMasterAgent({
      master,
      account,
      date,
      aiConfig,
      marketNote: body.marketNote || '',
    });
    return jsonResponse({
      ok: true,
      durationMs: Date.now() - startedAt,
      limits: AGENT_LIMITS,
      result,
      ledger: getAgentLedger(),
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: error?.message || '智能体运行失败', durationMs: Date.now() - startedAt }, 500);
  }
}

export async function GET(request) {
  return handle(request);
}

export async function POST(request) {
  return handle(request);
}
