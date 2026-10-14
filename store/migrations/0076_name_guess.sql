-- 0076_name_guess.sql
--
-- WHAT PEOPLE ACTUALLY NAMED A COIN MADE FROM A POST, AND OUR GUESS FOR A NEW POST. The owner,
-- 2026-10-14: "from a post, predict the names and tickers people will actually coin it as", for
-- both coin matching and the Create sheet's suggestions, learning from every coin he confirms.
--
-- 1. internal.name_example — every known post → coin pair, one row per post and coin name:
--    the founders' coined sheet and its known origin posts (tools/name-examples.ts, once), the
--    owner's confirmed coins (pasted address, "This is the coin", "Right coin", the pick after
--    "Wrong coin"), gold additions, coins created on Insidor from a post, and every coin whose
--    own links carry the post (a proven match). The runner adds the owner's new ones each pass
--    (services/runner work/name-guesses.ts), so a confirmation is an example within minutes.
--
--      item_id      the post, as the feed names it ('x:…', 'tiktok:…'); a sheet row whose post we
--                   never read is keyed by the sheet's own id ('sheet:bt2:1') and has no text
--      address      the coin, when known
--      name/ticker  as the coin's own metadata spells them; the ticker without '$'
--      source       where the pair came from (closed list below); the first source to write a
--                   pair keeps it — a later, stronger source does not rewrite the words
--      text         the post's words as the namer is shown them; '' for a picture-only post
--      picture      the picture embedded with the words, when we hold one
--      seen         a few words on what the picture shows, when we have them (the namer writes
--                   one for each post it guesses on; the bootstrap rows have none)
--      posted_at    when the post was made, when known: the measurement only lets a post learn
--                   from examples older than itself
--
-- 2. internal.name_example_embedding — one vector per example POST (not per name), in the same
--    space and from the same input as internal.post_embedding (0074): core `embedInput` over the
--    words and the picture. Kept for good: 0074's rows are pruned after three days, and an
--    example is worth most when it is old.
--
-- 3. internal.name_guess — the namer's top guesses for a post that passed the bar, best first:
--    what coin matching searches with and what the Create sheet offers first. Replaced whole
--    when a post is guessed again.
--
-- 4. internal.create_pick — what the owner did with the Create sheet's suggestions when a coin
--    he created from a post landed: which suggestion he kept (its position in what was
--    offered), or null when he typed his own. The created coin is also an example (1). Written
--    only through public.record_create_pick, the one thing here the app role may call.
--
-- The tables are all `internal`, no grant to the app: a guess is the system's reasoning and never reaches a
-- screen as one. What the Create sheet shows is public.post_name_idea (0058), which the
-- projector fills from these guesses first.
--
-- What breaks if changed carelessly: the vector must be built the way 0074's is, or the nearest
-- examples of a feed post are nearest by something else; and `posted_at` must stay the post's
-- own time, not when the row was written, or the before/after measurement leaks the answer.

create table internal.name_example (
  item_id     text not null check (length(item_id) > 0),
  address     text,
  name        text not null check (length(name) between 1 and 64),
  ticker      text not null check (length(ticker) between 1 and 16),
  source      text not null check (source in ('sheet', 'known', 'owner', 'gold', 'created', 'linked')),
  text        text not null default '',
  picture     text,
  seen        text,
  posted_at   timestamptz,
  added_at    timestamptz not null default now()
);

-- One row per post and coin name: the same coin read from two sources is one example.
create unique index name_example_pair_idx on internal.name_example (item_id, lower(name), upper(ticker));
create index name_example_added_at_idx on internal.name_example (added_at);

create table internal.name_example_embedding (
  item_id      text not null check (length(item_id) > 0),
  space        text not null check (length(space) > 0),
  embedding    vector(1024) not null,
  embedded_at  timestamptz not null default now(),
  primary key (item_id, space)
);

create table internal.name_guess (
  item_id     text not null check (length(item_id) > 0),
  rank        integer not null check (rank >= 0),
  name        text not null check (length(name) between 1 and 64),
  ticker      text not null check (ticker ~ '^[A-Z0-9]{1,10}$'),
  seen        text,
  model       text not null,
  prompt_id   text not null,
  guessed_at  timestamptz not null default now(),
  primary key (item_id, rank)
);

create index name_guess_guessed_at_idx on internal.name_guess (guessed_at);

create table internal.create_pick (
  id          bigserial primary key,
  item_id     text not null check (length(item_id) > 0),
  address     text not null,
  name        text not null,
  ticker      text not null,
  -- the position in `offered` of the suggestion kept; null: typed by hand
  pick        integer check (pick is null or pick >= 0),
  offered     jsonb not null default '[]'::jsonb,
  wallet      text not null,
  created_at  timestamptz not null default now()
);

create unique index create_pick_address_idx on internal.create_pick (address);

-- The trade service holds the app role, which never writes (0042's reason): it records a pick only
-- through this function, after the coin is recorded as created (0042), once per coin. Anything
-- not shaped like a post id, an address, a name, a ticker or a short list of ideas is refused.
create function public.record_create_pick(p_address text, p_item_id text, p_name text, p_ticker text, p_pick integer, p_offered jsonb, p_wallet text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_address !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' or p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return; end if;
  if p_item_id is null or p_item_id !~ '^[a-z]{1,20}:[A-Za-z0-9_.-]{1,64}$' then return; end if;
  if coalesce(length(trim(p_name)), 0) not between 1 and 64 or coalesce(length(trim(p_ticker)), 0) not between 1 and 16 then return; end if;
  if p_pick is not null and (p_pick < 0 or p_pick > 20) then return; end if;
  if p_offered is null or jsonb_typeof(p_offered) <> 'array' or jsonb_array_length(p_offered) > 20 or length(p_offered::text) > 4000 then return; end if;
  if not exists (select 1 from public.created_coin c where c.address = p_address) then return; end if;
  insert into internal.create_pick (item_id, address, name, ticker, pick, offered, wallet)
  values (p_item_id, p_address, trim(p_name), trim(p_ticker), p_pick, p_offered, p_wallet)
  on conflict (address) do nothing;
end;
$$;

revoke all on function public.record_create_pick(text, text, text, text, integer, jsonb, text) from public;
grant execute on function public.record_create_pick(text, text, text, text, integer, jsonb, text) to insidor_app;

comment on table internal.name_example is
  'Known post-to-coin name pairs the namer learns from: the coined sheet, known posts, the owner''s confirmed coins, gold, coins created here, coins whose links carry the post. Never served.';
comment on table internal.name_example_embedding is
  'One words-and-picture vector per example post, in the post space of 0074; kept for good. Never served.';
comment on table internal.name_guess is
  'The namer''s top guesses of the names and tickers people will coin a post as, best first. Never served as guesses.';
comment on table internal.create_pick is
  'Which Create suggestion the owner kept, or null when he typed his own, for each coin he created from a post.';
