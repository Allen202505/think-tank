import { lookup } from 'node:dns/promises';
import { SYSTEM_GUARD } from '../../../lib/security';
import { generateJson } from '../../../lib/ai';
import { getClientIp, guardFreeDaily, limitResponse, quotaResponse, rateLimit } from '../../../lib/rateLimit';
import {
  buildStrategyExtractionMessages,
  extractPageContent,
  isPrivateNetworkHost,
  limitExtractedContent,
  normalizeStrategyDraft,
  normalizeStrategyUrl,
} from '../../../lib/strategyExtraction.mjs';

export const runtime = 'nodejs';

const MAX_HTML_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;

async function assertPublicDns(hostname) {
  if (isPrivateNetworkHost(hostname)) throw new Error('不支持内网或本机地址');
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error('无法解析链接域名');
  if (records.some((record) => isPrivateNetworkHost(record.address))) throw new Error('链接指向内网地址，已拒绝访问');
}

async function readResponseTextLimited(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error('页面内容过大，无法解析');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function fetchPublicPage(rawUrl) {
  let currentUrl = new URL(normalizeStrategyUrl(rawUrl));
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicDns(currentUrl.hostname);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let response;
    try {
      response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('页面跳转地址缺失');
      currentUrl = new URL(location, currentUrl);
      normalizeStrategyUrl(currentUrl.toString());
      continue;
    }
    if (!response.ok) throw new Error(`页面抓取失败（HTTP ${response.status}）`);
    const type = response.headers.get('content-type') || '';
    if (!/text\/html|text\/plain|application\/xhtml\+xml/i.test(type)) throw new Error('链接不是可解析的网页正文');
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_HTML_BYTES) throw new Error('页面内容过大，无法解析');
    const html = await readResponseTextLimited(response);
    return { finalUrl: currentUrl.toString(), html };
  }
  throw new Error('页面跳转次数过多');
}

export async function POST(request) {
  const ip = getClientIp(request);
  const limited = rateLimit(`strategy-extract:${ip}`, { limit: 8, windowMs: 60 * 1000 });
  if (!limited.ok) return limitResponse(limited.retryAfter);

  let body;
  try { body = await request.json(); } catch (e) { return Response.json({ error: '请求格式错误' }, { status: 400 }); }
  let sourceUrl;
  try { sourceUrl = normalizeStrategyUrl(body.url); } catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
  const quota = guardFreeDaily(request, body.aiConfig, { limit: 40 });
  if (!quota.ok) return quotaResponse(quota.retryAfter);

  const pastedText = limitExtractedContent(body.content || '', 24000);
  let page = { title: '', author: '', content: '' };
  let fetchWarning = '';
  try {
    const fetched = await fetchPublicPage(sourceUrl);
    sourceUrl = fetched.finalUrl;
    page = extractPageContent(fetched.html, sourceUrl);
  } catch (e) {
    fetchWarning = e.message || '页面抓取失败';
    if (!pastedText) {
      return Response.json({ error: `${fetchWarning}。请粘贴原文正文后重试。`, code: 'FETCH_FAILED' }, { status: 422 });
    }
  }

  const sourceContent = limitExtractedContent([page.content, pastedText].filter(Boolean).join('\n\n'));
  if (sourceContent.length < 160) {
    return Response.json({ error: '可解析正文过短，请确认链接公开可访问，或粘贴更完整的策略原文。', code: 'CONTENT_TOO_SHORT' }, { status: 422 });
  }

  try {
    const messages = buildStrategyExtractionMessages({ url: sourceUrl, page, pastedText });
    messages[0].content = `${SYSTEM_GUARD}\n${messages[0].content}`;
    const { parsed } = await generateJson(messages, '{"title":"","category":"其他","author":"","sourceName":"","question":"","description":"","keyPoints":[],"risk":""}', 2200, false, body.aiConfig);
    if (!parsed || typeof parsed !== 'object') throw new Error('AI 未返回结构化策略');
    const strategy = normalizeStrategyDraft(parsed, sourceUrl);
    if (!strategy.description) strategy.description = String(parsed.summary || '').trim() || '原文未说明';
    if (!strategy.points.length) strategy.points = ['原文未说明可执行步骤'];
    if (!strategy.risk) strategy.risk = '由用户添加，原文风险信息待核对';
    return Response.json({
      ok: true,
      strategy,
      meta: {
        sourceUrl,
        pageTitle: page.title || '',
        fetchedChars: page.content.length,
        pastedChars: pastedText.length,
        warning: fetchWarning,
      },
    });
  } catch (e) {
    return Response.json({ error: String(e?.message || '策略提取失败，请稍后重试') }, { status: 502 });
  }
}
