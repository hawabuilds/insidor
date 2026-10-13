-- 0059_coin_logo.sql
--
-- WHICH COINS' LOGOS HAVE BEEN COPIED INTO OUR STORAGE, FROM WHERE, OR WHY NOT.
--
-- Every list of coins in the phone app shows a logo, and until now each one loaded from wherever
-- the coin's picture happened to live: a creator's IPFS link through a public gateway, which can
-- take seconds or never answer. The mirror job (services/project/src/coin-logos.ts) copies each
-- shown coin's picture into the public launch-metadata bucket at `coin-logos/<address>`, and the
-- app asks that path first. This table is the job's ledger, so a coin is copied once, a coin with
-- no picture anywhere is not asked about every pass, and a failed copy is retried a bounded
-- number of times.
--
--   outcome  'stored'   the file is at coin-logos/<address>; `source` says whose picture it is
--            'none'     neither source had a picture: the market source listed none and the
--                       coin's metadata named none. Asked again after a while (a coin listed
--                       later gains a picture).
--            'failed'   a picture existed and could not be copied (host down, too large, not a
--                       picture). `attempts` counts tries; the job stops at its cap.
--   source   'market'   the market source's copy of the coin's picture (first choice)
--            'launch'   the picture in the coin's own metadata, from its launch (second choice)
--
-- `internal`, no grant: the app never reads this. It needs only the path, which is the address.
--
-- What breaks if changed carelessly: the outcome list. A value the job can write and this CHECK
-- refuses fails the write after the copy was made, and the coin is copied again every pass.

create table internal.coin_logo (
  address     text primary key,
  outcome     text not null check (outcome in ('stored', 'none', 'failed')),
  source      text check (source in ('market', 'launch')),
  attempts    integer not null default 1 check (attempts >= 1),
  checked_at  timestamptz not null,
  constraint stored_has_source check ((outcome = 'stored') = (source is not null))
);

create index coin_logo_retry_idx on internal.coin_logo (checked_at) where outcome <> 'stored';

comment on table internal.coin_logo is
  'The coin-logo mirror''s ledger: copied into storage (and from which source), no picture anywhere, or a failed copy with its tries.';
