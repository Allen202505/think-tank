'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { PRESET_MASTERS, snapColorToPalette } from '../data/masters';
import { messages } from '../i18n/messages';
import { Card, MasterAvatar, MiniBtn } from '../components/ui';
import MasterProfileModal from '../components/MasterProfileModal';
import {
  TYPING_INDICATOR_MS,
  TYPEWRITER_DELAY_MS,
  AFTER_TYPE_PAUSE_MS,
  STANCES,
  MODES,
  buildFollowUpPrompt,
  buildOpeningOnlyPrompt,
  buildOneSpeechPrompt,
  buildClosingOnlyPrompt,
  buildVerdictOnlyPrompt,
  buildChatPrompt,
} from '../lib/prompts';
import { generatePoster } from '../lib/poster';
import './page.css';

// 从发言的实际立场统计票数（不信任 AI 裁决里的数字，避免数错）
function countVotes(items) {
  const votes = { bull: 0, bear: 0, neutral: 0 };
  for (const b of items || []) {
    if (b.type !== 'speech') continue;
    const st = b.msg?.stance ?? b.content?.stance;
    if (st === 'BULL') votes.bull += 1;
    else if (st === 'BEAR') votes.bear += 1;
    else votes.neutral += 1;
  }
  return votes;
}

// ─── 主组件 ──────────────────────────────────────────────
export default function Home() {
  // 结构化数据 JSON-LD
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: '大师吵股',
    alternateName: '世界投资大师智囊团',
    description: '汇聚巴菲特、芒格、索罗斯等世界顶级投资大师的智慧，通过AI模拟激烈辩论，为您的投资决策提供多角度专业参考',
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'CNY',
    },
  };

  const [theme, setTheme] = useState('light'); // 默认亮色；SSR 与首帧一致，挂载后 effect 再读 localStorage
  const [qrOpen, setQrOpen] = useState(false);
  const [qrImgError, setQrImgError] = useState(false);
  // 语言：默认跟随浏览器语言（中文优先）
  const [locale, setLocale] = useState('zh');
  // 默认 5 位（SSR 固定，避免水合不一致；挂载后再随机/恢复）
  const [selected, setSelected] = useState(() => new Set(['buffett', 'munger', 'soros', 'lynch', 'dalio']));
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [profileMaster, setProfileMaster] = useState(null);
  const [posterOpen, setPosterOpen] = useState(false);
  const [posterUrl, setPosterUrl] = useState('');
  const [posterBusy, setPosterBusy] = useState(false);
  const [chatMode, setChatMode] = useState('group'); // 群聊 / 单聊
  const [mode, setMode] = useState('debate'); // 群聊风格：debate/explore/teach
  const [customMasters, setCustomMasters] = useState([]); // 邀请的虚拟大师
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteHint, setInviteHint] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [invitePhase, setInvitePhase] = useState('form'); // form | building | preview | added
  const [inviteStage, setInviteStage] = useState('');      // search | research | build
  const [inviteMaster, setInviteMaster] = useState(null); // 生成的画像（预览）
  const [inviteSources, setInviteSources] = useState([]); // 检索资料来源标题
  const [inviteError, setInviteError] = useState(''); // 邀请弹窗内错误
  const [supplementOpen, setSupplementOpen] = useState(false); // 需要补充公司信息弹窗
  const [supplementValue, setSupplementValue] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState([]);
  const [followUpInput, setFollowUpInput] = useState('');
  const [loadingFollowUp, setLoadingFollowUp] = useState(false);
  const [rounds, setRounds] = useState([]);
  const [sequence, setSequence] = useState([]);       // 本轮的请求顺序：hostOpening, speech, ..., hostClosing, verdict
  const [stepIndex, setStepIndex] = useState(0);
  const [completedBlocks, setCompletedBlocks] = useState([]); // 已收到并展示完的条目
  const [currentBlock, setCurrentBlock] = useState(null);     // 当前条 { type, speakerId?, content? }，有 content 时进入打字
  const [typingPhase, setTypingPhase] = useState('typing');
  const [typeCharIndex, setTypeCharIndex] = useState(0);
  // 非流式（rounds）模式的逐条展示进度；流式结束后也会用它来保留历史记录
  const [revealStepLegacy, setRevealStepLegacy] = useState(0);
  const fetchInProgressRef = useRef(false);
  const goTimeoutRef = useRef(null);
  const snapshotRef = useRef(''); // 信息层梳理生成的快照（随每条请求带给 /api/chat）

  const allMasters = useMemo(() => [...customMasters, ...PRESET_MASTERS], [customMasters]); // 邀请的大师排在预置大师前面
  const CUSTOM_KEY = 'custom-masters-v1';
  const HISTORY_KEY = 'debate-history-v1';
  const currentSessionIdRef = useRef(null);

  // 兼容追问：追问仍用「预加载一整段」再逐条展示，用 rounds 生成 blocks
  const blocksFromRounds = useMemo(() => {
    const out = [];
    rounds.forEach((round, roundIndex) => {
      if (round.type === 'round') {
        const hid = round.hostId;
        if (round.hostOpening) out.push({ type: 'hostOpening', text: round.hostOpening, roundIndex, speakerId: hid, textToType: round.hostOpening });
        (round.discussion || []).forEach((msg, i) => out.push({ type: 'speech', msg, roundIndex, index: i, speakerId: msg.investorId, textToType: msg.content || '' }));
        if (round.hostClosing) out.push({ type: 'hostClosing', text: round.hostClosing, roundIndex, speakerId: hid, textToType: round.hostClosing });
        if (round.verdict && Object.keys(round.verdict).length > 0) out.push({ type: 'verdict', verdict: round.verdict, roundIndex, speakerId: null, textToType: (round.verdict.summary || '') });
      } else if (round.type === 'followUp') {
        if (round.userMsg) out.push({ type: 'userMsg', text: round.userMsg, roundIndex, speakerId: 'user', textToType: round.userMsg });
        (round.discussion || []).forEach((msg, i) => out.push({ type: 'speech', msg, roundIndex, index: i, speakerId: msg.investorId, textToType: msg.content || '' }));
        if (round.verdict && Object.keys(round.verdict).length > 0) out.push({ type: 'verdict', verdict: round.verdict, roundIndex, speakerId: null, textToType: (round.verdict.summary || '') });
      }
    });
    return out;
  }, [rounds]);

  const useStreamingMode = sequence.length > 0;
  // 已完成列表（逐条模式用 completedBlocks；rounds 模式用 blocksFromRounds）
  const blocks = useStreamingMode ? completedBlocks : blocksFromRounds;
  // 关键：rounds 模式下用 revealStepLegacy，避免流式结束后“清屏”
  const revealStep = useStreamingMode ? completedBlocks.length : revealStepLegacy;
  // 当前条要打字的文案（逐条模式用 currentBlock.content 导出）
  const getCurrentText = () => {
    if (!currentBlock?.content) return '';
    if (currentBlock.type === 'hostOpening' || currentBlock.type === 'hostClosing' || currentBlock.type === 'userMsg') return typeof currentBlock.content === 'string' ? currentBlock.content : '';
    if (currentBlock.type === 'speech') return currentBlock.content?.content ?? '';
    if (currentBlock.type === 'verdict') return currentBlock.content?.summary ?? '';
    return '';
  };
  const currentTextStreaming = useStreamingMode ? getCurrentText() : '';
  const currentLenStreaming = currentTextStreaming.length;

  useEffect(() => {
    const storedTheme = typeof window !== 'undefined' && localStorage.getItem('theme');
    if (storedTheme === 'light' || storedTheme === 'dark') setTheme(storedTheme);
    // 首次根据浏览器语言设置 locale
    if (typeof navigator !== 'undefined') {
      const lang = navigator.language.toLowerCase();
      setLocale(lang.startsWith('zh') ? 'zh' : 'en');
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', theme);
    if (typeof window !== 'undefined') localStorage.setItem('theme', theme);
    // 恢复聊天方式
    try {
      const cm = localStorage.getItem('chat-mode-v1');
      if (cm === 'group' || cm === 'solo') setChatMode(cm);
    } catch (e) { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem('chat-mode-v1', chatMode); } catch (e) { /* ignore */ }
  }, [chatMode]);

  // ─── 讨论持久化（#6）：刷新/重开页面可恢复最近一场 ───
  const STORAGE_KEY = 'master-debate-state-v1';

  // 恢复上次讨论（仅首次挂载）：URL 指定大师 > 本地历史 > 随机 5 位
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // 1) 载入邀请的虚拟大师
    let customs = [];
    try { customs = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); } catch (e) { /* ignore */ }
    if (Array.isArray(customs) && customs.length) setCustomMasters(customs.map((c) => ({ ...c, color: snapColorToPalette(c.color) })));
    const roster = [...(Array.isArray(customs) ? customs : []), ...PRESET_MASTERS];

    // 2) 载入历史列表
    try { setHistoryList(JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')); } catch (e) { /* ignore */ }

    // 4) 恢复上次讨论 / URL 指定大师 / 随机
    let selectedSet = null;
    try {
      const params = new URLSearchParams(window.location.search);
      const ids = (params.get('masters') || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length) {
        const valid = new Set(ids.filter((id) => roster.some((m) => m.id === id)));
        if (valid.size) {
          selectedSet = valid;
          setQuery('');
          setRounds([]);
          setResult(null);
          setRevealStepLegacy(0);
        }
      }
    } catch (e) { /* ignore */ }

    if (!selectedSet) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          if (Array.isArray(saved.selected) && saved.selected.length) selectedSet = new Set(saved.selected);
          if (typeof saved.query === 'string') setQuery(saved.query);
          if (Array.isArray(saved.rounds) && saved.rounds.length) {
            setRounds(saved.rounds);
            setResult(saved.result || null);
            setRevealStepLegacy(9999); // 直接展示全部历史
          }
        }
      } catch (e) { /* 恢复失败不影响使用 */ }
    }

    if (!selectedSet) {
      const shuffled = [...roster].sort(() => Math.random() - 0.5);
      selectedSet = new Set(shuffled.slice(0, 5).map((i) => i.id));
    }
    setSelected(selectedSet);
  }, []);

  // 防抖保存
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          selected: Array.from(selected),
          query,
          result,
          rounds,
        }));
      } catch (e) { /* 忽略 */ }
    }, 600);
    return () => clearTimeout(t);
  }, [selected, query, result, rounds]);

  const resetDebate = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    setResult(null);
    setRounds([]);
    setSequence([]);
    setCompletedBlocks([]);
    setStepIndex(0);
    setCurrentBlock(null);
    setTypingPhase('typing');
    setTypeCharIndex(0);
    setRevealStepLegacy(0);
    setFollowUpInput('');
    setError('');
  }, []);

  // ─── 邀请大师（虚拟大师） ───
  const persistCustoms = useCallback((masters) => {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(masters)); } catch (e) { /* ignore */ }
  }, []);

  const handleInvite = useCallback(async () => {
    const nm = inviteName.trim();
    if (!nm || inviteBusy) return;
    setInviteBusy(true);
    setError('');
    setInviteError('');
    setInvitePhase('building');
    setInviteStage('search');
    setInviteMaster(null);
    setInviteSources([]);
    try {
      const res = await fetch('/api/virtual-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nm, hint: inviteHint.trim() }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.stage === 'search') setInviteStage('search');
            else if (ev.stage === 'research') setInviteStage('research');
            else if (ev.stage === 'build') setInviteStage('build');
            else if (ev.stage === 'done') {
              setInviteMaster({ ...ev.master, sources: ev.sources || [] });
              setInviteSources(ev.sources || []);
              setInvitePhase('preview');
              finished = true;
            } else if (ev.stage === 'error') {
              setInviteError(ev.error || '生成失败，请重试');
              setInvitePhase('form');
              finished = true;
            }
          } catch (e) { /* 忽略半行 */ }
        }
      }
      if (!finished) { setInviteError('生成中断，请重试'); setInvitePhase('form'); }
    } catch (e) {
      setInviteError(e.message || '生成失败，请重试');
      setInvitePhase('form');
    }
    setInviteBusy(false);
  }, [inviteName, inviteHint, inviteBusy]);

  // 确认加入智囊团（持久化 + 选中）
  const confirmInvite = useCallback(() => {
    if (!inviteMaster) return;
    const next = [inviteMaster, ...customMasters]; // 最新邀请的大师排最前
    setCustomMasters(next);
    persistCustoms(next);
    setSelected((prev) => new Set([...prev, inviteMaster.id]));
    setInvitePhase('added');
  }, [inviteMaster, customMasters, persistCustoms]);

  const openInvite = useCallback(() => {
    setInvitePhase('form');
    setInviteStage('');
    setInviteMaster(null);
    setInviteSources([]);
    setError('');
    setInviteError('');
    setInviteOpen(true);
  }, []);

  const closeInvite = useCallback(() => {
    setInviteOpen(false);
    setInvitePhase('form');
    setInviteStage('');
    setInviteMaster(null);
    setInviteSources([]);
    setInviteName('');
    setInviteHint('');
    setError('');
    setInviteError('');
  }, []);

  const removeCustomMaster = useCallback((id) => {
    setCustomMasters((prev) => {
      const next = prev.filter((m) => m.id !== id);
      persistCustoms(next);
      return next;
    });
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [persistCustoms]);

  // 一键进入与某位大师的一对一单聊
  const startSoloChat = useCallback((master) => {
    setChatMode('solo');
    setSelected(new Set([master.id]));
    setProfileMaster(null);
    setQuery('');
    setRounds([]);
    setResult(null);
    setSequence([]);
    setCompletedBlocks([]);
    setStepIndex(0);
    setCurrentBlock(null);
    setTypingPhase('typing');
    setTypeCharIndex(0);
    setRevealStepLegacy(0);
    setError('');
    setTimeout(() => {
      const el = document.querySelector('.question-input');
      if (el) el.focus();
    }, 120);
  }, []);

  // ─── 历史对话 ───
  const saveHistory = useCallback((roundsData, queryText, selectedIds) => {
    if (!Array.isArray(roundsData) || !roundsData.length) return;
    const sessionId = currentSessionIdRef.current || Date.now();
    const entry = {
      id: sessionId,
      ts: Date.now(),
      query: queryText,
      selected: selectedIds,
      rounds: roundsData,
    };
    setHistoryList((prev) => {
      const others = prev.filter((h) => h.id !== sessionId);
      const next = [entry, ...others].slice(0, 30);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
      return next;
    });
  }, []);

  // 讨论结束后（rounds 稳定）自动存入历史
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!rounds.length || loading || loadingFollowUp) return;
    const t = setTimeout(() => saveHistory(rounds, query, Array.from(selected)), 1200);
    return () => clearTimeout(t);
  }, [rounds, loading, loadingFollowUp, query, selected, saveHistory]);

  const restoreHistory = useCallback((entry) => {
    setQuery(entry.query || '');
    setSelected(new Set(entry.selected || []));
    setRounds(entry.rounds || []);
    setResult(entry.rounds?.[0]?.result || null);
    setRevealStepLegacy(9999);
    setHistoryOpen(false);
  }, []);

  // 分享海报（#10）
  const handlePoster = useCallback(async () => {
    if (!result || posterBusy) return;
    setPosterBusy(true);
    setError('');
    try {
      const stances = (result.discussion || []).reduce((acc, m) => {
        if (m?.stance === 'BULL') acc.bull += 1;
        else if (m?.stance === 'BEAR') acc.bear += 1;
        else acc.neutral += 1;
        return acc;
      }, { bull: 0, bear: 0, neutral: 0 });
      const canvas = await generatePoster({
        question: query,
        hostId: result.hostId,
        masters: result.investors || allMasters.filter((m) => selected.has(m.id)),
        hostOpening: result.hostOpening,
        discussion: result.discussion,
        hostClosing: result.hostClosing,
        verdict: { ...(result.verdict || {}), bullCount: stances.bull, bearCount: stances.bear, neutralCount: stances.neutral },
      });
      setPosterUrl(canvas.toDataURL('image/png'));
      setPosterOpen(true);
    } catch (e) {
      setError(`生成海报失败：${e.message || '未知错误'}`);
    }
    setPosterBusy(false);
  }, [result, query, selected, allMasters, posterBusy]);


  const qrSrc = process.env.NEXT_PUBLIC_QR_CODE_URL || '/my-qr.jpg';

  useEffect(() => {
    if (!qrOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setQrOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [qrOpen]);

  const dict = messages[locale] || messages.zh;
  const t = (key, ...args) => {
    const v = dict[key];
    return typeof v === 'function' ? v(...args) : (v ?? key);
  };

  // 预加载模式（追问）：当前条与打字长度（按 revealStepLegacy 推进）
  const currentBlockFromRounds =
    result && !useStreamingMode && blocksFromRounds.length > 0 && revealStepLegacy < blocksFromRounds.length
      ? blocksFromRounds[revealStepLegacy]
      : null;
  const currentTextRounds = currentBlockFromRounds?.textToType ?? '';
  const currentLenRounds = currentTextRounds.length;
  const currentText = (useStreamingMode ? currentTextStreaming : currentTextRounds) ?? '';
  const currentLen = (useStreamingMode ? currentLenStreaming : currentLenRounds) ?? 0;

  // 预加载模式：先「正在输入」再打字，打完进下一条
  useEffect(() => {
    if (useStreamingMode || !result || blocksFromRounds.length === 0 || revealStepLegacy >= blocksFromRounds.length) return;
    if (typingPhase === 'typing') {
      const t = setTimeout(() => setTypingPhase('content'), TYPING_INDICATOR_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [useStreamingMode, result, blocksFromRounds.length, revealStepLegacy, typingPhase]);

  useEffect(() => {
    if (useStreamingMode || !currentBlockFromRounds || typingPhase !== 'content') return;
    if (typeCharIndex >= currentLenRounds) {
      const t = setTimeout(() => {
        setRevealStepLegacy(s => s + 1);
        setTypingPhase('typing');
        setTypeCharIndex(0);
      }, AFTER_TYPE_PAUSE_MS);
      return () => clearTimeout(t);
    }
    const iv = setInterval(() => setTypeCharIndex(i => Math.min(i + 1, currentLenRounds)), TYPEWRITER_DELAY_MS);
    return () => clearInterval(iv);
  }, [useStreamingMode, currentBlockFromRounds, typingPhase, typeCharIndex, currentLenRounds]);

  const toggle = (id) => {
    if (chatMode === 'solo') {
      // 单聊：只能选 1 位对象，点其他大师即替换
      setSelected((prev) => (prev.has(id) ? new Set() : new Set([id])));
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
    }
  };
  const soloTarget = chatMode === 'solo' && selected.size === 1
    ? allMasters.find((m) => m.id === Array.from(selected)[0]) || null
    : null;

  const invMap = Object.fromEntries(allMasters.map(i => [i.id, i]));

  const getResponseText = useCallback(async (messages, userQuery, snapshot) => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, query: userQuery || undefined, snapshot: snapshot || undefined }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e?.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    return (data.content || []).map(c => c.text || '').join('').trim();
  }, []);

  const doRequest = useCallback(async (messages, userQuery, snapshot) => {
    const text = await getResponseText(messages, userQuery, snapshot);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      // 如果没严格返回 JSON，就把整段文本当成一次总结性发言兜底返回，避免完全没回应
      return {
        discussion: [{
          investorId: 'host-fallback',
          stance: 'NEUTRAL',
          content: text,
          keyPoint: '综合回答用户追问（非结构化兜底）',
        }],
        verdict: {},
      };
    }
    return JSON.parse(match[0]);
  }, [getResponseText]);

  // 逐条请求：当前步在请求中则发起 API，收到后写入 currentBlock.content 并进入打字
  useEffect(() => {
    if (!useStreamingMode || stepIndex >= sequence.length || !currentBlock || currentBlock.content != null) return;
    if (fetchInProgressRef.current) return;
    const step = sequence[stepIndex];
    if (!step || !result) return;

    fetchInProgressRef.current = true;
    const investors = result.investors || [];
    const host = investors.find(i => i.id === result.hostId) || investors[0];
    const invMapLocal = Object.fromEntries(investors.map(i => [i.id, i]));

    const run = async () => {
      try {
        if (step.type === 'hostOpening') {
          const prompt = buildOpeningOnlyPrompt(query, host, investors, mode);
          const text = await getResponseText([{ role: 'user', content: prompt }], query, snapshotRef.current);
          setCurrentBlock(b => b ? { ...b, content: text.replace(/^["']|["']$/g, '') } : b);
        } else if (step.type === 'speech') {
          const previousParts = completedBlocks.map(b => {
            if (b.type === 'hostOpening') return { type: 'hostOpening', text: b.content };
            if (b.type === 'speech') return { type: 'speech', investorId: b.speakerId, content: b.content?.content };
            return null;
          }).filter(Boolean);
          const prompt = buildOneSpeechPrompt(query, investors, previousParts, step.speakerId, mode);
          const text = await getResponseText([{ role: 'user', content: prompt }], query, snapshotRef.current);
          const match = text.match(/\{[\s\S]*\}/);
          const parsed = match ? JSON.parse(match[0]) : { investorId: step.speakerId, stance: 'NEUTRAL', content: text, keyPoint: '' };
          setCurrentBlock(c => c ? { ...c, content: parsed } : c);
        } else if (step.type === 'hostClosing') {
          const opening = completedBlocks.find(b => b.type === 'hostOpening')?.content || '';
          const discussionSummary = completedBlocks.filter(b => b.type === 'speech').map(b => `${invMapLocal[b.speakerId]?.name}: ${b.content?.content?.slice(0, 50)}...`).join('；');
          const prompt = buildClosingOnlyPrompt(query, host?.name || '主持人', opening, discussionSummary, mode);
          const text = await getResponseText([{ role: 'user', content: prompt }], query, snapshotRef.current);
          setCurrentBlock(b => b ? { ...b, content: text.replace(/^["']|["']$/g, '') } : b);
        } else if (step.type === 'verdict') {
          const opening = completedBlocks.find(b => b.type === 'hostOpening')?.content || '';
          const closing = completedBlocks.find(b => b.type === 'hostClosing')?.content || '';
          const discussionText = completedBlocks.filter(b => b.type === 'speech').map(b => b.content?.content).join('\n');
          const prompt = buildVerdictOnlyPrompt(query, opening, discussionText, closing, mode);
          const text = await getResponseText([{ role: 'user', content: prompt }], query, snapshotRef.current);
          const match = text.match(/\{[\s\S]*\}/);
          const parsed = match ? JSON.parse(match[0]) : {};
          setCurrentBlock(b => b ? { ...b, content: parsed } : b);
        }
        setTypingPhase('typing');
        setTypeCharIndex(0);
      } catch (e) {
        setError(e.message || '请求失败');
        setSequence([]);
        setCurrentBlock(null);
      }
      fetchInProgressRef.current = false;
    };
    run();
  }, [useStreamingMode, stepIndex, sequence, currentBlock, result, query, completedBlocks, getResponseText, mode]);

  // 逐条模式：收到内容后先「正在输入」再打字
  useEffect(() => {
    if (!useStreamingMode || !currentBlock?.content) return;
    if (typingPhase === 'typing') {
      const t = setTimeout(() => setTypingPhase('content'), TYPING_INDICATOR_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [useStreamingMode, currentBlock?.content, typingPhase]);

  // 逐条模式：打字打完则推进到下一步
  useEffect(() => {
    if (!useStreamingMode || !currentBlock?.content || typingPhase !== 'content') return;
    if (typeCharIndex >= currentLenStreaming) {
      const t = setTimeout(() => {
        const blockToAdd = currentBlock;
        setCompletedBlocks(prev => {
          const next = [...prev, blockToAdd];
          const nextIndex = next.length;
          if (nextIndex < sequence.length) {
            const nextStep = sequence[nextIndex];
            setCurrentBlock({ type: nextStep.type, speakerId: nextStep.speakerId });
            setTypingPhase('typing');
            setTypeCharIndex(0);
            setStepIndex(nextIndex);
          } else {
            const hostId = result?.hostId;
            const hostOpening = next.find(b => b.type === 'hostOpening')?.content || '';
            const discussion = next.filter(b => b.type === 'speech').map(b => b.content);
            const hostClosing = next.find(b => b.type === 'hostClosing')?.content || '';
            const verdict = next.find(b => b.type === 'verdict')?.content || {};
            setRounds([{ type: 'round', hostId, hostOpening, discussion, hostClosing, verdict }]);
            setResult(r => r ? { ...r, hostOpening, discussion, hostClosing, verdict } : null);
            setSequence([]);
            setCurrentBlock(null);
            setStepIndex(0);
            setTypingPhase('typing');
            setTypeCharIndex(0);
            setRevealStepLegacy(next.length);
          }
          return nextIndex < sequence.length ? next : [];
        });
      }, AFTER_TYPE_PAUSE_MS);
      return () => clearTimeout(t);
    }
    const iv = setInterval(() => setTypeCharIndex(i => Math.min(i + 1, currentLenStreaming)), TYPEWRITER_DELAY_MS);
    return () => clearInterval(iv);
  }, [useStreamingMode, currentBlock, typingPhase, typeCharIndex, currentLenStreaming, sequence, result]);

  const go = useCallback(async (force = false) => {
    if (!query.trim()) { setError(t('summonErrorNoQuestion')); return; }
    if (selected.size === 0) { setError(t('summonErrorNoMaster')); return; }
    const soloRequested = chatMode === 'solo';
    if (soloRequested && selected.size !== 1) { setError(t('summonErrorSoloCount')); return; }
    if (!soloRequested && selected.size < 2) { setError(t('summonErrorGroupCount')); return; }

    setError('');
    setNotice('');
    snapshotRef.current = '';
    currentSessionIdRef.current = Date.now();
    if (goTimeoutRef.current) clearTimeout(goTimeoutRef.current);
    setLoading(true); // 先显示加载态
    setResult(null);
    setRounds([]);
    setSequence([]);
    setCompletedBlocks([]);
    setStepIndex(0);
    setCurrentBlock(null);
    setTypingPhase('typing');
    setTypeCharIndex(0);
    setRevealStepLegacy(0);
    fetchInProgressRef.current = false;

    // 信息层梳理：先解析公司并生成最新数据快照（失败不阻断辩论）
    try {
      const ctxRes = await fetch('/api/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const ctx = await ctxRes.json();
      snapshotRef.current = ctx?.snapshot || '';
      if (ctx?.notice && !force) {
        // AI 判定这个问题需要具体公司数据：弹窗让用户补充，暂停发起（弹窗即提示，不显示行内提示）
        setNotice('');
        setLoading(false);
        setSupplementValue('');
        setSupplementOpen(true);
        return;
      }
      setNotice(''); // 正常发起时也不保留旧提示
    } catch (e) {
      snapshotRef.current = '';
    }

    const investors = allMasters.filter(i => selected.has(i.id));
    const isSolo = soloRequested; // 单聊：一对一深聊
    const host = isSolo ? investors[0] : investors[Math.floor(Math.random() * investors.length)];
    const speechOrder = [...investors].sort(() => Math.random() - 0.5);
    const seq = isSolo
      ? [{ type: 'speech', speakerId: investors[0].id }]
      : [
          { type: 'hostOpening', speakerId: host.id },
          ...speechOrder.map(i => ({ type: 'speech', speakerId: i.id })),
          { type: 'hostClosing', speakerId: host.id },
          { type: 'verdict' },
        ];
    // 延迟再进入讨论区，确保加载文案「大师们正在打车」至少显示一会儿
    const showLoadingMinMs = 600;
    goTimeoutRef.current = setTimeout(() => {
      goTimeoutRef.current = null;
      setResult({ hostId: host.id, investors, hostOpening: '', discussion: [], hostClosing: '', verdict: {} });
      setSequence(seq);
      setCurrentBlock({ type: isSolo ? 'speech' : 'hostOpening', speakerId: host.id });
      setLoading(false);
    }, showLoadingMinMs);
  }, [query, selected, allMasters, chatMode]);
  const goRef = useRef(null);
  goRef.current = go;

  // 弹窗：补充公司后带数据继续
  const confirmSupplement = useCallback(() => {
    const add = supplementValue.trim();
    if (!add) return;
    const newQuery = `${add} ${query}`.trim();
    setQuery(newQuery);
    setSupplementOpen(false);
    setNotice('');
    setTimeout(() => goRef.current(), 80); // 等 query 状态更新后再发起
  }, [supplementValue, query]);

  // 弹窗：不带数据继续
  const skipSupplement = useCallback(() => {
    setSupplementOpen(false);
    setNotice('');
    setTimeout(() => goRef.current(true), 80);
  }, []);

  // 弹窗 Escape 关闭（除二维码外统一处理）
  useEffect(() => {
    const open = inviteOpen || historyOpen || supplementOpen || posterOpen || profileMaster;
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (supplementOpen) skipSupplement();
      else if (inviteOpen) closeInvite();
      else if (historyOpen) setHistoryOpen(false);
      else if (posterOpen) setPosterOpen(false);
      else if (profileMaster) setProfileMaster(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inviteOpen, historyOpen, supplementOpen, posterOpen, profileMaster, skipSupplement, closeInvite]);

  const sendFollowUp = useCallback(async () => {
    const msg = followUpInput.trim();
    if (!msg || !result || loadingFollowUp) return;
    const investors = result.investors;
    const prevSummary = result.verdict?.summary || '（无）';
    setError(''); // 清掉旧错误
    // 先乐观地把追问插入到对话中，避免长时间空白
    setRounds(prev => [...prev, { type: 'followUp', userMsg: msg, discussion: [], verdict: {} }]);
    // 让追问这一轮也按首轮那样逐条展示：从新一轮的开头开始 reveal
    setRevealStepLegacy(blocksFromRounds.length);
    setTypingPhase('typing');
    setTypeCharIndex(0);
    setLoadingFollowUp(true);
    try {
      // 追问也可能提到新公司：再做一次信息层梳理并合并快照
      let mergedSnapshot = snapshotRef.current || '';
      try {
        const ctxRes = await fetch('/api/context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: msg }),
        });
        const ctx = await ctxRes.json();
        if (ctx?.snapshot) mergedSnapshot = [mergedSnapshot, ctx.snapshot].filter(Boolean).join('\n');
      } catch (e) { /* 忽略 */ }
      let parsedDiscussion;
      let parsedVerdict = {};
      if (investors.length === 1) {
        // 点对点深聊：直接问答，不输出裁决
        const text = await getResponseText(
          [{ role: 'user', content: buildChatPrompt(msg, investors[0], mode) }],
          query,
          mergedSnapshot,
        );
        parsedDiscussion = [{ investorId: investors[0].id, stance: 'NEUTRAL', content: text, keyPoint: '' }];
      } else {
        const payload = buildFollowUpPrompt(prevSummary, msg, investors, mode);
        const parsed = await doRequest([{ role: 'user', content: payload }], query, mergedSnapshot);
        parsedDiscussion = parsed.discussion || [];
        parsedVerdict = parsed.verdict || {};
      }
      // 将刚才插入的那条 followUp 补全大师发言和裁决；如果没找到，就追加一条
      setRounds(prev => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i -= 1) {
          const r = next[i];
          if (r.type === 'followUp' && r.userMsg === msg && (!r.discussion || r.discussion.length === 0)) {
            next[i] = { ...r, discussion: parsedDiscussion, verdict: parsedVerdict };
            return next;
          }
        }
        return [...prev, { type: 'followUp', userMsg: msg, discussion: parsedDiscussion, verdict: parsedVerdict }];
      });
      setResult(prev => ({
        ...prev,
        discussion: [...(prev.discussion || []), ...parsedDiscussion],
        verdict: parsedVerdict || prev.verdict,
      }));
      setFollowUpInput(''); // 成功后再清空输入
    } catch (e) {
      setError(e.message || '追问失败，请重试');
    }
    setLoadingFollowUp(false);
  }, [followUpInput, result, query, doRequest, loadingFollowUp, getResponseText, mode]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="page-root">
        <header className="header">
          <div className="header-main">
            <h1 className="header-title">{t('title')}</h1>
            <p className="header-desc">{t('subtitle')}</p>
          </div>
        <div className="header-actions">
          <button
            type="button"
            className="icon-btn theme-toggle"
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? '切换亮色' : '切换暗色'}
            aria-label="切换主题"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          <button
            type="button"
            className="icon-btn"
            onClick={() => setHistoryOpen(true)}
            title="历史对话"
            aria-label="历史对话"
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 7 12 12 15 14" />
            </svg>
          </button>

          <button
            type="button"
            className="icon-btn qr-toggle"
            onClick={() => { setQrImgError(false); setQrOpen(v => !v); }}
            title="微信二维码"
            aria-label="打开微信二维码"
            aria-expanded={qrOpen ? 'true' : 'false'}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-5.972 2.932-7.715 1.386-.87 3.052-1.306 4.71-1.306.527 0 1.054.047 1.572.132-.616-3.461-4.11-5.743-8.027-5.743zm-2.23 3.817a1.026 1.026 0 1 1 0 2.053 1.026 1.026 0 0 1 0-2.053zm4.466 0a1.026 1.026 0 1 1 0 2.053 1.026 1.026 0 0 1 0-2.053zM24 14.876c0-3.374-3.178-6.115-7.098-6.115-3.92 0-7.098 2.74-7.098 6.115 0 3.374 3.178 6.115 7.098 6.115.836 0 1.643-.12 2.393-.335a.7.7 0 0 1 .589.08l1.566.916a.268.268 0 0 0 .137.044.243.243 0 0 0 .239-.243c0-.06-.024-.117-.04-.176l-.322-1.218a.485.485 0 0 1 .176-.549C23.076 18.658 24 16.853 24 14.876zm-9.753-1.044a.843.843 0 1 1 0-1.686.843.843 0 0 1 0 1.686zm5.31 0a.843.843 0 1 1 0-1.686.843.843 0 0 1 0 1.686z"/>
            </svg>
          </button>

          {qrOpen && (
            <>
              <div className="qr-backdrop" onClick={() => setQrOpen(false)} />
              <div
                className="qr-popover"
                role="dialog"
                aria-label="二维码"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="qr-title">微信二维码</div>
                {!qrImgError ? (
                  <img
                    className="qr-img"
                    src={qrSrc}
                    alt="我的二维码"
                    onError={() => setQrImgError(true)}
                  />
                ) : (
                  <div className="qr-fallback">
                    <div>未找到二维码图片。</div>
                    <div className="qr-fallback-hint">把二维码放到 `public/my-qr.jpg`，或设置 `NEXT_PUBLIC_QR_CODE_URL`。</div>
                  </div>
                )}
                <a className="qr-open" href={qrSrc} target="_blank" rel="noreferrer">新窗口打开</a>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="bg-master-layer" aria-hidden="true">
        <img src="/bg-debate.png" alt="" />
      </div>

      <div className="main-layout">
        <aside className="sidebar">
          <Card title={t('membersTitle')} accent="var(--accent)">
            {chatMode === 'group' && (
              <div className="sidebar-actions">
                <MiniBtn onClick={() => setSelected(new Set([...allMasters].sort(() => Math.random() - 0.5).slice(0, 5).map(i => i.id)))}><span aria-hidden="true">🎲</span>{t('membersRandom5')}</MiniBtn>
                <MiniBtn onClick={() => setSelected(new Set(allMasters.map(i => i.id)))}><span aria-hidden="true">✓</span>{t('membersSelectAll')}</MiniBtn>
                <MiniBtn onClick={() => setSelected(new Set())}><span aria-hidden="true">✕</span>{t('membersClear')}</MiniBtn>
              </div>
            )}
            <div className="sidebar-count">
              {chatMode === 'solo'
                ? (soloTarget ? `单聊对象：${soloTarget.name}` : '单聊对象：未选择')
                : t('selectedCount', selected.size, allMasters.length)}
            </div>
            <button type="button" className="invite-entry" onClick={openInvite}>
              <span className="ie-icon">✦</span> 邀请一位大师
            </button>
            <div className="master-list">
              {allMasters.map(inv => {
                const on = selected.has(inv.id);
                return (
                  <div
                    key={inv.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggle(inv.id)}
                    onKeyDown={e => e.key === 'Enter' && toggle(inv.id)}
                    className="master-row"
                    style={{
                      borderLeft: on ? `3px solid ${inv.color}` : '3px solid transparent',
                      background: on ? `${inv.color}12` : 'transparent',
                    }}
                  >
                    <MasterAvatar master={inv} size={28} className="master-avatar" />
                    <div className="master-info">
                      <span className="master-name" style={{ color: on ? 'var(--text)' : 'var(--text-muted)' }}>
                        {locale === 'en' && inv.nameEn ? inv.nameEn : inv.name}
                      </span>
                      <span className="master-style">
                        {locale === 'en' && inv.titleEn ? inv.titleEn : (inv.title || inv.style.split('，')[0])}
                      </span>
                    </div>
                    <span className={`master-check${on ? ' on' : ''}`} aria-hidden="true">{on ? '✓' : ''}</span>
                    <button
                      type="button"
                      className="master-more-btn"
                      onClick={(e) => { e.stopPropagation(); setProfileMaster(inv); }}
                      title={locale === 'en' ? 'Profile & actions' : '资料与操作'}
                      aria-label={locale === 'en' ? 'Profile & actions' : '资料与操作'}
                    >
                      ⋯
                    </button>
                  </div>
                );
              })}
            </div>
          </Card>
          <p className="sidebar-hint">{chatMode === 'group' ? t('sidebarHintGroup') : t('sidebarHintSolo')}</p>
        </aside>

        <main className="main">
          <Card title={t('askLabel')} accent="var(--accent)">
            <div className="chat-mode-switch" role="tablist" aria-label="聊天方式">
              <button
                type="button"
                role="tab"
                aria-selected={chatMode === 'group'}
                className={`chat-mode-btn ${chatMode === 'group' ? 'active' : ''}`}
                onClick={() => setChatMode('group')}
              >
                群聊
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={chatMode === 'solo'}
                className={`chat-mode-btn ${chatMode === 'solo' ? 'active' : ''}`}
                onClick={() => setChatMode('solo')}
              >
                单聊
              </button>
            </div>
            {chatMode === 'group' && (
              <div className="group-style">
                <span className="style-label">风格</span>
                <select className="style-select" value={mode} onChange={(e) => setMode(e.target.value)} title="群聊风格">
                  {Object.entries(MODES).map(([k, m]) => (
                    <option key={k} value={k}>{m.label} · {m.hint}</option>
                  ))}
                </select>
              </div>
            )}
            {chatMode === 'solo' && (
              <div className="solo-target">
                {soloTarget ? (
                  <>
                    <MasterAvatar master={soloTarget} size={28} />
                    <span className="solo-target-name">{soloTarget.name}</span>
                    <span className="solo-target-title">{soloTarget.title}</span>
                  </>
                ) : (
                  <span className="solo-target-empty">请从左侧选择 1 位单聊对象</span>
                )}
              </div>
            )}
            <textarea
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('askPlaceholder')}
              className="question-input"
              disabled={loading}
            />
            {error && <div className="error-msg">⚠ {error}</div>}
            {notice && <div className="context-notice">ℹ️ {notice}</div>}
            <div className="question-footer">
              <button type="button" className="btn-submit" onClick={go} disabled={loading}>
                {loading ? `⟳ ${t('summoning')}` : t('btnSummon')}
              </button>
            </div>
          </Card>

          <Card title={t('discussionTitle')} accent="var(--accent)">
            {loading && (
              <div className="loading-state">
                <div className="loading-dots">
                  {[0,1,2,3].map(i => <span key={i} className="dot-anim" style={{ animationDelay: `${i * 0.18}s` }} />)}
                </div>
                <div className="loading-text">{t('loading')}</div>
                <div className="loading-bar"><div className="loading-bar-inner" /></div>
              </div>
            )}

            {!loading && !result && (
              <div className="empty-state">
                <div className="empty-icon">⚖️</div>
                <p>{t('emptyHint')}</p>
              </div>
            )}

            {!loading && result && (
              <div
                className="discussion-container"
                onClick={() => {
                  if (currentBlock && typingPhase === 'content' && typeCharIndex < currentLen) setTypeCharIndex(currentLen);
                }}
              >
                {blocks.slice(0, revealStep).map((block, bi) => {
                  return (
                  <div key={`done-${bi}`} className="reveal-item">
                    {block.type === 'hostOpening' && (
                      <div className="host-block host-opening">
                        <span className="host-label">{t('hostOpening')}</span>
                        <p>{block.text ?? block.content}</p>
                      </div>
                    )}
                    {block.type === 'userMsg' && (
                      <div className="user-followup">
                        <span className="user-label">{t('yourFollowup')}</span>
                        <p>{block.text ?? block.content}</p>
                        {loadingFollowUp && block.roundIndex === rounds.length - 1 && (
                          <div className="followup-hint-inline">{t('followupHint')}</div>
                        )}
                      </div>
                    )}
                    {block.type === 'speech' && (() => {
                      const msg = block.msg ?? block.content;
                      const inv = invMap[msg?.investorId ?? block.speakerId] || result.investors?.[block.index % (result.investors?.length || 1)];
                      if (!inv) return null;
                      const st = STANCES[msg.stance] || STANCES.NEUTRAL;
                      return (
                        <div className="speech-row">
                          <div className="speech-avatar" style={{ background: `${inv.color}14`, borderColor: `${inv.color}45` }}>
                            <MasterAvatar master={inv} size={40} />
                          </div>
                          <div className="speech-body">
                            <div className="speech-meta">
                              <span className="speech-name">{inv.name}</span>
                              <span className="speech-title">{inv.title}</span>
                              <span className="speech-stance" style={{ borderColor: st.border, color: st.color, background: st.bg }}>{st.label}</span>
                            </div>
                            <div className="speech-content">
                              {msg.content}
                              {msg.keyPoint && <div className="speech-key">💡 {msg.keyPoint}</div>}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    {block.type === 'hostClosing' && (
                      <div className="host-block host-closing">
                        <span className="host-label">{t('hostClosing')}</span>
                        <p>{block.text ?? block.content}</p>
                      </div>
                    )}
                    {block.type === 'verdict' && (() => {
                      const v = block.verdict ?? block.content;
                      if (!v) return null;
                      const votes = countVotes(blocks);
                      return (
                        <div className="verdict-block">
                          <div className="verdict-title">{t('verdictTitle')}</div>
                          <p className="verdict-summary">{v.summary}</p>
                          <div className="verdict-bars">
                            <div className="v-bar v-bull" style={{ width: `${Math.round(((votes.bull)/((votes.bull)+(votes.bear)+(votes.neutral)||1))*100)}%` }} />
                            <div className="v-bar v-neutral" style={{ width: `${Math.round(((votes.neutral)/((votes.bull)+(votes.bear)+(votes.neutral)||1))*100)}%` }} />
                            <div className="v-bar v-bear" style={{ width: `${Math.round(((votes.bear)/((votes.bull)+(votes.bear)+(votes.neutral)||1))*100)}%` }} />
                          </div>
                          <div className="verdict-votes">
                            <span className="v-bull">看多 {votes.bull} 票</span>
                            <span className="v-neutral">中性 {votes.neutral} 票</span>
                            <span className="v-bear">看空 {votes.bear} 票</span>
                          </div>
                          {v.consensus && <div className="verdict-consensus">🤝 共识：{v.consensus}</div>}
                          {v.mainRisk && <div className="verdict-risk">⚠️ 风险：{v.mainRisk}</div>}
                        </div>
                      );
                    })()}
                  </div>
                  );
                })}

                {/* 当前条：先「正在输入」再逐字打出 */}
                {currentBlock && (
                  <div key={`current-${revealStep}`} className="reveal-item">
                    {typingPhase === 'typing' && (() => {
                      const inv = currentBlock.speakerId && currentBlock.speakerId !== 'user' ? (invMap[currentBlock.speakerId] || result.investors?.[0]) : null;
                      const name = currentBlock.speakerId === 'user' ? '您' : currentBlock.type === 'verdict' ? '智囊团' : (inv?.name || '主持人');
                      return (
                        <div className="typing-indicator-row">
                          <div className="speech-avatar" style={{ background: inv ? `${inv.color}14` : 'var(--bg-input)', borderColor: inv ? `${inv.color}45` : 'var(--border)' }}>
                            {inv ? <MasterAvatar master={inv} size={40} /> : <span style={{ fontSize: 20 }}>⚖️</span>}
                          </div>
                          <div className="typing-indicator-body">
                            <span className="typing-dots">
                              <span className="typing-dot" />
                              <span className="typing-dot" style={{ animationDelay: '0.2s' }} />
                              <span className="typing-dot" style={{ animationDelay: '0.4s' }} />
                            </span>
                            <span className="typing-text">{name}正在输入</span>
                          </div>
                        </div>
                      );
                    })()}
                    {typingPhase === 'content' && currentBlock.type === 'hostOpening' && (
                      <div className="host-block host-opening">
                        <span className="host-label">{t('hostOpening')}</span>
                        <p>{currentText.slice(0, typeCharIndex)}<span className="caret" /></p>
                      </div>
                    )}
                    {typingPhase === 'content' && currentBlock.type === 'hostClosing' && (
                      <div className="host-block host-closing">
                        <span className="host-label">{t('hostClosing')}</span>
                        <p>{currentText.slice(0, typeCharIndex)}<span className="caret" /></p>
                      </div>
                    )}
                    {typingPhase === 'content' && currentBlock.type === 'userMsg' && (
                      <div className="user-followup">
                        <span className="user-label">{t('yourFollowup')}</span>
                        <p>{currentText.slice(0, typeCharIndex)}<span className="caret" /></p>
                        {loadingFollowUp && (
                          <div className="followup-hint-inline">{t('followupHint')}</div>
                        )}
                      </div>
                    )}
                    {typingPhase === 'content' && currentBlock.type === 'speech' && (() => {
                      const msg = currentBlock.msg ?? currentBlock.content;
                      const inv = invMap[msg?.investorId ?? currentBlock.speakerId] || result.investors?.[currentBlock.index % (result.investors?.length || 1)];
                      if (!inv) return null;
                      const st = STANCES[msg?.stance] || STANCES.NEUTRAL;
                      const done = typeCharIndex >= currentLen;
                      return (
                        <div className="speech-row">
                          <div className="speech-avatar" style={{ background: `${inv.color}14`, borderColor: `${inv.color}45` }}>
                            <MasterAvatar master={inv} size={40} />
                          </div>
                          <div className="speech-body">
                            <div className="speech-meta">
                              <span className="speech-name">{inv.name}</span>
                              <span className="speech-title">{inv.title}</span>
                              <span className="speech-stance" style={{ borderColor: st.border, color: st.color, background: st.bg }}>{st.label}</span>
                            </div>
                            <div className="speech-content">
                              {currentText.slice(0, typeCharIndex)}{!done && <span className="caret" />}
                              {done && msg?.keyPoint && <div className="speech-key">💡 {msg.keyPoint}</div>}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    {typingPhase === 'content' && currentBlock.type === 'verdict' && (() => {
                      const v = currentBlock.verdict ?? currentBlock.content;
                      if (!v) return null;
                      const votes = countVotes(blocks);
                      return (
                        <div className="verdict-block">
                          <div className="verdict-title">{t('verdictTitle')}</div>
                          <p className="verdict-summary">{currentText.slice(0, typeCharIndex)}{typeCharIndex < currentLen && <span className="caret" />}</p>
                          {typeCharIndex >= currentLen && (
                            <>
                              <div className="verdict-bars">
                                <div className="v-bar v-bull" style={{ width: `${Math.round(((votes.bull)/((votes.bull)+(votes.bear)+(votes.neutral)||1))*100)}%` }} />
                                <div className="v-bar v-neutral" style={{ width: `${Math.round(((votes.neutral)/((votes.bull)+(votes.bear)+(votes.neutral)||1))*100)}%` }} />
                                <div className="v-bar v-bear" style={{ width: `${Math.round(((votes.bear)/((votes.bull)+(votes.bear)+(votes.neutral)||1))*100)}%` }} />
                              </div>
                              <div className="verdict-votes">
                                <span className="v-bull">看多 {votes.bull} 票</span>
                                <span className="v-neutral">中性 {votes.neutral} 票</span>
                                <span className="v-bear">看空 {votes.bear} 票</span>
                              </div>
                              {v.consensus && <div className="verdict-consensus">🤝 共识：{v.consensus}</div>}
                              {v.mainRisk && <div className="verdict-risk">⚠️ 风险：{v.mainRisk}</div>}
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                <div className="followup-section">
                  {result && result.discussion && result.discussion.length > 0 && (
                    <div className="poster-toolbar">
                      <button type="button" className="btn-poster" onClick={handlePoster} disabled={posterBusy}>
                        {posterBusy ? t('posterSaving') : t('sharePoster')}
                      </button>
                    </div>
                  )}
                  <label className="followup-label">{t('followupLabel')}</label>
                  <div className="followup-row">
                    <input
                      type="text"
                      value={followUpInput}
                      onChange={e => setFollowUpInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && sendFollowUp()}
                      placeholder={t('followupPlaceholder')}
                      className="followup-input"
                      disabled={loadingFollowUp}
                    />
                    <button type="button" className="btn-followup" onClick={sendFollowUp} disabled={loadingFollowUp || !followUpInput.trim()}>
                      {loadingFollowUp ? t('followupSending') : '发送'}
                    </button>
                  </div>
                  {result && (
                    <div className="debate-reset">
                      <button type="button" className="debate-reset-btn" onClick={resetDebate}>{t('resetDebate')}</button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        </main>
      </div>

      {profileMaster && <MasterProfileModal master={profileMaster} onClose={() => setProfileMaster(null)} locale={locale} onStartChat={startSoloChat} onRemove={removeCustomMaster} />}

      {inviteOpen && (
        <div className="modal-overlay" onClick={closeInvite} role="dialog" aria-modal="true" aria-labelledby="inviteTitle">
          <div className="modal-content invite-modal" onClick={(e) => e.stopPropagation()}>
            <div className="invite-head">
              <h3 className="invite-title" id="inviteTitle">{invitePhase === 'preview' || invitePhase === 'added' ? '大师档案卡' : '邀请一位大师'}</h3>
              <button type="button" className="modal-close" onClick={closeInvite} aria-label="关闭">×</button>
            </div>
            {inviteError && <div className="invite-error">⚠ {inviteError}</div>}

            {invitePhase === 'form' && (
              <>
                <p className="invite-desc">输入你感兴趣的人物（投资大V、游资、企业家…），系统会全网检索他的公开内容与评价，构建一位虚拟大师与现役大师同台竞技。</p>
                <label className="invite-label">人物名字 / 昵称</label>
                <input
                  className="invite-input"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="如：段永平、炒股养家、寒武纪的鳄鱼"
                  onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                  autoFocus
                />
                <label className="invite-label">补充说明（可选）</label>
                <textarea
                  className="invite-input invite-textarea"
                  value={inviteHint}
                  onChange={(e) => setInviteHint(e.target.value)}
                  placeholder="例如：喜欢用简单的话讲道理，强调安全边际"
                />
                <div className="invite-actions">
                  <button type="button" className="invite-btn invite-btn-ghost" onClick={closeInvite}>取消</button>
                  <button type="button" className="invite-btn invite-btn-primary" onClick={handleInvite} disabled={inviteBusy || !inviteName.trim()}>
                    开始构建
                  </button>
                </div>
              </>
            )}

            {invitePhase === 'building' && (
              <div className="invite-steps">
                <div className={`invite-step ${inviteStage === 'search' ? 'active' : 'done'}`}><span className="step-dot" /> ① 检索公开资料与评价</div>
                <div className={`invite-step ${inviteStage === 'research' ? 'active' : (inviteStage === 'build' || inviteStage === 'done' ? 'done' : '')}`}><span className="step-dot" /> ② 提炼观点 / 语录 / 说话风格</div>
                <div className={`invite-step ${inviteStage === 'build' ? 'active' : (inviteStage === 'done' ? 'done' : '')}`}><span className="step-dot" /> ③ 构建大师画像</div>
              </div>
            )}

            {invitePhase === 'preview' && inviteMaster && (
              <div className="persona-card">
                <div className="persona-head">
                  <span className="persona-emoji" style={{ background: `${inviteMaster.color}18` }}>{inviteMaster.emoji}</span>
                  <div>
                    <h3 className="persona-name">{inviteMaster.name}</h3>
                    <p className="persona-title">{inviteMaster.title}</p>
                  </div>
                </div>
                <blockquote className="persona-quote">「{inviteMaster.quote}」</blockquote>
                {inviteMaster.styleSample && (
                  <div className="persona-sec">
                    <h5>风格示范</h5>
                    <p className="persona-style-sample">{inviteMaster.styleSample}</p>
                  </div>
                )}
                {inviteMaster.coreViews && (
                  <div className="persona-sec">
                    <h5>核心观点</h5>
                    <p>{inviteMaster.coreViews}</p>
                  </div>
                )}
                {inviteSources.length > 0 && (
                  <div className="persona-sec">
                    <h5>基于这些公开资料构建</h5>
                    <ul className="persona-sources">
                      {inviteSources.slice(0, 6).map((src, i) => <li key={i}><span className="src-rank">#{i + 1}</span>{src}</li>)}
                    </ul>
                  </div>
                )}
                <div className="persona-actions">
                  <button type="button" className="invite-btn invite-btn-ghost" onClick={handleInvite}>↺ 重新构建</button>
                  <button type="button" className="invite-btn invite-btn-primary" onClick={confirmInvite}>确认加入</button>
                </div>
              </div>
            )}

            {invitePhase === 'added' && inviteMaster && (
              <div style={{ textAlign: 'center', padding: '20px 0 8px' }}>
                <div style={{ fontSize: 44 }}>{inviteMaster.emoji}</div>
                <h3 className="persona-name" style={{ marginTop: 8 }}>{inviteMaster.name} 已加入智囊团</h3>
                <p className="invite-desc" style={{ marginTop: 8 }}>可以在左侧勾选 TA 参与辩论，或先一对一聊聊。</p>
                <div className="persona-actions" style={{ marginTop: 18 }}>
                  <button type="button" className="invite-btn invite-btn-primary" onClick={() => { closeInvite(); startSoloChat(inviteMaster); }}>💬 和 TA 单聊</button>
                  <button type="button" className="invite-btn invite-btn-ghost" onClick={closeInvite}>完成</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {supplementOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="supplementTitle">
          <div className="modal-content invite-modal" onClick={(e) => e.stopPropagation()}>
            <div className="invite-head">
              <h3 className="invite-title" id="supplementTitle">需要补充公司信息</h3>
              <button type="button" className="modal-close" onClick={skipSupplement} aria-label="关闭">×</button>
            </div>
            <p className="invite-desc">这个问题可能需要某只具体公司的行情或财务数据，大师们才能引用最新数据。请补充公司名称或代码：</p>
            <input
              className="invite-input"
              value={supplementValue}
              onChange={(e) => setSupplementValue(e.target.value)}
              placeholder="如：贵州茅台 / 600519 / NVDA"
              onKeyDown={(e) => e.key === 'Enter' && confirmSupplement()}
              autoFocus
            />
            <div className="invite-actions">
              <button type="button" className="invite-btn invite-btn-ghost" onClick={skipSupplement}>不带数据继续</button>
              <button type="button" className="invite-btn invite-btn-primary" onClick={confirmSupplement} disabled={!supplementValue.trim()}>补充并继续</button>
            </div>
          </div>
        </div>
      )}

      {historyOpen && (
        <div className="modal-overlay" onClick={() => setHistoryOpen(false)} role="dialog" aria-modal="true" aria-labelledby="historyTitle">
          <div className="modal-content history-modal" onClick={(e) => e.stopPropagation()}>
            <div className="invite-head">
              <h3 className="invite-title" id="historyTitle">历史对话</h3>
              <button type="button" className="modal-close" onClick={() => setHistoryOpen(false)} aria-label="关闭">×</button>
            </div>
            {historyList.length === 0 ? (
              <p className="history-empty">还没有历史记录，去发起一场辩论吧。</p>
            ) : (
              <div className="history-list">
                {historyList.map((h) => (
                  <button key={h.id} type="button" className="history-item" onClick={() => restoreHistory(h)}>
                    <div className="history-q">{h.query || '（无问题）'}</div>
                    <div className="history-meta">{new Date(h.ts).toLocaleString('zh-CN')} · {h.selected?.length || 0} 位大师</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {posterOpen && (
        <div className="modal-overlay" onClick={() => setPosterOpen(false)} role="dialog" aria-modal="true" aria-label="分享海报">
          <div className="modal-content poster-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setPosterOpen(false)} aria-label="关闭">×</button>
            {posterUrl && <img src={posterUrl} alt={t('sharePoster')} className="poster-img" />}
            <div className="poster-actions">
              <a href={posterUrl} download="大师吵股-辩论海报.png" className="poster-btn poster-btn-save">{t('posterSave')}</a>
              <button type="button" className="poster-btn poster-btn-close" onClick={() => setPosterOpen(false)}>{t('posterClose')}</button>
            </div>
          </div>
        </div>
      )}

      
      </div>
    </>
  );
}
