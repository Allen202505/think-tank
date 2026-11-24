const { demoMode, apiBase } = require('../config');
const { callMock } = require('./mock');

const TOKEN_KEY = 'mini_session_token_v1';
const REQUEST_TIMEOUT = 60000;
const API_ROOT = String(apiBase || '').replace(/\/+$/, '');

function requestSessionToken() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(loginResult) {
        const code = String(loginResult && loginResult.code ? loginResult.code : '').trim();
        if (!code) {
          reject(new Error('微信登录失败，请重试'));
          return;
        }
        wx.request({
          url: `${API_ROOT}/api/mini/session`,
          method: 'POST',
          timeout: 15000,
          header: { 'Content-Type': 'application/json' },
          data: { code },
          success(response) {
            const data = response.data || {};
            if (response.statusCode < 200 || response.statusCode >= 300 || !data.ok || !data.token) {
              reject(new Error(data.error || '登录服务暂时不可用，请稍后重试'));
              return;
            }
            resolve({ token: data.token, expiresAt: Number(data.expiresAt) || 0 });
          },
          fail(error) {
            const message = String(error && error.errMsg ? error.errMsg : '');
            console.warn('[mini-session]', message);
            reject(new Error(/timeout|time out/i.test(message) ? '登录超时，请稍后重试' : '登录网络异常，请检查服务器域名和网络后重试'));
          },
        });
      },
      fail(error) {
        const message = String(error && error.errMsg ? error.errMsg : '');
        console.warn('[wx-login]', message);
        reject(new Error('微信登录失败，请重试'));
      },
    });
  });
}

function getSessionToken(force = false) {
  if (!force) {
    try {
      const cached = wx.getStorageSync(TOKEN_KEY);
      if (cached && cached.token && Number(cached.expiresAt) > Date.now() + 60 * 1000) {
        return Promise.resolve(cached.token);
      }
    } catch (_) {}
  }
  return requestSessionToken().then((session) => {
    wx.setStorageSync(TOKEN_KEY, session);
    return session.token;
  });
}

function clearSessionToken() {
  try { wx.removeStorageSync(TOKEN_KEY); } catch (_) {}
}

function requestDirect(action, payload, token) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_ROOT}/api/mini/${action}`,
      method: 'POST',
      timeout: REQUEST_TIMEOUT,
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      data: payload || {},
      success(response) {
        const data = response.data || {};
        if (response.statusCode === 401) {
          const error = new Error(data.error || '登录凭证已过期');
          error.statusCode = 401;
          reject(error);
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300 || !data.ok) {
          reject(new Error(data.error || `服务暂时不可用（${response.statusCode}）`));
          return;
        }
        resolve(data);
      },
      fail(error) {
        const message = String(error && error.errMsg ? error.errMsg : '');
        console.warn('[mini-direct]', action, message);
        reject(new Error(/timeout|time out/i.test(message) ? '生成超时，请稍后重试' : '网络异常，请检查服务器域名和网络后重试'));
      },
    });
  });
}

function callMini(action, payload) {
  if (demoMode) return callMock(action, payload);
  if (!API_ROOT) return Promise.reject(new Error('请在 miniprogram/config.js 配置服务器地址'));

  return getSessionToken().then((token) => requestDirect(action, payload, token)).catch((error) => {
    if (error && error.statusCode === 401) {
      clearSessionToken();
      return getSessionToken(true).then((token) => requestDirect(action, payload, token));
    }
    throw error;
  });
}

module.exports = { callMini };
