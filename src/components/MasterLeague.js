'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Award,
  ChevronLeft,
  ChevronRight,
  Crown,
  Equal,
  Medal,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  ThumbsUp,
  Trash2,
  Trophy,
  UserPlus,
} from 'lucide-react';
import { PUBLIC_LEAGUE } from '../data/masterLeague';
import { useAuth } from '../lib/authProvider';
import { deleteLeagueInvite, fetchCurrentProfile, fetchLeagueInvites, publishLeagueInvite } from '../lib/leagueInvites';
import { inviteDeleteMode } from '../lib/leagueInvitePolicy.mjs';
import { mergeInvitedLeague } from '../lib/masterLeagueInvites.mjs';
import { readApiResponse } from '../lib/apiResponse.mjs';
import MasterLeagueInviteDrawer from './MasterLeagueInviteDrawer';
import { MasterAvatar } from './ui';
import styles from './MasterLeague.module.css';

const LIKES_KEY = 'thinktank_master_league_likes_v1';
const INVITED_KEY = 'thinktank_master_league_invited_v1';

const money = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  maximumFractionDigits: 0,
});

function formatMoney(value) {
  return money.format(Number(value) || 0).replace('CN¥', '¥');
}

function formatRate(value, digits = 2) {
  const number = (Number(value) || 0) * 100;
  const prefix = number > 0 ? '+' : '';
  return `${prefix}${number.toFixed(digits)}%`;
}

function formatSignedMoney(value) {
  const number = Number(value) || 0;
  return `${number > 0 ? '+' : ''}${formatMoney(number)}`;
}

function holdingLabel(decision, account) {
  const names = Array.isArray(decision?.holdingNames) && decision.holdingNames.length
    ? decision.holdingNames
    : (account?.positions || []).map((position) => position.name || position.symbol).filter(Boolean);
  if (!names.length) return '当前空仓';
  if (names.length <= 2) return names.join('、');
  return `${names.slice(0, 2).join('、')}等 ${names.length} 只`;
}

function decisionInstrument(decision, account) {
  if (decision?.action === '持有' && !decision.symbol) return holdingLabel(decision, account);
  return decision?.stockName || decision?.symbol || '未命名标的';
}

function decisionPlanText(decision, account) {
  if (decision?.action === '持有') {
    if (!decision.symbol) {
      const hasHolding = (decision.holdingNames?.length || account?.positions?.length);
      return hasHolding ? '保持现有仓位' : '保持空仓，等待信号';
    }
    return `${decision.symbol} · 保持现有仓位`;
  }
  const symbol = decision?.symbol ? `${decision.symbol} · ` : '';
  return `${symbol}目标仓位 ${Number(decision?.targetPct) || 0}%`;
}

function formatPublishedAt(value) {
  if (!value) return '未知时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function toneForNumber(value) {
  if (Number(value) > 0) return styles.marketUp;
  if (Number(value) < 0) return styles.marketDown;
  return styles.flat;
}

function toneForAction(action) {
  if (action === '买入' || action === '加仓') return styles.buy;
  if (action === '卖出' || action === '减仓' || action === '清仓') return styles.sell;
  return styles.hold;
}

function rankMeta(rank) {
  if (rank === 1) return { label: '冠军', Icon: Crown, tone: styles.rankChampion };
  if (rank === 2) return { label: '榜眼', Icon: Medal, tone: styles.rankRunnerUp };
  if (rank === 3) return { label: '探花', Icon: Award, tone: styles.rankThird };
  return { label: `第 ${rank} 名`, Icon: null, tone: '' };
}

function RankBadge({ rank, compact = false }) {
  const meta = rankMeta(rank);
  const Icon = meta.Icon;
  return (
    <span className={`${styles.rankBadge} ${meta.tone} ${compact ? styles.rankBadgeCompact : ''}`}>
      {Icon ? <Icon size={compact ? 14 : 16} /> : <strong>{rank}</strong>}
      <span>{meta.label}</span>
    </span>
  );
}

