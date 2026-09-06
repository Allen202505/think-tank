// 纳瓦尔的知识学堂 · 模块1：知识点提问
// POST { query: '要搞懂的知识点', aiConfig? } → { ok, result: { content, keyPoint, followUps } }
import { generateJson, extractContentFromRaw } from '../../../../lib/ai';
import { SYSTEM_GUARD } from '../../../../lib/security';
import { getClientIp, rateLimit, limitResponse, guardFreeDaily, quotaResponse } from '../../../../lib/rateLimit';
import { buildAskPrompt } from '../../../../lib/navalPrompts';
// 兜底：AI 未填 formula 字段时，从讲解正文里抽取含“公式/计算”的一行
function extractFormulaFromContent(content) {
  const text = String(content || '');
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const isFormula = (s) => /[=＝]/.test(s) && /[÷×*/\-+%]/.test(s) && s.length <= 90;
  // 1) 含“公式/机制”关键词或“=且带运算符”的行
  for (const line of lines) {
    if (/公式|机制|计算方式|=|＝/.test(line) && isFormula(line)) return line;
    if (isFormula(line)) return line;
  }
  // 2) 按句号/分号切出含“=且带运算符”的短句
  for (const seg of text.split(/[。；;]/)) {
    const t = seg.trim();
    if (isFormula(t) && t.length <= 120) return t;
  }
  return '';
}



export async function POST(request) {
  const rl = rateLimit('naval:ask:' + getClientIp(request), { limit: 30, windowMs: 60000 });
  if (!rl.ok) return limitResponse(rl.retryAfter);

  let body;
  try { body = await request.json(); } catch (e) { return Response.json({ error: '请求格式错误' }, { status: 400 }); }
    const _gq = guardFreeDaily(request, body.aiConfig, { limit: 40 });
    if (!_gq.ok) return quotaResponse(_gq.retryAfter);
  const query = String(body.query || '').trim();
  const context = typeof body.context === 'string' ? body.context.trim().slice(0, 1500) : '';
  if (!query) return Response.json({ error: '请输入你的投资/财务问题' }, { status: 400 });
  if (query.length > 300) return Response.json({ error: '问题过长，请精简到 300 字以内' }, { status: 400 });

  try {
    const { raw, parsed } = await generateJson(
      [
        { role: 'system', content: SYSTEM_GUARD },
        { role: 'system', content: buildAskPrompt(query, context) },
        { role: 'user', content: `请讲解：${query}` },
      ],
      '{"content":"讲解正文","keyPoint":"一句话核心","formula":"核心计算公式（无则为空）","followUps":["追问1","追问2"]}',
      1400,
      true,
      body.aiConfig,
    );
    const c = parsed && typeof parsed.content === 'string' && parsed.content.trim() ? parsed : null;
    if (!c) {
      const fallback = extractContentFromRaw(raw);
      if (fallback) return Response.json({ ok: true, result: { content: fallback, keyPoint: '', followUps: [] } });
      return Response.json({ error: 'AI 输出格式异常，请重试一次' }, { status: 502 });
    }
    let final = c;
    // 回答过短（常是模型偷懒只给一两句定义）→ 追加“扩写”指令重试一次，取更长者
    if (final.content.trim().length < 200) {
      try {
        const { parsed: parsed2 } = await generateJson(
          [
            { role: 'system', content: SYSTEM_GUARD },
            { role: 'system', content: buildAskPrompt(query, context) },
            { role: 'user', content: `请讲解：${query}` },
            { role: 'assistant', content: String(final.content || '') },
            { role: 'user', content: '上面的回答太简短。请严格按 350-550 字把这个问题展开成完整小专题（直觉比喻→机制/公式→具体例子→深层洞察→场景与局限），逐段写清楚，不要只给定义句。' },
          ],
          '{"content":"讲解正文","keyPoint":"一句话核心","formula":"核心计算公式（无则为空）","followUps":["追问1","追问2"]}',
          1600,
          true,
          body.aiConfig,
        );
        const c2 = parsed2 && typeof parsed2.content === 'string' && parsed2.content.trim() ? parsed2 : null;
        if (c2 && c2.content.trim().length > final.content.trim().length) final = c2;
      } catch (e) { /* 扩写失败则保留原回答 */ }
    }
    const followUps = Array.isArray(final.followUps)
      ? final.followUps.filter((f) => typeof f === 'string' && f.trim()).slice(0, 3)
      : [];
    return Response.json({
      ok: true,
      result: {
        content: final.content.trim(),
        keyPoint: String(final.keyPoint || '').trim(),
        formula: String(final.formula || '').trim() || extractFormulaFromContent(final.content),
        followUps,
      },
    });
  } catch (e) {
    const isNet = e && (e.name === 'TypeError' || /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(String(e.message)));
    return Response.json(
      { error: isNet ? '连接 AI 服务失败（网络异常），请稍后重试' : (e.message || '服务器内部错误') },
      { status: 500 },
    );
  }
}
