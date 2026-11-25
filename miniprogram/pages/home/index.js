const tools = require('../../data/researchTools');
const {
  getCachedDewaterCard,
  loadDewaterCard,
  drawDewaterTrend,
} = require('../../utils/dewaterCard');

Page({
  data: {
    tools,
    dewaterPreview: null,
    dewaterLoading: true,
    dewaterError: '',
  },

  onLoad() {
    const cached = getCachedDewaterCard();
    if (cached) this.showDewaterCard(cached);
    this.loadDewaterPreview(false);
  },

  showDewaterCard(card) {
    this.setData({
      dewaterPreview: card,
      dewaterLoading: false,
      dewaterError: '',
    }, () => {
      wx.nextTick(() => drawDewaterTrend('homeDewaterChart', card.chart));
    });
  },

  async loadDewaterPreview(force) {
    if (this._loadingDewater) return;
    this._loadingDewater = true;
    this.setData({ dewaterLoading: true, dewaterError: '' });
    try {
      const card = await loadDewaterCard({ force });
      this.showDewaterCard(card);
    } catch (error) {
      this.setData({
        dewaterLoading: false,
        dewaterError: error?.message || '脱水数据暂时不可用，请稍后重试。',
      });
    } finally {
      this._loadingDewater = false;
    }
  },

  retryDewater() {
    this.loadDewaterPreview(true);
  },

  goDewaterDetail() {
    wx.navigateTo({ url: '/pages/dewater-detail/index' });
  },

  goTool(event) {
    wx.navigateTo({ url: `/pages/analysis/index?tool=${event.currentTarget.dataset.id}` });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/index' });
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/index' });
  },

  onShareAppMessage() {
    return {
      title: '大师吵股｜公开信息研究工具',
      path: '/pages/home/index',
    };
  },
});
