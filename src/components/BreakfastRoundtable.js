'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SAMPLE_NEWS } from '../data/sampleNews';
import { getHost, pickGuestsByStyle, findMasterById } from '../lib/breakfast';
import { FRAMEWORK_STEPS } from '../lib/framework';
import { MasterAvatar } from './ui';
import StockPoolImportModal from './StockPoolImportModal';
import { ensureAiReady, consumeFree, getAiConfig } from '../lib/aiGate';
import { useAuth } from '../lib/authProvider';
import { syncPoolsOnLogin } from '../lib/userPools';

// 轻量渲染：AI 输出里的 **加粗** 转成 <strong>（避免露出裸 **）
function renderInline(text, keyBase) {
  const normalized = String(text || '').replace(/\*\*\*/g, '**');
  const parts = normalized.split(/\*\*([\s\S]+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={`${keyBase}-${i}`}>{p}</strong> : p));
}

// ── 定调/相关性徽章：把回复开头的 🟢🟡⚪🔴 从正文剥离，右上角渲染成徽章（样式同大师PK） ──
const STANCE_LABELS = {
  BULL: { label: '看多 ▲', cls: 'bull' },
  BEAR: { label: '看空 ▼', cls: 'bear' },
  NEUTRAL: { label: '中性 —', cls: 'neutral' },
  PURE_NEUTRAL: { label: '中性 —', cls: 'neutral' },
};
const RELEVANCE_LABELS = {
  STRONG: { label: '强相关', cls: 'neutral' },
  WEAK: { label: '弱相关', cls: 'neutral' },
  NONE: { label: '暂不相关', cls: 'neutral' },
};
function parseLeadingTag(text) {
  const t = String(text || '');
  const m = t.match(/^\s*\**\s*(🟢|🟡|⚪|🔴)\s*(?:(纯中性·无方向|中性·拉锯|强相关|弱相关|暂不相关|偏多|偏空|看多|看空|中性))?\s*\**\s*/);
  if (!m) return { cleaned: t, emoji: null };
  // 定调后常带「——。」「——，」等，把剩余前导标点/空白一并剥掉
  const cleaned = t.slice(m[0].length).replace(/^[\s，。、：:；;！？!?～~—－-]+/, '');
  return { cleaned, emoji: m[1] };
}
function stanceOf(emoji) {
  if (emoji === '🟢') return 'BULL';
  if (emoji === '🔴') return 'BEAR';
  if (emoji === '⚪') return 'PURE_NEUTRAL';
  return 'NEUTRAL';
}
function relevanceOf(emoji) {
  if (emoji === '🟢') return 'STRONG';
  if (emoji === '🟡') return 'WEAK';
  return 'NONE';
}

// 轻量指纹：同一段输入内容复用已生成结果
function hashText(s) {
  let h = 5381;
  const t = String(s || '').trim();
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return `n${(h >>> 0).toString(36)}`;
}

// 初始状态：大师头像压在一圈圆环上（12点=主持 / 3点 / 6点 / 9点）
// 解析输入：单行 URL → 链接；多行文本 → 第一行标题、其余正文
function parseNews(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const isLink = lines.length === 1 && /^https?:\/\/\S+$/i.test(lines[0]);
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const title = isLink ? lines[0] : (lines[0].length > 60 ? `${lines[0].slice(0, 60)}…` : lines[0]);
  const content = isLink ? lines[0] : (lines.slice(1).join('\n') || lines[0]);
  return { title, content, source: '用户输入', time, tags: ['用户输入'] };
}

// 框架步骤负责人角色（host/guestN）→ 大师 id（用于 loading 时显示「某某大师正在进行新闻分析」）
function resolveLeadId(lead, guestList) {
  if (lead === 'host') return 'buffett';
  const m = /^guest(\d+)$/.exec(String(lead || ''));
  if (m && guestList && guestList[Number(m[1])]) return guestList[Number(m[1])].master.id;
  return 'buffett';
}


