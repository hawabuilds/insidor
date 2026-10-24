-- 0129_saved_post_read.sql
--
-- WHAT IS READ TO PUSH A SAVED POST'S COIN WHEN IT STARTS RUNNING: the alert service reads the
-- runner's launch candidates and its one-coin picks (0113), and the market reader learns which
-- coins are tied to saved posts so it keeps reading them.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner saved @AOYAN_xD's Kuribo video (x:2113519213507969247) at 17:11 UTC on 23 Oct. $KURIBO
-- launched from it at 22:47:10 and the runner tied it to the post seven seconds later
-- (internal.one_coin_candidate, path 'launch'), but the alert service saw a coin only when the
-- projector put the confirmed pick on the card, at 23:53 — an hour after the launch. The owner,
-- 2026-10-24: "a saved post always pushes", on the first coin tied to the post after the save that
-- starts running (services/notify saved-post.ts), and once more if the coin the pick settles on is
-- another. That needs the candidates as the runner writes them, the pick as soon as it is decided,
-- and a fresh market reading of each tied coin: $KURIBO was read at 22:51 and then not again until
-- 23:53, because the market reader reads a new coin only in its first minutes unless a card names it.
--
-- insidor_people: SELECT on the two tables only. Both stay internal: the candidates' ties and the
-- pick's standings are the system's reasoning, and the alert service puts on a phone only the coin's
-- ticker, its cap and the post's words (text.ts).
--
-- internal.saved_post_coins(now, within, limit), executable by insidor_service only (the market
-- reader's role): the addresses tied to a saved post (a link or an exact name, the same ties
-- saved-post.ts SAVED_TIES counts), launched after the post was first saved and within `within` of
-- `now`, newest launch first. Addresses only — never who saved what: the market reader has no
-- business with people, and `security definer` lets it ask this without a grant on people.post_watch.
--
-- The app role gets nothing here.
--
-- What breaks if changed carelessly: granting insert or update on the picks (the runner is their
-- only writer; a second would make the card and the push disagree about the post's coin), or
-- returning a user id from the function. Both readers look their grants up first, so code deployed
-- before this migration falls back (notify: the card's coin and coin_first_post; market: its usual
-- coins) and sends no failed statement.

grant select on internal.one_coin_candidate, internal.post_coin_pick to insidor_people;

create function internal.saved_post_coins(p_now timestamptz, p_within_ms double precision, p_limit integer)
returns table (address text)
language sql
stable
security definer
set search_path = internal
as $$
  select c.address
    from internal.one_coin_candidate c
    join (select item_id, min(created_at) as saved_at from people.post_watch group by item_id) w on w.item_id = c.item_id
   where c.launched_at >= w.saved_at - interval '1 minute'
     and c.launched_at >= p_now - make_interval(secs => p_within_ms / 1000)
     and c.evidence -> 'ties' ?| array['link', 'name_judge', 'name_guess', 'name_text']
   group by c.address
   order by max(c.launched_at) desc, c.address
   limit greatest(0, least(p_limit, 500));
$$;

revoke all on function internal.saved_post_coins(timestamptz, double precision, integer) from public;
grant execute on function internal.saved_post_coins(timestamptz, double precision, integer) to insidor_service;

comment on function internal.saved_post_coins(timestamptz, double precision, integer) is
  'Coins tied to a saved post by a link or an exact name, launched after the save and within a window of now: the market reader keeps reading them so the saved-post push can tell when one starts running. Addresses only (0129).';
