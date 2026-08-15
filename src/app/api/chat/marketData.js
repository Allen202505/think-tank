/**
 * marketData.js —— 统一市场数据层
 * ------------------------------------------------------------------
 * 目标：让「大师吵股」在辩论前拿到最新行情与财务数据，避免 AI 用训练记忆里的旧数字。
 *
 * 数据源（双源容错）：
 *  - 东方财富公开接口（国内可直连、免费、无需 Key）：
 *      · 搜索建议接口：公司名/代码 → 代码与市场归属（A股/港股/美股）
 *      · 实时行情接口：价格、涨跌、PE、PB、市值（f59 为小数位数，用于换算）
 *      · F10 财务主要指标：最新季报/年报的营收、净利、同比增速、毛利率、净利率、ROE、EPS 等
 *  - Yahoo Finance（yahoo-finance2，Vercel 美国服务器可访问）：
 *      · 美股/港股行情补充（PE、52 周区间、股息率）
 *      · 美股/港股财务与分析师评级（quoteSummary）
 *
 * 容错原则：任何单个请求失败都不致命，返回空即可；数据源挂了会自动降级/跳过。
 */

// ─── 常量 ────────────────────────────────────────────────
const EM_SUGGEST = 'https://searchapi.eastmoney.com/api/suggest/get';
const EM_QUOTE = 'https://push2.eastmoney.com/api/qt/stock/get';
const EM_F10 = 'https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew';
const EM_DATACENTER = 'https://datacenter.eastmoney.com/securities/api/data/v1/get';
const EM_DATACENTER_WEB = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
// 东方财富网页版搜索框公开使用的固定 token（无需申请）
const EM_TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8';
const REQUEST_TIMEOUT_MS = 8000;

