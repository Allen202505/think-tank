import { lookup } from 'node:dns/promises';
import net from 'node:net';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_REDIRECTS = 4;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

function isPrivateIpv4(host) {
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

export function isPrivateNetworkHost(host) {
  const value = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!value || value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local') || value.endsWith('.internal')) return true;
  const family = net.isIP(value);
  if (family === 4) return isPrivateIpv4(value);
  if (family === 6) {
    const compact = value.replace(/^0+/, '').replace(/:0+/g, ':');
    if (compact === '::1' || compact.startsWith('fc') || compact.startsWith('fd') || compact.startsWith('fe8') || compact.startsWith('fe9') || compact.startsWith('fea') || compact.startsWith('feb')) return true;
    if (compact.startsWith('::ffff:')) return isPrivateIpv4(compact.slice(7));
  }
  return false;
}

export function normalizePublicHttpUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch (e) {
    throw new Error('请输入完整的 http(s) 链接');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 http 或 https 链接');
  if (url.username || url.password) throw new Error('链接不能包含账号密码');
  if (isPrivateNetworkHost(url.hostname)) throw new Error('不支持内网或本机地址');
  url.hash = '';
  return url.toString();
}

export async function assertPublicHostname(hostname, options = {}) {
  if (isPrivateNetworkHost(hostname)) throw new Error('不支持内网或本机地址');
  const lookupFn = options.lookupFn || lookup;
  let records;
  try {
    records = await lookupFn(hostname, { all: true, verbatim: true });
  } catch (e) {
    throw new Error('无法解析链接域名');
  }
  if (!records?.length) throw new Error('无法解析链接域名');
  if (records.some((record) => isPrivateNetworkHost(record.address))) {
    throw new Error('链接指向内网地址，已拒绝访问');
  }
}

async function readLimitedBody(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('远程内容过大，已拒绝读取');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

export async function fetchPublicBuffer(rawUrl, options = {}) {
  const maxBytes = Math.max(1, Number(options.maxBytes) || DEFAULT_MAX_BYTES);
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const maxRedirects = Math.max(0, Number(options.maxRedirects ?? DEFAULT_REDIRECTS));
  const fetchImpl = options.fetchImpl || fetch;
  const lookupFn = options.lookupFn || lookup;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    ...(options.headers || {}),
  };

  let currentUrl = new URL(normalizePublicHttpUrl(rawUrl));
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    await assertPublicHostname(currentUrl.hostname, { lookupFn });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(currentUrl, {
        method: 'GET',
        headers,
        redirect: 'manual',
        cache: 'no-store',
        signal: ctrl.signal,
      });
    } catch (e) {
      if (e?.name === 'AbortError') throw new Error('远程链接请求超时');
      throw new Error(`远程链接请求失败：${e?.message || e}`);
    } finally {
      clearTimeout(timer);
    }

    if (REDIRECT_STATUS.has(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('远程链接跳转地址缺失');
      currentUrl = new URL(location, currentUrl);
      normalizePublicHttpUrl(currentUrl.toString());
      continue;
    }
    if (!response.ok) throw new Error(`远程链接返回 HTTP ${response.status}`);

    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error('远程内容过大，已拒绝读取');
    const body = await readLimitedBody(response, maxBytes);
    return {
      body,
      response,
      finalUrl: currentUrl.toString(),
      contentType: response.headers.get('content-type') || '',
    };
  }
  throw new Error('远程链接跳转次数过多');
}

export async function fetchPublicText(rawUrl, options = {}) {
  const result = await fetchPublicBuffer(rawUrl, options);
  return { ...result, text: result.body.toString(options.encoding || 'utf8') };
}
