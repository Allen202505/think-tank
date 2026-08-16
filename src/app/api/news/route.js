// src/app/api/news/route.js
// 巴菲特的早餐 · 实时新闻列表
// GET /api/news?page=1
// 数据源：财联社电报（CLS，公开缓存接口，需签名） + 东方财富 7x24 快讯（免签名）
// 容错：任一源失败自动降级；两者都失败返回空（前端回退内置示例）。
import { createHash } from 'node:crypto';
import { getClientIp, rateLimit, limitResponse } from '../../../lib/rateLimit';

const CLS_CACHE = 'https://www.cls.cn/api/cache';
const EM_KUAIXUN = (n, p) => `https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_${n}_${p}_.html`;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function sha1hex(s) { return createHash('sha1').update(String(s)).digest('hex'); }
function md5hex(s) { return createHash('md5').update(String(s)).digest('hex'); }

// 财联社 sign：参数名排序后拼 a=b&c=d，先 sha1 再 md5
function clsSign(params) {
  const str = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return md5hex(sha1hex(str));
}

// unix 秒 → "HH:MM"（今天）或 "MM-DD HH:MM"（更早）
function fmtTime(unixSec, now = new Date()) {
  if (!unixSec) return '';
  const d = new Date(Number(unixSec) * 1000);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return hm;
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`;
}

// ── 初步过滤：目的是捕捉投资机会点，先剔除明显非财经/非市场的新闻（时政、灾害、军事、文体、民生等） ──
// 策略：① 命中强非财经信号（DROP）→ 直接剔除（即使正文偶带「产业/经济」等词）；② 否则必须有明确财经信号（KEEP）才保留。
const KEEP_WORDS = [
  // 市场与行情
  '股票', '股市', 'A股', '港股', '美股', '上市', '退市', '板块', '概念股', '龙头', '涨停', '跌停', '大涨', '大跌',
  '指数', '大盘', '成交额', '北向', '南向', '主力', '机构', '基金', '券商', '银行', '保险', '证券', '金融',
  // 宏观与政策
  '央行', '美联储', '降息', '加息', '利率', '汇率', '人民币', '美元', '债券', '国债', 'IPO', '并购', '重组',
  '收购', '出售', '增持', '减持', '回购', '分红', '股东', '股权', '定增', '市值', '估值', '市盈率',
  '监管', '证监会', '政策', '试点', '规划', '统计', '数据', 'CPI', 'PPI', 'PMI', 'GDP', '贸易', '关税',
  '出口', '进口', '经济', '市场', '行业', '产业', '产业链', '就业',
  // 公司与产业
  '公司', '集团', '股份', '科技', '生物', '订单', '中标', '签约', '合作', '协议', '合同', '供货', '供应',
  '产能', '扩产', '投产', '出货', '销量', '交付', '涨价', '降价', '提价', '上调', '下调', '发布', '推出',
  '新品', '量产', '突破', '投资', '融资', '募资', '业绩', '财报', '营收', '净利', '净利润', '利润', '毛利率',
  // 重点赛道
  '新能源', '光伏', '风电', '储能', '电池', '锂', '汽车', '整车', '零部件', '半导体', '芯片', 'AI', '人工智能',
  '机器人', '航天', '航空', '火箭', '军工', '地产', '能源', '煤炭', '石油', '天然气', '有色', '钢铁', '化工',
  '材料', '电子', '软件', '通信', '传媒', '食品', '白酒', '医药', '医疗', '创新药', '消费', '零售', '电商',
  '物流', '航运', '港口', '电力', '电网', '核电', '黄金', '稀土', '农业', '养殖', '种业',
];
const DROP_WORDS = [
  // 时政
  '总书记', '重要讲话', '国家主席', '习近平', '人大', '政协', '全会', '党代会', '巡视', '整改问责',
  // 灾害与应急
  '应急响应', '防汛', '抗旱', '干旱', '地震', '台风', '洪水', '暴雨', '泥石流', '气象', '预警', '救灾',
  '抗灾', '受灾', '灾区', '防灾',
  // 军事外交
  '航母', '军舰', '导弹', '演习', '驻军', '使馆', '访问', '会见', '出访', '会谈', '代表团', '建交',
  '总统', '总理', '首相', '内政', '签证', '期刊', '杂志', '一日游',
  // 人事
  '人事', '任免', '任命', '免去', '干部', '选举', '落马', '双开', '审查调查', '履新',
  // 文体民生
  '奥运', '世界杯', '亚运会', '冠军', '赛事', '比赛', '演唱会', '票房', '文旅', '旅游', '开学', '招生',
  '高考', '录取', '分数线', '考试', '疫情', '感染', '病例', '确诊', '疫苗', '悼念', '逝世', '纪念', '慰问',
  // 时政/纪检/军事/交流活动等（避开价格战/陆家嘴论坛/进博会等财经词）
  '监察调查', '纪律审查', '空袭', '真主党', '以军', '袭击', '军事', '研学', '交流活动', '两岸',
  '班列', '通车', '座谈会', '会见', '出访', '访问', '建交', '友好',
];

function isFinanceNews(title, summary) {
  const text = `${title}\n${summary}`;
  // ① 强非财经信号（标题或正文）→ 直接剔除
  if (DROP_WORDS.some((w) => text.includes(w))) return false;
  // ② 标题必须含明确财经信号才保留（正文里的偶发财经词不算）
  return KEEP_WORDS.some((w) => title.includes(w));
}

async function fetchClsTelegraph() {
  const params = { app: 'CailianpressWeb', name: 'telegraph', os: 'web', sv: '8.7.9' };
  const url = `${CLS_CACHE}?${new URLSearchParams(params)}&sign=${clsSign(params)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://www.cls.cn/', Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`CLS HTTP ${res.status}`);
    const json = await res.json();
    const d = json?.data || {};
    const list = d.roll_data || d.telegraph || d.roll || d.depth_list || [];
    return list
      .map((it) => {
        const title = String(it.title || '').trim();
        const brief = String(it.brief || it.content || it.title || '').trim();
        return {
          id: String(it.id || ''),
          time: fmtTime(it.ctime),
          ts: Number(it.ctime) || 0,
          source: '财联社',
          title: title || brief.slice(0, 60),
          summary: brief,
          tags: [],
        };
      })
      .filter((n) => n.title && n.title.length > 2)
      .slice(0, 40);
  } catch (e) {
    return null; // 失败 → 回退
  } finally {
    clearTimeout(timer);
  }
}

