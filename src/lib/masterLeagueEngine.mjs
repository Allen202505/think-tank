// 大师实盘联赛结算引擎（纯函数，可单测）。
// 交易计划在决策日收盘后生成，于下一交易日开盘执行；每日收盘按真实收盘价重新计算净值。

const LOT_SIZE = 100;
const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;
const roundRate = (value) => Math.round((Number(value) || 0) * 10000) / 10000;

function lotFloor(value, price) {
  if (!(value > 0) || !(price > 0)) return 0;
  return Math.max(0, Math.floor(value / price / LOT_SIZE) * LOT_SIZE);
}

function getDateList(barsBySymbol, preferredSymbol) {
  const preferred = barsBySymbol?.[preferredSymbol];
  const source = Array.isArray(preferred) && preferred.length
    ? preferred
    : Object.values(barsBySymbol || {}).find((bars) => Array.isArray(bars) && bars.length);
  return (source || []).map((bar) => bar.date).filter(Boolean);
}

function buildBarLookup(barsBySymbol) {
  const lookup = {};
  for (const [symbol, bars] of Object.entries(barsBySymbol || {})) {
    lookup[symbol] = new Map((bars || []).map((bar) => [bar.date, bar]));
  }
  return lookup;
}

function findBar(lookup, symbol, date) {
  return lookup?.[symbol]?.get(date) || null;
}

function marketValueAt(positions, lookup, date) {
  let value = 0;
  for (const [symbol, position] of positions.entries()) {
    const bar = findBar(lookup, symbol, date);
    if (bar?.close > 0) value += position.quantity * bar.close;
  }
  return value;
}

function serializePositions(positions, lookup, latestDate) {
  const rows = [];
  for (const [symbol, position] of positions.entries()) {
    const bar = findBar(lookup, symbol, latestDate);
    const marketPrice = bar?.close ?? position.averagePrice;
    const marketValue = position.quantity * marketPrice;
    const costValue = position.quantity * position.averagePrice;
    const profit = marketValue - costValue;
    rows.push({
      symbol,
      name: position.name,
      quantity: position.quantity,
      averagePrice: roundMoney(position.averagePrice),
      marketPrice: roundMoney(marketPrice),
      marketValue: roundMoney(marketValue),
      profit: roundMoney(profit),
      profitRate: costValue > 0 ? roundRate(profit / costValue) : 0,
      weight: 0,
    });
  }
  return rows;
}

function applyTrade({ cash, positions, plan, price, symbolName, date, masterId, equityBeforeOpen }) {
  const current = positions.get(plan.symbol) || {
    symbol: plan.symbol,
    name: symbolName,
    quantity: 0,
    averagePrice: 0,
  };

  const targetPct = Math.max(0, Math.min(100, Number(plan.targetPct) || 0));
  const desiredValue = equityBeforeOpen * (targetPct / 100);

  let targetQuantity = lotFloor(desiredValue, price);
  if (plan.action === '持有') targetQuantity = current.quantity;
  if (plan.action === '清仓' || plan.action === '卖出') targetQuantity = 0;

  let delta = targetQuantity - current.quantity;
  if (delta > 0) {
    const affordable = lotFloor(cash, price);
    if (delta > affordable) delta = affordable;
  } else if (delta < 0) {
    delta = -Math.min(Math.abs(delta), current.quantity);
  }

  if (!delta) {
    return {
      cash,
      positions,
      trade: null,
      actualQuantity: current.quantity,
      blocked: !current.quantity && targetQuantity === 0 && desiredValue > 0,
      note: plan.action === '持有'
        ? '按计划持有'
        : !current.quantity && targetQuantity === 0 && desiredValue > 0
          ? '资金不足一手，未执行'
          : '目标仓位已在开盘前满足',
    };
  }

  const next = { ...current };
  const amount = Math.abs(delta) * price;
  if (delta > 0) {
    const nextQuantity = current.quantity + delta;
    next.averagePrice = nextQuantity > 0
      ? ((current.quantity * current.averagePrice) + (delta * price)) / nextQuantity
      : price;
    next.quantity = nextQuantity;
    cash -= amount;
  } else {
    next.quantity += delta;
    cash += amount;
  }

  if (next.quantity <= 0) positions.delete(plan.symbol);
  else positions.set(plan.symbol, next);

  return {
    cash,
    positions,
    actualQuantity: next.quantity,
    trade: {
      id: `trade-${plan.id}`,
      masterId,
      date,
      action: delta > 0 ? (current.quantity > 0 ? '加仓' : '买入') : (next.quantity === 0 ? '清仓' : '减仓'),
      symbol: plan.symbol,
      name: symbolName,
      quantity: Math.abs(delta),
      price: roundMoney(price),
      amount: roundMoney(amount),
    },
    note: '',
  };
}

