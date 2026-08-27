// src/lib/announcementEnrich.js —— 薄摘要新闻自动补全
// 场景：新闻标题/摘要很薄（如「国泰集团：2026年上半年净利润9799.20万元」+ 一行导语），
// 正文全在官方公告/PDF 里。这里按股票代码定位东财官方公告，取全文节选注入，避免分析全靠猜。
// 任何一步失败都静默降级（返回原 news），不影响主流程。
import { resolveSymbols } from '../app/api/chat/marketData.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
const THIN_MIN = 150;        // 正文少于该字数视为薄摘要
const ENRICH_MAX = 2000;     // 注入节选上限（字符）
const RECENT_DAYS = 60;      // 只匹配最近 60 天的公告

const ANN_LIST_URL = (code) => `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=20&page_index=1&ann_type=A&client_source=web&stock_list=${code}`;
const ANN_CONTENT_URL = (artCode) => `https://np-cnotice-stock.eastmoney.com/api/content/ann?art_code=${artCode}&client_source=web&page_index=1`;

function cleanAnnText(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\r/g, '')
    .split('\n').map((s) => s.trim()).filter(Boolean)
    .join('\n');
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://data.eastmoney.com/' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function isThin(news) {
  const title = String(news.title || '').trim();
  const content = String(news.content || '').trim();
  if (/^https?:\/\//i.test(title)) return false; // 链接类交给链接抓取
  const effective = content && content !== title ? content : '';
  return effective.length < THIN_MIN;
}

// 从新闻文本推断「事件类型」，用于和公告标题匹配（如 上半年 → 半年度报告）
// 半年优先于年报，避免"半年度报告"被当成"年度报告"串错期。
function detectEventTypes(text) {
  const types = [];
  if (/半年|半年度/.test(text)) types.push('半年度报告');
  else if (/年度报告|年报/.test(text)) types.push('年度报告');
  if (/业绩预告|预增|预减|预亏|预盈/.test(text)) types.push('业绩预告');
  if (/业绩快报/.test(text)) types.push('业绩快报');
  if (/一季报|一季度/.test(text)) types.push('一季度报告');
  if (/三季报|三季度/.test(text)) types.push('三季度报告');
  if (/经营数据|新签合同|订单|月度经营/.test(text)) types.push('主要经营数据');
  if (/中标|重大合同/.test(text)) types.push('重大合同');
  if (/回购/.test(text)) types.push('回购');
  if (/增持/.test(text)) types.push('增持');
  if (/减持/.test(text)) types.push('减持');
  if (/重组|重大资产/.test(text)) types.push('重组');
  if (/收购|并购/.test(text)) types.push('收购');
  if (/分红|权益分派|利润分配|送股|转增/.test(text)) types.push('利润分配');
  if (/股权激励/.test(text)) types.push('股权激励');
  return types;
}

function parseAnnTime(str) {
  if (!str) return 0;
  const d = new Date(String(str).replace(/-/g, '/'));
  return Number.isNaN(d.getTime()) ? 0 : d.getTime() / 1000;
}

// 给公告打分：事件类型命中 + 标题词重合 + 优先「摘要」
function scoreAnnouncement(ann, newsText) {
  const title = String(ann.title || '');
  const col = (ann.columns || []).map((c) => c.column_name || '').join(' ');
  const t = `${title} ${col}`;
  const types = detectEventTypes(newsText);
  let eventScore = 0;
  for (const ty of types) {
    if (t.includes(ty)) eventScore += 8;
  }
  if (eventScore === 0) return 0; // 新闻里没有明确的公告事件 → 不补全（防止公司名重合误抓）
  let score = eventScore;
  const tokens = String(newsText).match(/[\u4e00-\u9fa5A-Za-z0-9]{2,}/g) || [];
  const stop = new Set(['公司', '公告', '披露', '集团', '股份', '有限', '报告', '净利', '利润', '同比', '万元', '亿元']);
  for (const tk of tokens) {
    if (stop.has(tk)) continue;
    if (title.includes(tk)) score += 1;
  }
  if (title.includes('摘要')) score += 2;
  if (title.includes('全文')) score -= 1;
  return score;
}

