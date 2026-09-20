-- ============================================================
-- 学习打卡系统 - Supabase 建表脚本
-- 用法：在 Supabase 控制台 → SQL Editor 里整段粘贴执行
-- 脚本可重复执行（已做幂等处理）
-- ============================================================

-- ============================================================
-- 一、基础表
-- ============================================================

-- 用户资料（补充 auth.users 里没有的昵称、头像、签名）
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  avatar_emoji text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 兼容已存在的旧表：把后加的列补上
alter table public.profiles add column if not exists avatar_emoji text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- 自定义头像与背景图：图片本体存在 Storage 的 media 桶里，这里只存 URL；
-- background_opacity 是背景图的透明度（0~100）；
-- background_mobile_url 是手机端单独用的背景（留空就沿用电脑端那张）
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists background_url text;
alter table public.profiles add column if not exists background_mobile_url text;
alter table public.profiles add column if not exists background_opacity smallint not null default 100;

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

-- 单词本（工具页「背单词」用）
create table if not exists public.wordbooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 单词：term 为单词、meaning 为释义，其余字段记录背诵进度
create table if not exists public.words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.wordbooks(id) on delete cascade,
  term text not null,
  meaning text not null default '',
  mastery smallint not null default 0,
  review_count int not null default 0,
  correct_count int not null default 0,
  wrong_count int not null default 0,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- 兼容已存在的旧表：记录最近一次背诵/考核的结果（known / vague / again）
alter table public.words add column if not exists last_result text;

-- 兼容已存在的旧表：单词在单词本里的排列位置（导入时的先后，从 0 开始）
alter table public.words add column if not exists position int not null default 0;

-- 旧数据补编号：按现有的 created_at / id 顺序编一遍。
-- 不做这一步的话，旧词的 position 全是 0，之后追加的新词会和它们的位置重叠。
update public.words w
   set position = t.rn
  from (
    select id, (row_number() over (partition by book_id order by created_at, id) - 1) as rn
      from public.words
  ) t
 where w.id = t.id
   and w.position = 0
   and t.rn > 0;

-- 学习会话：一次完整的背诵（study）或考核（quiz），汇总当天背了多少
create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid references public.wordbooks(id) on delete set null,
  book_name text not null default '',
  mode text not null check (mode in ('study','quiz')),
  total int not null default 0,
  known int not null default 0,
  vague int not null default 0,
  again int not null default 0,
  correct int not null default 0,
  wrong int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 逐词明细：具体背了哪些单词、每个词的结果
-- term / meaning 做了冗余，单词被删除后记录仍然完整可读
create table if not exists public.study_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.study_sessions(id) on delete cascade,
  word_id uuid references public.words(id) on delete set null,
  term text not null,
  meaning text not null default '',
  result text not null check (result in ('known','vague','again')),
  created_at timestamptz not null default now()
);

-- 词汇量测试：每次估算的结果
-- bands 存各频段的抽样数与认识数，回看时能看出是哪几档答得好
create table if not exists public.vocab_tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  estimate int not null default 0,
  low int not null default 0,
  high int not null default 0,
  total int not null default 0,
  known int not null default 0,
  duration_ms int not null default 0,
  bands jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- 用户反馈：个人中心「意见反馈」提交的内容
-- 站长在 Supabase 后台的 Table Editor 里就能看到（service role 不受 RLS 限制）
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  contact text not null default '',
  created_at timestamptz not null default now()
);

-- ============================================================
-- 二、好友与点赞
-- ============================================================

-- 好友关系：无向，一对好友只存一行（user_a < user_b，靠主键天然去重）
create table if not exists public.friendships (
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  status text not null default 'accepted' check (status in ('pending','accepted','blocked')),
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);

