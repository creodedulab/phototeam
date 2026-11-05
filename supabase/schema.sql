-- Initial private data model. No client grants: access must go through authenticated server endpoints.
create table public.rooms (
 id uuid primary key default gen_random_uuid(), name text not null, event_date date,
 code text not null unique, status text not null default 'ready' check (status in ('ready','running','paused','ended')),
 ends_at timestamptz, remaining_seconds integer not null default 1800 check (remaining_seconds >= 0),
 created_at timestamptz not null default now()
);
create table public.topics (
 id uuid primary key default gen_random_uuid(), category text not null check(category in ('easy','creative')),
 title text not null, description text not null, active boolean not null default true
);
create table public.room_missions (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms on delete cascade,
 position integer not null check(position between 1 and 6), title text not null, description text not null,
 unique(room_id,position), unique(room_id,id)
);
create table public.teams (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms on delete cascade,
 name text not null, token_hash text not null, unique(room_id,name), unique(room_id,id)
);
create table public.submissions (
 id uuid primary key default gen_random_uuid(), room_id uuid not null,
 team_id uuid not null, mission_id uuid not null, photo_path text not null,
 title text not null, description text not null, message text not null, updated_at timestamptz not null default now(),
 foreign key(room_id,team_id) references public.teams(room_id,id) on delete cascade,
 foreign key(room_id,mission_id) references public.room_missions(room_id,id) on delete cascade,
 unique(team_id,mission_id)
);
create table public.presets (id uuid primary key default gen_random_uuid(), name text not null, missions jsonb not null);
alter table public.rooms enable row level security;
alter table public.topics enable row level security;
alter table public.room_missions enable row level security;
alter table public.teams enable row level security;
alter table public.submissions enable row level security;
alter table public.presets enable row level security;
revoke all on public.rooms, public.topics, public.room_missions, public.teams, public.submissions, public.presets from anon, authenticated;

