-- supabase/tests/invariants.sql
-- Every product rule in §3 of the schema design, as a negative test. Each
-- block asserts that the BAD write is REJECTED. A constraint with no failing
-- test is a constraint nobody has proved exists.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/invariants.sql
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.rejects(p_sql text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS  %  (%)', p_label, left(SQLERRM, 90);
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL  %: the database ACCEPTED a write it must refuse', p_label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.accepts(p_sql text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

-- ---------------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------------
INSERT INTO public.story (id, status, title, subject, coinability_tier, coinability_reason,
                          first_post_at, promoted_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'open', 'Harbor horn goes viral in Bergen',
        'ferry horn', 'normal', 'no identifiable individual harmed',
        now() - interval '40 minutes', now() - interval '31 minutes');

INSERT INTO public.story (id, status, title, coinability_tier, coinability_reason,
                          first_post_at, promoted_at)
VALUES ('22222222-2222-2222-2222-222222222222', 'open', 'Public tragedy',
        'no_create', 'ongoing disaster', now() - interval '2 hours', now() - interval '1 hour');

-- Tier is not supplied: it defaults to 'never', which is the point.
INSERT INTO public.story (id, status, title, first_post_at, promoted_at)
VALUES ('33333333-3333-3333-3333-333333333333', 'open', 'Never surface story',
        now() - interval '2 hours', now() - interval '1 hour');

INSERT INTO public.app_user (id, privy_did, wallet_address)
VALUES ('99999999-9999-9999-9999-999999999999', 'did:privy:test1',
        'Vote111111111111111111111111111111111111111');

INSERT INTO public.post (id, story_id, platform, platform_post_id, author_handle, posted_at, text)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'x', '1234567890', 'nordkyst_ferge', now() - interval '40 minutes', 'the horn');

INSERT INTO public.coin (mint, symbol, name, decimals, minted_at, minted_at_source, creator_wallet)
VALUES ('So11111111111111111111111111111111111111112', 'FERRY', 'Ferry Horn', 6,
        now() - interval '27 minutes', 'pumpportal_create',
        'Vote111111111111111111111111111111111111111');

INSERT INTO public.coin (mint, symbol, name, decimals, minted_at, minted_at_source)
VALUES ('Stake11111111111111111111111111111111111111', 'KANG', 'Kangaroo', 6,
        now() - interval '600 days', 'pair_min');

INSERT INTO public.coin (mint, symbol, name, decimals)
VALUES ('Config1111111111111111111111111111111111111', 'NOAGE', 'Unknown Age', 6);

-- ===========================================================================
-- RULE 1. A coin match cannot render CONFIRMED without the evidence.
-- ===========================================================================
SELECT pg_temp.rejects($q$
  INSERT INTO public.coin_match (story_id, mint, verdict, relation, ticker, ticker_source,
                                 score, s_tick, time_prior, mint_time, earliest_post_at,
                                 matcher_version, evidence_public)
  VALUES ('11111111-1111-1111-1111-111111111111','So11111111111111111111111111111111111111112',
          'confirmed','derived','FERRY','cashtag',
          0.92, 0.95, 1.0, now() - interval '27 minutes', now() - interval '40 minutes',
          'v1', '{"ticker":"strong"}')
$q$, 'confirmed with ONE strong channel is rejected');

SELECT pg_temp.rejects($q$
  INSERT INTO public.coin_match (story_id, mint, verdict, relation, ticker, ticker_source,
                                 score, s_img, s_text, time_prior, mint_time, earliest_post_at,
                                 matcher_version, evidence_public)
  VALUES ('11111111-1111-1111-1111-111111111111','So11111111111111111111111111111111111111112',
          'confirmed','derived','FERRY','cashtag',
          0.61, 0.90, 0.90, 1.0, now() - interval '27 minutes', now() - interval '40 minutes',
          'v1', '{"image":"strong"}')
$q$, 'confirmed below the 0.80 score floor is rejected');

SELECT pg_temp.rejects($q$
  INSERT INTO public.coin_match (story_id, mint, verdict, relation, ticker, ticker_source,
                                 score, s_img, s_text, time_prior, earliest_post_at,
                                 matcher_version, evidence_public)
  VALUES ('11111111-1111-1111-1111-111111111111','Config1111111111111111111111111111111111111',
          'confirmed','derived','NOAGE','cashtag',
          0.95, 0.90, 0.90, 1.0, now() - interval '40 minutes', 'v1', '{"image":"strong"}')
$q$, 'confirmed with NULL mint_time fails closed (never "brand new")');

