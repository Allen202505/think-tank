'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { MasterAvatar } from './ui';
import AskDrawer from './AskDrawer';
import ModuleHero from './ModuleHero';
import { findMasterById } from '../lib/breakfast';
import { ensureAiReady, consumeFree, getAiConfig } from '../lib/aiGate';
import { markFeatureCompleted } from '../lib/shareInvite';
import { FUNDAMENTAL_MASTERS } from '../lib/fundamental';

const LS_KEY = 'thinktank_crocodile_fundamental_state';

// 加载阶段提示（五位大师分工 + 鱼大打分）
const LOADING_STEPS = [
  '五位大师正在分头研究…',
  '芒格正在做财务排雷…',
  '李录正在看长期趋势…',
  '巴菲特正在算安全边际…',
  '鱼大正在按「选股10条」打分…',
];

// 内联：**加粗**
function inlineRich(seg) {
  const normalized = String(seg || '').replace(/\*\*\*/g, '**');
  const parts = normalized.split(/\*\*([\s\S]+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : String(p).replace(/\*\*/g, '')));
}
// 长段落按句末标点兜底断行
function breakSentences(line) {
  if (line.length <= 70 || !/[。！？]/.test(line)) return [line];
  const parts = line.split(/(?<=[。！？])\s*/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [line];
}
// 研究小节 → 主责大师（多人协作就并排显示多个头像）
const SECTION_MASTERS = {
  '①': ['duan'],
  '②': ['buffett', 'crocodile'],
  '③': ['crocodile', 'buffett', 'duan'],
  '④': ['lilu', 'crocodile'],
  '⑤': ['munger'],
  '⑥': ['buffett', 'duan', 'crocodile'],
  '⑦': ['crocodile'],
  '⑧': ['munger', 'buffett', 'duan', 'lilu', 'crocodile'],
};

function renderSectionHead(title, owner, key) {
  const num = (String(title).match(/^([①②③④⑤⑥⑦⑧⑨])/) || [])[1];
  const ids = num ? SECTION_MASTERS[num] : null;
  const masters = (ids || []).map((id) => findMasterById(id)).filter(Boolean);
  return (
    <div key={key} className="explain-inline-head fnd-sec-head">
      {masters.length > 0 && (
        <span className="fnd-sec-avatars" aria-hidden="true">
          {masters.map((m) => <MasterAvatar key={m.id} master={m} size={22} />)}
        </span>
      )}
      <span className="fnd-sec-title">{inlineRich(title)}</span>
      {owner ? <span className="fnd-sec-owner">{inlineRich(owner)}</span> : null}
    </div>
  );
}

// 图表注册表：锚点名 → 标题 / 取数 / 组件 / 所属小节
const CHART_DEFS = {
  mainBusiness: { title: '主营构成（分产品占比）', kind: 'mainBusiness', data: (c) => c.mainBusiness, Comp: MainBusinessChart },
  revenue: { title: '营业收入（亿元）', kind: 'revenue', data: (c) => c.financials, Comp: RevenueChart },
  holders: { title: '股东户数趋势（越少越集中）', kind: 'holders', data: (c) => c.holders, Comp: HolderChart },
  orders: { title: '在手订单 vs 新签合同 vs 营收（亿元）', kind: 'orders', data: (c) => c.orders, Comp: OrderChart },
  margin: { title: '毛利率 / ROE', kind: 'margin', data: (c) => c.financials, Comp: MarginChart },
  cash: { title: '现金转化率（经营现金流/净利润）', kind: 'cashConversion', data: (c) => c.cashConversion, Comp: CashConversionChart },
  balance: { title: '资产负债科目（亿元）', kind: 'balance', data: (c) => c.balance, Comp: BalanceBars },
  valuation: { title: '估值历史分位（近 5 年）', kind: 'valuation', data: (c) => c.valuation, Comp: ValuationBars },
  position: { title: '股价所处的月线位置（近 10 年）', kind: 'position', data: (c) => c.position, Comp: PositionRuler },
};

// 各小节「兜底」图表：若 AI 没埋锚点，就放在该节末尾
const SECTION_CHART_KEYS = {
  '①': ['mainBusiness', 'revenue'],
  '③': ['holders'],
  '④': ['orders'],
  '⑤': ['margin', 'cash', 'balance'],
  '⑥': ['valuation'],
  '⑦': ['position'],
};

function renderChartBlock(key, charts, idx) {
  const def = CHART_DEFS[key];
  if (!def || !charts) return null;
  const data = def.data(charts);
  if (!data || (Array.isArray(data) && !data.length)) return null;
  const Comp = def.Comp;
  return (
    <div key={`chart-${key}-${idx}`} className="fnd-chart-box">
      <div className="fnd-chart-cap">{def.title}</div>
      <Comp data={data} />
    </div>
  );
}

// 块级：保留换行 / 列表 / 【标题】 / 分割线 / 引用
function renderRich(text, charts) {
  const lines = String(text || '').split('\n');
  const out = [];
  let list = [];
  const usedKeys = new Set();
  let curSection = null;
  const flush = () => { if (list.length) { out.push(<ul key={out.length} className="explain-list">{list}</ul>); list = []; } };
  const pushChart = (key) => {
    if (!key || usedKeys.has(key)) return;
    const block = renderChartBlock(key, charts, out.length);
    if (!block) return;
    usedKeys.add(key);
    out.push(<div key={`ic-${out.length}`} className="fnd-inline-charts">{block}</div>);
  };
  const flushSectionCharts = (sec) => {
    const keys = (SECTION_CHART_KEYS[sec] || []).filter((k) => !usedKeys.has(k));
    const blocks = keys
      .map((k, i) => { const b = renderChartBlock(k, charts, `${sec || 'x'}-${i}`); if (b) usedKeys.add(k); return b; })
      .filter(Boolean);
    if (blocks.length) { flush(); out.push(<div key={`ics-${out.length}`} className="fnd-inline-charts">{blocks}</div>); }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    // 图表锚点：AI 在该段末尾埋 [[CHART:key]]，图就插在这里
    const cm = line.match(/\[\[CHART:([A-Za-z]+)\]\]/);
    if (cm) {
      const rest = line.replace(/\[\[CHART:[A-Za-z]+\]\]/g, '').trim();
      if (rest) {
        flush();
        const b2 = rest.match(/^[-*•]\s+(.*)/);
        out.push(<p key={out.length} className="explain-text">{inlineRich(b2 ? b2[1] : rest)}</p>);
      }
      flush();
      pushChart(cm[1]);
      continue;
    }
    const secHead = line.match(/^【([^】]{1,40})】\s*(.*)$/);
    if (secHead && /^[①②③④⑤⑥⑦⑧⑨]/.test(secHead[1])) {
      flush();
      flushSectionCharts(curSection);
      curSection = secHead[1].trim().charAt(0);
      out.push(renderSectionHead(secHead[1], secHead[2], out.length));
      continue;
    }
    const marker = line.match(/^【(.+?)】$/);
    if (marker) { flush(); out.push(<div key={out.length} className="explain-inline-head">{inlineRich(marker[1])}</div>); continue; }
    if (/^[-*_]{3,}$/.test(line)) { flush(); out.push(<div key={out.length} className="markdown-hr" />); continue; }
    const quote = line.match(/^>\s?(.*)/);
    if (quote) { flush(); out.push(<blockquote key={out.length} className="fnd-quote">{inlineRich(quote[1])}</blockquote>); continue; }
    const bullet = line.match(/^[-*•]\s+(.*)/);
    if (bullet) { list.push(<li key={list.length}>{inlineRich(bullet[1])}</li>); continue; }
    flush();
    const numbered = line.match(/^\d+[.、)]\s+(.*)/);
    const text = numbered ? numbered[1] : line;
    const chunks = breakSentences(text);
    out.push(
      <p key={out.length} className="explain-text">
        {chunks.map((c, j) => (j === 0 ? inlineRich(c) : [<br key={`br-${j}`} />, inlineRich(c)]))}
      </p>
    );
  }
  flush();
  flushSectionCharts(curSection);
  return out;
}

