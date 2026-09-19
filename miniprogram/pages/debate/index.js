const basePerspectives = require('../../data/perspectives');
const { callMini } = require('../../utils/api');
const { saveRecord } = require('../../utils/storage');
const { makeId } = require('../../utils/format');

Page({
  data: {
    question: '',
    selectedCount: 3,
    perspectives: basePerspectives.map((item, index) => ({ ...item, selected: index < 3 })),
    loading: false,
    error: '',
    result: null,
    disclaimer: '',
    submittedQuestion: '',
  },

  onLoad(options) {
    if (options && options.topic) {
      this.setData({ question: decodeURIComponent(options.topic) });
    }
  },

  onInput(event) {
    this.setData({ question: event.detail.value, error: '' });
  },

  clearQuestion() {
    this.setData({ question: '', error: '' });
  },

  togglePerspective(event) {
    if (this.data.loading) return;
    const id = event.currentTarget.dataset.id;
    const selectedCount = this.data.perspectives.filter((item) => item.selected).length;
    const target = this.data.perspectives.find((item) => item.id === id);
    if (!target) return;
    if (target.selected && selectedCount <= 2) {
      wx.showToast({ title: '至少选择两个视角', icon: 'none' });
      return;
    }
    if (!target.selected && selectedCount >= 4) {
      wx.showToast({ title: '最多选择四个视角', icon: 'none' });
      return;
    }
    const perspectives = this.data.perspectives.map((item) => (
      item.id === id ? { ...item, selected: !item.selected } : item
    ));
    this.setData({
      perspectives,
      selectedCount: perspectives.filter((item) => item.selected).length,
    });
  },

  async submitQuestion() {
    if (this.data.loading) return;
    const question = String(this.data.question || '').trim();
    if (question.length < 4) {
      this.setData({ error: '请至少输入 4 个字。' });
      return;
    }
    if (question.length > 360) {
      this.setData({ error: '问题请控制在 360 字以内。' });
      return;
    }

    const selectedIds = this.data.perspectives.filter((item) => item.selected).map((item) => item.id);
    this.setData({ loading: true, error: '', result: null, submittedQuestion: question });
    try {
      const response = await callMini('debate', { question, perspectives: selectedIds });
      this.setData({
        result: response.data,
        disclaimer: response.disclaimer || '',
        loading: false,
      });
      saveRecord({
        id: makeId('debate'),
        type: 'debate',
        title: response.data.title,
        summary: response.data.summary,
        source: question,
        result: response.data,
        disclaimer: response.disclaimer || '',
        createdAt: Date.now(),
      });
      wx.nextTick(() => {
        wx.pageScrollTo({ selector: '#roundtable-result', duration: 260 });
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '生成失败，请稍后重试。' });
    }
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/index' });
  },
});
