'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BookMarked,
  CandlestickChart,
  Check,
  CircleAlert,
  FilePlus2,
  Hourglass,
  Link2,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { STRATEGY_CATEGORIES, STRATEGY_DATA_META, STRATEGY_GALLERY } from '../data/strategyGallery';
import { STRATEGY_DETAILS } from '../data/strategyDetails';
import { consumeFree, ensureAiReady, getAiConfig } from '../lib/aiGate';
import { readApiResponse } from '../lib/apiResponse.mjs';
import styles from './StrategyGallery.module.css';

const USER_STRATEGY_KEY = 'thinktank_strategy_gallery_user_v1';
const CATEGORY_FALLBACK = '其他';
const SEED_STRATEGIES = STRATEGY_GALLERY.map((strategy) => ({
  ...strategy,
  detailSections: STRATEGY_DETAILS[strategy.id]?.sections || [],
}));
const DETAIL_ITEM_COUNT = SEED_STRATEGIES.reduce(
  (total, strategy) => total + strategy.detailSections.reduce((count, section) => count + section.items.length, 0),
  0,
);

const CATEGORY_ICONS = {
  '长线价值': Hourglass,
  '短线波段': CandlestickChart,
  '交易心法': ShieldCheck,
  '其他': BookMarked,
};

function loadUserStrategies() {
  try {
    const parsed = JSON.parse(localStorage.getItem(USER_STRATEGY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item?.category !== '名单股票池') : [];
  } catch (e) {
    return [];
  }
}

function persistUserStrategies(items) {
  try { localStorage.setItem(USER_STRATEGY_KEY, JSON.stringify(items)); } catch (e) { /* ignore */ }
}

function compactNumber(value) {
  const number = Number(value || 0);
  if (!number) return '—';
  if (number >= 1000000) return `${(number / 1000000).toFixed(number >= 10000000 ? 0 : 1)}m`;
  if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}w`;
  return number.toLocaleString('zh-CN');
}

function categoryIcon(category, size = 16) {
  const Icon = CATEGORY_ICONS[category] || CATEGORY_ICONS[CATEGORY_FALLBACK];
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />;
}

function StrategyCard({ strategy, onOpen }) {
  return (
    <article className={styles.card} data-category={strategy.category}>
      <button type="button" className={styles.cardBody} onClick={() => onOpen(strategy)}>
        <div className={styles.cardTopline}>
          <span className={styles.strategyCode}>{strategy.id}</span>
          <span className={styles.categoryTag}>{categoryIcon(strategy.category, 13)} {strategy.category}</span>
          {strategy.userAdded ? <span className={styles.mineTag}>我添加的</span> : null}
        </div>
        <h3 className={styles.cardTitle}>{strategy.title}</h3>
        <p className={styles.cardDesc}>{strategy.description || '原文未说明'}</p>
        <ol className={styles.pointPreview}>
          {(strategy.points || []).slice(0, 3).map((point, index) => (
            <li key={`${strategy.id}-${index}`}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <p>{point}</p>
            </li>
          ))}
        </ol>
        {strategy.risk ? (
          <div className={styles.riskLine}>
            <CircleAlert size={13} aria-hidden="true" />
            <span>{strategy.risk}</span>
          </div>
        ) : null}
      </button>
      <div className={styles.cardFooter}>
        <div className={styles.sourceMeta}>
          <strong>{strategy.author || '用户添加'}</strong>
          <span>{strategy.source || '知乎'} · {strategy.userAdded ? '我的策略' : '高赞回答'}</span>
        </div>
        <div className={styles.cardActions}>
          {strategy.votes ? <span className={styles.votes}>{strategy.votes.toLocaleString('zh-CN')} 赞</span> : null}
          {strategy.url ? (
            <a href={strategy.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} aria-label={`打开${strategy.title}原始链接`}>
              原链接 <ArrowUpRight size={12} />
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function StrategyDetailDrawer({ strategy, onClose, onRemove }) {
  if (!strategy) return null;
  return (
    <>
      <button type="button" className={styles.backdrop} onClick={onClose} aria-label="关闭策略详情" />
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={`${strategy.title}策略详情`}>
        <div className={styles.drawerHeader}>
          <div>
            <div className={styles.drawerMeta}>
              <span>{strategy.id}</span>
              <span className={styles.categoryTag}>{categoryIcon(strategy.category, 13)} {strategy.category}</span>
            </div>
            <h2>{strategy.title}</h2>
          </div>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        <div className={styles.drawerScroll}>
          <p className={styles.detailLead}>{strategy.description || '原文未说明'}</p>

          {strategy.detailSections?.length ? (
            <section className={styles.deepDiveSection}>
              <div className={styles.deepDiveHead}>
                <div>
                  <span>源文档完整拆解</span>
                  <h3>把条件、买点、卖点和限制一次讲清</h3>
                </div>
                <BookMarked size={20} aria-hidden="true" />
              </div>
              <div className={styles.deepDiveSections}>
                {strategy.detailSections.map((section, sectionIndex) => (
                  <div className={styles.deepDiveBlock} key={`${strategy.id}-section-${sectionIndex}`}>
                    <h4>{section.title}</h4>
                    <ol className={styles.deepDiveList}>
                      {section.items.map((item, itemIndex) => (
                        <li key={`${strategy.id}-section-${sectionIndex}-${itemIndex}`}>
                          <span>{String(itemIndex + 1).padStart(2, '0')}</span>
                          <p>{item}</p>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
              <p className={styles.deepDiveNote}>以上为源文档对原回答的结构化整理，保留作者示例、经验数据与时效限制；使用前仍需按最新财报和市场环境复核。</p>
            </section>
          ) : null}
          {strategy.risk ? (
            <section className={styles.riskPanel}>
              <CircleAlert size={16} aria-hidden="true" />
              <div>
                <strong>使用前留意</strong>
                <p>{strategy.risk}</p>
              </div>
            </section>
          ) : null}
          <section className={styles.sourcePanel}>
            <div>
              <span>策略出处</span>
              <strong>{strategy.source || '知乎'} · {strategy.author || '用户添加'}</strong>
            </div>
            {strategy.question ? <p>{strategy.question}</p> : null}
            {strategy.votes || strategy.questionViews ? (
              <div className={styles.sourceStats}>
                {strategy.votes ? <span>{strategy.votes.toLocaleString('zh-CN')} 赞同</span> : null}
                {strategy.questionViews ? <span>{compactNumber(strategy.questionViews)} 问题浏览</span> : null}
              </div>
            ) : null}
          </section>
          <div className={styles.drawerActions}>
            {strategy.url ? (
              <a className={styles.primaryButton} href={strategy.url} target="_blank" rel="noreferrer">
                查看原始链接 <ArrowUpRight size={15} />
              </a>
            ) : null}
            {strategy.userAdded ? (
              <button type="button" className={styles.dangerButton} onClick={() => onRemove(strategy.id)}>
                <Trash2 size={15} /> 从我的策略移除
              </button>
            ) : null}
          </div>
          <p className={styles.drawerDisclaimer}>内容来自第三方公开回答，仅作方法归档与学习参考，不构成投资建议。指标阈值存在时效性，请结合最新数据复核。</p>
        </div>
      </aside>
    </>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function AddStrategyDrawer({ onClose, onSaved }) {
  const [url, setUrl] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const extract = async () => {
    const cleanUrl = url.trim();
    if (!/^https?:\/\//i.test(cleanUrl)) {
      setError('请输入完整的 http(s) 链接');
      return;
    }
    if (!ensureAiReady()) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/strategy-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ url: cleanUrl, content: pastedText.trim(), aiConfig: getAiConfig() }),
      });
      const data = await readApiResponse(response);
      if (!response.ok || data.error) throw new Error(data.error || '策略提取失败，请重试');
      consumeFree('选股策略大赏');
      setDraft({
        ...data.strategy,
        keyPoints: Array.isArray(data.strategy.points) ? data.strategy.points.join('\n') : '',
      });
      setNotice(data.meta?.warning ? `链接抓取受限，已使用粘贴正文：${data.meta.warning}` : '提取完成，请核对后再加入我的策略');
    } catch (e) {
      setError(String(e?.message || '策略提取失败，请重试'));
    } finally {
      setLoading(false);
    }
  };

  const save = () => {
    if (!draft?.title?.trim() || !draft?.description?.trim()) {
      setError('策略名称和策略描述不能为空');
      return;
    }
    const item = {
      id: `USER-${Date.now()}`,
      title: draft.title.trim(),
      category: draft.category || CATEGORY_FALLBACK,
      author: draft.author.trim() || '用户添加',
      source: draft.source.trim() || '用户添加',
      question: draft.question.trim(),
      description: draft.description.trim(),
      points: String(draft.keyPoints || '').split('\n').map((point) => point.trim()).filter(Boolean),
      risk: String(draft.risk || '').trim() || '原文未说明风险，建议自行核验。',
      url: draft.url,
      votes: 0,
      questionViews: 0,
      createdAt: new Date().toISOString(),
      userAdded: true,
    };
    const saved = [item, ...loadUserStrategies()].slice(0, 100);
    persistUserStrategies(saved);
    onSaved(item);
  };

  return (
    <>
      <button type="button" className={styles.backdrop} onClick={onClose} aria-label="关闭添加策略" />
      <aside className={`${styles.drawer} ${styles.addDrawer}`} role="dialog" aria-modal="true" aria-label="添加策略链接">
        <div className={styles.drawerHeader}>
          <div>
            <span className={styles.drawerKicker}>策略收录</span>
            <h2>添加链接，提取策略</h2>
          </div>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        <div className={styles.drawerScroll}>
          <div className={styles.addIntro}>
            <Sparkles size={18} aria-hidden="true" />
            <p>粘贴知乎、雪球、公众号或其他公开文章链接。AI 只从页面正文提取策略，不补造原文没有的数字与结论。</p>
          </div>
          <div className={styles.linkRow}>
            <label className={styles.linkInput}>
              <Link2 size={16} aria-hidden="true" />
              <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." inputMode="url" />
              {url ? <button type="button" onClick={() => setUrl('')} aria-label="清空链接"><X size={14} /></button> : null}
            </label>
            <button type="button" className={styles.primaryButton} onClick={extract} disabled={loading}>
              {loading ? <LoaderCircle className={styles.spinner} size={16} /> : <Sparkles size={16} />}
              {loading ? '提取中' : '提取策略'}
            </button>
          </div>
          <Field label="正文补充（可选）" hint="如果链接要求登录或抓取失败，粘贴策略原文即可继续。">
            <textarea rows={5} value={pastedText} onChange={(event) => setPastedText(event.target.value)} placeholder="粘贴原回答或文章正文..." />
          </Field>
          {error ? <div className={styles.errorPanel}><CircleAlert size={16} /> <span>{error}</span></div> : null}
          {notice ? <div className={styles.noticePanel}><Check size={16} /> <span>{notice}</span></div> : null}

          {draft ? (
            <section className={styles.extractPreview}>
              <div className={styles.previewHead}>
                <div>
                  <span>提取预览</span>
                  <h3>核对后再收录</h3>
                </div>
                <span className={styles.readyBadge}><Check size={13} /> 可编辑</span>
              </div>
              <Field label="策略名称">
                <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
              </Field>
              <div className={styles.fieldPair}>
                <Field label="策略类型">
                  <select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}>
                    {[...STRATEGY_CATEGORIES, CATEGORY_FALLBACK].map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </Field>
                <Field label="答主 / 作者">
                  <input value={draft.author} onChange={(event) => setDraft((current) => ({ ...current, author: event.target.value }))} />
                </Field>
              </div>
              <div className={styles.fieldPair}>
                <Field label="策略出处">
                  <input value={draft.source} onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))} />
                </Field>
                <Field label="所属问题 / 文章">
                  <input value={draft.question} onChange={(event) => setDraft((current) => ({ ...current, question: event.target.value }))} />
                </Field>
              </div>
              <Field label="策略描述">
                <textarea rows={3} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
              </Field>
              <Field label="可执行要点" hint="每行一条，建议保留 3-8 条。">
                <textarea rows={6} value={draft.keyPoints} onChange={(event) => setDraft((current) => ({ ...current, keyPoints: event.target.value }))} />
              </Field>
              <Field label="风险 / 时效提示">
                <textarea rows={3} value={draft.risk} onChange={(event) => setDraft((current) => ({ ...current, risk: event.target.value }))} />
              </Field>
              <button type="button" className={styles.saveButton} onClick={save}>
                <Plus size={16} /> 加入我的策略
              </button>
            </section>
          ) : null}
          <p className={styles.localNote}>用户添加的策略仅保存在当前浏览器，不会发布到公共榜单。</p>
        </div>
      </aside>
    </>
  );
}

export default function StrategyGallery() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [scope, setScope] = useState('all');
  const [sort, setSort] = useState('votes');
  const [selected, setSelected] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [userStrategies, setUserStrategies] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setUserStrategies(loadUserStrategies());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) persistUserStrategies(userStrategies);
  }, [loaded, userStrategies]);

  const allStrategies = useMemo(() => [...userStrategies, ...SEED_STRATEGIES], [userStrategies]);
  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return allStrategies
      .filter((strategy) => scope === 'mine' ? strategy.userAdded : true)
      .filter((strategy) => category === '全部' || strategy.category === category)
      .filter((strategy) => {
        if (!keyword) return true;
        return [strategy.title, strategy.description, strategy.author, strategy.question, strategy.category]
          .filter(Boolean).join(' ').toLowerCase().includes(keyword);
      })
      .sort((a, b) => {
        if (sort === 'title') return String(a.title).localeCompare(String(b.title), 'zh-CN');
        if (sort === 'latest') return String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || Number(b.votes || 0) - Number(a.votes || 0);
        return Number(b.votes || 0) - Number(a.votes || 0);
      });
  }, [allStrategies, category, query, scope, sort]);

  const removeUserStrategy = (id) => {
    setUserStrategies((current) => current.filter((item) => item.id !== id));
    setSelected(null);
    setScope('mine');
  };

  const handleSaved = (item) => {
    setUserStrategies((current) => [item, ...current.filter((existing) => existing.id !== item.id)].slice(0, 100));
    setAddOpen(false);
    setScope('mine');
    setSelected(item);
    setQuery('');
    setCategory('全部');
    setSort('latest');
  };

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.titleLine}>
            <span className={styles.titleMark}><BookMarked size={22} aria-hidden="true" /></span>
            <h1>选股策略大赏</h1>
          </div>
          <p>把高赞回答拆成看得懂、能核对、可复用的选股方法。我们不收藏“神回复”，只收录有明确步骤与边界的策略。</p>
          <div className={styles.dataLine}>
            <span>{STRATEGY_DATA_META.strategyCount} 条入选策略</span>
            <span>{DETAIL_ITEM_COUNT} 条拆解细则</span>
            <span>{STRATEGY_CATEGORIES.length} 类方法</span>
            <span>{STRATEGY_DATA_META.questionCount} 个高热问题</span>
            <span>数据快照 {STRATEGY_DATA_META.collectedAt}</span>
          </div>
        </div>
        <button type="button" className={styles.addButton} onClick={() => setAddOpen(true)}>
          <FilePlus2 size={17} /> 添加策略链接
        </button>
      </header>

      <div className={styles.archiveBar}>
        <div className={styles.searchBox}>
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索策略、指标、答主或问题" />
          {query ? <button type="button" onClick={() => setQuery('')} aria-label="清空搜索"><X size={14} /></button> : null}
        </div>
        <div className={styles.scopeTabs} role="tablist" aria-label="策略范围">
          <button type="button" className={scope === 'all' ? styles.scopeActive : ''} onClick={() => setScope('all')} aria-selected={scope === 'all'}>全部策略</button>
          <button type="button" className={scope === 'mine' ? styles.scopeActive : ''} onClick={() => setScope('mine')} aria-selected={scope === 'mine'}>我的添加 {userStrategies.length ? `(${userStrategies.length})` : ''}</button>
        </div>
        <label className={styles.sortSelect}>
          <span>排序</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="votes">热度优先</option>
            <option value="latest">最近添加</option>
            <option value="title">标题排序</option>
          </select>
        </label>
      </div>

      <div className={styles.filterRow}>
        {['全部', ...STRATEGY_CATEGORIES].map((item) => (
          <button key={item} type="button" className={category === item ? styles.filterActive : ''} onClick={() => setCategory(item)}>
            {item === '全部' ? <BookMarked size={14} /> : categoryIcon(item, 14)}
            {item}
          </button>
        ))}
      </div>

      {visible.length ? (
        <div className={styles.grid}>
          {visible.map((strategy) => (
            <StrategyCard
              key={strategy.id}
              strategy={strategy}
              onOpen={setSelected}
            />
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <BookMarked size={28} aria-hidden="true" />
          <h2>{scope === 'mine' ? '还没有添加策略' : '没有找到匹配策略'}</h2>
          <p>{scope === 'mine' ? '粘贴一个公开链接，让 AI 帮你提取策略卡片。' : '换一个关键词或类型，再看看其他方法。'}</p>
          <button type="button" className={styles.primaryButton} onClick={() => scope === 'mine' ? setAddOpen(true) : (setQuery(''), setCategory('全部'), setScope('all'))}>
            {scope === 'mine' ? <><Plus size={15} /> 添加第一条</> : '查看全部策略'}
          </button>
        </div>
      )}

      <div className={styles.archiveFootnote}>
        <CircleAlert size={15} />
        <p>赞数与问题浏览量为 {STRATEGY_DATA_META.collectedAt} 快照，会随时间变化。所有内容仅代表原作者观点，不构成投资建议。</p>
      </div>

      <StrategyDetailDrawer strategy={selected} onClose={() => setSelected(null)} onRemove={removeUserStrategy} />
      {addOpen ? <AddStrategyDrawer onClose={() => setAddOpen(false)} onSaved={handleSaved} /> : null}
    </div>
  );
}