-- 打卡点赞
create table if not exists public.checkin_likes (
  checkin_id uuid not null references public.checkins(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (checkin_id, user_id)
);

create index if not exists tasks_checkin_id_idx        on public.tasks(checkin_id);
create index if not exists checkins_user_date_idx      on public.checkins(user_id, checkin_date);
create index if not exists checkins_user_date_desc_idx on public.checkins(user_id, checkin_date desc);
create index if not exists friendships_user_a_idx      on public.friendships(user_a);
create index if not exists friendships_user_b_idx      on public.friendships(user_b);
create index if not exists checkin_likes_checkin_idx   on public.checkin_likes(checkin_id);
create index if not exists wordbooks_user_idx          on public.wordbooks(user_id);
create index if not exists words_book_idx              on public.words(book_id);
create index if not exists words_user_idx              on public.words(user_id);
create index if not exists words_book_pos_idx          on public.words(book_id, position);
create index if not exists study_sessions_user_idx     on public.study_sessions(user_id, created_at desc);
create index if not exists study_logs_session_idx      on public.study_logs(session_id);
create index if not exists study_logs_user_idx         on public.study_logs(user_id, created_at desc);
create index if not exists vocab_tests_user_idx        on public.vocab_tests(user_id, created_at desc);
create index if not exists feedback_user_idx          on public.feedback(user_id, created_at desc);

-- ============================================================
-- 三、行级安全（RLS）：本人可读写，好友可读
-- ============================================================

-- 辅助函数用 security definer 绕过 RLS，否则策略里查 friendships 会无限递归
create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.user_a = a and f.user_b = b) or (f.user_a = b and f.user_b = a))
  );
$$;

create or replace function public.can_view_checkin(p_checkin uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.checkins c
    where c.id = p_checkin
      and (c.user_id = auth.uid() or public.are_friends(auth.uid(), c.user_id))
  );
$$;

alter table public.profiles      enable row level security;
alter table public.checkins      enable row level security;
alter table public.tasks         enable row level security;
alter table public.friendships   enable row level security;
alter table public.checkin_likes enable row level security;
alter table public.wordbooks     enable row level security;
alter table public.words         enable row level security;
alter table public.study_sessions enable row level security;
alter table public.study_logs     enable row level security;
alter table public.vocab_tests    enable row level security;
alter table public.feedback       enable row level security;

-- profiles：本人可读写，好友可读
drop policy if exists "profiles: own"          on public.profiles;
drop policy if exists "profiles: own read"     on public.profiles;
drop policy if exists "profiles: friends read" on public.profiles;
drop policy if exists "profiles: own insert"   on public.profiles;
drop policy if exists "profiles: own update"   on public.profiles;
create policy "profiles: own read"     on public.profiles for select using (auth.uid() = id);
create policy "profiles: friends read" on public.profiles for select using (public.are_friends(auth.uid(), id));
create policy "profiles: own insert"   on public.profiles for insert with check (auth.uid() = id);
create policy "profiles: own update"   on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- checkins：本人可全部操作，好友可读
drop policy if exists "checkins: own"          on public.checkins;
drop policy if exists "checkins: own all"      on public.checkins;
drop policy if exists "checkins: friends read" on public.checkins;
create policy "checkins: own all"      on public.checkins for all    using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "checkins: friends read" on public.checkins for select using (public.are_friends(auth.uid(), user_id));

-- tasks：本人可全部操作，好友可读
drop policy if exists "tasks: own"          on public.tasks;
drop policy if exists "tasks: own all"      on public.tasks;
drop policy if exists "tasks: friends read" on public.tasks;
create policy "tasks: own all"      on public.tasks for all    using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tasks: friends read" on public.tasks for select using (public.are_friends(auth.uid(), user_id));

-- friendships：只能看到/删除与自己相关的；插入只允许走 RPC
drop policy if exists "friendships: read own"   on public.friendships;
drop policy if exists "friendships: delete own" on public.friendships;
create policy "friendships: read own"   on public.friendships for select using (auth.uid() = user_a or auth.uid() = user_b);
create policy "friendships: delete own" on public.friendships for delete using (auth.uid() = user_a or auth.uid() = user_b);