async function fetchEmKuaixun(page = 1) {
  const size = 50;
  const url = EM_KUAIXUN(size, Math.max(1, page));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://news.eastmoney.com/', Accept: 'text/plain,application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`EM HTTP ${res.status}`);
    // 接口返回的是 `var ajaxResult={...}` 包裹文本，不是纯 JSON
    const text = await res.text();
    const m = text.match(/var ajaxResult=(\{[\s\S]*\})/);
    if (!m) throw new Error('EM 响应格式异常');
    const json = JSON.parse(m[1]);
    const list = Array.isArray(json?.LivesList) ? json.LivesList : [];
    const items = list
      .map((it) => {
        const title = String(it.title || '').trim();
        const digest = String(it.digest || it.title || '').trim();
        // showTime 形如 "2026-08-15 10:30:00"
        let ts = 0;
        if (it.showtime) {
          const t = String(it.showtime).replace(/-/g, '/'); // iOS Safari 兼容
          const d = new Date(t);
          if (!Number.isNaN(d.getTime())) ts = d.getTime() / 1000;
        }
        return {
          id: String(it.id || ''),
          time: fmtTime(ts),
          ts,
          source: '东方财富',
          title,
          summary: digest,
          tags: [],
        };
      })
      .filter((n) => n.title && n.title.length > 2);
    return { items, total: Number(json?.pagecount || 0) };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request) {
  const _rl = rateLimit('news:' + getClientIp(request), { limit: 30, windowMs: 60000 });
  if (!_rl.ok) return limitResponse(_rl.retryAfter);

  try {
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get('page') || 1) || 1);

    let cls = null;
    let em = null;
    if (page === 1) {
      [cls, em] = await Promise.all([fetchClsTelegraph(), fetchEmKuaixun(1)]);
    } else {
      em = await fetchEmKuaixun(page);
    }

    const merged = [];
    const seen = new Set();
    const normTitle = (t) => String(t || '').trim().replace(/\s+/g, '');
    const push = (items) => {
      for (const it of items || []) {
        // 初步过滤：剔除明显非财经/非市场新闻
        if (!isFinanceNews(it.title, it.summary)) continue;
        // 先按标题去重（两源常转发同一条），再按 id 去重
        const tKey = normTitle(it.title);
        if (tKey && seen.has(`t:${tKey}`)) continue;
        if (it.id && seen.has(`id:${it.id}`)) continue;
        if (tKey) seen.add(`t:${tKey}`);
        if (it.id) seen.add(`id:${it.id}`);
        merged.push(it);
      }
    };
    if (page === 1) push(cls);
    push(em?.items);

    merged.sort((a, b) => (b.ts || 0) - (a.ts || 0));

    if (!merged.length) {
      // 两源都失败：前端回退示例
      return Response.json({ ok: true, items: [], hasMore: false, source: 'empty' });
    }

    const sourceTag = page === 1 && cls && em ? 'mixed' : (cls ? 'cls' : 'em');
    const hasMore = page === 1 ? true : ((em?.items || []).length > 0);
    return Response.json({ ok: true, items: merged, hasMore, source: sourceTag });
  } catch (e) {
    return Response.json({ ok: false, error: e.message || '获取新闻失败' }, { status: 500 });
  }
}
