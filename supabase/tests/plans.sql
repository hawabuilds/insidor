-- supabase/tests/plans.sql
-- The four hot queries must not regress into a Seq Scan or a Sort on the
-- ordering path. Run against a seeded database; fails the build if a plan
-- degrades. This is the only guard against someone dropping an index that
-- nothing obviously references.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert_plan(p_sql text, p_forbidden text[], p_label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE plan text; bad text;
BEGIN
  EXECUTE 'EXPLAIN (FORMAT TEXT) ' || p_sql INTO plan;
  FOREACH bad IN ARRAY p_forbidden LOOP
    IF position(bad IN plan) > 0 THEN
      RAISE EXCEPTION 'FAIL  %: plan contains "%"%s', p_label, bad, E'\n' || plan;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

-- Q1 posts board: an ordered index scan on board_state, no sort.
SELECT pg_temp.assert_plan($q$
  SELECT bs.rank, p.id, h.presented_heat, s.confirmed_coin_count, sc.lead_time_min
    FROM public.board_state bs
    JOIN public.post p ON p.id = bs.post_id
    JOIN public.post_heat h ON h.post_id = p.id
    JOIN public.story s ON s.id = p.story_id
    LEFT JOIN public.story_clock sc ON sc.story_id = s.id
   WHERE bs.lane = 'posts' ORDER BY bs.rank LIMIT 40
$q$, ARRAY['Seq Scan on board_state', 'Sort'], 'Q1 posts board uses board_state_rank_key');

-- Q2 coins board: the latest-snapshot lateral must be a backwards index scan.
SELECT pg_temp.assert_plan($q$
  SELECT c.mint, snap.price_usd
    FROM public.board_state bs
    JOIN public.coin c ON c.mint = bs.mint
    LEFT JOIN LATERAL (SELECT s2.price_usd FROM public.coin_snapshot s2
                        WHERE s2.mint = c.mint ORDER BY s2.captured_at DESC LIMIT 1) snap ON true
   WHERE bs.lane = 'coins' AND bs.band = 'fresh' ORDER BY bs.rank LIMIT 40
$q$, ARRAY['Seq Scan on coin_snapshot', 'Seq Scan on board_state'],
     'Q2 coins board uses coin_snapshot_latest_idx');

-- Q3 story page: every leg is a primary-key or story_id index lookup.
SELECT pg_temp.assert_plan($q$
  SELECT m.mint FROM public.coin_match m
   WHERE m.story_id = '11111111-1111-1111-1111-111111111111'::uuid
     AND m.retracted_at IS NULL
   ORDER BY (m.verdict = 'confirmed') DESC, m.score DESC
$q$, ARRAY['Seq Scan on coin_match'], 'Q3 matches use coin_match_story_idx');

SELECT pg_temp.assert_plan($q$
  SELECT id FROM public.comment
   WHERE story_id = '11111111-1111-1111-1111-111111111111'::uuid AND status = 'visible'
   ORDER BY snap_views ASC, created_at ASC LIMIT 50
$q$, ARRAY['Seq Scan on comment', 'Sort'], 'Q3 discussion uses comment_story_earliest_idx');

-- Q4 the record.
SELECT pg_temp.assert_plan($q$
  SELECT o.outcome, o.lead_time_min FROM public.story_outcome o
    JOIN public.story s ON s.id = o.story_id
    JOIN public.story_clock sc ON sc.story_id = o.story_id
   WHERE s.earliness_eligible ORDER BY o.classified_at DESC LIMIT 50
$q$, ARRAY['Seq Scan on story_outcome', 'Sort'], 'Q4 record uses story_outcome_recent_idx');