// 常见公司中文名/别名 → 东财 secid（形如 "1.600519"，1=沪 0=深 105/106=美股 116=港股）
// key 用于匹配用户问题文本；value 提供代码、市场与 secid
const COMMON_SYMBOLS = {
  // ── A股 ──
  '贵州茅台': { symbol: '600519', market: 'CN', secid: '1.600519' },
  '茅台':     { symbol: '600519', market: 'CN', secid: '1.600519' },
  '五粮液':   { symbol: '000858', market: 'CN', secid: '0.000858' },
  '泸州老窖': { symbol: '000568', market: 'CN', secid: '0.000568' },
  '山西汾酒': { symbol: '600809', market: 'CN', secid: '1.600809' },
  '洋河股份': { symbol: '002304', market: 'CN', secid: '0.002304' },
  '宁德时代': { symbol: '300750', market: 'CN', secid: '0.300750' },
  '比亚迪':   { symbol: '002594', market: 'CN', secid: '0.002594' },
  '中国平安': { symbol: '601318', market: 'CN', secid: '1.601318' },
  '招商银行': { symbol: '600036', market: 'CN', secid: '1.600036' },
  '平安银行': { symbol: '000001', market: 'CN', secid: '0.000001' },
  '工商银行': { symbol: '601398', market: 'CN', secid: '1.601398' },
  '建设银行': { symbol: '601939', market: 'CN', secid: '1.601939' },
  '农业银行': { symbol: '601288', market: 'CN', secid: '1.601288' },
  '中国银行': { symbol: '601988', market: 'CN', secid: '1.601988' },
  '兴业银行': { symbol: '601166', market: 'CN', secid: '1.601166' },
  '中信证券': { symbol: '600030', market: 'CN', secid: '1.600030' },
  '东方财富': { symbol: '300059', market: 'CN', secid: '0.300059' },
  '中国石油': { symbol: '601857', market: 'CN', secid: '1.601857' },
  '中国神华': { symbol: '601088', market: 'CN', secid: '1.601088' },
  '陕西煤业': { symbol: '601225', market: 'CN', secid: '1.601225' },
  '中远海控': { symbol: '601919', market: 'CN', secid: '1.601919' },
  '中芯国际': { symbol: '688981', market: 'CN', secid: '1.688981' },
  '寒武纪':   { symbol: '688256', market: 'CN', secid: '1.688256' },
  '海光信息': { symbol: '688041', market: 'CN', secid: '1.688041' },
  '中际旭创': { symbol: '300308', market: 'CN', secid: '0.300308' },
  '新易盛':   { symbol: '300502', market: 'CN', secid: '0.300502' },
  '立讯精密': { symbol: '002475', market: 'CN', secid: '0.002475' },
  '韦尔股份': { symbol: '603501', market: 'CN', secid: '1.603501' },
  '北方华创': { symbol: '002371', market: 'CN', secid: '0.002371' },
  '隆基绿能': { symbol: '601012', market: 'CN', secid: '1.601012' },
  '通威股份': { symbol: '600438', market: 'CN', secid: '1.600438' },
  '阳光电源': { symbol: '300274', market: 'CN', secid: '0.300274' },
  '汇川技术': { symbol: '300124', market: 'CN', secid: '0.300124' },
  '药明康德': { symbol: '603259', market: 'CN', secid: '1.603259' },
  '恒瑞医药': { symbol: '600276', market: 'CN', secid: '1.600276' },
  '片仔癀':   { symbol: '600436', market: 'CN', secid: '1.600436' },
  '长江电力': { symbol: '600900', market: 'CN', secid: '1.600900' },
  '美的集团': { symbol: '000333', market: 'CN', secid: '0.000333' },
  '格力电器': { symbol: '000651', market: 'CN', secid: '0.000651' },
  '万科':     { symbol: '000002', market: 'CN', secid: '0.000002' },
  '中国中免': { symbol: '601888', market: 'CN', secid: '1.601888' },
  '伊利股份': { symbol: '600887', market: 'CN', secid: '1.600887' },
  '海天味业': { symbol: '603288', market: 'CN', secid: '1.603288' },
  '牧原股份': { symbol: '002714', market: 'CN', secid: '0.002714' },
  '温氏股份': { symbol: '300498', market: 'CN', secid: '0.300498' },
  '三一重工': { symbol: '600031', market: 'CN', secid: '1.600031' },
  '中国移动': { symbol: '600941', market: 'CN', secid: '1.600941' },
  '紫金矿业': { symbol: '601899', market: 'CN', secid: '1.601899' },
  // ── 港股 ──
  '腾讯控股': { symbol: '00700', market: 'HK', secid: '116.00700' },
  '腾讯':     { symbol: '00700', market: 'HK', secid: '116.00700' },
  '阿里巴巴': { symbol: '09988', market: 'HK', secid: '116.09988' },
  '阿里':     { symbol: '09988', market: 'HK', secid: '116.09988' },
  '美团':     { symbol: '03690', market: 'HK', secid: '116.03690' },
  '小米':     { symbol: '01810', market: 'HK', secid: '116.01810' },
  '京东':     { symbol: '09618', market: 'HK', secid: '116.09618' },
  '快手':     { symbol: '01024', market: 'HK', secid: '116.01024' },
  '网易':     { symbol: '09999', market: 'HK', secid: '116.09999' },
  '百度':     { symbol: '09888', market: 'HK', secid: '116.09888' },
  '药明生物': { symbol: '02269', market: 'HK', secid: '116.02269' },
  '海底捞':   { symbol: '06862', market: 'HK', secid: '116.06862' },
  '农夫山泉': { symbol: '09633', market: 'HK', secid: '116.09633' },
  // ── 美股 ──
  '苹果':     { symbol: 'AAPL', market: 'US', secid: '105.AAPL' },
  '微软':     { symbol: 'MSFT', market: 'US', secid: '105.MSFT' },
  '谷歌':     { symbol: 'GOOGL', market: 'US', secid: '105.GOOGL' },
  '亚马逊':   { symbol: 'AMZN', market: 'US', secid: '105.AMZN' },
  '特斯拉':   { symbol: 'TSLA', market: 'US', secid: '105.TSLA' },
  '英伟达':   { symbol: 'NVDA', market: 'US', secid: '105.NVDA' },
  '脸书':     { symbol: 'META', market: 'US', secid: '105.META' },
  'Meta':     { symbol: 'META', market: 'US', secid: '105.META' },
  '奈飞':     { symbol: 'NFLX', market: 'US', secid: '105.NFLX' },
  '伯克希尔': { symbol: 'BRK-B', market: 'US', secid: '106.BRK-B' },
  '台积电':   { symbol: 'TSM', market: 'US', secid: '106.TSM' },
  '可口可乐': { symbol: 'KO', market: 'US', secid: '106.KO' },
  '麦当劳':   { symbol: 'MCD', market: 'US', secid: '106.MCD' },
  '星巴克':   { symbol: 'SBUX', market: 'US', secid: '105.SBUX' },
  '英特尔':   { symbol: 'INTC', market: 'US', secid: '105.INTC' },
  'AMD':      { symbol: 'AMD', market: 'US', secid: '105.AMD' },
  '高通':     { symbol: 'QCOM', market: 'US', secid: '105.QCOM' },
  '博通':     { symbol: 'AVGO', market: 'US', secid: '105.AVGO' },
  '甲骨文':   { symbol: 'ORCL', market: 'US', secid: '106.ORCL' },
  '迪士尼':   { symbol: 'DIS', market: 'US', secid: '106.DIS' },
  '耐克':     { symbol: 'NKE', market: 'US', secid: '106.NKE' },
  '波音':     { symbol: 'BA', market: 'US', secid: '106.BA' },
  '强生':     { symbol: 'JNJ', market: 'US', secid: '106.JNJ' },
  '辉瑞':     { symbol: 'PFE', market: 'US', secid: '106.PFE' },
  '礼来':     { symbol: 'LLY', market: 'US', secid: '106.LLY' },
  '摩根大通': { symbol: 'JPM', market: 'US', secid: '106.JPM' },
  '高盛':     { symbol: 'GS', market: 'US', secid: '106.GS' },
  '优步':     { symbol: 'UBER', market: 'US', secid: '106.UBER' },
  '拼多多':   { symbol: 'PDD', market: 'US', secid: '105.PDD' },
  '蔚来':     { symbol: 'NIO', market: 'US', secid: '106.NIO' },
  '理想汽车': { symbol: 'LI', market: 'US', secid: '105.LI' },
  '小鹏':     { symbol: 'XPEV', market: 'US', secid: '106.XPEV' },
};

// 出现在问题里但几乎不可能是股票代码的英文词（防止误解析）
const TICKER_STOPWORDS = new Set([
  'AI', 'THE', 'AND', 'ETF', 'IPO', 'PE', 'PB', 'ROE', 'EPS', 'GDP', 'CEO', 'CFO',
  'US', 'UK', 'OK', 'GO', 'NO', 'TO', 'AT', 'ON', 'IN', 'IS', 'IT', 'AS', 'OR',
  'OF', 'BY', 'BE', 'WE', 'HE', 'SHE', 'YOU', 'ARE', 'WAS', 'HAS', 'HAD', 'NOT',
  'BUT', 'FOR', 'WITH', 'FROM', 'THIS', 'THAT', 'THEN', 'THAN', 'WHAT', 'WHEN',
  'WHY', 'HOW', 'MUCH', 'MANY', 'MORE', 'MOST', 'SELL', 'BUY', 'LONG', 'SHORT',
  'RISK', 'FUND', 'LTD', 'INC', 'NYSE', 'NASDAQ', 'USD', 'CNY', 'HKD', 'A股', 'B股',
]);