SELECT pg_temp.accepts($q$
  INSERT INTO public.coin_match (story_id, mint, verdict, relation, ticker, ticker_source,
                                 score, s_img, s_text, s_tick, time_prior, mint_time,
                                 earliest_post_at, matcher_version, evidence_public)
  VALUES ('11111111-1111-1111-1111-111111111111','So11111111111111111111111111111111111111112',
          'confirmed','derived','FERRY','cashtag',
          0.91, 0.88, 0.71, 0.95, 1.0, now() - interval '27 minutes',
          now() - interval '40 minutes', 'v1',
          '{"image":"strong","name":"strong","ticker":"strong","mint_in_post":"not_checked"}')
$q$, 'confirmed with two strong channels is accepted');

DO $$ BEGIN
  ASSERT (SELECT confirmed_coin_count FROM public.story
           WHERE id = '11111111-1111-1111-1111-111111111111') = 1,
    'confirmed_coin_count trigger did not fire';
  RAISE NOTICE 'PASS  confirmed_coin_count maintained by trigger';
END $$;

-- The GYATT class: a 600-day-old shell can never be DERIVED.
SELECT pg_temp.rejects($q$
  INSERT INTO public.coin_match (story_id, mint, verdict, relation, ticker, ticker_source,
                                 score, s_img, s_text, time_prior, mint_time, earliest_post_at,
                                 matcher_version, evidence_public)
  VALUES ('11111111-1111-1111-1111-111111111111','Stake11111111111111111111111111111111111111',
          'confirmed','derived','KANG','cashtag',
          0.95, 0.9, 0.9, 1.0, now() - interval '600 days', now() - interval '40 minutes',
          'v1', '{"image":"strong"}')
$q$, 'G2: a mint predating the story cannot be DERIVED');

-- ===========================================================================
-- RULE 2. A ticker with no provenance. The $KANG defect.
-- ===========================================================================
SELECT pg_temp.rejects($q$
  INSERT INTO public.story_ticker (story_id, ticker, name)
  VALUES ('11111111-1111-1111-1111-111111111111','KANG','Kangaroo Court')
$q$, 'a ticker with no source column cannot be inserted at all');

SELECT pg_temp.rejects($q$
  INSERT INTO public.story_ticker (story_id, ticker, source, source_span, resolved_mint)
  VALUES ('11111111-1111-1111-1111-111111111111','KANG','llm','kangaroo court',
          'Stake11111111111111111111111111111111111111')
$q$, 'an LLM-suggested ticker can never carry a mint');

SELECT pg_temp.rejects($q$
  INSERT INTO public.story_ticker (story_id, ticker, source)
  VALUES ('11111111-1111-1111-1111-111111111111','KANG','llm')
$q$, 'an ungrounded LLM suggestion (no source_span) cannot be stored');

SELECT pg_temp.rejects($q$
  INSERT INTO public.coin_match (story_id, mint, verdict, relation, ticker, ticker_source,
                                 score, s_img, s_text, time_prior, mint_time, earliest_post_at,
                                 matcher_version, evidence_public)
  VALUES ('22222222-2222-2222-2222-222222222222','Stake11111111111111111111111111111111111111',
          'confirmed','adopted','KANG','llm',
          0.95, 0.9, 0.9, 1.0, now() - interval '600 days', now() - interval '2 hours',
          'v1', '{"image":"strong"}')
$q$, 'an LLM-sourced ticker can never reach a CONFIRMED match');

-- ===========================================================================
-- RULE 3. A story surfacing when its coinability tier forbids it.
-- ===========================================================================
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.story WHERE display_eligible
    AND id = '33333333-3333-3333-3333-333333333333';
  ASSERT n = 0, 'a tier-never story is display_eligible';
  SELECT count(*) INTO n FROM public.story_cta_v WHERE id = '33333333-3333-3333-3333-333333333333';
  ASSERT n = 0, 'a tier-never story returns a CTA row';
  SELECT count(*) INTO n FROM public.eligible_story WHERE id = '33333333-3333-3333-3333-333333333333';
  ASSERT n = 0, 'a tier-never story is reachable through the search eligibility view';
  ASSERT (SELECT can_create FROM public.story_cta_v
           WHERE id = '22222222-2222-2222-2222-222222222222') = false,
    'a no_create story reports can_create = true';
  RAISE NOTICE 'PASS  coinability tiers gate display, search and create';
