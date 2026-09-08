// src/app/api/zen/chanContext.js
// 「缠中说禅 · 看短线」喂给模型的 K 线语境：把缠论真正关心的数据补齐后再交给模型。
// 覆盖：日线技术面、量能趋势/地量放量、缠论视角（笔/中枢/背驰 + 现价相对中枢位置）、
// 一二三类买卖点研判、近20日区间、周线多级别联立、今日跳空缺口。
// 全部为纯函数 + 只读计算，任一环节异常都只丢一行，不影响主流程。
import { computeChanIndicators, computeIndicators } from '../chat/uziSkills.js';

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function avgN(arr, n) {
  if (!Array.isArray(arr) || arr.length < n) return null;
  let s = 0;
  for (let i = arr.length - n; i < arr.length; i++) s += Number(arr[i]) || 0;
  return s / n;
}

// 日期 → ISO 周键（按 UTC 计算，A股日K只含交易日，结果稳定）
function weekKey(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const dow = d.getUTCDay() || 7; // 周一=1 … 周日=7
  d.setUTCDate(d.getUTCDate() + 4 - dow); // 定位到本周四
  const year = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const wk = Math.ceil((((d - jan1) / 86400000) + 1) / 7);
  return `${year}-W${wk}`;
}

// 日K → 周K（高取最高、低取最低、收取最后、量求和；open 日K未取故不聚）
function toWeeklyBars(daily) {
  const out = [];
  for (const k of daily) {
    const key = weekKey(k.date);
    if (!key) continue;
    const high = num(k.high) ?? 0;
    const low = num(k.low) ?? 0;
    const close = num(k.close);
    const vol = num(k.vol) ?? 0;
    if (close == null) continue;
    const last = out[out.length - 1];
    if (last && last.key === key) {
      last.high = Math.max(last.high, high);
      last.low = Math.min(last.low, low);
      last.close = close;
      last.vol += vol;
      last.date = k.date;
    } else {
      out.push({ key, date: k.date, high, low, close, vol });
    }
  }
  return out.map(({ key, ...rest }) => rest);
}

function todayStr() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 上一根"已完成"日K：优先用 昨收 反查，找不到再按日期判断
function prevCompletedBar(klines, quote) {
  if (!Array.isArray(klines) || klines.length < 2) return null;
  const pc = num(quote && quote.prevClose);
  if (pc != null) {
    for (let i = klines.length - 2; i >= Math.max(0, klines.length - 12); i--) {
      const c = num(klines[i].close);
      if (c != null && Math.abs(c - pc) <= Math.max(0.01, pc * 0.001)) return klines[i];
    }
  }
  const last = klines[klines.length - 1];
  const lastIsToday = last && String(last.date).slice(0, 10) === todayStr();
  return klines[klines.length - (lastIsToday ? 2 : 1)] || null;
}

function beijingInSession() {
  // 北京时间周一~周五 09:30–15:00 为 A股连续竞价时段
  const b = new Date(Date.now() + 8 * 3600000); // 用 UTC 分量读出北京时间
  const day = b.getUTCDay();
  const mins = b.getUTCHours() * 60 + b.getUTCMinutes();
  return day >= 1 && day <= 5 && mins >= 570 && mins <= 900;
}

function volumeLine(klines, quote) {
  const vols = klines.map((k) => num(k.vol) ?? 0);
  const lastVol = vols[vols.length - 1];
  if (!lastVol) return null;
  const v20 = avgN(vols, 20);
  const hasQuoteVol = quote && (quote.volume != null || quote.f5 != null); // 行情行已含当日量则不再重复
  const bits = hasQuoteVol ? [] : [`最新量 ${Math.round(lastVol).toLocaleString()}手`];
  if (v20 && v20 > 0) {
    bits.push(`较20日均量 ${(lastVol / v20).toFixed(2)} 倍`);
    const v5 = avgN(vols, 5);
    if (v5 != null && v5 > 0) {
      const t = v5 / v20;
      bits.push(`5日均量/20日均量 ${t.toFixed(2)}（${t >= 1.05 ? '量能放大' : t <= 0.95 ? '量能萎缩' : '量能平稳'}）`);
    }
    const win = vols.slice(-60).filter((v) => v > 0);
    if (win.length >= 20) {
      const below = win.filter((v) => v <= lastVol).length;
      const pct = Math.round((below / win.length) * 100);
      let tag = '';
      if (pct <= 20) tag = '，近60日地量区';
      else if (pct >= 80) tag = '，近60日放量区';
      bits.push(`量能分位 ${pct}%${tag}`);
    }
  }
  if (beijingInSession()) bits.push('盘中量能未定格（收盘前地量/放量结论仅参考）');
  return `【量能】${bits.join('，')}`;
}

