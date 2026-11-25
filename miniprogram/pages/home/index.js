const tools = require('../../data/researchTools');

Page({
  data: {
    tools,
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
      title: '大师吵股｜六种公开信息研究工具',
      path: '/pages/home/index',
    };
  },
});
