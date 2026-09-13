// 大师实盘联赛公共底表读写（仅服务端）。未配置 service role 时自动返回未持久化状态。
import { createClient } from '@supabase/supabase-js';

let adminClient;

export function getMasterLeagueDb() {
  if (adminClient !== undefined) return adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !serviceKey) {
    adminClient = null;
    return null;
  }
  adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : null;
}

export async function loadPublicLeagueSnapshot(competitionId) {
  const db = getMasterLeagueDb();
  if (!db) return null;
  try {
    const { data: competition, error: competitionError } = await db
      .from('master_league_competitions')
      .select('*')
      .eq('id', competitionId)
      .maybeSingle();
    if (competitionError || !competition) return null;

    const [accountsResult, positionsResult, decisionsResult, commentsResult] = await Promise.all([
      db.from('master_league_accounts').select('*').eq('competition_id', competitionId).order('ranking'),
      db.from('master_league_positions').select('*').eq('competition_id', competitionId),
      db.from('master_league_decisions').select('*').eq('competition_id', competitionId).order('decision_date', { ascending: false }),
      db.from('master_league_comments').select('*').eq('competition_id', competitionId).order('created_at'),
    ]);
    if (accountsResult.error || positionsResult.error || decisionsResult.error || commentsResult.error) return null;

    const positionsByMaster = new Map();
    for (const row of positionsResult.data || []) {
      const list = positionsByMaster.get(row.master_id) || [];
      list.push({
        symbol: row.symbol,
        name: row.name,
        quantity: numeric(row.quantity),
        averagePrice: numeric(row.average_price),
        marketPrice: numeric(row.market_price),
        marketValue: numeric(row.market_value),
        profit: numeric(row.profit),
        profitRate: numeric(row.profit_rate),
        weight: numeric(row.weight),
      });
      positionsByMaster.set(row.master_id, list);
    }

    const commentsByDecision = new Map();
    for (const row of commentsResult.data || []) {
      const list = commentsByDecision.get(row.decision_id) || [];
      list.push({
        id: row.id,
        masterId: row.master_id,
        parentId: row.parent_id || '',
        likeCount: numeric(row.like_count),
        text: row.content,
        ownerReply: row.metadata?.ownerReply || '',
      });
      commentsByDecision.set(row.decision_id, list);
    }

    const decisionsByMaster = new Map();
    for (const row of decisionsResult.data || []) {
      const list = decisionsByMaster.get(row.master_id) || [];
      list.push({
        id: row.id,
        masterId: row.master_id,
        symbol: row.symbol || '',
        stockName: row.stock_name || '',
        action: row.action,
        targetPct: numeric(row.target_pct),
        reason: row.reason || '',
        risk: row.risk || '',
        changed: Boolean(row.metadata?.changed),
        changeNote: row.metadata?.changeNote || '',
        comments: commentsByDecision.get(row.id) || [],
        decisionDate: row.decision_date || '',
        executionDate: row.execution_date || '',
        executionPrice: row.execution_price == null ? null : numeric(row.execution_price),
        shares: row.shares == null ? null : numeric(row.shares),
        status: row.status || 'executed',
        note: row.metadata?.note || '',
      });
      decisionsByMaster.set(row.master_id, list);
    }

    const accounts = (accountsResult.data || []).map((row) => ({
      ...(row.master || {}),
      id: row.master_id,
      cash: numeric(row.cash),
      marketValue: numeric(row.market_value),
      totalAsset: numeric(row.total_asset),
      profit: numeric(row.profit),
      profitRate: numeric(row.profit_rate),
      todayProfit: numeric(row.today_profit),
      todayProfitRate: numeric(row.today_profit_rate),
      rank: numeric(row.ranking),
      previousRank: numeric(row.metadata?.previousRank, numeric(row.ranking)),
      rankChange: numeric(row.metadata?.rankChange),
      positions: positionsByMaster.get(row.master_id) || [],
      decisions: decisionsByMaster.get(row.master_id) || [],
      trades: [],
      curve: row.metadata?.curve || [],
    }));
    const ranking = accounts
      .sort((left, right) => left.rank - right.rank)
      .map((account) => ({ id: account.id, rank: account.rank, account }));

    return {
      accounts,
      ranking,
      dayCount: numeric(competition.settings?.dayCount),
      latestDate: competition.settings?.latestDate || '',
      headline: competition.settings?.headline || '',
      competition,
      fromDatabase: true,
    };
  } catch {
    return null;
  }
}

