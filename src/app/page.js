'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';

// 打字相关节奏（进一步提速）
const TYPING_INDICATOR_MS = 100;   // 「正在输入」显示时长（更快）
const TYPEWRITER_DELAY_MS = 16;    // 打字机每字间隔（毫秒）
const AFTER_TYPE_PAUSE_MS = 120;   // 打完字后停顿再出下一条
const LOADING_MESSAGE = '稍等一下，大师们正在打车，马上到'; // 提交问题后的加载文案（唯一来源）
import { PRESET_MASTERS } from '../data/masters';

const STANCES = {
  BULL:    { label: '看多 ▲', color: 'var(--bull)', bg: 'rgba(76,175,125,0.12)', border: 'var(--bull)' },
  BEAR:    { label: '看空 ▼', color: 'var(--bear)', bg: 'rgba(224,85,85,0.12)', border: 'var(--bear)' },
  NEUTRAL: { label: '中性 —', color: 'var(--neutral)', bg: 'rgba(201,168,76,0.12)', border: 'var(--neutral)' },
};

// ─── Prompt 构建（含随机主持、开场/散场）────────────────────────────────────────
function buildPrompt(question, investors, hostId) {
  const list = investors.map(i =>
    `ID:${i.id} | ${i.name} | 称号:${i.title} | 风格:${i.style} | 性格:${i.personality} | 金句:"${i.quote}"${i.biography ? ` | 经历:${i.biography}` : ''}${i.classicTheory ? ` | 经典理论:${i.classicTheory}` : ''}`
  ).join('\n');

  return `你是「大师吵股」辩论会模拟器，强调 **真实互怼、火药味十足**。本次由 **${hostId}** 担任主持人（开场与散场），其余大师就用户问题展开 **针锋相对的辩论**。

大师列表（含主持人）：
${list}

用户问题：${question}

要求：
1. 主持人先发表 **开场白**（80–120 字），风趣、幽默、毒舌，可点名挑事、预言待会要吵起来。
2. 讨论环节必须 **你说一句我顶一句**：后发言的大师要 **直接反驳、引用前一位的原话再批驳**，用「你刚才说……恰恰相反」「恕我直言，某某的逻辑站不住脚」「我不同意」等句式，形成 **互相 PK、有争吵感** 的对话。立场对立的大师之间要有明显冲突和讽刺，可适度调侃对方流派。
3. **发言要有数据支撑**：每位大师在表达观点时，尽量用 **具体数据、估值指标（如 PE/PB/ROE、增速）、历史案例、可比公司或行业数据** 等举证，避免只讲空泛观点。例如提到估值时可给区间或倍数，提到增长可给百分比，反驳时也可用数据指出对方论据的漏洞。
4. **时间要求（很重要）**：如需引用“财务/行业/宏观/公司经营”等数据，**优先引用 2025 年（或最近 12 个月 / 最新年报季报）**的口径与区间；避免引用 2020 年前后那类过时年份的精确数字。若无法确定最新数值，只能给出区间并明确写“可能过时/不确定”，不要装作精确。
5. 每位大师 120–180 字，每人明确立场：BULL / BEAR / NEUTRAL。
6. 已故大师用「我一贯认为」「我的原则是」等措辞，但同样可以怼人。
7. 主持人 **散场总结**（80–120 字），风趣毒舌，可总结谁和谁吵得最凶、投票结果。
8. 最后智囊团裁决（投票统计、共识、风险）。

只输出一个 JSON，不要任何其他内容或 markdown 代码块：
{"hostId":"${hostId}","hostOpening":"主持人开场白","discussion":[{"investorId":"id","stance":"BULL或BEAR或NEUTRAL","content":"发言内容","keyPoint":"核心观点一句话"}],"hostClosing":"主持人散场总结","verdict":{"summary":"综合总结约150字","bullCount":数字,"bearCount":数字,"neutralCount":数字,"consensus":"核心共识一句话","mainRisk":"主要风险一句话"}}`;
}