-- checkin_likes：自己点过的，或自己/好友可见打卡上的点赞
drop policy if exists "likes: read visible" on public.checkin_likes;
drop policy if exists "likes: insert own"   on public.checkin_likes;
drop policy if exists "likes: delete own"   on public.checkin_likes;
create policy "likes: read visible" on public.checkin_likes for select using (auth.uid() = user_id or public.can_view_checkin(checkin_id));
create policy "likes: insert own"   on public.checkin_likes for insert with check (auth.uid() = user_id and public.can_view_checkin(checkin_id));
create policy "likes: delete own"   on public.checkin_likes for delete using (auth.uid() = user_id);

-- wordbooks / words：纯个人数据，仅本人可读写（不开放给好友）
drop policy if exists "wordbooks: own all" on public.wordbooks;
create policy "wordbooks: own all" on public.wordbooks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "words: own all" on public.words;
create policy "words: own all" on public.words for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- study_sessions / study_logs：学习记录同样属于个人数据
drop policy if exists "study_sessions: own all" on public.study_sessions;
create policy "study_sessions: own all" on public.study_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "study_logs: own all" on public.study_logs;
create policy "study_logs: own all" on public.study_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- vocab_tests：词汇量测试记录，只有本人可见（不参与好友排行榜）
drop policy if exists "vocab_tests: own all" on public.vocab_tests;
create policy "vocab_tests: own all" on public.vocab_tests for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- feedback：本人可提交 / 查看 / 删除自己的反馈（站长在后台用 service role 看全部）
drop policy if exists "feedback: own read"   on public.feedback;
drop policy if exists "feedback: own insert" on public.feedback;
drop policy if exists "feedback: own delete" on public.feedback;
create policy "feedback: own read"   on public.feedback for select using (auth.uid() = user_id);
create policy "feedback: own insert" on public.feedback for insert with check (auth.uid() = user_id);
create policy "feedback: own delete" on public.feedback for delete using (auth.uid() = user_id);

-- ============================================================
-- 四、触发器
-- ============================================================

-- 注册时自动创建 profile
-- security definer 绕过 RLS，因此即使开启了邮箱验证也能正常写入
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

-- profiles.updated_at 自动维护
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists wordbooks_touch on public.wordbooks;
create trigger wordbooks_touch
  before update on public.wordbooks
  for each row execute function public.touch_updated_at();

drop trigger if exists study_sessions_touch on public.study_sessions;
create trigger study_sessions_touch
  before update on public.study_sessions
  for each row execute function public.touch_updated_at();

-- ============================================================
-- 五、业务 RPC
-- ============================================================

-- 通过邮箱精确添加好友（直接互加）
create or replace function public.add_friend_by_email(p_email text)
returns table (friend_id uuid, nickname text)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  target uuid;
  target_nick text;
  lo uuid; hi uuid;
begin
  if me is null then raise exception '请先登录'; end if;

  select u.id, coalesce(nullif(p.nickname, ''), split_part(u.email, '@', 1))
    into target, target_nick
  from auth.users u
  left join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(p_email))
  limit 1;

  if target is null then raise exception '没有找到这个邮箱对应的用户'; end if;
  if target = me    then raise exception '不能添加自己为好友'; end if;

  if me < target then lo := me; hi := target; else lo := target; hi := me; end if;

  insert into public.friendships (user_a, user_b, status)
  values (lo, hi, 'accepted')
  on conflict (user_a, user_b) do update set status = 'accepted';

  return query select target, target_nick;
end; $$;