export async function savePublicLeagueSnapshot({ competition, league, dataSource, dataQuality }) {
  const db = getMasterLeagueDb();
  if (!db) return { enabled: false, synced: false, reason: 'missing_service_role' };

  try {
    const { error: competitionError } = await db.from('master_league_competitions').upsert({
      id: competition.id,
      mode: competition.mode,
      name: competition.name,
      organizer: competition.organizer,
      owner_id: null,
      initial_capital: competition.initialCapital,
      market: competition.market,
      start_date: competition.startDate,
      status: competition.status,
      settings: {
        dayCount: league.dayCount,
        latestDate: league.latestDate,
        headline: league.headline,
        dataSource,
        dataQuality,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (competitionError) throw competitionError;

    const accountRows = league.accounts.map((account) => {
      const master = { ...account };
      delete master.positions;
      delete master.decisions;
      delete master.trades;
      delete master.curve;
      return {
        id: `${competition.id}:${account.id}`,
        competition_id: competition.id,
        master_id: account.id,
        master,
        cash: account.cash,
        market_value: account.marketValue,
        total_asset: account.totalAsset,
        profit: account.profit,
        profit_rate: account.profitRate,
        today_profit: account.todayProfit,
        today_profit_rate: account.todayProfitRate,
        ranking: account.rank,
        metadata: {
          previousRank: account.previousRank,
          rankChange: account.rankChange,
          curve: account.curve,
        },
        updated_at: new Date().toISOString(),
      };
    });
    const { error: accountsError } = await db.from('master_league_accounts').upsert(accountRows, { onConflict: 'id' });
    if (accountsError) throw accountsError;

    const positionRows = league.accounts.flatMap((account) => (account.positions || []).map((position) => ({
      id: `${competition.id}:${account.id}:${position.symbol}`,
      competition_id: competition.id,
      master_id: account.id,
      symbol: position.symbol,
      name: position.name,
      quantity: position.quantity,
      average_price: position.averagePrice,
      market_price: position.marketPrice,
      market_value: position.marketValue,
      profit: position.profit,
      profit_rate: position.profitRate,
      weight: position.weight,
      updated_at: new Date().toISOString(),
    })));

    const decisionRows = league.accounts.flatMap((account) => (account.decisions || []).map((decision) => ({
      id: `${competition.id}:${decision.id}`,
      competition_id: competition.id,
      master_id: account.id,
      decision_date: isoDate(decision.decisionDate),
      execution_date: isoDate(decision.executionDate),
      action: decision.action,
      symbol: decision.symbol || null,
      stock_name: decision.stockName || null,
      target_pct: decision.targetPct,
      reason: decision.reason,
      risk: decision.risk,
      status: decision.status,
      execution_price: decision.executionPrice,
      shares: decision.shares,
      metadata: {
        changed: decision.changed,
        changeNote: decision.changeNote,
        note: decision.note,
      },
      created_at: new Date().toISOString(),
    })));

    const commentRows = league.accounts.flatMap((account) => (account.decisions || []).flatMap((decision) => (decision.comments || []).map((comment) => ({
      id: `${competition.id}:${decision.id}:${comment.id}`,
      competition_id: competition.id,
      decision_id: `${competition.id}:${decision.id}`,
      master_id: comment.masterId,
      parent_id: comment.parentId || null,
      content: comment.text,
      like_count: comment.likeCount || 0,
      metadata: { ownerReply: comment.ownerReply || '' },
      created_at: new Date().toISOString(),
    }))));

    await db.from('master_league_comments').delete().eq('competition_id', competition.id);
    await db.from('master_league_positions').delete().eq('competition_id', competition.id);
    await db.from('master_league_decisions').delete().eq('competition_id', competition.id);
    if (positionRows.length) {
      const { error } = await db.from('master_league_positions').insert(positionRows);
      if (error) throw error;
    }
    if (decisionRows.length) {
      const { error } = await db.from('master_league_decisions').insert(decisionRows);
      if (error) throw error;
    }
    if (commentRows.length) {
      const { error } = await db.from('master_league_comments').insert(commentRows);
      if (error) throw error;
    }
    return { enabled: true, synced: true };
  } catch (error) {
    return { enabled: true, synced: false, reason: String(error?.message || error).slice(0, 180) };
  }
}
