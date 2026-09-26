-- ============================================================
-- 大师吵股 · 分析结果分享链接
-- 在 Supabase SQL Editor 运行本文件即可启用公开只读分享页面。
-- 写入与读取都只通过服务端 service_role 完成，anon/authenticated 不直接授权。
-- ============================================================

create table if not exists public.share_results (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{20,64}$'),
  kind text not null check (kind in ('master_pk', 'breakfast', 'munger')),
  title text not null check (char_length(title) between 1 and 180),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_share_results_created_at
  on public.share_results (created_at desc);

alter table public.share_results enable row level security;

-- 分享内容不应被浏览器端 anon key 枚举或直读；只允许服务端按随机 id 查询。
revoke all on public.share_results from anon, authenticated;

grant select, insert on public.share_results to service_role;
