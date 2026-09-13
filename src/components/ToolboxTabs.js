'use client';

import NavIcon from './Icons';
import styles from './ToolboxTabs.module.css';

export const TOOLBOX_TAB_IDS = ['munger', 'zen', 'naval', 'fundamental'];

export function isToolboxTab(id) {
  return TOOLBOX_TAB_IDS.includes(id);
}

export default function ToolboxTabs({ active, onChange, t }) {
  const tabs = [
    { id: 'munger', label: t('tabsMunger') },
    { id: 'zen', label: t('tabsZen') },
    { id: 'naval', label: t('tabsNaval') },
    { id: 'fundamental', label: t('tabsFundamental') },
  ];

  return (
    <header className={styles.toolbox}>
      <div className={styles.heading}>
        <div>
          <h2>{t('tabsToolbox')}</h2>
          <p>{t('toolboxDesc')}</p>
        </div>
        <span>{t('toolboxCount')}</span>
      </div>
      <nav className={styles.tabs} role="tablist" aria-label={t('tabsToolbox')}>
        {tabs.map((item) => {
          const selected = active === item.id;
          return (
            <button
              key={item.id}
              id={`toolbox-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`toolbox-panel-${item.id}`}
              className={`${styles.tab}${selected ? ` ${styles.active}` : ''}`}
              onClick={() => onChange(item.id)}
            >
              <span className={styles.icon}><NavIcon id={item.id} size={14} /></span>
              <strong className={styles.label}>{item.label}</strong>
            </button>
          );
        })}
      </nav>
    </header>
  );
}
