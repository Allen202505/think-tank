// 公开邀请的可见性与审核规则。
// 底表未初始化时页面要能静默降级；被管理员下架的大师不能被原邀请人重新发布。
const MISSING_RELATION_CODES = new Set(['PGRST205', '42P01']);
const MISSING_COLUMN_CODES = new Set(['42703']);
const POLICY_VIOLATION_CODES = new Set(['42501']);

function errorText(error) {
  return `${error?.message || ''} ${error?.details || ''}`.trim();
}

// 返回 'missing_relation' | 'missing_column' | 'blocked' | 'unknown'
export function classifyInviteError(error) {
  if (!error) return 'unknown';
  const code = String(error.code || '');
  const text = errorText(error);
  if (MISSING_RELATION_CODES.has(code) || /could not find the table|relation .* does not exist/i.test(text)) {
    return 'missing_relation';
  }
  if (MISSING_COLUMN_CODES.has(code) || /column .* does not exist/i.test(text)) {
    return 'missing_column';
  }
  if (POLICY_VIOLATION_CODES.has(code) || /row-level security/i.test(text)) {
    return 'blocked';
  }
  return 'unknown';
}

// 邀请人自己删除＝真删；管理员处理违规内容＝下架并记录黑名单，防止换个浏览器再发一次。
export function inviteDeleteMode({ isOwner = false, isAdmin = false } = {}) {
  if (isOwner) return 'delete';
  if (isAdmin) return 'block';
  return 'forbidden';
}

export const LEAGUE_INVITES_SETUP_HINT = '公开邀请暂不可用：底表尚未初始化，请站长在 Supabase 运行 supabase/master_league.sql 后重试。';
export const LEAGUE_INVITE_BLOCKED_HINT = '该大师的邀请已被管理员下架，无法再次公开发布。';

export const __test__ = { MISSING_RELATION_CODES, MISSING_COLUMN_CODES, POLICY_VIOLATION_CODES };
