'use client';

// 左侧极简纵向 Tab 导航：带小图标，默认选中大师PK；能力专项为未来占位（弱化置灰）
export default function SidebarNav({ tab, onSwitch, t }) {
  const items = [
    { id: 'ask', icon: '⚔️', label: t('tabsAsk') },
    { id: 'breakfast', icon: '📰', label: t('tabsBreakfast') },
    { id: 'munger', icon: '📖', label: t('tabsMunger') },
    { id: 'zen', icon: '🧘', label: t('tabsZen') },
    { id: 'pools', icon: '🎯', label: t('tabsPools') },
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
          <span className="vt-icon" aria-hidden="true">{it.icon}</span>
          <span className="vt-label">{it.label}</span>
        </button>
      ))}

    </nav>
  );
}