// ── 图表组件（纯 SVG，无第三方库）──

// 1) 五年营收柱状图
function RevenueChart({ data }) {
  const W = 320, H = 132, padL = 34, padR = 8, padT = 14, padB = 22;
  const vals = data.map((d) => d.revenue).filter((v) => v != null);
  if (!vals.length) return null;
  const max = Math.max(...vals) * 1.12;
  const iw = W - padL - padR, ih = H - padT - padB;
  const bw = iw / data.length * 0.52;
  return (
    <svg className="fnd-chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="五年营业收入">
      {[0, 0.5, 1].map((t) => (
        <line key={t} x1={padL} x2={W - padR} y1={padT + ih * (1 - t)} y2={padT + ih * (1 - t)} className="fnd-grid" />
      ))}
      <text x={padL - 4} y={padT + 4} className="fnd-axis" textAnchor="end">{max.toFixed(0)}亿</text>
      <text x={padL - 4} y={padT + ih} className="fnd-axis" textAnchor="end">0</text>
      {data.map((d, i) => {
        const x = padL + (iw / data.length) * (i + 0.5);
        const v = d.revenue;
        if (v == null) return null;
        const h = (v / max) * ih;
        return (
          <g key={i}>
            <rect x={x - bw / 2} y={padT + ih - h} width={bw} height={h} rx="3" className="fnd-bar" />
            <text x={x} y={padT + ih - h - 4} className="fnd-val" textAnchor="middle">{v}</text>
            <text x={x} y={H - 7} className="fnd-axis" textAnchor="middle">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// 2) 毛利率 / ROE 折线
function MarginChart({ data }) {
  const W = 320, H = 132, padL = 30, padR = 8, padT = 14, padB = 22;
  const all = [...data.map((d) => d.grossMargin), ...data.map((d) => d.roe)].filter((v) => v != null);
  if (!all.length) return null;
  const max = Math.max(...all) * 1.2, min = Math.min(0, ...all);
  const iw = W - padL - padR, ih = H - padT - padB;
  const X = (i) => padL + (iw / Math.max(1, data.length - 1)) * i;
  const Y = (v) => padT + ih - ((v - min) / (max - min || 1)) * ih;
  const line = (key) => {
    const pts = data.map((d, i) => (d[key] == null ? null : `${X(i)},${Y(d[key])}`)).filter(Boolean);
    return pts.length > 1 ? pts.join(' ') : '';
  };
  return (
    <svg className="fnd-chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="毛利率与ROE趋势">
      {[0, 0.5, 1].map((t) => (
        <line key={t} x1={padL} x2={W - padR} y1={padT + ih * (1 - t)} y2={padT + ih * (1 - t)} className="fnd-grid" />
      ))}
      <text x={padL - 4} y={padT + 4} className="fnd-axis" textAnchor="end">{max.toFixed(0)}%</text>
      <text x={padL - 4} y={padT + ih} className="fnd-axis" textAnchor="end">{min.toFixed(0)}%</text>
      <polyline points={line('grossMargin')} className="fnd-line fnd-line-a" />
      <polyline points={line('roe')} className="fnd-line fnd-line-b" />
      {data.map((d, i) => (
        <g key={i}>
          {d.grossMargin != null && <circle cx={X(i)} cy={Y(d.grossMargin)} r="3" className="fnd-dot-a" />}
          {d.roe != null && <circle cx={X(i)} cy={Y(d.roe)} r="3" className="fnd-dot-b" />}
          <text x={X(i)} y={H - 7} className="fnd-axis" textAnchor="middle">{d.label}</text>
        </g>
      ))}
    </svg>
  );
}

// 3) 月线位置尺
function PositionRuler({ data }) {
  const { price, low10y, high10y, pos10y, pos5y, pos3y } = data;
  const span = high10y - low10y || 1;
  const p = Math.max(0, Math.min(100, ((price - low10y) / span) * 100));
  return (
    <div className="fnd-ruler">
      <div className="fnd-ruler-track">
        <div className="fnd-ruler-zone fnd-ruler-low" />
        <div className="fnd-ruler-zone fnd-ruler-mid" />
        <div className="fnd-ruler-zone fnd-ruler-high" />
        <div className="fnd-ruler-mark" style={{ left: `${p}%` }}>
          <span className="fnd-ruler-pin" />
          <span className="fnd-ruler-price">¥{price}</span>
        </div>
      </div>
      <div className="fnd-ruler-scale">
        <span>{low10y}</span>
        <span>近10年区间</span>
        <span>{high10y}</span>
      </div>
      <div className="fnd-ruler-meta">
        <span>10年分位 <b>{pos10y}%</b></span>
        {pos5y != null && <span>5年 <b>{pos5y}%</b></span>}
        {pos3y != null && <span>3年 <b>{pos3y}%</b></span>}
      </div>
    </div>
  );
}

// 4) 选股10条评分雷达图
function ScoreRadar({ scores, size = 220 }) {
  const n = scores.length;
  if (!n) return null;
  const cx = size / 2, cy = size / 2 + 4, R = size / 2 - 40;
  const pt = (i, val) => {
    const a = ((-90 + (360 / n) * i) * Math.PI) / 180;
    const r = (Math.max(0, Math.min(10, val)) / 10) * R;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const poly = scores.map((s, i) => pt(i, s.score10).join(',')).join(' ');
  return (
    <svg className="fnd-radar" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="选股10条评分雷达图">
      {[2.5, 5, 7.5, 10].map((lv) => (
        <polygon
          key={lv}
          points={Array.from({ length: n }, (_, i) => pt(i, lv).join(',')).join(' ')}
          className={lv === 10 ? 'fnd-radar-ring fnd-radar-outer' : 'fnd-radar-ring'}
        />
      ))}
      {scores.map((s, i) => {
        const [x, y] = pt(i, 10);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="fnd-radar-spoke" />;
      })}
      <polygon points={poly} className="fnd-radar-area" />
      {scores.map((s, i) => {
        const [x, y] = pt(i, s.score10);
        return <circle key={i} cx={x} cy={y} r="2.4" className="fnd-radar-dot" />;
      })}
      {scores.map((s, i) => {
        const [x, y] = pt(i, 11.9);
        return (
          <text key={i} x={x} y={y} className="fnd-radar-label" textAnchor="middle" dominantBaseline="middle">
            {s.no}
          </text>
        );
      })}
    </svg>
  );
}

// 4b) 主营构成（分产品占比）
function MainBusinessChart({ data }) {
  const rows = (data.byProduct || []).filter((r) => r.ratioPct != null);
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.ratioPct), 1);
  return (
    <div className="fnd-bars">
      {rows.map((r) => (
        <div key={r.name} className="fnd-bar-row">
          <span className="fnd-bar-name" title={r.name}>{r.name}</span>
          <span className="fnd-bar-track">
            <span className="fnd-bar-fill fnd-bar-recv" style={{ width: `${Math.max(2, (r.ratioPct / max) * 100)}%` }} />
          </span>
          <span className="fnd-bar-val">{r.ratioPct}%</span>
        </div>
      ))}
      {(data.byRegion && data.byRegion.length > 0) || data.overseasRatioPct != null ? (
        <div className="fnd-bar-note">
          {data.byRegion && data.byRegion.length > 0
            ? `分地区：${data.byRegion.map((r) => `${r.name} ${r.ratioPct}%`).join(' / ')}`
            : ''}
          {data.overseasRatioPct != null ? `　境外收入占比 ${data.overseasRatioPct}%` : ''}
        </div>
      ) : null}
    </div>
  );
}

// 4c) 资产负债科目横条
function BalanceBars({ data }) {
  const items = [
    { label: '货币资金', v: data.cashYi, cls: 'cash' },
    { label: '有息负债', v: data.interestDebtYi, cls: 'debt' },
    { label: '应收账款', v: data.receivablesYi, cls: 'recv' },
    { label: '存货', v: data.inventoryYi, cls: 'inv' },
  ].filter((x) => x.v != null);
  if (!items.length) return null;
  const max = Math.max(...items.map((x) => Number(x.v)), 1);
  return (
    <div className="fnd-bars">
      {items.map((x) => (
        <div key={x.label} className="fnd-bar-row">
          <span className="fnd-bar-name">{x.label}</span>
          <span className="fnd-bar-track">
            <span className={`fnd-bar-fill fnd-bar-${x.cls}`} style={{ width: `${Math.max(2, (Number(x.v) / max) * 100)}%` }} />
          </span>
          <span className="fnd-bar-val">{x.v}</span>
        </div>
      ))}
      {data.netCashYi != null ? <div className="fnd-bar-note">净现金 <b>{data.netCashYi} 亿</b></div> : null}
    </div>
  );
}

// 5) 订单 vs 营收（横向对比条）
function OrderChart({ data }) {
  const items = [
    { label: '在手订单', v: data.backlogYi, cls: 'backlog' },
    { label: '新签合同', v: data.h1NewYi != null ? data.h1NewYi : data.newYi, cls: 'neworder' },
    { label: data.revenueLabel && /中报|半年/.test(data.revenueLabel) ? '半年营收' : '当期营收', v: data.revenueYi, cls: 'rev' },
  ].filter((x) => x.v != null);
  if (items.length < 2) return null;
  const max = Math.max(...items.map((x) => x.v), 1);
  return (
    <div className="fnd-bars">
      {items.map((x) => (
        <div key={x.label} className="fnd-bar-row">
          <span className="fnd-bar-name">{x.label}</span>
          <span className="fnd-bar-track">
            <span className={`fnd-bar-fill fnd-bar-${x.cls}`} style={{ width: `${Math.max(2, (x.v / max) * 100)}%` }} />
          </span>
          <span className="fnd-bar-val">{x.v}亿</span>
        </div>
      ))}
      {data.backlogYi != null && data.revenueYi ? (
        <div className="fnd-bar-note">在手订单是当期营收的 <b>{(data.backlogYi / data.revenueYi).toFixed(1)} 倍</b></div>
      ) : null}
    </div>
  );
}

// 6) 现金转化率（正负柱）
function CashConversionChart({ data }) {
  const W = 320, H = 132, padL = 30, padR = 8, padT = 14, padB = 22;
  const vals = data.map((d) => d.value);
  if (!vals.length) return null;
  const max = Math.max(...vals, 0.5), min = Math.min(...vals, -0.5);
  const iw = W - padL - padR, ih = H - padT - padB;
  const Y = (v) => padT + ih - ((v - min) / (max - min || 1)) * ih;
  const zeroY = Y(0);
  const bw = (iw / data.length) * 0.5;
  return (
    <svg className="fnd-chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="现金转化率趋势">
      <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} className="fnd-zero" />
      <text x={padL - 4} y={padT + 5} className="fnd-axis" textAnchor="end">{max.toFixed(1)}</text>
      <text x={padL - 4} y={padT + ih} className="fnd-axis" textAnchor="end">{min.toFixed(1)}</text>
      {data.map((d, i) => {
        const x = padL + (iw / data.length) * (i + 0.5);
        const y0 = zeroY, y1 = Y(d.value);
        const top = Math.min(y0, y1), h = Math.max(2, Math.abs(y1 - y0));
        return (
          <g key={i}>
            <rect x={x - bw / 2} y={top} width={bw} height={h} rx="2" className={d.value >= 0 ? 'fnd-bar fnd-bar-pos' : 'fnd-bar fnd-bar-neg'} />
            <text x={x} y={d.value >= 0 ? top - 3 : top + h + 10} className="fnd-val" textAnchor="middle">{d.value}</text>
            <text x={x} y={H - 7} className="fnd-axis" textAnchor="middle">{d.label.slice(2)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// 7) 股东户数趋势（筹码集中度）
function HolderChart({ data }) {
  const W = 320, H = 132, padL = 40, padR = 8, padT = 14, padB = 22;
  const vals = data.map((d) => d.value).filter((v) => v != null);
  if (vals.length < 2) return null;
  const max = Math.max(...vals) * 1.08, min = Math.min(...vals) * 0.92;
  const iw = W - padL - padR, ih = H - padT - padB;
  const X = (i) => padL + (iw / Math.max(1, data.length - 1)) * i;
  const Y = (v) => padT + ih - ((v - min) / (max - min || 1)) * ih;
  const pts = data.map((d, i) => `${X(i)},${Y(d.value)}`).join(' ');
  return (
    <svg className="fnd-chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="股东户数趋势">
      {[0, 1].map((t) => (
        <line key={t} x1={padL} x2={W - padR} y1={padT + ih * t} y2={padT + ih * t} className="fnd-grid" />
      ))}
      <text x={padL - 4} y={padT + 5} className="fnd-axis" textAnchor="end">{(max / 10000).toFixed(1)}万</text>
      <text x={padL - 4} y={padT + ih} className="fnd-axis" textAnchor="end">{(min / 10000).toFixed(1)}万</text>
      <polyline points={pts} className="fnd-line fnd-line-c" />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={X(i)} cy={Y(d.value)} r="3" className="fnd-dot-c" />
          <text x={X(i)} y={H - 7} className="fnd-axis" textAnchor="middle">{d.label.slice(2)}</text>
        </g>
      ))}
    </svg>
  );
}

// 8) 估值分位条
function ValuationBars({ data }) {
  const rows = [
    { label: 'PE 分位', pct: data.pePercentile, val: data.pe, band: data.peBand },
    { label: 'PB 分位', pct: data.pbPercentile, val: data.pb, band: data.pbBand },
  ].filter((r) => r.pct != null);
  if (!rows.length) return null;
  return (
    <div className="fnd-bars">
      {rows.map((r) => (
        <div key={r.label} className="fnd-bar-row">
          <span className="fnd-bar-name">{r.label}</span>
          <span className="fnd-bar-track">
            <span
              className={`fnd-bar-fill ${r.pct <= 20 ? 'fnd-bar-cheap' : r.pct >= 80 ? 'fnd-bar-rich' : 'fnd-bar-recv'}`}
              style={{ width: `${Math.max(2, Math.min(100, r.pct))}%` }}
            />
          </span>
          <span className="fnd-bar-val">{r.pct}%{r.val != null ? `（${r.val}）` : ''}</span>
        </div>
      ))}
      <div className="fnd-bar-note">分位越低越便宜；&lt;20% 为历史低位，&gt;80% 为历史高位</div>
    </div>
  );
}

function fmtPrice(v) {
  const s = String(v || '').trim();
  if (!s || s.includes('元') || s.includes('%')) return s;
  return /^[\d.~\-–—+至约]+$/.test(s) ? `${s}元` : s;
}

export default function CrocodileFundamental() {
  const master = findMasterById('crocodile');
  const [symbol, setSymbol] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadStep, setLoadStep] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const hydratedRef = useRef(false);

  // 举手提问
  const [askOpen, setAskOpen] = useState(false);
  const [seed, setSeed] = useState('');

  // 结果持久化：刷新/重开页面后恢复最近一次研究
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.result && typeof s.result === 'object') setResult(s.result);
        if (s && typeof s.symbol === 'string') setSymbol(s.symbol);
        if (s && typeof s.note === 'string') setNote(s.note);
      }
    } catch (e) { /* 恢复失败不影响 */ }
    const t = setTimeout(() => { hydratedRef.current = true; }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!hydratedRef.current) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify({ result, symbol, note })); } catch (e) { /* ignore */ }
  }, [result, symbol, note]);

  // 加载阶段轮播
  useEffect(() => {
    if (!loading) { setLoadStep(0); return; }
    const iv = setInterval(() => setLoadStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)), 14000);
    return () => clearInterval(iv);
  }, [loading]);

  const run = useCallback(async () => {
    if (loading) return;
    if (!symbol.trim()) return;
    if (!ensureAiReady()) return;
    consumeFree();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/fundamental', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'research', symbol: symbol.trim(), note: note.trim(), aiConfig: getAiConfig() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '研究失败，请重试');
      setResult(data.result);
      markFeatureCompleted('基础面研究');
    } catch (e) {
      const m = String((e && e.message) || e || '');
      setError(/failed to fetch|network|load|timed? ?out|econn|reset/i.test(m) ? '网络异常或连接超时，请重试' : (m || '研究失败，请重试'));
    } finally {
      setLoading(false);
    }
  }, [loading, symbol, note]);

  const askContext = useCallback(() => {
    if (!result) return '';
    const scoreLine = (result.scores || []).map((s) => `第${s.no}条 ${s.name}：${s.score10}分（${s.reason || '—'}）`).join('\n');
    const head = result.total != null ? `总分：${result.total} 分（${result.band}）` : '（本次未生成评分）';
    return [head, `研究正文：${result.research || ''}`, `评分明细：\n${scoreLine}`].join('\n').slice(0, 8000);
  }, [result]);

  const handleAsk = useCallback(async (question) => {
    const res = await fetch('/api/fundamental', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'followup', question, context: askContext(), stockName: result?.stockName || '', aiConfig: getAiConfig() }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || '追问失败，请重试');
    return { content: data.result?.content || '' };
  }, [askContext, result]);

  if (!master) {
    return <div className="mg-workspace"><div className="mg-error">⚠ 寒武纪的鳄鱼大师缺失，请稍后重试。</div></div>;
  }

  const renderFallback = result && result.fallback;
  const fallbackText = renderFallback ? (result.content || '') : '';
  const hasScores = result && Array.isArray(result.scores) && result.scores.length > 0;

  return (
    <div className="mg-workspace">
      <ModuleHero
        iconId="fundamental"
        kicker="DEEP RESEARCH · FIVE MASTERS"
        title="鱼大基础面研究"
        description="五位大师从生意本质、护城河、逆向排雷到长期趋势分工深挖，再由鱼大按「选股10条」给出评分与买卖点。"
      />

      {/* 五位大师研究小组：诚实披露协作方式 */}
      <div className="fnd-team">
        <div className="fnd-team-label">本模块基本面研究由 <strong>5 位大师协作完成</strong>，最后由鱼大按「选股10条」打分</div>
        <div className="fnd-team-row">
          {FUNDAMENTAL_MASTERS.map((m) => {
            const mm = findMasterById(m.id) || { name: m.name, color: '#8a8a8a' };
            return (
              <div key={m.id} className="fnd-team-item" title={`${m.name} · ${m.role}`}>
                <MasterAvatar master={mm} size={34} />
                <div className="fnd-team-name">{m.short}</div>
                <div className="fnd-team-role">{m.role}</div>
              </div>
            );
          })}
        </div>
      </div>


      <div className="mg-card">
        <div className="mg-card-label">输入一只股票，五位大师联合体检</div>
        <div className="mg-link-row">
          <input
            className="mg-input mg-input-line"
            placeholder="如：中盐化工 / 600328 / 中密控股"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); } }}
          />
          <button type="button" className="mg-btn" onClick={run} disabled={loading || !symbol.trim()}>
            {loading ? '研究中…' : '▶ 开始深度研究'}
          </button>
        </div>
        <input
          className="mg-input mg-input-line"
          placeholder="补充说明（可选）：如你关注的买入价位、想重点验证的风险点"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); } }}
        />
      </div>

      {error && <div className="mg-error">⚠ {error}</div>}

      {loading && (
        <div className="mg-loading fnd-loading">
          <div className="fnd-loading-avatars">
            {FUNDAMENTAL_MASTERS.map((m) => {
              const mm = findMasterById(m.id) || { name: m.name, color: '#8a8a8a' };
              return <MasterAvatar key={m.id} master={mm} size={26} />;
            })}
          </div>
          <span>{LOADING_STEPS[loadStep]}</span>
          <span className="fnd-loading-hint">深度研究通常需要 1-2 分钟，请稍等</span>
        </div>
      )}

      {result && !loading && !renderFallback && (
        <div className="mg-result">
          {/* 联合研究正文 */}
          <div className="mg-speech">
            <div className="mg-speech-head">
              <MasterAvatar master={master} size={40} />
              <span className="mg-speech-name">五位大师联合研究</span>
              <span className="mg-speech-tag">基础面深度研究 · {result.stockName || '—'}</span>
            </div>
            <div className="mg-speech-body">{renderRich(result.research, result.charts)}</div>
          </div>

          {/* 选股10条评分 */}
          <div className="fnd-card">
            <div className="fnd-card-title">鱼大 · 选股10条评分</div>
            {hasScores ? (
              <>
                <div className="fnd-radar-wrap">
                  <ScoreRadar scores={result.scores} />
                  <div className="fnd-radar-note">10 个维度按 10 分制绘制；越靠外越强</div>
                </div>
                <div className="fnd-table-wrap">
                  <table className="fnd-table">
                    <thead>
                      <tr>
                        <th className="fnd-th-no">#</th>
                        <th>选股准则</th>
                        <th className="fnd-th-num">权重</th>
                        <th className="fnd-th-num">10分制</th>
                        <th className="fnd-th-num">百分制</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.scores.map((s) => (
                        <tr key={s.no}>
                          <td className="fnd-td-no">{s.no}</td>
                          <td>
                            <div className="fnd-crit">{s.name}</div>
                            {s.reason && <div className="fnd-crit-reason">{s.reason}</div>}
                          </td>
                          <td className="fnd-td-num">{s.weight}%</td>
                          <td className="fnd-td-num">{s.score10}</td>
                          <td className="fnd-td-num">{s.score100}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="fnd-td-no" colSpan={4}>合计</td>
                        <td className="fnd-td-num">{result.total}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="fnd-band">
                  总分区间：{result.band}
                  <span className="fnd-band-legend">＞90 绝佳 · 80-90 稀有 · 70-80 合理 · ＜70 等待</span>
                </div>
              </>
            ) : (
              <div className="fnd-noscore">本次只生成了深度研究，评分未能生成（可能是模型输出异常）。可点击下方「举手提问」，或稍后重新研究一次。</div>
            )}
          </div>

          {/* 最终结论 */}
          {hasScores && (
            <div className="fnd-card">
              <div className="fnd-card-title">最终结论</div>
              <div className="fnd-conclusion">
                <div className="fnd-conc-item fnd-conc-wide">
                  <label>最强项</label>
                  <span>{result.strongest || '—'}</span>
                </div>
                <div className="fnd-conc-item fnd-conc-wide">
                  <label>最弱项</label>
                  <span>{result.weakest || '—'}</span>
                </div>
                <div className="fnd-conc-item fnd-conc-wide">
                  <label>核心矛盾</label>
                  <span>{result.coreConflict || '—'}</span>
                </div>
                <div className="fnd-conc-item">
                  <label>推荐买入价</label>
                  <span>{fmtPrice(result.buyPrice) || '—'}</span>
                </div>
                <div className="fnd-conc-item">
                  <label>推荐重仓价</label>
                  <span>{fmtPrice(result.heavyPrice) || '—'}</span>
                </div>
                <div className="fnd-conc-item">
                  <label>预计卖出价</label>
                  <span>{fmtPrice(result.sellPrice) || '—'}</span>
                </div>
                <div className="fnd-conc-item">
                  <label>盈利空间</label>
                  <span>{result.upside || '—'}</span>
                </div>
              </div>
            </div>
          )}

          {/* 系统数据核验 */}
          {result.dataCard && (
            <details className="mg-data-card" open={false}>
              <summary>
                <span className="mg-data-card-title">📋 系统数据核验</span>
                <span className="mg-data-card-hint">行情/财务/深度分析快照（来自公开数据层，非 AI 记忆）</span>
              </summary>
              <div className="mg-data-card-body">{result.dataCard}</div>
            </details>
          )}

          {/* 追问 */}
          {Array.isArray(result.followUps) && result.followUps.length > 0 && (
            <div className="mg-followups">
              <div className="mg-fu-label">想深挖？点击即可举手提问：</div>
              {result.followUps.map((f, fi) => (
                <button key={fi} type="button" className="mg-fu-item" onClick={() => { setSeed(f); setAskOpen(true); }} title="点击举手提问">
                  <span className="mg-fu-ask">＋</span> {f}
                </button>
              ))}
            </div>
          )}
          <div className="mg-ask-row">
            <button type="button" className="mg-btn mg-ask-btn" onClick={() => { setSeed(''); setAskOpen(true); }}>✋ 举手提问</button>
          </div>
        </div>
      )}

      {/* 兜底：AI 没按 JSON 输出时，降级为纯文本展示 */}
      {result && !loading && renderFallback && (
        <div className="mg-result">
          <div className="mg-speech">
            <div className="mg-speech-head">
              <MasterAvatar master={master} size={40} />
              <span className="mg-speech-name">五位大师联合研究</span>
              <span className="mg-speech-tag">基础面研究</span>
            </div>
            <div className="mg-speech-body">{renderRich(fallbackText)}</div>
          </div>
        </div>
      )}

      {askOpen && result && !renderFallback && (
        <AskDrawer
          master={master}
          context={askContext()}
          onClose={() => { setAskOpen(false); setSeed(''); }}
          onAsk={handleAsk}
          placeholder="向五位大师追问这只股票…"
          seedQuestion={seed}
        />
      )}
    </div>
  );
}
