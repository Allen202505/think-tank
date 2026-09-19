const { callMini } = require('../../utils/api');
const { saveRecord } = require('../../utils/storage');
const { makeId } = require('../../utils/format');

const SAMPLE_TEXT = '公开市场操作是中央银行调节银行体系流动性的常用工具。操作规模、期限和利率变化，可能影响短端资金价格，并通过银行负债成本、债券定价和风险偏好等渠道向更长期限的市场传导。实际影响取决于经济基本面、政策预期和市场原有定价，单一操作通常不足以决定资产价格方向。';

Page({
  data: {
    text: '',
    loading: false,
    error: '',
    result: null,
    disclaimer: '',
    sourceText: '',
  },

  onInput(event) {
    this.setData({ text: event.detail.value, error: '' });
  },

  fillSample() {
    if (this.data.loading) return;
    this.setData({ text: SAMPLE_TEXT, error: '' });
  },

  clearText() {
    if (this.data.loading) return;
    this.setData({ text: '', error: '' });
  },

  async submitText() {
    if (this.data.loading) return;
    const text = String(this.data.text || '').trim();
    if (text.length < 20) {
      this.setData({ error: '请至少粘贴 20 个字。' });
      return;
    }
    if (text.length > 6000) {
      this.setData({ error: '内容请控制在 6000 字以内。' });
      return;
    }

    this.setData({ loading: true, error: '', result: null, sourceText: text });
    try {
      const response = await callMini('reading', { text });
      this.setData({
        result: response.data,
        disclaimer: response.disclaimer || '',
        loading: false,
      });
      saveRecord({
        id: makeId('reading'),
        type: 'reading',
        title: response.data.title,
        summary: response.data.summary,
        source: text.slice(0, 180),
        result: response.data,
        disclaimer: response.disclaimer || '',
        createdAt: Date.now(),
      });
      wx.nextTick(() => {
        wx.pageScrollTo({ selector: '#reading-result', duration: 260 });
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '整理失败，请稍后重试。' });
    }
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/index' });
  },
});
