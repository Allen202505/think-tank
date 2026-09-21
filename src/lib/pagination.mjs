export function paginateItems(items = [], page = 1, pageSize = 10) {
  const all = Array.isArray(items) ? items : [];
  const size = Math.max(1, Math.floor(Number(pageSize) || 10));
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(Math.max(1, Math.floor(Number(page) || 1)), totalPages);
  const start = (safePage - 1) * size;
  return {
    items: all.slice(start, start + size),
    page: safePage,
    pageSize: size,
    total,
    totalPages,
    start: total ? start + 1 : 0,
    end: Math.min(start + size, total),
  };
}
