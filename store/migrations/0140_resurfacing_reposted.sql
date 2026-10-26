-- 0140_resurfacing_reposted.sql
--
-- A PLAIN REPOST IS A SHARE TOO. 0139 noted a huge account's quote of a post, or its own copy of the
-- post's picture or video. On 2026-10-26 @solana reposted @CapinUK's Breakpoint video, the one with
-- Dandy the dog in it; the runner skipped it, because a repost was neither, and the post never
-- reached For You while coins named for the dog were launched. A repost is the account putting the
-- post itself in front of all its followers: the strongest share there is.
--
-- `how` gains 'reposted'. Nothing else changes: one row per share, newest read by the projector.
--
-- What breaks if changed carelessly: the readers. Every reader of `how` (store resurfacing.ts, the
-- projector's resurfaced.ts, the app's decodeSharedBy) must know the word before a row carries it;
-- an app that does not drops the line and shows the card without it, never refuses the card.

alter table internal.resurfacing drop constraint if exists resurfacing_how_check;
alter table internal.resurfacing add constraint resurfacing_how_check check (how in ('quoted', 'samePicture', 'reposted'));
