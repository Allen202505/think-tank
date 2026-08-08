'use client';

import { useState } from 'react';

// 基础 UI 组件（从 page.js 拆出）

export function Card({ title, accent, children }) {
  return (
    <div className="card-panel">
      <div className="card-accent" style={{ background: `linear-gradient(90deg,transparent,${accent},transparent)` }} />
      <div className="card-title" style={{ color: accent }}>
        {title}<span className="card-title-line" />
      </div>
      {children}
    </div>
  );
}


export function MasterAvatar({ master, size = 44, className = '' }) {
  const [imgErr, setImgErr] = useState(false);
  const useImg = master.avatar && !imgErr;
  const isDeceased = master.status === 'deceased';
  const wrapperStyle = { filter: isDeceased ? 'grayscale(1)' : 'none', opacity: isDeceased ? 0.85 : 1 };
  // 本地头像加 ?v=2 避免浏览器强缓存导致不更新
  const src = master.avatar && master.avatar.startsWith('/') ? `${master.avatar}?v=2` : master.avatar;
  const style = { width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 };
  if (useImg) {
    return (
      <span className={className} style={{ ...wrapperStyle, display: 'inline-block', width: size, height: size, flexShrink: 0, lineHeight: 0 }}>
        <img src={src} alt="" style={style} onError={() => setImgErr(true)} />
      </span>
    );
  }
  return (
    <span className={className} style={{ width: size, height: size, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.45, flexShrink: 0, ...wrapperStyle }}>
      {master.emoji}
    </span>
  );
}


export function MiniBtn({ children, onClick }) {
  const [h, setH] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      className="mini-btn"
      style={{
        background: h ? 'var(--accent-bg)' : 'var(--bg-input)',
        borderColor: h ? 'var(--accent)' : 'var(--border)',
        color: h ? 'var(--accent)' : 'var(--text)',
      }}
    >
      {children}
    </button>
  );
}

