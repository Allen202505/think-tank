// masterGroups.js —— 大师流派分组配置
// key 为大师的 tag（中文），en 为英文展示名；顺序即分组展示顺序
export const MASTER_GROUP_ORDER = [
  { key: '价值投资', en: 'Value' },
  { key: '周期', en: 'Cyclical' },
  { key: '成长投资', en: 'Growth' },
  { key: '中国价值', en: 'China Value' },
  { key: '宏观对冲', en: 'Macro' },
  { key: '做空侦察', en: 'Short-selling' },
  { key: '做空', en: 'Shorting' },
  { key: 'A股游资', en: 'A-share Trader' },
  { key: '短线', en: 'Short-term' },
  { key: '敢死队', en: 'Daredevil' },
  { key: '量化投资', en: 'Quant' },
  { key: '技术趋势', en: 'Technical' },
  { key: '缠论', en: 'Chan Theory' },
  { key: '维权投资', en: 'Activist' },
  { key: '科技领袖', en: 'Tech Leader' },
  { key: 'AI卡位', en: 'AI Bottleneck' },
  { key: '指数投资', en: 'Index' },
  { key: '困境投资', en: 'Distressed' },
  { key: '事件驱动', en: 'Event-driven' },
  { key: '其他', en: 'Other' },
];

export const GROUP_KEYS = MASTER_GROUP_ORDER.map((g) => g.key);
export const GROUP_EN = Object.fromEntries(MASTER_GROUP_ORDER.map((g) => [g.key, g.en]));

// 归一化：任意 tag → 已知分组；未知归入「其他」
export function normalizeGroup(tag) {
  return GROUP_KEYS.includes(tag) ? tag : '其他';
}