// ─── 简单 TTL 缓存（带失败负缓存，避免打爆接口） ──────────
const cache = new Map();
const ERROR_TTL_MS = 60000; // 失败后 1 分钟内不再重试同一个 key

function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit) {
    const ttl = hit.error ? ERROR_TTL_MS : ttlMs;
    if (Date.now() - hit.at < ttl) return hit.value;
    cache.delete(key);
  }
  const p = Promise.resolve().then(loader);
  p.then(
    () => cache.set(key, { at: Date.now(), value: p }),
    () => cache.set(key, { at: Date.now(), value: p, error: true }),
  );
  cache.set(key, { at: Date.now(), value: p });
  return p;
}

// ─── 通用请求 ────────────────────────────────────────────
async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MasterDebate/1.0)',
        Accept: 'application/json, text/plain, */*',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ─── 名称/代码解析 ───────────────────────────────────────
const MARKET_BY_CLASS = { AStock: 'CN', HK: 'HK', UsStock: 'US' };

async function searchEastMoney(keyword) {
  const url = `${EM_SUGGEST}?input=${encodeURIComponent(keyword)}&type=14&token=${EM_TOKEN}&count=10`;
  const json = await fetchJson(url);
  const rows = json?.QuotationCodeTable?.Data || [];
  return rows
    .filter((r) => MARKET_BY_CLASS[r.Classify] && r.QuoteID && r.Code)
    .map((r) => ({
      symbol: String(r.Code),
      market: MARKET_BY_CLASS[r.Classify],
      secid: String(r.QuoteID),
      name: r.Name || null,
      exchange: r.SecurityTypeName || null,
    }));
}

function looksLikeAStockCode(t) {
  return /^\d{6}$/.test(t);
}

function secidFromACode(code) {
  // 沪市：6/68/60 开头；深市：0/3 开头
  return code.startsWith('6') ? `1.${code}` : `0.${code}`;
}

// 常见公司名后缀（用于从问题里自动识别词典外的公司）
const COMPANY_SUFFIXES = [
  '集团', '股份', '控股', '科技', '国际', '银行', '证券', '保险', '医药', '生物',
  '电子', '通信', '电力', '钢铁', '汽车', '食品', '传媒', '地产', '航空', '石油',
  '化工', '建设', '发展', '工业', '材料', '物流', '珠宝', '乳业', '电器', '重工',
  '装备', '矿业', '机械', '软件', '信息', '环保', '健康', '医疗', '商业', '贸易',
  '家居', '服装', '纺织', '基建', '半导体', '光伏', '风电', '储能', '氢能', '芯片',
  '面板', '光学', '旅游', '酒店', '餐饮', '调味', '化纤', '塑料', '橡胶', '建材',
  '黄金', '稀土', '煤炭', '天然气', '热力', '燃气', '水务', '港口', '高速', '租赁',
  '期货', '基金', '装饰', '园林', '生态', '新能源', '智能', '数据', '网络', '游戏',
  '啤酒', '白酒', '水泥', '玻璃', '家电', '农牧', '种业', '电梯', '电气', '仪表',
];

