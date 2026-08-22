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
