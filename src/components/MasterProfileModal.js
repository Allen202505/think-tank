'use client';

import Link from 'next/link';
import { MasterAvatar } from './ui';

// 大师资料弹窗（从 page.js 拆出）

export default function MasterProfileModal({ master, onClose, locale }) {
  if (!master) return null;
  const isEn = locale === 'en';
  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-content profile-modal" onClick={e => e.stopPropagation()} style={{ borderColor: master.color }}>
        <div className="profile-header" style={{ borderColor: master.color }}>
          <MasterAvatar master={master} size={56} className="profile-avatar" />
          <div>
            <h2 className="profile-name">{isEn && master.nameEn ? master.nameEn : master.name}</h2>
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
          {master.source !== 'custom' && (
            <Link href={`/masters/${master.id}`} className="profile-page-link" onClick={onClose}>
              {isEn ? '查看大师主页 →' : '查看大师主页 →'}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
