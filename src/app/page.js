'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { PRESET_MASTERS } from '../data/masters';
import { messages } from '../i18n/messages';
import { Card, MasterAvatar, MiniBtn } from '../components/ui';
import MasterProfileModal from '../components/MasterProfileModal';
import {
  TYPING_INDICATOR_MS,
  TYPEWRITER_DELAY_MS,
  AFTER_TYPE_PAUSE_MS,
  STANCES,
  buildFollowUpPrompt,
  buildOpeningOnlyPrompt,
  buildOneSpeechPrompt,
  buildClosingOnlyPrompt,
  buildVerdictOnlyPrompt,
} from '../lib/prompts';
import { generatePoster } from '../lib/poster';
import './page.css';

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

  const [theme, setTheme] = useState('light'); // SSR 与首帧一致，挂载后 effect 再读 localStorage
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

  const allMasters = PRESET_MASTERS;

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
  }, [theme]);

  // ─── 讨论持久化（#6）：刷新/重开页面可恢复最近一场 ───
  const STORAGE_KEY = 'master-debate-state-v1';

  // 恢复上次讨论（仅首次挂载）：URL 指定大师 > 本地历史 > 随机 5 位
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let selectedSet = null;

    try {
      const params = new URLSearchParams(window.location.search);
      const ids = (params.get('masters') || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length) {
        const valid = new Set(ids.filter((id) => allMasters.some((m) => m.id === id)));
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
      const shuffled = [...allMasters].sort(() => Math.random() - 0.5);
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

  // 分享海报（#10）
  const handlePoster = useCallback(async () => {
    if (!result || posterBusy) return;
    setPosterBusy(true);
    setError('');
    try {
      const canvas = await generatePoster({
        question: query,
        hostId: result.hostId,
        masters: result.investors || allMasters.filter((m) => selected.has(m.id)),
        hostOpening: result.hostOpening,
        discussion: result.discussion,
        hostClosing: result.hostClosing,
        verdict: result.verdict || {},
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

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

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
          const prompt = buildOpeningOnlyPrompt(query, host, investors);
          const text = await getResponseText([{ role: 'user', content: prompt }], query, snapshotRef.current);
          setCurrentBlock(b => b ? { ...b, content: text.replace(/^["']|["']$/g, '') } : b);
        } else if (step.type === 'speech') {
          const previousParts = completedBlocks.map(b => {
            if (b.type === 'hostOpening') return { type: 'hostOpening', text: b.content };
            if (b.type === 'speech') return { type: 'speech', investorId: b.speakerId, content: b.content?.content };
            return null;
          }).filter(Boolean);
          const prompt = buildOneSpeechPrompt(query, investors, previousParts, step.speakerId);
          const text = await getResponseText([{ role: 'user', content: prompt }], query, snapshotRef.current);
          const match = text.match(/\{[\s\S]*\}/);
          const parsed = match ? JSON.parse(match[0]) : { investorId: step.speakerId, stance: 'NEUTRAL', content: text, keyPoint: '' };
          setCurrentBlock(c => c ? { ...c, content: parsed } : c);
        } else if (step.type === 'hostClosing') {
          const opening = completedBlocks.find(b => b.type === 'hostOpening')?.content || '';
          const discussionSummary = completedBlocks.filter(b => b.type === 'speech').map(b => `${invMapLocal[b.speakerId]?.name}: ${b.content?.content?.slice(0, 50)}...`).join('；');
          const prompt = buildClosingOnlyPrompt(query, host?.name || '主持人', opening, discussionSummary);
          const text = await getResponseText([{ role: 'user', content: prompt }], query, snapshotRef.current);
          setCurrentBlock(b => b ? { ...b, content: text.replace(/^["']|["']$/g, '') } : b);
        } else if (step.type === 'verdict') {
          const opening = completedBlocks.find(b => b.type === 'hostOpening')?.content || '';
          const closing = completedBlocks.find(b => b.type === 'hostClosing')?.content || '';
          const discussionText = completedBlocks.filter(b => b.type === 'speech').map(b => b.content?.content).join('\n');
          const prompt = buildVerdictOnlyPrompt(query, opening, discussionText, closing);
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
  }, [useStreamingMode, stepIndex, sequence, currentBlock, result, query, completedBlocks, getResponseText]);

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

  const go = useCallback(async () => {
    if (!query.trim()) { setError(t('summonErrorNoQuestion')); return; }
    if (selected.size === 0) { setError(t('summonErrorNoMaster')); return; }

    setError('');
    setNotice('');
    snapshotRef.current = '';
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
      setNotice(ctx?.notice || '');
    } catch (e) {
      snapshotRef.current = '';
    }

    const investors = allMasters.filter(i => selected.has(i.id));
    const host = investors[Math.floor(Math.random() * investors.length)];
    const speechOrder = [...investors].sort(() => Math.random() - 0.5);
    const seq = [
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
      setCurrentBlock({ type: 'hostOpening', speakerId: host.id });
      setLoading(false);
    }, showLoadingMinMs);
  }, [query, selected, allMasters]);

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
      const payload = buildFollowUpPrompt(prevSummary, msg, investors);
      const parsed = await doRequest([{ role: 'user', content: payload }], query, mergedSnapshot);
      const parsedDiscussion = parsed.discussion || [];
      const parsedVerdict = parsed.verdict || {};
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
  }, [followUpInput, result, query, doRequest, loadingFollowUp]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="page-root">
        <header className="header">
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
        <h1 className="header-title">{t('title')}</h1>
        <p className="header-desc">{t('subtitle')}</p>
      </header>

      <div className="main-layout">
        <aside className="sidebar">
          <Card title={t('membersTitle')} accent="var(--accent)">
            <div className="sidebar-actions">
              <MiniBtn onClick={() => setSelected(new Set(allMasters.map(i => i.id)))}>{t('membersSelectAll')}</MiniBtn>
              <MiniBtn onClick={() => setSelected(new Set())}>{t('membersClear')}</MiniBtn>
              <MiniBtn onClick={() => setSelected(new Set([...allMasters].sort(() => Math.random() - 0.5).slice(0, 5).map(i => i.id)))}>{t('membersRandom5')}</MiniBtn>
            </div>
            <div className="sidebar-count">{t('selectedCount', selected.size, allMasters.length)}</div>
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
                      borderColor: on ? `${inv.color}55` : 'transparent',
                      background: on ? `${inv.color}0b` : 'transparent',
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
                    {on && <span className="master-check" style={{ color: inv.color }}>✓</span>}
                    <button
                      type="button"
                      className="master-profile-btn"
                      onClick={e => { e.stopPropagation(); setProfileMaster(inv); }}
                      title={locale === 'en' ? 'View profile' : '查看资料'}
                      aria-label={locale === 'en' ? 'View profile' : '查看资料'}
                    >
                      📋
                    </button>
                  </div>
                );
              })}
            </div>
          </Card>
          <p className="sidebar-hint">{t('sidebarHint')}</p>
        </aside>

        <main className="main">
          <Card title={t('askLabel')} accent="var(--bull)">
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
              <span>{t('selectedCount', selected.size, allMasters.length)}</span>
              <button type="button" className="btn-submit" onClick={go} disabled={loading}>
                {loading ? `⟳ ${t('loading')}` : t('btnSummon')}
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
              <div className="discussion-container">
                {blocks.slice(0, revealStep).map((block, bi) => (
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
                            <div className="speech-content" style={{ borderLeftColor: st.border }}>
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
                      return (
                        <div className="verdict-block">
                          <div className="verdict-title">{t('verdictTitle')}</div>
                          <p className="verdict-summary">{v.summary}</p>
                          <div className="verdict-bars">
                            <div className="v-bar v-bull" style={{ width: `${Math.round(((v.bullCount||0)/((v.bullCount||0)+(v.bearCount||0)+(v.neutralCount||0)||1))*100)}%` }} />
                            <div className="v-bar v-neutral" style={{ width: `${Math.round(((v.neutralCount||0)/((v.bullCount||0)+(v.bearCount||0)+(v.neutralCount||0)||1))*100)}%` }} />
                            <div className="v-bar v-bear" style={{ width: `${Math.round(((v.bearCount||0)/((v.bullCount||0)+(v.bearCount||0)+(v.neutralCount||0)||1))*100)}%` }} />
                          </div>
                          <div className="verdict-votes">
                            <span className="v-bull">看多 {v.bullCount || 0} 票</span>
                            <span className="v-neutral">中性 {v.neutralCount || 0} 票</span>
                            <span className="v-bear">看空 {v.bearCount || 0} 票</span>
                          </div>
                          {v.consensus && <div className="verdict-consensus">🤝 共识：{v.consensus}</div>}
                          {v.mainRisk && <div className="verdict-risk">⚠️ 风险：{v.mainRisk}</div>}
                        </div>
                      );
                    })()}
                  </div>
                ))}

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
                            <div className="speech-content" style={{ borderLeftColor: st.border }}>
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
                      return (
                        <div className="verdict-block">
                          <div className="verdict-title">{t('verdictTitle')}</div>
                          <p className="verdict-summary">{currentText.slice(0, typeCharIndex)}{typeCharIndex < currentLen && <span className="caret" />}</p>
                          {typeCharIndex >= currentLen && (
                            <>
                              <div className="verdict-bars">
                                <div className="v-bar v-bull" style={{ width: `${Math.round(((v.bullCount||0)/((v.bullCount||0)+(v.bearCount||0)+(v.neutralCount||0)||1))*100)}%` }} />
                                <div className="v-bar v-neutral" style={{ width: `${Math.round(((v.neutralCount||0)/((v.bullCount||0)+(v.bearCount||0)+(v.neutralCount||0)||1))*100)}%` }} />
                                <div className="v-bar v-bear" style={{ width: `${Math.round(((v.bearCount||0)/((v.bullCount||0)+(v.bearCount||0)+(v.neutralCount||0)||1))*100)}%` }} />
                              </div>
                              <div className="verdict-votes">
                                <span className="v-bull">看多 {v.bullCount || 0} 票</span>
                                <span className="v-neutral">中性 {v.neutralCount || 0} 票</span>
                                <span className="v-bear">看空 {v.bearCount || 0} 票</span>
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

      {profileMaster && <MasterProfileModal master={profileMaster} onClose={() => setProfileMaster(null)} locale={locale} />}

      {posterOpen && (
        <div className="modal-overlay" onClick={() => setPosterOpen(false)} role="dialog" aria-modal="true">
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
