import test from 'node:test';
import assert from 'node:assert/strict';
import { __test__, buildPendingLeague, buildPositionHistory, filterCompetitionDates, settleMasterLeague } from '../src/lib/masterLeagueEngine.mjs';
import { buildInvitedAccounts, mergeInvitedLeague, rankLeagueByReturnRate } from '../src/lib/masterLeagueInvites.mjs';
import { classifyInviteError, inviteDeleteMode } from '../src/lib/leagueInvitePolicy.mjs';
import { LEAGUE_MASTERS, LEAGUE_PLANS, PUBLIC_LEAGUE } from '../src/data/masterLeague.js';

const masters = [
  { id: 'a', name: '大师甲', shortName: '甲', style: '趋势' },
  { id: 'b', name: '大师乙', shortName: '乙', style: '价值' },
];

test('公开赛配置为 6 位已故历史大师并包含简介', () => {
  assert.equal(LEAGUE_MASTERS.length, 6);
  assert.deepEqual(LEAGUE_MASTERS.map((master) => master.id), ['livermore', 'wyckoff', 'darvas', 'loeb', 'kostolany', 'baruch']);
  assert.ok(LEAGUE_MASTERS.every((master) => master.status === 'deceased' && master.intro && master.aShareAngle));
  assert.ok(LEAGUE_MASTERS.every((master) => LEAGUE_PLANS[master.id]?.length >= 2));
});

test('威科夫、科斯托拉尼和巴鲁克使用全名并配置头像与详细简介', () => {
  const byId = Object.fromEntries(LEAGUE_MASTERS.map((master) => [master.id, master]));
  assert.equal(byId.wyckoff.name, '理查德·D·威科夫');
  assert.equal(byId.wyckoff.shortName, '理查德·D·威科夫');
  assert.equal(byId.kostolany.shortName, '安德烈·科斯托拉尼');
  assert.equal(byId.baruch.shortName, '伯纳德·巴鲁克');
  for (const id of ['wyckoff', 'kostolany', 'baruch']) assert.match(byId[id].avatar, /^\/avatars\/.+\.jpg$/);
  assert.match(byId.baruch.biography, /巴鲁克计划/);
  assert.match(byId.baruch.biography, /华尔街孤狼/);
  assert.ok(LEAGUE_MASTERS.every((master) => master.biography && master.biography.length >= 250));
});

