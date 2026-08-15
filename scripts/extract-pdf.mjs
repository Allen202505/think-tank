// scripts/extract-pdf.mjs —— 独立进程解析 PDF 文本（避开 webpack 打包，纯 Node 运行）
// 用法：node scripts/extract-pdf.mjs <pdf文件路径>
import { readFileSync } from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const file = process.argv[2];
if (!file) {
  process.stderr.write('missing file arg\n');
  process.exit(1);
}

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
