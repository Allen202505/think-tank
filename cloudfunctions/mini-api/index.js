const crypto = require('node:crypto');
const https = require('node:https');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const API_BASE = String(process.env.THINK_TANK_API_BASE || 'https://yieldglide.com').replace(/\/+$/, '');
const ALLOWED_ACTIONS = new Set(['debate', 'reading']);

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: 55000,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
          if (raw.length > 1024 * 1024) req.destroy(new Error('响应内容过大'));
        });
        res.on('end', () => {
          let data = {};
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch {
            return reject(new Error('服务返回格式错误'));
          }
          return resolve({ statusCode: res.statusCode || 500, data });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

exports.main = async (event) => {
  const action = String(event?.action || '');
  if (!ALLOWED_ACTIONS.has(action)) {
    return { ok: false, error: '不支持的操作' };
  }

  const secret = String(process.env.MINI_PROXY_SECRET || '');
  if (secret.length < 16) {
    return { ok: false, error: '云函数未配置至少 16 位的 MINI_PROXY_SECRET' };
  }

  const wxContext = cloud.getWXContext();
  const openid = String(wxContext.OPENID || '');
  if (!openid) return { ok: false, error: '无法获取当前微信用户标识' };

  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(16).toString('hex');
  const canonical = [action, timestamp, nonce, openid, rawBody].join('\n');
  const signature = crypto.createHmac('sha256', secret).update(canonical).digest('hex');

  try {
    const { statusCode, data } = await requestJson(`${API_BASE}/api/mini/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(rawBody),
        'x-mini-timestamp': timestamp,
        'x-mini-nonce': nonce,
        'x-mini-openid': openid,
        'x-mini-signature': signature,
      },
      body: rawBody,
    });

    if (statusCode >= 200 && statusCode < 300 && data?.ok) {
      return { ok: true, data: data.data, perspectives: data.perspectives, disclaimer: data.disclaimer };
    }
    return { ok: false, error: data?.error || `服务暂时不可用（${statusCode}）` };
  } catch (error) {
    return { ok: false, error: /超时/.test(String(error?.message)) ? '生成超时，请稍后重试' : '网络异常，请稍后重试' };
  }
};
