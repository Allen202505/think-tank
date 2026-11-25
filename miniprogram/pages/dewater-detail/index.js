const {
  getCachedDewaterCard,
  loadDewaterCard,
  drawDewaterTrend,
} = require('../../utils/dewaterCard');

Page({
  data: {
    loading: true,
    error: '',
    card: null,
  },

  onLoad() {
    const cached = getCachedDewaterCard();
    if (cached) this.showCard(cached);
    this.loadCard(false);
  },

  showCard(card) {
    this.setData({ card, loading: false, error: '' }, () => {
      wx.nextTick(() => drawDewaterTrend('detailDewaterChart', card.chart));
    });
  },

  async loadCard(force) {
    if (this._loadingDewater) return;
    this._loadingDewater = true;
    this.setData({ loading: true, error: '' });
    try {
      const card = await loadDewaterCard({ force });
      this.showCard(card);
    } catch (error) {
      this.setData({
        loading: false,
        error: error?.message || '脱水数据暂时不可用，请稍后重试。',
      });
    } finally {
      this._loadingDewater = false;
    }
  },

  retry() {
    this.loadCard(true);
  },

  goAdjust() {
    wx.navigateTo({ url: '/pages/analysis/index?tool=dewater' });
  },

  onShareAppMessage() {
    return {
      title: '上证指数 vs 脱水后真实指数',
      path: '/pages/dewater-detail/index',
    };
  },
});
