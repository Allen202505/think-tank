// scripts/extract-pdf.mjs —— 独立进程解析 PDF 文本（纯 Node，避开 webpack 打包）
// 使用项目内 vendored 的 pdfjs（scripts/vendor/pdfjs.mjs + pdf.worker.mjs），
// 先 import polyfill 提供 DOMMatrix 避免原生 canvas 依赖。静态 import 使 nft 一并追踪 vendor 文件。
import './vendor/polyfill.mjs';
import { readFileSync } from 'fs';
import { getDocument } from './vendor/pdfjs.mjs';

const file = process.argv[2];
if (!file) { process.stderr.write('missing file arg\n'); process.exit(1); }
try {
  const buf = readFileSync(file);
  const doc = await getDocument({
    data: new Uint8Array(buf),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const c = await page.getTextContent();
    text += c.items.map((it) => it.str || '').join(' ') + '\n';
  }
  process.stdout.write(text.trim());
} catch (e) {
  process.stderr.write((e && e.message) || String(e));
  process.exit(1);
}