function TrendIcon({ value, size = 15 }) {
  if (Number(value) > 0) return <ArrowUpRight size={size} aria-hidden="true" />;
  if (Number(value) < 0) return <ArrowDownRight size={size} aria-hidden="true" />;
  return <Equal size={size} aria-hidden="true" />;
}

function SectionTitle({ children, aside }) {
  return (
    <div className={styles.sectionTitle}>
      <h3>{children}</h3>
      {aside ? <span>{aside}</span> : null}
    </div>
  );
}

// 把 AI 生成的互评对到具体那笔操作上：优先按 about 里提到的「动作 + 股票」匹配
function buildAiCommentFeed(comments, group, masterMap) {
  if (!comments?.length || !group?.account) return [];
  const decisions = group.decisions || [];
  return comments.map((comment) => {
    const about = String(comment.about || '');
    // 先按股票名匹配（模型可能把「加仓」写成「买入」），再退回按动作，最后兜底第一条
    const matched = decisions.find((decision) => decision.stockName && about.includes(decision.stockName))
      || decisions.find((decision) => about.includes(decision.action))
      || decisions[0];
    return {
      comment,
      decision: matched || { id: comment.id, action: '', stockName: '' },
      owner: group.account,
      commenter: masterMap[comment.masterId] || group.account,
    };
  }).filter((item) => item.owner);
}

function rankingAccounts(ranking) {
  return (ranking || []).map((row) => row.account || row);
}

