// 财报侦查诊断（A 股版）
// 目标：为「芒格教你读财报」提供可追溯的证据包，先侦查问题，再让芒格解释。
// 数据源：东方财富公开三表 + 主要指标 + 年报/审计报告公告正文。
import { resolveSymbols, withTimeout } from './marketData.js';
import { getFinHistory, getMainBusiness, getIndustry } from './uziSkills.js';
import { fetchPdfText } from '../../../lib/pdfText.js';

const EM_DATA = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const EM_ANN = 'https://np-anotice-stock.eastmoney.com/api/security/ann';
const EM_ANN_CONTENT = 'https://np-cnotice-stock.eastmoney.com/api/content/ann';
const UA = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
};

const cache = new Map();
const ERROR_TTL_MS = 60000;

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

async function fetchJsonOnce(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('请求超时');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = 12000) {
  try {
    return await fetchJsonOnce(url, timeoutMs);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 250));
    return fetchJsonOnce(url, timeoutMs);
  }
}

const num = (v) => {
  if (v == null || v === '' || Number.isNaN(Number(v))) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const yi = (v) => (num(v) == null ? null : num(v) / 1e8);
const ratio = (a, b) => (num(a) == null || num(b) == null || Number(b) === 0 ? null : num(a) / num(b));
const growth = (cur, prev) => {
  const c = num(cur);
  const p = num(prev);
  if (c == null || p == null || p === 0) return null;
  return ((c - p) / Math.abs(p)) * 100;
};
const fmtYi = (v) => {
  const n = yi(v);
  if (n == null) return null;
  const abs = Math.abs(n);
  return `${n.toFixed(abs >= 100 ? 1 : 2)}亿`;
};
const fmtPct = (v, digits = 1) => (num(v) == null ? null : `${num(v) > 0 ? '+' : ''}${num(v).toFixed(digits)}%`);
const fmtRatio = (v, digits = 2) => (num(v) == null ? null : num(v).toFixed(digits));
const first = (...vs) => vs.find((v) => v != null && v !== '');
const avgBalance = (cur, prev) => (num(cur) == null || num(prev) == null ? null : (num(cur) + num(prev)) / 2);
const turnoverDays = (cur, prev, flow) => {
  const avg = avgBalance(cur, prev);
  const base = num(flow);
  if (avg == null || base == null || base <= 0) return null;
  return (avg / base) * 365;
};

function secucode(info) {
  const suffix = String(info.secid || '').startsWith('1.') ? 'SH' : 'SZ';
  return `${info.symbol}.${suffix}`;
}

function pickRows(rows, annualOnly = false) {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .filter((r) => r && (!annualOnly || /年报|年度/.test(String(r.REPORT_TYPE || r.REPORT_DATE_NAME || r.reportType || r.reportName || ''))))
    .sort((a, b) => String(a.REPORT_DATE || '').localeCompare(String(b.REPORT_DATE || '')));
}

function joinStatements(balanceRows, incomeRows, cashRows) {
  const map = new Map();
  const put = (rows, mapper) => {
    for (const raw of rows || []) {
      const date = raw.REPORT_DATE ? String(raw.REPORT_DATE).slice(0, 10) : null;
      if (!date) continue;
      const row = map.get(date) || { reportDate: date };
      Object.assign(row, mapper(raw));
      map.set(date, row);
    }
  };
  put(balanceRows, (r) => ({
    reportName: r.REPORT_DATE_NAME || null,
    reportType: r.REPORT_TYPE || null,
    auditOpinion: r.OPINION_TYPE || null,
    cash: num(r.MONETARYFUNDS),
    accountsReceivable: num(r.NOTE_ACCOUNTS_RECE),
    otherReceivables: first(num(r.TOTAL_OTHER_RECE), num(r.OTHER_RECE)),
    inventory: num(r.INVENTORY),
    contractLiab: first(num(r.CONTRACT_LIAB), num(r.ADVANCE_RECEIVABLES)),
    goodwill: num(r.GOODWILL),
    fixedAssets: num(r.FIXED_ASSET),
    cip: num(r.CIP),
    intangibleAssets: num(r.INTANGIBLE_ASSET),
    totalAssets: num(r.TOTAL_ASSETS),
    totalLiabilities: num(r.TOTAL_LIABILITIES),
    parentEquity: num(r.TOTAL_PARENT_EQUITY),
    totalEquity: num(r.TOTAL_EQUITY),
    shortLoan: num(r.SHORT_LOAN),
    currentDebt: num(r.NONCURRENT_LIAB_1YEAR),
    longLoan: num(r.LONG_LOAN),
    bondPayable: num(r.BOND_PAYABLE),
    shortBond: num(r.SHORT_BOND_PAYABLE),
    leaseLiab: num(r.LEASE_LIAB),
  }));
  put(incomeRows, (r) => ({
    reportName: r.REPORT_DATE_NAME || null,
    reportType: r.REPORT_TYPE || null,
    revenue: first(num(r.OPERATE_INCOME), num(r.TOTAL_OPERATE_INCOME)),
    totalRevenue: num(r.TOTAL_OPERATE_INCOME),
    operatingCost: num(r.OPERATE_COST),
    operatingProfit: num(r.OPERATE_PROFIT),
    netProfit: num(r.PARENT_NETPROFIT),
    totalNetProfit: num(r.NETPROFIT),
    deductNetProfit: num(r.DEDUCT_PARENT_NETPROFIT),
    interestIncome: first(num(r.FE_INTEREST_INCOME), num(r.INTEREST_INCOME)),
    interestExpense: first(num(r.FE_INTEREST_EXPENSE), num(r.INTEREST_EXPENSE)),
    researchExpense: num(r.RESEARCH_EXPENSE),
    sellingExpense: num(r.SALE_EXPENSE),
    adminExpense: num(r.MANAGE_EXPENSE),
    incomeTax: num(r.INCOME_TAX),
  }));
  put(cashRows, (r) => ({
    ocf: num(r.NETCASH_OPERATE),
    capex: num(r.CONSTRUCT_LONG_ASSET),
    depreciation: first(num(r.FA_IR_DEPR), num(r.OILGAS_BIOLOGY_DEPR)),
    salesCash: num(r.SALES_SERVICES),
    borrowIn: num(r.RECEIVE_LOAN_CASH),
    debtRepay: num(r.PAY_DEBT_CASH),
    investNet: num(r.NETCASH_INVEST),
    financeNet: num(r.NETCASH_FINANCE),
  }));
  return [...map.values()].sort((a, b) => String(a.reportDate).localeCompare(String(b.reportDate)));
}

async function fetchStatement(reportName, info) {
  const p = new URLSearchParams({
    reportName,
    columns: 'ALL',
    filter: `(SECUCODE="${secucode(info)}")`,
    sortColumns: 'REPORT_DATE',
    sortTypes: '-1',
    pageNumber: '1',
    pageSize: '16',
    source: 'HSF10',
    client: 'PC',
  });
  const json = await fetchJson(`${EM_DATA}?${p}`);
  return json?.result?.data || [];
}

async function loadStatementBundle(info) {
  if (!info || info.market !== 'CN') return null;
  return cached(`forensics:statements:${info.secid}`, 12 * 3600000, async () => {
    const [balance, income, cash] = await Promise.all([
      fetchStatement('RPT_F10_FINANCE_GBALANCE', info),
      fetchStatement('RPT_F10_FINANCE_GINCOME', info),
      fetchStatement('RPT_F10_FINANCE_GCASHFLOW', info),
    ]);
    return joinStatements(balance, income, cash);
  });
}

function normalizeSpace(text) {
  return String(text || '')
    .replace(/\u0000/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function contextScore(text) {
  const numbers = text.match(/\d[\d,.]*/g) || [];
  const riskWords = text.match(/坏账|跌价|减值|关联|占用|诉讼|担保|承诺|账龄|前五名|异常|下降|上升/g) || [];
  return numbers.length * 2 + riskWords.length * 3;
}

function extractBestContexts(text, rule, limit = 1) {
  const src = normalizeSpace(text);
  if (!src || !rule || !rule.re) return [];
  const flags = rule.re.flags.includes('g') ? rule.re.flags : `${rule.re.flags}g`;
  const re = new RegExp(rule.re.source, flags);
  const hits = [];
  let m;
  let guard = 0;
  while ((m = re.exec(src)) && guard < 80) {
    guard += 1;
    const start = Math.max(0, m.index - 260);
    const end = Math.min(src.length, m.index + m[0].length + (rule.window || 1500));
    const ctx = src.slice(start, end).trim();
    if (!ctx) continue;
    hits.push({ at: m.index, ctx: ctx.slice(0, rule.maxLen || 1900), score: contextScore(ctx) });
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  const seen = new Set();
  return hits
    .sort((a, b) => b.score - a.score || b.at - a.at)
    .filter((x) => {
      const key = x.ctx.slice(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((x) => x.ctx);
}

const NOTE_RULES = [
  {
    key: 'receivables',
    label: '应收账款与坏账准备',
    re: /应收账款.{0,80}(?:账龄|坏账准备|前五名|欠款方|信用政策)/g,
    keywords: ['账龄', '坏账准备', '前五名', '欠款方'],
    window: 1700,
  },
  {
    key: 'inventory',
    label: '存货与跌价准备',
    re: /存货.{0,80}(?:跌价准备|可变现净值|库龄|周转|在产品|库存商品)/g,
    keywords: ['跌价准备', '可变现净值', '库龄', '周转'],
    window: 1700,
  },
  {
    key: 'contractLiab',
    label: '合同负债',
    re: /合同负债.{0,80}(?:余额|主要|预收|变动|客户)/g,
    keywords: ['合同负债', '余额', '预收', '客户'],
    window: 1300,
  },
  {
    key: 'otherReceivable',
    label: '其他应收款与资金占用',
    re: /其他应收款.{0,80}(?:款项性质|账龄|坏账准备|关联方|资金占用|往来款)/g,
    keywords: ['款项性质', '账龄', '关联方', '资金占用', '往来款'],
    window: 1700,
  },
  {
    key: 'goodwill',
    label: '商誉与减值测试',
    re: /商誉.{0,80}(?:减值|资产组|业绩承诺|收购|可收回金额)/g,
    keywords: ['减值', '资产组', '业绩承诺', '可收回金额'],
    window: 1800,
  },
  {
    key: 'capex',
    label: '在建工程与资本开支',
    re: /(?:在建工程|资本性支出|购建固定资产).{0,100}(?:进度|投入|产能|转固|项目|折旧)/g,
    keywords: ['进度', '投入', '产能', '转固', '项目'],
    window: 1400,
  },
  {
    key: 'relatedParty',
    label: '关联交易与担保',
    re: /(?:关联交易|关联方交易).{0,100}(?:销售|采购|担保|资金|应收|应付)/g,
    keywords: ['关联交易', '担保', '资金', '销售', '采购'],
    window: 1700,
  },
  {
    key: 'accountingPolicy',
    label: '会计政策与会计估计',
    re: /(?:会计政策变更|重要会计政策|会计估计变更).{0,100}(?:原因|影响|折旧|坏账|收入确认|减值)/g,
    keywords: ['会计政策变更', '会计估计变更', '折旧', '坏账', '收入确认'],
    window: 1500,
  },
  {
    key: 'audit',
    label: '关键审计事项',
    re: /关键审计事项.{0,120}(?:收入确认|应收账款|存货|商誉|关联方|减值)/g,
    keywords: ['关键审计事项', '收入确认', '应收账款', '存货', '商誉'],
    window: 2000,
  },
];

function extractNoteSections(text) {
  const sections = [];
  for (const rule of NOTE_RULES) {
    const contexts = extractBestContexts(text, rule, 1);
    if (contexts.length) sections.push({ key: rule.key, label: rule.label, text: contexts[0] });
  }
  return sections;
}

async function fetchAnnouncementList(info) {
  return cached(`forensics:ann:${info.secid}`, 24 * 3600000, async () => {
    const p = new URLSearchParams({
      sr: '-1',
      page_size: '100',
      page_index: '1',
      ann_type: 'A',
      client_source: 'web',
      stock_list: info.symbol,
      f_node: '0',
      s_node: '0',
    });
    const json = await fetchJson(`${EM_ANN}?${p}`);
    return json?.data?.list || [];
  });
}

function pickAnnouncement(list, kind) {
  const rows = Array.isArray(list) ? list : [];
  if (kind === 'annual') {
    return rows.find((x) => {
      const t = String(x.title || '');
      return /年度报告$|年年度报告$/.test(t) && !/摘要|英文|更正|补充|取消|业绩/.test(t);
    }) || null;
  }
  return rows.find((x) => {
    const t = String(x.title || '');
    return /(?:年度)?审计报告$/.test(t) && !/内部控制|摘要|英文|更正|补充|取消/.test(t);
  }) || null;
}

async function fetchAnnouncementContent(artCode, pageIndex = 1) {
  const p = new URLSearchParams({
    art_code: artCode,
    client_source: 'web',
    page_index: String(pageIndex),
  });
  const json = await fetchJson(`${EM_ANN_CONTENT}?${p}`);
  return json?.data || null;
}

async function fetchAuditFallback(artCode) {
  if (!artCode) return { text: '', source: null };
  try {
    const meta = await fetchAnnouncementContent(artCode, 1);
    if (!meta) return { text: '', source: null };
    const pageSize = Math.min(Number(meta.page_size || 1), 8);
    const pages = [meta.notice_content || ''];
    if (pageSize > 1) {
      const rest = await Promise.all(
        Array.from({ length: pageSize - 1 }, (_, i) => i + 2)
          .map((idx) => fetchAnnouncementContent(artCode, idx).then((x) => x?.notice_content || '').catch(() => '')),
      );
      pages.push(...rest);
    }
    return {
      text: normalizeSpace(pages.filter(Boolean).join('\n')),
      source: {
        title: meta.notice_title || '审计报告',
        date: meta.notice_date ? String(meta.notice_date).slice(0, 10) : null,
        url: meta.attach_url || null,
      },
    };
  } catch (e) {
    return { text: '', source: null };
  }
}

async function loadFilingEvidence(reportText, info) {
  const localSections = extractNoteSections(reportText);
  if (localSections.length >= 3) {
    return {
      sourceType: 'user-report',
      title: '用户提供的财报文本',
      date: null,
      url: null,
      sections: localSections,
      sources: [{ type: 'file', title: '用户提供的财报文本', date: null, url: null }],
    };
  }

  return cached(`forensics:filing:${info.secid}`, 7 * 24 * 3600000, async () => {
    const list = await fetchAnnouncementList(info);
    const annual = pickAnnouncement(list, 'annual');
    const audit = pickAnnouncement(list, 'audit');
    const sources = [];
    let title = annual?.title || null;
    let date = annual?.notice_date ? String(annual.notice_date).slice(0, 10) : null;
    let url = null;
    let text = '';

    if (annual?.art_code) {
      try {
        const meta = await fetchAnnouncementContent(annual.art_code, 1);
        url = meta?.attach_url || meta?.attach_url_web || null;
        title = meta?.notice_title || title;
        date = meta?.notice_date ? String(meta.notice_date).slice(0, 10) : date;
        if (url) text = await fetchPdfText(url, { timeoutMs: 22000, maxBytes: 30 * 1024 * 1024, headPages: 12, tailRatio: 0.68 });
        if (!text && meta?.notice_content) text = normalizeSpace(meta.notice_content);
      } catch (e) { /* 年报正文失败后继续用审计报告兜底 */ }
      if (title || url) sources.push({ type: 'annual-report', title, date, url });
    }

    let sections = extractNoteSections(text);
    if (!sections.length && audit?.art_code) {
      const fallback = await fetchAuditFallback(audit.art_code);
      if (fallback.text) sections = extractNoteSections(fallback.text);
      if (fallback.source) sources.push({ type: 'audit-report', ...fallback.source });
    }
    if (audit?.art_code && !sources.some((s) => s.type === 'audit-report')) {
      const auditMeta = await fetchAnnouncementContent(audit.art_code, 1).catch(() => null);
      sources.push({
        type: 'audit-report',
        title: auditMeta?.notice_title || audit.title,
        date: auditMeta?.notice_date ? String(audit.notice_date).slice(0, 10) : (audit.notice_date ? String(audit.notice_date).slice(0, 10) : null),
        url: auditMeta?.attach_url || auditMeta?.attach_url_web || null,
      });
    }

    return {
      sourceType: 'announcement',
      title,
      date,
      url,
      sections,
      sources,
    };
  });
}

function businessModelText(mainBusiness, industry) {
  const bits = [];
  if (industry?.emIndustry) bits.push(`东财行业：${industry.emIndustry}`);
  if (industry?.csrcIndustry) bits.push(`证监会行业：${industry.csrcIndustry}`);
  if (mainBusiness?.byProduct?.length) {
    bits.push(`产品结构（${mainBusiness.reportDate || '最新期'}）：${mainBusiness.byProduct.slice(0, 5).map((x) => `${x.name}${x.ratioPct != null ? ` ${x.ratioPct}%` : ''}`).join('、')}`);
  }
  if (mainBusiness?.byRegion?.length) {
    bits.push(`地区结构（${mainBusiness.reportDate || '最新期'}）：${mainBusiness.byRegion.slice(0, 4).map((x) => `${x.name}${x.ratioPct != null ? ` ${x.ratioPct}%` : ''}`).join('、')}`);
  }
  return bits.join('\n') || '行业与业务结构证据不足，需结合年报经营情况进一步确认。';
}

// 将结构化 seed 翻译成 PRD 要求的“侦查问题 + 下一步核查”。
// seed 仍然只保存可取证的财务事实，问题与动作模板在这里统一收口，避免 AI 自行改口径。
const QUESTION_META = {
  ocfNp: {
    question: '利润为什么没有变成现金？',
    nextCheck: { what: '查现金流量表附注、应收、合同资产和存货', lookAt: '看销售商品收现与营收、净利润的匹配度', judge: '判断利润主要卡在应收、合同资产还是存货' },
  },
  fcf: {
    question: '公司投入资本后还能留下多少自由现金？',
    nextCheck: { what: '查购建固定资产、无形资产和其他长期资产支付的现金', lookAt: '看自由现金流、在建工程转固与折旧变化', judge: '判断资本开支是否形成有效产能和现金回报' },
  },
  deduct: {
    question: '净利润是不是依赖非主营收益？',
    nextCheck: { what: '查非经常性损益明细', lookAt: '看政府补助、投资收益、资产处置等占比', judge: '判断利润是否主要来自主营经营' },
  },
  margins: {
    question: '盈利能力的变化来自哪里？',
    nextCheck: { what: '查分产品、分地区收入成本与毛利率', lookAt: '看价格、产品结构、原材料与产能利用率', judge: '判断毛利率变化来自经营改善、成本波动还是结构变化' },
  },
  receivables: {
    question: '收入增长是不是透支了应收？',
    nextCheck: { what: '查应收账款、应收票据和合同资产附注', lookAt: '看账龄、坏账准备、前五名客户和期后回款', judge: '判断收入增长是否伴随回款压力' },
  },
  inventory: {
    question: '存货增长是否与真实需求匹配？',
    nextCheck: { what: '查存货明细、跌价准备和产能利用情况', lookAt: '看库龄、产成品占比、产品价格与销量', judge: '判断存货增长是正常备货还是需求转弱' },
  },
  salesCash: {
    question: '销售回款与收入是否匹配？',
    nextCheck: { what: '查现金流量表和合同资产变动', lookAt: '看销售商品收现、应收票据及其他应收款', judge: '判断收入含金量与回款链条是否完整' },
  },
  contractLiab: {
    question: '合同负债能否支撑后续收入？',
    nextCheck: { what: '查合同负债、在手订单和收入确认政策', lookAt: '看预收款与收入、订单之间的领先关系', judge: '判断未来收入能否顺畅确认' },
  },
  cashDebt: {
    question: '账面现金能否覆盖真实债务压力？',
    nextCheck: { what: '查货币资金、有息负债与担保质押附注', lookAt: '看受限资金、债务期限和偿付安排', judge: '判断账面现金对真实债务的覆盖能力' },
  },
  cashYield: {
    question: '账面货币资金是否产生了合理收益？',
    nextCheck: { what: '查货币资金结构和利息收入明细', lookAt: '看定期存款、理财、受限资金和平均余额', judge: '判断资金收益是否与账面规模匹配' },
  },
  goodwill: {
    question: '商誉是否存在减值敏感点？',
    nextCheck: { what: '查商誉减值测试和并购标的业绩承诺', lookAt: '看现金流预测、折现率和承诺完成度', judge: '判断商誉是否存在需要升级处理的减值风险' },
  },
  capexDep: {
    question: '资本开支是在扩张还是在维持经营？',
    nextCheck: { what: '查在建工程、固定资产和资本开支附注', lookAt: '看项目进度、转固时点和折旧变化', judge: '判断资本开支是扩张性投入还是维持性补漏' },
  },
  fixedAssets: {
    question: '固定资产扩张是否转化为收入？',
    nextCheck: { what: '查固定资产、在建工程和产能利用数据', lookAt: '看新增产能投产后的收入与利润', judge: '判断资产扩张是否转化为有效回报' },
  },
  returns: {
    question: '公司真实资本回报率如何？',
    nextCheck: { what: '查 ROE 拆解和资本成本口径', lookAt: '看净利率、总资产周转率、权益乘数与有息负债', judge: '判断回报来自经营效率还是财务杠杆' },
  },
  audit: {
    question: '审计意见是否留下需要继续核查的事项？',
    nextCheck: { what: '查审计报告和关键审计事项', lookAt: '看强调事项、保留意见基础及持续经营段落', judge: '判断审计意见是否留下需要升级处理的线索' },
  },
};

function splitNextStep(nextStep) {
  const text = String(nextStep || '').replace(/\s+/g, ' ').trim();
  if (!text) return { what: '补充年报附注或结构化财务数据', lookAt: '看关键科目的变化和口径', judge: '判断当前异常是否持续' };
  const parts = text.split(/\s*(?:→|->|；|;)\s*/).filter(Boolean);
  if (parts.length >= 3) return { what: parts[0], lookAt: parts[1], judge: parts.slice(2).join('；') };
  return { what: text, lookAt: '看相关附注、历史趋势和现金流量', judge: '判断当前信号是短期波动还是持续性问题' };
}

function classifyCashFlowChange(current, prev) {
  const c = num(current);
  const p = num(prev);
  if (c == null || p == null) return null;
  if (c < 0 && p >= 0) return { kind: 'first-adverse' };
  if (c >= 0 && p < 0) return { kind: 'improve' };
  if (c < 0 && p < 0) {
    const relative = Math.abs(p) > 0 ? (c - p) / Math.abs(p) : 0;
    if (relative > 0.15) return { kind: 'improve', magnitude: relative };
    if (relative < -0.15) return { kind: 'worsen', magnitude: relative };
    return { kind: 'persistent' };
  }
  const relative = Math.abs(p) > 0 ? (c - p) / Math.abs(p) : 0;
  if (relative > 0.15) return { kind: 'improve', magnitude: relative };
  if (relative < -0.15) return { kind: 'worsen', magnitude: relative };
  return { kind: 'persistent' };
}

function priorityForSeed(seed) {
  const priority = seed.priorityHint || 'P1';
  const kind = seed.change?.kind;
  if (kind === 'first-adverse' || kind === 'worsen') return 'P0';
  if (kind === 'improve') return seed.statusHint === 'high' ? 'P0' : 'P1';
  if (seed.statusHint === 'normal') return 'P2';
  if (seed.statusHint === 'insufficient') return priority === 'P0' ? 'P1' : 'P2';
  if (priority === 'P0') return 'P1';
  return priority;
}

function questionForSeed(seed) {
  if (seed.question) return seed.question;
  const kind = seed.change?.kind;
  if (seed.key === 'ocfNp') {
    if (kind === 'improve') return '经营现金流为什么大幅改善，改善能否持续？';
    if (kind === 'first-adverse') return '利润为什么第一次没有变成现金？';
    if (kind === 'worsen') return '经营现金流为什么进一步恶化？';
    if (kind === 'persistent') return '长期利润与现金背离反映什么商业模式风险？';
  }
  if (seed.key === 'fcf') {
    if (kind === 'improve') return '自由现金流为什么改善，改善能否持续？';
    if (kind === 'first-adverse') return '自由现金流为什么第一次转负？';
    if (kind === 'worsen') return '自由现金流为什么进一步恶化？';
  }
  return QUESTION_META[seed.key]?.question || seed.metric || '这项财务数据是否出现了需要继续核查的变化？';
}

function fallbackEvidenceList(seed) {
  const primary = seed.current && seed.metric ? `${seed.metric}：${seed.current}` : seed.current;
  const values = [primary, seed.trend, seed.evidence]
    .filter((v) => v && String(v).trim() && String(v).trim() !== '—')
    .map((v) => String(v).replace(/\s+/g, ' ').trim());
  return [...new Set(values)].slice(0, 3);
}

function fallbackJudgment(seed) {
  const fact = String(seed.evidence || seed.current || '当前披露有限').replace(/\s+/g, ' ').trim();
  if (seed.statusHint === 'insufficient') return '当前披露不足以完成判断，需要先补齐相关附注和历史对比，再决定是否升级排查。';
  if (seed.statusHint === 'high' || seed.statusHint === 'abnormal') return `${fact}。这是一项值得优先升级的异常信号，但异常不等于造假，需回到附注、原始凭证和后续报告验证。`;
  if (seed.statusHint === 'watch') return `${fact}。当前更像是需要重点核查的信号，暂不能直接定性，建议沿着下一步核查拆开原因。`;
  return `${fact}。按现有数据暂未发现明显异常，仍需结合附注和后续报告观察是否持续。`;
}

function buildSeeds(annualRows, finHistory) {
  const rows = Array.isArray(annualRows) ? annualRows : [];
  const latest = rows[rows.length - 1] || {};
  const prev = rows[rows.length - 2] || {};
  const seeds = [];
  const add = (seed) => {
    if (seed && seed.metric) seeds.push(seed);
  };

  const ocfNp = ratio(latest.ocf, latest.netProfit);
  const prevOcfNp = ratio(prev.ocf, prev.netProfit);
  add({
    key: 'ocfNp',
    priorityHint: 'P0',
    change: classifyCashFlowChange(latest.ocf, prev.ocf),
    domain: '利润质量',
    metric: '经营现金流 / 归母净利润',
    current: ocfNp == null ? '数据不足' : `${fmtRatio(ocfNp)} 倍`,
    trend: prevOcfNp == null ? '上年数据不足' : `上年 ${fmtRatio(prevOcfNp)} 倍`,
    evidence: `经营现金流 ${fmtYi(latest.ocf) || '数据不足'}，归母净利润 ${fmtYi(latest.netProfit) || '数据不足'}`,
    nextStep: '核对应收、存货、合同负债与现金回款，判断利润是否形成真实现金。',
    statusHint: ocfNp == null ? 'insufficient' : ocfNp < 0.8 ? 'watch' : 'normal',
    source: '三表',
  });

  const fcf = latest.ocf != null && latest.capex != null ? latest.ocf - latest.capex : null;
  const prevFcf = prev.ocf != null && prev.capex != null ? prev.ocf - prev.capex : null;
  add({
    key: 'fcf',
    priorityHint: 'P0',
    change: classifyCashFlowChange(fcf, prevFcf),
    domain: '自由现金流',
    metric: '经营现金流 - 资本开支',
    current: fcf == null ? '数据不足' : fmtYi(fcf),
    trend: latest.capex == null ? '资本开支数据不足' : `资本开支 ${fmtYi(latest.capex)}`,
    evidence: `经营现金流 ${fmtYi(latest.ocf) || '数据不足'}，资本开支 ${fmtYi(latest.capex) || '数据不足'}`,
    nextStep: '结合在建工程、折旧和新产能投产进度，判断资本开支是否产生回报。',
    statusHint: fcf == null ? 'insufficient' : fcf < 0 ? 'watch' : 'normal',
    source: '现金流量表',
  });

  const deductRatio = ratio(latest.deductNetProfit, latest.netProfit);
  add({
    key: 'deduct',
    priorityHint: 'P0',
    domain: '利润质量',
    metric: '扣非归母净利润 / 归母净利润',
    current: deductRatio == null ? '数据不足' : `${fmtRatio(deductRatio)} 倍`,
    trend: latest.deductNetProfit == null ? '扣非数据不足' : `扣非归母净利 ${fmtYi(latest.deductNetProfit)}`,
    evidence: `归母净利润 ${fmtYi(latest.netProfit) || '数据不足'}，扣非归母净利润 ${fmtYi(latest.deductNetProfit) || '数据不足'}`,
    nextStep: '查看非经常性损益明细，确认利润是否主要来自主营。',
    statusHint: deductRatio == null ? 'insufficient' : deductRatio < 0.7 ? 'watch' : 'normal',
    source: '利润表',
  });

  const revenueGrowth = latest.revenueGrowth ?? growth(latest.revenue, prev.revenue);
  const netProfitGrowth = latest.netProfitGrowth ?? growth(latest.netProfit, prev.netProfit);
  const grossMargin = latest.grossMargin ?? (latest.revenue && latest.operatingCost != null ? ((latest.revenue - latest.operatingCost) / latest.revenue) * 100 : null);
  const prevGrossMargin = prev.grossMargin ?? (prev.revenue && prev.operatingCost != null ? ((prev.revenue - prev.operatingCost) / prev.revenue) * 100 : null);
  const grossDelta = grossMargin != null && prevGrossMargin != null ? grossMargin - prevGrossMargin : null;
  add({
    key: 'margins',
    priorityHint: 'P0',
    domain: '盈利能力',
    metric: '营收 / 净利 / 毛利率',
    current: [fmtPct(revenueGrowth), fmtPct(netProfitGrowth), grossMargin != null ? `毛利率 ${grossMargin.toFixed(1)}%` : null].filter(Boolean).join('｜') || '数据不足',
    trend: grossDelta == null ? '毛利率同比数据不足' : `毛利率同比 ${grossDelta > 0 ? '+' : ''}${grossDelta.toFixed(1)}pct`,
    evidence: `营收 ${fmtYi(latest.revenue) || '数据不足'}，归母净利 ${fmtYi(latest.netProfit) || '数据不足'}，毛利率 ${grossMargin != null ? `${grossMargin.toFixed(1)}%` : '数据不足'}`,
    nextStep: '把毛利率变化拆到产品价格、产品结构、原材料和竞争格局。',
    statusHint: grossDelta == null ? 'insufficient' : grossDelta < -5 ? 'watch' : 'normal',
    source: '利润表 / 主要指标',
  });

  const arGrowth = latest.accountsReceivableGrowth ?? growth(latest.accountsReceivable, prev.accountsReceivable);
  const arGap = arGrowth != null && revenueGrowth != null ? arGrowth - revenueGrowth : null;
  const arDays = turnoverDays(latest.accountsReceivable, prev.accountsReceivable, latest.revenue);
  const prevArDays = turnoverDays(prev.accountsReceivable, rows[rows.length - 3]?.accountsReceivable, prev.revenue);
  add({
    key: 'receivables',
    priorityHint: 'P0',
    domain: '收入质量',
    metric: '应收账款增速 - 营收增速',
    current: arGap == null ? '数据不足' : `${arGap > 0 ? '+' : ''}${arGap.toFixed(1)}pct`,
    trend: `应收同比 ${fmtPct(arGrowth) || '数据不足'}｜营收同比 ${fmtPct(revenueGrowth) || '数据不足'}｜周转 ${arDays != null ? `${arDays.toFixed(1)}天` : '数据不足'}${prevArDays != null ? `（上年 ${prevArDays.toFixed(1)}天）` : ''}`,
    evidence: `应收票据及应收账款 ${fmtYi(latest.accountsReceivable) || '数据不足'}，上年 ${fmtYi(prev.accountsReceivable) || '数据不足'}`,
    nextStep: '检查账龄、坏账准备、前五名客户和信用政策变化。',
    statusHint: arGap == null ? 'insufficient' : arGap > 30 ? 'abnormal' : arGap > 15 ? 'watch' : 'normal',
    source: '资产负债表 / 利润表',
  });

  const inventoryGrowth = latest.inventoryGrowth ?? growth(latest.inventory, prev.inventory);
  const inventoryGap = inventoryGrowth != null && revenueGrowth != null ? inventoryGrowth - revenueGrowth : null;
  const inventoryDays = turnoverDays(latest.inventory, prev.inventory, latest.operatingCost);
  const prevInventoryDays = turnoverDays(prev.inventory, rows[rows.length - 3]?.inventory, prev.operatingCost);
  add({
    key: 'inventory',
    priorityHint: 'P0',
    domain: '资产质量',
    metric: '存货增速 - 营收增速',
    current: inventoryGap == null ? '数据不足' : `${inventoryGap > 0 ? '+' : ''}${inventoryGap.toFixed(1)}pct`,
    trend: `存货同比 ${fmtPct(inventoryGrowth) || '数据不足'}｜营收同比 ${fmtPct(revenueGrowth) || '数据不足'}｜周转 ${inventoryDays != null ? `${inventoryDays.toFixed(1)}天` : '数据不足'}${prevInventoryDays != null ? `（上年 ${prevInventoryDays.toFixed(1)}天）` : ''}`,
    evidence: `存货 ${fmtYi(latest.inventory) || '数据不足'}，上年 ${fmtYi(prev.inventory) || '数据不足'}`,
    nextStep: '检查存货周转、库龄、跌价准备、产品价格和产能利用率。',
    statusHint: inventoryGap == null ? 'insufficient' : inventoryGap > 35 ? 'abnormal' : inventoryGap > 18 ? 'watch' : 'normal',
    source: '资产负债表 / 利润表',
  });

  const salesCashRatio = ratio(latest.salesCash, latest.revenue);
  add({
    key: 'salesCash',
    priorityHint: 'P1',
    domain: '收入质量',
    metric: '销售商品收到的现金 / 营业收入',
    current: salesCashRatio == null ? '数据不足' : `${fmtRatio(salesCashRatio)} 倍`,
    trend: salesCashRatio == null ? '现金回款数据不足' : '与利润现金转化率交叉验证',
    evidence: `销售回款 ${fmtYi(latest.salesCash) || '数据不足'}，营业收入 ${fmtYi(latest.revenue) || '数据不足'}`,
    nextStep: '继续核对合同资产、应收票据和其他应收款。',
    statusHint: salesCashRatio == null ? 'insufficient' : salesCashRatio < 0.85 ? 'watch' : 'normal',
    source: '利润表 / 现金流量表',
  });

  const contractGrowth = latest.contractLiabGrowth ?? growth(latest.contractLiab, prev.contractLiab);
  const contractGap = contractGrowth != null && revenueGrowth != null ? contractGrowth - revenueGrowth : null;
  if (latest.contractLiab != null) {
    add({
      key: 'contractLiab',
      priorityHint: 'P1',
      domain: '收入质量',
      metric: '合同负债增速 - 营收增速',
      current: contractGap == null ? '数据不足' : `${contractGap > 0 ? '+' : ''}${contractGap.toFixed(1)}pct`,
      trend: `合同负债同比 ${fmtPct(contractGrowth) || '数据不足'}｜营收同比 ${fmtPct(revenueGrowth) || '数据不足'}`,
      evidence: `合同负债 ${fmtYi(latest.contractLiab) || '数据不足'}，上年 ${fmtYi(prev.contractLiab) || '数据不足'}`,
      nextStep: '对预收型业务，检查合同负债是否领先或背离收入变化。',
      statusHint: contractGap == null ? 'insufficient' : contractGap < -20 ? 'watch' : 'normal',
      source: '资产负债表 / 利润表',
    });
  }

  const interestDebt = [latest.shortLoan, latest.currentDebt, latest.longLoan, latest.bondPayable, latest.shortBond, latest.leaseLiab]
    .reduce((a, v) => a + (num(v) || 0), 0);
  const netCash = latest.cash != null ? latest.cash - interestDebt : null;
  add({
    key: 'cashDebt',
    priorityHint: interestDebt > 0 ? 'P0' : 'P2',
    domain: '资金链',
    metric: '货币资金 - 有息负债',
    current: netCash == null ? '数据不足' : fmtYi(netCash),
    trend: `有息负债 ${fmtYi(interestDebt)}｜货币资金 ${fmtYi(latest.cash) || '数据不足'}`,
    evidence: `短期借款 ${fmtYi(latest.shortLoan) || '0'}，一年内到期 ${fmtYi(latest.currentDebt) || '0'}，长期借款 ${fmtYi(latest.longLoan) || '0'}`,
    nextStep: '核对受限资金、境外资金、质押和借款变化。',
    statusHint: netCash == null ? 'insufficient' : netCash < 0 ? 'watch' : 'normal',
    source: '资产负债表',
  });

  const avgCash = avgBalance(latest.cash, prev.cash);
  const cashYield = avgCash && latest.interestIncome != null ? (latest.interestIncome / avgCash) * 100 : null;
  if (latest.cash != null && latest.interestIncome != null) {
    add({
      key: 'cashYield',
      priorityHint: latest.cash > interestDebt ? 'P1' : 'P2',
      domain: '资金真实性',
      metric: '利息收入 / 平均货币资金（近似）',
      current: cashYield == null ? '数据不足' : `${cashYield.toFixed(2)}%`,
      trend: `利息收入 ${fmtYi(latest.interestIncome)}｜货币资金 ${fmtYi(latest.cash)}`,
      evidence: '该比率只作交叉验证，需结合定期存款、理财、受限资金和资金集中管理理解。',
      nextStep: '核对货币资金受限情况、存款结构和利息收入明细；异常偏低时再追查资金占用。',
      statusHint: cashYield == null ? 'insufficient' : cashYield < 0.3 ? 'watch' : 'normal',
      source: '资产负债表 / 利润表',
    });
  }

  const goodwillRatio = ratio(latest.goodwill, latest.parentEquity);
  if (latest.goodwill != null && latest.goodwill > 0) {
    add({
      key: 'goodwill',
      priorityHint: 'P1',
      domain: '资产质量',
      metric: '商誉 / 归母净资产',
      current: goodwillRatio == null ? '数据不足' : `${(goodwillRatio * 100).toFixed(1)}%`,
      trend: `商誉 ${fmtYi(latest.goodwill)}`,
      evidence: `归母净资产 ${fmtYi(latest.parentEquity) || '数据不足'}`,
      nextStep: '检查商誉来源、被收购公司业绩承诺和减值测试。',
      statusHint: goodwillRatio == null ? 'insufficient' : goodwillRatio > 0.4 ? 'abnormal' : goodwillRatio > 0.2 ? 'watch' : 'normal',
      source: '资产负债表',
    });
  }

  const capexDep = ratio(latest.capex, latest.depreciation);
  add({
    key: 'capexDep',
    priorityHint: 'P1',
    domain: '资本开支效率',
    metric: '资本开支 / 折旧',
    current: capexDep == null ? '数据不足' : `${fmtRatio(capexDep)} 倍`,
    trend: `在建工程 ${fmtYi(latest.cip) || '数据不足'}`,
    evidence: `资本开支 ${fmtYi(latest.capex) || '数据不足'}，折旧 ${fmtYi(latest.depreciation) || '数据不足'}`,
    nextStep: '结合项目进度、转固时点和新增产能利用率判断回报。',
    statusHint: capexDep == null ? 'insufficient' : capexDep > 2.5 ? 'watch' : 'normal',
    source: '资产负债表 / 现金流量表',
  });

  const fixedGrowth = growth(latest.fixedAssets, prev.fixedAssets);
  const fixedGap = fixedGrowth != null && revenueGrowth != null ? fixedGrowth - revenueGrowth : null;
  add({
    key: 'fixedAssets',
    priorityHint: 'P1',
    domain: '资产效率',
    metric: '固定资产增速 - 营收增速',
    current: fixedGap == null ? '数据不足' : `${fixedGap > 0 ? '+' : ''}${fixedGap.toFixed(1)}pct`,
    trend: `固定资产同比 ${fmtPct(fixedGrowth) || '数据不足'}｜营收同比 ${fmtPct(revenueGrowth) || '数据不足'}`,
    evidence: `固定资产 ${fmtYi(latest.fixedAssets) || '数据不足'}，在建工程 ${fmtYi(latest.cip) || '数据不足'}`,
    nextStep: '核对新增产能、投产时间、产能利用率和新增收入是否匹配。',
    statusHint: fixedGap == null ? 'insufficient' : fixedGap > 25 ? 'watch' : 'normal',
    source: '资产负债表 / 利润表',
  });

  const latestFin = (finHistory || []).find((r) => String(r.reportDate || '').slice(0, 10) === latest.reportDate) || (finHistory || [])[0] || {};
  add({
    key: 'returns',
    priorityHint: 'P1',
    domain: '资本回报',
    metric: 'ROE / ROIC',
    current: [latestFin.roe != null ? `ROE ${latestFin.roe.toFixed(1)}%` : null, latestFin.roic != null ? `ROIC ${latestFin.roic.toFixed(1)}%` : null].filter(Boolean).join('｜') || '数据不足',
    trend: '结合权益乘数和资本成本判断回报质量',
    evidence: `资产负债率 ${latestFin.debtRatio != null ? `${latestFin.debtRatio.toFixed(1)}%` : '数据不足'}`,
    nextStep: '拆解净利率、总资产周转率和权益乘数，判断高 ROE 来自何处。',
    statusHint: latestFin.roe == null ? 'insufficient' : 'normal',
    source: '主要指标',
  });

  if (latest.auditOpinion) {
    add({
      key: 'audit',
      priorityHint: 'P0',
      change: /标准无保留/.test(latest.auditOpinion) ? { kind: 'persistent' } : { kind: 'first-adverse' },
      domain: '审计意见',
      metric: '境内审计意见',
      current: latest.auditOpinion,
      trend: latest.reportName || latest.reportDate || '最新年报',
      evidence: `年报审计意见字段：${latest.auditOpinion}`,
      nextStep: '若非标准无保留意见，继续查看强调事项、保留意见基础和关键审计事项。',
      statusHint: /标准无保留/.test(latest.auditOpinion) ? 'normal' : 'high',
      source: '资产负债表年报字段',
    });
  }

  return seeds;
}

function seedToFallbackRow(seed) {
  const status = ['normal', 'watch', 'abnormal', 'high', 'insufficient'].includes(seed.statusHint) ? seed.statusHint : 'insufficient';
  const meta = QUESTION_META[seed.key] || {};
  return {
    priority: priorityForSeed(seed),
    domain: seed.domain || '财务排查',
    question: questionForSeed(seed),
    metric: seed.metric || '待补充指标',
    current: seed.current || '数据不足',
    trend: seed.trend || '—',
    status,
    change: seed.change || null,
    evidence: fallbackEvidenceList(seed),
    judgment: fallbackJudgment(seed),
    nextCheck: meta.nextCheck || splitNextStep(seed.nextStep),
    next: seed.nextStep || '补充年报附注或结构化财务数据。',
    source: seed.source || '系统核验',
  };
}

function pickDiagnosisSeeds(seeds) {
  const list = Array.isArray(seeds) ? seeds : [];
  const severity = { high: 5, abnormal: 4, watch: 3, insufficient: 2, normal: 1 };
  const priorityRank = { P0: 0, P1: 1, P2: 2 };
  const sorted = [...list].sort((a, b) => {
    const priorityDiff = priorityRank[priorityForSeed(a)] - priorityRank[priorityForSeed(b)];
    return priorityDiff || (severity[b.statusHint] || 0) - (severity[a.statusHint] || 0);
  });
  const picked = [];
  const caps = { P0: 3, P1: 5, P2: 3 };
  for (const priority of ['P0', 'P1', 'P2']) {
    for (const seed of sorted.filter((s) => priorityForSeed(s) === priority).slice(0, caps[priority])) {
      if (!picked.includes(seed)) picked.push(seed);
    }
  }
  for (const seed of sorted) {
    if (picked.length >= 10) break;
    if (!picked.includes(seed)) picked.push(seed);
  }
  return picked.slice(0, 10);
}

function buildCoreConclusions(rows) {
  const riskRows = rows.filter((r) => ['high', 'abnormal', 'watch'].includes(r.status));
  const primary = riskRows[0] || rows[0];
  const positive = rows.find((r) => r.status === 'normal' && r !== primary);
  const contradiction = primary?.judgment || '当前没有足够证据识别核心矛盾。';
  const risk = riskRows.slice(0, 2)
    .filter(Boolean)
    .map((r) => r.judgment)
    .slice(0, 2)
    .join('；') || '暂未形成明确风险线索。';
  const lead = positive
    ? `${positive.question.replace(/？$/, '')}暂未见明显异常，可继续观察${positive.nextCheck?.lookAt || positive.next || '后续披露'}。`
    : '当前以风险排查为主，暂未形成可直接验证的积极线索。';
  return {
    coreContradiction: contradiction.slice(0, 260),
    mainRisk: risk.slice(0, 260),
    keyLead: lead.slice(0, 260),
  };
}

export function buildFallbackDiagnosis(forensic) {
  if (!forensic || !forensic.hasData) return null;
  const selectedSeeds = pickDiagnosisSeeds(forensic.seeds || []);
  const rows = selectedSeeds.map(seedToFallbackRow);
  const conclusions = buildCoreConclusions(rows);
  const topQuestions = selectedSeeds
    .filter((s) => ['P0', 'P1'].includes(priorityForSeed(s)))
    .map((s) => questionForSeed(s))
    .filter(Boolean)
    .slice(0, 3);
  return {
    skill: '财报侦查诊断（A股）',
    company: forensic.stock?.name ? `${forensic.stock.name}（${forensic.stock.symbol}）` : forensic.stock?.symbol || '待识别公司',
    businessModel: forensic.businessModel || '业务模型证据不足。',
    focus: [...new Set([
      ...rows.filter((r) => r.priority === 'P0').map((r) => r.domain),
      ...rows.map((r) => r.domain),
    ])].filter(Boolean).slice(0, 6),
    ...conclusions,
    rows,
    topQuestions,
    coverage: forensic.coverage || { structured: 0, filing: 0, missing: 0 },
    sources: forensic.sources || [],
    asOf: forensic.asOf || null,
  };
}

const STATUS_ALIAS = {
  '🟢': 'normal',
  '🟡': 'watch',
  '🟠': 'abnormal',
  '🔴': 'high',
  '⚪': 'insufficient',
  normal: 'normal',
  watch: 'watch',
  abnormal: 'abnormal',
  high: 'high',
  insufficient: 'insufficient',
};

function cleanText(v, max = 500) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeKey(v) {
  return cleanText(v, 120).replace(/\s+/g, '').replace(/归母/g, '');
}

function isNarrativeConclusion(value) {
  const valueText = cleanText(value, 300);
  const chinese = (valueText.match(/[\u4e00-\u9fff]/g) || []).length;
  const digits = (valueText.match(/\d/g) || []).length;
  const hasExplanation = /[，。；：、？！]/.test(valueText);
  return chinese >= 8 && (digits === 0 || chinese >= digits / 2) && (hasExplanation || chinese >= 12);
}

function conclusionText(value, fallback) {
  const valueText = cleanText(value, 260);
  return isNarrativeConclusion(valueText) ? valueText : (fallback || '');
}

function normalizeEvidenceList(value, fallback = []) {
  const raw = Array.isArray(value) ? value : [value];
  const list = raw
    .map((item) => cleanText(item, 220))
    .filter(Boolean)
    .slice(0, 3);
  return list.length ? list : (Array.isArray(fallback) ? fallback.slice(0, 3) : []);
}

function normalizeNextCheck(value, fallback) {
  if (!value) return fallback || splitNextStep('');
  if (value && typeof value === 'object') {
    return {
      what: cleanText(value.what || value.check, 180) || fallback?.what || '',
      lookAt: cleanText(value.lookAt || value.look || value.watch, 180) || fallback?.lookAt || '',
      judge: cleanText(value.judge || value.judgment || value.verify, 180) || fallback?.judge || '',
    };
  }
  const parsed = splitNextStep(value);
  return {
    what: cleanText(parsed.what, 180) || fallback?.what || '',
    lookAt: cleanText(parsed.lookAt, 180) || fallback?.lookAt || '',
    judge: cleanText(parsed.judge, 180) || fallback?.judge || '',
  };
}

export function normalizeDiagnosis(raw, forensic) {
  const fallback = buildFallbackDiagnosis(forensic);
  if (!raw || typeof raw !== 'object') return fallback;
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  const normalizedRows = rows
    .filter((r) => r && typeof r === 'object')
    .slice(0, 10)
    .map((r, index) => {
      const metricKey = normalizeKey(r.metric);
      const questionKey = normalizeKey(r.question);
      const fb = fallback?.rows?.find((row) => (
        (metricKey && normalizeKey(row.metric) === metricKey)
        || (questionKey && normalizeKey(row.question) === questionKey)
      )) || fallback?.rows?.[index] || {};
      const rawPriority = /^P[0-2]$/.test(String(r.priority || '').toUpperCase()) ? String(r.priority).toUpperCase() : 'P1';
      const priority = fb.priority || rawPriority;
      const rawQuestion = cleanText(r.question || r.metric, 120);
      const question = (fb.change?.kind && fb.question) ? fb.question : (rawQuestion || fb.question || '这项财务数据是否出现了需要继续核查的变化？');
      const current = cleanText(r.current, 160) || fb.current || '数据不足';
      const trend = cleanText(r.trend, 180) || fb.trend || '—';
      const nextCheck = normalizeNextCheck(r.nextCheck || r.next || r.nextStep, fb.nextCheck);
      const nextText = `${nextCheck.what}${nextCheck.lookAt ? ` → ${nextCheck.lookAt}` : ''}${nextCheck.judge ? ` → ${nextCheck.judge}` : ''}`;
      return {
        priority,
        domain: cleanText(r.domain, 30) || fb.domain || '财务排查',
        question,
        metric: cleanText(r.metric, 80) || fb.metric || '待补充指标',
        current,
        trend,
        status: STATUS_ALIAS[r.status] || STATUS_ALIAS[String(r.status || '').trim()] || fb.status || 'insufficient',
        change: r.change && typeof r.change === 'object' ? r.change : (fb.change || null),
        evidence: normalizeEvidenceList(r.evidence || r.keyEvidence || r.current, fb.evidence),
        judgment: cleanText(r.judgment || r.finding || r.interpretation || r.conclusion, 620) || fb.judgment || '当前证据不足，需补充数据。',
        nextCheck,
        next: nextText || cleanText(r.next || r.nextStep, 260) || fb.next || '补充年报附注或结构化财务数据。',
        source: cleanText(r.source, 80) || fb.source || '系统核验',
        details: {
          current,
          trend,
          calculation: cleanText(r.calculation || r.metric, 180) || fb.metric || '',
          rawEvidence: cleanText(r.rawEvidence || r.evidenceRaw || r.evidenceDetail, 420),
        },
      };
    });
  if (!fallback && !normalizedRows.length) return null;
  const safeRows = normalizedRows.length >= Math.min(4, fallback?.rows?.length || 0) ? normalizedRows : fallback?.rows || normalizedRows;
  const derivedConclusions = buildCoreConclusions(safeRows);
  const rawQuestions = Array.isArray(raw.topQuestions) ? raw.topQuestions : (Array.isArray(raw.followUps) ? raw.followUps : []);
  const topQuestions = rawQuestions
    .map((q) => cleanText(q, 180))
    .filter((q) => q && !/^0+(?:\.0+)?$/.test(q))
    .slice(0, 3);
  for (const q of (fallback?.topQuestions || [])) {
    if (topQuestions.length >= 3) break;
    const text = cleanText(q, 180);
    if (text && !topQuestions.includes(text)) topQuestions.push(text);
  }
  const normalizedFocus = Array.isArray(raw.focus)
    ? raw.focus
      .map((x) => cleanText(x, 16))
      .filter((x) => x && x.length <= 12 && !/[，。；！？]/.test(x))
      .slice(0, 6)
    : [];
  return {
    skill: '财报侦查诊断（A股）',
    company: cleanText(raw.company, 80) || fallback?.company || '待识别公司',
    businessModel: cleanText(raw.businessModel, 900) || fallback?.businessModel || '业务模型证据不足。',
    focus: normalizedFocus.length ? normalizedFocus : (fallback?.focus || []),
    coreContradiction: conclusionText(raw.coreContradiction, fallback?.coreContradiction || derivedConclusions.coreContradiction),
    mainRisk: conclusionText(raw.mainRisk, fallback?.mainRisk || derivedConclusions.mainRisk),
    keyLead: conclusionText(raw.keyLead, fallback?.keyLead || derivedConclusions.keyLead),
    rows: safeRows,
    topQuestions: topQuestions.length ? topQuestions : (fallback?.topQuestions || []),
    coverage: raw.coverage && typeof raw.coverage === 'object' ? {
      structured: Math.max(0, Number(raw.coverage.structured) || 0),
      filing: Math.max(0, Number(raw.coverage.filing) || 0),
      missing: Math.max(0, Number(raw.coverage.missing) || 0),
    } : (fallback?.coverage || { structured: 0, filing: 0, missing: 0 }),
    sources: Array.isArray(raw.sources) && raw.sources.length ? raw.sources.slice(0, 8) : (fallback?.sources || []),
    asOf: cleanText(raw.asOf || fallback?.asOf, 80) || null,
  };
}

function buildEvidenceText({ stock, annual, latest, businessModel, seeds, filing, coverage }) {
  const lines = [];
  lines.push(`公司：${stock.name || stock.symbol}（${stock.symbol}，${stock.market}）`);
  lines.push(`分析报告期：${annual?.reportName || annual?.reportDate || '数据不足'}`);
  lines.push('经营模式证据：');
  lines.push(businessModel || '数据不足');
  lines.push('');
  lines.push('一、结构化财务证据');
  for (const s of seeds) {
    const meta = QUESTION_META[s.key];
    const marginal = s.change?.kind ? `边际状态：${s.change.kind}` : '';
    lines.push(`· [${priorityForSeed(s)}] ${s.domain}｜${s.metric}｜当前：${s.current}｜趋势：${s.trend}${marginal ? `｜${marginal}` : ''}`);
    lines.push(`  侦查问题模板：${questionForSeed(s)}`);
    lines.push(`  证据：${s.evidence}`);
    if (meta?.nextCheck) lines.push(`  核查模板：查什么：${meta.nextCheck.what}；看什么：${meta.nextCheck.lookAt}；判断什么：${meta.nextCheck.judge}`);
    lines.push(`  下一步：${s.nextStep}`);
  }
  lines.push('');
  lines.push('二、年报/审计报告附注证据');
  if (filing?.sections?.length) {
    for (const sec of filing.sections) {
      lines.push(`【${sec.label}】`);
      lines.push(sec.text);
    }
  } else {
    lines.push('未取得可用附注片段；相关项目必须标记为数据不足，不能推断。');
  }
  lines.push('');
  lines.push('三、证据覆盖');
  lines.push(`结构化财务项：${coverage.structured}；年报/附注项：${coverage.filing}；明确缺口：${coverage.missing}`);
  return lines.join('\n').slice(0, 18000);
}

async function buildInner(reportText) {
  const symbols = await resolveSymbols(String(reportText || '').slice(0, 6000));
  const info = symbols && symbols[0];
  if (!info || info.market !== 'CN' || !info.secid) {
    return { hasData: false, reason: !info ? '未能识别公司' : '当前仅支持 A 股' };
  }

  const [statementRows, finHistory, mainBusiness, industry, filing] = await Promise.all([
    loadStatementBundle(info).catch(() => null),
    getFinHistory(info).catch(() => null),
    getMainBusiness(info).catch(() => null),
    getIndustry(info).catch(() => null),
    loadFilingEvidence(reportText, info).catch(() => ({ sections: [], sources: [] })),
  ]);

  const joined = Array.isArray(statementRows) ? statementRows : [];
  const annualRows = pickRows(joined, true);
  const latest = annualRows[annualRows.length - 1] || joined[joined.length - 1] || null;
  if (!latest) return { hasData: false, reason: '未取得 A 股财务数据' };

  // 把同比和常用比率挂到最新年报上，便于 seed 统一读取。
  for (let i = 0; i < annualRows.length; i++) {
    const cur = annualRows[i];
    const prev = annualRows[i - 1];
    if (!prev) continue;
    cur.revenueGrowth = growth(cur.revenue, prev.revenue);
    cur.netProfitGrowth = growth(cur.netProfit, prev.netProfit);
    cur.accountsReceivableGrowth = growth(cur.accountsReceivable, prev.accountsReceivable);
    cur.inventoryGrowth = growth(cur.inventory, prev.inventory);
    cur.grossMargin = cur.revenue && cur.operatingCost != null ? ((cur.revenue - cur.operatingCost) / cur.revenue) * 100 : null;
    cur.contractLiabGrowth = growth(cur.contractLiab, prev.contractLiab);
  }

  const seeds = buildSeeds(annualRows, finHistory || []);
  const filingCount = filing?.sections?.length || 0;
  const missing = seeds.filter((s) => s.statusHint === 'insufficient').length;
  const coverage = { structured: seeds.length, filing: filingCount, missing };
  const stock = { name: info.name || latest.reportName || info.symbol, symbol: info.symbol, market: 'A股', secid: info.secid };
  const businessModel = businessModelText(mainBusiness, industry);
  const sources = [
    {
      type: 'structured',
      title: '东方财富 F10 资产负债表 / 利润表 / 现金流量表 / 主要指标',
      date: latest.reportDate,
      url: null,
    },
    ...((filing && filing.sources) || []),
  ];
  const evidenceText = buildEvidenceText({ stock, annual: latest, businessModel, seeds, filing, coverage });
  return {
    hasData: true,
    stock,
    asOf: latest.reportName || latest.reportDate || null,
    evidenceText,
    seeds,
    coverage,
    businessModel,
    filing: filing || null,
    sources,
  };
}

export async function buildAStockForensicEvidence(reportText) {
  return withTimeout(buildInner(reportText), 22000);
}
