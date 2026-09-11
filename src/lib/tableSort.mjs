export function defaultSortDirection(key) {
  return key === 'code' || key === 'name' ? 'asc' : 'desc';
}

export function nextSortState(current, key) {
  if (!current || current.key !== key) return { key, dir: defaultSortDirection(key) };
  const defaultDir = defaultSortDirection(key);
  if (current.dir === defaultDir) return { key, dir: defaultDir === 'desc' ? 'asc' : 'desc' };
  return { key: null, dir: defaultDir };
}

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
      const delta = Math.abs(na) - Math.abs(nb);
      if (delta !== 0) return delta * (dir === 'desc' ? -1 : 1);
    }
  }
  return compareSortValues(a, b, dir);
}
