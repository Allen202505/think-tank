// src/app/api/pools/extract —— 从报道文本 / 云文档·网页链接中提取 A 股标的
// POST { text } 或 { url } → { ok, result: { stocks: [{code,name}], source } }
import { generateJson } from '../../../../lib/ai';
import { getClientIp, rateLimit, limitResponse } from '../../../../lib/rateLimit';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MAX_TEXT = 12000;

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchUrlText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,text/plain,application/json,*/*' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`链接打开失败（HTTP ${res.status}），可复制正文文本粘贴`);
    const buf = await res.arrayBuffer();
    const text = htmlToText(new TextDecoder('utf-8').decode(buf));
    if (text.length < 40) {
      throw new Error('该链接没有可读取的正文：可能需要登录，或页面内容由脚本动态渲染，请复制正文文本直接粘贴');
    }
    return text;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('打开链接超时：网站响应慢，或需要登录/验证码后才出内容，请复制正文文本粘贴');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// 兜底：AI 提取失败时，正则扫描正文里的 6 位 A 股代码
function regexCodes(text) {
  const set = new Set();
  const re = /(?<![0-9])([034689][0-9]{5})(?![0-9])/g;
  let m;
  while ((m = re.exec(text))) set.add(m[1]);
  return [...set];
}

export async function POST(request) {
  try {
  const _rl = rateLimit('pools-extract:' + getClientIp(request), { limit: 40, windowMs: 60000 });
  if (!_rl.ok) return limitResponse(_rl.retryAfter);

    const body = await request.json().catch(() => ({}));
    const textRaw = String(body.text || '').trim();
    const url = String(body.url || '').trim();
    if (!textRaw && !url) return Response.json({ error: '请提供报道文本或链接' }, { status: 400 });
    if (url && !/^https?:\/\/\S+$/i.test(url)) return Response.json({ error: '链接格式不正确，请以 http(s):// 开头' }, { status: 400 });

    const isUrl = !!url && !textRaw;
    const text = isUrl ? await fetchUrlText(url) : textRaw.slice(0, MAX_TEXT);
    const source = isUrl ? '链接提取' : '文本提取';
    if (!text || text.length < 8) return Response.json({ ok: true, result: { stocks: [], source } });

    const prompt = `你是 A 股投研助手。用户提供了一篇可能包含「股票池 / 持仓 / 推荐」的报道或文档摘录，请提取其中出现的 A 股股票。
要求：
1. 只返回明确提到的真实 A 股，附 6 位代码与名称（如 300750 宁德时代、600519 贵州茅台）；代码必须是 6 位数字。
2. 港股 / 美股 / ETF / 基金 / 可转债等不要返回；只提到名称没给代码的，若能对应明确的 A 股龙头可给出代码，否则丢弃。
3. 最多返回 30 只，按原文出现顺序。
4. 只输出一个 JSON 对象，不要任何其他内容：
{"stocks":[{"code":"300750","name":"宁德时代"}]}
注意：所有字符串内只允许中文引号「」或“”，禁止英文双引号。`;
    const { raw, parsed } = await generateJson(
      [{ role: 'system', content: prompt }, { role: 'user', content: `原文：\n${text.slice(0, MAX_TEXT)}` }],
      '{"stocks":[{"code":"300750","name":"宁德时代"}]}',
      1500,
      false,
      body.aiConfig,
    );
    let list = (parsed && Array.isArray(parsed.stocks) ? parsed.stocks : [])
      .filter((s) => s && /^\d{6}$/.test(String(s.code || '')))
      .map((s) => ({ code: String(s.code), name: String(s.name || '').trim() || '待确认' }));

    // 兜底：AI 没提取到时，用正则扫正文里的 6 位代码
    if (!list.length) {
      const codes = regexCodes(text);
      if (codes.length) {
        list = codes.slice(0, 30).map((code) => ({ code, name: '待确认' }));
      }
    }

    // 去重 + 截断
    const seen = new Set();
    const stocks = list.filter((s) => (seen.has(s.code) ? false : (seen.add(s.code), true))).slice(0, 30);
    return Response.json({ ok: true, result: { stocks, source } });
  } catch (e) {
    return Response.json({ error: e.message || '提取失败，请重试' }, { status: 500 });
  }
}
