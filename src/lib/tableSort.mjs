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
