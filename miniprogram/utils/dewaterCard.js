const { callMini } = require('./api');

const CACHE_KEY = 'mini_dewater_card_v1';
const CACHE_TTL = 5 * 60 * 1000;
let inflight = null;

function numberText(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const fixed = number.toFixed(digits);
  const [integer, decimal] = fixed.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimal == null ? grouped : `${grouped}.${decimal}`;
}

function pctText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function toneClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) < 0.005) return 'is-flat';
  return number > 0 ? 'is-up' : 'is-down';
}

function decorateCard(raw, isStale = false) {
  if (!raw || typeof raw !== 'object') return null;
  const official = raw.official || {};
  const dewater = raw.dewater || {};
  const selection = raw.selection || {};
  const gap = Number(dewater.gapPoints);
  const gapText = Number.isFinite(gap)
    ? `${gap < 0 ? '低于' : '高于'}官方 ${numberText(Math.abs(gap))} 点`
    : '';

  return {
    ...raw,
    isStale,
    rangeText: `${raw.range?.label || '近一年'} · 剔除${raw.scheme || '银行'}`,
    officialLevelText: numberText(official.level),
    officialReturnText: pctText(official.returnPct),
    officialReturnClass: toneClass(official.returnPct),
    dewaterLevelText: numberText(dewater.level),
    dewaterReturnText: pctText(dewater.returnPct),
    dewaterReturnClass: toneClass(dewater.returnPct),
    gapText,
    gapClass: toneClass(dewater.differencePp),
    differenceText: dewater.differencePp == null ? '—' : `${Number(dewater.differencePp) > 0 ? '+' : ''}${Number(dewater.differencePp).toFixed(2)} 个百分点`,
    officialStartText: numberText(official.startLevel),
    dewaterStartText: numberText(dewater.startLevel),
    removedText: `${selection.removedCount ?? 0} 只`,
    selectedWeightText: selection.selectedWeightPct == null ? '—' : `${numberText(selection.selectedWeightPct, 2)}%`,
    asOfText: raw.asOf || raw.range?.endDate || '—',
    updatedAtText: raw.updatedAt ? String(raw.updatedAt).slice(0, 10) : '',
    topItems: (raw.topItems || []).map((item) => ({
      ...item,
      weightText: item.weightPct == null ? '—' : `${numberText(item.weightPct, 3)}%`,
      returnText: pctText(item.returnPct),
      returnClass: toneClass(item.returnPct),
      contributionText: item.contributionPoints == null ? '—' : `${Number(item.contributionPoints) > 0 ? '+' : ''}${numberText(item.contributionPoints, 2)} 点`,
    })),
  };
}

function readCache() {
  try {
    const cache = wx.getStorageSync(CACHE_KEY);
    if (!cache || !cache.data || !cache.at) return null;
    return cache;
  } catch (_) {
    return null;
  }
}

function writeCache(data) {
  try {
    wx.setStorageSync(CACHE_KEY, { at: Date.now(), data });
  } catch (_) {}
}

function getCachedDewaterCard() {
  const cache = readCache();
  if (!cache) return null;
  return decorateCard(cache.data, Date.now() - cache.at >= CACHE_TTL);
}

function loadDewaterCard({ force = false } = {}) {
  const cache = readCache();
  if (!force && cache && Date.now() - cache.at < CACHE_TTL) {
    return Promise.resolve(decorateCard(cache.data, false));
  }
  if (inflight) return inflight;

  inflight = callMini('dewater-card', { range: '1y', industries: ['bank'] })
    .then((response) => {
      const data = response?.data;
      if (!data) throw new Error('脱水数据暂时不可用');
      writeCache(data);
      return decorateCard(data, false);
    })
    .catch((error) => {
      if (cache?.data) return decorateCard(cache.data, true);
      throw error;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

function drawDewaterTrend(canvasId, chart) {
  if (!canvasId || !chart?.dates?.length || !chart?.official?.length || !chart?.dewater?.length) return;
  const query = wx.createSelectorQuery();
  query.select(`#${canvasId}`).fields({ node: true, size: true }).exec((result) => {
    const info = result && result[0];
    if (!info || !info.node) return;
    const canvas = info.node;
    const context = canvas.getContext('2d');
    const width = Math.max(1, Number(info.width) || 300);
    const height = Math.max(1, Number(info.height) || 120);
    let ratio = 1;
    try {
      ratio = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio;
    } catch (_) {}
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);

    const length = Math.min(chart.dates.length, chart.official.length, chart.dewater.length);
    const official = chart.official.slice(0, length).map(Number).filter(Number.isFinite);
    const dewater = chart.dewater.slice(0, length).map(Number).filter(Number.isFinite);
    if (!official.length || !dewater.length) return;
    const values = official.concat(dewater);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1, max - min);
    const yMin = min - span * 0.12;
    const yMax = max + span * 0.12;
    const padX = 2;
    const padTop = 8;
    const padBottom = 8;
    const plotWidth = width - padX * 2;
    const plotHeight = height - padTop - padBottom;
    const x = (index) => padX + (length <= 1 ? 0 : (index / (length - 1)) * plotWidth);
    const y = (value) => padTop + ((yMax - value) / (yMax - yMin || 1)) * plotHeight;

    context.strokeStyle = 'rgba(112, 96, 72, 0.12)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(padX, padTop + plotHeight);
    context.lineTo(width - padX, padTop + plotHeight);
    context.stroke();

    const drawLine = (series, color, lineWidth) => {
      context.beginPath();
      series.forEach((value, index) => {
        const px = x(index);
        const py = y(value);
        if (index === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.stroke();
    };

    const area = context.createLinearGradient(0, padTop, 0, height);
    area.addColorStop(0, 'rgba(63, 101, 120, 0.16)');
    area.addColorStop(1, 'rgba(63, 101, 120, 0)');
    context.beginPath();
    dewater.forEach((value, index) => {
      const px = x(index);
      const py = y(value);
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.lineTo(width - padX, height - padBottom);
    context.lineTo(padX, height - padBottom);
    context.closePath();
    context.fillStyle = area;
    context.fill();

    drawLine(official, 'rgba(96, 86, 72, 0.72)', 1.15);
    drawLine(dewater, '#3f6578', 1.8);
  });
}

module.exports = {
  getCachedDewaterCard,
  loadDewaterCard,
  drawDewaterTrend,
  numberText,
  pctText,
};
