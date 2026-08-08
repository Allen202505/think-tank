// src/app/api/virtual-master/route.js
// 邀请大师：根据昵称"全网检索"该人物的公开内容与评价，构建"虚拟大师画像"
// 流程：① 百度+Bing 双引擎检索昵称 → 收集标题/摘要/来源（按排序加权，过滤商标/工商噪音）
//       ② LLM 研究提炼（身份/观点/语录/他人评价/说话风格）
//       ③ LLM 建模（含"风格示范发言"作为说话风格锚点）
// 用户可粘贴该人物真实资料/语录，作为最高优先级依据。
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function slugify(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 24);
}

function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// 过滤无关结果（商标/工商注册等噪音）
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

// 全网检索昵称（百度+Bing，按相关度排序，靠前权重更高）
async function searchWeb(name) {
  const engines = [
    { name: 'bing', url: `https://www.bing.com/search?q=${encodeURIComponent(`"${name}"`)}&count=12` },
    { name: 'baidu', url: `https://www.baidu.com/s?wd=${encodeURIComponent(`"${name}"`)}` },
  ];
  const collected = [];
  for (const e of engines) {
    try {
      const r = await fetch(e.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const html = await r.text();
      const parsed = e.name === 'bing' ? parseBing(html) : parseBaidu(html);
      for (const item of parsed) {
        if (isNoise(item)) continue;
        collected.push({ ...item, rank: collected.length + 1, engine: e.name });
      }
      if (collected.length >= 8) break;
    } catch (err) { /* 单引擎失败不影响 */ }
  }
  return collected.slice(0, 8);
}

async function callDeepSeek(messages, maxTokens = 1500, temperature = 0.7) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const res = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          max_tokens: maxTokens,
          temperature,
          messages,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (e) {
      lastErr = e;
      if (!/fetch|ECONN|ETIMEDOUT|abort/i.test(String(e?.message))) throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('DeepSeek 请求失败');
}

export async function POST(request) {
  try {
    const body = await request.json();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const hint = typeof body?.hint === 'string' ? body.hint.trim() : '';
    const materials = typeof body?.materials === 'string' ? body.materials.trim() : '';
    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (!name) return Response.json({ error: '请填写大师姓名或昵称' }, { status: 400 });
    if (!apiKey) return Response.json({ error: '未配置 DEEPSEEK_API_KEY' }, { status: 500 });

    // ── 1) 全网检索昵称（公开内容 + 他人评价，按相关度加权） ──
    const web = await searchWeb(name);
    const webCorpus = web.length
      ? `【全网检索结果（按相关度排序，越靠前权重越高）】\n${web.map((r, i) => `[${i + 1}]（${r.engine}）标题：${r.title}${r.snippet ? `\n    摘要：${r.snippet}` : ''}\n    来源：${r.url}`).join('\n')}`
      : '';

    // ── 2) 资料准备：用户粘贴资料 > 检索语料 > LLM 知识 ──
    let research = materials || webCorpus;
    if (!research) {
      const researchPrompt = `你是人物资料研究员。人物：「${name}」。
${hint ? `用户补充：${hint}\n` : ''}
请写一份关于该人物的「研究简报」，包含：1) 身份与背景 2) 代表观点与投资/做事理念 3) 经典语录（尽量还原原话） 4) 外界/网络评价 5) 说话风格与习惯（用词、口头禅、语气）。
基于你对该人物的了解来写；如果资料有限，就写你对其公开形象的了解，不要编造具体细节。只输出研究简报正文，400-600字。`;
      research = await callDeepSeek([{ role: 'user', content: researchPrompt }], 1600, 0.5);
    }

    // ── 3) 建模：基于资料构建画像（含风格示范发言） ──
    const personaPrompt = `基于以下「资料」构建人物「${name}」的"投资大师画像"。${materials ? '用户粘贴的资料为最高优先级；' : ''}检索资料按相关度排序，越靠前越可信。说话风格必须贴合资料中体现的真实公开形象；资料未提及的具体细节（如出身、经历）不要编造，可留空或用通用表述。

资料：
${research.slice(0, 5000)}

只输出一个 JSON，不要任何其他内容：
{"name":"姓名或别名","nameEn":"英文名或拼音（没有就留空）","emoji":"一个表情符号","color":"一个十六进制颜色","title":"称号（4-10字）","style":"投资与发言风格，逗号分隔（30字内）","personality":"性格与发言风格（30-60字）","quote":"一句代表性金句（尽量贴合资料中的真实表达）","biography":"简介（30-60字）","classicTheory":"标志性方法论/框架（20-50字）","knowledge":"知识域、思维框架、思考习惯与偏好（50-100字）","coreViews":"核心观点，2-4 条，用分号分隔","phrases":"常用话术/口头禅，1-2 句（模仿其说话风格）","decisionHabits":"决策习惯与偏好，1-2 句","riskPref":"风险偏好（保守/激进/均衡，1 句说明）","styleSample":"一段以该人物口吻写的示范发言（120-180字，务必模仿其语气、用词、口头禅与说话节奏，用于让AI学习其风格）"}`;
    const personaText = await callDeepSeek([{ role: 'user', content: personaPrompt }], 1400, 0.7);
    const match = personaText.match(/\{[\s\S]*\}/);
    if (!match) return Response.json({ error: '生成失败：模型未返回有效画像，请重试' }, { status: 500 });
    const p = JSON.parse(match[0]);

    const master = {
      id: `custom_${Date.now()}_${slugify(name) || 'master'}`,
      name: p.name || name,
      nameEn: p.nameEn || '',
      emoji: p.emoji || '🧙',
      color: /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : '#9a7830',
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

    return Response.json({ master });
  } catch (e) {
    const msg = String(e?.message || '');
    const friendly = /abort|timeout|超时/i.test(msg) ? '生成超时，请重试一次' : msg;
    return Response.json({ error: friendly || '服务器内部错误' }, { status: 500 });
  }
}
