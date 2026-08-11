-- 0002_items.sql
--
-- Authors, items, and the carriers that make two items the same thing.
--
-- EVERY COLUMN HERE IS PLATFORM-NEUTRAL, and that is the entire point of the file.
-- There is no `views` column, no `retweets` column, no `play_count`. A source that
-- has no reproduction concept records that fact as a fidelity of 'absent' on an
-- observation, never as a zero in a column named after somebody else's feature.
-- The build this replaces wrote one vendor's share count into a column named
-- `retweets` and hardcoded the reproduction signal to 0; nothing objected, because
-- the column names came from a vendor and there was nothing to disagree with.

/* ── authors ──────────────────────────────────────────────────────────────
   Keyed by a stable source-side id, never by a display handle. Handles are
   renamed and reused, and a renamed handle silently re-attributes history. */

create table public.author (
  author_key    text primary key,          -- '<source>:<stable id>', assigned by the adapter
  source        text not null,
  source_author_id text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),

  -- Observed, not identifying. Present so a screen can render something; nothing
  -- joins on it and nothing is unique on it.
  display_name  text,
  handle        text,
  follower_count bigint,
  follower_count_observed_at timestamptz,

  unique (source, source_author_id)
);

comment on column public.author.handle is
  'Observed display handle. NEVER a join key: handles are renamed and reused.';

/* ── items ────────────────────────────────────────────────────────────────
   One row per thing a person posted, in our words. */

create table public.item (
  item_id        text primary key,          -- ours
  source         text not null,             -- 'x' | 'tiktok' | ... assigned by the adapter
  source_item_id text not null,             -- theirs
  author_key     text not null references public.author (author_key),

  -- NULL when the source omits it or is known to lie. Never defaulted to a guess:
  -- this column feeds the pre-mint ordering gate, where a confidently wrong
  -- timestamp is worse than an admitted absence.
  posted_at      timestamptz,
  first_seen_at  timestamptz not null,

  lang           text,
  -- Named `body` rather than `text` only because `text` is a type name in SQL and
  -- reads badly in every query. Same field as Item.text in the vocabulary.
  body           text not null default '',
  media          jsonb not null default '[]'::jsonb,

  -- The newest counter reading, cached for the tracking loop's convenience.
  -- NOT the record: public.observation is the record, and it is append-only.
  -- Anything that differences counters must read the series, not this column.
  counters       jsonb not null default '{}'::jsonb,
  counters_observed_at timestamptz,

  -- Lineage. Two columns rather than one, because the difference between them is
  -- the product thesis: a rebroadcast adds ZERO new authorship, a reproduction
  -- adds ONE. Collapsing them makes "a lot of people saw this" look like
  -- "people are making their own versions of this".
  rebroadcast_of text references public.item (item_id),
  reproduction_of text references public.item (item_id),

  format_ids     text[] not null default '{}',   -- reusable templates: a sound, an effect
  raw_ref        text not null,                  -- key into raw.capture / blob storage

  unique (source, source_item_id)
);

create index item_first_seen_idx on public.item (first_seen_at desc);
create index item_author_idx     on public.item (author_key, first_seen_at desc);
create index item_reproduction_idx on public.item (reproduction_of)
  where reproduction_of is not null;
create index item_format_idx on public.item using gin (format_ids);

/* ── carriers ─────────────────────────────────────────────────────────────
   A fingerprint is comparable only against the same kind. Two of the four kinds
   support a distance and get a Hamming index; two are exact-match and get a btree.

   The bit columns are native `bit(n)`, so the table works on a plain Postgres.
   Only the HNSW indexes need pgvector 0.8, which is what makes near-duplicate
   search an index in the database we already run rather than a second service. */

create extension if not exists vector;

create table public.item_fingerprint (
  item_id  text not null references public.item (item_id) on delete cascade,
  kind     text not null check (kind in ('imageHash', 'textShingle', 'formatId', 'entitySpan')),
  key      text not null,           -- opaque; comparable only within a kind

  -- Set for hash kinds, null for exact-match kinds. The check keeps the two
  -- families from drifting into one column that is sometimes a hash.
  image_bits bit(256),
  text_bits  bit(64),

  primary key (item_id, kind, key),
  constraint hash_bits_match_kind check (
    (kind = 'imageHash'   and image_bits is not null and text_bits is null) or
    (kind = 'textShingle' and text_bits  is not null and image_bits is null) or
    (kind in ('formatId', 'entitySpan') and image_bits is null and text_bits is null)
  )
);

create index fingerprint_key_idx on public.item_fingerprint (kind, key);

-- Hamming neighbours. A perceptual hash has no language and no platform: the same
-- image posted on two sources produces the same bits, which is what makes grouping
-- cross-platform and multilingual before any model exists.
create index fingerprint_image_hnsw on public.item_fingerprint
  using hnsw (image_bits bit_hamming_ops) where image_bits is not null;
create index fingerprint_text_hnsw on public.item_fingerprint
  using hnsw (text_bits bit_hamming_ops) where text_bits is not null;

/* ── raw captures ─────────────────────────────────────────────────────────
   What the vendor actually said, kept so an adapter bug is repairable by
   re-parsing rather than by re-buying the data. Reading a payload is an offline
   operation; nothing on the pipeline path selects from here. */

create table raw.capture (
  raw_ref     text primary key,       -- item.raw_ref points at this
  source      text not null,
  vendor      text not null,          -- who we paid; may differ from the source
  endpoint    text not null,
  captured_at timestamptz not null default now(),

  -- Small payloads inline; large ones by object-storage key. Exactly one is set,
  -- so "where is the body" never has two answers.
  payload     jsonb,
  blob_key    text,
  byte_size   integer,

  constraint payload_xor_blob check ((payload is null) <> (blob_key is null))
);

create index capture_time_idx on raw.capture (captured_at desc);

/* ── the app's read surface, granted by hand ──────────────────────────────
   Explicit, per table, with no default privileges behind it. Observations are
   NOT granted (see 0003): they carry fidelity and censoring, which are machinery. */

grant select on public.author, public.item, public.item_fingerprint to insidor_app;
