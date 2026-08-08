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
  // 无真实头像（邀请的自定义大师）：首字符 + 大师色圆形填充，与预置照片风格统一
  const raw = (master.name || master.nameEn || '').trim();
  const cjkMatch = raw.match(/[\u4e00-\u9fff]/);
  const ch = (cjkMatch ? cjkMatch[0] : raw.charAt(0) || '?').toUpperCase();
  const bg = /^#[0-9a-fA-F]{6}$/.test(master.color || '') ? master.color : '#5a5a7a';
  const r = parseInt(bg.slice(1, 3), 16), g = parseInt(bg.slice(3, 5), 16), b = parseInt(bg.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const fg = lum > 0.55 ? 'var(--text)' : '#fffef9';
  return (
    <span
      className={className}
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: bg, color: fg, fontSize: size * 0.5, fontWeight: 700,
        fontFamily: 'var(--font-sans)', lineHeight: 1,
        boxShadow: 'inset 0 0 0 1px rgba(0, 0, 0, 0.08)',
        ...wrapperStyle,
      }}
    >
      {ch}
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

