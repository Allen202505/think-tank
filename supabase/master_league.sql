-- 大师实盘联赛公共底表（仅公开赛）
-- 公开赛数据任何人都可读；公开赛写入由服务端 service_role 完成。
-- 用户邀请大师使用登录账号写入：所有人可读、数据长期留存；
-- 管理员可下架并删除违规广告内容，被下架的大师 id 会进入黑名单，防止重新发布。

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin = true
  );
$$;

-- 被管理员下架的大师 id：邀请人换个浏览器也不能再次发布同一内容。
create table if not exists public.master_league_invite_blocks (
  master_id text primary key,
  blocked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.master_invite_blocked(p_master_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.master_league_invite_blocks
    where master_id = p_master_id
  );
$$;

create table if not exists public.master_league_competitions (
  id text primary key,
  mode text not null default 'public' check (mode = 'public'),
  name text not null,
  organizer text not null,
  owner_id uuid references auth.users (id) on delete cascade,
  initial_capital numeric not null default 100000,
  market text not null default 'A股',
  start_date date,
  status text not null default 'preview',
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.master_league_accounts (
  id text primary key,
  competition_id text not null references public.master_league_competitions (id) on delete cascade,
  master_id text not null,
  master jsonb not null default '{}'::jsonb,
  cash numeric not null default 100000,
  market_value numeric not null default 0,
  total_asset numeric not null default 100000,
  profit numeric not null default 0,
  profit_rate numeric not null default 0,
  today_profit numeric not null default 0,
  today_profit_rate numeric not null default 0,
  ranking integer,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (competition_id, master_id)
);

create table if not exists public.master_league_positions (
  id text primary key,
  competition_id text not null references public.master_league_competitions (id) on delete cascade,
  master_id text not null,
  symbol text not null,
  name text not null,
  quantity numeric not null default 0,
  average_price numeric not null default 0,
  market_price numeric not null default 0,
  market_value numeric not null default 0,
  profit numeric not null default 0,
  profit_rate numeric not null default 0,
  weight numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (competition_id, master_id, symbol)
);

create table if not exists public.master_league_decisions (
  id text primary key,
  competition_id text not null references public.master_league_competitions (id) on delete cascade,
  master_id text not null,
  decision_date date,
  execution_date date,
  action text not null,
  symbol text,
  stock_name text,
  target_pct numeric,
  reason text,
  risk text,
  status text,
  execution_price numeric,
  shares numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.master_league_comments (
  id text primary key,
  competition_id text not null references public.master_league_competitions (id) on delete cascade,
  decision_id text references public.master_league_decisions (id) on delete cascade,
  master_id text not null,
  parent_id text,
  content text not null,
  like_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.master_league_invites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  master_id text not null unique,
  name text not null,
  title text,
  style text,
  intro text,
  a_share_angle text,
  personality text,
  prompt text,
  skill_name text,
  skill_content text,
  master jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_master_league_accounts_competition
  on public.master_league_accounts (competition_id, ranking);
create index if not exists idx_master_league_positions_competition
  on public.master_league_positions (competition_id, master_id);
create index if not exists idx_master_league_decisions_competition
  on public.master_league_decisions (competition_id, decision_date desc);
create index if not exists idx_master_league_comments_decision
  on public.master_league_comments (decision_id, created_at);
create index if not exists idx_master_league_invites_created
  on public.master_league_invites (created_at desc);

alter table public.master_league_competitions enable row level security;
alter table public.master_league_accounts enable row level security;
alter table public.master_league_positions enable row level security;
alter table public.master_league_decisions enable row level security;
alter table public.master_league_comments enable row level security;
alter table public.master_league_invites enable row level security;

drop policy if exists "master_league_public_read" on public.master_league_competitions;
create policy "master_league_public_read" on public.master_league_competitions
  for select using (true);

drop policy if exists "master_league_accounts_public_read" on public.master_league_accounts;
create policy "master_league_accounts_public_read" on public.master_league_accounts
  for select using (exists (
    select 1 from public.master_league_competitions c
    where c.id = competition_id and c.mode = 'public'
  ));

drop policy if exists "master_league_positions_public_read" on public.master_league_positions;
create policy "master_league_positions_public_read" on public.master_league_positions
  for select using (exists (
    select 1 from public.master_league_competitions c
    where c.id = competition_id and c.mode = 'public'
  ));

drop policy if exists "master_league_decisions_public_read" on public.master_league_decisions;
create policy "master_league_decisions_public_read" on public.master_league_decisions
  for select using (exists (
    select 1 from public.master_league_competitions c
    where c.id = competition_id and c.mode = 'public'
  ));

drop policy if exists "master_league_comments_public_read" on public.master_league_comments;
create policy "master_league_comments_public_read" on public.master_league_comments
  for select using (exists (
    select 1 from public.master_league_competitions c
    where c.id = competition_id and c.mode = 'public'
  ));

-- 旧版擂台赛遗留策略：已下线，避免历史库继续放行用户自建比赛。
drop policy if exists "master_league_arena_owner_write" on public.master_league_competitions;
drop policy if exists "master_league_accounts_owner_write" on public.master_league_accounts;
drop policy if exists "master_league_positions_owner_write" on public.master_league_positions;
drop policy if exists "master_league_decisions_owner_write" on public.master_league_decisions;
drop policy if exists "master_league_comments_owner_write" on public.master_league_comments;

drop policy if exists "master_league_invites_public_read" on public.master_league_invites;
create policy "master_league_invites_public_read" on public.master_league_invites
  for select using (true);

drop policy if exists "master_league_invites_insert_own" on public.master_league_invites;
create policy "master_league_invites_insert_own" on public.master_league_invites
  for insert to authenticated
  with check (user_id = auth.uid() and not public.master_invite_blocked(master_id));

drop policy if exists "master_league_invites_update_own_or_admin" on public.master_league_invites;
create policy "master_league_invites_update_own_or_admin" on public.master_league_invites
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check ((user_id = auth.uid() and not public.master_invite_blocked(master_id)) or public.is_admin());

drop policy if exists "master_league_invites_delete_own_or_admin" on public.master_league_invites;
create policy "master_league_invites_delete_own_or_admin" on public.master_league_invites
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

alter table public.master_league_invite_blocks enable row level security;

-- 黑名单不公开：只有管理员能查看/维护，普通用户只能通过上面的策略感受到“不能发布”。
drop policy if exists "master_league_invite_blocks_admin_read" on public.master_league_invite_blocks;
create policy "master_league_invite_blocks_admin_read" on public.master_league_invite_blocks
  for select to authenticated
  using (public.is_admin());

drop policy if exists "master_league_invite_blocks_admin_write" on public.master_league_invite_blocks;
create policy "master_league_invite_blocks_admin_write" on public.master_league_invite_blocks
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.master_league_competitions, public.master_league_accounts,
  public.master_league_positions, public.master_league_decisions,
  public.master_league_comments, public.master_league_invites to anon, authenticated;
grant insert, update, delete on public.master_league_competitions,
  public.master_league_accounts, public.master_league_positions,
  public.master_league_decisions, public.master_league_comments to authenticated;
grant insert, update, delete on public.master_league_invites to authenticated;
grant select, insert, update, delete on public.master_league_invite_blocks to authenticated;

-- 将站长账号设为管理员（把邮箱替换为你的登录邮箱）：
-- update public.profiles set is_admin = true where email = 'admin@example.com';

-- ── AI 互评持久化（2026-09-13 新增）────────────────────────────
-- 每天每位大师一条：payload 里是 AI 现场生成的点评数组。
-- 匿名只读（页面展示），写入只允许服务端 service_role（绕过 RLS）。
create table if not exists public.master_league_commentary (
  id text primary key,
  competition_id text not null default 'public-2026-09-14',
  commentary_date date not null,
  target_master_id text not null,
  payload jsonb not null default '{}'::jsonb,
  model text,
  cost numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (commentary_date, target_master_id)
);

create index if not exists idx_master_league_commentary_date
  on public.master_league_commentary (commentary_date desc);

alter table public.master_league_commentary enable row level security;

drop policy if exists "master_league_commentary_public_read" on public.master_league_commentary;
create policy "master_league_commentary_public_read" on public.master_league_commentary
  for select using (true);

grant select on public.master_league_commentary to anon, authenticated;
grant insert, update, delete on public.master_league_commentary to service_role;

-- ── AI 生成的每日决策（2026-09-13 新增）──────────────────────
-- 每位大师每个交易日一组计划（1~3 条），由收盘后的定时任务生成，次日开盘执行。
-- 与 master_league_decisions 的区别：那张表是「按行情算出来的快照」，这张是「大师自己的意图」。
create table if not exists public.master_league_plans (
  id text primary key,
  competition_id text not null default 'public-2026-09-14',
  master_id text not null,
  plan_date date not null,
  execute_date date,
  action text not null,
  symbol text,
  stock_name text,
  target_pct numeric,
  reason text,
  risk text,
  model text,
  cost numeric not null default 0,
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_master_league_plans_date
  on public.master_league_plans (competition_id, plan_date desc);
create index if not exists idx_master_league_plans_master
  on public.master_league_plans (competition_id, master_id, plan_date desc);

alter table public.master_league_plans enable row level security;

drop policy if exists "master_league_plans_public_read" on public.master_league_plans;
create policy "master_league_plans_public_read" on public.master_league_plans
  for select using (true);

grant select on public.master_league_plans to anon, authenticated;
grant insert, update, delete on public.master_league_plans to service_role;
