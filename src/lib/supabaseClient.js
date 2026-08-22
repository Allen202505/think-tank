// src/lib/supabaseClient.js —— 浏览器端 Supabase 客户端（仅用 anon key，靠 RLS 保证数据隔离）
// 用户 API Key 不存 Supabase；这里只存「股票池 / 非敏感配置」。
'use client';

import { createClient } from '@supabase/supabase-js';

// 从环境变量读取；若未配置则返回 null（此时登录注册功能自动隐藏）
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let clientInstance = null;
export function getSupabase() {
  if (!supabaseEnabled) return null;
  if (!clientInstance) {
    clientInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return clientInstance;
}
