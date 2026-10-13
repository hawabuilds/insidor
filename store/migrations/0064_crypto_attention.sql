-- 0064_crypto_attention.sql
--
-- WHAT THE REPLIES AND QUOTE POSTS UNDER A FOR YOU POST SAY ABOUT COINS, AS FACTS.
--
-- The owner's sheets: 64% of coined posts had "crypto noticed" and 38% a ticker in the replies.
-- The runner's crypto-attention step reads the newest replies and quote posts of each text post
-- that clears For You's reach bar (Policy.attention: 20 of each, one search page), once, and once
-- more an hour later, and core `attentionFacts` counts what is in them. One row per read.
--
--   replies_read / quotes_read    how many were read; *_cut says the source had more, so every
--                                 count below is "at least"
--   cashtags                      {"TICKER": responses naming it}, tickers in capitals
--   coin_words                    responses using a coin word (Policy.attention.coinWords)
--   ca_mentions                   responses saying CA in the contract-address sense
--   contract_addresses            distinct address-shaped strings across the responses
--   crypto_quoters / crypto_repliers
--                                 distinct crypto accounts (by their own handle, name or profile,
--                                 or a cashtag or address in what they posted) among the quoters
--                                 and the repliers
--   first_signal_at               the earliest response carrying a cashtag, CA, an address, or a
--                                 crypto quoter; null when none did
--   cost_usd                      what the read cost on the posts line
--
-- `internal`, and MEASURED, NOT WIRED: nothing reads these rows to put a post on or off a feed.
-- They are facts about the world — a reader scrolling the same replies would count the same — and
-- the owner decides how they are used next to the judge.
--
-- What breaks if changed carelessly: a read that failed is NOT a row. A row of zeros would say
-- "nobody in the replies talked about a coin" on the strength of an outage; the post is read again
-- on a later pass instead. The day's cap counts these rows, so a failure does not use it up.

create table internal.crypto_attention (
  item_id             text not null,
  read_at             timestamptz not null,
  replies_read        integer not null check (replies_read >= 0),
  quotes_read         integer not null check (quotes_read >= 0),
  replies_cut         boolean not null,
  quotes_cut          boolean not null,
  cashtags            jsonb not null default '{}'::jsonb,
  coin_words          integer not null check (coin_words >= 0),
  ca_mentions         integer not null check (ca_mentions >= 0),
  contract_addresses  integer not null check (contract_addresses >= 0),
  crypto_quoters      integer not null check (crypto_quoters >= 0),
  crypto_repliers     integer not null check (crypto_repliers >= 0),
  first_signal_at     timestamptz,
  cost_usd            double precision not null check (cost_usd >= 0),
  primary key (item_id, read_at)
);

create index crypto_attention_read_at_idx on internal.crypto_attention (read_at);

comment on table internal.crypto_attention is
  'Crypto talk in the newest replies and quote posts of a For You post, counted as facts. One row per read; a failed read is no row. Measured, not used by any feed.';
comment on column internal.crypto_attention.first_signal_at is
  'The earliest response with a cashtag, CA, an address, or from a crypto quoter. Null: none had one.';
