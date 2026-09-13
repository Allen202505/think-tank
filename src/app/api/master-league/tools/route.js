// GET/POST /api/master-league/tools
// 大师智能体「感知层」的调试入口：零 LLM 调用，直接看每个工具能取到什么数据。
//   GET  /api/master-league/tools                     → 列出全部工具与参数 Schema
//   GET  /api/master-league/tools?tool=get_market_overview
//   GET  /api/master-league/tools?tool=screen_stocks&industry=医药&minAmountYi=5
//   POST /api/master-league/tools  { "tool": "screen_stocks", "args": { ... } }
import { executeMasterLeagueTool, listMasterLeagueToolSchemas } from '../../../../lib/masterLeagueTools.mjs';
import { getClientIp, limitResponse, rateLimit } from '../../../../lib/rateLimit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ARG_KEYS = [
  'industry', 'keyword', 'code', 'days', 'minChangePct', 'maxChangePct',
  'minAmountYi', 'minTurnover', 'maxTurnover', 'minMarketCapYi', 'maxMarketCapYi',
  'minPe', 'maxPe', 'sortBy', 'order', 'limit',
];

function jsonResponse(payload, status = 200) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

function argsFromQuery(searchParams) {
  const args = {};
  for (const key of ARG_KEYS) {
    const raw = searchParams.get(key);
    if (raw == null || raw === '') continue;
    if (key === 'industry' || key === 'keyword' || key === 'code' || key === 'sortBy' || key === 'order') args[key] = raw;
    else {
      const n = Number(raw);
      if (Number.isFinite(n)) args[key] = n;
    }
  }
  const json = searchParams.get('args');
  if (json) {
    try {
      Object.assign(args, JSON.parse(json));
    } catch {
      throw new Error('args 不是合法 JSON');
    }
  }
  return args;
}

// 零 LLM：这里只暴露「工具能查到什么」，方便人工检查候选数据的质量。
async function runTool(tool, args) {
  const result = await executeMasterLeagueTool(tool, args, {});
  return { ok: true, tool, args, result };
}

export async function GET(request) {
  const limited = rateLimit(`master-league-tools:${getClientIp(request)}`, { limit: 60, windowMs: 60000 });
  if (!limited.ok) return limitResponse(limited.retryAfter);

  const { searchParams } = new URL(request.url);
  const tool = searchParams.get('tool');
  if (!tool) return jsonResponse({ ok: true, tools: listMasterLeagueToolSchemas() });

  try {
    const payload = await runTool(tool, argsFromQuery(searchParams));
    return jsonResponse(payload);
  } catch (error) {
    return jsonResponse({ ok: false, error: error?.message || '工具执行失败' }, 400);
  }
}

export async function POST(request) {
  const limited = rateLimit(`master-league-tools:${getClientIp(request)}`, { limit: 60, windowMs: 60000 });
  if (!limited.ok) return limitResponse(limited.retryAfter);

  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: '请求体不是合法 JSON' }, 400);
  }
  if (!body?.tool) return jsonResponse({ ok: false, error: '缺少 tool 参数' }, 400);

  try {
    const payload = await runTool(body.tool, body.args || {});
    return jsonResponse(payload);
  } catch (error) {
    return jsonResponse({ ok: false, error: error?.message || '工具执行失败' }, 400);
  }
}
