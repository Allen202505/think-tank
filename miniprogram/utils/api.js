const { cloudEnv, cloudFunctionName, demoMode } = require('../config');
const { callMock } = require('./mock');

function callMini(action, payload) {
  if (demoMode) return callMock(action, payload);

  return new Promise((resolve, reject) => {
    if (!cloudEnv || cloudEnv === 'YOUR_CLOUD_ENV_ID') {
      reject(new Error('请先在 miniprogram/config.js 配置云环境 ID'));
      return;
    }

    wx.cloud.callFunction({
      name: cloudFunctionName,
      data: { action, payload },
      success(response) {
        const result = response.result || {};
        if (result.ok) {
          resolve(result);
          return;
        }
        reject(new Error(result.error || '服务暂时不可用，请稍后重试'));
      },
      fail(error) {
        const message = String(error && error.errMsg ? error.errMsg : '');
        reject(new Error(/timeout|time out/i.test(message) ? '生成超时，请稍后重试' : '网络异常，请检查后重试'));
      },
    });
  });
}

module.exports = { callMini };