export default function BreakfastRoundtable({ active = true }) {
  const { user, loading: authLoading } = useAuth();
  const [inputText, setInputText] = useState('');
  // 新闻输入弹窗：左侧「输入新闻源」强入口 → 点击弹窗粘贴链接/文本
  const [newsModalOpen, setNewsModalOpen] = useState(false);
  const [newsModalText, setNewsModalText] = useState('');
  // 推理强度：quick=快速解读（每人一句，过滤+初步讨论） / deep=事件穿透框架逐步解读；默认快速
  const [mode, setMode] = useState('quick');
  // 弹窗打开时锁定页面滚动，避免移动端输入时背景网页被拖着滑屏
  useEffect(() => {
    if (!newsModalOpen) return;
    // 锁定可能的滚动容器（桌面滚动在 body/window，移动端在 .app-shell/.app-main）
    const targets = [document.documentElement, document.body, document.querySelector('.app-shell'), document.querySelector('.app-main')];
    const prev = targets.filter(Boolean).map((el) => el.style.overflow);
    targets.filter(Boolean).forEach((el) => { el.style.overflow = 'hidden'; });
    return () => {
      targets.filter(Boolean).forEach((el, i) => { el.style.overflow = prev[i]; });
    };
  }, [newsModalOpen]);
  // 默认进页面即随机就座 3 位大师；只抽有真人头像的大师，避免出现字母占位头像
  // 默认每次随机 9 位大师（含巴菲特）：巴菲特主持 + 8 位嘉宾
  const [guests, setGuests] = useState(() => pickGuestsByStyle(8, [], { realAvatarOnly: true }));
  const [cache, setCache] = useState(() => loadBreakfastMemory()); // key → {status, steps, currentAction?, currentLead?, error?, stopped?}
  const cacheRef = useRef(cache);
  useEffect(() => { cacheRef.current = cache; }, [cache]);
  // 完成时写入记忆（localStorage），下次同一条新闻直接命中
  const saveDone = useCallback((key, steps) => {
    const entry = { status: 'done', steps, at: Date.now() };
    setCache((prev) => ({ ...prev, [key]: entry }));
    const mem = loadBreakfastMemory();
    mem[key] = entry;
    saveBreakfastMemory(mem);
  }, []);
  // 已解读过的新闻哈希前缀集合（用于左侧列表打「已解读 ✓」标记）
  const interpretedHashes = useMemo(() => {
    const set = new Set();
    for (const k of Object.keys(loadBreakfastMemory())) set.add(k.split('::')[0]);
    return set;
  }, [cache]);
  const isInterpreted = useCallback((n) => {
    const p = parseNews(String(n.title || '') + '\n' + (n.summary || ''));
    return interpretedHashes.has(hashText(`${p.title}\n${p.content}`));
  }, [interpretedHashes]);

  // 左侧新闻列表：真实 API（财联社 + 东方财富 7x24），失败/为空时回退内置示例
  const [newsList, setNewsList] = useState([]);
  const [activeNewsId, setActiveNewsId] = useState(null);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState('');
  const [newsPage, setNewsPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [newsFallback, setNewsFallback] = useState(false);
  // ── 新闻页签：24小时热点 / 我的股票池新闻 ──
  const [newsTab, setNewsTab] = useState('hot');
  const [myPools, setMyPools] = useState([]);
  const [poolNewsItems, setPoolNewsItems] = useState([]);
  const [poolNewsLoading, setPoolNewsLoading] = useState(false);
  const [poolNewsError, setPoolNewsError] = useState('');
  const [myStockCount, setMyStockCount] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  // 移动端：列表 / 详情 两级（详情=分析进行中或已完成；back 返回列表）
  const [bkShowList, setBkShowList] = useState(true);


  const loadNews = useCallback(async (page = 1, append = false) => {
    setNewsLoading(true);
    setNewsError('');
    try {
      const res = await fetch(`/api/news?page=${page}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || '获取新闻失败');
      const items = data.items || [];
      if (items.length === 0) {
        setNewsFallback(true);
        setNewsList([]);
        setHasMore(false);
      } else {
        setNewsFallback(false);
        setNewsList((prev) => (append ? [...prev, ...items] : items));
        setHasMore(Boolean(data.hasMore));
        setNewsPage(page);
      }
    } catch (e) {
      setNewsError(e.message || '获取新闻失败');
      setNewsFallback(true);
    } finally {
      setNewsLoading(false);
    }
  }, []);

  // 读取「我的股票池」（早餐页自己的池子列表，供股票池新闻使用）
  const loadMyPools = () => {
    try {
      const pools = JSON.parse(localStorage.getItem('thinktank_user_pools') || '[]');
      return (Array.isArray(pools) ? pools : []).filter((p) => p && Array.isArray(p.symbols) && /^我的股票池/.test(String(p.name || '')));
    } catch (e) { return []; }
  };


  // 拉取「我的股票池新闻」：命中自选股/关注股的新闻列表
  // force=true（手动刷新）→ 忽略缓存立即拉取；否则用 30 分钟内缓存，超过 7 天的新闻自动剔除
  const loadPoolNews = useCallback(async (force = false) => {
    const pools = loadMyPools();
    setMyPools(pools);
    const symbols = [];
    const seen = new Set();
    pools.forEach((p) => (p.symbols || []).forEach((s2) => { if (!seen.has(s2)) { seen.add(s2); symbols.push(s2); } }));
    setMyStockCount(symbols.length);
    if (!symbols.length) { setPoolNewsItems([]); setPoolNewsLoading(false); setPoolNewsError(''); return; }
    // 缓存签名：股票池代码 + 数量变化都会导致缓存失效
    const cacheKey = [...symbols].sort().join(',');
    const cached = loadPoolNewsCache();
    const fresh = filterFresh(cached?.items || []);
    const cacheHit = !force && cached && cached.key === cacheKey && (Date.now() - (cached.at || 0)) < POOLNEWS_TTL;
    if (cacheHit) {
      // 缓存未过期：直接展示（仍应用 7 天过滤）
      setPoolNewsItems(fresh);
      setPoolNewsError('');
      return;
    }
    const startedAt = Date.now();
    setPoolNewsLoading(true);
    setPoolNewsError('');
    try {
      const res = await fetch('/api/pool-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchlist: symbols }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || '获取失败，请重试');
      const items = filterFresh(data.items || []);
      setPoolNewsItems(items);
      savePoolNewsCache({ key: cacheKey, at: Date.now(), items });
    } catch (e) {
      // 请求失败但有旧缓存 → 退回旧缓存，避免白屏
      if (fresh.length) {
        setPoolNewsItems(fresh);
        setPoolNewsError('');
      } else {
        setPoolNewsError(e.message || '获取失败，请重试');
      }
    } finally {
      // 让「搜索中」动效至少展示 600ms，避免太快一闪而过
      const elapsed = Date.now() - startedAt;
      const remain = 600 - elapsed;
      if (remain > 0) await new Promise((r) => setTimeout(r, remain));
      setPoolNewsLoading(false);
    }
  }, []);

  // 首次进入即读取一次自选池；切到「我的股票池新闻」页签时刷新
  useEffect(() => { setMyPools(loadMyPools()); }, []);
  // 登录后：把云端我的股票池合并到本地，并刷新自选股新闻
  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) return;
    let alive = true;
    (async () => {
      await syncPoolsOnLogin(user.id);
      if (alive) {
        setMyPools(loadMyPools());
        if (newsTab === 'mine') loadPoolNews();
      }
    })().catch(() => {});
    return () => { alive = false; };
  }, [authLoading, user?.id]);
  useEffect(() => {
    if (newsTab === 'mine') loadPoolNews();
  }, [newsTab, loadPoolNews]);

  useEffect(() => { loadNews(1, false); }, [loadNews]);

  const host = useMemo(() => getHost(), []);
  const guestKey = useMemo(() => guests.map((g) => g.master.id).join('-'), [guests]);
  const news = useMemo(() => parseNews(inputText), [inputText]);
  const currentKey = useMemo(() => (news ? hashText(`${news.title}\n${news.content}`) : ''), [news]);
  const cacheKey = currentKey ? `${currentKey}::${guestKey}::${mode}` : '';
  const entry = cacheKey ? (cache[cacheKey] || { status: 'idle', steps: [] }) : { status: 'idle', steps: [] };

  const abortRefs = useRef({});
  // 详情步骤折叠状态（结论卡始终展开；生成中步骤展开，完成后默认折叠）
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  useEffect(() => { setExpandedKeys(new Set()); }, [cacheKey]);

  const toggleStep = (k) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  // 完成后把「核心结论」置顶展示，详情步骤排在后面
  const items = useMemo(() => {
    const list = entry.steps || [];
    if (entry.status !== 'done') return list;
    const idx = list.findIndex((st) => st.type === 'conclusion' || st.stepKey === 'conclusion');
    if (idx < 0) return list;
    return [list[idx], ...list.filter((_, i) => i !== idx)];
  }, [entry]);

  // ── 解读：quick 单次返回 / deep 按框架 9 步依次调用（可中止） ──
  const runAnalysis = useCallback(async (newsObj, gkey, guestList, runMode, force = false) => {
    const key = `${hashText(`${newsObj.title}\n${newsObj.content}`)}::${gkey}::${runMode}`;
    // 记忆命中：已解读过 → 直接展示，不重复消耗免费次数 / 不调 LLM
    if (!force && cacheRef.current[key] && cacheRef.current[key].status === 'done') {
      setBkShowList(false);
      return;
    }
    if (!ensureAiReady()) return; // 免费次数用尽且未配置 Key → 弹设置
    consumeFree();
    setBkShowList(false); // 移动端：开始分析 → 进入详情
    setCache((prev) => {
      const cur = prev[key];
      if (!force && cur && (cur.status === 'loading' || cur.status === 'done')) return prev;
      return {
        ...prev,
        [key]: {
          status: 'loading',
          steps: [],
          currentAction: runMode === 'quick' ? '正在进行快速解读' : FRAMEWORK_STEPS[0].loading,
          currentLead: runMode === 'quick' ? 'buffett' : resolveLeadId(FRAMEWORK_STEPS[0].lead, guestList),
        },
      };
    });
    if (force && abortRefs.current[key]) abortRefs.current[key].abort();
    const controller = new AbortController();
    abortRefs.current[key] = controller;

    const payload = {
      news: { title: newsObj.title, content: newsObj.content, source: newsObj.source, time: newsObj.time },
      hostId: 'buffett',
      guests: guestList.map((g) => ({ id: g.master.id, groupKey: g.groupKey })),
      mode: runMode,
      aiConfig: getAiConfig(),
    };

    const steps = [];
    try {
      if (runMode === 'quick') {
        // 快速：一人一条逐条生成（边分析边出结论），不是一次性返回
        const turnSeq = [
          { key: 'host_open', speaker: 'host' },
          ...guestList.map((_, i) => ({ key: `guest${i}`, speaker: `guest${i}` })),
          { key: 'host_close', speaker: 'host' },
          { key: 'summary', speaker: 'host' },
        ];
        const quickTurns = [];
        let quickSummary = '';
        const setQuickStep = (pending) => {
          setCache((prev) => {
            const cur = prev[key] || {};
            return {
              ...prev,
              [key]: {
                ...cur,
                status: 'loading',
                steps: [{
                  stepKey: 'quick',
                  title: '快速解读',
                  type: 'quick',
                  turns: [...quickTurns],
                  summary: quickSummary,
                  pending,
                }],
              },
            };
          });
        };
        for (const t of turnSeq) {
          setQuickStep({ speaker: t.speaker, action: t.key === 'summary' ? '正在总结…' : '正在解读…' });
          const res = await fetch('/api/breakfast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...payload,
              stepKey: 'quickturn',
              turnKey: t.key,
              prevTurns: quickTurns.map((x) => ({ speaker: x.speaker, text: x.text })),
            }),
            signal: controller.signal,
          });
          const data = await res.json();
          if (!res.ok || data.error) throw new Error(data.error || '生成失败，请重试');
          if (t.key === 'summary') {
            quickSummary = data.result.summary || '';
          } else {
            quickTurns.push({ speaker: data.result.speaker || t.speaker, text: data.result.text || '' });
          }
          setQuickStep(null);
        }
        steps.push({ stepKey: 'quick', title: '快速解读', type: 'quick', turns: quickTurns, summary: quickSummary, pending: null });
        saveDone(key, steps);
      } else {
        // 深度：事件穿透框架逐步推演
        for (const step of FRAMEWORK_STEPS) {
          const res = await fetch('/api/breakfast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...payload,
              stepKey: step.key,
              prevSteps: steps.map((s) => ({ title: s.title, content: s.content, pool: s.pool })),
            }),
            signal: controller.signal,
          });
          const data = await res.json();
          if (!res.ok || data.error) throw new Error(data.error || '生成失败，请重试');
          steps.push(data.result);
          setCache((prev) => {
            const cur = prev[key];
            const nextDef = FRAMEWORK_STEPS[steps.length];
            return {
              ...prev,
              [key]: {
                status: 'loading',
                steps: [...steps],
                currentAction: nextDef ? nextDef.loading : '',
                currentLead: nextDef ? resolveLeadId(nextDef.lead, guestList) : '',
              },
            };
          });
          // 初筛闸门：⚪ 暂不相关 → 停止后续步骤，直接完成
          if (data.result && data.result.stop) break;
        }
        saveDone(key, steps);
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        setCache((prev) => ({ ...prev, [key]: { status: 'error', error: '已停止生成，可重试', stopped: true, steps } }));
      } else {
        setCache((prev) => ({ ...prev, [key]: { status: 'error', error: e.message || '生成失败，请重试', steps } }));
      }
    } finally {
      if (abortRefs.current[key] === controller) delete abortRefs.current[key];
    }
  }, []);

  const start = () => {
    if (news) runAnalysis(news, guestKey, guests, mode);
  };
  const redoCurrent = () => {
    if (news) runAnalysis(news, guestKey, guests, mode, true);
  };
  const stopLoading = () => {
    const c = abortRefs.current[cacheKey];
    if (c) c.abort();
  };
  const switchMode = (m) => {
    if (m === mode) return;
    const c = abortRefs.current[cacheKey];
    if (c) c.abort();
    setMode(m);
  };

  // ── 新闻输入弹窗 ──
  const openNewsModal = (prefill) => {
    setNewsModalText(prefill != null ? prefill : inputText);
    setNewsModalOpen(true);
  };
  const closeNewsModal = () => setNewsModalOpen(false);
  const submitNewsModal = () => {
    const parsed = parseNews(newsModalText);
    if (!parsed) return;
    const cur = abortRefs.current[cacheKey];
    if (cur) cur.abort();
    setInputText(newsModalText);
    setNewsModalOpen(false);
    runAnalysis(parsed, guestKey, guests, mode);
  };
  // 座位：横向一排（人数变化自动换行）；统一为 {master, groupKey, isHost}
  const seats = useMemo(
    () => [
      { master: host, groupKey: '价值投资', isHost: true },
      ...guests.map((g) => ({ master: g.master, groupKey: g.groupKey, isHost: false })),
    ],
    [host, guests],
  );

  const speakerOf = (leadId) => findMasterById(leadId) || host;
  // 快速模式的短发言轮次：speaker 角色 → 具体大师（host=巴菲特，guestN=第 N+1 位嘉宾）
  const turnSpeaker = (role) => {
    if (role === 'host') return host;
    const m = /^guest(\d+)$/.exec(String(role || ''));
    if (m && guests[Number(m[1])]) return guests[Number(m[1])].master;
    return host;
  };
  // 追问：点击「想深挖？」里的问题，直接向该步骤负责人提问（圆桌内追加一轮简短问答）
  const askFollowUp = useCallback((q, leadId, fuId) => {
    if (!ensureAiReady()) return;
    const key = cacheKey;
    if (!key || !news) return;
    const id = fuId || `f-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setCache((prev) => {
      const cur = prev[key] || { status: 'done', steps: [] };
      const followups = [...(cur.followups || [])];
      const fu = { id, q, leadId, status: 'loading', content: '', hostNote: '', error: '' };
      const i = followups.findIndex((f) => f.id === id);
      if (i >= 0) followups[i] = fu; else followups.push(fu);
      // 只追加追问轮次，不改动当前步骤生成状态
      return { ...prev, [key]: { ...cur, followups } };
    });
    (async () => {
      try {
        const res = await fetch('/api/breakfast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            news: { title: news.title, content: news.content, source: news.source, time: news.time },
            hostId: 'buffett',
            guests: guests.map((g) => ({ id: g.master.id, groupKey: g.groupKey })),
            mode,
            stepKey: 'followup',
            followUp: q,
            followUpLead: leadId,
            prevSteps: (entry.steps || []).map((st) => ({ title: st.title, content: st.content, pool: st.pool })),
            aiConfig: getAiConfig(),
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || '追问失败，请重试');
        setCache((prev) => {
          const cur = prev[key] || {};
          const followups = (cur.followups || []).map((f) => (f.id === id
            ? { ...f, status: 'done', content: (data.result && data.result.content) || '', hostNote: (data.result && data.result.hostNote) || '' }
            : f));
          return { ...prev, [key]: { ...cur, followups } };
        });
      } catch (e) {
        setCache((prev) => {
          const cur = prev[key] || {};
          const followups = (cur.followups || []).map((f) => (f.id === id
            ? { ...f, status: 'error', error: e.message || '追问失败，请重试' }
            : f));
          return { ...prev, [key]: { ...cur, followups } };
        });
      }
    })();
  }, [cacheKey, news, guests, mode, entry]);

  const btnLabel = entry.status === 'loading' ? '■ 停止'
    : entry.status === 'done' ? '↻ 再来一轮'
    : entry.status === 'error' ? '↻ 重试'
    : (news ? '▶ 开始解读' : '＋ 输入新闻');
  const onBtnClick = entry.status === 'loading' ? stopLoading
    : (entry.status === 'done' || entry.status === 'error') ? redoCurrent
    : (news ? start : () => openNewsModal(''));

  // loading 卡：深度模式显示当前步骤负责人（快速模式在卡内逐条显示「正在解读」）
  const loadingMaster = (entry.currentLead && findMasterById(entry.currentLead)) || host;
  const loadingAction = entry.currentAction || '正在进行新闻分析…';
  // 移动端详情态：分析进行中/已完成 且 未手动返回列表
  const mobileDetail = entry.status !== 'idle' && !bkShowList;

  return (
    <div className={`bk-workspace${mobileDetail ? ' bk-mobile-detail' : ''}`}>
      <div className="bk-layout">
        <aside className="bk-news-col">
          <div className="bk-news-list-head">
            <span>{newsTab === 'hot' ? '📰 消息面解读' : '📌 我的股票池新闻'}</span>
            <div className="bk-news-head-actions">
              {newsTab === 'hot' ? (
                <>
                  {newsFallback && newsList.length === 0 && !newsLoading && (
                    <span className="bk-news-fallback-tip" title={newsError || ''}>实时源暂不可用，展示示例</span>
                  )}
                  <button
                    type="button"
                    className="bk-news-refresh"
                    onClick={() => loadNews(1, false)}
                    disabled={newsLoading}
                    title="刷新新闻列表"
                  >
                    {newsLoading && newsList.length === 0 ? '···' : '↻ 刷新'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="bk-news-refresh"
                  onClick={() => loadPoolNews(true)}
                  disabled={poolNewsLoading}
                  title="刷新我的股票池新闻"
                >
                  {poolNewsLoading ? '···' : '↻ 刷新'}
                </button>
              )}
            </div>
          </div>

          {/* 强入口：点击弹窗输入自定义新闻 */}
          <button
            type="button"
            className="bk-news-entry"
            onClick={() => openNewsModal('')}
            disabled={entry.status === 'loading'}
            title="粘贴新闻链接或文本，开启解读"
          >
            <span className="bk-news-entry-icon">✎</span> 输入新闻源
          </button>

          {/* 页签：24小时热点（默认）/ 我的股票池新闻，放在输入信息源正下方 */}
          <div className="bk-news-tabs" role="tablist" aria-label="新闻来源">
            <button type="button" role="tab" className={newsTab === 'hot' ? 'active' : ''} aria-selected={newsTab === 'hot'} onClick={() => setNewsTab('hot')}>24小时热点</button>
            <button type="button" role="tab" className={newsTab === 'mine' ? 'active' : ''} aria-selected={newsTab === 'mine'} onClick={() => setNewsTab('mine')}>我的股票池新闻</button>
          </div>

          {newsTab === 'hot' ? (
            <>
              {(newsList.length ? newsList : SAMPLE_NEWS).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`bk-news-row${activeNewsId === n.id ? ' active' : ''}`}
                  onClick={() => { setActiveNewsId(n.id); openNewsModal(`${n.title}\n${n.summary || ''}`); }}
                >
                  <span className="bk-news-row-arrow" aria-hidden="true">›</span>
                  <span className="bk-news-row-main">
                    <span className="bk-news-row-title">{n.title}</span>
                    <span className="bk-news-row-meta">
                      {n.source} · {n.time}
                      {(n.tags || []).map((t) => <span key={t} className="bk-tag">{t}</span>)}
                      {isInterpreted(n) && <span className="bk-tag bk-tag-done">✓ 已解读</span>}
                    </span>
                  </span>
                </button>
              ))}
              {!newsFallback && hasMore && (
                <button type="button" className="bk-news-more" onClick={() => loadNews(newsPage + 1, true)} disabled={newsLoading}>
                  {newsLoading ? '加载中…' : '加载更多'}
                </button>
              )}
            </>
          ) : (
            <>
              {myPools.length === 0 ? (
                <div className="bk-poolnews-empty">
                  <div className="bk-poolnews-empty-title">还没有「我的股票池」</div>
                  <p className="bk-poolnews-empty-desc">创建后，这里会实时展示与你自选股相关的新闻；创建的池子会同步出现在「大师的选股池 · 我的股票池」。</p>
                  <button
                    type="button"
                    className="bk-news-entry bk-poolnews-create"
                    onClick={() => setImportOpen(true)}
                    title="与选股池「导入股票池」交互一致"
                  >
                    <span className="bk-news-entry-icon">＋</span> 快速创建我的股票池
                  </button>
                </div>
              ) : poolNewsLoading ? (
                <div className="bk-poolnews-empty bk-poolnews-loading">
                  <span className="bk-loading-speech-dots"><span /><span /><span /></span>
                  <span>正在搜索 {myStockCount || 0} 只自选股的新闻…</span>
                </div>
              ) : poolNewsError ? (
                <div className="bk-poolnews-empty">
                  <div className="bk-poolnews-empty-title">⚠ {poolNewsError}</div>
                  <button type="button" className="bk-news-refresh" onClick={() => loadPoolNews(true)}>↻ 重试</button>
                </div>
              ) : poolNewsItems.length === 0 ? (
                <div className="bk-poolnews-empty">
                  <div className="bk-poolnews-empty-title">暂时没找到与你的自选股相关的新闻</div>
                  <p className="bk-poolnews-empty-desc">已搜索 {myStockCount || 0} 只自选股（滚动快讯 + 个股新闻 + 公司公告）；稍后刷新，或切到「24小时热点」看大盘消息。</p>
                </div>
              ) : (
                poolNewsItems.map((n) => (
                  <button
                    key={n.id || n.title}
                    type="button"
                    className="bk-news-row"
                    onClick={() => openNewsModal(`${n.title}\n${n.summary || ''}`)}
                  >
                    <span className="bk-news-row-arrow" aria-hidden="true">›</span>
                    <span className="bk-news-row-main">
                      <span className="bk-news-row-title">{n.title}</span>
                      <span className="bk-news-row-meta">
                        {n.source} · {n.time}
                        {(n.related || []).map((r) => <span key={r.symbol || r.name} className="bk-tag bk-tag-related">{r.name}</span>)}
                        {isInterpreted(n) && <span className="bk-tag bk-tag-done">✓ 已解读</span>}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </>
          )}
        </aside>

        <section className={`bk-main-col${entry.status === 'idle' ? ' bk-main-idle' : ''}`}>
        {/* 顶部信息行：巴菲特带你读新闻 + 功能按钮（固定在顶部） */}
        <div className="bk-roundtable-head">
          <button
            type="button"
            className={`bk-mobile-back${mobileDetail ? '' : ' bk-mobile-back-hidden'}`}
            onClick={() => setBkShowList(true)}
            aria-label="返回新闻列表"
            title="返回新闻列表"
          >←</button>
          <span className="bk-roundtable-title">巴菲特带你读新闻</span>
          <div className="bk-roundtable-actions">
            {(news || entry.status !== 'idle') && (
              <button type="button" className={`bk-mini bk-start-mini${entry.status === 'loading' ? ' is-loading' : ''}`} onClick={onBtnClick} title={news ? '开始解读 / 停止 / 再来一轮' : '输入新闻链接或文本'}>
                {btnLabel}
              </button>
            )}
          </div>
        </div>
        <p className="bk-intro">从左侧挑一条财经新闻（或点「✎ 输入新闻源」自己贴一条），点「开始解读」——巴菲特与嘉宾会用「事件穿透投资框架」逐层解读，帮你捕捉值得关注的投资机会点。</p>

        {/* 座位：初始 3×3 块状；解读中/后一行放全部大师 */}
        {entry.status === 'idle' ? (
          <div className="bk-seats-wrap center">
            <div className="bk-seats-grid">
              {seats.map((p) => (
                <div key={p.master.id} className={`bk-seat-block${p.isHost ? ' host' : ''}`}>
                  <span className="bk-seat-block-avatar">
                    <MasterAvatar master={p.master} size={60} />
                  </span>
                  <div className="bk-seat-block-name">
                    {p.isHost ? '巴菲特' : p.master.name}
                    <span className={`bk-seat-role${p.isHost ? '' : ' bk-seat-guest'}`}>{p.isHost ? '主持' : '嘉宾'}</span>
                  </div>
                  <div className="bk-seat-block-style">{p.isHost ? '价值投资' : p.groupKey}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bk-roundtable-seats">
            {seats.map((p) => (
              <div key={p.master.id} className={`bk-seat${p.isHost ? ' bk-seat-host' : ''}`}>
                <span className="bk-seat-avatar">
                  <MasterAvatar master={p.master} size={36} />
                </span>
                <div className="bk-seat-name">{p.isHost ? '巴菲特' : p.master.name}</div>
                <div className="bk-seat-style">{p.isHost ? '价值投资' : p.groupKey}</div>
              </div>
            ))}
          </div>
        )}

        {/* 分析区：无内容时不显示空容器 */}
        {entry.status !== 'idle' && (
        <div className="bk-dialog" role="region" aria-label="事件穿透分析">
          {entry.status === 'error' && (
            <div className="bk-error">
              <div>⚠ {entry.error || '生成失败'}</div>
            </div>
          )}

          {(items || []).map((s, i) => {
            const speaker = speakerOf(s.leadId);
            const isConclusion = s.type === 'conclusion' || s.stepKey === 'conclusion';
            const isGate = s.type === 'gate' || s.stepKey === 'gate';
            const isQuick = s.type === 'quick' || s.stepKey === 'quick';
            // 定调/相关性徽章：只处理 收束（方向）与 初筛（相关性）；其余步骤保持原文
            const pt = (isQuick || (!isGate && !isConclusion)) ? null : parseLeadingTag(s.content);
            const stBadge = pt && pt.emoji
              ? (isGate ? RELEVANCE_LABELS[relevanceOf(pt.emoji)] : STANCE_LABELS[stanceOf(pt.emoji)])
              : null;
            const pinned = isConclusion || isQuick || isGate;
            const expanded = pinned || entry.status !== 'done' || expandedKeys.has(s.stepKey);
            const cls = `bk-step bk-step-speech${isConclusion ? ' bk-step-conclusion' : ''}${isGate ? ' bk-step-gate' : ''}${!expanded ? ' bk-step-folded' : ''}`;
            const fuBlock = (keyBase) => (Array.isArray(s.followUps) && s.followUps.length > 0 ? (
              <div className="bk-step-followups">
                <div className="bk-fu-label">想深挖？点击即可追问：</div>
                {s.followUps.map((f, fi) => (
                  <button key={fi} type="button" className="bk-fu-item" onClick={() => askFollowUp(f, speaker.id)} title="点击直接向该大师提问，无需复制">
                    <span className="bk-fu-ask">＋</span>
                    <span className="bk-fu-text">{renderInline(f, `${keyBase}-${i}-${fi}`)}</span>
                  </button>
                ))}
              </div>
            ) : null);
            return (
              <div key={`${s.stepKey}-${i}`} className={cls}>
                <button type="button" className="bk-step-head" onClick={() => toggleStep(s.stepKey)} aria-expanded={expanded}>
                  <MasterAvatar master={speaker} size={30} />
                  <span className="bk-step-title">{s.title}</span>
                  <span className="bk-step-speaker">{speaker.name}</span>
                  {stBadge && <span className={`bk-stance ${stBadge.cls}`}>{stBadge.label}</span>}
                  <span className="bk-step-toggle">{expanded ? '▾' : '▸'}</span>
                </button>
                {expanded && (
                  <>
                    {isQuick ? (
                      <>
                        <div className="bk-quick-turns">
                          {(s.turns || []).map((t, ti) => {
                            const sp = turnSpeaker(t.speaker);
                            const isH = sp.id === host.id;
                            const { cleaned, emoji } = parseLeadingTag(t.text);
                            const st = emoji ? STANCE_LABELS[stanceOf(emoji)] : null;
                            return (
                              <div key={ti} className={`bk-turn-row${isH ? ' bk-turn-row-host' : ''}`}>
                                <span className="bk-turn-row-avatar"><MasterAvatar master={sp} size={24} /></span>
                                <div className="bk-turn-row-body">
                                  <span className="bk-turn-row-head">
                                    <span className="bk-turn-row-name">{sp.name}</span>
                                    {st && <span className={`bk-stance ${st.cls}`}>{st.label}</span>}
                                  </span>
                                  <div className="bk-turn-row-text">{renderInline(cleaned, `qt-${i}-${ti}`)}</div>
                                </div>
                              </div>
                            );
                          })}
                          {s.pending && (
                            <div className="bk-turn-row bk-turn-row-pending">
                              <span className="bk-turn-row-avatar"><MasterAvatar master={turnSpeaker(s.pending.speaker)} size={24} /></span>
                              <div className="bk-turn-row-body">
                                <span className="bk-turn-row-name">{turnSpeaker(s.pending.speaker).name}</span>
                                <div className="bk-turn-row-text">
                                  <span className="bk-loading-speech-dots"><span /><span /><span /></span>
                                  <span>{s.pending.action}</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                        {s.summary && (
                          <div className="bk-quick-summary">
                            <div className="bk-quick-summary-label">总结</div>
                            <div className="bk-quick-summary-text">{renderInline(s.summary, `qs-${i}`)}</div>
                          </div>
                        )}
                      </>
                    ) : ((pt ? pt.cleaned : s.content) && <div className="bk-step-body">{renderInline(pt ? pt.cleaned : s.content, `c-${i}`)}</div>)}
                    {isConclusion && (
                      <>
                        {Array.isArray(s.opportunities) && s.opportunities.length > 0 && (
                          <div className="bk-conclusion-opps">
                            {s.opportunities.map((o, oi) => (
                              <div key={oi} className="bk-conclusion-opp">
                                <div className="bk-opp-line">
                                  {o.tier && <span className="bk-opp-tier">{o.tier}</span>}
                                  <span className="bk-opp-name">{o.name}{o.code ? `（${o.code}）` : ''}</span>
                                </div>
                                {o.logic && <div className="bk-opp-logic">{o.logic}</div>}
                                {o.risk && <div className="bk-opp-risk">风险：{o.risk}</div>}
                                {o.falsify && <div className="bk-opp-risk">证伪：{o.falsify}</div>}
                              </div>
                            ))}
                          </div>
                        )}
                        {s.action && s.action.verdict && (
                          <div className="bk-conclusion-action">
                            <span className="bk-action-verdict">操作建议：{s.action.verdict}</span>
                            {s.action.entry && <span>买入：{s.action.entry}</span>}
                            {s.action.stopLoss && <span>止损：{s.action.stopLoss}</span>}
                            {s.action.cycle && <span>周期：{s.action.cycle}</span>}
                          </div>
                        )}
                        {s.risk && <div className="bk-conclusion-risk">风险：{s.risk}</div>}
                      </>
                    )}
                    {isGate && s.stop && <div className="bk-gate-stopnote">⚪ 该事件暂不相关，未继续深挖。</div>}
                    {fuBlock('f')}
                  </>
                )}
              </div>
            );
          })}

          {/* 正在发言的大师：loading 放在其发言位内（快速模式在卡内逐条显示，不占这里） */}
          {entry.status === 'loading' && mode !== 'quick' && (
            <div className="bk-loading-speech">
              <MasterAvatar master={loadingMaster} size={32} />
              <div className="bk-loading-speech-body">
                <div className="bk-loading-speech-name">{loadingMaster.name}</div>
                <div className="bk-loading-speech-line">
                  <span className="bk-loading-speech-dots"><span /><span /><span /></span>
                  <span>{loadingAction}</span>
                </div>
              </div>
            </div>
          )}

          {/* 追问：点击「想深挖？」后追加的问答轮次 */}
          {Array.isArray(entry.followups) && entry.followups.length > 0 && (
            <div className="bk-followups">
              <div className="bk-followups-label">💬 追问</div>
              {entry.followups.map((f, i) => {
                const fuSpeaker = speakerOf(f.leadId);
                return (
                  <div key={f.id || i} className="bk-fu-round">
                    <div className="bk-fu-q"><span className="bk-fu-q-badge">问</span>{renderInline(f.q, `fq-${i}`)}</div>
                    {f.status === 'loading' && (
                      <div className="bk-fu-loading">
                        <span className="bk-fu-dots"><span /><span /><span /></span>
                        <span>正在追问 {fuSpeaker.name}…</span>
                      </div>
                    )}
                    {f.status === 'error' && (
                      <div className="bk-fu-error">
                        <span>⚠ {f.error}</span>
                        <button type="button" className="bk-fu-retry" onClick={() => askFollowUp(f.q, f.leadId, f.id)}>↻ 重试</button>
                      </div>
                    )}
                    {f.status === 'done' && (
                      <div className="bk-fu-answer">
                        <div className="bk-fu-answer-head">
                          <MasterAvatar master={fuSpeaker} size={26} />
                          <span className="bk-fu-answer-name">{fuSpeaker.name}</span>
                        </div>
                        <div className="bk-fu-answer-body">{renderInline(f.content, `fa-${i}`)}</div>
                        {f.hostNote && f.leadId !== 'buffett' && (
                          <div className="bk-fu-hostnote">
                            <MasterAvatar master={host} size={20} />
                            <span><strong>{host.name}：</strong>{renderInline(f.hostNote, `fh-${i}`)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}
        </section>
      </div>

      {/* 新闻输入弹窗：左侧强入口点击后弹出 */}
      {newsModalOpen && (
        <div className="bk-modal-overlay" onClick={closeNewsModal}>
          <div className="bk-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="bk-modal-head">
              <span className="bk-modal-title">输入新闻源</span>
              <button type="button" className="bk-modal-close" onClick={closeNewsModal} aria-label="关闭">✕</button>
            </div>
            <textarea
              className="bk-news-input bk-modal-input"
              value={newsModalText}
              onChange={(e) => setNewsModalText(e.target.value)}
              placeholder={'粘贴新闻链接或新闻文本（文本第一行作为标题）\n例如：\n英伟达发布新一代 AI 训练芯片，推理成本再降三成\n英伟达在 GTC 上发布新一代芯片，官方称训练成本下降约 30%…'}
              rows={6}
              autoFocus
            />
            <div className="bk-modal-foot">
              <div className="bk-mode-switch" role="group" aria-label="推理强度">
                <button type="button" className={mode === 'quick' ? 'active' : ''} onClick={() => setMode('quick')}>快速</button>
                <button type="button" className={mode === 'deep' ? 'active' : ''} onClick={() => setMode('deep')}>深度</button>
              </div>
              <div className="bk-modal-actions">
                <button type="button" className="bk-modal-cancel" onClick={closeNewsModal}>取消</button>
                <button type="button" className="bk-start-btn" disabled={!parseNews(newsModalText)} onClick={submitNewsModal}>▶ 开始解读</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <StockPoolImportModal
        open={importOpen}
        initialType="mine"
        onClose={() => setImportOpen(false)}
        onCreated={() => loadPoolNews(true)}
      />
    </div>
  );
}

// ── 我的股票池新闻：本地缓存（30 分钟） + 超过 7 天自动剔除 ──
function loadPoolNewsCache() {
  try { return JSON.parse(localStorage.getItem('thinktank_poolnews_cache') || 'null'); } catch (e) { return null; }
}
function savePoolNewsCache(cache) {
  try { localStorage.setItem('thinktank_poolnews_cache', JSON.stringify(cache)); } catch (e) { /* ignore */ }
}
const POOLNEWS_TTL = 30 * 60 * 1000;        // 30 分钟
const POOLNEWS_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 天
// 剔除超过 7 天的新闻；无时间戳（ts<=0）的保留，避免误删
function filterFresh(items) {
  const cutoff = Date.now() - POOLNEWS_MAX_AGE;
  return (items || []).filter((n) => !n.ts || n.ts * 1000 >= cutoff);
}

// ── 解读结果记忆：已完成的解读持久化到 localStorage，下次同一条新闻直接命中，不重复消耗 token ──
const BK_MEMORY_KEY = 'thinktank_breakfast_memory';
const BK_MEMORY_MAX = 20;                 // 最多保留 20 条解读
const BK_MEMORY_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天过期
// 规整：只留「已完成」且未过期，按时间倒序保留最近 N 条
function prepareMem(map) {
  const cutoff = Date.now() - BK_MEMORY_TTL;
  const out = {};
  for (const k in map) {
    const e = map[k];
    if (e && e.status === 'done' && e.at && e.at >= cutoff) out[k] = { status: 'done', steps: e.steps || [], at: e.at };
  }
  const keys = Object.keys(out).sort((a, b) => (out[b].at || 0) - (out[a].at || 0));
  keys.slice(BK_MEMORY_MAX).forEach((k) => delete out[k]);
  return out;
}
function loadBreakfastMemory() {
  try { return prepareMem(JSON.parse(localStorage.getItem(BK_MEMORY_KEY) || '{}') || {}); }
  catch (e) { return {}; }
}
function saveBreakfastMemory(map) {
  try { localStorage.setItem(BK_MEMORY_KEY, JSON.stringify(prepareMem(map))); }
  catch (e) { /* ignore */ }
}
