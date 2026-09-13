// 用户邀请的大师直接加入公开赛：每人赠送 100,000 元初始额度，
// 正式赛前只展示资金与待首次开赛状态，不在客户端伪造收益。
const INVITED_INITIAL_CAPITAL = 100000;

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function buildInvitedAccounts(masters) {
  return (masters || []).map((master) => {
    const decision = {
      id: `invited-wait-${master.id}`,
      masterId: master.id,
      symbol: 'CASH',
      stockName: '现金观望',
      action: '持有',
      targetPct: 0,
      reason: '已获得 10 万元参赛额度。正式开赛后，系统会按该大师的提示词与投资风格生成每日计划。',
      risk: '赛前不产生交易，也不展示虚构收益。',
      changed: false,
      changeNote: '',
      comments: [],
      decisionDate: '',
      executionDate: '正式开赛',
      executionPrice: null,
      shares: null,
      status: 'pending',
      note: '等待正式开赛',
    };
    return {
      ...master,
      cash: INVITED_INITIAL_CAPITAL,
      marketValue: 0,
      totalAsset: INVITED_INITIAL_CAPITAL,
      profit: 0,
      profitRate: 0,
      todayProfit: 0,
      todayProfitRate: 0,
      positions: [],
      trades: [],
      decisions: [decision],
      curve: [{ date: '参赛日', totalAsset: INVITED_INITIAL_CAPITAL, cash: INVITED_INITIAL_CAPITAL, marketValue: 0, dailyGain: 0 }],
      rank: 0,
      previousRank: 0,
      rankChange: 0,
      invited: true,
    };
  });
}

export function rankLeagueByReturnRate(accounts) {
  const sorted = [...(accounts || [])]
    .sort((left, right) => (Number(right.profitRate) || 0) - (Number(left.profitRate) || 0) || (Number(right.totalAsset) || 0) - (Number(left.totalAsset) || 0) || String(left.id).localeCompare(String(right.id)))
    .map((account, index) => ({ ...account, rank: index + 1 }));
  const rankMap = new Map(sorted.map((account) => [account.id, account.rank]));
  return {
    accounts: sorted,
    ranking: sorted.map((account) => ({ id: account.id, rank: rankMap.get(account.id), account })),
  };
}

export function mergeInvitedLeague(baseLeague, invitedMasters) {
  if (!baseLeague) return baseLeague;
  const invitedAccounts = buildInvitedAccounts(invitedMasters);
  const existing = new Set((baseLeague.accounts || []).map((account) => account.id));
  const accounts = [...(baseLeague.accounts || []), ...invitedAccounts.filter((account) => !existing.has(account.id))];
  const ranked = rankLeagueByReturnRate(accounts);
  return { ...baseLeague, ...ranked };
}

export const __test__ = { INVITED_INITIAL_CAPITAL, roundMoney };
