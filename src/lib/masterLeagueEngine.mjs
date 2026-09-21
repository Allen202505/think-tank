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

function holdingNames(positions) {
  return [...positions.values()]
    .map((position) => position.name || position.symbol)
    .filter(Boolean);
}

export function filterCompetitionDates(dateList = [], startDate = '') {
  if (!startDate) return [...dateList];
  return (dateList || []).filter((date) => String(date || '') >= String(startDate));
}

function executionPriority(action) {
  if (action === '清仓' || action === '卖出' || action === '减仓') return 0;
  if (action === '持有') return 2;
  return 1;
}

// 从成交记录重建每只股票的生命周期。即使已经清仓，也保留最后一次清仓的
// 数量、价格、金额和已实现收益，供前端持仓历史持续展示。
export function buildPositionHistory(trades, positions = []) {
  const latestPositions = new Map((positions || []).map((position) => [position.symbol, position]));
  const histories = new Map();
  const ordered = (trades || []).map((trade, index) => ({ trade, index })).sort((a, b) => {
    const byDate = String(a.trade?.date || '').localeCompare(String(b.trade?.date || ''));
    return byDate || a.index - b.index;
  });

  for (const { trade } of ordered) {
    const symbol = String(trade?.symbol || '').trim();
    if (!symbol) continue;
    const action = String(trade?.action || '');
    const isBuy = action === '买入' || action === '加仓';
    const quantity = Math.abs(Number(trade.quantity) || 0);
    const price = Math.max(0, Number(trade.price) || 0);
    const amount = Math.max(0, Number(trade.amount) || quantity * price);
    if (!quantity || !price) continue;

    if (!histories.has(symbol)) {
      histories.set(symbol, {
        symbol,
        name: trade.name || symbol,
        quantity: 0,
        averagePrice: 0,
        latestPrice: price,
        firstBuyDate: '',
        lastTradeDate: '',
        buyCount: 0,
        sellCount: 0,
        totalBuyAmount: 0,
        totalSellAmount: 0,
        realizedProfit: 0,
        clearDate: '',
        clearQuantity: 0,
        clearPrice: 0,
        clearAmount: 0,
      });
    }

    const item = histories.get(symbol);
    item.name = trade.name || item.name;
    item.lastTradeDate = trade.date || item.lastTradeDate;
    item.latestPrice = price;

    if (isBuy) {
      const nextQuantity = item.quantity + quantity;
      item.averagePrice = nextQuantity > 0
        ? ((item.quantity * item.averagePrice) + (quantity * price)) / nextQuantity
        : price;
      item.quantity = nextQuantity;
      item.totalBuyAmount += amount;
      item.buyCount += 1;
      if (!item.firstBuyDate) item.firstBuyDate = trade.date || '';
      continue;
    }

    const soldQuantity = Math.min(quantity, item.quantity);
    if (soldQuantity <= 0) continue;
    const soldAmount = amount || soldQuantity * price;
    item.realizedProfit += (price - item.averagePrice) * soldQuantity;
    item.totalSellAmount += soldAmount;
    item.sellCount += 1;
    item.quantity -= soldQuantity;
    if (item.quantity <= 0) {
      item.quantity = 0;
      item.averagePrice = 0;
      item.clearDate = trade.date || item.clearDate;
      item.clearQuantity = soldQuantity;
      item.clearPrice = price;
      item.clearAmount = soldAmount;
    }
  }

  return [...histories.values()].map((item) => {
    const current = latestPositions.get(item.symbol);
    const isHolding = item.quantity > 0;
    const latestPrice = isHolding && current?.marketPrice != null ? Number(current.marketPrice) : Number(item.latestPrice) || 0;
    const averagePrice = isHolding && current?.averagePrice != null ? Number(current.averagePrice) : Number(item.averagePrice) || 0;
    const marketValue = isHolding ? item.quantity * latestPrice : 0;
    const unrealizedProfit = isHolding ? (latestPrice - averagePrice) * item.quantity : 0;
    const realizedProfit = Number(item.realizedProfit) || 0;
    const totalProfit = realizedProfit + unrealizedProfit;
    return {
      ...item,
      name: current?.name || item.name,
      status: isHolding ? 'holding' : 'closed',
      quantity: item.quantity,
      averagePrice: roundMoney(averagePrice),
      latestPrice: roundMoney(latestPrice),
      marketValue: roundMoney(marketValue),
      realizedProfit: roundMoney(realizedProfit),
      unrealizedProfit: roundMoney(unrealizedProfit),
      totalProfit: roundMoney(totalProfit),
      returnRate: item.totalBuyAmount > 0 ? roundRate(totalProfit / item.totalBuyAmount) : 0,
      clearPrice: roundMoney(item.clearPrice),
      clearAmount: roundMoney(item.clearAmount),
    };
  }).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'holding' ? -1 : 1;
    return String(b.lastTradeDate).localeCompare(String(a.lastTradeDate));
  });
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
    const wantsIncrease = plan.action !== '持有' && desiredValue > 0 && (
      targetQuantity > current.quantity || (!current.quantity && targetQuantity === 0)
    );
    const blocked = wantsIncrease;
    return {
      cash,
      positions,
      trade: null,
      actualQuantity: current.quantity,
      blocked,
      note: plan.action === '持有'
        ? '按计划持有'
        : blocked
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

function decisionFromPlan({ plan, masterId, symbolName, status, decisionDate, executionDate, executionPrice, shares, note, rankAtDecision, currentHoldingNames = [] }) {
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
    holdingNames: currentHoldingNames,
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
      const openingHoldingNames = holdingNames(positions);
      const openingPlans = plans
        .filter((plan) => dateList.length - plan.offset === index)
        .sort((a, b) => executionPriority(a.action) - executionPriority(b.action));
      for (const plan of openingPlans) {
        // 「持有」且不指定个股 = 明确的「今天不动」，不需要行情也不产生交易
        if (plan.action === '持有' && !plan.symbol) {
          decisions.push(decisionFromPlan({
            plan, masterId: master.id, symbolName: '不动', status: 'executed',
            decisionDate: previousDate, executionDate: date, executionPrice: null, shares: null,
            note: '按计划持有，无操作', currentHoldingNames: openingHoldingNames,
          }));
          continue;
        }
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
      const isGenericHold = plan.action === '持有' && !plan.symbol;
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
        currentHoldingNames: isGenericHold ? holdingNames(positions) : [],
      }));
    }

    const totalAsset = curve[curve.length - 1]?.totalAsset ?? initialCapital;
    const previousAsset = curve[curve.length - 2]?.totalAsset ?? initialCapital;
    const totalProfit = totalAsset - initialCapital;
    const positionRows = serializePositions(positions, lookup, finalDate);
    for (const row of positionRows) row.weight = totalAsset > 0 ? roundRate(row.marketValue / totalAsset) : 0;
    const positionHistory = buildPositionHistory(trades, positionRows);

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
      positionHistory,
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
    dayCount: Math.max(0, dateList.length),
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
    positionHistory: [],
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