END $$;

SELECT pg_temp.rejects($q$
  INSERT INTO public.launch (story_id, story_coinability_tier, creator_user_id, signer_wallet,
                             creator_wallet, ticker, name, mint_keypair_enc)
  VALUES ('22222222-2222-2222-2222-222222222222','no_create',
          gen_random_uuid(),'Vote111111111111111111111111111111111111111',
          'Vote111111111111111111111111111111111111111','TRAGEDY','Tragedy','\x00')
$q$, 'a launch against a no_create story is a constraint violation');

SELECT pg_temp.rejects($q$
  INSERT INTO public.launch (story_id, story_coinability_tier, creator_user_id, signer_wallet,
                             creator_wallet, ticker, name, mint_keypair_enc)
  VALUES ('22222222-2222-2222-2222-222222222222','normal',
          gen_random_uuid(),'Vote111111111111111111111111111111111111111',
          'Vote111111111111111111111111111111111111111','TRAGEDY','Tragedy','\x00')
$q$, 'lying about the tier fails the composite foreign key');

-- ===========================================================================
-- RULE 4. promoted_at is immutable.
-- ===========================================================================
SELECT pg_temp.rejects($q$
  UPDATE public.story SET promoted_at = now()
   WHERE id = '11111111-1111-1111-1111-111111111111'
$q$, 'promoted_at cannot be overwritten once set');

SELECT pg_temp.accepts($q$
  UPDATE public.story SET title = 'Bergen harbour horn'
   WHERE id = '11111111-1111-1111-1111-111111111111'
$q$, 'other columns on a promoted story still update');

-- ===========================================================================
-- RULE 5. A lead time without both clock readings.
-- ===========================================================================
SELECT pg_temp.rejects($q$
  INSERT INTO public.story_clock (story_id, t_ct, t_ct_handle, t_ct_url,
                                  t_mint_observed_through, t_ct_observed_through, promoted_at)
  VALUES ('11111111-1111-1111-1111-111111111111', now(), 'a', 'https://x.com/a/status/1',
          now() - interval '90 minutes', now(), now())
$q$, 'a clock whose mint watermark predates promote is rejected');

SELECT pg_temp.rejects($q$
  INSERT INTO public.story_clock (story_id, t_ct, t_ct_handle, t_ct_url,
                                  t_ct_observed_through, promoted_at)
  VALUES ('11111111-1111-1111-1111-111111111111', now(), 'a', 'https://x.com/a/status/1',
          now(), now())
$q$, 'a clock with no mint-stream watermark at all is rejected');

SELECT pg_temp.rejects($q$
  INSERT INTO public.story_clock (story_id, t_ct,
                                  t_mint_observed_through, t_ct_observed_through, promoted_at)
  VALUES ('11111111-1111-1111-1111-111111111111', now(), now(), now(), now())
$q$, 'a t_ct with no handle and no permalink is rejected: the proof travels with the claim');

SELECT pg_temp.accepts($q$
  INSERT INTO public.story_clock (story_id, t_ct, t_ct_handle, t_ct_url,
                                  t_mint_observed_through, t_ct_observed_through, promoted_at)
  VALUES ('11111111-1111-1111-1111-111111111111', now(), 'cryptoguy',
          'https://x.com/cryptoguy/status/9', now(), now(), now() - interval '99 years')
$q$, 'a clock with both watermarks and a linked first crypto post is accepted');

DO $$
DECLARE lead int; prom timestamptz;
BEGIN
  SELECT lead_time_min, promoted_at INTO lead, prom
    FROM public.story_clock WHERE story_id = '11111111-1111-1111-1111-111111111111';
  -- The caller passed promoted_at = 99 years ago; the trigger overwrote it
  -- with the story's own value, so lead is ~31 minutes and not ~52 million.
  ASSERT lead BETWEEN 25 AND 40,
    format('lead_time_min was %s: the trigger did not take promoted_at from the story', lead);
  RAISE NOTICE 'PASS  lead_time_min is GENERATED from the story''s own promote clock (% min)', lead;
END $$;

