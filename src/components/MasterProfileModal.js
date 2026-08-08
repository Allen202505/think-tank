'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MasterAvatar } from './ui';

// 大师资料弹窗
export default function MasterProfileModal({ master, onClose, locale, onStartChat, onRemove }) {
  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef(null);

  // 卸载时清掉确认倒计时
  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
  }, []);

  if (!master) return null;
  const isEn = locale === 'en';
  const isCustom = master.source === 'custom';

  const handleRemove = () => {
    if (!confirming) {
      setConfirming(true);
      confirmTimer.current = setTimeout(() => setConfirming(false), 3000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    onRemove && onRemove(master.id);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="profileName">
      <div className="modal-content profile-modal" onClick={e => e.stopPropagation()} style={{ borderColor: master.color }}>
        <div className="profile-header" style={{ borderColor: master.color }}>
          <MasterAvatar master={master} size={56} className="profile-avatar" />
          <div>
            <h2 className="profile-name" id="profileName">{isEn && master.nameEn ? master.nameEn : master.name}</h2>
            <p className="profile-title">{isEn && master.titleEn ? master.titleEn : master.title}</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label={isEn ? 'Close' : '关闭'}>×</button>
        </div>
        <div className="profile-body">
          <section>
            <h4>{isEn ? 'Investment Style' : '投资风格与特点'}</h4>
            <p>{isEn && master.styleEn ? master.styleEn : master.style}</p>
          </section>
          <section>
            <h4>{isEn ? 'Personality' : '性格与发言风格'}</h4>
            <p>{master.personality}</p>
          </section>
          <section>
            <h4>{isEn ? 'Classic Theory' : '经典理论'}</h4>
            <p>{master.classicTheory || master.style}</p>
          </section>
          <section>
            <h4>{isEn ? 'Biography' : '经历简介'}</h4>
            <p>{master.biography || '—'}</p>
          </section>
          <blockquote className="profile-quote" style={{ borderLeftColor: master.color }}>
            「{master.quote}」
          </blockquote>

          {master.styleSample && (
            <section className="profile-extra">
              <h4>风格示范</h4>
              <p className="profile-style-sample">{master.styleSample}</p>
            </section>
          )}
          {isCustom && Array.isArray(master.sources) && master.sources.length > 0 && (
            <section className="profile-extra">
              <h4>画像资料来源</h4>
              <ul className="profile-sources">
                {master.sources.slice(0, 6).map((src, i) => <li key={i}>{src}</li>)}
              </ul>
            </section>
          )}
        </div>

        <div className="profile-actions">
            <button type="button" className="profile-chat-btn" onClick={() => onStartChat && onStartChat(master)}>
              💬 与 TA 单聊 →
            </button>
            {isCustom ? (
              onRemove && (
                <button
                  type="button"
                  className={`profile-remove-btn${confirming ? ' confirming' : ''}`}
                  onClick={handleRemove}
                >
                  {confirming ? (isEn ? '再点一次确认移除' : '再点一次确认移除') : (isEn ? '从智囊团移除' : '从智囊团移除')}
                </button>
              )
            ) : (
              <Link href={`/masters/${master.id}`} className="profile-page-link" onClick={onClose}>
                {isEn ? '查看大师主页 →' : '查看大师主页 →'}
              </Link>
            )}
        </div>
      </div>
    </div>
  );
}
