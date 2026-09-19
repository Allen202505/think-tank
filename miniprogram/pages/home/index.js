const { demoMode } = require('../../config');

Page({
  data: {
    demoMode,
    quickTopics: [
      '利率变化为什么会推动资产估值变化？',
      '什么是安全边际？',
      '财报里的经营现金流为什么重要？',
      '行业周期通常如何传导？',
    ],
  },

  goDebate() {
    wx.navigateTo({ url: '/pages/debate/index' });
  },

  goReading() {
    wx.navigateTo({ url: '/pages/reading/index' });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/index' });
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/index' });
  },

  startTopic(event) {
    const topic = event.currentTarget.dataset.topic;
    wx.navigateTo({ url: `/pages/debate/index?topic=${encodeURIComponent(topic)}` });
  },

  onShareAppMessage() {
    return {
      title: '多棱镜笔记｜用多个视角读懂财经概念',
      path: '/pages/home/index',
    };
  },
});
