// src/app/api/virtual-master/route.js
// 邀请大师：根据昵称"全网检索"该人物的公开内容与评价，构建"虚拟大师画像"
// 返回流式（NDJSON）事件：search → research → build → done/error，前端可展示阶段进度
import { ReadableStream } from 'node:stream/web';
import { getClientIp, rateLimit, limitResponse } from '../../../lib/rateLimit';
import { snapColorToPalette } from '../../../data/masters';
import { RECIPES } from '../../../data/recipes';
import { resolveAiConfig } from '../../../lib/llm.js';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function slugify(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 24);
}

function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isNoise(r) {
  const t = `${r.title} ${r.url}`;
  return /商标|注册号|企查查|爱企查|天眼查|查查|知识产权/.test(t);
}

function parseBing(html) {
  const out = [];
  const re = /<li class="b_algo"[\s\S]*?<\/li>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const block = m[0];
    const t = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!t) continue;
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    out.push({ title: stripHtml(t[2]), url: t[1], snippet: p ? stripHtml(p[1]) : '' });
    if (out.length >= 8) break;
  }
  return out;
}

function parseBaidu(html) {
  const out = [];
  const re = /<h3[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<span class="content-right_8Zs40">([\s\S]*?)<\/span>)?/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ title: stripHtml(m[2]), url: m[1], snippet: m[3] ? stripHtml(m[3]) : '' });
    if (out.length >= 8) break;
  }
  return out;
}

function parseSogou(html) {
  const out = [];
  const re = /<h3[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const block = m[0];
    const url = m[1];
    // 搜狗结果链接是跳转链接，尝试取真实URL
    const real = url.includes('link?') ? (url.match(/url=([^&]+)/)?.[1] || url) : url;
    const title = stripHtml(m[2]);
    if (!title) continue;
    const snip = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    out.push({ title, url: real, snippet: snip ? stripHtml(snip[1]) : '' });
    if (out.length >= 8) break;
  }
  return out;
}

const BLOCKED_HOSTS = /zhihu\.com|xueqiu\.com|zsxq\.com|weixin|mp\.weixin|weibo\.com|bilibili\.com/;

async function searchWeb(name, recipe = null) {
  // 相关性锚点：命中锚点的结果排最前（防同名/字典/无关内容抢占）
  const anchor = name;
  const queries = recipe?.queries?.length ? recipe.queries : [name];
  const seen = new Set();
  // 并行：所有 query × 引擎同时发起，避免串行等待
  // site: 查询保持原样（外层引号会破坏语法），其余加引号精确匹配
  const qExpr = (q) => (q.includes('site:') ? q : `"${q}"`);
  const results = await Promise.all(queries.flatMap((q) => [
    { name: 'bing', url: `https://www.bing.com/search?q=${encodeURIComponent(qExpr(q))}&count=12` },
    { name: 'baidu', url: `https://www.baidu.com/s?wd=${encodeURIComponent(qExpr(q))}` },
    { name: 'sogou', url: `https://www.sogou.com/web?query=${encodeURIComponent(qExpr(q))}` },
  ]).map(async (e) => {
    try {
      const r = await fetch(e.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return [];
      const html = await r.text();
      const parsed = e.name === 'bing' ? parseBing(html) : e.name === 'baidu' ? parseBaidu(html) : parseSogou(html);
      return parsed.map((item) => ({ ...item, engine: e.name }));
    } catch (err) { return []; }
  }));
  const collected = [];
  for (const item of results.flat()) {
    if (isNoise(item)) continue;
    if (recipe?.noise && recipe.noise.test(`${item.title} ${item.url}`)) continue;
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    collected.push({ ...item, rank: collected.length + 1 });
  }
  // 相关性排序：标题/摘要含完整昵称的排最前，其次是含姓氏/别名，纯噪音垫底
  collected.sort((a, b) => {
    const score = (r) => {
      const t = `${r.title} ${r.snippet}`;
      if (t.includes(anchor)) return 0;
      if (anchor.length >= 2 && t.includes(anchor.slice(0, 2))) return 1;
      return 2;
    };
    return score(a) - score(b);
  });
  return collected.slice(0, 12);
}

async function fetchArticle(url) {
  try {
    const host = (() => { try { return new URL(url).hostname; } catch (e) { return ''; } })();
    if (BLOCKED_HOSTS.test(host)) return '';
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(4000), redirect: 'follow' });
    if (!r.ok) return '';
    const html = await r.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || text.length < 200) return '';
    if (/验证码|访问过于频繁|无标题文档|请开启JavaScript|安全验证/.test(text.slice(0, 300))) return '';
    const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    if (cn < 80) return '';
    return text.slice(0, 1200);
  } catch (e) {
    return '';
  }
}

