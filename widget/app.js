/* ============================================================
   大师吵股 · 桌面组件逻辑
   数据策略：
   - 行情：东财批量（1 请求，优先）→ 腾讯实时 fetch+GBK（兜底，CORS 友好）
   - 快讯：站点 /api/news（带 CORS）→ 东财快讯 script JSONP（Tauri 内兜底）
   - API 地址可用 ?api= 或 localStorage('widget.apiBase') 覆盖（本地联调用）
   ============================================================ */
(() => {
  'use strict';

  const DEFAULT_API = 'https://yieldglide.com';
  const EM_BATCH = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
  const TX_QUOTE = 'https://qt.gtimg.cn/q=';
  const EM_NEWS = 'https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_1_8_.html';
  const QUOTE_FIELDS = 'f2,f3,f4,f12,f14';
  const REFRESH_MS = 30 * 1000;
  const NEWS_REFRESH_MS = 5 * 60 * 1000;

  const INDICES = [
    { name: '上证指数', secid: '1.000001' },
    { name: '深证成指', secid: '0.399001' },
    { name: '创业板指', secid: '0.399006' },
  ];

  const DEFAULT_POOL = [
    { name: '贵州茅台', code: '600519', secid: '1.600519' },
    { name: '宁德时代', code: '300750', secid: '0.300750' },
    { name: '比亚迪',   code: '002594', secid: '0.002594' },
    { name: '中芯国际', code: '688981', secid: '1.688981' },
    { name: '寒武纪',   code: '688256', secid: '1.688256' },
    { name: '中际旭创', code: '300308', secid: '0.300308' },
    { name: '东方财富', code: '300059', secid: '0.300059' },
    { name: '招商银行', code: '600036', secid: '1.600036' },
    { name: '中国平安', code: '601318', secid: '1.601318' },
    { name: '长江电力', code: '600900', secid: '1.600900' },
  ];

  const API_BASE = (() => {
    try {
      const q = new URLSearchParams(location.search).get('api');
      if (q) return q.replace(/\/$/, '');
      const saved = localStorage.getItem('widget.apiBase');
      if (saved) return saved.replace(/\/$/, '');
    } catch (e) { /* ignore */ }
    return DEFAULT_API;
  })();

  /* ── 基础工具 ─────────────────────────── */
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const codeOf = (secid) => String(secid).replace(/^\d+\./, '');
  const dir = (v) => {
    const n = Number(v);
    if (!isFinite(n) || n === 0) return 'flat';
    return n > 0 ? 'up' : 'down';
  };
  const sign = (v) => {
    const n = Number(v);
    if (!isFinite(n) || n === 0) return '';
    return n > 0 ? '+' : '';
  };

  async function openExternal(url) {
    if (window.__TAURI__ && window.__TAURI__.core) {
      try {
        await window.__TAURI__.core.invoke('open_url', { url });
        return;
      } catch (e) { /* fallthrough */ }
    }
    window.open(url, '_blank', 'noopener');
  }

  async function fetchText(url, tries = 3) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        if (!text) throw new Error('empty response');
        return text;
      } catch (e) {
        lastErr = e;
        if (i < tries - 1) await sleep(400 * (i + 1));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  function injectScript(src, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      let done = false;
      const cleanup = () => { clearTimeout(timer); s.remove(); };
      const timer = setTimeout(() => { if (!done) { done = true; cleanup(); reject(new Error('script timeout')); } }, timeoutMs);
      s.onload = () => { if (!done) { done = true; cleanup(); resolve(); } };
      s.onerror = () => { if (!done) { done = true; cleanup(); reject(new Error('script error')); } };
      s.src = src;
      document.head.appendChild(s);
    });
  }

  /* ── 行情：东财批量（快路径） ─────────── */
  async function fetchEmBatch(secids) {
    const url = `${EM_BATCH}?secids=${secids.join(',')}&fields=${QUOTE_FIELDS}&fltt=2&_t=${Date.now()}`;
    const j = JSON.parse(await fetchText(url, 2));
    const diff = j?.data?.diff;
    if (!Array.isArray(diff) || !diff.length) throw new Error('empty batch');
    return diff;
  }

  /* ── 行情：腾讯单股（兜底，CORS 友好） ── */
  // 按 secid 市场前缀映射：1=沪(sh)，0=深(sz)；不能按代码猜（000001 既是上证指数也是平安银行）
  function txCode(secid) {
    const m = /^(\d)\.(\d{6})$/.exec(String(secid));
    if (!m) return '';
    const market = m[1], code = m[2];
    if (market === '1') return 'sh' + code;
    if (market === '0') return 'sz' + code;
    return '';
  }

  async function fetchTxQuote(secid) {
    const code = txCode(secid);
    if (!code) throw new Error('unsupported ' + secid);
    const text = await fetchText(`${TX_QUOTE}${code}?_t=${Date.now()}`, 2);
    const m = text.match(new RegExp(`v_${code}="([^"]*)"`));
    if (!m || !m[1]) throw new Error('no tx data');
    const f = m[1].split('~');
    return { f12: code.slice(2), f14: f[1], f2: f[3], f3: f[32], f4: f[31] };
  }

  async function fetchTxQuotes(secids) {
    const out = [];
    // 分块并发（腾讯并发过多会丢包），每块 6 个
    const CHUNK = 6;
    for (let i = 0; i < secids.length; i += CHUNK) {
      const chunk = secids.slice(i, i + CHUNK);
      const res = await Promise.allSettled(chunk.map((s) => fetchTxQuote(s)));
      res.forEach((r) => { if (r.status === 'fulfilled' && r.value) out.push(r.value); });
    }
    return out;
  }

  async function loadQuotes() {
    const secids = [...INDICES, ...DEFAULT_POOL].map((x) => x.secid);
    const byCode = new Map();
    const put = (d) => { if (d && d.f12 != null) byCode.set(codeOf(d.f12), d); };

    // ① 东财批量
    try {
      (await fetchEmBatch(secids)).forEach(put);
    } catch (e) { /* 走腾讯 */ }

    // ② 腾讯补齐缺失
    const missing = secids.filter((s) => !byCode.has(codeOf(s)));
    if (missing.length) {
      (await fetchTxQuotes(missing)).forEach(put);
    }

    renderIndices(byCode);
    renderQuotes(byCode);
    $('quoteTime').textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  function renderIndices(byCode) {
    const box = $('indices');
    box.innerHTML = '';
    for (const idx of INDICES) {
      const d = byCode.get(codeOf(idx.secid));
      const cell = document.createElement('div');
      cell.className = 'w-index';
      cell.title = '点击查看大盘解读';
      const val = d && d.f2 != null ? Number(d.f2).toFixed(2) : '--';
      const pct = d && d.f3 != null ? `${sign(d.f3)}${Number(d.f3).toFixed(2)}%` : '--';
      cell.innerHTML = `
        <div class="w-index-name">${idx.name}</div>
        <div class="w-index-val ${d ? dir(d.f3) : 'flat'}">${val}</div>
        <div class="w-index-pct ${d ? dir(d.f3) : 'flat'}">${pct}</div>`;
      cell.addEventListener('click', () => openExternal(`${API_BASE}/?tab=breakfast`));
      box.appendChild(cell);
    }
  }

  function renderQuotes(byCode) {
    const list = $('quoteList');
    const empty = $('quoteEmpty');
    list.innerHTML = '';
    const rows = DEFAULT_POOL.map((s) => ({ s, d: byCode.get(codeOf(s.secid)) }));

    if (rows.every((r) => !r.d)) {
      empty.classList.remove('hidden');
      empty.textContent = '行情暂不可用，请稍后刷新';
      return;
    }
    empty.classList.add('hidden');

    for (const { s, d } of rows) {
      const li = document.createElement('li');
      li.className = 'quote-row';
      const price = d && d.f2 != null ? Number(d.f2).toFixed(2) : '--';
      const pct = d && d.f3 != null ? `${sign(d.f3)}${Number(d.f3).toFixed(2)}%` : '--';
      const cls = d ? dir(d.f3) : 'flat';
      li.innerHTML = `
        <div class="q-name">${s.name}<small>${s.code}</small></div>
        <div class="q-price ${cls}">${price}</div>
        <div class="q-pct ${cls}">${pct}</div>`;
      li.title = `查看「${s.name}」在网站上的分析`;
      li.addEventListener('click', () => openExternal(`${API_BASE}/?tab=pools`));
      list.appendChild(li);
    }
  }

  /* ── 快讯：站点 API（优先）→ 东财 script ── */
  async function loadNews() {
    try {
      const text = await fetchText(`${API_BASE}/api/news?page=1`, 2);
      const j = JSON.parse(text);
      if (j && j.ok && Array.isArray(j.items) && j.items.length) {
        renderNews(j.items.slice(0, 8));
        return;
      }
    } catch (e) { /* 走兜底 */ }

    // 兜底：东财快讯 script 注入（Tauri/WKWebView 可用；Chrome 可能被 ORB 拦截）
    try {
      delete window.ajaxResult;
      await injectScript(`${EM_NEWS}?_t=${Date.now()}`);
      const d = window.ajaxResult;
      if (d && Array.isArray(d.LivesList)) {
        renderNews(d.LivesList.filter((it) => it && it.title).map((it) => ({
          title: it.title,
          summary: it.digest,
          time: (it.showtime || '').slice(11, 16),
          url: it.url_w,
          source: '东方财富',
        })).slice(0, 8));
        return;
      }
    } catch (e) { /* ignore */ }

    renderNews([]);
  }

  function renderNews(items) {
    const list = $('newsList');
    const empty = $('newsEmpty');
    list.innerHTML = '';
    if (!items.length) {
      empty.classList.remove('hidden');
      empty.textContent = '快讯暂不可用，请稍后刷新';
      return;
    }
    empty.classList.add('hidden');

    for (const it of items) {
      const li = document.createElement('li');
      li.className = 'news-row';
      const t = it.time || it.showtime || '';
      li.innerHTML = `
        <div class="n-time">${fmtNewsTime(t)}</div>
        <div class="n-title">${escapeHtml(it.title)}</div>`;
      li.title = it.summary || it.title;
      li.addEventListener('click', () => openExternal(it.url || `${API_BASE}/?tab=breakfast`));
      list.appendChild(li);
    }
  }

  /* ── 展示工具 ─────────────────────────── */
  function fmtNewsTime(t) {
    const s = String(t || '');
    const m = /(\d{2}):(\d{2})/.exec(s);
    if (m) return m[1] + ':' + m[2];
    const d = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(s);
    if (d) {
      const now = new Date();
      const sameDay = String(now.getFullYear()) === d[1] &&
        String(now.getMonth() + 1).padStart(2, '0') === d[2] &&
        String(now.getDate()).padStart(2, '0') === d[3];
      return sameDay ? `${d[4]}:${d[5]}` : `${d[2]}-${d[3]} ${d[4]}:${d[5]}`;
    }
    return s;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── 问大师 ───────────────────────────── */
  function setupAsk() {
    const input = $('askInput');
    const chips = $('askChips');
    const btn = $('askBtn');

    chips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      input.value = chip.textContent;
      input.focus();
    });

    const submit = () => {
      const q = input.value.trim();
      openExternal(q ? `${API_BASE}/?q=${encodeURIComponent(q)}` : `${API_BASE}/`);
      btn.disabled = true;
      setTimeout(() => { btn.disabled = false; }, 800);
    };

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
  }

  /* ── 标签 / 时钟 / 刷新 ───────────────── */
  function setupTabs() {
    document.querySelector('.w-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.w-tab');
      if (!tab) return;
      document.querySelectorAll('.w-tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.w-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab.dataset.tab}`));
    });
  }

  function setupClock() {
    const tick = () => { $('clock').textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
    tick();
    setInterval(tick, 1000);
  }

  async function refreshAll(spin = false) {
    const btn = $('refreshBtn');
    if (spin) {
      btn.classList.add('spinning');
      btn.disabled = true;
    }
    try {
      await Promise.allSettled([loadQuotes(), loadNews()]);
    } finally {
      if (spin) {
        setTimeout(() => {
          btn.classList.remove('spinning');
          btn.disabled = false;
        }, 400);
      }
    }
  }

  function setupFooter() {
    $('openSiteBtn').addEventListener('click', () => openExternal(`${API_BASE}/`));
  }

  /* ── 启动 ─────────────────────────────── */
  function init() {
    setupTabs();
    setupClock();
    setupAsk();
    setupFooter();
    $('refreshBtn').addEventListener('click', () => refreshAll(true));
    refreshAll(true);
    setInterval(() => {
      if (document.querySelector('.w-tab[data-tab="quotes"]').classList.contains('active')) loadQuotes();
    }, REFRESH_MS);
    setInterval(() => {
      if (document.querySelector('.w-tab[data-tab="news"]').classList.contains('active')) loadNews();
    }, NEWS_REFRESH_MS);
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
