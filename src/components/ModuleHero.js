'use client';

import NavIcon from './Icons';

export default function ModuleHero({
  iconId,
  kicker,
  title,
  description,
  actions = null,
  className = '',
}) {
  const side = !!actions;
  return (
    <header className={`module-hero${className ? ` ${className}` : ''}`}>
      <div className="module-hero-copy">
        <div className="module-hero-kicker">
          <NavIcon id={iconId} size={15} />
          <span>{kicker}</span>
        </div>
        <h2 className="module-hero-title">{title}</h2>
        {description ? <p className="module-hero-desc">{description}</p> : null}
      </div>
      {side ? (
        <div className="module-hero-side">
          <div className="module-hero-actions">{actions}</div>
        </div>
      ) : null}
    </header>
  );
}
