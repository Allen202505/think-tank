'use client';

import { getSupabase, supabaseEnabled } from './supabaseClient';
import {
  LEAGUE_INVITE_BLOCKED_HINT,
  LEAGUE_INVITES_SETUP_HINT,
  classifyInviteError,
} from './leagueInvitePolicy.mjs';

function rowToMaster(row) {
  const master = row.master && typeof row.master === 'object' ? row.master : {};
  return {
    ...master,
    id: row.master_id,
    inviteId: row.id,
    ownerId: row.user_id,
    invited: true,
    publishedAt: row.created_at,
    title: master.title || row.title || '公开赛挑战者',
    style: master.style || row.style || '自定义投资策略',
    intro: master.intro || row.intro || '',
    aShareAngle: master.aShareAngle || row.a_share_angle || '',
    personality: master.personality || row.personality || '',
    leaguePrompt: master.leaguePrompt || row.prompt || '',
    leagueSkill: master.leagueSkill || row.skill_content || '',
    leagueSkillName: master.leagueSkillName || row.skill_name || '',
  };
}

// 底表未初始化时静默返回空列表，访客看到的是官方六位大师，而不是一条报错。
export async function fetchLeagueInvites() {
  if (!supabaseEnabled) return [];
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('master_league_invites')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    if (classifyInviteError(error) === 'missing_relation') return [];
    throw new Error(error.message);
  }
  return (data || []).map(rowToMaster);
}

export async function publishLeagueInvite(master, userId) {
  if (!supabaseEnabled) throw new Error('当前环境未配置 Supabase，暂时无法发布公开邀请');
  if (!userId) throw new Error('请先登录后再邀请大师参加公开赛');
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase 客户端不可用');
  const row = {
    user_id: userId,
    master_id: master.id,
    name: master.name,
    title: master.title || '',
    style: master.style || '',
    intro: master.intro || '',
    a_share_angle: master.aShareAngle || '',
    personality: master.personality || '',
    prompt: master.leaguePrompt || master.knowledge || '',
    skill_name: master.leagueSkillName || '',
    skill_content: master.leagueSkill || '',
    master,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb
    .from('master_league_invites')
    .upsert(row, { onConflict: 'master_id' })
    .select('*')
    .single();
  if (error) {
    const kind = classifyInviteError(error);
    if (kind === 'missing_relation') throw new Error(LEAGUE_INVITES_SETUP_HINT);
    if (kind === 'blocked') {
      const blocked = new Error(LEAGUE_INVITE_BLOCKED_HINT);
      blocked.blocked = true;
      throw blocked;
    }
    throw new Error(error.message);
  }
  return rowToMaster(data);
}

// block=true 时先写入黑名单再删数据，避免被下架的邀请在对方下次打开页面时自动复活。
export async function deleteLeagueInvite(inviteId, { masterId, userId, block = false } = {}) {
  if (!supabaseEnabled) throw new Error('当前环境未配置 Supabase');
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase 客户端不可用');
  if (block && masterId) {
    const { error: blockError } = await sb
      .from('master_league_invite_blocks')
      .upsert({ master_id: masterId, blocked_by: userId || null }, { onConflict: 'master_id' });
    if (blockError && classifyInviteError(blockError) !== 'missing_relation') throw new Error(blockError.message);
  }
  const { error } = await sb.from('master_league_invites').delete().eq('id', inviteId);
  if (error) throw new Error(error.message);
}

export async function fetchCurrentProfile(userId) {
  if (!supabaseEnabled || !userId) return null;
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from('profiles').select('id,email,is_admin').eq('id', userId).maybeSingle();
  if (!error) return data;
  // 旧库还没有 is_admin 字段时，按普通用户处理，不影响登录与邀请。
  if (classifyInviteError(error) !== 'missing_column') return null;
  const fallback = await sb.from('profiles').select('id,email').eq('id', userId).maybeSingle();
  if (fallback.error || !fallback.data) return null;
  return { ...fallback.data, is_admin: false };
}
