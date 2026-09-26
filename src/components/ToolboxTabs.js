'use client';

import { useEffect, useRef } from 'react';
import NavIcon from './Icons';
import styles from './ToolboxTabs.module.css';
import { TOOLBOX_TAB_IDS } from '../lib/toolboxTabs.mjs';

const TAB_LABEL_KEYS = {
  fundamental: 'tabsFundamental',
  munger: 'tabsMunger',
  zen: 'tabsZen',
  naval: 'tabsNaval',
  'strategy-gallery': 'tabsStrategyGallery',
};

export default function ToolboxTabs({ active, onChange, t }) {
  const listRef = useRef(null);
  const tabs = TOOLBOX_TAB_IDS.map((id) => ({ id, label: t(TAB_LABEL_KEYS[id]) }));

  useEffect(() => {
    const list = listRef.current;
    const selected = list?.querySelector('[aria-selected="true"]');
    if (!list || !selected || list.scrollWidth <= list.clientWidth) return;
    const left = selected.offsetLeft - (list.clientWidth - selected.offsetWidth) / 2;
    list.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [active]);

  return (
    <header className={styles.toolbox}>
      <nav ref={listRef} className={styles.tabs} role="tablist" aria-label={t('tabsToolbox')}>
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
