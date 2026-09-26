const BLOCKED_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'apiKey',
  'apiConfig',
  'aiConfig',
  'authorization',
  'baseUrl',
  'file',
  'fileData',
  'base64',
  'password',
  'secret',
  'token',
]);
const BLOCKED_KEY_NAMES = new Set([...BLOCKED_KEYS].map((key) => key.toLowerCase()));

export const SHARE_RESULT_KINDS = Object.freeze({
  MASTER_PK: 'master_pk',
  BREAKFAST: 'breakfast',
  MUNGER: 'munger',
});

export const SHARE_KIND_LABELS = Object.freeze({
  [SHARE_RESULT_KINDS.MASTER_PK]: '大师PK',
  [SHARE_RESULT_KINDS.BREAKFAST]: '巴菲特的早餐',
  [SHARE_RESULT_KINDS.MUNGER]: '芒格教你读财报',
});

export const SHARE_RESULT_MAX_CHARS = 320_000;

function text(value, maxLength = 80_000) {
  const out = String(value ?? '').trim();
  return out.length > maxLength ? out.slice(0, maxLength) : out;
}

function safeJsonClone(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

export function sanitizeShareValue(value, depth = 0) {
  if (depth > 12) return null;
  if (value == null) return null;
  if (typeof value === 'string') return text(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 200)
      .map((item) => sanitizeShareValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 120)) {
      if (!key || BLOCKED_KEYS.has(key) || BLOCKED_KEY_NAMES.has(key.toLowerCase())) continue;
      const clean = sanitizeShareValue(item, depth + 1);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }
  return undefined;
}

export function normalizeShareDraft({ kind, title, payload } = {}) {
  const normalizedKind = text(kind, 40);
  if (!Object.values(SHARE_RESULT_KINDS).includes(normalizedKind)) {
    return { ok: false, error: '不支持的分享类型' };
  }
  const normalizedTitle = text(title, 180) || SHARE_KIND_LABELS[normalizedKind];
  const cleanPayload = sanitizeShareValue(payload);
  if (!cleanPayload || typeof cleanPayload !== 'object' || Array.isArray(cleanPayload)) {
    return { ok: false, error: '分享内容格式错误' };
  }
  const serialized = JSON.stringify(cleanPayload);
  if (serialized.length > SHARE_RESULT_MAX_CHARS) {
    return { ok: false, error: '分享内容过大，请缩短后重试' };
  }
  return {
    ok: true,
    value: {
      kind: normalizedKind,
      title: normalizedTitle,
      payload: cleanPayload,
    },
  };
}

function pickMaster(master) {
  if (!master || typeof master !== 'object') return null;
  const id = text(master.id, 160);
  if (!id) return null;
  return {
    id,
    name: text(master.name, 80),
    nameEn: text(master.nameEn, 100),
    title: text(master.title, 120),
    emoji: text(master.emoji, 12),
    color: text(master.color, 24),
    avatar: text(master.avatar, 300),
    tag: text(master.tag, 80),
  };
}

function normalizeDiscussion(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 80).map((item) => ({
    investorId: text(item?.investorId, 160),
    stance: text(item?.stance, 24),
    content: text(item?.content),
    keyPoint: text(item?.keyPoint, 1200),
  })).filter((item) => item.content || item.keyPoint);
}

function normalizeVerdict(verdict) {
  if (!verdict || typeof verdict !== 'object') return {};
  return safeJsonClone(verdict) || {};
}

function normalizeMasterRound(round, index) {
  const type = round?.type === 'followUp' ? 'followUp' : 'round';
  const base = {
    type,
    order: index + 1,
    userMsg: type === 'followUp' ? text(round?.userMsg, 5000) : '',
    discussion: normalizeDiscussion(round?.discussion),
    verdict: normalizeVerdict(round?.verdict),
  };
  if (type === 'round') {
    base.hostOpening = text(round?.hostOpening);
    base.hostClosing = text(round?.hostClosing);
  }
  return base;
}

