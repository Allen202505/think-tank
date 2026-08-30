// 生成「纳瓦尔的知识学堂 · 每日知识点」历史期数种子 SQL
// 数据源：Codex 自动化「每日投资知识点」(automation-2) 的存档 outputs/*.md + memory.md 里的测验答案
// 用法：node scripts/build-naval-seed.mjs  → 覆盖输出 supabase/seed_naval_issues.sql
// 之后在 Supabase SQL Editor 里先跑 schema.sql（建表），再跑本种子文件即可导入历史。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const home = os.homedir();
const codexRoot = path.join(home, 'Documents', 'Codex');
const memFile = path.join(home, '.codex', 'automations', 'automation-2', 'memory.md');
const outFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'seed_naval_issues.sql');

const sq = (s) => String(s ?? '').replace(/'/g, "''");

function cleanTopic(t) {
  let s = String(t || '').trim()
    .replace(/^[一二三四五六七八九十]+[、.．]\s*/, '')
    .replace(/^[*\s]+|[*\s]+$/g, '')
    .replace(/[—\-–].*$/, '')
    .trim();
  return s;
}

function cleanTitle(s) {
  return String(s || '')
    .replace(/\*\*/g, '')
    .split(/[。！？]/)[0]
    .split('——')[0]
    .trim()
    .slice(0, 40);
}

function extractTitle(content) {
  let m = content.match(/今日主题\s*[:：]\s*([^\n]{2,60})/);
  if (m) return cleanTitle(m[1]);
  m = content.match(/【今日主题】\s*([^\n]{2,60})/);
  if (m) return cleanTitle(m[1]);
  m = content.match(/^主题\s*[:：]\s*([^\n]{2,60})/m);
  if (m) return cleanTitle(m[1]);
  // 形如「每日投资知识点 · 8月15日｜资产视角的估值」：取 ｜ 之后
  m = content.match(/^每日(投资)?知识点\s*[·｜|]?\s*[^\n]{0,20}[｜|]\s*([^\n]{2,40})/m);
  if (m) return cleanTitle(m[2]);
  const head = content.match(/^#\s+([^\n]{2,60})/m);
  if (head) {
    let h = head[1].replace(/\*\*/g, '');
    h = h.replace(/^(?:每日(投资)?知识点|每日知识点)\s*[·｜|]?\s*\d{4}-\d{2}-\d{2}\s*[·｜|]?\s*/, '');
    h = h.replace(/^(?:每日(投资)?知识点|每日知识点)（[^）]*）[｜|]\s*/, '');
    h = h.replace(/^\d{4}-\d{2}-\d{2}\s*(?:每日(投资)?知识点|每日知识点)?\s*[·｜|]?\s*/, '');
    h = h.replace(/^(?:每日(投资)?知识点|每日知识点)\s*[·：:｜|]?\s*/, '');
    const t = cleanTitle(h);
    if (t) return t;
  }
  // 兜底：第一个 ## 小节标题（早期单指标格式）
  const sub = content.match(/^##\s+([^\n]{2,40})/m);
  if (sub) return cleanTitle(sub[1]);
  return '';
}

function extractQuizQuestion(content) {
  const idx = content.search(/小测验/);
  if (idx < 0) return '';
  let rest = content.slice(idx + 3);
  rest = rest.replace(/^[（(]?答案[下后]期揭晓[）)]?\s*[:：]?\s*/, '').trim();
  const lines = rest.split('\n').map((s) => s.trim()).filter(Boolean);
  let q = '';
  for (const ln of lines) {
    if (/^(答案|参考|【|##)/.test(ln)) break;
    q += ln.replace(/^\**题目\**\s*[:：]?\s*/, '') + ' ';
    if (q.length > 180) break;
  }
  return q.trim();
}

function extractTopics(content) {
  const topics = [];
  const labelRe = /^(一句话核心|关键公式|深度洞察|适用场景|缺陷与例外|核心|公式|洞察|适用|缺陷|导语|上期|今日主题|小测验)/;
  const push = (t) => {
    const c = cleanTopic(t);
    if (c && c.length >= 2 && c.length <= 40 && !labelRe.test(c) && !/[:：]/.test(c)) topics.push(c);
  };
  // ① 标题（含 **① ...** 与 【① ...】 两种）
  for (const m of content.matchAll(/^(?:\*\*|【)?\s*[①②③④⑤]\s*([^\n】]{2,40})/gm)) push(m[1]);
  // 1） / 1｜ / **1）** 标题（排除 "1）一句话核心：…" 这类小节说明）
  for (const m of content.matchAll(/^(\*\*)?\s*\d+\s*[）|｜)\s]\s*\*?([^\n]{2,40})/gm)) push(m[2]);
  // 一、/ 二、 标题
  for (const m of content.matchAll(/^[一二三四五六七八九十]+[、.]\s*([^\n]{2,40})/gm)) push(m[1]);
  // ## 小节标题
  for (const m of content.matchAll(/^##\s+([^\n]{2,40})/gm)) push(m[1]);
  return [...new Set(topics)];
}

// 从 memory.md 提取每期测验的参考答案（"…→ 参考思路/参考答案：…"）
async function readQuizAnswers() {
  const map = {};
  let mem = '';
  try { mem = await fs.readFile(memFile, 'utf8'); } catch (e) { return map; }
  const blocks = mem.split(/^##\s+/m).slice(1);
  for (const b of blocks) {
    const date = (b.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1];
    if (!date) continue;
    for (const ln of b.split('\n')) {
      if (ln.includes('小测验') && ln.includes('参考')) {
        const i = ln.indexOf('参考');
        const ans = ln.slice(i).replace(/^参考(思路|答案)?\s*[:：]?\s*/, '').trim();
        if (ans) map[date] = ans;
        break;
      }
    }
  }
  return map;
}

async function collectIssueFiles() {
  const files = [];
  const dirs = [];
  try { dirs.push(...(await fs.readdir(codexRoot)).map((d) => path.join(codexRoot, d))); } catch (e) { /* ignore */ }
  for (const day of dirs) {
    const runDirs = await fs.readdir(day).catch(() => []);
    for (const run of runDirs) {
      const outDir = path.join(day, run, 'outputs');
      const names = await fs.readdir(outDir).catch(() => []);
      for (const n of names) {
        if (!/^\d{4}-\d{2}-\d{2}-.*\.md$/.test(n)) continue;
        files.push(path.join(outDir, n));
      }
    }
  }
  // 按日期排序
  return files.sort();
}

const isIssue = (content) => /小测验|上期答案|今日主题|# 每日投资知识点|# 每日知识点|试运行（3 指标）/.test(content);

const quizAnswers = await readQuizAnswers();
const files = await collectIssueFiles();
const rows = [];

for (const f of files) {
  let content = '';
  try { content = await fs.readFile(f, 'utf8'); } catch (e) { continue; }
  if (!isIssue(content)) continue;
  const date = (path.basename(f).match(/^(\d{4}-\d{2}-\d{2})/) || [])[1];
  if (!date) continue;
  const title = extractTitle(content);
  const quizQuestion = extractQuizQuestion(content);
  const quizAnswer = quizAnswers[date] || '';
  const topics = extractTopics(content);
  rows.push({ date, label: `第${date.replace(/-/g, '/')}期`, title, content: content.trim(), quizQuestion, quizAnswer, topics });
}

rows.sort((a, b) => a.date.localeCompare(b.date));

const lines = [];
lines.push('-- 纳瓦尔的知识学堂 · 每日知识点历史期数种子（由 scripts/build-naval-seed.mjs 生成）');
lines.push('-- 用法：先跑 supabase/schema.sql 建表，再在本文件在 Supabase SQL Editor 中运行。');
lines.push('-- 覆盖策略：ON CONFLICT (issue_date) DO UPDATE，可重复执行。');
lines.push('');
for (const r of rows) {
  lines.push(`insert into public.daily_knowledge_issues (issue_date, issue_label, title, content, quiz_question, quiz_answer, covered_topics, source)`);
  lines.push(`values ('${r.date}', '${sq(r.label)}', ${r.title ? `'${sq(r.title)}'` : "''"}, '${sq(r.content)}', ${r.quizQuestion ? `'${sq(r.quizQuestion)}'` : 'null'}, ${r.quizAnswer ? `'${sq(r.quizAnswer)}'` : 'null'}, '${JSON.stringify(r.topics).replace(/'/g, "''")}'::jsonb, 'seed')`);
  lines.push(`on conflict (issue_date) do update set title = excluded.title, content = excluded.content, quiz_question = excluded.quiz_question, quiz_answer = excluded.quiz_answer, covered_topics = excluded.covered_topics, source = excluded.source;`);
  lines.push('');
}

await fs.writeFile(outFile, lines.join('\n'), 'utf8');
console.log(`生成 ${outFile}`);
console.log(`共 ${rows.length} 期：`);
for (const r of rows) console.log(`  ${r.date} | ${r.title || '(无标题)'} | quiz:${r.quizQuestion ? 'yes' : 'no'} | answer:${r.quizAnswer ? 'yes' : 'no'} | topics:${r.topics.length}`);
