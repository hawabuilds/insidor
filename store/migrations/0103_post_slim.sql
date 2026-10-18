-- 0103_post_slim.sql
--
-- POSTS THAT NEVER MADE FOR YOU, SLIMMED AFTER SEVEN DAYS: the one door through which readings
-- may leave public.observation, and the record of every post that went through it.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-18: "Posts that made For You: keep everything forever (text, picture, all view
-- readings, coins). Posts that never made For You: slim them after 7 days to link, text, account,
-- platform, views when found, judge answer and time, and any label I gave. Drop their extra
-- readings and raw search data." About seven in ten posts found never reach For You, a coin, a
-- narrative page or an owner call, and their readings are most of what public.observation grows by.
--
-- 0003 made the series append-only and never pruned, and said why: a vendor sells today's count,
-- nobody sells last Tuesday's. That still holds for every post the product shows or learns from,
-- which is exactly the set the slimming job (store post-slim.ts) leaves alone. This migration does
-- not lift the rule; it replaces the blanket trigger with one that refuses every UPDATE as before
-- and every DELETE unless the transaction has set `insidor.slim` to 'on' — which only the
-- slimming job does, with SET LOCAL, so it dies with the transaction. A psql session at 3am that
-- deletes readings still gets the same error it always did.
--
-- ── WHAT THE TABLES HOLD ─────────────────────────────────────────────────
--
-- internal.post_slim         one row per post slimmed: when, and how many readings and search
--                            records went. It is also the honest absence: a post listed here has
--                            its first reading of each counter only, no picture link and no cached
--                            newest count (public.item.media '[]', counters '{}'), and anything that
--                            draws it must say "later readings dropped", never draw a flat line.
-- internal.post_slim_cursor  one row: how far through public.item, in first_seen_at order, the job
--                            has decided. A post passed over because it is kept is never looked at
--                            again, so the keep is forever, as the owner asked.
--
-- What breaks if changed carelessly: the guard's setting name. `current_setting(..., true)` returns
-- null when unset, and the comparison must stay `= 'on'` so null refuses. A session-level SET (not
-- LOCAL) behind a session pooler would leave the door open for the next borrower of the connection.

create or replace function internal.observation_slim_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and current_setting('insidor.slim', true) = 'on' then
    return old;
  end if;
  raise exception
    '% is append-only: % is not permitted (only the post slimming job may delete, 0103)',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end
$$;

comment on function internal.observation_slim_guard() is
  'public.observation''s guard (0103): every UPDATE refused; a DELETE only inside a transaction that SET LOCAL insidor.slim = ''on'' (store post-slim.ts).';

drop trigger observation_is_append_only on public.observation;
create trigger observation_is_append_only
  before update or delete on public.observation
  for each row execute function internal.observation_slim_guard();

comment on table public.observation is
  'Append-only counter series. Never updated. Readings are deleted only by the post slimming job (0103): a post that never made For You, a coin, a narrative or an owner call keeps its first reading of each counter after 7 days.';

create table internal.post_slim (
  item_id           text primary key references public.item (item_id) on delete cascade,
  slimmed_at        timestamptz not null default now(),
  readings_dropped  integer not null check (readings_dropped >= 0),
  search_dropped    integer not null check (search_dropped >= 0)
);

comment on table internal.post_slim is
  'Posts slimmed after 7 days (0103): only the first reading of each counter is left in public.observation; the search record, the picture link and the cached newest count are gone.';

create table internal.post_slim_cursor (
  id             boolean primary key default true check (id),
  first_seen_at  timestamptz not null,
  item_id        text not null,
  updated_at     timestamptz not null default now()
);

comment on table internal.post_slim_cursor is
  'How far the post slimming job has decided, in (first_seen_at, item_id) order (0103). One row.';
