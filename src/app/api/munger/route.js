// src/app/api/munger/route.js
// 芒格教你读财报
// POST { mode: 'report', link|file|content, note } → 芒格深入浅出解读财报
// POST { mode: 'followup', question, report, prevContent } → 举手提问追加回答
import { spawn } from 'child_process';
import { SYSTEM_GUARD } from '../../../lib/security';
import { getClientIp, rateLimit, limitResponse } from '../../../lib/rateLimit';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { generateJson, extractContentFromRaw } from '../../../lib/ai';
import { masterProfileLine } from '../../../lib/prompts';
import { buildEarningsDataCard } from '../chat/earningsEngine.js';
import { findMasterById } from '../../../lib/breakfast';

// 用独立 Node 脚本解析 PDF 文本（绕开 webpack 打包环境的 worker 问题）
function extractPdfText(buf) {
  return new Promise((resolve, reject) => {
    const tmp = join(tmpdir(), `munger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`);
    writeFileSync(tmp, buf);
    const script = join(process.cwd(), 'scripts', 'extract-pdf.mjs');
    const child = spawn(process.execPath, [script, tmp], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      try { unlinkSync(tmp); } catch (e) { /* ignore */ }
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error(err.trim() || 'PDF 解析失败'));
    });
    child.on('error', (e) => {
      try { unlinkSync(tmp); } catch (e2) { /* ignore */ }
      reject(e);
    });
  });
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// 抓取财报链接正文：HTML 链接抽标题+正文文本；.pdf 链接下载后走脚本解析
async function fetchLinkText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/pdf,*/*' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`链接抓取失败（HTTP ${res.status}）`);
    const ct = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (/pdf/i.test(ct) || /\.pdf(\?|$)/i.test(url)) {
      return extractPdfText(buf);
    }
    const html = buf.toString('utf8');
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const body = (title.trim() ? `${title.trim()}\n` : '') + text;
    return body.slice(0, 6000);
  } catch (e) {
    throw new Error(`链接抓取失败：${e.message || e}`);
  } finally {
    clearTimeout(timer);
  }
}

function buildMessages(prompt, userAsk) {
  return [{ role: 'system', content: SYSTEM_GUARD }, { role: 'system', content: prompt }, { role: 'user', content: userAsk }];
}

export async function POST(request) {
  try {
  const _rl = rateLimit('munger:' + getClientIp(request), { limit: 30, windowMs: 60000 });
  if (!_rl.ok) return limitResponse(_rl.retryAfter);

    const body = await request.json();
    const mode = body.mode === 'followup' ? 'followup' : 'report';
    const munger = findMasterById('munger');
    if (!munger) return Response.json({ error: '芒格大师缺失' }, { status: 400 });

    // mode === 'report'：财报链接 或 附件上传，可带补充说明
    let reportText = typeof body.content === 'string' ? body.content.trim() : '';
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    try {
      if (!reportText && body.link) {
        reportText = await fetchLinkText(String(body.link).trim());
      } else if (!reportText && body.file) {
        // 附件解析：PDF 走独立脚本抽文本；txt/csv/md/json 直接按 UTF-8 读
        const buf = Buffer.from(String(body.file), 'base64');
        const ext = String(body.filename || '').split('.').pop().toLowerCase();
        reportText = ext === 'pdf' ? await extractPdfText(buf) : buf.toString('utf8').trim();
      }
    } catch (e) {
      return Response.json({ error: e.message || '附件/链接解析失败，请尝试直接粘贴文本' }, { status: 400 });
    }
    if (!reportText) return Response.json({ error: '请提供财报链接或上传附件' }, { status: 400 });
    if (note) reportText += `\n\n【补充说明】${note.slice(0, 2000)}`;

    // 系统数据核验卡：财报文本 → 识别公司 → 拉行情/财务历史/机构预期/研报（失败静默降级）
    let dataCard = null;
    try {
      const card = await buildEarningsDataCard(reportText);
      if (card && card.hasData) dataCard = card;
    } catch (e) { /* 降级：无数据卡也能正常解读 */ }
    const dataCardSection = dataCard
      ? `【系统数据核验卡】（来自实时行情/财务数据层，用于与财报文本交叉验证；仅当财报确实涉及 ${dataCard.stock && dataCard.stock.name ? dataCard.stock.name : '该公司'} 时使用，否则忽略）
${dataCard.text}
交叉验证要求：
- 财报文本与系统数据不一致时（如文本称净利增长 30%，系统数据显示实际增长 8%），必须明确指出差异并质疑。
- 结合收入质量（经营现金流/净利润）、业绩 vs 机构预期、机构评级情绪、财报节奏等硬指标点评利润含金量与"管理层说法"。
- 系统数据核验卡里没有的精确数字，仍按原规则不得编造。`
      : `（本次未获取到可核验的系统数据：财报文本未能识别出明确公司，或数据源暂不可用。请仅基于财报文本解读，并在存疑处明确标注"待验证"，不要编造数字。）`;

    const prompt = `你是 ${munger.name}（${munger.title}）。用户会给你一份财报（可能是文本，也可能是链接——若是链接请按可读到的正文理解）。请像芒格一样"深入浅出"地解读这份财报。

你的画像：
${masterProfileLine(munger)}

${dataCardSection}

解读要求（像讲课，不是写研究报告）：
1. 先一句话说出这份财报最该被记住的结论。
2. 用 3-4 段讲透：这份财报说明这家公司赚不赚钱、赚得干不干净、生意有没有护城河、有没有财务陷阱（应收/存货/现金流/负债/一次性收益等）。用大白话，可带生活比喻。
3. 明确指出 2-3 个"大多数人会看错或忽略"的点。
4. 最后给一句芒格式的提醒（反着想：什么情况下这份财报会骗你）。
5. 整体 400-600 字，分段（空行隔开），关键数字/结论可用 **加粗**（**…**）。不要用标题、编号列表。
6. content 直接就是解读正文，不要任何前缀、标签或标题（严禁出现「context：」「回答：」「解读：」等字样）。
7. followUps 必须是**完整的问句**（以「？」结尾、能直接提问），例如「应收账款快速增长的根本原因是什么？」「潜在的坏账风险有多大？」；不要用名词短语或陈述句。

只输出一个 JSON，不要输出任何其他内容：
{"content":"你的解读发言（分段、带加粗）","followUps":["完整的问句1？","完整的问句2？"]}
注意：所有引号用中文引号「」或“”，禁止英文双引号。`;
    const { raw, parsed } = await generateJson(buildMessages(prompt, `这份财报是：\n${reportText.slice(0, 6000)}`), '{"content":"解读","followUps":["追问1"]}', 2000, true, body.aiConfig);
    const normalized = parsed && typeof parsed.content === 'string' && parsed.content.trim() ? parsed : null;
    if (!normalized) {
      if (raw && raw.trim()) return Response.json({ ok: true, result: { mode: 'report', content: extractContentFromRaw(raw) || raw.trim(), followUps: [], dataCard: dataCard ? dataCard.text : null } });
      return Response.json({ error: 'AI 输出格式异常，请重试一次' }, { status: 502 });
    }
    const followUps = Array.isArray(normalized.followUps)
      ? normalized.followUps.filter((f) => typeof f === 'string' && f.trim()).slice(0, 3)
      : [];
    return Response.json({ ok: true, result: { mode: 'report', content: normalized.content.trim(), followUps, dataCard: dataCard ? dataCard.text : null } });
  } catch (e) {
    const isNet = e && (e.name === 'TypeError' || /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(String(e.message)));
    return Response.json({ error: isNet ? '连接 AI 服务失败（网络异常），请稍后重试' : (e.message || '服务器内部错误') }, { status: 500 });
  }
}