SELECT pg_temp.rejects($q$
  UPDATE public.story_clock SET t_ct = now() - interval '10 minutes'
   WHERE story_id = '11111111-1111-1111-1111-111111111111'
$q$, 'a first sighting cannot be moved after it is recorded');

-- ===========================================================================
-- Supporting rules
-- ===========================================================================
SELECT pg_temp.rejects($q$
  INSERT INTO public.coin_snapshot (mint, captured_at, price_usd, source)
  VALUES ('So11111111111111111111111111111111111111112', now(), 0, 'jupiter')
$q$, 'a zero price cannot be recorded as a fact');

SELECT pg_temp.rejects($q$
  INSERT INTO public.coin_snapshot (mint, captured_at, top10_pct, source)
  VALUES ('So11111111111111111111111111111111111111112', now(), 78.2, 'rugcheck')
$q$, 'a top-10 figure that did not exclude the bonding-curve PDA is rejected');

DO $$
DECLARE gate boolean;
BEGIN
  INSERT INTO public.coin_safety (mint) VALUES ('So11111111111111111111111111111111111111112');
  SELECT intrinsic_gate_pass INTO gate FROM public.coin_safety
   WHERE mint = 'So11111111111111111111111111111111111111112';
  ASSERT gate = false, 'an all-unknown safety row passed the hard gate';
  RAISE NOTICE 'PASS  unknown authorities fail the gate closed';
END $$;

SELECT pg_temp.rejects($q$
  INSERT INTO public.follow (device_id, story_id, coin_mint)
  VALUES ('0123456789abcdef','11111111-1111-1111-1111-111111111111',
          'So11111111111111111111111111111111111111112')
$q$, 'a follow cannot target a story AND a coin');

SELECT pg_temp.rejects($q$
  INSERT INTO public.story_outcome (story_id, outcome, first_coin_mint, peak_mcap,
                                    peak_mcap_samples, hit_threshold, classifier_version)
  VALUES ('11111111-1111-1111-1111-111111111111','hit',
          'So11111111111111111111111111111111111111112', 400000, 1, 250000, 'v1')
$q$, 'a "peak" market cap from one sample is rejected');

SELECT pg_temp.rejects($q$
  INSERT INTO public.comment (story_id, user_id, author_wallet, body, snap_views,
                              snap_coin_count, snap_unsure_count, snap_age_min, snap_early,
                              snap_position_state)
  VALUES ('11111111-1111-1111-1111-111111111111','99999999-9999-9999-9999-999999999999',
          'Vote111111111111111111111111111111111111111',
          'buy this So11111111111111111111111111111111111111112 now',
          340000, 1, 0, 40, true, 'none')
$q$, 'the address gate blocks a base58 run in a comment body, including this story''s own mint');

SELECT pg_temp.rejects($q$
  INSERT INTO public.comment (story_id, user_id, author_wallet, body, snap_views,
                              snap_coin_count, snap_unsure_count, snap_age_min, snap_early,
                              snap_position_state)
  VALUES ('33333333-3333-3333-3333-333333333333','99999999-9999-9999-9999-999999999999',
          'Vote111111111111111111111111111111111111111','take',
          1000, 0, 0, 40, true, 'none')
$q$, 'a comment on a tier-never story is refused at insert');

SELECT pg_temp.rejects($q$
  INSERT INTO public.comment (story_id, user_id, author_wallet, body, snap_views,
                              snap_coin_count, snap_unsure_count, snap_age_min, snap_early,
                              snap_position_state, snap_top_mcap)
  VALUES ('11111111-1111-1111-1111-111111111111','99999999-9999-9999-9999-999999999999',
          'Vote111111111111111111111111111111111111111','no coin yet',
          1000, 0, 0, 40, true, 'none', 0)
$q$, 'a zero-coin comment cannot carry a market cap: "$0 mcap" reads as a bug, not a fact');

SELECT pg_temp.rejects($q$
  INSERT INTO public.holding (user_id, wallet, mint, story_id, tokens_raw, decimals,
                             first_buy_at, minutes_early)
  VALUES ('99999999-9999-9999-9999-999999999999','Vote111111111111111111111111111111111111111',
          'Stake11111111111111111111111111111111111111','22222222-2222-2222-2222-222222222222',
          1000000, 6, now(), 31)
$q$, 'minutes_early cannot be frozen on a story with no measurable clock');

ROLLBACK;
