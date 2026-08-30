// 纳瓦尔的知识学堂 · 模块2：每日知识点历史期数
// GET → { ok, issues:[{issue_date, issue_label, title, quiz_question, source, created_at}] }
// GET ?date=YYYY-MM-DD → { ok, issue }（含完整 content）
import { listIssues, getIssue } from '../../../../lib/navalDb';

export async function GET(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date');
  if (date) {
    const r = await getIssue(date);
    if (!r.ok) return Response.json({ ok: false, local: true, error: r.error || null });
    return Response.json({ ok: true, issue: r.issue });
  }
  const r = await listIssues();
  if (!r.ok) return Response.json({ ok: false, local: true, error: r.error || null });
  return Response.json({ ok: true, issues: r.issues });
}