function buildFollowUpPrompt(previousSummary, userFollowUp, investors) {
  const list = investors.map(i =>
    `ID:${i.id} | ${i.name} | 风格:${i.style} | 性格:${i.personality} | 语录:"${i.quote}"`
  ).join('\n');

  return `继续「大师吵股」同一场讨论，保持 **互怼、PK、争吵感**。此前结论摘要：${previousSummary}

用户追问：${userFollowUp}

参与大师（同一批人）：
${list}

请让各位大师针对追问 **轮流发言、互相反驳**（每人 60–100 字），后发言的要引用或直接批驳前面的观点，有火药味。发言时尽量用 **数据、估值指标、历史或可比案例** 举证支撑观点，避免只讲空泛看法。最后更新裁决。
时间要求：如需引用数据，优先引用 **2025 年（或最近 12 个月 / 最新财报）**口径；不确定就写区间并标注可能过时，避免引用更早年份的精确数字。

只输出一个 JSON：
{"discussion":[{"investorId":"id","stance":"BULL或BEAR或NEUTRAL","content":"发言内容","keyPoint":"一句话"}],"verdict":{"summary":"更新后的综合总结","bullCount":数字,"bearCount":数字,"neutralCount":数字,"consensus":"共识","mainRisk":"风险"}}`;
}

// ─── 逐条请求用 prompt（一条一条要，不预加载）────────────────────────────────────
function buildOpeningOnlyPrompt(question, host, investors) {
  const list = investors.map(i => `ID:${i.id} | ${i.name} | 风格:${i.style} | 性格:${i.personality} | 语录:"${i.quote}"`).join('\n');
  return `你是「大师吵股」主持人。用户问题：${question}。参与大师：${list}。主持人：${host.name}。请只输出主持人的开场白（80-120字），风趣幽默毒舌，可点名挑事。不要输出任何其他内容、不要 JSON、不要引号，直接输出开场白文本。`;
}

function buildOneSpeechPrompt(question, investors, previousParts, nextSpeakerId) {
  const list = investors.map(i => `ID:${i.id} | ${i.name} | 风格:${i.style} | 性格:${i.personality} | 语录:"${i.quote}"`).join('\n');
  const context = previousParts.map(p => p.type === 'hostOpening' ? `开场白：${p.text}` : p.type === 'speech' ? `${p.investorId}说：${p.content}` : '').filter(Boolean).join('\n');
  return `大师吵股。用户问题：${question}。参与大师：${list}。此前内容：${context}。请让 ID 为 ${nextSpeakerId} 的大师作为下一位发言，要直接反驳或回应前面观点，有争吵感。**发言必须有数据支撑**：用具体数据、估值指标（如 PE/PB/ROE、增速）、历史案例或可比公司等举证，避免只讲空泛观点。**时间要求**：如需引用数据，优先引用 2025 年（或最近12个月/最新财报）口径；不确定就给区间并标注可能过时，不要引用更早年份的精确数字。只输出一个 JSON，不要其他内容：{"investorId":"${nextSpeakerId}","stance":"BULL或BEAR或NEUTRAL","content":"发言内容120-180字，含数据或案例举证（尽量用2025口径）","keyPoint":"核心观点一句话"}`;
}

function buildClosingOnlyPrompt(question, hostName, opening, discussionSummary) {
  return `大师吵股。用户问题：${question}。主持人开场白：${opening}。讨论摘要：${discussionSummary}。请主持人（${hostName}）输出散场总结（80-120字），风趣毒舌。不要 JSON 不要引号，直接输出散场总结文本。`;
}

function buildVerdictOnlyPrompt(question, opening, discussionText, closing) {
  return `大师吵股。用户问题：${question}。开场白：${opening}。讨论：${discussionText}。散场：${closing}。请只输出智囊团裁决的一个 JSON，不要其他内容：{"summary":"综合总结约150字","bullCount":数字,"bearCount":数字,"neutralCount":数字,"consensus":"核心共识一句话","mainRisk":"主要风险一句话"}`;
}

