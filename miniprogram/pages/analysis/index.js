const tools = require('../../data/researchTools');
const { callMini } = require('../../utils/api');
const { saveRecord } = require('../../utils/storage');
const { makeId } = require('../../utils/format');

const INDUSTRIES = [
  { id: 'bank', label: '银行', selected: true },
  { id: 'securities', label: '证券', selected: false },
  { id: 'insurance', label: '保险', selected: false },
  { id: 'oil', label: '石油石化', selected: false },
  { id: 'coal', label: '煤炭', selected: false },
  { id: 'baijiu', label: '白酒', selected: false },
  { id: 'real-estate', label: '房地产', selected: false },
  { id: 'construction', label: '建筑装饰', selected: false },
];

const QUICK_STOCKS = [
  { code: '601857', name: '中国石油' },
  { code: '600028', name: '中国石化' },
  { code: '600519', name: '贵州茅台' },
  { code: '600941', name: '中国移动' },
  { code: '601088', name: '中国神华' },
  { code: '601668', name: '中国建筑' },
];

const RANGES = [
  { id: '1m', label: '近一月' },
  { id: '3m', label: '近三月' },
  { id: '6m', label: '近半年' },
  { id: '1y', label: '近一年' },
];

const MARKETS = [
  { id: 'auto', label: '自动' },
  { id: 'CN', label: 'A股' },
  { id: 'HK', label: '港股' },
  { id: 'US', label: '美股' },
  { id: 'global', label: '全球' },
];

const MUNGER_SAMPLE = '公司本期营业收入同比增长，但经营活动产生的现金流量净额低于净利润，应收账款和存货同步增加。资产负债表显示短期借款上升，货币资金对短期债务的覆盖倍数下降。公司继续扩大资本开支，同时维持分红。管理层在经营讨论中表示行业需求正在恢复，但未披露主要客户的订单变化。需要继续核对应收账款账龄、存货跌价准备、在建工程转固进度、关联交易和资本化研发支出，判断利润增长是否转化为现金、扩产是否带来新的周转压力，以及分红和借款同时增加背后的资本配置逻辑。';

