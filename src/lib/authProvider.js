// src/lib/authProvider.js —— 登录注册上下文（Supabase Auth）
// 提供 user / loading / signIn / signUp / signOut / 打开登录弹窗。
'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getSupabase, supabaseEnabled } from './supabaseClient';
import { syncPoolsOnLogin } from './userPools';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(supabaseEnabled);

  useEffect(() => {
    if (!supabaseEnabled) { setLoading(false); return; }
    const sb = getSupabase();
    if (!sb) { setLoading(false); return; }
    let syncedFor = null;

    sb.auth.getSession().then(async ({ data }) => {
      const u = data?.session?.user || null;
      setUser(u);
      if (u?.id) {
        syncedFor = u.id;
        try { await syncPoolsOnLogin(u.id); } catch (e) { /* ignore */ }
      }
      setLoading(false);
    });

    const { data: sub } = sb.auth.onAuthStateChange(async (event, session) => {
      const u = session?.user || null;
      setUser(u);
      if (u?.id && u.id !== syncedFor) {
        syncedFor = u.id;
        try { await syncPoolsOnLogin(u.id); } catch (e) { /* ignore */ }
      }
    });
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  const signIn = useCallback(async (email, password) => {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase 未配置');
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }, []);

  const signUp = useCallback(async (email, password) => {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase 未配置');
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw new Error(error.message);
    // 若开启了邮箱验证，则需用户去邮箱确认后才能登录
    return data;
  }, []);

  const signOut = useCallback(async () => {
    // 乐观退出：先立刻清空 UI，不等 Supabase 网络请求，避免卡顿
    setUser(null);
    const sb = getSupabase();
    if (!sb) return;
    try { await sb.auth.signOut(); } catch (e) { /* ignore */ }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
