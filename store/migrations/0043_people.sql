-- 0043_people.sql
--
-- PEOPLE: profiles, follows, comments, likes on comments, reports, and the rep those likes earn
-- (Trador's social layer and ranks). Written by services/social, as `insidor_people`.
--
-- ★ ITS OWN SCHEMA AND ITS OWN ROLE. Everything here is a person's own words or a person's own
-- choice, so it lives in `people`, written only by `insidor_people` — a role that can write these
-- tables and read the public projection, and nothing else. The read service's app role cannot
-- see this schema at all; the pipeline's roles have no business in it.
--
-- ★ A LIKE EARNS REP ONCE. `rep_event` is unique on (voter, comment): liking, unliking and liking
-- again cannot mint rep twice. Unliking deletes the row, so the total falls with it, as in Trador.
--
-- What breaks if changed carelessly: `comment.coin_mint`. It is the coin a like is checked
-- against (only its holders may like), fixed when the comment is written: a narrative's coin
-- changing later must not change who could have liked an old comment.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'insidor_people') then
    create role insidor_people nologin;
  end if;
end
$$;

create schema people;
grant usage on schema people to insidor_people;
grant usage on schema public to insidor_people;

create table people.profile (
  user_id      text primary key,
  -- The X handle from sign-in, lower-cased for lookups; null for a Google sign-in.
  handle       text unique,
  name         text,
  picture_url  text,
  bio          text not null default '',
  -- The embedded wallet from sign-in: who this person is on the chain.
  wallet       text check (wallet is null or wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table people.follow (
  follower_id  text not null references people.profile(user_id) on delete cascade,
  followee_id  text not null references people.profile(user_id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follow_followee_idx on people.follow (followee_id);

create table people.comment (
  comment_id   bigserial primary key,
  author_id    text not null references people.profile(user_id) on delete cascade,
  subject_kind text not null check (subject_kind in ('story', 'coin', 'post')),
  subject_id   text not null,
  parent_id    bigint references people.comment(comment_id) on delete cascade,
  body         text not null check (length(body) between 1 and 4000),
  proof_url    text,
  -- Checked when written: an X post by the author's own handle, or a transaction that touched the coin.
  proof        boolean not null default false,
  coin_mint    text check (coin_mint is null or coin_mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  -- Set when enough distinct people reported it; hidden from everyone until reviewed.
  hidden_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index comment_subject_idx on people.comment (subject_kind, subject_id, created_at);
create index comment_author_idx on people.comment (author_id, created_at desc);

create table people.comment_like (
  comment_id   bigint not null references people.comment(comment_id) on delete cascade,
  voter_id     text not null references people.profile(user_id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (comment_id, voter_id)
);

create table people.comment_report (
  comment_id   bigint not null references people.comment(comment_id) on delete cascade,
  reporter_id  text not null references people.profile(user_id) on delete cascade,
  reason       text not null default '',
  created_at   timestamptz not null default now(),
  primary key (comment_id, reporter_id)
);

-- Hidden by one person, for that person only.
create table people.comment_hide (
  user_id      text not null references people.profile(user_id) on delete cascade,
  comment_id   bigint not null references people.comment(comment_id) on delete cascade,
  primary key (user_id, comment_id)
);

create table people.rep_event (
  season       integer not null,
  voter_id     text not null references people.profile(user_id) on delete cascade,
  comment_id   bigint not null references people.comment(comment_id) on delete cascade,
  author_id    text not null references people.profile(user_id) on delete cascade,
  points       numeric(10, 2) not null check (points > 0),
  voter_rank   text not null,
  proof_boost  boolean not null,
  early_boost  boolean not null,
  created_at   timestamptz not null default now(),
  unique (voter_id, comment_id)
);
create index rep_event_season_idx on people.rep_event (season, author_id);
create index rep_event_voter_day_idx on people.rep_event (voter_id, created_at);

grant select, insert, update, delete on all tables in schema people to insidor_people;
grant usage, select on all sequences in schema people to insidor_people;

-- The public projection, read to know a narrative's coin and a post's narrative.
grant select on public.story, public.story_member, public.story_view, public.board_view, public.board_row,
  public.rising_view, public.rising_row, public.asset, public.coin_name, public.created_coin to insidor_people;