// 从清洗后的公告正文里截取「财务数据 + 管理层讨论」两段（前瞻/经营素材优先）
function buildExcerpt(text) {
  if (!text) return '';
  const cap = ENRICH_MAX;
  const FIN_ANCHORS = ['主要会计数据', '主要财务数据', '主要财务指标'];
  const MD_ANCHORS = ['管理层讨论与分析', '经营情况讨论与分析', '收入、利润变化的主要原因'];
  let finAnchor = -1;
  for (const a of FIN_ANCHORS) { const i = text.indexOf(a); if (i >= 0) { finAnchor = i; break; } }
  let mdAnchor = -1;
  for (const a of MD_ANCHORS) { const i = text.indexOf(a); if (i >= 0) { mdAnchor = i; break; } }
  if (finAnchor >= 0) {
    let s = text.slice(finAnchor, finAnchor + 700);
    if (mdAnchor > finAnchor) s += '\n' + text.slice(mdAnchor, mdAnchor + Math.max(0, cap - s.length));
    return s.slice(0, cap);
  }
  if (mdAnchor >= 0) return text.slice(mdAnchor, mdAnchor + cap);
  return text.slice(0, cap);
}

/**
 * 薄摘要新闻 → 自动关联官方公告全文节选。
 * @param {{title?:string, content?:string}} news
 * @returns {Promise<object>} 补全后的 news（失败返回原 news）
 */
export async function enrichThinNews(news) {
  try {
    if (!news || !news.title) return news;
    const text = `${String(news.title)}\n${String(news.content || '')}`;
    if (!isThin(news)) return news;
    // 优先用 6 位 A 股代码直接解析（避开 LLM 提取，快且准）；没有代码再整体解析
    const codeMatch = String(text).match(/\b(?:[0369]\d{5})\b/);
    const infos = await resolveSymbols(codeMatch ? codeMatch[0] : text).catch(() => []);
    const cnList = (infos || []).filter((i) => i.market === 'CN' && i.symbol);
    if (!cnList.length) return news;
    let cn = cnList[0];
    // 无唯一代码且识别出多家 A 股公司 → 必须能通过"新闻标题里的公司名"唯一锁定一家，
    // 否则无法确认补全的公告和粘贴的新闻是同一家公司，宁可放弃，避免胡乱抓。
    if (!codeMatch && cnList.length > 1) {
      const title = String(news.title || '');
      const named = cnList.filter((i) => i.name && title.includes(String(i.name).replace(/\s+/g, '')));
      if (named.length === 1) cn = named[0];
      else cn = null;
    }
    if (!cn) return news;
    const json = await fetchJson(ANN_LIST_URL(cn.symbol)).catch(() => null);
    const list = (json && json.data && json.data.list) || [];
    if (!list.length) return news;
    const cutoff = Date.now() / 1000 - RECENT_DAYS * 24 * 3600;
    const ranked = list
      .map((a) => ({ a, ts: parseAnnTime(a.display_time || a.notice_date), score: scoreAnnouncement(a, text) }))
      .filter((x) => x.ts >= cutoff && x.score > 0)
      .sort((x, y) => y.score - x.score);
    const best = ranked[0];
    if (!best) return news;
    const html = await fetchJson(ANN_CONTENT_URL(best.a.art_code)).catch(() => null);
    const body = html && html.data && html.data.notice_content;
    const excerpt = buildExcerpt(cleanAnnText(body));
    if (!excerpt) return news;
    const title = String(best.a.title || '').replace(/^[^:：]*[:：]/, '');
    return {
      ...news,
      content: `${String(news.content || '').trim()}\n\n【已自动关联官方公告《${title}》（节选）】\n${excerpt}`,
    };
  } catch (e) {
    return news; // 任何失败都不影响原流程
  }
}
