'use client';

// 侧栏独立「账户」入口：未登录显示登录/注册，已登录显示邮箱，点击打开登录弹窗
import { useAuth } from '../lib/authProvider';

export default function AccountEntry({ onOpen }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <button type="button" className="account-entry-card" onClick={onOpen} aria-label="账户">
        <span className="account-entry-ico">👤</span>
        <span className="account-entry-txt">账户</span>
      </button>
    );
  }
  const label = user ? String(user.email || '我的账户').slice(0, 22) : '登录 / 注册';
  return (
    <button type="button" className="account-entry-card" onClick={onOpen} aria-label={user ? '账户' : '登录 / 注册'} title={user ? String(user.email || '') : '登录 / 注册（同步我的股票池）'}>
      <span className="account-entry-ico">👤</span>
      <span className="account-entry-txt">{label}</span>
      <span className="account-entry-arrow" aria-hidden="true">›</span>
    </button>
  );
}
