// src/app/api/virtual-master/route.js
// 邀请大师：根据人物名（大V/游资/公众人物等），用 LLM 生成一份"大师画像"
// 画像包含思考方式/知识域/框架/习惯，供辩论时注入，让虚拟大师与真大师同台竞技
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

function slugify(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '')
    .slice(0, 24);
}

export async function POST(request) {
  try {
    const body = await request.json();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const hint = typeof body?.hint === 'string' ? body.hint.trim() : '';
    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (!name) {
      return Response.json({ error: '请填写大师姓名或昵称' }, { status: 400 });
    }
    if (!apiKey) {
      return Response.json({ error: '未配置 DEEPSEEK_API_KEY' }, { status: 500 });
    }

    const prompt = `你是人物画像建模师。请根据人物「${name}」的公开言行、观点与网络评价，构建一份用于 AI 模拟的"投资大师画像"。他可以是投资大V、游资、基金经理、企业家等公众人物；请基于你对该人物的了解来创作，如果了解有限，就基于其公开形象合理构建。

${hint ? `用户补充信息：${hint}` : ''}

只输出一个 JSON，不要任何其他内容：
{"name":"姓名或别名","nameEn":"英文名或拼音（没有就留空）","emoji":"一个表情符号","color":"一个十六进制颜色","title":"称号（4-10字）","style":"投资与发言风格，逗号分隔（30字内）","personality":"性格与发言风格（30-60字）","quote":"一句代表性金句（可基于其公开言论风格创作）","biography":"简介（30-60字）","classicTheory":"标志性方法论/框架（20-50字）","knowledge":"知识域、思维框架、思考习惯与偏好（50-100字，用于让AI模拟其思考）","coreViews":"核心观点，2-4 条，用分号分隔（基于其公开言论提炼）","phrases":"常用话术/口头禅，1-2 句（模仿其说话风格）","decisionHabits":"决策习惯与偏好，1-2 句（如：喜欢重仓、等待极端价格、看商业模式）","riskPref":"风险偏好（保守/激进/均衡，1 句说明）"}`;

    const response = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        max_tokens: 900,
        temperature: 0.8,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return Response.json({ error: err?.error?.message || `DeepSeek API 错误: ${response.status}` }, { status: response.status });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return Response.json({ error: '生成失败：模型未返回有效画像，请重试' }, { status: 500 });
    }
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
      source: 'custom',
    };

    return Response.json({ master });
  } catch (e) {
    return Response.json({ error: e.message || '服务器内部错误' }, { status: 500 });
  }
}
