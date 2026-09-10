// A 股行业周期分析：前端与后端共用的纯数据规则（不含系统提示词）。


export const CYCLE_DIMENSIONS = [
  { key: 'demand', label: '需求', weight: 20, scoreHint: '明显改善 16-20；温和改善 11-15；持平 7-10；恶化 0-6' },
  { key: 'inventory', label: '库存', weight: 20, scoreHint: '持续去库 16-20；温和去库 11-15；持平 7-10；持续累库 0-6' },
  { key: 'price', label: '产品价格', weight: 15, scoreHint: '上涨且持续 12-15；企稳 8-11；震荡 5-7；下跌 0-4' },
  { key: 'supply', label: '供给', weight: 15, scoreHint: '收缩 12-15；稳定 8-11；温和增长 5-7；快速扩张 0-4' },
  { key: 'profit', label: '行业利润', weight: 15, scoreHint: '快速修复 12-15；改善 8-11；稳定 5-7；恶化 0-4' },
  { key: 'capex', label: '资本开支', weight: 5, scoreHint: '越克制，周期持续性通常越好' },
  { key: 'expectation', label: '市场预期', weight: 10, scoreHint: '景气改善且预期低 8-10；景气好但预期过高 2-4；基本面恶化但预期高 0-2' },
  { key: 'utilization', label: '开工率', weight: 0, scoreHint: '景气确认指标，不直接计入 100 分' },
  { key: 'policy', label: '政策', weight: 0, scoreHint: '外生变量，不直接计入 100 分' },
];

export const CYCLE_STAGES = [
  { id: 'recession', label: '衰退', short: '需求、价格、利润同步承压，库存仍在高位', min: 0, max: 20 },
  { id: 'bottoming', label: '筑底', short: '最差的东西开始不再变差，减产与去库出现', min: 20, max: 40 },
  { id: 'recovery', label: '复苏', short: '库存下降、价格企稳或上涨，盈利开始修复', min: 40, max: 75 },
  { id: 'boom', label: '繁荣', short: '需求、价格、利润共振，扩产与一致预期升温', min: 75, max: 95 },
  { id: 'overheat', label: '过热', short: '价格和利润高位，扩产激进，估值提前透支', min: 95, max: 101 },
];

export function stageFromScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return '';
  if (n < 20) return '深度衰退';
  if (n < 40) return '衰退后期 / 筑底';
  if (n < 60) return '筑底 / 复苏早期';
  if (n < 75) return '复苏中期';
  if (n < 85) return '繁荣早期';
  if (n < 95) return '繁荣后期 / 过热';
  return '极端过热';
}

export function stageIndex(stage = '') {
  const s = String(stage);
  if (/衰退/.test(s) && !/后期/.test(s)) return 0;
  if (/筑底|衰退后期/.test(s)) return 1;
  if (/复苏/.test(s)) return 2;
  if (/过热/.test(s)) return 4;
  if (/繁荣/.test(s)) return 3;
  return -1;
}

export function computeCycleTotal(dashboard) {
  const byKey = new Map((Array.isArray(dashboard) ? dashboard : []).map((d) => [d?.key, d]));
  let weighted = 0;
  let coveredWeight = 0;
  const points = CYCLE_DIMENSIONS.map((dim) => {
    const row = byKey.get(dim.key) || {};
    const raw = row.score == null || row.score === '' ? null : Number(row.score);
    const valid = Number.isFinite(raw) && raw >= 0 && raw <= 1;
    const score = valid ? Math.max(0, Math.min(1, raw)) : null;
    if (dim.weight > 0 && score != null) {
      weighted += score * dim.weight;
      coveredWeight += dim.weight;
    }
    return {
      ...row,
      key: dim.key,
      label: dim.label,
      weight: dim.weight,
      score,
      points: score == null || !dim.weight ? null : Math.round(score * dim.weight * 10) / 10,
    };
  });
  const total = coveredWeight > 0 ? Math.round((weighted / coveredWeight) * 1000) / 10 : null;
  return {
    dashboard: points,
    total,
    coverage: coveredWeight,
    stageFromScore: stageFromScore(total),
  };
}
