const { clearHistory } = require('../../utils/storage');

Page({
  data: {
    version: '1.0.0',
  },

  openPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  },

  copyFeedback() {
    wx.setClipboardData({
      data: 'https://github.com/Allen202505/think-tank',
      success() {
        wx.showToast({ title: '项目地址已复制', icon: 'none' });
      },
    });
  },

  clearLocalHistory() {
    wx.showModal({
      title: '清除本地学习记录？',
      content: '只清除当前设备上的历史卡片，不影响其他设备。',
      confirmText: '清除',
      confirmColor: '#9b3f34',
      success: (result) => {
        if (result.confirm) {
          clearHistory();
          wx.showToast({ title: '已清除', icon: 'success' });
        }
      },
    });
  },

  onShareAppMessage() {
    return {
      title: '多棱镜笔记｜财经通识学习工具',
      path: '/pages/home/index',
    };
  },
});
