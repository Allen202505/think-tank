'use client';

import NavIcon from './Icons';

// 功能大厅（移动端）：全屏浮层，5 大模块入口大卡，点卡片直达对应能力
export default function FeatureHall({ open, onClose, onSwitch, t }) {
  if (!open) return null;

  const cards = [
    { id: 'ask', name: t('tabsAsk'), desc: t('hallAskDesc') },
    { id: 'pools', name: t('tabsPools'), desc: t('hallPoolsDesc') },
    { id: 'breakfast', name: t('tabsBreakfast'), desc: t('hallBreakfastDesc') },
    { id: 'munger', name: t('tabsMunger'), desc: t('hallMungerDesc') },
    { id: 'zen', name: t('tabsZen'), desc: t('hallZenDesc') },
    // 跟踪大师动态：暂时隐藏
    // { id: 'radar', name: t('tabsRadar'), desc: t('hallRadarDesc') },
    { id: 'naval', name: t('tabsNaval'), desc: t('hallNavalDesc') },
    { id: 'fundamental', name: t('tabsFundamental'), desc: t('hallFundamentalDesc') },
    { id: 'industry-cycle', name: t('tabsIndustryCycle'), desc: t('hallIndustryCycleDesc') },
  ];

  return (
    <div className="feature-hall" role="dialog" aria-modal="true" aria-label={t('hallTitle')}>
      <div className="feature-hall-head">
        <div>
          <div className="feature-hall-title">{t('hallTitle')}</div>
          <div className="feature-hall-desc">{t('hallDesc')}</div>
        </div>
        <button type="button" className="feature-hall-close" onClick={onClose} aria-label="关闭">✕</button>
      </div>
      <div className="feature-hall-grid">
        {cards.map((c) => (
          <button
            key={c.id}
            type="button"
            className="feature-hall-card"
            onClick={() => { onSwitch(c.id); onClose(); }}
          >
            <span className="feature-hall-card-icon" aria-hidden="true"><NavIcon id={c.id} size={26} /></span>
            <span className="feature-hall-card-name">{c.name}</span>
            <span className="feature-hall-card-desc">{c.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