test('比赛交易日从 2026-09-14 开赛日截取，首日计入且 curve 从开赛日开始', () => {
  const allDates = ['2026-09-11', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21'];
  const dateList = filterCompetitionDates(allDates, PUBLIC_LEAGUE.startDate);
  assert.deepEqual(dateList, ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21']);
  const result = settleMasterLeague({
    masters: [masters[0]],
    plansByMaster: { a: [] },
    barsBySymbol: {},
    symbolMeta: {},
    latestDate: '2026-09-21',
    dateList,
  });
  assert.equal(result.dayCount, 6);
  assert.equal(result.accounts[0].curve.length, 6);
  assert.equal(result.accounts[0].curve[0].date, '2026-09-14');
  assert.equal(result.accounts[0].curve[5].date, '2026-09-21');
});

test('lotFloor 遵守 A 股 100 股买入单位', () => {
  assert.equal(__test__.lotFloor(1000, 10), 100);
  assert.equal(__test__.lotFloor(999, 10), 0);
  assert.equal(__test__.lotFloor(25000, 12), 2000);
});

test('settleMasterLeague 按下一交易日开盘价执行、收盘价结算', () => {
  const bars = [
    { date: '2026-09-01', open: 10, close: 10 },
    { date: '2026-09-02', open: 10, close: 11 },
    { date: '2026-09-03', open: 12, close: 12 },
    { date: '2026-09-04', open: 11, close: 13 },
    { date: '2026-09-05', open: 13, close: 13 },
  ];
  const result = settleMasterLeague({
    masters,
    plansByMaster: {
      a: [{
        id: 'a-01', offset: 3, action: '买入', symbol: '600000', targetPct: 50,
        reason: '突破确认', risk: '跌回区间', comments: [],
      }],
      b: [],
    },
    barsBySymbol: { '600000': bars },
    symbolMeta: { '600000': { name: '测试股份' } },
    latestDate: '2026-09-05',
  });
  const account = result.accounts.find((item) => item.id === 'a');
  assert.equal(account.decisions[0].executionPrice, 12);
  assert.equal(account.decisions[0].shares, 4100);
  assert.equal(account.positions[0].quantity, 4100);
  assert.equal(account.totalAsset, 104100);
  assert.equal(account.profit, 4100);
  assert.equal(result.ranking[0].id, 'a');
});

test('同日计划先执行卖出再执行买入，卖出资金可覆盖后续买入', () => {
  const bars = [
    { date: '2026-09-01', open: 10, close: 10 },
    { date: '2026-09-02', open: 10, close: 10 },
    { date: '2026-09-03', open: 10, close: 10 },
  ];
  const result = settleMasterLeague({
    masters: [masters[0]],
    plansByMaster: {
      a: [
        { id: 'first-buy', offset: 2, action: '买入', symbol: '600000', targetPct: 99, reason: '先建立高仓位', risk: '资金不足', comments: [] },
        { id: 'next-buy', offset: 1, action: '买入', symbol: '600001', targetPct: 50, reason: '换仓买入', risk: '资金不足', comments: [] },
        { id: 'free-cash', offset: 1, action: '卖出', symbol: '600000', targetPct: 0, reason: '卖出腾挪资金', risk: '卖飞', comments: [] },
      ],
    },
    barsBySymbol: { 600000: bars, 600001: bars },
    symbolMeta: { 600000: { name: '测试股份甲' }, 600001: { name: '测试股份乙' } },
    latestDate: '2026-09-03',
  });
  const account = result.accounts[0];
  const nextBuy = account.decisions.find((item) => item.id === 'next-buy');
  assert.equal(nextBuy.status, 'executed');
  assert.equal(nextBuy.shares, 5000);
  assert.equal(account.positions.some((position) => position.symbol === '600001' && position.quantity === 5000), true);
  assert.equal(account.positions.some((position) => position.symbol === '600000'), false);
});

test('settleMasterLeague 的持有计划不产生虚假交易', () => {
  const bars = [
    { date: '2026-09-01', open: 10, close: 10 },
    { date: '2026-09-02', open: 10, close: 10 },
    { date: '2026-09-03', open: 10, close: 10 },
  ];
  const result = settleMasterLeague({
    masters: [masters[0]],
    plansByMaster: {
      a: [{
        id: 'a-hold', offset: 1, action: '持有', symbol: '600000', targetPct: 0,
        reason: '没有变化', risk: '等待', comments: [],
      }],
    },
    barsBySymbol: { '600000': bars },
    symbolMeta: { '600000': { name: '测试股份' } },
    latestDate: '2026-09-03',
  });
  assert.equal(result.accounts[0].trades.length, 0);
  assert.equal(result.accounts[0].totalAsset, 100000);
});

test('已清仓股票保留清仓时间、数量、价格、金额和已实现收益', () => {
  const [record] = buildPositionHistory([
    { date: '2026-09-01', action: '买入', symbol: '600000', name: '测试股份', quantity: 1000, price: 10, amount: 10000 },
    { date: '2026-09-10', action: '清仓', symbol: '600000', name: '测试股份', quantity: 1000, price: 12, amount: 12000 },
  ]);
  assert.equal(record.status, 'closed');
  assert.equal(record.clearDate, '2026-09-10');
  assert.equal(record.clearQuantity, 1000);
  assert.equal(record.clearPrice, 12);
  assert.equal(record.clearAmount, 12000);
  assert.equal(record.realizedProfit, 2000);
  assert.equal(record.totalProfit, 2000);
  assert.equal(record.returnRate, 0.2);
});

test('部分卖出后再清仓仍保留最终清仓记录', () => {
  const [record] = buildPositionHistory([
    { date: '2026-09-01', action: '买入', symbol: '600000', name: '测试股份', quantity: 1000, price: 10, amount: 10000 },
    { date: '2026-09-08', action: '减仓', symbol: '600000', name: '测试股份', quantity: 400, price: 11, amount: 4400 },
    { date: '2026-09-12', action: '清仓', symbol: '600000', name: '测试股份', quantity: 600, price: 12, amount: 7200 },
  ]);
  assert.equal(record.status, 'closed');
  assert.equal(record.clearQuantity, 600);
  assert.equal(record.clearPrice, 12);
  assert.equal(record.clearAmount, 7200);
  assert.equal(record.realizedProfit, 1600);
});

test('settleMasterLeague 不会伪造不足一手的买入', () => {
  const bars = [
    { date: '2026-09-01', open: 1500, close: 1500 },
    { date: '2026-09-02', open: 1500, close: 1500 },
    { date: '2026-09-03', open: 1500, close: 1500 },
  ];
  const result = settleMasterLeague({
    masters: [masters[0]],
    plansByMaster: {
      a: [{
        id: 'a-expensive', offset: 1, action: '买入', symbol: '600000', targetPct: 35,
        reason: '价格合理', risk: '资金不足', comments: [],
      }],
    },
    barsBySymbol: { '600000': bars },
    symbolMeta: { '600000': { name: '高价股份' } },
    latestDate: '2026-09-03',
  });
  assert.equal(result.accounts[0].trades.length, 0);
  assert.equal(result.accounts[0].decisions[0].status, 'skipped');
  assert.equal(result.accounts[0].decisions[0].note, '资金不足一手，未执行');
});

test('资金不足导致目标股数为正但无法买入时标记未执行，不生成 0 股成交', () => {
  const bars = [
    { date: '2026-09-01', open: 100, close: 100 },
    { date: '2026-09-02', open: 100, close: 100 },
    { date: '2026-09-03', open: 100, close: 100 },
  ];
  const result = settleMasterLeague({
    masters: [masters[0]],
    plansByMaster: {
      a: [
        { id: 'first-buy', offset: 1, action: '买入', symbol: '600000', targetPct: 90, reason: '先用掉大部分现金', risk: '现金不足', comments: [] },
        { id: 'blocked-buy', offset: 1, action: '买入', symbol: '600001', targetPct: 25, reason: '第二笔计划', risk: '现金不足', comments: [] },
      ],
    },
    barsBySymbol: { '600000': bars, '600001': [{ ...bars[0], open: 150, close: 150 }, { ...bars[1], open: 150, close: 150 }, { ...bars[2], open: 150, close: 150 }] },
    symbolMeta: { '600000': { name: '测试股份甲' }, '600001': { name: '测试股份乙' } },
    latestDate: '2026-09-03',
  });
  const blocked = result.accounts[0].decisions.find((item) => item.id === 'blocked-buy');
  assert.equal(blocked.status, 'skipped');
  assert.equal(blocked.shares, 0);
  assert.equal(blocked.note, '资金不足一手，未执行');
  assert.equal(result.accounts[0].trades.some((trade) => trade.id === 'trade-blocked-buy'), false);
});

test('行情不可用时只生成待执行计划，不伪造收益', () => {
  const pending = buildPendingLeague({
    masters,
    plansByMaster: {
      a: [{ id: 'a-next', offset: 0, action: '买入', symbol: '600000', targetPct: 20, reason: '等待', risk: '缺数据', comments: [] }],
      b: [],
    },
    symbolMeta: { '600000': { name: '测试股份' } },
    reason: '行情源不可用',
  });
  assert.equal(pending.accounts[0].totalAsset, 100000);
  assert.equal(pending.accounts[0].trades.length, 0);
  assert.equal(pending.accounts[0].positions.length, 0);
  assert.equal(pending.accounts[0].decisions[0].status, 'pending');
});

test('用户邀请大师参赛后赠送 10 万初始额度', () => {
  const [invited] = buildInvitedAccounts([{ id: 'custom_invite', name: '邀请大师', shortName: '邀请大师', style: '趋势' }]);
  assert.equal(invited.cash, 100000);
  assert.equal(invited.totalAsset, 100000);
  assert.equal(invited.profitRate, 0);
  assert.equal(invited.positions.length, 0);
  assert.equal(invited.decisions[0].status, 'pending');
});

test('公开赛排名按累计收益率而不是收益绝对值排序', () => {
  const ranked = rankLeagueByReturnRate([
    { id: 'a', totalAsset: 180000, profitRate: 0.1 },
    { id: 'b', totalAsset: 105000, profitRate: 0.2 },
  ]);
  assert.equal(ranked.ranking[0].id, 'b');
  assert.equal(ranked.ranking[1].id, 'a');
});

test('邀请大师可直接合并到公开赛排名', () => {
  const base = {
    accounts: [{ id: 'official', totalAsset: 100000, profitRate: 0, cash: 100000, positions: [], decisions: [], curve: [] }],
    ranking: [{ id: 'official', rank: 1, account: { id: 'official', totalAsset: 100000, profitRate: 0, cash: 100000, positions: [], decisions: [], curve: [] } }],
  };
  const merged = mergeInvitedLeague(base, [{ id: 'custom_invite', name: '邀请大师', shortName: '邀请大师', style: '趋势' }]);
  assert.ok(merged.accounts.some((account) => account.id === 'custom_invite' && account.totalAsset === 100000));
  assert.equal(merged.accounts.length, 2);
});

test('邀请底表未初始化时静默降级，不把数据库报错抛给访客', () => {
  assert.equal(classifyInviteError({ code: 'PGRST205', message: "Could not find the table 'public.master_league_invites' in the schema cache" }), 'missing_relation');
  assert.equal(classifyInviteError({ code: '42P01', message: 'relation "master_league_invites" does not exist' }), 'missing_relation');
  assert.equal(classifyInviteError({ code: '42703', message: 'column profiles.is_admin does not exist' }), 'missing_column');
  assert.equal(classifyInviteError({ code: '42501', message: 'new row violates row-level security policy for table "master_league_invites"' }), 'blocked');
  assert.equal(classifyInviteError({ code: '23505', message: 'duplicate key value violates unique constraint' }), 'unknown');
  assert.equal(classifyInviteError(null), 'unknown');
});

test('邀请人自己删除走真删，管理员处理违规内容走黑名单下架', () => {
  assert.equal(inviteDeleteMode({ isOwner: true }), 'delete');
  assert.equal(inviteDeleteMode({ isOwner: true, isAdmin: true }), 'delete');
  assert.equal(inviteDeleteMode({ isAdmin: true, isOwner: false }), 'block');
  assert.equal(inviteDeleteMode({ isAdmin: true }), 'block');
  assert.equal(inviteDeleteMode({}), 'forbidden');
  assert.equal(inviteDeleteMode(), 'forbidden');
});

test('互评配对正确：每条点评都点评对了人，且不是自己点评自己', () => {
  const ids = LEAGUE_MASTERS.map((master) => master.id);
  let total = 0;
  const commenters = new Map();
  for (const [master, plans] of Object.entries(LEAGUE_PLANS)) {
    for (const plan of plans) {
      for (const comment of plan.comments || []) {
        total += 1;
        // id 形如 wyckoff-on-livermore / kostolany-on-darvas-2 → 后缀即被点评的大师
        const tail = String(comment.id).split('-on-')[1] || '';
        const owner = ids.find((id) => tail === id || tail.startsWith(`${id}-`));
        assert.equal(owner, master, `${plan.id} 挂的点评 ${comment.id} 点评对象应为 ${master}`);
        assert.notEqual(comment.masterId, master, '不能自己点评自己');
        assert.ok(ids.includes(comment.masterId), `点评人 ${comment.masterId} 必须是参赛大师`);
        assert.ok(String(comment.text || '').length >= 12, '点评文案不能太短');
        assert.ok(String(comment.ownerReply || '').length >= 6, '每条点评都要有本人的回怼');
        const set = commenters.get(master) || new Set();
        set.add(comment.masterId);
        commenters.set(master, set);
      }
    }
  }
  // 每位大师至少被 3 位不同大师点评过，评论区才不至于只有两个声音
  for (const [master, set] of commenters) {
    assert.ok(set.size >= 3, `${master} 只被 ${set.size} 位大师点评，声音太单一`);
  }
  assert.ok(total >= 60, `互评总量偏少：${total}`);
});

test('无标的的「持有」不该被当成行情缺失', () => {
  const bars = [
    { date: '2026-09-01', open: 10, close: 10 },
    { date: '2026-09-02', open: 10, close: 10 },
    { date: '2026-09-03', open: 10, close: 10 },
  ];
  const result = settleMasterLeague({
    masters: [masters[0]],
    plansByMaster: {
      a: [
        { id: 'hold-no-symbol', offset: 1, action: '持有', symbol: null, targetPct: 0, reason: '没有值得做的机会，按兵不动等信号', risk: '错过机会', comments: [] },
      ],
    },
    barsBySymbol: { '600000': bars },
    symbolMeta: {},
    latestDate: '2026-09-03',
  });
  const decision = result.accounts[0].decisions.find((item) => item.id === 'hold-no-symbol');
  assert.equal(decision.status, 'executed');
  assert.equal(decision.note, '按计划持有，无操作');
  assert.equal(result.accounts[0].trades.length, 0);
});

test('无标的的「持有」展示执行日前实际持仓，待执行计划展示最新持仓', () => {
  const bars = [
    { date: '2026-09-01', open: 10, close: 10 },
    { date: '2026-09-02', open: 10, close: 10 },
    { date: '2026-09-03', open: 10, close: 10 },
  ];
  const result = settleMasterLeague({
    masters: [masters[0]],
    plansByMaster: {
      a: [
        { id: 'buy-before-hold', offset: 2, action: '买入', symbol: '600000', targetPct: 50, reason: '建立底仓', risk: '跌破', comments: [] },
        { id: 'hold-existing', offset: 1, action: '持有', symbol: '', targetPct: 0, reason: '继续观察', risk: '等待', comments: [] },
        { id: 'hold-next-day', offset: 0, action: '持有', symbol: '', targetPct: 0, reason: '明日继续观察', risk: '等待', comments: [] },
      ],
    },
    barsBySymbol: { '600000': bars },
    symbolMeta: { '600000': { name: '测试股份' } },
    latestDate: '2026-09-03',
  });
  const executed = result.accounts[0].decisions.find((item) => item.id === 'hold-existing');
  const pending = result.accounts[0].decisions.find((item) => item.id === 'hold-next-day');
  assert.deepEqual(executed.holdingNames, ['测试股份']);
  assert.deepEqual(pending.holdingNames, ['测试股份']);
});
