-- 0071_coin_logo_sources.sql
--
-- EVERY COIN'S LOGO, FROM EVERY PLACE IT CAN COME FROM — AND, WHEN NONE ANSWERS, WHY.
--
-- Every coin the launchpad makes has a picture; it refuses a launch without one. So a coin the app
-- draws as a letter is a coin whose picture we failed to fetch. On 2026-10-13 that was 249 of the
-- 556 coins a post sheet or "See N coins" could list, for two reasons this migration removes:
--
--   1. internal.coin_metadata refused every document read from its creator's own host. 0034's
--      `read_has_content_id` said a read document always has a content id; the reader added on
--      2026-10-13 (adapter declared-metadata.ts) reads documents that have none, and every one of
--      its writes failed the check and was recorded `unavailable` instead — over 1,600 coins in
--      three hours, the tweet-deploy coins most of all, each with no picture and no links. The
--      rule now runs one way only: a content id is kept only on a read document.
--      Their `attempts` go back to 1, so the runner reads them again inside its lookback window.
--
--   2. internal.coin_logo knew two sources and no reason. The mirror (services/project/src/
--      coin-logos.ts) now tries, in the owner's order: the picture in the coin's metadata
--      (`launch`, through a chain of IPFS gateways), the launchpad's own copy (`venue`), then the
--      market source's (`market`). `why` says, for a coin left without a logo, what was tried and
--      what each answered — the coins the app draws as a letter, countable with
--        select why, count(*) from internal.coin_logo where outcome <> 'stored' group by why;
--      A row from before this migration has no `why`; the mirror takes those as never tried.
--
-- What breaks if changed carelessly: the source list must equal LogoSource in coin-logos.ts. A
-- value the job can write and this CHECK refuses fails the record after the copy was made, and the
-- coin is copied again every pass.

alter table internal.coin_metadata drop constraint read_has_content_id;
alter table internal.coin_metadata
  add constraint content_id_only_when_read check (content_id is null or outcome = 'read');

update internal.coin_metadata set attempts = 1 where outcome = 'unavailable';

alter table internal.coin_logo drop constraint coin_logo_source_check;
alter table internal.coin_logo
  add constraint coin_logo_source_check check (source in ('launch', 'venue', 'market'));
alter table internal.coin_logo add column why text check (why is null or length(why) between 1 and 500);

comment on column internal.coin_logo.why is
  'For a coin with no stored logo: each source tried and what it answered. Null when stored, or for a row older than 0071.';
