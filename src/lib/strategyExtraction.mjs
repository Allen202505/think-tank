import { normalizePublicHttpUrl } from './safeRemoteFetch.mjs';

export { isPrivateNetworkHost } from './safeRemoteFetch.mjs';

export const STRATEGY_EXTRACT_CATEGORIES = ['长线价值', '短线波段', '交易心法', '其他'];

function decodeHtmlEntities(value) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  };
  return String(value || '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp|ndash|mdash);/gi, (m, code) => {
    const key = String(code).toLowerCase();
    if (named[key]) return named[key];
    if (key.startsWith('#x')) return String.fromCodePoint(Number.parseInt(key.slice(2), 16) || 32);
    if (key.startsWith('#')) return String.fromCodePoint(Number.parseInt(key.slice(1), 10) || 32);
    return m;
  });
}

export function htmlToText(html) {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|h[1-6]|section|article|blockquote|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function metaContent(html, names) {
  for (const name of names) {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim();
    }
  }
  return '';
}

export function extractPageContent(html, sourceUrl = '') {
  const raw = String(html || '');
  const titleTag = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  const title = metaContent(raw, ['og:title', 'twitter:title']) || decodeHtmlEntities(titleTag).replace(/\s+/g, ' ').trim();
  const description = metaContent(raw, ['og:description', 'description', 'twitter:description']);
  const author = metaContent(raw, ['author', 'article:author']);
  const visible = htmlToText(raw).slice(0, 60000);
  const content = [description, visible].filter(Boolean).join('\n\n').slice(0, 60000);
  return { url: String(sourceUrl || ''), title, description, author, content };
}

export function normalizeStrategyUrl(raw) {
  return normalizePublicHttpUrl(raw);
}

export function limitExtractedContent(text, maxChars = 48000) {
  const clean = String(text || '').replace(/\u0000/g, '').replace(/\n{4,}/g, '\n\n\n').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}\n\n[内容过长，已截断]`;
}

export function normalizeStrategyDraft(value, sourceUrl = '') {
  const input = value && typeof value === 'object' ? value : {};
  const points = Array.isArray(input.keyPoints || input.points)
    ? (input.keyPoints || input.points).map((point) => String(point || '').trim()).filter(Boolean)
    : String(input.keyPoints || input.points || '').split(/\n+|(?=\d+[、.])/).map((point) => point.replace(/^\d+[、.]\s*/, '').trim()).filter(Boolean);
  const category = STRATEGY_EXTRACT_CATEGORIES.includes(String(input.category || '').trim())
    ? String(input.category).trim()
    : '其他';
  return {
    title: String(input.title || '未命名选股策略').trim().slice(0, 80),
    category,
    author: String(input.author || input.source || '用户添加').trim().slice(0, 60),
    source: String(input.sourceName || input.source || '用户添加').trim().slice(0, 60),
    description: String(input.description || input.summary || '').trim().slice(0, 500),
    points: points.slice(0, 10).map((point) => point.slice(0, 180)),
    risk: String(input.risk || input.risks || '').trim().slice(0, 300),
    question: String(input.question || input.questionTitle || '').trim().slice(0, 160),
    url: normalizeStrategyUrl(sourceUrl),
    sourceUrl: normalizeStrategyUrl(sourceUrl),
    userAdded: true,
  };
}

export function buildStrategyExtractionMessages({ url, page, pastedText = '' }) {
  const sourceText = limitExtractedContent([
    `来源链接：${url}`,
    `页面标题：${page?.title || ''}`,
    `页面作者：${page?.author || ''}`,
    pastedText ? `用户补充正文：\n${pastedText}` : '',
    `页面正文：\n${page?.content || ''}`,
  ].filter(Boolean).join('\n\n'));

  return [
    {
      role: 'system',
      content: '你是投资内容编辑。你的任务是从给定网页原文中抽取一个可执行的选股策略。只使用原文中的信息，不补充原文没有的数字、业绩或结论；若某字段缺失，明确写“原文未说明”。区分作者观点与事实，并标出时效、转载、引流等风险。',
    },
    {
      role: 'user',
      content: `${sourceText}\n\n请严格输出 JSON，不要 Markdown。字段：{"title":"策略名称，最多30字","category":"长线价值|短线波段|交易心法|其他","author":"原作者或答主","sourceName":"平台或出处","question":"所属问题/文章标题","description":"一句话核心逻辑，最多100字","keyPoints":["3-8条可执行要点，每条最多60字"],"risk":"风险和时效提示"}`,
    },
  ];
}