function PositionTable({ positions, compact = false }) {
  if (!positions?.length) return <div className={styles.emptyLine}>当前空仓，等待下一交易日执行计划。</div>;
  return (
    <div className={styles.tableWrap}>
      <table className={`${styles.dataTable} ${compact ? styles.compactTable : ''}`}>
        <thead>
          <tr><th>持仓</th><th>数量</th><th>市值</th><th>仓位</th><th>浮动盈亏</th></tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <tr key={position.symbol}>
              <td><strong>{position.name}</strong><small>{position.symbol}</small></td>
              <td>{Number(position.quantity || 0).toLocaleString('zh-CN')}</td>
              <td>{formatMoney(position.marketValue)}</td>
              <td>{formatRate(position.weight, 1)}</td>
              <td className={toneForNumber(position.profitRate)}>{formatRate(position.profitRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RankingTable({ ranking, onOpen }) {
  return (
    <div className={styles.tableWrap}>
      <table className={`${styles.dataTable} ${styles.rankingTable}`}>
        <thead>
          <tr><th>名次</th><th>大师</th><th>总资产</th><th>累计收益率</th><th>今日收益</th><th>现金</th><th aria-label="查看详情" /></tr>
        </thead>
        <tbody>
          {ranking.map((row) => {
            const account = row.account || row;
            return (
              <tr
                key={account.id}
                className={styles.rankingRow}
                role="link"
                tabIndex={0}
                aria-label={`查看${account.shortName || account.name}详情`}
                onClick={() => onOpen(account.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpen(account.id);
                  }
                }}
              >
                <td><span className={styles.rankNumber}>{account.rank}</span></td>
                <td>
                  <div className={styles.masterCell}>
                    <MasterAvatar master={account} size={38} keepColor />
                    <span><strong>{account.shortName || account.name}</strong><small>{account.style || account.title}</small></span>
                  </div>
                </td>
                <td>{formatMoney(account.totalAsset)}</td>
                <td className={toneForNumber(account.profitRate)}><span className={styles.inlineTrend}><TrendIcon value={account.profitRate} />{formatRate(account.profitRate)}</span></td>
                <td className={toneForNumber(account.todayProfitRate)}>{formatRate(account.todayProfitRate)}</td>
                <td>{formatMoney(account.cash)}</td>
                <td><span className={styles.rowArrow} aria-hidden="true"><ChevronRight size={16} /></span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function groupTodayStrategies(accounts) {
  return (accounts || []).map((account) => {
    const decisions = account.decisions || [];
    const pending = decisions.filter((decision) => decision.status === 'pending');
    const latestDate = decisions[0]?.decisionDate || '';
    const current = pending.length
      ? pending
      : decisions.filter((decision) => decision.decisionDate === latestDate).slice(0, 3);
    return { account, decisions: current };
  }).filter((group) => group.decisions.length);
}

function StrategyMasterTabs({ groups, selectedMasterId, onSelectMaster }) {
  return (
    <div className={styles.strategyMasterTabs} role="tablist" aria-label="选择大师策略">
      {groups.map(({ account }) => (
        <button
          type="button"
          role="tab"
          aria-selected={selectedMasterId === account.id}
          className={`${styles.strategyMasterTab}${selectedMasterId === account.id ? ` ${styles.strategyMasterTabActive}` : ''}`}
          key={account.id}
          onClick={() => onSelectMaster(account.id)}
        >
          <MasterAvatar master={account} size={54} keepColor />
          <strong>{account.shortName || account.name}</strong>
          <small>{rankMeta(account.rank).label}</small>
        </button>
      ))}
    </div>
  );
}

function StrategyBoard({ group }) {
  if (!group) return <div className={styles.emptyLine}>今天还没有可展示的大师策略。</div>;
  const { account, decisions } = group;
  return (
    <div className={styles.strategyGroups}>
        <article className={`${styles.strategyGroup} ${styles.strategyGroupActive}`}>
          <div className={styles.strategyGroupHead}>
            <div className={styles.strategyMaster}>
              <MasterAvatar master={account} size={38} keepColor />
              <span><strong>{account.shortName || account.name}</strong><small>{account.style || account.title}</small></span>
            </div>
            <div className={styles.strategyReturn}>
              <RankBadge rank={account.rank} compact />
              <strong className={toneForNumber(account.profitRate)}>{formatRate(account.profitRate)}</strong>
            </div>
          </div>
          <p className={styles.strategyIntro}>{account.intro || account.biography || account.personality}</p>
          <div className={styles.strategyItems}>
            {decisions.map((decision) => (
              <div className={styles.strategyItem} key={decision.id}>
                <span className={`${styles.actionBadge} ${toneForAction(decision.action)}`}>{decision.action}</span>
                <span className={styles.strategyStock}><strong>{decisionInstrument(decision, account)}</strong><small>{decisionPlanText(decision, account)}</small></span>
                <span className={styles.strategyReason}>{decision.reason}</span>
              </div>
            ))}
          </div>
        </article>
    </div>
  );
}

function RandomCommentFeed({ comments, likes, onToggleLike }) {
  if (!comments.length) return <div className={styles.emptyLine}>这期策略还没有大师点评。</div>;
  return (
    <div className={styles.randomComments}>
      {comments.map((item) => {
        const liked = Boolean(likes.comments?.[item.comment.id]);
        return (
          <article className={styles.randomComment} key={`${item.decision.id}:${item.comment.id}`}>
            <div className={styles.randomCommentHead}>
              <MasterAvatar master={item.commenter} size={30} keepColor />
              <span><strong>{item.commenter.shortName || item.commenter.name}</strong><small>点评 {item.owner.shortName || item.owner.name} 的 {item.decision.action} {item.decision.stockName}</small></span>
            </div>
            <p>{item.comment.text}</p>
            {item.comment.ownerReply ? (
              <p className={styles.randomCommentReply}>
                <strong>{item.owner.shortName || item.owner.name}</strong>：{item.comment.ownerReply}
              </p>
            ) : null}
            <div className={styles.randomCommentFoot}>
              <button type="button" className={`${styles.likeBtn} ${liked ? styles.liked : ''}`} aria-pressed={liked} onClick={() => onToggleLike('comments', item.comment.id)}>
                <ThumbsUp size={13} /> {item.comment.likeCount + (liked ? 1 : 0)}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function EquityCurve({ curve }) {
  if (!curve?.length) return <div className={styles.emptyLine}>净值曲线将在行情恢复后生成。</div>;
  const values = curve.map((point) => point.totalAsset);
  const min = Math.min(...values, 100000);
  const max = Math.max(...values, 100000);
  const span = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 600;
    const y = 160 - ((value - min) / span) * 120;
    return [x, y];
  });
  const path = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${path} L600 180 L0 180 Z`;
  return (
    <div className={styles.curve}>
      <svg viewBox="0 0 600 180" role="img" aria-label="大师资产曲线">
        <defs><linearGradient id="league-curve-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
        <line x1="0" y1="160" x2="600" y2="160" className={styles.curveBaseline} />
        <path d={area} className={styles.curveArea} /><path d={path} className={styles.curveLine} />
        {points.length ? <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r="4" className={styles.curveDot} /> : null}
      </svg>
      <div className={styles.curveLabels}><span>{curve[0].date}</span><span>10 万起跑线</span><span>{curve[curve.length - 1].date}</span></div>
    </div>
  );
}

function shuffle(items, seed) {
  const output = [...items];
  let state = Math.max(1, Number(seed) || 1);
  for (let index = output.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    const target = state % (index + 1);
    [output[index], output[target]] = [output[target], output[index]];
  }
  return output;
}

function loadInvitedIds() {
  try {
    const saved = JSON.parse(localStorage.getItem(INVITED_KEY) || '[]');
    if (Array.isArray(saved)) return saved;
    const legacy = JSON.parse(localStorage.getItem('thinktank_master_league_arena_v1') || '{}');
    return Array.isArray(legacy.masterIds) ? legacy.masterIds : [];
  } catch {
    return [];
  }
}

export default function MasterLeague({ customMasters = [], onAddCustomMaster }) {
  const { user } = useAuth();
  const [league, setLeague] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState('league');
  const [selectedMasterId, setSelectedMasterId] = useState('');
  const [selectedStrategyMasterId, setSelectedStrategyMasterId] = useState('');
  const [likes, setLikes] = useState({ comments: {}, decisions: {} });
  const [likesReady, setLikesReady] = useState(false);
  const [invitedIds, setInvitedIds] = useState([]);
  const [remoteInvitedMasters, setRemoteInvitedMasters] = useState([]);
  const [invitesLoaded, setInvitesLoaded] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [deletingInvite, setDeletingInvite] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [commentSeed, setCommentSeed] = useState(1);
  const [aiComments, setAiComments] = useState({});

  useEffect(() => {
    try {
      const requestedMode = new URLSearchParams(window.location.search).get('mode');
      if (requestedMode) {
        const url = new URL(window.location.href);
        url.searchParams.delete('mode');
        window.history.replaceState({}, '', url.toString());
      }
    } catch { /* ignore */ }
    setInvitedIds(loadInvitedIds());
    try {
      const saved = JSON.parse(localStorage.getItem(LIKES_KEY) || '{}');
      setLikes({ comments: saved.comments || {}, decisions: saved.decisions || {} });
    } catch { /* ignore */ }
    setLikesReady(true);
  }, []);

  useEffect(() => {
    if (!likesReady) return;
    try { localStorage.setItem(LIKES_KEY, JSON.stringify(likes)); } catch { /* ignore */ }
  }, [likes, likesReady]);

  const loadLeague = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/master-league', { cache: 'no-store' });
      const payload = await readApiResponse(response);
      if (!response.ok || !payload?.ok || !payload?.data) throw new Error(payload?.error || '公开赛数据暂时不可用');
      setLeague(payload.data);
    } catch (err) {
      setError(err?.message || '公开赛数据暂时不可用');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadLeague(); }, [loadLeague]);

  const loadInvites = useCallback(async () => {
    try {
      const rows = await fetchLeagueInvites();
      setRemoteInvitedMasters(rows);
    } catch (err) {
      setError((current) => current || err?.message || '公开邀请加载失败');
    } finally {
      setInvitesLoaded(true);
    }
  }, []);

  useEffect(() => { loadInvites(); }, [loadInvites]);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setIsAdmin(false);
      return undefined;
    }
    fetchCurrentProfile(user.id).then((profile) => {
      if (!cancelled) setIsAdmin(Boolean(profile?.is_admin));
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  const participants = useMemo(() => invitedIds
    .map((id) => customMasters.find((master) => master.id === id))
    .filter(Boolean), [invitedIds, customMasters]);

  useEffect(() => {
    if (!user?.id || !invitesLoaded || !participants.length) return undefined;
    const remoteIds = new Set(remoteInvitedMasters.map((master) => master.id));
    const unsynced = participants.filter((master) => !remoteIds.has(master.id));
    if (!unsynced.length) return undefined;
    let cancelled = false;
    Promise.all(unsynced.map((master) => publishLeagueInvite(master, user.id)
      .then((saved) => ({ master, saved }))
      .catch((error) => ({ master, error }))))
      .then((results) => {
        if (cancelled) return;
        const blockedIds = results.filter((item) => item.error?.blocked).map((item) => item.master.id);
        if (blockedIds.length) {
          // 管理员已下架：清掉本地待发布记录，避免每次打开页面都重新提交。
          setInvitedIds((current) => {
            const next = current.filter((id) => !blockedIds.includes(id));
            try { localStorage.setItem(INVITED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
            return next;
          });
        }
        const valid = results.map((item) => item.saved).filter(Boolean);
        if (valid.length) setRemoteInvitedMasters((current) => {
          const next = [...current];
          for (const master of valid) {
            const index = next.findIndex((item) => item.id === master.id);
            if (index >= 0) next[index] = master;
            else next.unshift(master);
          }
          return next;
        });
      });
    return () => { cancelled = true; };
  }, [user?.id, invitesLoaded, participants, remoteInvitedMasters]);

  const activeLeague = useMemo(() => mergeInvitedLeague(league, remoteInvitedMasters), [league, remoteInvitedMasters]);
  const accounts = activeLeague?.accounts || [];
  const ranking = activeLeague?.ranking || [];
  const masterMap = useMemo(() => Object.fromEntries(accounts.map((account) => [account.id, account])), [accounts]);
  const strategyGroups = useMemo(() => groupTodayStrategies(accounts), [accounts]);
  const allComments = useMemo(() => {
    const unique = new Map();
    for (const { account, decisions } of strategyGroups) {
      for (const decision of decisions) {
        for (const comment of (decision.comments || [])) {
          if (comment.masterId === decision.masterId) continue;
          const key = `${comment.masterId}:${comment.text}`;
          if (!unique.has(key)) unique.set(key, {
            comment,
            decision,
            owner: account,
            commenter: masterMap[comment.masterId] || account,
          });
        }
      }
    }
    return [...unique.values()];
  }, [strategyGroups, masterMap]);
  const selectedStrategyAccount = accounts.find((account) => account.id === selectedStrategyMasterId) || accounts[0];
  const selectedMasterComments = useMemo(() => allComments.filter((item) => item.owner.id === selectedStrategyAccount?.id), [allComments, selectedStrategyAccount?.id]);
  const randomComments = useMemo(() => shuffle(selectedMasterComments, commentSeed).slice(0, 10), [selectedMasterComments, commentSeed]);
  const selectedMaster = accounts.find((account) => account.id === selectedMasterId) || accounts[0];
  const selectedStrategyGroup = strategyGroups.find((group) => group.account.id === selectedStrategyAccount?.id) || strategyGroups[0];
  const selectedStrategyDate = selectedStrategyGroup?.decisions?.[0]?.decisionDate || activeLeague?.latestDate || '';
  // AI 现场生成的互评优先展示；没有就回退到预置点评，页面永远有内容
  const aiFeed = useMemo(
    () => buildAiCommentFeed(aiComments[selectedStrategyAccount?.id], selectedStrategyGroup, masterMap),
    [aiComments, selectedStrategyAccount?.id, selectedStrategyGroup, masterMap],
  );
  const displayComments = aiFeed.length ? aiFeed : randomComments;

  useEffect(() => {
    setCommentSeed(Math.floor(Math.random() * 100000) + 1);
  }, [activeLeague?.latestDate, invitedIds.length, selectedStrategyMasterId]);

  // 只读当日已生成的 AI 互评（服务端缓存），没有就继续用预置点评
  useEffect(() => {
    const masterId = selectedStrategyAccount?.id;
    if (!masterId || !selectedStrategyDate) return undefined;
    let cancelled = false;
    let retryTimer;

    setAiComments((current) => {
      if (!current[masterId]) return current;
      return { ...current, [masterId]: [] };
    });

    const load = async (attempt = 0) => {
      try {
        const query = new URLSearchParams({ master: masterId, date: selectedStrategyDate });
        const response = await fetch(`/api/master-league/commentary?${query}`, { cache: 'no-store' });
        const payload = await response.json();
        if (cancelled) return;
        if (payload?.ok && payload.comments?.length) {
          setAiComments((current) => ({ ...current, [masterId]: payload.comments }));
          return;
        }
      } catch { /* retry below */ }
      if (!cancelled && attempt < 2) {
        retryTimer = setTimeout(() => load(attempt + 1), attempt === 0 ? 5000 : 15000);
      }
    };

    load();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [selectedStrategyAccount?.id, selectedStrategyDate]);

  useEffect(() => {
    if (!accounts.length) {
      setSelectedStrategyMasterId('');
      return;
    }
    if (!accounts.some((account) => account.id === selectedStrategyMasterId)) {
      setSelectedStrategyMasterId(accounts[0].id);
    }
  }, [accounts, selectedStrategyMasterId]);

  const toggleLike = (kind, id) => {
    setLikes((previous) => {
      const bucket = previous[kind] || {};
      return { ...previous, [kind]: { ...bucket, [id]: !bucket[id] } };
    });
  };

  const openMaster = (masterId) => {
    setSelectedMasterId(masterId);
    setView('master');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const addInvitedMaster = (master) => {
    onAddCustomMaster?.(master);
    setInvitedIds((previous) => {
      const next = previous.includes(master.id) ? previous : [...previous, master.id];
      try { localStorage.setItem(INVITED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    if (!user?.id) throw new Error('请先登录后再邀请大师参加公开赛');
    return publishLeagueInvite(master, user.id).then((saved) => {
      setRemoteInvitedMasters((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    });
  };

  const deleteInvite = async () => {
    if (!selectedMaster?.inviteId) return;
    const isOwner = Boolean(user?.id && selectedMaster.ownerId === user.id);
    const mode = inviteDeleteMode({ isOwner, isAdmin });
    if (mode === 'forbidden') return;
    const isModerator = mode === 'block';
    const confirmText = isModerator
      ? `确定下架并删除「${selectedMaster.name}」的公开参赛数据吗？下架后对方无法再次发布同一位大师。`
      : `确定删除「${selectedMaster.name}」的公开参赛数据吗？`;
    if (!window.confirm(confirmText)) return;
    setDeletingInvite(true);
    setDeleteError('');
    try {
      await deleteLeagueInvite(selectedMaster.inviteId, {
        masterId: selectedMaster.id,
        userId: user?.id,
        block: isModerator,
      });
      setRemoteInvitedMasters((current) => current.filter((master) => master.inviteId !== selectedMaster.inviteId));
      setInvitedIds((current) => {
        const next = current.filter((id) => id !== selectedMaster.id);
        try { localStorage.setItem(INVITED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
      setView('league');
    } catch (deleteErr) {
      setDeleteError(deleteErr?.message || '删除失败，请稍后重试');
    } finally {
      setDeletingInvite(false);
    }
  };

  const canDeleteInvite = Boolean(selectedMaster?.inviteId && user?.id && (selectedMaster.ownerId === user.id || isAdmin));

  const publicCompetition = league?.competition || PUBLIC_LEAGUE;

  if (loading && !league) {
    return (
      <main className={styles.league}>
        <header className={styles.masthead}>
          <div><h2>大师实盘公开赛</h2><p>官方组织 · 10 万元初始资金 · 仅限 A 股</p></div>
          <span className={styles.qualityPill}><RefreshCw size={14} className={styles.spin} /> 读取公开赛数据</span>
        </header>
        <section className={styles.loadingState} aria-live="polite" role="status">
          <span className={styles.loadingOrbit} aria-hidden="true"><i /></span>
          <strong>正在读取公开赛数据</strong>
          <p>正在同步真实行情与大师账户，请稍候…</p>
          <span className={styles.loadingDots} aria-hidden="true"><i /><i /><i /></span>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.league}>
      {view === 'league' ? (
        <>
      <header className={styles.masthead}>
        <div className={styles.mastheadCopy}>
          <h2>{publicCompetition.name}</h2>
          <p>六位历史投机大师同场竞技，也支持邀请你指定的大师加入，统一获得 10 万元虚拟额度。</p>
          <div className={styles.mastheadMeta}>
            <span><Trophy size={14} /> 第 {league?.dayCount || 0} 个交易日</span>
            <span><ShieldCheck size={14} /> 官方组织 · 仅限 A 股</span>
            <span>正式开赛 {publicCompetition.startDate}</span>
            {participants.length ? <span>{participants.length} 位邀请嘉宾</span> : null}
          </div>
        </div>
        <div className={styles.mastheadActions}>
          <button type="button" className={styles.inviteMasterBtn} onClick={() => {
            if (!user) {
              window.dispatchEvent(new CustomEvent('open-auth'));
              return;
            }
            setInviteOpen(true);
          }}><UserPlus size={15} /> 邀请大师</button>
          <button type="button" className={styles.refreshBtn} onClick={() => loadLeague(true)} disabled={refreshing}><RefreshCw size={15} className={refreshing ? styles.spin : ''} /> 刷新</button>
        </div>
      </header>

      {error ? <div className={styles.errorBanner} role="alert">公开赛数据刷新失败：{error}。页面保留最近一次数据。</div> : null}
      {league?.note ? <div className={styles.dataNote}>{league.note}{league.dataSource?.length ? ` 数据源：${league.dataSource.join(' / ')}。` : ''}</div> : null}
        </>
      ) : null}

      {view === 'league' ? (
        <>
          <section className={styles.standingsSection}>
            <SectionTitle aside={`正式开赛 ${publicCompetition.startDate} · 按累计收益率排序`}>公开赛完整排名</SectionTitle>
            <RankingTable ranking={ranking} onOpen={openMaster} />
          </section>

          {accounts.length ? (
            <>
              <div className={styles.strategyShell}>
                <div className={styles.strategyLayout}>
                  <div className={styles.strategyTabsRow}>
                    <StrategyMasterTabs groups={strategyGroups} selectedMasterId={selectedStrategyAccount?.id} onSelectMaster={setSelectedStrategyMasterId} />
                  </div>
                  <section className={styles.strategyMain}>
                    <SectionTitle>今日大师策略</SectionTitle>
                    <StrategyBoard group={selectedStrategyGroup} />
                  </section>
                  <span className={styles.strategyDivider} aria-hidden="true" />
                  <aside className={styles.commentPanel}>
                    <SectionTitle>大师互评策略</SectionTitle>
                    <RandomCommentFeed comments={displayComments} likes={likes} onToggleLike={toggleLike} />
                  </aside>
                </div>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {view === 'master' && selectedMaster ? (
        <section className={styles.detailPage}>
          <button type="button" className={styles.backBtn} onClick={() => setView('league')}><ChevronLeft size={20} /> 返回排名</button>
          <header className={styles.masterHero}>
            <div className={styles.masterHeroIdentity}><MasterAvatar master={selectedMaster} size={78} keepColor /><div><h2>{selectedMaster.shortName || selectedMaster.name}</h2><p>{selectedMaster.title} · {selectedMaster.styleDetail || selectedMaster.style}</p><span>{selectedMaster.personality}</span></div></div>
            <div className={styles.masterRankBlock}><RankBadge rank={selectedMaster.rank} /><strong>{formatRate(selectedMaster.profitRate)}</strong><small>{selectedMaster.rankChange > 0 ? `上升 ${selectedMaster.rankChange} 位` : selectedMaster.rankChange < 0 ? `下降 ${Math.abs(selectedMaster.rankChange)} 位` : '排名未变'}</small></div>
          </header>
          <section className={styles.masterProfile}>
            <div className={styles.masterProfileLead}>
              <span>参赛者档案 · {selectedMaster.era || '公开赛选手'}</span>
              <h3>谁是{selectedMaster.shortName || selectedMaster.name}？</h3>
              <p>{selectedMaster.intro || selectedMaster.personality || selectedMaster.biography}</p>
            </div>
            <div className={styles.masterProfileFacts}>
              <div><span>原始方法</span><strong>{selectedMaster.styleDetail || selectedMaster.style || '独立策略'}</strong></div>
              <div><span>A股映射</span><strong>{selectedMaster.aShareAngle || selectedMaster.style || '自定义投资策略'}</strong></div>
            </div>
            {isAdmin && selectedMaster.invited ? (
              <div className={styles.moderationPanel}>
                <div className={styles.moderationHead}>
                  <ShieldCheck size={14} />
                  <strong>管理员审核</strong>
                  <span>邀请人 {String(selectedMaster.ownerId || '').slice(0, 8) || '未知'} · 发布于 {formatPublishedAt(selectedMaster.publishedAt)}</span>
                </div>
                {selectedMaster.leaguePrompt ? <p className={styles.moderationText}>{selectedMaster.leaguePrompt}</p> : null}
                {selectedMaster.leagueSkill || selectedMaster.leagueSkillName ? (
                  <p className={styles.moderationText}>
                    Skill：{selectedMaster.leagueSkillName || '未命名'}
                    {selectedMaster.leagueSkill ? ` · ${selectedMaster.leagueSkill.slice(0, 160)}${selectedMaster.leagueSkill.length > 160 ? '…' : ''}` : ''}
                  </p>
                ) : null}
              </div>
            ) : null}
            {deleteError ? <div className={styles.moderationError} role="alert">{deleteError}</div> : null}
            {canDeleteInvite ? (
              <div className={styles.masterProfileActions}>
                <button type="button" onClick={deleteInvite} disabled={deletingInvite}><Trash2 size={14} /> {isAdmin && selectedMaster.ownerId !== user?.id ? '管理员下架并删除' : '删除邀请数据'}</button>
              </div>
            ) : null}
          </section>
          <div className={styles.statStrip}>
            <div><span>总资产</span><strong>{formatMoney(selectedMaster.totalAsset)}</strong></div>
            <div><span>累计收益</span><strong className={toneForNumber(selectedMaster.profit)}>{formatSignedMoney(selectedMaster.profit)}</strong></div>
            <div><span>累计收益率</span><strong className={toneForNumber(selectedMaster.profitRate)}>{formatRate(selectedMaster.profitRate)}</strong></div>
            <div><span>可用现金</span><strong>{formatMoney(selectedMaster.cash)}</strong></div>
          </div>
          <div className={styles.masterGrid}>
            <section className={styles.accountPanel}><SectionTitle aside={selectedMaster.curve?.length ? `${selectedMaster.curve.length} 个交易日` : '等待数据'}>收益曲线</SectionTitle><EquityCurve curve={selectedMaster.curve} /></section>
            <section className={styles.accountPanel}><SectionTitle aside={`现金 ${formatMoney(selectedMaster.cash)}`}>当前持仓</SectionTitle><PositionTable positions={selectedMaster.positions} compact /></section>
          </div>
          <section className={styles.historySection}>
            <SectionTitle aside="按时间倒序">投资策略历史</SectionTitle>
            <div className={styles.historyList}>
              {(selectedMaster.decisions || []).map((decision) => (
                <div className={styles.historyItem} key={decision.id}>
                  <span className={styles.historyDate}>{decision.status === 'pending' ? '下一交易日' : decision.decisionDate}</span>
                  <span className={`${styles.actionBadge} ${toneForAction(decision.action)}`}>{decision.action}</span>
                  <span className={styles.historyTrade}><strong>{decisionInstrument(decision, selectedMaster)}</strong><small>{decisionPlanText(decision, selectedMaster)}</small></span>
                  <span className={styles.historyReason}>{decision.reason}</span>
                </div>
              ))}
            </div>
          </section>
        </section>
      ) : null}

      <footer className={styles.leagueFooter}>
        <span>数据用于模拟比赛与内容展示，不构成投资建议。</span>
        <span>公开赛正式开赛时间 2026-09-14，当前数据为测试预演；邀请大师统一获得 10 万元初始额度。</span>
      </footer>
      <MasterLeagueInviteDrawer open={inviteOpen} onClose={() => setInviteOpen(false)} onAddMaster={addInvitedMaster} />
    </main>
  );
}