Page({
  data: {
    tools,
    activeToolId: 'news',
    activeTool: tools[0],
    loadingText: '正在整理公开信息…',
    loading: false,
    error: '',
    result: null,
    disclaimer: '',
    newsTitle: '',
    newsContent: '',
    symbol: '',
    industryData: '',
    dewaterRange: '1y',
    ranges: RANGES,
    industries: INDUSTRIES,
    quickStocks: QUICK_STOCKS.map((item) => ({ ...item, selected: false })),
    dewaterStocks: [],
    stockInput: '',
    fundamentalNote: '',
    supplyIndustry: 'AI 算力链',
    supplyMarket: 'auto',
    markets: MARKETS,
    supplyFocus: '',
    mungerLink: '',
    mungerContent: '',
    mungerNote: '',
  },

  onLoad(options) {
    const id = options && options.tool;
    const target = tools.find((item) => item.id === id);
    if (target) this.switchTool(target);
  },

  switchTool(tool) {
    this.setData({
      activeToolId: tool.id,
      activeTool: tool,
      loadingText: tool.id === 'dewater' ? '正在拉取行情并计算脱水…' : '正在整理公开信息…',
      error: '',
      result: null,
      disclaimer: '',
    });
  },

  selectTool(event) {
    if (this.data.loading) return;
    const target = tools.find((item) => item.id === event.currentTarget.dataset.id);
    if (target) this.switchTool(target);
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [field]: event.detail.value, error: '' });
  },

  selectRange(event) {
    this.setData({ dewaterRange: event.currentTarget.dataset.id, error: '' });
  },

  selectMarket(event) {
    this.setData({ supplyMarket: event.currentTarget.dataset.id, error: '' });
  },

  toggleIndustry(event) {
    const id = event.currentTarget.dataset.id;
    const industries = this.data.industries.map((item) => (
      item.id === id ? { ...item, selected: !item.selected } : item
    ));
    this.setData({ industries, error: '' });
  },

  toggleQuickStock(event) {
    const code = event.currentTarget.dataset.code;
    const exists = this.data.dewaterStocks.some((item) => item.code === code);
    const dewaterStocks = exists
      ? this.data.dewaterStocks.filter((item) => item.code !== code)
      : [...this.data.dewaterStocks, { code, name: event.currentTarget.dataset.name }];
    this.syncQuickStocks(dewaterStocks);
  },

  removeStock(event) {
    const code = event.currentTarget.dataset.code;
    this.syncQuickStocks(this.data.dewaterStocks.filter((item) => item.code !== code));
  },

  syncQuickStocks(dewaterStocks) {
    const quickStocks = this.data.quickStocks.map((item) => ({
      ...item,
      selected: dewaterStocks.some((stock) => stock.code === item.code),
    }));
    this.setData({ dewaterStocks, quickStocks, error: '' });
  },

  onStockInput(event) {
    this.setData({ stockInput: event.detail.value, error: '' });
  },

  addStock() {
    const code = String(this.data.stockInput || '').trim();
    if (!/^\d{6}$/.test(code)) {
      this.setData({ error: '请输入 6 位 A 股代码。' });
      return;
    }
    if (this.data.dewaterStocks.some((item) => item.code === code)) {
      this.setData({ stockInput: '', error: '' });
      return;
    }
    if (this.data.dewaterStocks.length >= 20) {
      this.setData({ error: '单次最多添加 20 只股票。' });
      return;
    }
    const quick = QUICK_STOCKS.find((item) => item.code === code);
    this.syncQuickStocks([...this.data.dewaterStocks, { code, name: quick ? quick.name : code }]);
    this.setData({ stockInput: '' });
  },

  fillSample() {
    if (this.data.loading) return;
    const id = this.data.activeToolId;
    if (id === 'news') {
      this.setData({
        newsTitle: '多家算力基础设施企业上调资本开支',
        newsContent: '多家算力基础设施企业近期在公开披露中上调年度资本开支计划，重点投向数据中心、光模块和供配电系统。部分产业链公司表示订单能见度延长，但上游关键器件交期仍然偏长。行业分析人士认为，需求扩张会先体现在设备订单，再逐步传导到材料、产能利用率和价格。与此同时，若下游应用落地慢于预期，新增产能也可能带来库存和折旧压力。',
        error: '',
      });
      return;
    }
    if (id === 'industry') {
      this.setData({
        symbol: '中盐化工',
        industryData: '行业近期处于供给扩张与需求修复并存的阶段。产品价格从低位回升，但库存仍高于过去三年中位数；新增产能集中在未来两个季度投放，开工率分化。需要继续观察现货价格、库存去化速度、下游开工率和资本开支变化。',
        error: '',
      });
      return;
    }
    if (id === 'dewater') {
      const industries = INDUSTRIES.map((item) => ({ ...item, selected: item.id === 'bank' }));
      this.setData({ dewaterRange: '1y', industries, dewaterStocks: [], stockInput: '' });
      this.syncQuickStocks([]);
      return;
    }
    if (id === 'fundamental') {
      this.setData({ symbol: '贵州茅台', fundamentalNote: '重点看现金流、渠道库存、预收款与资本配置。', error: '' });
      return;
    }
    if (id === 'supply') {
      this.setData({ supplyIndustry: 'AI 算力链', supplyMarket: 'auto', supplyFocus: '关注光模块、CPO、激光器、上游材料和供配电瓶颈。', error: '' });
      return;
    }
    this.setData({ mungerLink: '', mungerContent: MUNGER_SAMPLE, mungerNote: '重点判断利润含金量、营运资金和资本开支。', error: '' });
  },

  buildPayload() {
    const id = this.data.activeToolId;
    if (id === 'news') {
      return { tool: id, title: this.data.newsTitle.trim(), content: this.data.newsContent.trim() };
    }
    if (id === 'industry') {
      return { tool: id, symbol: this.data.symbol.trim(), industryData: this.data.industryData.trim() };
    }
    if (id === 'dewater') {
      return {
        tool: id,
        range: this.data.dewaterRange,
        industries: this.data.industries.filter((item) => item.selected).map((item) => item.id),
        stocks: this.data.dewaterStocks.map((item) => item.code),
      };
    }
    if (id === 'fundamental') {
      return { tool: id, symbol: this.data.symbol.trim(), note: this.data.fundamentalNote.trim() };
    }
    if (id === 'supply') {
      return {
        tool: id,
        industry: this.data.supplyIndustry.trim(),
        market: this.data.supplyMarket,
        focus: this.data.supplyFocus.trim(),
      };
    }
    return {
      tool: 'munger',
      link: this.data.mungerLink.trim(),
      content: this.data.mungerContent.trim(),
      note: this.data.mungerNote.trim(),
    };
  },

  sourceText() {
    const id = this.data.activeToolId;
    if (id === 'news') return this.data.newsTitle || this.data.newsContent.slice(0, 80);
    if (id === 'industry' || id === 'fundamental') return this.data.symbol;
    if (id === 'dewater') {
      const names = this.data.industries.filter((item) => item.selected).map((item) => item.label);
      const stocks = this.data.dewaterStocks.map((item) => `${item.name}(${item.code})`);
      return [...names, ...stocks].join('、') || '上证指数脱水';
    }
    if (id === 'supply') return this.data.supplyIndustry;
    return this.data.mungerLink || '用户粘贴的财报原文';
  },

  async submitAnalysis() {
    if (this.data.loading) return;
    const payload = this.buildPayload();
    if (payload.tool === 'news' && payload.content.length < 20) {
      this.setData({ error: '新闻正文太短，请补充到 20 字以上。' });
      return;
    }
    if ((payload.tool === 'industry' || payload.tool === 'fundamental') && payload.symbol.length < 2) {
      this.setData({ error: '请输入公司名称或代码。' });
      return;
    }
    if (payload.tool === 'dewater' && !payload.industries.length && !payload.stocks.length) {
      this.setData({ error: '请至少选择一个行业或一只股票。' });
      return;
    }
    if (payload.tool === 'supply' && payload.industry.length < 2) {
      this.setData({ error: '请输入产业链或板块名称。' });
      return;
    }
    if (payload.tool === 'munger' && !payload.link && payload.content.length < 200) {
      this.setData({ error: '请粘贴至少 200 字财报原文，或提供公开财报链接。' });
      return;
    }

    this.setData({ loading: true, error: '', result: null, disclaimer: '' });
    try {
      const response = await callMini('research', payload);
      this.setData({
        result: response.data,
        disclaimer: response.disclaimer || '',
        loading: false,
      });
      saveRecord({
        id: makeId(`research-${payload.tool}`),
        type: 'research',
        tool: payload.tool,
        toolLabel: response.data.toolLabel || this.data.activeTool.label,
        title: response.data.title,
        summary: response.data.summary,
        source: this.sourceText(),
        result: response.data,
        disclaimer: response.disclaimer || '',
        createdAt: Date.now(),
      });
      wx.nextTick(() => {
        wx.pageScrollTo({ selector: '#analysis-result', duration: 280 });
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '分析失败，请稍后重试。' });
    }
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/index' });
  },

  onShareAppMessage() {
    return {
      title: '大师吵股｜六种公开数据分析工具',
      path: `/pages/analysis/index?tool=${this.data.activeToolId}`,
    };
  },
});