// ─── AI 信息层梳理：用 DeepSeek 提取问题里的公司名（比启发式更稳） ───
async function extractCompaniesViaLLM(query) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const prompt = `你是股票信息解析器。只做一件事：从用户问题中提取所有明确提到的公司/股票（A股/港股/美股，可以是中文名、英文代码或数字代码）。规则：只提取明确提到的具体公司，不要猜测、不要联想、不要补充；没有提到任何公司就返回空数组；同一家公司只保留一次。\n只输出一个 JSON 数组，不要任何其他内容，例如：["贵州茅台","英伟达"]\n\n用户问题：${query}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        max_tokens: 200,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr.map((x) => String(x).trim()).filter(Boolean) : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 用 LLM 判断：这个问题是否真的需要某只具体公司的数据才能回答
// （概念/方法论/投资风格/大盘宏观类问题不需要，避免误提示）
async function needsCompanyDataRaw(query) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return false;
  const prompt = `判断下面这个问题，是否必须引用某一只具体股票/公司的实时行情或财务数据，才能很好地回答。\n规则：\n- 概念/术语/方法论/投资风格/体系/仓位管理/大盘宏观/行业整体类问题 → false\n- 问"某只具体股票该不该买/卖/持有、它的估值/财报/行情"但没给公司名 → true\n- 用户提到自己持有的某只票/持仓/重仓/套牢/深套，但没有说明是哪只 → true（例如"我有只股票亏了20%""我套牢了""我的票跌惨了"，即使语气像倾诉也要 true）\n- 问题里已提到具体公司名或代码（如"茅台""英伟达""NVDA"）→ false（这种情况由其他流程处理）\n只输出一个 JSON：{"need": true或false}\n\n问题：${query}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        max_tokens: 40,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return false;
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    const m = text.match(/\{\"need\"\s*:\s*(true|false)\}/);
    return m ? m[1] === 'true' : false;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// 判断问题是否像"涉及某只股票"（用于提示补全公司名）
export const STOCK_QUESTION_RE = /股票|买|卖|持有|仓位|估值|财报|涨|跌|公司|重仓|建仓|加仓|减仓|解套|套牢|亏|赚|分红|走势|股价|大盘|投资|买入|卖出|值得|还能|可以|基本面|护城河|业绩|季报|年报|持仓|补仓|抄底|清仓|换股|选股|推荐|分析/;

export async function needsCompanyData(query) {
  return cached(`needco:${query}`, 3600000, () => needsCompanyDataRaw(query)).catch(() => false);
}


// 从问题文本中提取可能的公司名：
// 1) 按后缀启发式（词典外但带"股份/集团/科技"等后缀的公司）
// 2) 按分隔符分段 + 剥离问法/噪音词（覆盖无后缀公司名，如"中国中车""东方雨虹"）
const SEGMENT_SPLIT = /[，。？！；、,.!?;:：\s]+|和|与|及|或|跟|还有/;
const NOISE_SUFFIXES = [
  '怎么样', '值得长期持有吗', '值得持有吗', '值得买吗', '还能拿吗', '还能买吗',
  '现在能买吗', '现在能拿吗', '可以买吗', '可以持有吗', '哪个更好', '哪个更稳',
  '哪个好', '应该怎么看', '怎么看', '更稳', '更好', '看好', '看空',
  '是否', '相比', '对比', '如何', '现在', '目前', '长期', '持有', '买入', '卖出',
  '重仓', '浮亏', '怎么', '吗', '呢', '吧', '啊', '了', '的', '更', '还', '再',
];
const LEADING_NOISE = [
  '能不能给我讲讲', '能不能给我', '能不能聊聊', '能不能讲一下', '能不能说说',
  '可不可以给我', '可不可以', '能不能', '解读一下', '解读', '分析一下', '分析下',
  '分析', '介绍一下', '介绍', '评价一下', '评价', '聊一下', '聊一聊', '谈谈',
  '谈一下', '说说', '讲一下', '讲讲', '看看', '看一下', '看下', '请问一下',
  '请问', '想问一下', '想问', '我想问', '我想', '大家', '各位', '老师们', '老师',
  '朋友们', '帮我', '给我', '我觉得', '我认为', '现在', '目前',
];
const TAIL_NOISE = [
  '这家公司', '那家公司', '这个公司', '这只股票', '这只票', '这只股', '这只',
  '这个', '那个', '该公司', '该股', '个股', '公司', '股票', '怎么样', '怎么样啊',
];

// 循环剥离问法/噪音词，直到稳定（防止"还值得持有吗"剥完还留个"还"字）
function stripNoise(seg) {
  let prev;
  let guard = 0;
  do {
    prev = seg;
    for (const n of NOISE_SUFFIXES) {
      if (seg.endsWith(n)) { seg = seg.slice(0, -n.length); break; }
    }
    for (const n of LEADING_NOISE) {
      if (seg.startsWith(n)) { seg = seg.slice(n.length); break; }
    }
    for (const n of TAIL_NOISE) {
      if (seg.endsWith(n)) { seg = seg.slice(0, -n.length); break; }
    }
    guard += 1;
  } while (seg !== prev && guard < 8 && seg.length > 0);
  for (const n of ['还', '了', '的', '呢', '吧', '吗', '更', '再', '想', '要', '买', '卖']) {
    if (seg.length > 2 && seg.endsWith(n)) seg = seg.slice(0, -1);
  }
  return seg;
}

function extractCompanyCandidates(query) {
  const found = new Set();

  // 1) 后缀启发式
  for (const suf of COMPANY_SUFFIXES) {
    let idx = query.indexOf(suf);
    while (idx !== -1) {
      let start = idx;
      while (start > 0 && /[\u4e00-\u9fa5]/.test(query[start - 1]) && idx - start < 10) start -= 1;
      const name = query.slice(start, idx + suf.length);
      if (name.length >= 2 && name.length <= 10 && name !== suf) found.add(name);
      idx = query.indexOf(suf, idx + suf.length);
    }
  }

  // 2) 分段 + 剥离问法词（先允许较长片段，剥完再检查长度）
  for (let seg of query.split(SEGMENT_SPLIT)) {
    seg = seg.replace(/[^\u4e00-\u9fa5]/g, '');
    if (seg.length < 2 || seg.length > 20) continue;
    seg = stripNoise(seg);
    for (const n of ['哪个', '什么', '为什么', '如何', '是否']) {
      const i = seg.indexOf(n);
      if (i > 1) seg = seg.slice(0, i);
    }
    seg = stripNoise(seg);
    if (seg.length >= 2 && seg.length <= 8) found.add(seg);
  }

  // 不按子串去重（避免"解读一下双环科技"挤掉"双环科技"），由解析结果按 secid 去重
  const arr = Array.from(found).sort((a, b) => b.length - a.length);
  return arr.slice(0, 5);
}

// 用东财搜索解析任意公司名（优先 A 股，其次港股/美股）
async function resolveName(name) {
  return cached(`resolve:${name}`, 86400000, async () => {
    const list = await searchEastMoney(name);
    if (!list.length) return null;
    const order = ['CN', 'HK', 'US'];
    for (const m of order) {
      const hit = list.find((x) => x.market === m && x.symbol.length <= 6);
      if (hit) return hit;
    }
    return list[0] || null;
  });
}

async function resolveTicker(t) {
  // 用东财搜索解析代码（美股需要知道交易所前缀，A股数字代码可直接推导）
  if (looksLikeAStockCode(t)) {
    return { symbol: t, market: 'CN', secid: secidFromACode(t) };
  }
  return cached(`resolve:${t}`, 86400000, async () => {
    const list = await searchEastMoney(t);
    if (!list.length) return null;
    const exact = list.find((x) => x.symbol.toUpperCase() === t.toUpperCase());
    return exact || list[0];
  });
}

/**
 * 从用户问题中解析出要拉取的公司列表（最多 5 个）
 * @returns {Promise<Array<{symbol, market, secid, name?, source?}>>}
 */
// 用腾讯行情补 A 股代码的真实名称（GBK 解码；失败返回 null）
export async function fetchACodeName(code) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const prefix = /^(60|68|90)/.test(code) ? 'sh' : (/^(00|30|20)/.test(code) ? 'sz' : '');
  if (!prefix) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`https://qt.gtimg.cn/q=${prefix}${code}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', Referer: 'https://gu.qq.com/' },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buf);
    const m = text.match(/v_[a-z]{2}\d{6}="([^"]*)"/);
    if (!m || !m[1]) return null;
    const name = String(m[1].split('~')[1] || '').trim();
    return name || null;
  } catch (e) {
    return null;
  }
}

export async function resolveSymbols(query) {
  if (!query || typeof query !== 'string') return [];
  const q = query.trim();
  // 纯 6 位 A 股代码无需 AI/公司名提取，走代码解析即可（避免每个代码一次 LLM 调用拖慢首载）
  const isPureCode = /^\d{6}$/.test(q);
  const found = new Map(); // secid -> info

  // 0) AI 信息层梳理：先用 LLM 提取公司名（结果按 query 缓存 1 小时）；纯代码跳过
  let llmNames = null;
  if (!isPureCode) {
    try {
      llmNames = await cached(`llmext:${query}`, 3600000, () => extractCompaniesViaLLM(query));
    } catch (e) { /* 忽略，走启发式兜底 */ }
  }
  if (llmNames && llmNames.length) {
    // ST 股防误判：问题里同时出现"ST合力泰"和裸"ST"时，裸 ST 是美股 Sensata 代码，丢弃
    const hasSTName = llmNames.some((n) => /^ST[\u4e00-\u9fa5]/.test(String(n).trim()));
    if (hasSTName) llmNames = llmNames.filter((n) => !/^ST$/i.test(String(n).trim()));
    for (const raw of llmNames.slice(0, 5)) {
      const n = String(raw).trim();
      if (!n) continue;
      try {
        let info = null;
        if (/^\d{6}$/.test(n)) info = await resolveTicker(n);
        else if (/^[A-Za-z][A-Za-z0-9.-]{0,4}$/.test(n)) info = await resolveTicker(n.toUpperCase());
        else info = await resolveName(n);
        if (info && !found.has(info.secid)) found.set(info.secid, { ...info, name: n, source: 'llm' });
      } catch (e) { /* 单个失败不影响其他 */ }
    }
  }

  // 1) 中文名/别名词典匹配（按长度倒序，避免短名先命中）
  const names = Object.keys(COMMON_SYMBOLS).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (query.includes(name)) {
      const info = COMMON_SYMBOLS[name];
      if (!found.has(info.secid)) found.set(info.secid, { ...info, name, source: 'dict' });
    }
  }

  // 2) 英文代码匹配（美股代码 / 数字 A 股代码）
  const hasSTNameInQuery = /ST[\u4e00-\u9fa5]/.test(query.toUpperCase());
  const tickers = new Set();
  const matches = query.match(/\b[A-Z]{2,5}\b/g) || [];
  matches.forEach((t) => {
    if (!TICKER_STOPWORDS.has(t) && !(hasSTNameInQuery && t.toUpperCase() === 'ST')) tickers.add(t);
  });
  const codeMatches = query.match(/\b\d{6}\b/g) || [];
  codeMatches.forEach((c) => {
    if (/^(6|0|3)\d{5}$/.test(c)) tickers.add(c);
  });

  for (const t of tickers) {
    try {
      const info = await resolveTicker(t);
      if (info && !found.has(info.secid)) found.set(info.secid, { ...info, source: 'ticker' });
    } catch (e) {
      // 单个解析失败不影响其他
    }
  }

  // 3) 词典外的中文公司名：按后缀启发式提取 → 东财搜索解析（A股优先）；纯代码跳过
  const companyCandidates = isPureCode ? [] : extractCompanyCandidates(query);
  for (const name of companyCandidates) {
    try {
      const info = await resolveName(name);
      if (info && !found.has(info.secid)) found.set(info.secid, { ...info, name, source: 'name' });
    } catch (e) {
      // 单个解析失败不影响其他
    }
  }

  const list = Array.from(found.values());
  // 兜底补 A 股名称：名称缺失或等于代码本身时，用行情补真实名称
  await Promise.all(list.map(async (info) => {
    if (info.market === 'CN' && (!info.name || /^\d{6}$/.test(String(info.name)))) {
      const nm = await fetchACodeName(info.symbol);
      if (nm) info.name = nm;
    }
  }));
  return list.slice(0, 5);
}

// ─── 实时行情（东方财富） ────────────────────────────────
async function fetchQuoteEM(secid) {
  const fields = 'f43,f57,f58,f59,f60,f116,f162,f167,f170,f127';
  const url = `${EM_QUOTE}?secid=${encodeURIComponent(secid)}&fields=${fields}`;
  const json = await fetchJson(url);
  const d = json?.data;
  if (!d || d.f57 == null) throw new Error('无行情数据');
  const scale = 10 ** (d.f59 ?? 2); // f59 为小数位数
  return {
    symbol: String(d.f57),
    name: d.f58 || null,
    price: d.f43 != null ? d.f43 / scale : null,
    prevClose: d.f60 != null ? d.f60 / scale : null,
    changePct: d.f170 != null ? d.f170 / 100 : null,
    pe: d.f162 && d.f162 > 0 ? d.f162 / 100 : null, // PE 固定两位小数
    pb: d.f167 && d.f167 > 0 ? d.f167 / 100 : null, // PB 固定两位小数
    marketCap: d.f116 || null,
    currency: null,
    industry: d.f127 || null, // 东财行业板块名（如 白酒Ⅱ/通信设备）
  };
}


// 给 Promise 加超时（Yahoo 在某些网络不可达时可能卡住）
export function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Yahoo 请求超时')), ms)),
  ]);
}

// ─── Yahoo Finance（美股/港股补充） ──────────────────────
let yfPromise;
export function getYahoo() {
  if (!yfPromise) {
    yfPromise = import('yahoo-finance2').then(
      (m) => new m.default({ suppressNotices: ['yahooSurvey'] }),
    );
  }
  return yfPromise;
}

async function fetchQuoteYahoo(symbol) {
  const yf = await getYahoo();
  const q = await yf.quote(symbol);
  if (!q || !q.regularMarketPrice) throw new Error('Yahoo 无行情');
  return {
    symbol: q.symbol || symbol,
    name: q.shortName || q.longName || null,
    price: q.regularMarketPrice ?? null,
    changePct: q.regularMarketChangePercent ?? null,
    pe: q.trailingPE ?? q.forwardPE ?? null,
    forwardPe: q.forwardPE ?? null,
    pb: q.priceToBook ?? null,
    marketCap: q.marketCap ?? null,
    dividendYield: q.dividendYield != null ? q.dividendYield * 100 : null,
    fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? null,
    currency: q.currency || null,
  };
}

async function fetchFinancialsYahoo(symbol) {
  const yf = await getYahoo();
  const s = await yf.quoteSummary(symbol, {
    modules: ['financialData', 'defaultKeyStatistics', 'summaryDetail', 'recommendationTrend', 'earningsTrend'],
  });
  const fd = s?.financialData || {};
  const dk = s?.defaultKeyStatistics || {};
  const sd = s?.summaryDetail || {};
  const rt = s?.recommendationTrend?.[0] || {};
  const et = s?.earningsTrend || [];
  const etPick = (p) => et.find((x) => x.period === p) || null;
  const fy = etPick('0y');
  const ny = etPick('+1y') || etPick('1y');
  const forecast = {};
  if (fy?.earningsEstimate?.avg != null) {
    forecast.thisYear = { eps: fy.earningsEstimate.avg, growth: fy.earningsEstimate.growth ?? null, analysts: fy.earningsEstimate.numberOfAnalysts ?? null };
  }
  if (ny?.earningsEstimate?.avg != null) {
    forecast.nextYear = { eps: ny.earningsEstimate.avg, growth: ny.earningsEstimate.growth ?? null, analysts: ny.earningsEstimate.numberOfAnalysts ?? null };
  }
  return {
    source: 'yahoo',
    currency: sd.currency || fd.currency || 'USD',
    revenue: fd.totalRevenue ?? null,
    revenueGrowth: fd.totalRevenueGrowth != null ? fd.totalRevenueGrowth * 100 : null,
    grossMargin: fd.grossMargins != null ? fd.grossMargins * 100 : null,
    operatingMargin: fd.operatingMargins != null ? fd.operatingMargins * 100 : null,
    netMargin: fd.profitMargins != null ? fd.profitMargins * 100 : null,
    roe: fd.returnOnEquity != null ? fd.returnOnEquity * 100 : null,
    roa: fd.returnOnAssets != null ? fd.returnOnAssets * 100 : null,
    freeCashflow: fd.freeCashflow ?? null,
    operatingCashflow: fd.operatingCashflow ?? null,
    eps: dk.trailingEps ?? null,
    forwardEps: dk.forwardEps ?? null,
    bookValue: dk.bookValue ?? null,
    priceToBook: dk.priceToBook ?? null,
    forwardPe: sd.forwardPE ?? null,
    dividendYield: sd.dividendYield != null ? sd.dividendYield * 100 : null,
    beta: sd.beta ?? null,
    targetMeanPrice: fd.targetMeanPrice ?? null,
    recommendationKey: fd.recommendationKey ?? null,
    numberOfAnalystOpinions: fd.numberOfAnalystOpinions ?? null,
    shares: fd.sharesOutstanding ?? null,
    forecast,
  };
}

// ─── 财务数据（A股：东方财富 F10；港股/美股：Yahoo） ─────
function secidToF10Code(secid) {
  const [mkt, code] = String(secid).split('.');
  if (mkt === '1') return `SH${code}`;
  if (mkt === '0') return `SZ${code}`;
  return null;
}

function pickFinancialRow(r) {
  if (!r) return null;
  return {
    reportName: r.REPORT_DATE_NAME || null,
    reportDate: r.REPORT_DATE ? String(r.REPORT_DATE).slice(0, 10) : null,
    revenue: r.TOTALOPERATEREVE ?? null,
    revenueGrowth: r.TOTALOPERATEREVETZ ?? null,
    netProfit: r.PARENTNETPROFIT ?? null,
    netProfitGrowth: r.PARENTNETPROFITTZ ?? null,
    grossMargin: r.XSMLL ?? null,
    netMargin: r.XSJLL ?? null,
    roe: r.ROEJQ ?? null,
    eps: r.EPSJB ?? null,
    bps: r.BPS ?? null,
    cashFlowPerShare: r.MGJYXJJE ?? null,
  };
}

async function fetchFinancialsCN(secid) {
  const code = secidToF10Code(secid);
  if (!code) throw new Error('非 A 股，无 F10');
  const url = `${EM_F10}?type=0&code=${code}`;
  const json = await fetchJson(url, 10000);
  const rows = json?.data || [];
  if (!rows.length) throw new Error('无财务数据');
  const latest = pickFinancialRow(rows[0]);
  const annual = pickFinancialRow(rows.find((r) => r.REPORT_TYPE === '年报') || null);
  return { source: 'eastmoney', latest, annual };
}

// 美股财务主要指标（东财 datacenter，国内可用）
async function resolveEMSecucode(symbol) {
  const params = new URLSearchParams({
    reportName: 'RPT_USF10_INFO_ORGPROFILE',
    columns: 'SECUCODE,SECURITY_CODE',
    filter: `(SECURITY_CODE="${symbol}")`,
    pageNumber: '1', pageSize: '200', source: 'SECURITIES', client: 'PC',
  });
  const json = await fetchJson(`${EM_DATACENTER}?${params}`);
  return json?.result?.data?.[0]?.SECUCODE || null;
}

function pickUSRow(r) {
  if (!r) return null;
  return {
    reportName: r.REPORT_DATA_TYPE || r.REPORT_TYPE || null,
    reportDate: r.REPORT_DATE ? String(r.REPORT_DATE).slice(0, 10) : null,
    revenue: r.OPERATE_INCOME ?? null,
    revenueGrowth: r.OPERATE_INCOME_YOY ?? null,
    netProfit: r.PARENT_HOLDER_NETPROFIT ?? null,
    netProfitGrowth: r.PARENT_HOLDER_NETPROFIT_YOY ?? null,
    grossMargin: r.GROSS_PROFIT_RATIO ?? null,
    netMargin: r.NET_PROFIT_RATIO ?? null,
    roe: r.ROE_AVG ?? null,
    roa: r.ROA ?? null,
    eps: r.BASIC_EPS ?? null,
    debtAssetRatio: r.DEBT_ASSET_RATIO ?? null,
  };
}

async function fetchFinancialsUS(symbol) {
  const secucode = await cached(`ussecu:${symbol}`, 86400000, () => resolveEMSecucode(symbol));
  if (!secucode) throw new Error('美股无财务代码');
  const params = new URLSearchParams({
    reportName: 'RPT_USF10_FN_GMAININDICATOR',
    columns: 'USF10_FN_GMAININDICATOR',
    filter: `(SECUCODE="${secucode}")`,
    pageNumber: '1', pageSize: '12', sortTypes: '-1', sortColumns: 'REPORT_DATE',
    source: 'SECURITIES', client: 'PC',
  });
  const json = await fetchJson(`${EM_DATACENTER}?${params}`);
  const rows = json?.result?.data || [];
  if (!rows.length) throw new Error('美股无财务数据');
  const QUARTER_CODES = ['003', '006', '007', '008']; // 单季报
  const latestRow = rows.find((r) => QUARTER_CODES.includes(String(r.DATE_TYPE_CODE))) || rows[0];
  return {
    source: 'eastmoney-us',
    currency: rows[0].CURRENCY_ABBR || 'USD',
    latest: pickUSRow(latestRow),
    annual: pickUSRow(rows.find((r) => String(r.DATE_TYPE_CODE) === '001') || null),
  };
}

// 港股财务主要指标（东财 datacenter，国内可用）
function pickHKRow(r) {
  if (!r) return null;
  return {
    reportName: r.REPORT_TYPE || null,
    reportDate: r.REPORT_DATE ? String(r.REPORT_DATE).slice(0, 10) : null,
    revenue: r.OPERATE_INCOME ?? null,
    revenueGrowth: r.OPERATE_INCOME_YOY ?? null,
    netProfit: r.HOLDER_PROFIT ?? null,
    netProfitGrowth: r.HOLDER_PROFIT_YOY ?? null,
    grossMargin: r.GROSS_PROFIT_RATIO ?? null,
    netMargin: r.NET_PROFIT_RATIO ?? null,
    roe: r.ROE_AVG ?? null,
    eps: r.BASIC_EPS ?? null,
    bps: r.BPS ?? null,
    epsTTM: r.EPS_TTM ?? null,
  };
}

async function fetchFinancialsHK(symbol) {
  const code = String(symbol).padStart(5, '0');
  const params = new URLSearchParams({
    reportName: 'RPT_HKF10_FN_MAININDICATOR',
    columns: 'ALL',
    filter: `(SECUCODE="${code}.HK")`,
    pageNumber: '1', pageSize: '12', sortTypes: '-1', sortColumns: 'REPORT_DATE',
    source: 'HSF10', client: 'PC',
  });
  const json = await fetchJson(`${EM_DATACENTER}?${params}`);
  const rows = json?.result?.data || [];
  if (!rows.length) throw new Error('港股无财务数据');
  const QUARTER_CODES = ['003', '006', '007', '008'];
  const latestRow = rows.find((r) => QUARTER_CODES.includes(String(r.DATE_TYPE_CODE))) || rows[0];
  return {
    source: 'eastmoney-hk',
    currency: 'HKD',
    latest: pickHKRow(latestRow),
    annual: pickHKRow(rows.find((r) => String(r.DATE_TYPE_CODE) === '001') || null),
  };
}

// ─── A股 业绩预告（如已披露） ───
async function fetchPreannouncementCN(secid) {
  const code = String(secid).split('.')[1];
  const params = new URLSearchParams({
    reportName: 'RPT_PUBLIC_OP_NEWPREDICT',
    columns: 'ALL',
    filter: `(SECURITY_CODE="${code}")`,
    pageNumber: '1', pageSize: '6', sortTypes: '-1', sortColumns: 'REPORT_DATE',
    source: 'WEB', client: 'PC',
  });
  const json = await fetchJson(`${EM_DATACENTER_WEB}?${params}`);
  const rows = json?.result?.data || [];
  if (!rows.length) return null;
  const latest = rows[0]; // 已按报告期倒序
  return {
    reportPeriod: latest.REPORT_DATE ? String(latest.REPORT_DATE).slice(0, 10) : null,
    noticeDate: latest.NOTICE_DATE ? String(latest.NOTICE_DATE).slice(0, 10) : null,
    type: latest.PREDICT_TYPE || null,
    finance: latest.PREDICT_FINANCE || null,
    content: latest.PREDICT_CONTENT || null,
    amtLow: latest.PREDICT_AMT_LOWER ?? null,
    amtHigh: latest.PREDICT_AMT_UPPER ?? null,
    ampLow: latest.ADD_AMP_LOWER ?? null,
    ampHigh: latest.ADD_AMP_UPPER ?? null,
  };
}

// ─── A股 机构一致预期（未来 1-3 年盈利预测 + 综合评级） ───
async function fetchConsensusCN(secid) {
  const code = secidToF10Code(secid);
  if (!code) return null;
  const url = `https://emweb.securities.eastmoney.com/PC_HSF10/ProfitForecast/PageAjax?code=${code}`;
  const json = await fetchJson(url, 10000);
  const chart = json?.yctj_chart || [];
  const pjtj = json?.pjtj?.[0] || null;
  if (!chart.length && !pjtj) return null;
  return {
    rating: pjtj?.COMPRE_RATING || null,
    orgCount: pjtj?.RATING_ORG_NUM ?? null,
    buyCount: pjtj?.RATING_BUY_NUM ?? null,
    forecasts: chart.map((r) => ({
      year: r.YEAR,
      mark: r.YEAR_MARK,
      eps: r.EPS ?? null,
      epsGrowth: r.EPS_RATIO ?? null,
      pe: r.PE ?? null,
      roe: r.ROE ?? null,
      netProfit: r.PARENT_NETPROFIT ?? null,
      netProfitGrowth: r.PARENT_NETPROFIT_RATIO ?? null,
      revenue: r.TOTAL_OPERATE_INCOME ?? null,
      revenueGrowth: r.TOTAL_OPERATE_INCOME_RATIO ?? null,
    })),
  };
}

/**
 * 未来/前瞻数据：A股=业绩预告+机构一致预期；美股/港股=Yahoo earningsTrend（生产环境）
 */
export async function getForecast(info) {
  if (info.market === 'CN') {
    const [pre, consensus] = await Promise.all([
      cached(`pre:${info.secid}`, 3600000, () => fetchPreannouncementCN(info.secid)).catch(() => null),
      cached(`consensus:${info.secid}`, 3600000, () => fetchConsensusCN(info.secid)).catch(() => null),
    ]);
    return { preannouncement: pre, consensus };
  }
  return null;
}

// ─── 对外主入口：行情 + 财务 ─────────────────────────────
/**
 * 获取单只股票的行情（东财为主，美股/港股用 Yahoo 补字段）
 */
// ─── 大盘环境快照（指数点位/涨跌幅/成交额/沪市涨跌家数） ──────
const EM_INDICES = [
  { secid: '1.000001', name: '上证指数' },
  { secid: '0.399001', name: '深证成指' },
  { secid: '0.399006', name: '创业板指' },
  { secid: '1.000688', name: '科创50' },
];

function fmtYi(v) {
  if (v == null || !isFinite(Number(v))) return '';
  const n = Number(v);
  return n >= 1e8 ? `${(n / 1e8).toFixed(0)}亿` : `${n.toLocaleString()}`;
}

async function fetchIndexQuote(secid) {
  const fields = 'f2,f3,f4,f6,f12,f14,f104,f105,f106';
  const url = `${EM_QUOTE}?secid=${encodeURIComponent(secid)}&fields=${fields}&fltt=2`;
  const json = await fetchJson(url);
  const d = json?.data;
  if (!d || d.f12 == null) throw new Error('无指数数据');
  return {
    code: String(d.f12),
    name: d.f14 || null,
    price: d.f2,
    changePct: d.f3,
    amount: d.f6,   // 成交额（元）
    up: d.f104,     // 上涨家数
    down: d.f105,   // 下跌家数
    flat: d.f106,   // 平盘家数
  };
}

/**
 * 大盘环境文本：三大指数 + 科创50 点位/涨跌幅/成交额，上证口径涨跌家数。
 * 任一指数失败自动跳过；全部失败返回空串（不影响主快照）。
 */
export async function getMarketOverview() {
  const results = await Promise.allSettled(EM_INDICES.map((i) => fetchIndexQuote(i.secid)));
  const lines = [];
  let upDown = '';
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    const q = r.value;
    const pct = q.changePct != null ? `${Number(q.changePct) > 0 ? '+' : ''}${Number(q.changePct).toFixed(2)}%` : '—';
    const amt = q.amount ? ` 成交额 ${fmtYi(q.amount)}` : '';
    lines.push(`${q.name || q.code} ${q.price ?? '—'}（${pct}）${amt}`);
    if (q.up != null && q.down != null && !upDown) {
      upDown = `沪市 上涨 ${q.up} / 下跌 ${q.down} / 平盘 ${q.flat ?? 0}`;
    }
  }
  if (upDown) lines.push(upDown);
  return lines.join('\n');
}

