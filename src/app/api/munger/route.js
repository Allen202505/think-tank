// src/app/api/munger/route.js
// 芒格教你读财报
// POST { mode: 'report', link|file|content, note } → 芒格深入浅出解读财报
// POST { mode: 'followup', question, report, prevContent } → 举手提问追加回答
import { SYSTEM_GUARD } from '../../../lib/security';
import { getClientIp, rateLimit, limitResponse, guardFreeDaily, quotaResponse } from '../../../lib/rateLimit';
import { generateJson, extractContentFromRaw } from '../../../lib/ai';
import { masterProfileLine } from '../../../lib/prompts';
import { extractPdfText } from '../../../lib/pdfText';

// 去掉 AI 把整段/整行用中文或英文引号首尾包起来的“包装引号”（只剥行首/行尾成对引号，不动正文内部的引号）
function stripWrappingQuotes(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim().replace(/^[“"‘\u201C\u201D]+/, '').replace(/[”"’\u201D\u201C]+$/, ''))
    .join('\n')
    .trim();
}
import { buildEarningsDataCard } from '../chat/earningsEngine.js';
import { buildAStockForensicEvidence, normalizeDiagnosis, buildFallbackDiagnosis } from '../chat/financialForensics.js';
import { findMasterById } from '../../../lib/breakfast';

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
    const _gq = guardFreeDaily(request, body.aiConfig, { limit: 40 });
    if (!_gq.ok) return quotaResponse(_gq.retryAfter);
    const mode = body.mode === 'followup' ? 'followup' : 'report';
    const munger = findMasterById('munger');
    if (!munger) return Response.json({ error: '芒格大师缺失' }, { status: 400 });

    // ── 举手提问 / 追问：基于之前的解读 + 财报原文，正面回答用户的具体问题 ──
    if (mode === 'followup') {
      const question = typeof body.question === 'string' ? body.question.trim() : '';
      const prevContent = typeof body.prevContent === 'string' ? body.prevContent.trim() : '';
      const report = typeof body.report === 'string' ? body.report.trim() : '';
      const diagnosis = body.diagnosis && typeof body.diagnosis === 'object' ? body.diagnosis : null;
      if (!question) return Response.json({ error: '缺少追问内容' }, { status: 400 });
      const diagnosisSection = diagnosis ? `\n一页纸财务诊断清单（继续排查时必须沿用）：\n${JSON.stringify(diagnosis).slice(0, 5000)}\n` : '';
      const prompt = `你是 ${munger.name}（${munger.title}）。用户追问你之前对这份财报的解读，请正面、深入回答这个具体问题。

你的画像：
${masterProfileLine(munger)}

你此前的解读：
${prevContent || '（暂无）'}
${diagnosisSection}

财报原文（节选）：
${report.slice(0, 4000) || '（未提供财报原文）'}

用户的追问：
${question}

要求：
1. 直接回答追问，250-400 字，给信息增量，不重复已说过的内容；引用数据用「大约/约/可能」等模糊表述，严禁编造。
2. 分段/换行：按逻辑分成 3-5 段，每段讲一个要点，段落之间用空行（\n\n）隔开；结论、风险提示、关键判断必须单独成段。严禁一长段。
3. content 直接就是回答正文，不要任何前缀、标签或标题（严禁出现「context：」「回答：」等字样）。
4. 只输出一个 JSON：{"content":"你的回答"}，不要 Markdown 代码块，所有引号用中文引号「」或“”；但不要用“”把整段回答/结论的首尾包起来，引号只在强调具体说法、术语或引用时使用。`;
      const { raw, parsed } = await generateJson(
        buildMessages(prompt, `追问：${question}`),
        '{"content":"你的回答"}',
        1200,
        true,
        body.aiConfig,
      );
      const normalized = parsed && typeof parsed.content === 'string' && parsed.content.trim() ? parsed : null;
      if (!normalized) {
        if (raw && raw.trim()) return Response.json({ ok: true, result: { mode: 'followup', content: stripWrappingQuotes(extractContentFromRaw(raw) || raw.trim()) } });
        return Response.json({ error: 'AI 输出格式异常，请重试一次' }, { status: 502 });
      }
      return Response.json({ ok: true, result: { mode: 'followup', content: stripWrappingQuotes(normalized.content.trim()) } });
    }

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

    // 财报侦查证据包与系统数据核验并行拉取；任一失败都不影响主流程。
    const [cardResult, forensicResult] = await Promise.all([
      buildEarningsDataCard(reportText).catch(() => null),
      buildAStockForensicEvidence(reportText).catch(() => null),
    ]);
    const dataCard = cardResult && cardResult.hasData ? cardResult : null;
    const forensic = forensicResult && forensicResult.hasData ? forensicResult : null;
    const dataCardSection = dataCard
      ? `【系统数据核验卡】（来自实时行情/财务数据层，用于与财报文本交叉验证；仅当财报确实涉及 ${dataCard.stock && dataCard.stock.name ? dataCard.stock.name : '该公司'} 时使用，否则忽略）
${dataCard.text}
交叉验证要求：
- 财报文本与系统数据不一致时（如文本称净利增长 30%，系统数据显示实际增长 8%），必须明确指出差异并质疑。
- 结合收入质量（经营现金流/净利润）、业绩 vs 机构预期、机构评级情绪、财报节奏等硬指标点评利润含金量与"管理层说法"。
- 系统数据核验卡里没有的精确数字，仍按原规则不得编造。`
      : `（本次未获取到可核验的系统数据：财报文本未能识别出明确公司，或数据源暂不可用。请仅基于财报文本解读，并在存疑处明确标注"待验证"，不要编造数字。）`;

    const forensicSection = forensic
      ? `【财报侦查诊断 Skill · A股证据包】
${forensic.evidenceText}

使用要求：
- 先按 Skill 完成问题排查，再基于排查结果写芒格解读；不要把证据包原样复述给用户。
- 只能使用上方证据包、系统数据核验卡和财报原文中的事实。证据不足必须写“数据不足”，禁止用印象补数字。
- 异常是风险信号，不是造假结论。必须分开“事实、可能原因、下一步验证”。
- 最终 diagnosis.rows 选 6-10 项，优先 P0；每项必须有证据来源。`
      : `（本次未取得 A 股财报侦查证据包。若财报涉及 A 股，diagnosis.rows 只保留能由财报原文直接支持的项目；其余标记为数据不足。）`;

    const prompt = `你是 ${munger.name}（${munger.title}）。用户会给你一份财报（可能是文本，也可能是链接——若是链接请按可读到的正文理解）。请像芒格一样"深入浅出"地解读这份财报。

你的画像：
${masterProfileLine(munger)}

${dataCardSection}

${forensicSection}

解读要求（像讲课，不是写研究报告）：
1. 先一句话说出这份财报最该被记住的结论。
2. 用 3-4 段讲透：这份财报说明这家公司赚不赚钱、赚得干不干净、生意有没有护城河、有没有财务陷阱（应收/存货/现金流/负债/一次性收益等）。用大白话，可带生活比喻。
3. 明确指出 2-3 个"大多数人会看错或忽略"的点。
4. 最后给一句芒格式的提醒（反着想：什么情况下这份财报会骗你）。
5. 整体 400-600 字，按逻辑分成 3-5 段（段落之间用空行隔开），结论/风险提示/关键判断单独成段，严禁一长段；关键数字/结论可用 **加粗**（**…**）。不要用标题、编号列表。
6. content 直接就是解读正文，不要任何前缀、标签或标题（严禁出现「context：」「回答：」「解读：」等字样）。
7. followUps 必须是**完整的问句**（以「？」结尾、能直接提问），例如「应收账款快速增长的根本原因是什么？」「潜在的坏账风险有多大？」；不要用名词短语或陈述句。

同时生成「一页纸财务诊断清单」。它必须回答：这家公司现在最值得关注什么、证据是什么、证据怎么理解、下一步去哪里查。按“侦查问题 → 关键证据 → 侦查判断 → 下一步核查”组织，不要写成指标罗列或财报摘要。
- 顶部自动提炼 3 条结论：coreContradiction（核心矛盾）、mainRisk（主要风险）、keyLead（值得继续追踪的积极/中性线索）。
- rows 数量 6-10 条，按 P0、P1、P2 排序；P0 优先控制在 2-3 条，P1 2-5 条，P2 1-3 条。优先级只代表调查顺序，不代表股票评级。
- question 必须是自然语言问题句，且能直接引出后面的证据与核查；不能把“经营现金流/净利润”“非经常性损益占比”这类指标名原样当问题。
- evidence 是 1-3 条事实，只放财报实际数据、趋势或原始口径，不放推理；数据不足就直接写“数据不足”，禁止猜测。
- judgment 只基于已经展示的 evidence，使用“可能/提示/需要继续核查”等谨慎表述；不得把异常直接写成造假、舞弊或暴雷结论。
- nextCheck 固定填 what/lookAt/judge 三步，分别对应“查什么 / 看什么 / 判断什么”；查不到附注时也要保留可执行的下一步。
- status 只能填 normal、watch、abnormal、high、insufficient，分别显示为“暂未发现明显异常、重点核查、异常信号、异常信号、数据不足”。颜色只用于信息分层。
- source 写三表、年报附注、审计报告或数据不足；不要编造附注编号和具体页码。
- topQuestions 必须正好 3 个完整问句，围绕本次最值得继续调查的问题。
- coverage 填三个整数：structured 表示已采用的结构化财务项数，filing 表示已采用的年报/附注项数，missing 表示明确数据缺口项数。

只输出一个 JSON，不要输出任何其他内容：
{"content":"你的解读发言（分段、带加粗）","followUps":["完整的问句1？","完整的问句2？"],"diagnosis":{"company":"公司名称（代码）","businessModel":"一句话经营模式","focus":["本期重点1","本期重点2"],"coreContradiction":"当前最值得理解的经营矛盾","mainRisk":"最需要继续验证的风险线索","keyLead":"值得继续追踪的积极或中性线索","rows":[{"priority":"P0","domain":"利润质量","question":"利润为什么没有变成现金？","evidence":["经营现金流为负","归母净利润为正","经营现金流/归母净利润约 -1.7"],"judgment":"利润与现金流明显背离，提示需要继续拆解应收、合同资产和存货，暂不能直接定性。","nextCheck":{"what":"查现金流量表附注、应收、合同资产和存货","lookAt":"看销售商品收现与营收、净利润的匹配度","judge":"判断利润主要卡在应收、合同资产还是存货"},"status":"watch","source":"三表 / 年报附注"}],"topQuestions":["问题1？","问题2？","问题3？"],"coverage":{"structured":0,"filing":0,"missing":0},"asOf":"2025年报"}}
注意：JSON 的结构引号按 JSON 语法使用英文双引号；JSON 字符串内容中的引号使用中文引号「」或“”。`;
    const { raw, parsed } = await generateJson(buildMessages(prompt, `这份财报是：\n${reportText.slice(0, 9000)}`), '{"content":"解读","followUps":["追问1"],"diagnosis":{"rows":[],"topQuestions":[]}}', 3400, true, body.aiConfig);
    const normalized = parsed && typeof parsed.content === 'string' && parsed.content.trim() ? parsed : null;
    if (!normalized) {
      if (raw && raw.trim()) return Response.json({ ok: true, result: { mode: 'report', content: stripWrappingQuotes(extractContentFromRaw(raw) || raw.trim()), followUps: [], dataCard: dataCard ? dataCard.text : null, diagnosis: buildFallbackDiagnosis(forensic) } });
      return Response.json({ error: 'AI 输出格式异常，请重试一次' }, { status: 502 });
    }
    const followUps = Array.isArray(normalized.followUps)
      ? normalized.followUps.filter((f) => typeof f === 'string' && f.trim()).slice(0, 3)
      : [];
    const diagnosis = normalizeDiagnosis(normalized.diagnosis, forensic);
    return Response.json({ ok: true, result: { mode: 'report', content: stripWrappingQuotes(normalized.content.trim()), followUps, dataCard: dataCard ? dataCard.text : null, diagnosis } });
  } catch (e) {
    const isNet = e && (e.name === 'TypeError' || /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(String(e.message)));
    return Response.json({ error: isNet ? '连接 AI 服务失败（网络异常），请稍后重试' : (e.message || '服务器内部错误') }, { status: 500 });
  }
}