export function buildMasterPkSharePayload({ question, result, rounds, masters } = {}) {
  const sourceRounds = Array.isArray(rounds) && rounds.length ? rounds : (result ? [result] : []);
  const normalizedRounds = sourceRounds.map(normalizeMasterRound).filter((round) => (
    round.hostOpening || round.hostClosing || round.userMsg || round.discussion.length || Object.keys(round.verdict).length
  ));
  return {
    question: text(question, 5000),
    hostId: text(result?.hostId, 160),
    masters: (Array.isArray(masters) ? masters : []).slice(0, 30).map(pickMaster).filter(Boolean),
    rounds: normalizedRounds,
  };
}

function normalizeBreakfastStep(step) {
  if (!step || typeof step !== 'object') return null;
  return {
    stepKey: text(step.stepKey, 80),
    title: text(step.title, 200),
    type: text(step.type, 40),
    leadId: text(step.leadId, 160),
    content: text(step.content),
    turns: Array.isArray(step.turns) ? step.turns.slice(0, 12).map((turn) => ({
      speaker: text(turn?.speaker, 40),
      text: text(turn?.text, 3000),
    })) : [],
    summary: text(step.summary, 12_000),
    verdict: text(step.verdict, 80),
    reason: text(step.reason, 3000),
    opportunities: Array.isArray(step.opportunities) ? safeJsonClone(step.opportunities.slice(0, 12)) || [] : [],
    pool: Array.isArray(step.pool) ? safeJsonClone(step.pool.slice(0, 30)) || [] : [],
    action: step.action && typeof step.action === 'object' ? safeJsonClone(step.action) || {} : {},
    risk: text(step.risk, 5000),
    followUps: Array.isArray(step.followUps) ? step.followUps.slice(0, 8).map((item) => text(item, 800)).filter(Boolean) : [],
    stop: Boolean(step.stop),
  };
}

export function buildBreakfastSharePayload({ news, mode, guests, steps, followups } = {}) {
  return {
    news: {
      title: text(news?.title, 1000),
      content: text(news?.content, 30_000),
      source: text(news?.source, 500),
      time: text(news?.time, 200),
    },
    mode: mode === 'quick' ? 'quick' : 'deep',
    guests: (Array.isArray(guests) ? guests : []).slice(0, 12).map((item) => ({
      id: text(item?.master?.id || item?.id, 160),
      name: text(item?.master?.name || item?.name, 80),
      title: text(item?.master?.title || item?.title, 120),
      emoji: text(item?.master?.emoji || item?.emoji, 12),
      color: text(item?.master?.color || item?.color, 24),
      avatar: text(item?.master?.avatar || item?.avatar, 300),
      groupKey: text(item?.groupKey, 80),
    })).filter((item) => item.id),
    steps: (Array.isArray(steps) ? steps : []).slice(0, 12).map(normalizeBreakfastStep).filter(Boolean),
    followups: (Array.isArray(followups) ? followups : [])
      .filter((item) => item?.status === 'done' && text(item?.content))
      .slice(0, 30)
      .map((item) => ({
        q: text(item.q, 3000),
        leadId: text(item.leadId, 160),
        content: text(item.content),
        hostNote: text(item.hostNote, 5000),
      })),
  };
}

export function buildMungerSharePayload({ link, fileName, note, result } = {}) {
  return {
    report: {
      link: text(link, 3000),
      fileName: text(fileName, 500),
      note: text(note, 5000),
    },
    analysis: {
      content: text(result?.content),
      followUps: Array.isArray(result?.followUps)
        ? result.followUps.slice(0, 8).map((item) => text(item, 1000)).filter(Boolean)
        : [],
      diagnosis: safeJsonClone(result?.diagnosis),
      dataCard: text(result?.dataCard, 30_000),
    },
  };
}

export function masterPkShareTitle(question) {
  return text(question, 180) || '大师PK';
}

export function breakfastShareTitle(news) {
  return text(news?.title, 180) || '巴菲特的早餐 · 新闻解读';
}

export function mungerShareTitle({ fileName, link, result } = {}) {
  return text(result?.diagnosis?.company, 180)
    || text(fileName, 180)
    || text(link, 180)
    || '芒格财报解读';
}