function chanViewLine(chan, price) {
  const bits = [`${chan.penDirection}${chan.lastFractal ? `，末端${chan.lastFractal}` : ''}`];
  if (chan.currentZhong) {
    const z = chan.currentZhong;
    const pos = price != null
      ? (price > z.high ? '现价位于中枢上沿上方' : price < z.low ? '现价位于中枢下沿下方' : '现价位于中枢区间内')
      : '';
    bits.push(`最近中枢 ${z.low.toFixed(2)}–${z.high.toFixed(2)}${pos ? `（${pos}）` : ''}`);
  }
  if (chan.divergence) bits.push(chan.divergence);
  return `【缠论视角】${bits.join('，')}`;
}

// 一二三类买卖点/震荡的启发式研判（给模型线索，最终判断仍由缠师结合实时K线给出）
function signalLine(chan, price, weeklyChan) {
  const zg = chan.currentZhong ? chan.currentZhong.high : null;
  const zd = chan.currentZhong ? chan.currentZhong.low : null;
  const down = chan.penDirection === '下降笔';
  const up = chan.penDirection === '上升笔';
  const bottomDiv = chan.divergence === '底背驰（下跌力度减弱）';
  const topDiv = chan.divergence === '顶背驰（上涨力度减弱）';
  const cand = [];
  if (down) {
    if (bottomDiv) cand.push('下跌背驰段：一买候选区，等底分型+向上笔确认，其后回踩不破前低即二买');
    else if (zd == null || (price != null && price <= zd)) cand.push('中枢下方/下跌途中未见底背驰：不抄底，等背驰+底分型');
  }
  if (zd != null && zg != null && price != null && price >= zd && price <= zg) {
    cand.push('中枢震荡：下沿缩量企稳关注类二买，上沿放量突破才看离开');
  }
  if (up && zg != null && price != null && price > zg) {
    if (topDiv) cand.push('离开中枢后顶背驰：一卖候选，注意风险');
    else cand.push('离开中枢的向上笔：回抽不破中枢上沿可确认三买，勿追高');
  }
  if (up && chan.lastFractal === '顶分型' && zg != null && price != null && price < zg) {
    if (topDiv) cand.push('上涨笔顶分型后跌破中枢：上涨或已结束，向下笔未完成，等底背驰再谈一买');
    else cand.push('上涨笔末端顶分型后跌破中枢下沿：上涨笔或已结束，等向下笔确认，勿急于抄底');
  }
  if (down && zg != null && price != null && price > zg) {
    cand.push('自中枢上方回踩：不破中枢上沿属三买回试，跌破则重回中枢');
  }
  if (weeklyChan && weeklyChan.penDirection) {
    if (weeklyChan.penDirection === '上升笔' && down) cand.push('周线向上、日线回调：企稳信号偏买点性质');
    else if (weeklyChan.penDirection === '下降笔' && up) cand.push('周线向下、日线反弹：视为反弹，压力看周线中枢');
  }
  if (!cand.length) cand.push('结构未明：等待新的分型/笔确认方向');
  return `【买卖点研判】${cand.join('；')}`;
}

function weeklyViewLine(klines, price) {
  const weekly = toWeeklyBars(klines);
  if (weekly.length < 5) return null;
  const chan = computeChanIndicators(weekly);
  const closes = weekly.map((k) => k.close);
  const ma5 = avgN(closes, 5);
  const ma10 = avgN(closes, 10);
  const ma20 = avgN(closes, 20);
  const bits = [];
  if (ma5 != null && ma10 != null && ma20 != null) {
    if (ma5 > ma10 && ma10 > ma20) bits.push('5/10/20周均线多头排列');
    else if (ma5 < ma10 && ma10 < ma20) bits.push('5/10/20周均线空头排列');
    else bits.push('周线均线缠绕（中期方向未明）');
    bits.push(`周MA5 ${ma5.toFixed(2)} / 周MA10 ${ma10.toFixed(2)} / 周MA20 ${ma20.toFixed(2)}`);
  }
  if (chan && chan.penDirection) {
    bits.push(`周线${chan.penDirection}${chan.lastFractal ? `，末端${chan.lastFractal}` : ''}`);
  }
  if (chan && chan.currentZhong) {
    const z = chan.currentZhong;
    const pos = price != null
      ? (price > z.high ? '现价在周中枢上方' : price < z.low ? '现价在周中枢下方' : '现价在周中枢内')
      : '';
    bits.push(`周线中枢 ${z.low.toFixed(2)}–${z.high.toFixed(2)}${pos ? `（${pos}）` : ''}`);
  }
  if (chan && chan.divergence) bits.push(`周线${chan.divergence}`);
  return bits.length ? `【周线视角】${bits.join('，')}` : null;
}

