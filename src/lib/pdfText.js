// PDF 文本抽取：仅服务端使用。pdfjs 在模块顶层依赖少量浏览器对象，加载前先补最小 polyfill。
let pdfjsPromise = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      globalThis.DOMMatrix = globalThis.DOMMatrix || class DOMMatrix {
        constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
      };
      globalThis.Path2D = globalThis.Path2D || class Path2D {};
      const pdfjsLib = await import('../../scripts/vendor/pdfjs.mjs');
      const pdfWorker = await import('../../scripts/vendor/pdf.worker.mjs');
      globalThis.pdfjsWorker = pdfWorker;
      return pdfjsLib;
    })();
  }
  return pdfjsPromise;
}

export async function extractPdfText(buf, options = {}) {
  const pdfjsLib = await loadPdfjs();
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buf),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise;
  let text = '';
  const headPages = Math.max(0, Number(options.headPages || 0));
  const tailRatio = Math.min(1, Math.max(0, Number(options.tailRatio || 0)));
  const pages = [];
  if (headPages > 0 && tailRatio > 0) {
    const headEnd = Math.min(doc.numPages, headPages);
    for (let i = 1; i <= headEnd; i++) pages.push(i);
    const tailStart = Math.max(headEnd + 1, Math.floor(doc.numPages * (1 - tailRatio)) + 1);
    for (let i = tailStart; i <= doc.numPages; i++) pages.push(i);
  } else {
    const start = Math.max(1, Number(options.startPage || 1));
    const end = Math.min(doc.numPages, Number(options.endPage || doc.numPages));
    for (let i = start; i <= end; i++) pages.push(i);
  }
  for (const i of pages) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str || '').join(' ') + '\n';
  }
  return text.trim();
}

const DEFAULT_MAX_BYTES = 30 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 25000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export async function fetchPdfText(url, options = {}) {
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_BYTES);
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`PDF 下载失败（HTTP ${res.status}）`);
    const length = Number(res.headers.get('content-length') || 0);
    if (length && length > maxBytes) throw new Error('PDF 文件过大，已跳过正文抽取');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('PDF 文件过大，已跳过正文抽取');
    return await extractPdfText(buf, options);
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('PDF 下载超时');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