export async function getQuote(info) {
  let em = null;
  try {
    em = await cached(`quote:${info.secid}`, 180000, () => fetchQuoteEM(info.secid));
  } catch (e) {
    // 东财失败则继续尝试 Yahoo
  }
  if (info.market === 'CN') return em;
  try {
    const y = await withTimeout(cached(`yquote:${info.symbol}`, 180000, () => fetchQuoteYahoo(info.symbol)), 2500);
    if (em) return { ...em, ...y };
    return y;
  } catch (e) {
    return em;
  }
}

/**
 * 获取单只股票的财务快照（A股：东财 F10；港股/美股：Yahoo，失败返回 null）
 */
export async function getFinancials(info) {
  if (info.market === 'CN') {
    return cached(`fin:${info.secid}`, 1800000, () => fetchFinancialsCN(info.secid));
  }
  if (info.market === 'HK') {
    return cached(`finhk:${info.symbol}`, 1800000, () => fetchFinancialsHK(info.symbol));
  }
  if (info.market === 'US') {
    const base = await cached(`finus:${info.symbol}`, 1800000, () => fetchFinancialsUS(info.symbol));
    // 生产环境用 Yahoo 补充分析师目标价/评级（国内不可达时忽略）
    try {
      const y = await withTimeout(cached(`yfin:${info.symbol}`, 3600000, () => fetchFinancialsYahoo(info.symbol)), 3000);
      if (y) {
        return {
          ...base,
          targetMeanPrice: y.targetMeanPrice,
          recommendationKey: y.recommendationKey,
          numberOfAnalystOpinions: y.numberOfAnalystOpinions,
          freeCashflow: y.freeCashflow,
          yahooNetMargin: y.netMargin,
          shares: yfShares,
        };
      }
    } catch (e) { /* 忽略 */ }
    return base;
  }
  return null;
}
