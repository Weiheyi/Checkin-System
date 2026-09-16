-- ============================================================
-- 学习打卡系统 - Supabase 建表脚本
-- 用法：在 Supabase 控制台 → SQL Editor 里整段粘贴执行
-- 脚本可重复执行（已做幂等处理）
-- ============================================================

-- 用户资料（补充 auth.users 里没有的昵称）
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  created_at timestamptz not null default now()
);

-- 打卡记录：每人每天一条
create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  checkin_date date not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, checkin_date)
);

-- 任务
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  checkin_id uuid not null references public.checkins(id) on delete cascade,
  content text not null,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists tasks_checkin_id_idx on public.tasks(checkin_id);
create index if not exists checkins_user_date_idx on public.checkins(user_id, checkin_date);

-- ============================================================
-- 行级安全（RLS）：每个用户只能读写自己的数据
-- ============================================================
alter table public.profiles enable row level security;
alter table public.checkins enable row level security;
alter table public.tasks    enable row level security;

drop policy if exists "profiles: own" on public.profiles;
create policy "profiles: own" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "checkins: own" on public.checkins;
create policy "checkins: own" on public.checkins
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "tasks: own" on public.tasks;
create policy "tasks: own" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- 注册时自动创建 profile
-- security definer 绕过 RLS，因此即使开启了邮箱验证也能正常写入
-- ============================================================
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nickname)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nickname', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
