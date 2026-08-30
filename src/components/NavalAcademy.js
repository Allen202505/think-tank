'use client';

// 纳瓦尔知识学堂（布局对齐「巴菲特的早餐」：左栏 280px 页签/列表 + 右侧内容区）
// 模块1：知识点提问——输入概念，纳瓦尔深入浅出讲解；支持快捷追问 / 收录词条 / 举手提问
// 模块2：每日知识点——按日期出「第XXXX.XX.XX期」3 个投资指标 + 小测验，左栏历史期数，右侧查看
// 存储：每日期数走 Supabase（公共历史），未配置/失败时 localStorage 兜底；历史提问/词条存本机
import { useState, useCallback, useEffect } from 'react';
import { MasterAvatar } from './ui';
import AskDrawer from './AskDrawer';
import { ensureAiReady, consumeFree, getAiConfig } from '../lib/aiGate';
import { NAVAL } from '../lib/navalPrompts';
import { useAuth } from '../lib/authProvider';
import { supabaseEnabled } from '../lib/supabaseClient';
import { loadTerms, saveTerms, upsertTerm, pushTermsCloud } from '../lib/navalTerms';
import TermLibraryModal from './TermLibraryModal';

const LS_KEY = 'thinktank_naval_issues';
const ASK_HISTORY_KEY = 'thinktank_naval_ask_history';
const TERMS_KEY = 'thinktank_naval_terms';
const ASK_HISTORY_MAX = 20;

