-- 0013_realtime.sql
-- Broadcast, sharded per story. Postgres Changes is disqualified: with RLS,
-- 4,000 clients cap at ~5 changes/sec because changes are processed on a
-- single thread to preserve order, and every change costs one authorization
-- read PER SUBSCRIBED CLIENT. It also forces replica identity full, which
-- writes the entire old row to WAL on every UPDATE.
BEGIN;
SELECT insidor.migration_begin('0013', 'realtime', '@@CHECKSUM_0013@@');

-- The old build set `replica identity full` on narratives and narrative_posts.
-- Assert it is not set here; nothing in this design needs it.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['story','post','coin','coin_match'] LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY DEFAULT', t);
  END LOOP;
END $$;

-- Comments broadcast from the INSERT handler on a server-owned per-story
-- channel, sanitised row only, AFTER the status check.
--
-- postgres_changes on `comment` would ignore the read-path status filter and
-- broadcast every address-gated and silently dropped row to every client --
-- delivering the spammer's contract address FASTER than an unmoderated feed.
CREATE OR REPLACE FUNCTION insidor.broadcast_comment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status <> 'visible' THEN
    RETURN NULL;                          -- held/blocked rows never leave the DB
  END IF;
  PERFORM realtime.send(
    jsonb_build_object(
      'id',            NEW.id,
      'story_id',      NEW.story_id,
      'author_wallet', NEW.author_wallet,
      'body',          NEW.body,
      'created_at',    NEW.created_at,
      'snap_views',        NEW.snap_views,
      'snap_coin_count',   NEW.snap_coin_count,
      'snap_age_min',      NEW.snap_age_min,
      'snap_early',        NEW.snap_early,
      'snap_position_state', NEW.snap_position_state
    ),
    'insert',
    'story:' || NEW.story_id::text,       -- sharded per story, from day one
    true                                   -- private channel
  );
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS comment_broadcast ON public.comment;
CREATE TRIGGER comment_broadcast AFTER INSERT ON public.comment
  FOR EACH ROW EXECUTE FUNCTION insidor.broadcast_comment();

-- The transition the product exists to occupy: a story's confirmed count going
-- 0 -> >=1 while somebody is looking at it. The client FREEZES the button and
-- renders an interstitial; it never mutates a control under a travelling
-- finger.
CREATE OR REPLACE FUNCTION insidor.broadcast_coin_match() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'story_id', NEW.story_id,
      'mint',     NEW.mint,
      'verdict',  NEW.verdict,
      'relation', NEW.relation,
      'ticker',   NEW.ticker,
      'mint_time', NEW.mint_time,
      'evidence_public', NEW.evidence_public,
      'retracted', NEW.retracted_at IS NOT NULL
    ),
    CASE WHEN NEW.retracted_at IS NOT NULL THEN 'retracted' ELSE 'match' END,
    'coin:' || NEW.story_id::text,
    true
  );
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS coin_match_broadcast ON public.coin_match;
CREATE TRIGGER coin_match_broadcast AFTER INSERT OR UPDATE ON public.coin_match
  FOR EACH ROW EXECUTE FUNCTION insidor.broadcast_coin_match();

-- The board is broadcast by the rank-commit job, not by a trigger: it must be
-- change-driven with per-client coalescing into at most one frame per 500ms,
-- and an idle 3 a.m. board must cost approximately zero.
--
-- UNVERIFIED, and worth checking before relying on it: whether Supabase's
-- documented messages/sec limit is scoped per-project, per-channel or
-- per-client. The tier values are confirmed; the scope is not.

SELECT insidor.migration_end('0013', 'realtime', '@@CHECKSUM_0013@@');
COMMIT;
