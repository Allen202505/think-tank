// 纳瓦尔知识学堂 · 词条（glossary）本机存取
// 词条结构：{ name, at, q?, content?, keyPoint? }；content 可选（点击后才按需生成并缓存）
const TERMS_KEY = 'thinktank_naval_terms';
const TERMS_MAX = 500;

export function loadTerms() {
  try { return JSON.parse(localStorage.getItem(TERMS_KEY) || '[]') || []; } catch (e) { return []; }
}
export function saveTerms(list) {
  try { localStorage.setItem(TERMS_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}
// 新增/去重/更新一个词条（同名替换，返回新数组）
export function upsertTerm(list, term) {
  return [term, ...(list || []).filter((t) => t.name !== term.name)].slice(0, TERMS_MAX);
}
// 更新某个词条内容（按名字）
export function updateTermContent(name, patch) {
  const list = loadTerms();
  const next = list.map((t) => (t.name === name ? { ...t, ...patch } : t));
  saveTerms(next);
  return next;
}
export function notifyTermsChanged() {
  window.dispatchEvent(new CustomEvent('thinktank:terms-changed'));
}
