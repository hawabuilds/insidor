-- 0012_views.sql
-- The single row every Create affordance reads, and the two predicates that
-- must have exactly one implementation in the whole product.
BEGIN;
SELECT insidor.migration_begin('0012', 'views', '@@CHECKSUM_0012@@');

-- ---------------------------------------------------------------------------
-- tradeable(): identity is not tradeability. `verdict = 'confirmed'` never
-- expires -- a rugged coin would otherwise render Buy forever -- so the
-- resolver takes two inputs and this is the second one.
--
-- Concentration is band-dependent on purpose: a flat 60% gate empties Fresh on
-- day one, when a three-minute-old token has nine buyers and is legitimately
-- concentrated.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coin_tradeable(
  p_band              coin_band,
  p_intrinsic_gate    boolean,
  p_liquidity_usd     numeric,
  p_top10_pct         real,
  p_buys_5m           integer,
  p_sells_5m          integer,
  p_price_captured_at timestamptz,
  p_minted_at         timestamptz
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(p_intrinsic_gate, false)                        -- unknown fails closed
     AND p_minted_at IS NOT NULL                                  -- unknown age fails closed
     AND p_top10_pct IS NOT NULL
     AND p_top10_pct <= CASE WHEN p_band = 'fresh' THEN 85 ELSE 60 END
     AND (p_band <> 'live' OR COALESCE(p_liquidity_usd, 0) >= 3000)
     AND NOT (COALESCE(p_sells_5m, 0) = 0 AND COALESCE(p_buys_5m, 0) > 30)  -- honeypot proxy
     AND p_price_captured_at IS NOT NULL
     AND p_price_captured_at > now() - interval '5 minutes'
$$;

-- ---------------------------------------------------------------------------
-- story_cta_v -- ONE row read, and no client-side coinability logic anywhere.
-- Every Create affordance in the product runs:
--     select can_create, buy_count, unsure_count, cooldown_until
--       from story_cta_v where id = $1
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.story_cta_v AS
SELECT
  s.id,
  s.can_create,
  s.coinability_tier,
  s.confirmed_coin_count AS buy_count,
  s.unsure_coin_count    AS unsure_count,
  s.needs_review,
  (SELECT count(*) FROM public.launch l
    WHERE l.story_id = s.id AND l.created_at > now() - interval '1 hour')  AS launches_last_1h,
  (SELECT count(*) FROM public.launch l
    WHERE l.story_id = s.id AND l.created_at > now() - interval '24 hours') AS launches_last_24h,
  (SELECT m.mint FROM public.coin_match m
    WHERE m.story_id = s.id AND m.verdict = 'confirmed' AND m.retracted_at IS NULL
    ORDER BY m.mint_time NULLS LAST LIMIT 1)   AS first_confirmed_mint,
  (SELECT m.ticker FROM public.coin_match m
    WHERE m.story_id = s.id AND m.verdict = 'confirmed' AND m.retracted_at IS NULL
    ORDER BY m.mint_time NULLS LAST LIMIT 1)   AS first_confirmed_ticker
FROM public.story s
WHERE s.display_eligible;

COMMENT ON VIEW public.story_cta_v IS
  'The gate is in the query. A tier <= no_create story returns can_create = false, and a tier `never` story returns no row at all because it is not display_eligible.';

-- ---------------------------------------------------------------------------
-- The public record. States its denominator, defaults to All, and every rate
-- is against an explicit count. A materialized view because /ops/earliness and
-- the public record must read the SAME numbers from the SAME place.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS public.record_summary_mv;
CREATE MATERIALIZED VIEW public.record_summary_mv AS
SELECT
  count(*)                                                        AS stories_total,
  count(*) FILTER (WHERE o.outcome <> 'no_coin')                  AS got_a_coin,
  count(*) FILTER (WHERE o.outcome  = 'no_coin')                  AS never_did,
  count(*) FILTER (WHERE o.lead_time_min >  2)                    AS early_n,
  count(*) FILTER (WHERE o.lead_time_min < -2)                    AS late_n,
  count(*) FILTER (WHERE o.lead_time_min BETWEEN -2 AND 2)        AS same_minute_n,
  count(*) FILTER (WHERE o.outcome = 'unmeasurable')              AS unmeasurable_n,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY o.lead_time_min)
    FILTER (WHERE o.lead_time_min >  2)                           AS median_lead_early,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY o.lead_time_min)
    FILTER (WHERE o.lead_time_min < -2)                           AS median_lead_late,
  (SELECT count(*)::numeric / NULLIF(count(*) FILTER (WHERE m.verdict IN ('confirmed','unsure')), 0)
     FROM public.coin_match m WHERE m.verdict = 'unsure')          AS abstain_rate,
  now()                                                           AS computed_at
FROM public.story_outcome o
JOIN public.story s ON s.id = o.story_id
WHERE s.earliness_eligible;

CREATE UNIQUE INDEX IF NOT EXISTS record_summary_mv_key ON public.record_summary_mv (computed_at);

COMMENT ON MATERIALIZED VIEW public.record_summary_mv IS
  'n < 30 renders every percentile as an em dash with "not enough data (n=12)". The `late_n` figure is published in the same weight as `early_n`; a record with no left tail is marketing.';

SELECT insidor.migration_end('0012', 'views', '@@CHECKSUM_0012@@');
COMMIT;
