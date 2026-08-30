'use client';

// 登录/注册弹窗：使用 Supabase Auth（邮箱+密码）。
// 原则：API Key 不存服务器，只留在用户本地；这里只管理账号与股票池同步。
import { useState, useEffect } from 'react';
import { useAuth } from '../lib/authProvider';
import { supabaseEnabled } from '../lib/supabaseClient';

export default function AuthModal({ open, onClose }) {
  const { signIn, signUp, signOut, user } = useAuth();
  const [mode, setMode] = useState('login'); // login | signup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setNotice('');
    setLoading(false);
    setMode('login');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const switchMode = (m) => { setMode(m); setError(''); setNotice(''); };

  const doSubmit = async () => {
    setError('');
    setNotice('');
    if (!email.trim() || !password) { setError('请填写邮箱和密码'); return; }
    if (mode === 'signup' && password.length < 6) { setError('密码至少 6 位'); return; }
    if (mode === 'signup' && password !== confirm) { setError('两次输入的密码不一致'); return; }
    setLoading(true);
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password);
        setSaved(true);
        setTimeout(() => { setSaved(false); onClose(); }, 600);
      } else {
        const data = await signUp(email.trim(), password);
        // 若邮件需验证，则给提示；否则直接关闭
        if (data?.user && !data.session) {
          setNotice('注册成功！请到邮箱里点确认链接，然后回来登录。');
        } else {
          setSaved(true);
          setTimeout(() => { setSaved(false); onClose(); }, 600);
        }
      }
    } catch (e) {
      setError(e.message || '操作失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const doSignOut = () => {
    onClose(); // 立即关闭，不等待网络
    signOut();
  };

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-panel" role="dialog" aria-modal="true" aria-label="登录 / 注册" onClick={(e) => e.stopPropagation()}>
        <div className="auth-head">
          <div className="auth-title">👤 {user ? '账户' : (mode === 'login' ? '登录' : '注册')}</div>
          <button type="button" className="auth-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        {user ? (
          <div className="auth-body">
            <div className="auth-note auth-note-ok">已登录</div>
            <div className="auth-email">{user.email}</div>
            <p className="auth-tip">登录后，你的「我的股票池」会同步到云端，换设备也能同步。你的 API Key 仍只保存在本机。</p>
            <button type="button" className="auth-signout" onClick={doSignOut}>退出登录</button>
          </div>
        ) : (
          <div className="auth-body">
            <div className="auth-note">登录后，你的「我的股票池」可跨设备同步。API Key 只留在本机，不上传。</div>

            <div className="auth-modes" role="tablist" aria-label="登录/注册">
              <button type="button" role="tab" className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>登录</button>
              <button type="button" role="tab" className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')}>注册</button>
            </div>

            <div className="auth-field">
              <label className="auth-label">邮箱</label>
              <input
                type="email"
                className="auth-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                autoCapitalize="off"
                spellCheck="false"
              />
            </div>

            <div className="auth-field">
              <label className="auth-label">密码</label>
              <div className="auth-keyrow">
                <input
                  type={showPw ? 'text' : 'password'}
                  className="auth-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                />
                <button type="button" className="auth-show" onClick={() => setShowPw((v) => !v)}>{showPw ? '隐藏' : '显示'}</button>
              </div>
            </div>

            {mode === 'signup' && (
              <div className="auth-field">
                <label className="auth-label">确认密码</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  className="auth-input"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="再输一次"
                  autoComplete="new-password"
                />
              </div>
            )}

            {error && <div className="auth-error">⚠ {error}</div>}
            {notice && <div className="auth-notice">✅ {notice}</div>}

            <button type="button" className="auth-submit" onClick={doSubmit} disabled={loading}>
              {loading ? '请稍候…' : saved ? '✓ 成功' : (mode === 'login' ? '登录' : '注册')}
            </button>
            <p className="auth-small">免费，用邮箱即可注册。你的股票池数据仅本人可见。</p>
          </div>
        )}
      </div>
    </div>
  );
}
