export function compareSortValues(a, b, dir = 'asc') {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  const na = Number(a);
  const nb = Number(b);
  const aNum = a !== '' && Number.isFinite(na);
  const bNum = b !== '' && Number.isFinite(nb);
  const result = aNum && bNum ? na - nb : String(a).localeCompare(String(b), 'zh-Hans-CN');
  return result * (dir === 'desc' ? -1 : 1);
}

export function compareStockSortValues(key, a, b, dir = 'asc') {
  if (key === 'ret' && a != null && b != null) {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      // ▼ 保留变动幅度降序：跌幅最大优先；▲ 使用严格数值升序：最负值优先。
      const delta = dir === 'desc' ? Math.abs(nb) - Math.abs(na) : na - nb;
      if (delta !== 0) return delta;
    }
  }
  return compareSortValues(a, b, dir);
}
