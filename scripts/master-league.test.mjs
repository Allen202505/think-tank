import test from 'node:test';
import assert from 'node:assert/strict';
import { __test__, buildPendingLeague, settleMasterLeague } from '../src/lib/masterLeagueEngine.mjs';
import { buildInvitedAccounts, mergeInvitedLeague, rankLeagueByReturnRate } from '../src/lib/masterLeagueInvites.mjs';
import { classifyInviteError, inviteDeleteMode } from '../src/lib/leagueInvitePolicy.mjs';
import { LEAGUE_MASTERS, LEAGUE_PLANS } from '../src/data/masterLeague.js';

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
