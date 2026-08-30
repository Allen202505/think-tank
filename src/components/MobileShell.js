'use client';

// 移动端壳层：顶部极简 header + 底部固定 Tab（桌面端隐藏）
// 默认进入大师PK；header 提供「功能大厅」入口；底部 Tab 一键切换 5 大模块。
export default function MobileShell({ tab, onSwitch, t, theme, onToggleTheme, onOpenHistory, onToggleQr, onOpenHall, onOpenAiSettings, onOpenAuth }) {
  const items = [
    { id: 'ask', icon: '⚔️', label: t('tabAskShort') },
    { id: 'breakfast', icon: '📰', label: t('tabBreakfastShort') },
    { id: 'munger', icon: '📖', label: t('tabMungerShort') },
    { id: 'zen', icon: '🧘', label: t('tabZenShort') },
    { id: 'pools', icon: '🎯', label: t('tabPoolsShort') },
    { id: 'naval', icon: '📚', label: t('tabNavalShort') },
  ];

  return (
    <>
      {/* 顶部极简 header（仅移动端显示） */}
      <header className="mobile-header">
        <button type="button" className="mobile-brand" onClick={() => onSwitch('ask')} title={t('title')}>
          {t('title')}
        </button>
        <div className="mobile-header-actions">
          <button type="button" className="mobile-hall-btn" onClick={onOpenHall} aria-label={t('hallTabLabel')}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
            {t('hallTabLabel')}
          </button>
          <button type="button" className="mobile-icon-btn" onClick={onOpenAiSettings} title="AI 设置（API Key / 模型）" aria-label="AI 设置">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2 14.4 5.6 18.6 6 17 9.8 18.6 13.6 14.4 14 12 17.6 9.6 14 5.4 13.6 7 9.8 5.4 6 9.6 5.6 12 2z" /><circle cx="12" cy="10" r="2" /></svg>
          </button>
          <button type="button" className="mobile-icon-btn" onClick={onOpenAuth} title="登录 / 注册（同步我的股票池）" aria-label="登录 / 注册">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
          </button>
          <button type="button" className="mobile-icon-btn" onClick={onToggleTheme} title={theme === 'dark' ? '切换亮色' : theme === 'light' ? '切换纯白' : '切换暗色'} aria-label="切换主题">
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            ) : theme === 'light' ? (
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="6" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
            )}
          </button>
          <button type="button" className="mobile-icon-btn" onClick={onToggleQr} title="微信二维码" aria-label="打开微信二维码">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-5.972 2.932-7.715 1.386-.87 3.052-1.306 4.71-1.306.527 0 1.054.047 1.572.132-.616-3.461-4.11-5.743-8.027-5.743zm-2.23 3.817a1.026 1.026 0 1 1 0 2.053 1.026 1.026 0 0 1 0-2.053zm4.466 0a1.026 1.026 0 1 1 0 2.053 1.026 1.026 0 0 1 0-2.053zM24 14.876c0-3.374-3.178-6.115-7.098-6.115-3.92 0-7.098 2.74-7.098 6.115 0 3.374 3.178 6.115 7.098 6.115.836 0 1.643-.12 2.393-.335a.7.7 0 0 1 .589.08l1.566.916a.268.268 0 0 0 .137.044.243.243 0 0 0 .239-.243c0-.06-.024-.117-.04-.176l-.322-1.218a.485.485 0 0 1 .176-.549C23.076 18.658 24 16.853 24 14.876zm-9.753-1.044a.843.843 0 1 1 0-1.686.843.843 0 0 1 0 1.686zm5.31 0a.843.843 0 1 1 0-1.686.843.843 0 0 1 0 1.686z"/>
            </svg>
          </button>
        </div>
      </header>

      {/* 底部固定 Tab（仅移动端显示） */}
      <nav className="mobile-tabs" aria-label="主导航">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            className={`mobile-tab${tab === it.id ? ' active' : ''}`}
            onClick={() => onSwitch(it.id)}
            aria-pressed={tab === it.id}
          >
            <span className="mobile-tab-icon" aria-hidden="true">{it.icon}</span>
            <span className="mobile-tab-label">{it.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
