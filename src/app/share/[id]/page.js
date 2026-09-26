import { cache } from 'react';
import { notFound } from 'next/navigation';
import ShareLinkActions from '../../../components/ShareLinkActions';
import ShareResultView from '../../../components/ShareResultView';
import { getShareResult } from '../../../lib/shareResultsDb';
import { SHARE_KIND_LABELS } from '../../../lib/shareResults.mjs';
import '../../page.css';
import './share.css';

export const dynamic = 'force-dynamic';

function siteUrl() {
  const configured = String(process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  if (!configured || /your-domain\.com|think-tank\.example\.com/i.test(configured)) return 'https://yieldglide.com';
  return /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return '';
  }
}

const loadShare = cache(async (id) => getShareResult(id));

export async function generateMetadata({ params }) {
  const loaded = await loadShare(params.id);
  if (!loaded.ok) {
    return {
      title: '分享内容暂时不可用 | 大师吵股',
      robots: { index: false, follow: false },
    };
  }
  const record = loaded.value;
  const kindLabel = SHARE_KIND_LABELS[record.kind] || 'AI 投资分析';
  const title = `${record.title} | ${kindLabel}分享`;
  const description = `大师吵股生成于分享时的完整${kindLabel}分析内容。内容为公开只读快照，仅供学习交流，不构成投资建议。`;
  const canonical = `${siteUrl()}/share/${record.id}`;
  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: '大师吵股',
      locale: 'zh_CN',
      type: 'article',
      images: [{ url: `${siteUrl()}/og-image.png`, width: 1200, height: 630, alt: '大师吵股' }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`${siteUrl()}/og-image.png`],
    },
  };
}

function UnavailablePage({ message = '这条分享内容不存在，可能链接输入有误，或分享服务暂未初始化。' }) {
  return (
    <main className="share-page">
      <div className="share-shell">
        <nav className="share-nav">
          <a className="share-brand" href="/">
            <span className="share-brand-mark" aria-hidden="true">⚖</span>
            大师吵股
          </a>
        </nav>
        <section className="share-document share-error">
          <h1>暂时看不到这份分析</h1>
          <p>{message}</p>
          <p><a className="share-cta" href="/">回到大师吵股首页 →</a></p>
        </section>
      </div>
    </main>
  );
}

export default async function ShareResultPage({ params }) {
  const loaded = await loadShare(params.id);
  if (!loaded.ok) {
    if (loaded.code === 'not_found') notFound();
    return <UnavailablePage />;
  }

  const record = loaded.value;
  const kindLabel = SHARE_KIND_LABELS[record.kind] || 'AI 投资分析';
  const created = formatDate(record.created_at);

  return (
    <main className="share-page">
      <div className="share-shell">
        <nav className="share-nav">
          <a className="share-brand" href="/">
            <span className="share-brand-mark" aria-hidden="true">⚖</span>
            大师吵股
          </a>
          <ShareLinkActions title={`${record.title} | ${kindLabel}`} />
        </nav>

        <article className="share-document">
          <header className="share-document-head">
            <div>
              <div className="share-document-type">{kindLabel} · 公开只读分享</div>
              <h2>{record.title}</h2>
            </div>
            {created ? <time className="share-document-date" dateTime={record.created_at}>{created}</time> : null}
          </header>
          <div className="share-snapshot-note">
            这是分享时保存的完整结果快照。接收方无需登录即可阅读；原分析后续即使重新生成，也不会改变这条链接中的内容。
          </div>
          <div className="share-document-body">
            <ShareResultView kind={record.kind} payload={record.payload} />
          </div>
          <footer className="share-document-foot">
            <p className="share-disclaimer">
              内容由 AI 模拟投资大师生成，仅供学习、交流与娱乐参考，不构成任何投资建议。市场有风险，决策需独立判断。
            </p>
            <a className="share-cta" href="/?utm_source=share&utm_medium=result_link&utm_campaign=shared_analysis">
              用大师视角看你的问题 →
            </a>
          </footer>
        </article>
      </div>
    </main>
  );
}