function gapLine(quote, klines) {
  const open = num(quote && quote.open);
  if (open == null) return null;
  const prev = prevCompletedBar(klines, quote);
  if (!prev) return null;
  const ph = num(prev.high);
  const pl = num(prev.low);
  if (ph == null || pl == null) return null;
  if (open > ph) {
    return `【今日缺口】向上跳空：今开 ${open.toFixed(2)} 高于上一交易日最高 ${ph.toFixed(2)}（约 ${((open / ph - 1) * 100).toFixed(1)}%），关注缺口回补/支撑`;
  }
  if (open < pl) {
    return `【今日缺口】向下跳空：今开 ${open.toFixed(2)} 低于上一交易日最低 ${pl.toFixed(2)}（约 ${((1 - open / pl) * 100).toFixed(1)}%），关注缺口回补/压力`;
  }
  return null;
}

// 主入口：返回喂给模型的数据行（顺序即展示顺序）
export function buildChanContextLines(quote, klines) {
  if (!Array.isArray(klines) || !klines.length) return [];
  const lines = [];
  const last = klines[klines.length - 1];
  const price = num(quote && quote.price) ?? num(last.close);

  // ① 日线技术面
  const ind = computeIndicators(klines);
  if (ind) {
    const bits = [];
    if (ind.trend) bits.push(ind.trend);
    if (ind.ma5 != null && ind.ma20 != null) {
      bits.push(`MA5 ${ind.ma5} / MA10 ${ind.ma10 ?? '—'} / MA20 ${ind.ma20}${ind.ma60 != null ? ` / MA60 ${ind.ma60}` : ''}`);
    }
    if (ind.rsi14 != null) bits.push(`RSI ${ind.rsi14}`);
    if (ind.macd && ind.macd.dif != null && ind.macd.dea != null) bits.push(ind.macd.dif > ind.macd.dea ? 'MACD 金叉' : 'MACD 死叉');
    if (ind.chg20d != null) bits.push(`近20日 ${ind.chg20d}%`);
    if (ind.chg60d != null) bits.push(`近60日 ${ind.chg60d}%`);
    if (ind.limitUpStreak) bits.push(`近10日连板 ${ind.limitUpStreak}`);
    if (bits.length) lines.push(`【技术面】${bits.join('，')}`);
  }

  // ② 量能（缠论辅助：地量见底、突破需量、缩量回调）
  const volLine = volumeLine(klines, quote);
  if (volLine) lines.push(volLine);

  // ③ 今日跳空缺口
  const gap = gapLine(quote, klines);
  if (gap) lines.push(gap);

  // ④ 近20日区间（支撑/压力参考）
  const recent = klines.slice(-20);
  const hi20 = Math.max(...recent.map((k) => num(k.high) ?? 0));
  const lo20 = Math.min(...recent.map((k) => num(k.low) ?? Infinity));
  if (Number.isFinite(hi20) && Number.isFinite(lo20) && recent.length) {
    lines.push(`【近20日区间】最高 ${hi20.toFixed(2)} / 最低 ${lo20.toFixed(2)}（${recent[0].date}~${recent[recent.length - 1].date}）`);
  }

  // ⑤ 缠论视角（日线）
  const chan = computeChanIndicators(klines);
  if (chan && chan.penDirection) lines.push(chanViewLine(chan, price));

  // ⑥ 周线多级别联立（大级别背景）
  const weeklyChan = computeChanIndicators(toWeeklyBars(klines));
  const wLine = weeklyViewLine(klines, price);
  if (wLine) lines.push(wLine);

  // ⑦ 买卖点研判（结合日线 + 周线）
  if (chan && chan.penDirection) lines.push(signalLine(chan, price, weeklyChan));

  return lines;
}
