import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PRESET_MASTERS } from '../../../data/masters';
import '../masters.css';

export function generateStaticParams() {
  return PRESET_MASTERS.map((m) => ({ id: m.id }));
}

export function generateMetadata({ params }) {
  const master = PRESET_MASTERS.find((m) => m.id === params.id);
  if (!master) return {};
  const title = `${master.name}（${master.title}）- 投资理念与生平 | 大师吵股`;
  const description = `${master.name}的投资理念：${master.style}。经典理论：${master.classicTheory || master.style}。金句：「${master.quote}」了解大师生平与智慧，让 AI 模拟大师为你辩论。`;
  return {
    title,
    description,
    keywords: `${master.name},${master.title},投资理念,价值投资,投资大师,大师吵股`,
    alternates: { canonical: `/masters/${master.id}` },
    openGraph: {
      title,
      description,
      url: `/masters/${master.id}`,
      type: 'website',
      images:
        master.avatar && master.avatar.startsWith('/')
          ? [{ url: master.avatar, width: 200, height: 200, alt: master.name }]
          : [{ url: '/og-image.png', width: 1200, height: 630, alt: '大师吵股' }],
    },
  };
}

export default function MasterDetailPage({ params }) {
  const master = PRESET_MASTERS.find((m) => m.id === params.id);
  if (!master) return notFound();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: master.name,
    alternateName: master.nameEn || undefined,
    description: master.biography || master.style,
    knowsAbout: (master.classicTheory || master.style).split(/[，,、]/),
  };

  return (
    <div className="masters-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Link href="/masters" className="masters-back">← 全部大师</Link>
      <div className="master-hero" style={{ borderColor: `${master.color}55` }}>
        {master.avatar ? (
          <img
            src={master.avatar}
            alt={master.name}
            className="master-hero-avatar"
            style={{ filter: master.status === 'deceased' ? 'grayscale(1)' : 'none' }}
          />
        ) : (
          <span className="master-hero-emoji">{master.emoji}</span>
        )}
        <div>
          <h1>{master.name}</h1>
          {master.nameEn && <div className="en">{master.nameEn}</div>}
          <div className="master-badges">
            <span className="master-badge">{master.title}</span>
            <span className={`master-badge ${master.status === 'deceased' ? 'master-status-dead' : ''}`}>
              {master.status === 'deceased' ? '已故' : '在世'}
            </span>
          </div>
        </div>
      </div>
      <blockquote className="master-quote">「{master.quote}」</blockquote>
      <div className="master-sections">
        <section className="master-sec"><h3>投资风格与特点</h3><p>{master.style}</p></section>
        <section className="master-sec"><h3>性格与发言风格</h3><p>{master.personality}</p></section>
        <section className="master-sec"><h3>经典理论</h3><p>{master.classicTheory || master.style}</p></section>
        <section className="master-sec"><h3>经历简介</h3><p>{master.biography || '—'}</p></section>
      </div>
      <Link href={`/?masters=${master.id}`} className="master-cta">让 {master.name} 参与辩论 →</Link>
    </div>
  );
}
