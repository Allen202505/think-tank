const { cloudEnv, demoMode } = require('./config');

App({
  globalData: {
    cloudReady: false,
  },

  onLaunch() {
    if (demoMode) {
      this.globalData.cloudReady = false;
      return;
    }

    if (!wx.cloud) {
      wx.showModal({
        title: '版本过低',
        content: '请升级微信后再使用本小程序。',
        showCancel: false,
      });
      return;
    }

    const configured = cloudEnv && cloudEnv !== 'YOUR_CLOUD_ENV_ID';
    if (!configured) {
      console.warn('请先在 miniprogram/config.js 配置云环境 ID。');
      return;
    }

    wx.cloud.init({ env: cloudEnv, traceUser: false });
    this.globalData.cloudReady = true;
  },
});