-- 好友总览（好友列表 + 排行榜：总天数 / 近30天 / 完成任务 / 连续天数）
create or replace function public.friends_overview()
returns table (
  friend_id uuid, nickname text, avatar_emoji text,
  total_days bigint, days_30 bigint, completed_tasks bigint,
  last_checkin date, streak int
)
language sql security definer stable set search_path = public as $$
  with me as (select auth.uid() as uid),
  fl as (
    select case when f.user_a = (select uid from me) then f.user_b else f.user_a end as fid
    from public.friendships f
    where f.status = 'accepted'
      and (select uid from me) in (f.user_a, f.user_b)
  ),
  cs as (
    select c.user_id, c.checkin_date from public.checkins c join fl on fl.fid = c.user_id
  ),
  ranked as (
    select user_id, checkin_date,
      checkin_date - (row_number() over (partition by user_id order by checkin_date))::int as grp
    from cs
  ),
  islands as (
    select user_id, max(checkin_date) as grp_end, count(*)::int as len
    from ranked group by user_id, grp
  ),
  streak as (
    select user_id, max(len) as len from islands
    where grp_end >= current_date - 1 group by user_id
  )
  select
    fl.fid,
    coalesce(nullif(p.nickname, ''), '用户'),
    p.avatar_emoji,
    (select count(*) from cs where cs.user_id = fl.fid),
    (select count(*) from cs where cs.user_id = fl.fid and cs.checkin_date >= current_date - 29),
    (select count(*) from public.tasks t where t.user_id = fl.fid and t.completed),
    (select max(cs.checkin_date) from cs where cs.user_id = fl.fid),
    coalesce((select s.len from streak s where s.user_id = fl.fid), 0)
  from fl
  left join public.profiles p on p.id = fl.fid;
$$;

-- 好友动态流（一次拿全：昵称/任务完成/点赞数/我是否点赞）
create or replace function public.friend_feed(p_limit int default 20)
returns table (
  checkin_id uuid, user_id uuid, nickname text, avatar_emoji text,
  checkin_date date, content text, created_at timestamptz,
  task_total int, task_done int, like_count int, liked_by_me boolean
)
language sql security definer stable set search_path = public as $$
  with me as (select auth.uid() as uid),
  fl as (
    select case when f.user_a = (select uid from me) then f.user_b else f.user_a end as fid
    from public.friendships f
    where f.status = 'accepted'
      and (select uid from me) in (f.user_a, f.user_b)
  )
  select
    c.id, c.user_id, coalesce(nullif(p.nickname, ''), '用户'), p.avatar_emoji,
    c.checkin_date, c.content, c.created_at,
    (select count(*)::int from public.tasks t where t.checkin_id = c.id),
    (select count(*)::int from public.tasks t where t.checkin_id = c.id and t.completed),
    (select count(*)::int from public.checkin_likes l where l.checkin_id = c.id),
    exists(select 1 from public.checkin_likes l where l.checkin_id = c.id and l.user_id = (select uid from me))
  from public.checkins c
  join fl on fl.fid = c.user_id
  left join public.profiles p on p.id = c.user_id
  order by c.checkin_date desc, c.created_at desc
  limit p_limit;
$$;

-- 个人统计一次拿全（替代原来的 4 次 count 请求）
create or replace function public.my_stats()
returns table (total_days bigint, total_tasks bigint, completed_tasks bigint, streak int)
language sql security definer stable set search_path = public as $$
  with me as (select auth.uid() as uid),
  cs as (select c.checkin_date from public.checkins c where c.user_id = (select uid from me)),
  ranked as (
    select checkin_date, checkin_date - (row_number() over (order by checkin_date))::int as grp
    from cs
  ),
  islands as (
    select max(checkin_date) as grp_end, count(*)::int as len from ranked group by grp
  )
  select
    (select count(*) from cs),
    (select count(*) from public.tasks t where t.user_id = (select uid from me)),
    (select count(*) from public.tasks t where t.user_id = (select uid from me) and t.completed),
    coalesce((select max(len) from islands where grp_end >= current_date - 1), 0);
$$;