// ─── 子组件 ────────────────────────────────────────────────────────────────
function Card({ title, accent, children }) {
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

function MasterAvatar({ master, size = 44, className = '' }) {
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
  return (
    <span className={className} style={{ width: size, height: size, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.45, flexShrink: 0, ...wrapperStyle }}>
      {master.emoji}
    </span>
  );
}

function MiniBtn({ children, onClick }) {
  const [h, setH] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      className="mini-btn"
      style={{
        background: h ? 'var(--accent-bg)' : 'transparent',
        borderColor: h ? 'var(--accent)' : 'var(--border-subtle)',
        color: h ? 'var(--accent)' : 'var(--text-muted)',
      }}
    >
      {children}
    </button>
  );
}

function MasterProfileModal({ master, onClose }) {
  if (!master) return null;
  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-content profile-modal" onClick={e => e.stopPropagation()} style={{ borderColor: master.color }}>
        <div className="profile-header" style={{ borderColor: master.color }}>
          <MasterAvatar master={master} size={56} className="profile-avatar" />
          <div>
            <h2 className="profile-name">{master.name}</h2>
            <p className="profile-title">{master.title}</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="profile-body">
          <section>
            <h4>投资风格与特点</h4>
            <p>{master.style}</p>
          </section>
          <section>
            <h4>性格与发言风格</h4>
            <p>{master.personality}</p>
          </section>
          <section>
            <h4>经典理论</h4>
            <p>{master.classicTheory || master.style}</p>
          </section>
          <section>
            <h4>经历简介</h4>
            <p>{master.biography || '—'}</p>
          </section>
          <blockquote className="profile-quote" style={{ borderLeftColor: master.color }}>
            「{master.quote}」
          </blockquote>
        </div>
      </div>
    </div>
  );
}

