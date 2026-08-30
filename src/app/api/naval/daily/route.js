// 纳瓦尔的知识学堂 · 模块2：每日知识点生成
// POST { aiConfig? } → { ok, issue, existed?, local? }
// 今日已生成则直接返回；否则按「每日投资知识点」规则生成并落库（今日唯一）。
import { generateJson, extractJson } from '../../../../lib/ai';
import { SYSTEM_GUARD } from '../../../../lib/security';
import { getClientIp, rateLimit, limitResponse } from '../../../../lib/rateLimit';
import { buildDailyPrompt } from '../../../../lib/navalPrompts';
import {
  navalDbEnabled,
  shanghaiToday,
  getIssue,
  insertIssue,
  listIssues,
  allCoveredTopics,
} from '../../../../lib/navalDb';

function normalizeIssue(d, today, todayLabel) {
  return {
    issue_date: today,
    issue_label: todayLabel,
    title: String(d.title || '今日知识点').trim(),
    content: String(d.content || '').trim(),
    quiz_question: String(d.quizQuestion || '').trim(),
    quiz_answer: String(d.quizAnswer || '').trim(),
    covered_topics: Array.isArray(d.coveredTopics)
      ? d.coveredTopics.filter((x) => typeof x === 'string' && x.trim()).slice(0, 10)
      : [],
    source: 'generated',
  };
}

export async function POST(request) {
  const rl = rateLimit('naval:daily:' + getClientIp(request), { limit: 10, windowMs: 60000 });
  if (!rl.ok) return limitResponse(rl.retryAfter);

  let body = {};
  try { body = await request.json(); } catch (e) { /* ignore */ }

  const today = shanghaiToday();
  const todayLabel = `第${today.replace(/-/g, '/')}期`;

  try {
    // 今日已生成 → 直接返回，不重复消耗
    const exist = await getIssue(today);
    if (exist.ok && exist.issue) {
      return Response.json({ ok: true, issue: exist.issue, existed: true, local: false });
    }

    // 上一期（用于开头揭晓答案）
    const prevList = await listIssues();
    const prev = (prevList.ok && prevList.issues && prevList.issues[0]) || null;
    let prevDetail = null;
    if (prev && prev.issue_date !== today) {
      const pd = await getIssue(prev.issue_date);
      if (pd.ok && pd.issue) prevDetail = pd.issue;
    }

    const covered = await allCoveredTopics();
    const prompt = buildDailyPrompt(todayLabel, prevDetail, covered);
    const { raw, parsed } = await generateJson(
      [
        { role: 'system', content: SYSTEM_GUARD },
        { role: 'system', content: prompt },
        { role: 'user', content: `请生成今天（${todayLabel}）的每日投资知识点。` },
      ],
      '{"title":"主题","content":"正文","quizQuestion":"题目","quizAnswer":"参考思路","coveredTopics":["指标1","指标2","指标3"]}',
      2800,
      true,
      body.aiConfig,
    );

    const d = parsed && typeof parsed.content === 'string' && parsed.content.trim() ? parsed : null;
    let issue = null;
    if (d) {
      issue = normalizeIssue(d, today, todayLabel);
    } else {
      // 二次兜底：模型可能把内层 JSON 整体塞进 content 字符串
      const inner = extractJson(raw);
      if (inner && typeof inner.content === 'string' && inner.content.trim()) {
        issue = normalizeIssue(inner, today, todayLabel);
      }
    }
    if (!issue) {
      return Response.json({ error: 'AI 输出格式异常，请重试一次' }, { status: 502 });
    }

    // 落库（RLS 仅允许当天写入；失败不阻断，前端本地兜底）
    const ins = await insertIssue(issue);
    return Response.json({ ok: true, issue, existed: false, local: !ins.ok });
  } catch (e) {
    const isNet = e && (e.name === 'TypeError' || /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(String(e.message)));
    return Response.json(
      { error: isNet ? '连接 AI 服务失败（网络异常），请稍后重试' : (e.message || '服务器内部错误') },
      { status: 500 },
    );
  }
}
