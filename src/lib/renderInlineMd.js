// 轻量 Markdown 内联渲染：支持 **加粗**，且标注「划线」下划线时能跨加粗边界正确打点。
// 返回 React 节点数组；highlights 为已划线的原文片段数组（string[]）。
// 思路：先按 ** 切开，拼出可见全文；在全文里定位每个高亮区间；再切回各加粗片段、命中的地方加下划线。
export function renderInlineRich(seg, keyBase, highlights) {
  const text = String(seg || '');
  const rawParts = text.split(/\*\*([\s\S]+?)\*\*/g);
  const parts = rawParts.map((p, i) => ({ bold: i % 2 === 1, text: String(p).replace(/\*\*/g, '') }));

  let full = '';
  const segs = parts.map((p) => {
    const start = full.length;
    full += p.text;
    return { ...p, start, end: full.length };
  });
  if (!full) return [];

  const hs = (highlights || [])
    .filter((h) => typeof h === 'string' && h.trim())
    .map((h) => h.trim());
  const baseRender = () =>
    parts.map((p, i) =>
      p.bold ? <strong key={`${keyBase}-b${i}`}>{p.text}</strong> : p.text
    );
  if (!hs.length) return baseRender();

  const escaped = hs
    .map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  const re = new RegExp('(' + escaped.join('|') + ')', 'g');
  const spans = [];
  let m;
  while ((m = re.exec(full))) spans.push({ start: m.index, end: re.lastIndex });
  if (!spans.length) return baseRender();

  const out = [];
  let k = 0;
  for (const p of segs) {
    const hit = spans.filter((sp) => sp.end > p.start && sp.start < p.end).sort((a, b) => a.start - b.start);
    if (!hit.length) {
      out.push(p.bold ? <strong key={`${keyBase}-${k++}`}>{p.text}</strong> : p.text);
      continue;
    }
    let i = p.start;
    const pieces = [];
    for (const sp of hit) {
      const cs = Math.max(sp.start, p.start);
      const ce = Math.min(sp.end, p.end);
      if (cs > i) pieces.push({ text: p.text.slice(i - p.start, cs - p.start), hl: false });
      pieces.push({ text: p.text.slice(cs - p.start, ce - p.start), hl: true });
      i = ce;
    }
    if (i < p.end) pieces.push({ text: p.text.slice(i - p.start), hl: false });
    for (const pc of pieces) {
      const inner = pc.hl
        ? <span key={`${keyBase}-${k++}`} className="nv-hl-underline">{pc.text}</span>
        : pc.text;
      out.push(p.bold ? <strong key={`${keyBase}-${k++}`}>{inner}</strong> : inner);
    }
  }
  return out;
}