// ─── 主组件 ────────────────────────────────────────────────────────────────
export default function Home() {
  const [theme, setTheme] = useState('light');
  // 默认随机选 5 位大师
  const [selected, setSelected] = useState(() => {
    const shuffled = [...PRESET_MASTERS].sort(() => Math.random() - 0.5);
    return new Set(shuffled.slice(0, 5).map(i => i.id));
  });
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [profileMaster, setProfileMaster] = useState(null);
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
    const stored = typeof window !== 'undefined' && localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') setTheme(stored);
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', theme);
    if (typeof window !== 'undefined') localStorage.setItem('theme', theme);
  }, [theme]);

  // 预加载模式（追问）：当前条与打字长度（按 revealStepLegacy 推进）
  const currentBlockFromRounds =
    result && !useStreamingMode && blocksFromRounds.length > 0 && revealStepLegacy < blocksFromRounds.length
      ? blocksFromRounds[revealStepLegacy]
      : null;
  const currentTextRounds = currentBlockFromRounds?.textToType ?? '';
  const currentLenRounds = currentTextRounds.length;
  const currentText = (useStreamingMode ? currentTextStreaming : currentTextRounds) ?? '';
  const currentLen = (useStreamingMode ? currentLenStreaming : currentLenRounds) ?? 0;
  const revealStepRounds = useStreamingMode ? -1 : revealStep;

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

  const getResponseText = useCallback(async (messages, userQuery) => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, query: userQuery || undefined }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e?.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    return (data.content || []).map(c => c.text || '').join('').trim();
  }, []);

  const doRequest = useCallback(async (messages, userQuery) => {
    const text = await getResponseText(messages, userQuery);
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
          const text = await getResponseText([{ role: 'user', content: prompt }], query);
          setCurrentBlock(b => b ? { ...b, content: text.replace(/^["']|["']$/g, '') } : b);
        } else if (step.type === 'speech') {
          const previousParts = completedBlocks.map(b => {
            if (b.type === 'hostOpening') return { type: 'hostOpening', text: b.content };
            if (b.type === 'speech') return { type: 'speech', investorId: b.speakerId, content: b.content?.content };
            return null;
          }).filter(Boolean);
          const prompt = buildOneSpeechPrompt(query, investors, previousParts, step.speakerId);
          const text = await getResponseText([{ role: 'user', content: prompt }], query);
          const match = text.match(/\{[\s\S]*\}/);
          const parsed = match ? JSON.parse(match[0]) : { investorId: step.speakerId, stance: 'NEUTRAL', content: text, keyPoint: '' };
          setCurrentBlock(c => c ? { ...c, content: parsed } : c);
        } else if (step.type === 'hostClosing') {
          const opening = completedBlocks.find(b => b.type === 'hostOpening')?.content || '';
          const discussionSummary = completedBlocks.filter(b => b.type === 'speech').map(b => `${invMapLocal[b.speakerId]?.name}: ${b.content?.content?.slice(0, 50)}...`).join('；');
          const prompt = buildClosingOnlyPrompt(query, host?.name || '主持人', opening, discussionSummary);
          const text = await getResponseText([{ role: 'user', content: prompt }], query);
          setCurrentBlock(b => b ? { ...b, content: text.replace(/^["']|["']$/g, '') } : b);
        } else if (step.type === 'verdict') {
          const opening = completedBlocks.find(b => b.type === 'hostOpening')?.content || '';
          const closing = completedBlocks.find(b => b.type === 'hostClosing')?.content || '';
          const discussionText = completedBlocks.filter(b => b.type === 'speech').map(b => b.content?.content).join('\n');
          const prompt = buildVerdictOnlyPrompt(query, opening, discussionText, closing);
          const text = await getResponseText([{ role: 'user', content: prompt }], query);
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
    if (!query.trim()) { setError('请输入问题'); return; }
    if (selected.size === 0) { setError('请至少选择一位大师'); return; }

    setError('');
    if (goTimeoutRef.current) clearTimeout(goTimeoutRef.current);
    setLoading(true); // 先显示加载态，让用户看到「大师们正在打车」文案
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
    // 先乐观地把「您的追问」插入到对话中，避免长时间空白
    setRounds(prev => [...prev, { type: 'followUp', userMsg: msg, discussion: [], verdict: {} }]);
    // 让追问这一轮也按首轮那样逐条展示：从新一轮的开头开始 reveal
    setRevealStepLegacy(blocksFromRounds.length);
    setTypingPhase('typing');
    setTypeCharIndex(0);
    setLoadingFollowUp(true);
    try {
      const payload = buildFollowUpPrompt(prevSummary, msg, investors);
      const parsed = await doRequest([{ role: 'user', content: payload }], query);
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
    <div className="page-root">
      <header className="header">
        <button
          type="button"
          className="theme-toggle"
          onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? '切换亮色' : '切换暗色'}
          aria-label="切换主题"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <h1 className="header-title">大师吵股</h1>
        <p className="header-desc">汇聚古今投资大师 · 多元视角助力决策</p>
      </header>

      <div className="main-layout">
        <aside className="sidebar">
          <Card title="选择成员" accent="var(--accent)">
            <div className="sidebar-actions">
              <MiniBtn onClick={() => setSelected(new Set(allMasters.map(i => i.id)))}>全选</MiniBtn>
              <MiniBtn onClick={() => setSelected(new Set())}>清空</MiniBtn>
              <MiniBtn onClick={() => setSelected(new Set([...allMasters].sort(() => Math.random() - 0.5).slice(0, 5).map(i => i.id)))}>随机5人</MiniBtn>
            </div>
            <div className="sidebar-count">已选 {selected.size} / {allMasters.length}</div>
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
                      <span className="master-name" style={{ color: on ? 'var(--text)' : 'var(--text-muted)' }}>{inv.name}</span>
                      <span className="master-style">{inv.style.split('，')[0]}</span>
                    </div>
                    {on && <span className="master-check" style={{ color: inv.color }}>✓</span>}
                    <button
                      type="button"
                      className="master-profile-btn"
                      onClick={e => { e.stopPropagation(); setProfileMaster(inv); }}
                      title="查看资料"
                      aria-label="查看资料"
                    >
                      📋
                    </button>
                  </div>
                );
              })}
            </div>
          </Card>
          <p className="sidebar-hint">头像置灰为已故 · 仅供参考，不构成投资建议</p>
        </aside>

        <main className="main">
          <Card title="您的投资问题" accent="var(--bull)">
            <textarea
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="例如：英伟达（NVDA）的 AI 护城河有多深，值得长期持有吗？&#10;&#10;或：苹果（AAPL）在当前估值下还值得持有吗？"
              className="question-input"
              disabled={loading}
            />
            {error && <div className="error-msg">⚠ {error}</div>}
            <div className="question-footer">
              <span>{selected.size} 位大师参与讨论</span>
              <button type="button" className="btn-submit" onClick={go} disabled={loading}>
                {loading ? `⟳ ${LOADING_MESSAGE}` : '召集智囊团 →'}
              </button>
            </div>
          </Card>

          <Card title="智囊团讨论" accent="var(--accent)">
            {loading && (
              <div className="loading-state">
                <div className="loading-dots">
                  {[0,1,2,3].map(i => <span key={i} className="dot-anim" style={{ animationDelay: `${i * 0.18}s` }} />)}
                </div>
                <div className="loading-text">{LOADING_MESSAGE}</div>
                <div className="loading-bar"><div className="loading-bar-inner" /></div>
              </div>
            )}

            {!loading && !result && (
              <div className="empty-state">
                <div className="empty-icon">⚖️</div>
                <p>选择成员，输入问题，让顶级思维为您碰撞</p>
              </div>
            )}

            {!loading && result && (
              <div className="discussion-container">
                {blocks.slice(0, revealStep).map((block, bi) => (
                  <div key={`done-${bi}`} className="reveal-item">
                    {block.type === 'hostOpening' && (
                      <div className="host-block host-opening">
                        <span className="host-label">主持人开场</span>
                        <p>{block.text ?? block.content}</p>
                      </div>
                    )}
                    {block.type === 'userMsg' && (
                      <div className="user-followup">
                        <span className="user-label">您的追问</span>
                        <p>{block.text ?? block.content}</p>
                        {loadingFollowUp && block.roundIndex === rounds.length - 1 && (
                          <div className="followup-hint-inline">大师们正在就你的追问激烈讨论中，请稍候…</div>
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
                        <span className="host-label">主持人散场</span>
                        <p>{block.text ?? block.content}</p>
                      </div>
                    )}
                    {block.type === 'verdict' && (() => {
                      const v = block.verdict ?? block.content;
                      if (!v) return null;
                      return (
                        <div className="verdict-block">
                          <div className="verdict-title">⚖️ 智囊团综合裁决</div>
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
                        <span className="host-label">主持人开场</span>
                        <p>{currentText.slice(0, typeCharIndex)}<span className="caret" /></p>
                      </div>
                    )}
                    {typingPhase === 'content' && currentBlock.type === 'hostClosing' && (
                      <div className="host-block host-closing">
                        <span className="host-label">主持人散场</span>
                        <p>{currentText.slice(0, typeCharIndex)}<span className="caret" /></p>
                      </div>
                    )}
                    {typingPhase === 'content' && currentBlock.type === 'userMsg' && (
                      <div className="user-followup">
                        <span className="user-label">您的追问</span>
                        <p>{currentText.slice(0, typeCharIndex)}<span className="caret" /></p>
                        {loadingFollowUp && (
                          <div className="followup-hint-inline">大师们正在就你的追问激烈讨论中，请稍候…</div>
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
                          <div className="verdict-title">⚖️ 智囊团综合裁决</div>
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
                  <label className="followup-label">参与互动：追问或补充</label>
                  <div className="followup-row">
                    <input
                      type="text"
                      value={followUpInput}
                      onChange={e => setFollowUpInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && sendFollowUp()}
                      placeholder="输入追问，让大师们继续讨论…"
                      className="followup-input"
                      disabled={loadingFollowUp}
                    />
                    <button type="button" className="btn-followup" onClick={sendFollowUp} disabled={loadingFollowUp || !followUpInput.trim()}>
                      {loadingFollowUp ? '思考中…' : '发送'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </main>
      </div>

      {profileMaster && <MasterProfileModal master={profileMaster} onClose={() => setProfileMaster(null)} />}

      <style jsx>{`
        .page-root { position: relative; min-height: 100vh; padding-bottom: 2rem; }
        .header { text-align: center; padding: 32px 20px 24px; border-bottom: 1px solid var(--border); position: relative; }
        .header-title { font-size: clamp(26px, 5vw, 44px); font-weight: 800; color: var(--accent); letter-spacing: 0.02em; line-height: 1.2; margin: 0; }
        .header-desc { color: var(--text-muted); font-size: 12px; margin-top: 10px; letter-spacing: 0.12em; font-family: var(--font-mono); }
        .theme-toggle { position: absolute; top: 16px; right: 16px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background: var(--bg-card); border: 1px solid var(--border); color: var(--text-muted); font-size: 16px; cursor: pointer; border-radius: 50%; transition: color 0.2s, border-color 0.2s; }
        .theme-toggle:hover { color: var(--accent); border-color: var(--accent-dim); }
        .main-layout { max-width: 1300px; margin: 0 auto; padding: 16px 14px; display: grid; grid-template-columns: 280px 1fr; gap: 16px; position: relative; }
        .sidebar { display: flex; flex-direction: column; gap: 10px; position: sticky; top: 14px; align-self: start; max-height: calc(100vh - 120px); overflow-y: auto; }
        .sidebar-actions { display: flex; gap: 4px; margin-bottom: 8px; }
        .sidebar-count { font-family: var(--font-mono); font-size: 9.5px; color: var(--accent); margin-bottom: 6px; }
        .master-list { display: flex; flex-direction: column; gap: 3px; }
        .master-row { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border: 1px solid transparent; cursor: pointer; transition: all 0.12s; border-radius: 3px; }
        .master-avatar { flex-shrink: 0; }
        .master-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
        .master-name { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .master-style { font-size: 9px; color: var(--text-muted); font-family: var(--font-mono); }
        .master-check { font-size: 9px; font-family: var(--font-mono); }
        .master-profile-btn { background: none; border: none; cursor: pointer; padding: 2px; font-size: 10px; opacity: 0.7; }
        .master-profile-btn:hover { opacity: 1; }
        .sidebar-hint { font-family: var(--font-mono); font-size: 9px; color: var(--text-muted); }
        .question-input { width: 100%; box-sizing: border-box; background: var(--bg-input); border: 1px solid var(--border-subtle); color: var(--text); font-family: var(--font-serif); font-size: 14px; padding: 12px; resize: vertical; min-height: 90px; outline: none; line-height: 1.75; border-radius: 3px; transition: border-color 0.2s; }
        .question-input:focus { border-color: var(--accent); }
        .question-input::placeholder { color: var(--text-muted); }
        .error-msg { margin-top: 8px; padding: 9px 13px; background: rgba(224,85,85,0.08); border: 1px solid #c04040; color: var(--bear); font-size: 12px; border-radius: 3px; font-family: var(--font-mono); }
        .question-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; gap: 8px; flex-wrap: wrap; }
        .btn-submit { background: linear-gradient(135deg, var(--accent), #9a7830); color: #0a0a0f; border: none; padding: 10px 24px; font-family: var(--font-serif); font-size: 14px; font-weight: 700; cursor: pointer; border-radius: 3px; transition: all 0.2s; }
        .btn-submit:disabled { background: var(--border-subtle); color: var(--text-muted); cursor: not-allowed; }
        .loading-state { display: flex; flex-direction: column; align-items: center; padding: 50px 20px; gap: 16px; }
        .loading-dots { display: flex; gap: 6px; }
        .dot-anim { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); animation: dot 1.4s ease infinite; }
        .loading-text { font-family: var(--font-mono); font-size: 11px; letter-spacing: 2.5px; color: var(--accent); }
        .loading-bar { width: 200px; height: 2px; background: var(--border-subtle); border-radius: 1px; overflow: hidden; }
        .loading-bar-inner { height: 100%; background: linear-gradient(90deg, var(--accent), #3a7bd5); animation: prog 1.6s ease infinite; }
        .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 220px; text-align: center; gap: 12px; }
        .empty-icon { font-size: 48px; opacity: 0.2; }
        .empty-state p { font-size: 12.5px; color: var(--text-muted); line-height: 1.8; }
        .discussion-container { display: flex; flex-direction: column; gap: 24px; }
        .reveal-item { animation: revealIn 0.4s ease forwards; }
        @keyframes revealIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .typing-indicator-row { display: grid; grid-template-columns: 48px 1fr; gap: 12px; align-items: center; padding: 10px 0; }
        .typing-indicator-body { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .typing-name { font-size: 13px; font-weight: 600; color: var(--text-muted); }
        .typing-dots { display: inline-flex; gap: 4px; }
        .typing-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: typingBounce 0.6s ease-in-out infinite; }
        @keyframes typingBounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-4px); opacity: 1; } }
        .typing-text { font-size: 12px; color: var(--text-muted); font-family: var(--font-mono); }
        .caret { display: inline-block; width: 2px; height: 1em; background: var(--accent); margin-left: 2px; vertical-align: text-bottom; animation: caretBlink 0.9s step-end infinite; }
        @keyframes caretBlink { 50% { opacity: 0; } }
        .host-block, .user-followup { padding: 12px 14px; border-radius: 4px; background: var(--bg-input); border: 1px solid var(--border); }
        .host-opening { border-left: 3px solid var(--accent); }
        .host-closing { border-left: 3px solid var(--neutral); }
        .host-label, .user-label { font-family: var(--font-mono); font-size: 9px; letter-spacing: 2px; color: var(--accent); display: block; margin-bottom: 6px; }
        .user-followup { border-left: 3px solid var(--bull); }
        .speech-row { display: grid; grid-template-columns: 48px 1fr; gap: 12px; }
        .speech-avatar { width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid; flex-shrink: 0; overflow: hidden; }
        .speech-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
        .speech-name { font-size: 14.5px; font-weight: 700; }
        .speech-title { font-family: var(--font-mono); font-size: 9px; color: var(--text-muted); }
        .speech-stance { font-family: var(--font-mono); font-size: 9.5px; padding: 2px 8px; border: 1px solid; border-radius: 3px; margin-left: auto; flex-shrink: 0; }
        .speech-content { background: var(--bg-input); border: 1px solid var(--border); border-left: 3px solid; padding: 12px 14px; font-size: 13.5px; line-height: 1.9; border-radius: 0 3px 3px 0; }
        .speech-key { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-subtle); }
        .verdict-block { background: linear-gradient(135deg, var(--accent-bg), rgba(58,123,213,0.04)); border: 1px solid var(--accent-dim); padding: 16px 18px; border-radius: 4px; }
        .verdict-title { font-size: 15.5px; color: var(--accent); margin-bottom: 9px; font-weight: 700; }
        .verdict-summary { font-size: 13.5px; line-height: 1.9; color: var(--text); margin: 0; opacity: 0.9; }
        .verdict-bars { display: flex; height: 5px; margin-top: 14px; border-radius: 3px; overflow: hidden; background: var(--bg-input); gap: 2px; }
        .verdict-bars .v-bar { transition: width 1s; }
        .verdict-bars .v-bar.v-bull { background: var(--bull); }
        .verdict-bars .v-bar.v-neutral { background: var(--neutral); }
        .verdict-bars .v-bar.v-bear { background: var(--bear); }
        .verdict-votes { display: flex; gap: 18px; margin-top: 8px; flex-wrap: wrap; font-family: var(--font-mono); font-size: 11px; }
        .verdict-votes .v-bull { color: var(--bull); }
        .verdict-votes .v-neutral { color: var(--neutral); }
        .verdict-votes .v-bear { color: var(--bear); }
        .verdict-consensus, .verdict-risk { margin-top: 8px; font-family: var(--font-mono); font-size: 11px; }
        .verdict-consensus { color: var(--bull); }
        .verdict-risk { color: var(--bear); }
        .followup-section { margin-top: 8px; padding-top: 16px; border-top: 1px solid var(--border); }
        .followup-label { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); display: block; margin-bottom: 6px; }
        .followup-row { display: flex; gap: 8px; }
        .followup-input { flex: 1; background: var(--bg-input); border: 1px solid var(--border-subtle); color: var(--text); padding: 10px 12px; font-size: 13px; border-radius: 3px; outline: none; }
        .followup-input:focus { border-color: var(--accent); }
        .btn-followup { padding: 10px 20px; background: var(--accent); color: #0a0a0f; border: none; border-radius: 3px; font-weight: 600; cursor: pointer; }
        .btn-followup:disabled { opacity: 0.5; cursor: not-allowed; }
        .followup-hint-inline { margin-top: 6px; font-size: 11px; color: var(--accent); font-family: var(--font-mono); }
        .card-panel { background: var(--bg-card); border: 1px solid var(--border); border-radius: 4px; padding: 16px; position: relative; overflow: hidden; }
        .card-accent { position: absolute; top: 0; left: 0; right: 0; height: 2px; }
        .card-title { font-family: var(--font-mono); font-size: 9px; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
        .card-title-line { flex: 1; height: 1px; background: var(--border); }
        .mini-btn { flex: 1; padding: 5px 2px; border: 1px solid; font-size: 10px; cursor: pointer; font-family: var(--font-mono); border-radius: 3px; transition: all 0.15s; }
        .modal-overlay { position: fixed; inset: 0; background: var(--overlay); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
        .modal-content { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; max-width: 480px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: var(--shadow); }
        .profile-modal { max-width: 420px; }
        .profile-header { position: relative; display: flex; align-items: center; gap: 12px; padding: 16px; border-bottom: 1px solid var(--border); }
        .profile-avatar { flex-shrink: 0; }
        .profile-name { margin: 0; font-size: 18px; }
        .profile-title { margin: 4px 0 0; font-size: 12px; color: var(--text-muted); font-family: var(--font-mono); }
        .modal-close { position: absolute; top: 12px; right: 12px; background: none; border: none; font-size: 20px; color: var(--text-muted); cursor: pointer; }
        .profile-body { padding: 16px; }
        .profile-body section { margin-bottom: 14px; }
        .profile-body h4 { font-size: 10px; font-family: var(--font-mono); letter-spacing: 1px; color: var(--accent); margin: 0 0 6px; }
        .profile-body p { font-size: 13px; line-height: 1.7; margin: 0; color: var(--text); }
        .profile-quote { margin: 14px 0 0; padding: 12px 14px; border-left: 3px solid; background: var(--bg-input); font-style: italic; font-size: 13px; }
        .modal-heading { margin: 0 0 16px; font-size: 16px; }
        .custom-form-modal { padding: 20px; max-width: 440px; }
        .custom-form label { display: block; font-size: 10px; font-family: var(--font-mono); color: var(--text-muted); margin: 10px 0 4px; }
        .custom-form input, .custom-form textarea { width: 100%; box-sizing: border-box; background: var(--bg-input); border: 1px solid var(--border-subtle); color: var(--text); padding: 8px 10px; border-radius: 3px; font-size: 13px; }
        .custom-form .color-input { height: 32px; padding: 2px; cursor: pointer; }
        .form-actions { display: flex; gap: 10px; margin-top: 20px; }
        .btn-secondary { padding: 8px 16px; background: transparent; border: 1px solid var(--border); color: var(--text); border-radius: 3px; cursor: pointer; }
        .btn-primary { padding: 8px 16px; background: var(--accent); color: #0a0a0f; border: none; border-radius: 3px; cursor: pointer; font-weight: 600; }
      `}</style>
    </div>
  );
}