const TODAY = (() => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
})();

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function saveLocal(map) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch (e) { /* ignore */ }
}
function localList(map) {
  return Object.keys(map)
    .filter((d) => map[d] && map[d].content)
    .sort((a, b) => b.localeCompare(a))
    .map((d) => ({
      issue_date: d,
      issue_label: issueLabel(d),
      title: map[d].title || '',
      quiz_question: map[d].quiz_question || '',
      source: 'local',
    }));
}
function loadAskHistory() {
  try { return JSON.parse(localStorage.getItem(ASK_HISTORY_KEY) || '[]') || []; } catch (e) { return []; }
}
function saveAskHistory(list) {
  try { localStorage.setItem(ASK_HISTORY_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}
function issueLabel(date) { return `第${String(date || '').replace(/-/g, '/')}期`; }
// 每条回答都保证展示的「核心追问」（AI 没给时用这组通用深挖问题兜底）
const DEFAULT_FOLLOWUPS = [
  '能用一个真实公司的数字例子演示一下吗？',
  '这个指标通常和哪些指标搭配着看更准确？',
  '计算或解读时最容易踩的坑是什么？',
  '它更适合判断哪一类企业或行业？',
];
function fmtTime(ts) {
  try {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch (e) { return ''; }
}
// 从问题里提炼词条名：「什么是自由现金流？」→「自由现金流」
function deriveTermName(q) {
  let s = String(q || '').trim().replace(/[？?。.!！]$/, '');
  s = s.replace(/^(请问|什么是|啥是|什么叫|怎么看|如何|怎样|为什么|为啥|帮我解释一下|解释一下|请解释|请讲讲|讲讲|说一下|说说|科普一下|介绍一下|关于)/, '');
  return (s && s.trim()) || String(q || '').trim();
}

// 内联：**加粗**
function inlineRich(seg, keyBase) {
  const normalized = String(seg || '').replace(/\*\*\*/g, '**');
  const parts = normalized.split(/\*\*([\s\S]+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={`${keyBase}-${i}`}>{p}</strong> : p));
}
// 块级渲染：保留换行 / 列表 / 【标题】 / 分割线
function renderRich(text, keyBase) {
  const lines = String(text || '').split('\n');
  const out = [];
  let list = [];
  const flush = () => { if (list.length) { out.push(<ul key={`${keyBase}-ul${out.length}`} className="explain-list">{list}</ul>); list = []; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const marker = line.match(/^【(.+?)】$/);
    if (marker) { flush(); out.push(<div key={`${keyBase}-h${out.length}`} className="explain-inline-head">{inlineRich(marker[1], `${keyBase}-h${out.length}`)}</div>); continue; }
    if (/^[-*_]{3,}$/.test(line)) { flush(); out.push(<div key={`${keyBase}-hr${out.length}`} className="markdown-hr" />); continue; }
    const bullet = line.match(/^[-*•]\s+(.*)/);
    if (bullet) { list.push(<li key={`${keyBase}-li${list.length}`}>{inlineRich(bullet[1], `${keyBase}-li${list.length}`)}</li>); continue; }
    flush();
    const numbered = line.match(/^\d+[.、)]\s+(.*)/);
    out.push(<p key={`${keyBase}-p${out.length}`} className="explain-text">{inlineRich(numbered ? numbered[1] : line, `${keyBase}-p${out.length}`)}</p>);
  }
  flush();
  return out;
}

export default function NavalAcademy() {
  const { user } = useAuth();
  const [mode, setMode] = useState('ask'); // ask | daily

  // ── 模块1：知识点提问 ──
  const [query, setQuery] = useState('');
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState('');
  const [thread, setThread] = useState([]); // [{ role:'user', text } | { role:'naval', content, keyPoint, followUps }]
  const [askHistory, setAskHistory] = useState([]); // 历史提问（本机，挂载后再加载）
  const [terms, setTerms] = useState([]);           // 词条库（本机）
  const [libraryOpen, setLibraryOpen] = useState(false); // 词条库弹窗
  const [askDrawerOpen, setAskDrawerOpen] = useState(false);
  const [drawerContext, setDrawerContext] = useState('');

  // 全局词条变更（TermAddModal 保存后触发）→ 刷新本组件词条
  useEffect(() => {
    const onTerms = () => setTerms(loadTerms());
    window.addEventListener('thinktank:terms-changed', onTerms);
    return () => window.removeEventListener('thinktank:terms-changed', onTerms);
  }, []);

  // ── 模块2：每日知识点 ──
  const [issues, setIssues] = useState([]);
  const [localMap, setLocalMap] = useState({});
  const [activeDate, setActiveDate] = useState(null);
  const [activeIssue, setActiveIssue] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [dailyError, setDailyError] = useState('');

  // 初始化：拉历史期数 + 本机历史提问/词条
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let list = null;
      try {
        const res = await fetch('/api/naval/issues');
        const data = await res.json();
        if (res.ok && data && data.ok && Array.isArray(data.issues)) list = data.issues;
      } catch (e) { /* 走本地 */ }
      if (cancelled) return;
      const map = loadLocal();
      setLocalMap(map);
      setAskHistory(loadAskHistory());
      setTerms(loadTerms());
      if (!list) {
        list = localList(map);
      } else {
        const dbDates = new Set(list.map((i) => i.issue_date));
        const extra = localList(map).filter((i) => !dbDates.has(i.issue_date));
        if (extra.length) list = [...list, ...extra].sort((a, b) => b.issue_date.localeCompare(a.issue_date));
      }
      setIssues(list);
    })();
    return () => { cancelled = true; };
  }, []);

  // 回显某条问答到主线程（不调 AI）
  const restoreQA = useCallback((q, content, keyPoint) => {
    if (!content) return;
    setAskError('');
    setThread([
      { role: 'user', text: q || '（词条）' },
      { role: 'naval', content, keyPoint: keyPoint || '', followUps: [] },
    ]);
  }, []);

  // 模块1：提问 / 追问
  const sendAsk = useCallback(async (raw) => {
    const msg = String(raw || query || '').trim();
    if (!msg || askLoading) return;
    if (!ensureAiReady()) { setAskError('AI 免费体验次数已用完，请先配置 API Key 或稍后再试'); return; }
    consumeFree();
    setAskError('');
    setAskLoading(true);
    setThread((prev) => [...prev, { role: 'user', text: msg }]);
    setQuery('');
    try {
      const res = await fetch('/api/naval/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: msg, aiConfig: getAiConfig() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '讲解失败，请重试');
      const answer = {
        content: data.result.content,
        keyPoint: data.result.keyPoint || '',
        followUps: Array.isArray(data.result.followUps) ? data.result.followUps : [],
      };
      setThread((prev) => [...prev, { role: 'naval', ...answer }]);
      // 记录历史提问（问题+答案，去重）
      setAskHistory((prev) => {
        const next = [{ q: msg, at: Date.now(), content: answer.content, keyPoint: answer.keyPoint }, ...prev.filter((h) => h.q !== msg)].slice(0, ASK_HISTORY_MAX);
        saveAskHistory(next);
        return next;
      });
    } catch (e) {
      const em = String((e && e.message) || e);
      const friendly = /failed to fetch|network|load|timed? ?out|econn|reset/i.test(em) ? '网络异常或连接超时，请重试' : (em || '讲解失败，请重试');
      setThread((prev) => [...prev, { role: 'naval', content: `⚠️ ${friendly}`, keyPoint: '', followUps: [] }]);
    } finally {
      setAskLoading(false);
    }
  }, [query, askLoading]);

  // 点击历史提问：直接回显已存问答（无答案的旧记录才重新提问）
  const openAskHistory = useCallback((h) => {
    if (!h) return;
    if (h.content) restoreQA(h.q, h.content, h.keyPoint);
    else sendAsk(h.q);
  }, [sendAsk, restoreQA]);

  // 收录为词条（从某条回答）
  const collectTerm = useCallback((q, answer) => {
    const name = deriveTermName(q);
    if (!name || !answer || !answer.content) return;
    setTerms((prev) => {
      const next = upsertTerm(prev, { name, q, content: answer.content, keyPoint: answer.keyPoint || '', at: Date.now() });
      saveTerms(next);
      return next;
    });
    if (supabaseEnabled && user?.id) pushTermsCloud(user.id, loadTerms());
  }, [user?.id]);

  // 举手提问：与纳瓦尔单聊（复用其它模块 AskDrawer）
  const onAskNaval = useCallback(async (q, convo) => {
    const ctx = [
      drawerContext,
      ...(convo || []).map((m) => `${m.role === 'user' ? '我问' : NAVAL.name}：${String(m.text || '').slice(0, 200)}`),
    ].filter(Boolean).join('\n');
    const res = await fetch('/api/naval/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, context: ctx || undefined, aiConfig: getAiConfig() }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || '回复失败，请重试');
    return { content: data.result.content, keyPoint: data.result.keyPoint || '' };
  }, [drawerContext]);

  const openDrawer = useCallback((content) => {
    setDrawerContext(String(content || '').slice(0, 300));
    setAskDrawerOpen(true);
  }, []);

  // 清空历史提问
  const clearAskHistory = useCallback(() => {
    saveAskHistory([]);
    setAskHistory([]);
  }, []);

  // 模块2：生成今日知识点
  const generateToday = useCallback(async () => {
    if (genLoading) return;
    if (!ensureAiReady()) { setDailyError('AI 免费体验次数已用完，请先配置 API Key 或稍后再试'); return; }
    consumeFree();
    setGenLoading(true);
    setDailyError('');
    try {
      const res = await fetch('/api/naval/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiConfig: getAiConfig() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '生成失败，请重试');
      const issue = data.issue;
      const map = { ...loadLocal(), [issue.issue_date]: issue };
      saveLocal(map);
      setLocalMap(map);
      setIssues((prev) => {
        const next = prev.filter((i) => i.issue_date !== issue.issue_date);
        return [{
          issue_date: issue.issue_date,
          issue_label: issue.issue_label,
          title: issue.title,
          quiz_question: issue.quiz_question,
          source: 'generated',
        }, ...next].sort((a, b) => b.issue_date.localeCompare(a.issue_date));
      });
      setActiveDate(issue.issue_date);
      setActiveIssue(issue);
    } catch (e) {
      const em = String((e && e.message) || e);
      setDailyError(/failed to fetch|network|load|timed? ?out|econn|reset/i.test(em) ? '网络异常或连接超时，请重试' : (em || '生成失败，请重试'));
    } finally {
      setGenLoading(false);
    }
  }, [genLoading]);

  // 模块2：查看某一期
  const openIssue = useCallback(async (date) => {
    if (viewLoading) return;
    setActiveDate(date);
    setViewLoading(true);
    setDailyError('');
    try {
      const cached = localMap[date];
      if (cached && cached.content) { setActiveIssue(cached); return; }
      const res = await fetch(`/api/naval/issues?date=${encodeURIComponent(date)}`);
      const data = await res.json();
      if (res.ok && data && data.ok && data.issue) {
        const map = { ...localMap, [date]: data.issue };
        saveLocal(map);
        setLocalMap(map);
        setActiveIssue(data.issue);
      } else {
        setActiveIssue(null);
        setDailyError('未找到该期内容，请稍后重试');
      }
    } catch (e) {
      setActiveIssue(null);
      setDailyError('加载失败，请重试');
    } finally {
      setViewLoading(false);
    }
  }, [viewLoading, localMap]);

  const todayIssue = issues.find((i) => i.issue_date === TODAY);

  return (
    <div className="nv-layout">
      {/* ── 左栏：纳瓦尔 + 页签 + 列表 ── */}
      <aside className="nv-left">
        {/* 词条库 */}
        <div className="nv-terms">
          <div className="nv-terms-head">
            <span className="nv-history-label">📚 词条库</span>
            <div className="nv-terms-actions">
              <button type="button" className="nv-terms-view" onClick={() => setLibraryOpen(true)}>查看 ›</button>
              <button type="button" className="nv-clear" onClick={() => window.dispatchEvent(new CustomEvent('naval:add-term', { detail: { name: '' } }))}>＋ 添加</button>
            </div>
          </div>
          <div className="nv-terms-hint">💡 在网页任意处选中文字，点右键即可快速添加词条</div>
        </div>

        <div className="nv-news-tabs" role="tablist" aria-label="纳瓦尔知识学堂功能">
          <button type="button" role="tab" className={mode === 'ask' ? 'active' : ''} aria-selected={mode === 'ask'} onClick={() => setMode('ask')}>💡 知识点提问</button>
          <button type="button" role="tab" className={mode === 'daily' ? 'active' : ''} aria-selected={mode === 'daily'} onClick={() => setMode('daily')}>📅 每日知识点</button>
        </div>

        {mode === 'ask' && askHistory.length > 0 && (
          <div className="nv-ask-history">
            <div className="nv-ask-history-head">
              <span className="nv-history-label">🕘 历史提问（{askHistory.length}）</span>
              <button type="button" className="nv-clear" onClick={clearAskHistory}>清空</button>
            </div>
            <div className="nv-ask-history-list">
              {askHistory.map((h) => (
                <button
                  key={`${h.at}-${h.q}`}
                  type="button"
                  className="nv-ask-history-item"
                  title="点击查看"
                  onClick={() => openAskHistory(h)}
                  disabled={askLoading}
                >
                  <span className="nv-ask-history-time">{fmtTime(h.at)}</span>
                  <span className="nv-ask-history-q">{h.q}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'daily' && (
          <div className="nv-history">
            <div className="nv-history-label">历史期数（{issues.length}）</div>
            {issues.length === 0 ? (
              <div className="nv-empty">还没有历史期数。生成今日知识点后会自动沉淀在这里。</div>
            ) : (
              <div className="nv-issue-list">
                {issues.map((it) => (
                  <button
                    key={it.issue_date}
                    type="button"
                    className={`nv-issue-item${activeDate === it.issue_date ? ' active' : ''}`}
                    onClick={() => openIssue(it.issue_date)}
                  >
                    <span className="nv-issue-arrow" aria-hidden="true">›</span>
                    <span className="nv-issue-main">
                      <span className="nv-issue-date">{issueLabel(it.issue_date)}</span>
                      <span className="nv-issue-title">{it.title || '今日知识点'}</span>
                    </span>
                    {it.issue_date === TODAY && <span className="nv-today-badge">今日</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>

      {/* ── 右栏：内容区 ── */}
      <main className="nv-main">
        {mode === 'ask' && (
          <div className="nv-ask">
            <div className="mg-card nv-ask-card">
              <div className="mg-card-label">想搞懂哪个知识点？</div>
              <textarea
                className="mg-input nv-input"
                rows={3}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="例如：什么是自由现金流？ROE 和 ROIC 有什么区别？"
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendAsk(); } }}
              />
              <div className="mg-foot">
                <button type="button" className="mg-btn" disabled={askLoading || !query.trim()} onClick={() => sendAsk()}>
                  {askLoading ? '讲解中…' : '开始讲解'}
                </button>
              </div>
            </div>

            {askError && <div className="mg-error">{askError}</div>}

            {thread.length > 0 && (
              <div className="nv-thread">
                {thread.map((m, i) => {
                  if (m.role === 'user') return <div key={i} className="nv-q">✋ {m.text}</div>;
                  const prevQ = i > 0 && thread[i - 1]?.role === 'user' ? thread[i - 1].text : '';
                  return (
                    <div key={i} className="mg-speech nv-answer">
                      <div className="mg-speech-head">
                        <MasterAvatar master={NAVAL} size={28} />
                        <span className="mg-speech-name">{NAVAL.name}</span>
                        <span className="mg-speech-tag">{NAVAL.title}</span>
                      </div>
                      <div className="mg-speech-body">{renderRich(m.content, `ask${i}`)}</div>
                      {m.keyPoint && (
                        <div className="speech-key"><span className="speech-key-text">💡 {m.keyPoint}</span></div>
                      )}
                      <div className="nv-answer-actions">
                        <button type="button" className="nv-act" onClick={() => collectTerm(prevQ, m)} disabled={!prevQ}>💾 收录为词条</button>
                        <button type="button" className="nv-act" onClick={() => openDrawer(m.content)}>✋ 举手提问</button>
                      </div>
                      {(() => {
                        const followUps = (Array.isArray(m.followUps) && m.followUps.length) ? m.followUps : DEFAULT_FOLLOWUPS;
                        return (
                          <div className="nv-followups">
                            <div className="mg-fu-label">⚡ 核心追问</div>
                            <div className="nv-quick-followups">
                              {followUps.map((f, j) => (
                                <button key={j} type="button" className="nv-quick-chip" onClick={() => sendAsk(f)} disabled={askLoading}>{f}</button>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
                {askLoading && (
                  <div className="mg-loading nv-loading">
                    <MasterAvatar master={NAVAL} size={24} />
                    <span>{NAVAL.name} 正在整理思路…</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {mode === 'daily' && (
          <div className="nv-daily">
            <div className="mg-card nv-today">
              <div className="nv-today-head">
                <span className="nv-today-label">{issueLabel(todayIssue ? todayIssue.issue_date : TODAY)}</span>
                <span className="nv-today-badge">今日</span>
              </div>
              {todayIssue ? (
                <>
                  <div className="nv-today-title">{todayIssue.title || '今日知识点'}</div>
                  {todayIssue.quiz_question && (
                    <div className="nv-quiz nv-quiz-preview">🧩 今日小测验：{todayIssue.quiz_question}</div>
                  )}
                  <div className="mg-foot">
                    <button type="button" className="mg-btn" onClick={() => openIssue(todayIssue.issue_date)}>
                      {activeDate === todayIssue.issue_date ? '收起' : '查看今日全文'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="nv-today-empty">今天还没生成，点一下让纳瓦尔开课 👇</div>
                  <div className="mg-foot">
                    <button type="button" className="mg-btn" disabled={genLoading} onClick={generateToday}>
                      {genLoading ? '生成中，约需 1 分钟…' : '⚡ 生成今日知识点'}
                    </button>
                  </div>
                </>
              )}
            </div>

            {dailyError && <div className="mg-error">{dailyError}</div>}

            {activeIssue && activeIssue.content && (
              <div className="mg-speech nv-issue-view">
                <div className="nv-issue-view-head">
                  <span className="nv-issue-view-label">{issueLabel(activeIssue.issue_date)}</span>
                  <span className="nv-issue-view-title">{activeIssue.title}</span>
                </div>
                <div className="mg-speech-body">{renderRich(activeIssue.content, `issue${activeIssue.issue_date}`)}</div>
              </div>
            )}
            {viewLoading && <div className="mg-loading nv-loading">加载期数中…</div>}
            {mode === 'daily' && !activeIssue && !viewLoading && todayIssue && (
              <div className="nv-empty nv-tip">← 从左侧选择一期历史，或点「查看今日全文」。</div>
            )}
          </div>
        )}
      </main>

      {/* 词条库弹窗 */}
      <TermLibraryModal open={libraryOpen} onClose={() => setLibraryOpen(false)} />

      {/* 举手提问（与其它模块一致） */}
      {askDrawerOpen && (
        <AskDrawer
          master={NAVAL}
          context={drawerContext}
          onClose={() => setAskDrawerOpen(false)}
          onAsk={onAskNaval}
        />
      )}
    </div>
  );
}
