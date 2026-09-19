Page({
  copyContact() {
    wx.setClipboardData({
      data: 'https://github.com/Allen202505/think-tank',
      success() {
        wx.showToast({ title: '项目地址已复制', icon: 'none' });
      },
    });
  },
});
