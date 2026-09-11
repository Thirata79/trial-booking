-- trial-booking 初期スキーマ（docs/spec.md §5）
-- 1施設専用。テナント概念は持たない。

-- 施設設定は1行だけ。
create table settings (
  id int primary key default 1 check (id = 1),
  venue_name text not null,
  venue jsonb not null default '{}'::jsonb,   -- 住所・アクセス・持ち物
  timezone text not null default 'Asia/Tokyo',
  remind_hour int not null default 18,
  booking_cutoff_hours int not null default 12,
  slot_horizon_days int not null default 14,
  bot_enabled boolean not null default true
);

-- 仕様外の追加：settings は常に1行存在する前提のため、空の行を作っておく。
-- venue_name / venue の中身は §2-9 が確定してから UPDATE する。
insert into settings (id, venue_name) values (1, 'TBD') on conflict (id) do nothing;

create table line_users (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  display_name text,
  created_at timestamptz not null default now()
);

create table slots (
  id uuid primary key default gen_random_uuid(),
  weekday int not null check (weekday between 0 and 6),  -- 0=Sun
  start_time time not null,
  duration_min int not null default 60,
  capacity int not null default 1,
  timeband text not null check (timeband in ('weekday_am','weekday_pm','weekend_am')),
  active boolean not null default true
);

create table slot_exceptions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  slot_id uuid references slots(id),   -- null なら当日全枠クローズ
  reason text
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  line_user_id uuid not null references line_users(id),
  slot_id uuid not null references slots(id),
  booked_date date not null,
  start_at timestamptz not null,
  name text not null,
  status text not null default 'confirmed'
    check (status in ('confirmed','cancelled','attended','no_show')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

-- 同一ユーザーが同時に持てる確定予約は1件
create unique index bookings_active_uniq
  on bookings (line_user_id) where status = 'confirmed';

create index bookings_occurrence
  on bookings (slot_id, booked_date) where status = 'confirmed';

create table conv_states (
  line_user_id uuid primary key references line_users(id),
  state text not null,
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null
);

-- ファネル計測用の追記ログ
create table flow_events (
  id bigserial primary key,
  line_user_id uuid references line_users(id),
  from_state text,
  to_state text,
  trigger text,
  created_at timestamptz not null default now()
);

create table webhook_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);

create table reminder_logs (
  booking_id uuid primary key references bookings(id),
  sent_at timestamptz not null default now(),
  result text not null
);

-- 仕様外の追加：Supabase はテーブルを PostgREST 経由で公開するため、
-- RLS を有効にしてポリシーを一切作らない＝ anon / authenticated からは不可視にする。
-- アクセスは service_role キーを持つサーバからのみ（service_role は RLS をバイパスする）。
alter table settings       enable row level security;
alter table line_users     enable row level security;
alter table slots          enable row level security;
alter table slot_exceptions enable row level security;
alter table bookings       enable row level security;
alter table conv_states    enable row level security;
alter table flow_events    enable row level security;
alter table webhook_events enable row level security;
alter table reminder_logs  enable row level security;
