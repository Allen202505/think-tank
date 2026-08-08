import Link from 'next/link';
import { PRESET_MASTERS } from '../../data/masters';
import './masters.css';

export const metadata = {
  title: '投资大师全名单 - 世界顶级投资大师 | 大师吵股',
  description:
    '巴菲特、芒格、索罗斯、彼得·林奇、达里奥等世界顶级投资大师的投资理念、生平与经典理论，点击查看每位大师的详细介绍。',
  alternates: { canonical: '/masters' },
};

export default function MastersPage() {
  return (
    <div className="masters-page">
      <Link href="/" className="masters-back">← 返回辩论场</Link>
      <h1 className="masters-title">投资大师全名单</h1>
      <p className="masters-sub">{PRESET_MASTERS.length} 位世界顶级投资大师 · 点击查看理念与生平</p>
      <div className="masters-grid">
        {PRESET_MASTERS.map((m) => (
          <Link key={m.id} href={`/masters/${m.id}`} className="master-card">
            {m.avatar ? (
              <img
                src={m.avatar}
                alt={m.name}
                width={52}
                height={52}
                style={{
                  borderRadius: '50%',
                  objectFit: 'cover',
                  flexShrink: 0,
                  filter: m.status === 'deceased' ? 'grayscale(1)' : 'none',
                  opacity: m.status === 'deceased' ? 0.85 : 1,
                }}
              />
            ) : (
              <span style={{ fontSize: 28, flexShrink: 0 }}>{m.emoji}</span>
            )}
            <div className="master-card-info">
              <div className="master-card-name">{m.name}</div>
              <div className="master-card-title">{m.title}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
