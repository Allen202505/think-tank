// src/app/api/virtual-master/route.js
// 邀请大师：根据人物名（大V/游资/公众人物等）构建"虚拟大师画像"
// 流程：① 尽力检索公开资料（维基百科） ② LLM 研究提炼（身份/观点/语录/评价/说话风格）
//       ③ LLM 建模（含"风格示范发言"作为说话风格的锚点）
// 用户可粘贴该人物的真实资料/语录，作为最可靠的建模依据。
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

function slugify(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '')
    .slice(0, 24);
}

// 尽力而为的公开资料检索（维基百科），失败不影响
async function fetchPublicContext(name) {
  for (const lang of ['zh', 'en']) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch(
        `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(name)}&prop=extracts&exintro&explaintext&format=json&redirects=1`,
        { headers: { 'User-Agent': 'MasterDebate/1.0' }, signal: ctrl.signal },
      );
      clearTimeout(timer);
      if (r.ok) {
        const j = await r.json();
        const p = Object.values(j?.query?.pages || {})[0];
        if (p?.extract) return `【维基百科·${lang}】${p.extract.slice(0, 500)}`;
      }
    } catch (e) { /* 忽略 */ }
  }
  return '';
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
      // 网络类错误重试一次
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

    // ── 1) 公开资料检索（尽力而为） ──
    const publicCtx = await fetchPublicContext(name);

    // ── 2) 资料准备：用户粘贴的资料即研究简报；否则先用 LLM 研究提炼 ──
    let research = materials;
    if (!research) {
      const researchPrompt = `你是人物资料研究员。人物：「${name}」。
${hint ? `用户补充：${hint}\n` : ''}${publicCtx ? `【检索到的公开资料】\n${publicCtx}\n\n` : ''}
请写一份关于该人物的「研究简报」，包含：1) 身份与背景 2) 代表观点与投资/做事理念 3) 经典语录（尽量还原原话） 4) 外界/网络评价 5) 说话风格与习惯（用词、口头禅、语气）。
基于你对该人物的了解来写；如果资料有限，就写你对其公开形象的了解。只输出研究简报正文，400-600字。`;
      research = await callDeepSeek([{ role: 'user', content: researchPrompt }], 1600, 0.5);
    }

    // ── 3) 建模：基于资料构建画像（含风格示范发言） ──
    const personaPrompt = `基于以下「资料」与公开信息，为人物「${name}」构建一份用于 AI 模拟的"投资大师画像"。${materials ? '优先采用用户提供的真实资料；' : ''}说话风格必须贴合其真实公开形象。

资料：
${research.slice(0, 4000)}

只输出一个 JSON，不要任何其他内容：
{"name":"姓名或别名","nameEn":"英文名或拼音（没有就留空）","emoji":"一个表情符号","color":"一个十六进制颜色","title":"称号（4-10字）","style":"投资与发言风格，逗号分隔（30字内）","personality":"性格与发言风格（30-60字）","quote":"一句代表性金句（尽量还原其真实表达）","biography":"简介（30-60字）","classicTheory":"标志性方法论/框架（20-50字）","knowledge":"知识域、思维框架、思考习惯与偏好（50-100字）","coreViews":"核心观点，2-4 条，用分号分隔","phrases":"常用话术/口头禅，1-2 句（模仿其说话风格）","decisionHabits":"决策习惯与偏好，1-2 句","riskPref":"风险偏好（保守/激进/均衡，1 句说明）","styleSample":"一段以该人物口吻写的示范发言（120-180字，务必模仿其语气、用词、口头禅与说话节奏，用于让AI学习其风格）"}`;
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
