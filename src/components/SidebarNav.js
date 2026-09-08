'use client';

import NavIcon from './Icons';

// 左侧极简纵向 Tab 导航：黑白线性图标，默认选中大师PK
export default function SidebarNav({ tab, onSwitch, t }) {
  const items = [
    { id: 'ask', label: t('tabsAsk') },
    { id: 'breakfast', label: t('tabsBreakfast') },
    { id: 'munger', label: t('tabsMunger') },
    { id: 'zen', label: t('tabsZen') },
    { id: 'pools', label: t('tabsPools') },
    // 跟踪大师动态：能力未就绪（RSSHub/知乎 Cookie/VPS），暂时隐藏，就绪后放开
    // { id: 'radar', label: t('tabsRadar') },
    { id: 'naval', label: t('tabsNaval') },
  ];
  return (
    <nav className="vt-nav" aria-label="主导航">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={`vt-item${tab === it.id ? ' active' : ''}`}
          onClick={() => onSwitch(it.id)}
          aria-pressed={tab === it.id}
        >
          <span className="vt-icon" aria-hidden="true">
            <NavIcon id={it.id} size={18} />
          </span>
          <span className="vt-label">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
