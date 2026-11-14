-- 0173_coin_first_matched.sql
--
-- WHEN A COIN WAS FIRST MATCHED TO A POST, FOR CALLS MADE BEFORE CARD MOMENTS WERE RECORDED (the
-- owner, 2026-11-14: "make sure it's accurate").
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- 0145 began recording the moment a For You card first showed a coin on 27 October 18:35 UTC. For an
-- older call the calls board (services/read calls.ts) starts at the post's first For You frame when
-- that came before the coin's first alert ($FTR: a minute after launch, its alert five hours later).
-- But a card shows a coin only once the coin is matched to the post; starting at the frame would
-- credit a run nobody saw if the match came later. Of 118 such calls with a match time, 114 were
-- matched within five minutes of the frame, three later, one after the alert.
--
-- ── WHAT IS ADDED ────────────────────────────────────────────────────────
--
-- public.coin_first_matched   per post and coin, the first time the coin was found as the post's
--                             candidate (internal.one_coin_candidate, from 19 October), kept to before
--                             27 October 18:35 UTC — the only calls that need it — so the view stays
--                             small. Runs as its owner: the read role is never granted internal.
--
-- What breaks if changed carelessly: the cut-off. Later calls have their card moment in 0145's
-- coin_shown and must not be moved by this.

create view public.coin_first_matched as
select item_id, address, min(found_at) as found_at
  from internal.one_coin_candidate
 where found_at < timestamptz '2026-10-27 18:35:18+00'
 group by item_id, address;

comment on view public.coin_first_matched is
  'Per post and coin, when the coin was first matched to the post, before card moments were recorded (0173). For the calls board''s older calls; runs as its owner.';

grant select on public.coin_first_matched to insidor_app;