-- 开始一次背诵 / 考核，返回会话 id；前端在第一次作答时才创建，避免留下空记录
create or replace function public.start_study_session(
  p_mode text,
  p_book_id uuid,
  p_book_name text,
  p_total int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  sid uuid;
begin
  if me is null then raise exception '请先登录'; end if;
  if p_mode not in ('study','quiz') then raise exception '无效的记录类型'; end if;

  insert into public.study_sessions (user_id, book_id, book_name, mode, total)
  values (
    me,
    case
      when exists (select 1 from public.wordbooks b where b.id = p_book_id and b.user_id = me)
      then p_book_id
      else null
    end,
    coalesce(p_book_name, ''),
    p_mode,
    greatest(coalesce(p_total, 0), 0)
  )
  returning id into sid;

  return sid;
end; $$;

-- 记录一次背诵 / 考核结果：更新单词进度 + 写逐词明细 + 累加会话统计
-- 返回整行而不是 returns table，避免输出参数名与 words 的列名重名，
-- 否则 `set review_count = review_count + 1` 在 PL/pgSQL 里会因「列引用有歧义」而报错
create or replace function public.record_word_review(
  p_session_id uuid,
  p_word_id uuid,
  p_result text
) returns setof public.words
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  rec public.words;
begin
  if me is null then raise exception '请先登录'; end if;
  if p_result not in ('known','vague','again') then raise exception '无效的背诵结果'; end if;

  update public.words
     set review_count     = review_count + 1,
         correct_count    = correct_count + case when p_result = 'known' then 1 else 0 end,
         wrong_count      = wrong_count   + case when p_result = 'again' then 1 else 0 end,
         mastery          = case p_result
                              when 'known' then least(5, mastery + 1)
                              when 'again' then 0
                              else mastery
                            end,
         last_result      = p_result,
         last_reviewed_at = now()
   where id = p_word_id and user_id = me
   returning * into rec;

  if not found then raise exception '单词不存在或不属于当前用户'; end if;

  -- 会话不属于本人（或创建失败）时，仍然更新单词进度，只是不记明细
  if p_session_id is not null
     and exists (select 1 from public.study_sessions s where s.id = p_session_id and s.user_id = me)
  then
    insert into public.study_logs (user_id, session_id, word_id, term, meaning, result)
    values (me, p_session_id, rec.id, rec.term, rec.meaning, p_result);

    update public.study_sessions
       set known   = known   + case when p_result = 'known' then 1 else 0 end,
           vague   = vague   + case when p_result = 'vague' then 1 else 0 end,
           again   = again   + case when p_result = 'again' then 1 else 0 end,
           correct = correct + case when p_result = 'known' then 1 else 0 end,
           wrong   = wrong   + case when p_result = 'again' then 1 else 0 end
     where id = p_session_id;
  end if;

  return next rec;
end; $$;

-- ============================================================
-- 六、函数权限：只允许已登录用户调用
-- ============================================================
revoke all on function public.are_friends(uuid, uuid)      from public, anon;
revoke all on function public.can_view_checkin(uuid)       from public, anon;
revoke all on function public.add_friend_by_email(text)    from public, anon;
revoke all on function public.friends_overview()           from public, anon;
revoke all on function public.friend_feed(int)             from public, anon;
revoke all on function public.my_stats()                   from public, anon;
revoke all on function public.start_study_session(text, uuid, text, int) from public, anon;
revoke all on function public.record_word_review(uuid, uuid, text)       from public, anon;

grant execute on function public.are_friends(uuid, uuid)   to authenticated;
grant execute on function public.can_view_checkin(uuid)    to authenticated;
grant execute on function public.add_friend_by_email(text) to authenticated;
grant execute on function public.friends_overview()        to authenticated;
grant execute on function public.friend_feed(int)          to authenticated;
grant execute on function public.my_stats()                to authenticated;
grant execute on function public.start_study_session(text, uuid, text, int) to authenticated;
grant execute on function public.record_word_review(uuid, uuid, text)       to authenticated;

-- ============================================================
-- 七、Storage：自定义头像与背景图
-- ============================================================
-- 一个公开桶，约定路径为 `<用户id>/avatar.jpg` 与 `<用户id>/background.jpg`。
-- 「公开」只影响读取（知道链接就能看，头像本来也要给好友看）；
-- 写入 / 覆盖 / 删除都只允许操作自己目录下的文件。
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

drop policy if exists "media: read" on storage.objects;
create policy "media: read" on storage.objects
  for select using (bucket_id = 'media');

drop policy if exists "media: own insert" on storage.objects;
create policy "media: own insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media: own update" on storage.objects;
create policy "media: own update" on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media: own delete" on storage.objects;
create policy "media: own delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
