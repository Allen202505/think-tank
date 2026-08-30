-- ============================================================
-- 大师吵股 · 登录注册 + 股票池云端同步
-- 在 Supabase 左上角 SQL Editor 里，粘贴并运行本文件（Run）。
-- 安全设计：每个用户只能读/写自己名下的股票池（RLS）。
-- 注意：用户的 API Key 不存这里，只留在浏览器本地。
-- ============================================================

-- 1) 用户股票池表
create table if not exists public.user_stock_pools (
  id text primary key,               -- 前端生成的唯一 id（与本地一致）
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  source text,
  created_at date,
  symbols jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_stock_pools_user_id
  on public.user_stock_pools (user_id);

-- 2) 用户资料表（展示用）
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

-- 3) 打开行级安全
alter table public.user_stock_pools enable row level security;
alter table public.profiles enable row level security;

-- 4) 股票池 RLS：仅本人
drop policy if exists "pools_select_own" on public.user_stock_pools;
create policy "pools_select_own" on public.user_stock_pools
  for select using (auth.uid() = user_id);

drop policy if exists "pools_insert_own" on public.user_stock_pools;
create policy "pools_insert_own" on public.user_stock_pools
  for insert with check (auth.uid() = user_id);

drop policy if exists "pools_update_own" on public.user_stock_pools;
create policy "pools_update_own" on public.user_stock_pools
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "pools_delete_own" on public.user_stock_pools;
create policy "pools_delete_own" on public.user_stock_pools
  for delete using (auth.uid() = user_id);

-- 5) profiles RLS：仅本人
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- 6) 注册后自动建 profiles 行
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 7) 授权（让 anon/authenticated 能通过 RLS 访问）
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.user_stock_pools to anon, authenticated;
grant select, insert, update, delete on public.profiles to anon, authenticated;

-- ============================================================
-- 纳瓦尔的知识学堂 · 每日知识点（daily_knowledge_issues）
-- 公共可读；历史期数由站长用 SQL 种子导入（seed_naval_issues.sql）；
-- "今天"这一期允许站点自动生成写入（issue_date = 上海时区当天）。
-- ============================================================
create table if not exists public.daily_knowledge_issues (
  issue_date date primary key,          -- 期数日期，如 2026-08-30
  issue_label text not null,            -- 展示名，如 第2026.08.30期
  title text not null,                  -- 今日主题
  content text not null,                -- 完整正文（含上期揭晓/三指标/小测验）
  quiz_question text,                   -- 本期小测验（不附答案，列表页展示用）
  quiz_answer text,                     -- 本期小测验参考思路（下一期揭晓用）
  covered_topics jsonb not null default '[]'::jsonb, -- 本期覆盖的指标/主题
  source text not null default 'generated',          -- seed | generated
  created_at timestamptz not null default now()
);

create index if not exists idx_daily_knowledge_issues_date
  on public.daily_knowledge_issues (issue_date desc);

alter table public.daily_knowledge_issues enable row level security;

drop policy if exists "naval_issues_select_public" on public.daily_knowledge_issues;
create policy "naval_issues_select_public" on public.daily_knowledge_issues
  for select using (true);

-- 仅允许写入"当天"这一期（站点生成今日期数用；历史期数由种子 SQL 导入，不受此限）
drop policy if exists "naval_issues_insert_today" on public.daily_knowledge_issues;
create policy "naval_issues_insert_today" on public.daily_knowledge_issues
  for insert with check (issue_date = (now() at time zone 'Asia/Shanghai')::date);

grant select, insert on public.daily_knowledge_issues to anon, authenticated;

-- ============================================================
-- 纳瓦尔知识学堂 · 用户词条（user_terms）—— 云端同步
-- 每个用户一行，词条以 JSONB 数组存储；RLS 仅本人可读写。
-- 登录后词条跨设备不丢失；未登录时仅存本机。
-- ============================================================
create table if not exists public.user_terms (
  user_id uuid primary key references auth.users (id) on delete cascade,
  terms jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_terms enable row level security;

drop policy if exists "user_terms_select_own" on public.user_terms;
create policy "user_terms_select_own" on public.user_terms
  for select using (auth.uid() = user_id);

drop policy if exists "user_terms_insert_own" on public.user_terms;
create policy "user_terms_insert_own" on public.user_terms
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_terms_update_own" on public.user_terms;
create policy "user_terms_update_own" on public.user_terms
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on public.user_terms to anon, authenticated;
