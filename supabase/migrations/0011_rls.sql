-- 0011_rls.sql
--
-- THE WRITE MODEL, STATED PLAINLY:
--
--   The browser writes NOTHING. Every write in this product goes through a
--   server route holding the service role.
--
-- That is not timidity. Three reasons, in order:
--
--   1. There is no authenticated principal to authorise against yet. Privy has
--      no documented hook for injecting the `role: "authenticated"` claim
--      Supabase reads to pick a Postgres role, so a Privy JWT presented
--      directly to PostgREST runs as `anon`. RLS keyed on auth.jwt() would be
--      decoration. (VERIFY: Privy support, per U8.)
--   2. The highest-volume follower class is anonymous device follows. There is
--      no principal at all in that case, so no policy can distinguish the
--      owner of a device_id from anyone who guesses one.
--   3. Every write here has an invariant that needs a server-side READ to
--      establish: the comment position stamp needs a Helius call, the coin
--      match needs the evidence vector, the launch needs a fresh
--      count(confirmed)=0 at submit, the trade needs the SOL price captured
--      server-side. A direct client write cannot satisfy any of them.
--
-- So the policies below are almost entirely SELECT policies, and they exist to
-- make the coinability tier and the moderation state unbypassable on the READ
-- path -- which is the half that a browser can actually reach.
--
-- The `authenticated` INSERT policies for follow and comment are written now
-- and are inert until the role exists. Phase 2 is a Supabase config change,
-- not a migration.
BEGIN;
SELECT insidor.migration_begin('0011', 'rls', '@@CHECKSUM_0011@@');

-- ---------------------------------------------------------------------------
-- Baseline: nothing is readable or writable by anyone until named below.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'story','post','post_snapshot','post_heat','post_meme_score','post_embedding',
    'story_momentum','platform_norm','author_roster',
    'coin','coin_snapshot','coin_mcap_series','coin_safety','coin_image_embedding','creator_stat',
    'story_ticker','coin_match','match_label',
    'ct_mention','sensor_heartbeat','sensor_gap','story_clock','story_outcome',
    'board_state','board_tick','board_gate_count',
    'app_user','follow','holding','comment','comment_report',
    'notification','push_subscription','notification_prefs',
    'trade','launch','namer_run','fee_share','search_log',
    'ops_stage_run','ops_stage_expected','ops_event','ops_sli_sample','ops_funnel',
    'ops_budget_cap','ops_spend'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- PUBLIC READS. The claim has to be provable, so the evidence is public.
-- ---------------------------------------------------------------------------

-- story: the coinability tier is enforced HERE. A tier-`never` story is not
-- filtered out of a query; it is unreadable. "Absent entirely - no row, no
-- count, no gap, no trace" is a policy, not a WHERE clause someone can forget.
GRANT SELECT ON public.story TO anon, authenticated;
DROP POLICY IF EXISTS story_public_read ON public.story;
CREATE POLICY story_public_read ON public.story FOR SELECT TO anon, authenticated
  USING (display_eligible);
-- Merged ids 301 to the survivor, so the redirect target must be readable.
DROP POLICY IF EXISTS story_merged_redirect_read ON public.story;
CREATE POLICY story_merged_redirect_read ON public.story FOR SELECT TO anon, authenticated
  USING (status = 'merged' AND coinability_tier <> 'never');

DO $$
DECLARE t text;
BEGIN
  -- Tables whose visibility follows their story.
  FOREACH t IN ARRAY ARRAY['post','story_ticker','story_clock','story_outcome','story_momentum'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_public_read', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated
        USING (EXISTS (SELECT 1 FROM public.story s
                        WHERE s.id = %I.story_id AND s.display_eligible))
    $f$, t || '_public_read', t, t);
  END LOOP;
END $$;

-- An unclustered post has no story_id; it is not board-eligible and not
-- public. The policy above already excludes it (NULL story_id -> no match).

-- Coins are public unconditionally: a coin exists on Solana whether or not we
-- like the story it came from, and a pasted CA must resolve to something.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['coin','coin_snapshot','coin_safety','coin_mcap_series',
                           'creator_stat','platform_norm','board_state','board_gate_count',
                           'sensor_heartbeat','sensor_gap'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_public_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
                   t || '_public_read', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- coin_match: public read, but NOT of the score.
--
-- "The numeric score is stored and never sent to the client. Not in a tooltip,
-- not in a data attribute, not in the API response." A column-level GRANT is
-- the only version of that rule that survives someone writing `select *`.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS coin_match_public_read ON public.coin_match;
CREATE POLICY coin_match_public_read ON public.coin_match FOR SELECT TO anon, authenticated
  USING (
    retracted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.story s WHERE s.id = coin_match.story_id AND s.display_eligible)
  );