function decisionFromPlan({ plan, masterId, symbolName, status, decisionDate, executionDate, executionPrice, shares, note, rankAtDecision }) {
  return {
    id: plan.id,
    masterId,
    symbol: plan.symbol,
    stockName: symbolName,
    action: plan.action,
    targetPct: plan.targetPct,
    reason: plan.reason,
    risk: plan.risk,
    changed: Boolean(plan.changed),
    changeNote: plan.changeNote || '',
    comments: plan.comments || [],
    decisionDate,
    executionDate,
    executionPrice: executionPrice == null ? null : roundMoney(executionPrice),
    shares: shares ?? null,
    status,
    note: note || '',
    rankAtDecision: rankAtDecision || null,
  };
}

function rankMasters(accounts, getRate, getAsset) {
  return [...accounts]
    .map((account) => ({ id: account.id, rate: getRate(account), asset: getAsset(account) }))
    .sort((a, b) => b.rate - a.rate || b.asset - a.asset || a.id.localeCompare(b.id))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function buildHeadline(ranking, previousRanking, masterMap) {
  const leader = ranking[0];
  if (!leader) return '联赛等待开赛';
  const previousLeader = previousRanking[0];
  if (previousLeader && previousLeader.id !== leader.id) {
    return `🔥 ${masterMap[leader.id]?.shortName || leader.id} 反超登顶，今日排名第一`;
  }
  const mover = ranking.find((row) => {
    const before = previousRanking.find((item) => item.id === row.id);
    return before && before.rank - row.rank >= 1 && row.rank > 1;
  });
  if (mover) return `${masterMap[mover.id]?.shortName || mover.id} 升至第 ${mover.rank} 名，榜单出现变化`;
  return `${masterMap[leader.id]?.shortName || leader.id} 继续领跑，优势和风险都在积累`;
}

export function settleMasterLeague({
  masters,
  plansByMaster,
  barsBySymbol,
  symbolMeta,
  latestDate,
  dateList: suppliedDateList,
  initialCapital = 100000,
}) {
  const dateList = Array.isArray(suppliedDateList) && suppliedDateList.length
    ? suppliedDateList
    : getDateList(barsBySymbol, Object.keys(symbolMeta || {})[0]);
  const finalDate = latestDate || dateList[dateList.length - 1] || null;
  const lookup = buildBarLookup(barsBySymbol);
  const masterMap = Object.fromEntries((masters || []).map((master) => [master.id, master]));

  const accounts = (masters || []).map((master) => {
    let cash = initialCapital;
    const positions = new Map();
    const trades = [];
    const decisions = [];
    const curve = [];
    const plans = plansByMaster?.[master.id] || [];

    for (let index = 0; index < dateList.length; index += 1) {
      const date = dateList[index];
      const previousDate = dateList[index - 1] || date;
      const openingPlans = plans.filter((plan) => dateList.length - plan.offset === index);
      for (const plan of openingPlans) {
        const bar = findBar(lookup, plan.symbol, date);
        const symbolName = symbolMeta?.[plan.symbol]?.name || plan.symbol;
        if (!bar?.open || bar.open <= 0) {
          decisions.push(decisionFromPlan({
            plan, masterId: master.id, symbolName, status: 'skipped', decisionDate: previousDate,
            executionDate: date, executionPrice: null, shares: null, note: '行情缺失，未执行',
          }));
          continue;
        }
        const previousCloseDate = previousDate === date ? date : previousDate;
        const equityBeforeOpen = cash + marketValueAt(positions, lookup, previousCloseDate);
        const result = applyTrade({
          cash,
          positions,
          plan,
          price: bar.open,
          symbolName,
          date,
          masterId: master.id,
          equityBeforeOpen,
        });
        cash = result.cash;
        if (result.trade) trades.push(result.trade);
        decisions.push(decisionFromPlan({
          plan,
          masterId: master.id,
          symbolName,
          status: result.blocked ? 'skipped' : 'executed',
          decisionDate: previousDate,
          executionDate: date,
          executionPrice: bar.open,
          shares: result.actualQuantity,
          note: result.note,
        }));
      }

      const marketValue = marketValueAt(positions, lookup, date);
      const totalAsset = cash + marketValue;
      const previous = curve[curve.length - 1];
      curve.push({
        date,
        totalAsset: roundMoney(totalAsset),
        cash: roundMoney(cash),
        marketValue: roundMoney(marketValue),
        dailyGain: roundMoney(previous ? totalAsset - previous.totalAsset : 0),
      });
    }

    for (const plan of plans.filter((item) => item.offset === 0)) {
      decisions.push(decisionFromPlan({
        plan,
        masterId: master.id,
        symbolName: symbolMeta?.[plan.symbol]?.name || plan.symbol,
        status: 'pending',
        decisionDate: finalDate,
        executionDate: '下一交易日',
        executionPrice: null,
        shares: null,
        note: '等待下一交易日开盘执行',
      }));
    }

    const totalAsset = curve[curve.length - 1]?.totalAsset ?? initialCapital;
    const previousAsset = curve[curve.length - 2]?.totalAsset ?? initialCapital;
    const totalProfit = totalAsset - initialCapital;
    const positionRows = serializePositions(positions, lookup, finalDate);
    for (const row of positionRows) row.weight = totalAsset > 0 ? roundRate(row.marketValue / totalAsset) : 0;

    return {
      ...master,
      cash: roundMoney(cash),
      marketValue: roundMoney(totalAsset - cash),
      totalAsset: roundMoney(totalAsset),
      profit: roundMoney(totalProfit),
      profitRate: roundRate(totalProfit / initialCapital),
      todayProfit: roundMoney(totalAsset - previousAsset),
      todayProfitRate: previousAsset > 0 ? roundRate((totalAsset - previousAsset) / previousAsset) : 0,
      positions: positionRows,
      trades: trades.reverse(),
      decisions: decisions.reverse(),
      curve,
      rank: 0,
      previousRank: 0,
      rankChange: 0,
    };
  });

  const ranking = rankMasters(accounts, (account) => account.profitRate, (account) => account.totalAsset);
  const previousRanking = rankMasters(accounts, (account) => {
    const prior = account.curve[account.curve.length - 2];
    const asset = prior?.totalAsset ?? initialCapital;
    return (asset - initialCapital) / initialCapital;
  }, (account) => {
    const prior = account.curve[account.curve.length - 2];
    return prior?.totalAsset ?? initialCapital;
  });

  for (const account of accounts) {
    const current = ranking.find((row) => row.id === account.id);
    const before = previousRanking.find((row) => row.id === account.id);
    account.rank = current?.rank || accounts.length;
    account.previousRank = before?.rank || account.rank;
    account.rankChange = account.previousRank - account.rank;
  }

  return {
    accounts,
    ranking: ranking.map((row) => ({
      ...row,
      account: accounts.find((account) => account.id === row.id),
    })),
    dayCount: Math.max(0, dateList.length - 1),
    latestDate: finalDate,
    headline: buildHeadline(ranking, previousRanking, masterMap),
  };
}

export function buildPendingLeague({ masters, plansByMaster, symbolMeta, initialCapital = 100000, reason = '' }) {
  const accounts = (masters || []).map((master) => ({
    ...master,
    cash: initialCapital,
    marketValue: 0,
    totalAsset: initialCapital,
    profit: 0,
    profitRate: 0,
    todayProfit: 0,
    todayProfitRate: 0,
    positions: [],
    trades: [],
    decisions: (plansByMaster?.[master.id] || [])
      .filter((plan) => plan.offset === 0)
      .map((plan) => decisionFromPlan({
        plan,
        masterId: master.id,
        symbolName: symbolMeta?.[plan.symbol]?.name || plan.symbol,
        status: 'pending',
        decisionDate: '',
        executionDate: '下一交易日',
        executionPrice: null,
        shares: null,
        note: '等待行情恢复后启动结算',
      })),
    curve: [],
    rank: 0,
    previousRank: 0,
    rankChange: 0,
  }));
  const ranking = rankMasters(accounts, (account) => account.profitRate, (account) => account.totalAsset);
  for (const account of accounts) account.rank = ranking.find((row) => row.id === account.id)?.rank || 1;
  return {
    accounts,
    ranking: ranking.map((row) => ({
      ...row,
      account: accounts.find((account) => account.id === row.id),
    })),
    dayCount: 0,
    latestDate: null,
    headline: reason || '行情源连接中，联赛暂按初始资金展示',
  };
}

export const __test__ = { lotFloor, applyTrade, rankMasters };