async function callDeepSeek(messages, maxTokens = 1500, temperature = 0.7, cfg = null) {
  const aiCfg = resolveAiConfig(cfg);
  const url = /\/chat\/completions$/.test(aiCfg.baseUrl) ? aiCfg.baseUrl : `${aiCfg.baseUrl}/chat/completions`;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiCfg.apiKey}` },
        body: JSON.stringify({
          model: aiCfg.model,
          max_tokens: maxTokens,
          temperature,
          messages,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`模型服务 ${res.status}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (e) {
      lastErr = e;
      if (!/fetch|ECONN|ETIMEDOUT|abort/i.test(String(e?.message))) throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('模型请求失败');
}

export async function POST(request) {

  const _rl = rateLimit('virtual-master:' + getClientIp(request), { limit: 30, windowMs: 60000 });
  if (!_rl.ok) return limitResponse(_rl.retryAfter);
  const body = await request.json();
  const aiCfg = resolveAiConfig(body.aiConfig);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const hint = typeof body?.hint === 'string' ? body.hint.trim() : '';
  const materials = typeof body?.materials === 'string' ? body.materials.trim() : '';

  if (!name) {
    return new Response(JSON.stringify({ stage: 'error', error: '请填写大师姓名或昵称' }), {
      status: 200, headers: { 'Content-Type': 'application/x-ndjson' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      try {
        // ① 检索公开资料（命中配方走定制多关键词检索）
        emit({ stage: 'search' });
        const recipe = RECIPES.find((r) => r.name === name) || null;
        const web = await searchWeb(name, recipe);
        // 并行抓取前 4 篇候选正文，取最先成功的 2 篇
        const arts = await Promise.all(
          web.slice(0, 4)
            .filter((r) => !BLOCKED_HOSTS.test(r.url))
            .map(async (r) => ({ r, body: await fetchArticle(r.url) }))
        );
        const articles = arts.filter((a) => a.body).slice(0, 2).map((a) => ({ url: a.r.url, title: a.r.title, body: a.body }));

        // ② 资料准备：用户粘贴 > 全文正文 > 搜索摘要 > LLM 知识
        emit({ stage: 'research' });
        const corpus = [];
        if (recipe?.hint) corpus.push(`【人工校准背景 · 可信度最高】\n${recipe.hint}`);
        if (materials) corpus.push(`【用户提供的真实资料 · 可信度最高】\n${materials.slice(0, 4000)}`);
        if (articles.length) {
          corpus.push(`【已读取到的全文正文 · 可信度高】\n${articles.map((a, i) => `[正文${i + 1}]《${a.title}》\n${a.body}`).join('\n\n')}`);
        }
        if (web.length) {
          corpus.push(`【搜索摘要 · 可信度中】\n${web.map((r, i) => `[${i + 1}]（${r.engine}）标题：${r.title}${r.snippet ? `\n    摘要：${r.snippet}` : ''}\n    来源：${r.url}`).join('\n')}`);
        }
        let research = corpus.join('\n\n');
        if (!research) {
          const rp = `你是人物资料研究员。人物：「${name}」。\n${recipe?.hint ? `人工校准背景：${recipe.hint}\n` : ''}\n${hint ? `用户补充：${hint}\n` : ''}\n请写一份关于该人物的「研究简报」，包含：1) 身份与背景 2) 代表观点与投资/做事理念 3) 经典语录（尽量还原原话） 4) 外界/网络评价 5) 说话风格与习惯。基于你对该人物的了解来写；资料有限就写公开形象，不要编造具体细节。只输出研究简报正文，400-600字。`;
          research = await callDeepSeek([{ role: 'user', content: rp }], 1600, 0.5, aiCfg);
        }

        // ③ 建模
        emit({ stage: 'build' });
        const personaPrompt = `你是深谙人物研究的分析总监。目标人物：「${name}」。请像舆情研究员一样系统性阅读材料，严格执行以下分析纲领：

【素材分层】
- 本人原话：材料中明确为人物本人发言/引语的内容（带引号者优先），用于还原真实语言习惯、口头禅与表达节奏
- 他人评价：网友、粉丝、批评者、同行对他的评论与转述，用于还原外界眼中的形象与口碑
- 人工校准背景：最可信，作为判断基准

【硬性要求】
1. 区分上述素材，不可混用；本人原话必须尽量保留原句，quote 字段优先使用材料中的真实原话（带引号），没有原话就不编造，用最贴近的转述并保持克制
2. 信源分层解构：若材料同时存在欣赏者与批评者视角，两方都要参考，不可只取一面；将批评者指出的问题（如逻辑漏洞、争议点）融入 personality 或 riskPref 的刻画，让人物更立体
3. 时间线矛盾标注：若材料显示其观点前后转变或与市场共识相悖，如实体现在 coreViews 或 decisionHabits 中，不要强行抹平
4. 不脑补：资料未提及的具体细节（出身、经历、个人生活）不得编造，留空或仅用通用表述；宁可资料有限时画像朴素，也不要虚构细节
5. 风格还原：styleSample 必须模仿其真实表达习惯（用词、语气、口头禅、句式），若有本人原话参考，优先贴近原话节奏

资料：
${research.slice(0, 5000)}

只输出一个 JSON，不要任何其他内容：
{"name":"姓名或别名","nameEn":"英文名或拼音（没有就留空）","emoji":"一个表情符号","color":"一个十六进制颜色","title":"称号（4-10字）","style":"投资与发言风格，逗号分隔（30字内）","personality":"性格与发言风格（30-60字）","quote":"一句代表性金句（尽量贴合资料中的真实表达）","biography":"简介（30-60字）","classicTheory":"标志性方法论/框架（20-50字）","knowledge":"知识域、思维框架、思考习惯与偏好（50-100字）","coreViews":"核心观点，2-4 条，用分号分隔","phrases":"常用话术/口头禅，1-2 句（模仿其说话风格）","decisionHabits":"决策习惯与偏好，1-2 句","riskPref":"风险偏好（保守/激进/均衡，1 句说明）","styleSample":"一段以该人物口吻写的示范发言（120-180字，务必模仿其语气、用词、口头禅与说话节奏）"}`;
        const personaText = await callDeepSeek([{ role: 'user', content: personaPrompt }], 1400, 0.7, aiCfg);
        const match = personaText.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('生成失败：模型未返回有效画像，请重试');
        const p = JSON.parse(match[0]);

        const master = {
          id: `custom_${Date.now()}_${slugify(name) || 'master'}`,
          name: p.name || name,
          nameEn: p.nameEn || '',
          emoji: p.emoji || '🧙',
          color: snapColorToPalette(p.color),
          avatar: '',
          status: 'alive',
          title: p.title || '民间高手',
          titleEn: p.titleEn || '',
          style: p.style || '独立思考，价值与趋势并重',
          styleEn: p.styleEn || '',
          personality: p.personality || '风格鲜明，敢于表达',
          quote: p.quote || '保持独立思考。',
          biography: p.biography || `「${name}」是用户邀请的民间投资高手。`,
          classicTheory: p.classicTheory || '独立思考、知行合一',
          knowledge: p.knowledge || '',
          coreViews: p.coreViews || '',
          phrases: p.phrases || '',
          decisionHabits: p.decisionHabits || '',
          riskPref: p.riskPref || '',
          styleSample: p.styleSample || '',
          source: 'custom',
        };

        emit({ stage: 'done', master, sources: web.slice(0, 6).map((r) => r.title), sourceCount: web.length });
      } catch (e) {
        const msg = String(e?.message || '');
        const friendly = /abort|timeout|超时/i.test(msg) ? '生成超时，请重试一次' : msg;
        emit({ stage: 'error', error: friendly || '服务器内部错误' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
  });
}