REVOKE SELECT ON public.coin_match FROM anon, authenticated;
GRANT SELECT (
  id, story_id, mint, verdict, relation, ticker, name, ticker_source,
  mint_time, earliest_post_at, delta_min, channels_ran, strong_channels,
  evidence_public, matched_at
) ON public.coin_match TO anon, authenticated;
-- Deliberately withheld: score, s_mint_in_post, s_img, s_text, s_tick,
-- s_social, time_prior, market_plausibility, evidence, matcher_version.

-- ct_mention: the proof surface. Handle, timestamp and permalink are public;
-- they belong to somebody else and that is the point.
GRANT SELECT (id, story_id, mint, handle, posted_at, permalink, matched_on)
  ON public.ct_mention TO anon, authenticated;
DROP POLICY IF EXISTS ct_mention_public_read ON public.ct_mention;
CREATE POLICY ct_mention_public_read ON public.ct_mention FOR SELECT TO anon, authenticated
  USING (true);

-- comment: visible rows are public; a held or blocked comment is visible to
-- its author only. Everyone else sees nothing -- not a placeholder, nothing.
GRANT SELECT ON public.comment TO anon, authenticated;
DROP POLICY IF EXISTS comment_public_read ON public.comment;
CREATE POLICY comment_public_read ON public.comment FOR SELECT TO anon, authenticated
  USING (
    status = 'visible'
    AND EXISTS (SELECT 1 FROM public.story s WHERE s.id = comment.story_id AND s.display_eligible)
  );
DROP POLICY IF EXISTS comment_author_read ON public.comment;
CREATE POLICY comment_author_read ON public.comment FOR SELECT TO authenticated
  USING (user_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', ''));

-- ---------------------------------------------------------------------------
-- NEVER READABLE BY A BROWSER, and why.
--
--   post_snapshot, post_heat, post_meme_score, post_embedding  raw sensor data
--                       and the scoring internals; the board reads board_state
--   coin_image_embedding, match_label, author_roster           model internals
--   trade, holding, app_user, notification, push_subscription  owner-scoped;
--                       served by authed routes, never by PostgREST
--   launch, namer_run, fee_share, search_log                   operational
--   ops_*                                                      DID allowlist;
--                       /ops returns a server 404 to everyone else
--   board_tick                                                 173k rows/day;
--                       the rail is pushed over Broadcast, never queried
-- ---------------------------------------------------------------------------

-- Owner-scoped reads, live the moment `authenticated` exists. Until then these
-- tables are reached only through server routes that verify the Privy token.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['holding','trade','notification','notification_prefs','push_subscription'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_read', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
        USING (user_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', ''))
    $f$, t || '_owner_read', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- WRITES. Two policies, both inert until Privy is configured as a Supabase
-- third-party JWT issuer with `sub` mapped to app_user.id.
--
-- Everything else -- coin_match, story, coin, story_clock, launch, trade,
-- holding, notification -- is written by the pipeline or by a server route
-- under the service role, which bypasses RLS. There is no policy for them
-- because there is no principal that should ever hold one.
-- ---------------------------------------------------------------------------
GRANT INSERT, DELETE ON public.follow TO authenticated;
DROP POLICY IF EXISTS follow_owner_write ON public.follow;
CREATE POLICY follow_owner_write ON public.follow FOR INSERT TO authenticated
  WITH CHECK (
    user_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')
    AND device_id IS NULL
  );
DROP POLICY IF EXISTS follow_owner_delete ON public.follow;
CREATE POLICY follow_owner_delete ON public.follow FOR DELETE TO authenticated
  USING (user_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', ''));
DROP POLICY IF EXISTS follow_owner_read ON public.follow;
CREATE POLICY follow_owner_read ON public.follow FOR SELECT TO authenticated
  USING (user_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', ''));

-- Comment INSERT is deliberately NOT granted even to `authenticated`. The
-- position stamp requires a chain read and the tier check requires a story
-- read; a direct client insert would produce a comment with a fabricated
-- stamp. The route is the only path, permanently.

-- Anonymous device follows have no principal and are therefore server-routed
-- with an edge rate limit keyed on device_id.

SELECT insidor.migration_end('0011', 'rls', '@@CHECKSUM_0011@@');
COMMIT;
