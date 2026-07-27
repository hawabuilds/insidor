-- 0009_search.sql
-- Generated tsvectors, GIN, trigram and HNSW indexes, plus search_log. Ships
-- with v1 or the RRF weights stay guesses forever.
BEGIN;
SELECT insidor.migration_begin('0009', 'search', '@@CHECKSUM_0009@@');

-- to_tsvector(regconfig, text) is IMMUTABLE only when the config is a literal
-- cast; to_tsvector(text, text) is STABLE and cannot be used in a generated
-- column. The ::regconfig cast is load-bearing.

-- array_to_string is provolatile='s', not 'i' — it invokes the element type's
-- output function, which may be stable (timestamptz_out reads the TimeZone
-- GUC), and Postgres will not assume otherwise for an arbitrary element type.
-- A STORED generated column requires IMMUTABLE, so calling it directly aborts
-- the migration with "generation expression is not immutable".
-- entity_keys is text[], and textout IS immutable, so a typed wrapper is safe.
-- Do NOT substitute entity_keys::text — that resolves to array_out via
-- CoerceViaIO, which is also STABLE, and fails identically.
CREATE OR REPLACE FUNCTION insidor.text_array_to_string(text[], text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT array_to_string($1, $2) $$;

SELECT insidor.add_column('public.story', 'search_doc',
  $$tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english'::regconfig, coalesce(title, '')),   'A')
   || setweight(to_tsvector('english'::regconfig, coalesce(subject, '')), 'A')
   || setweight(to_tsvector('english'::regconfig, insidor.text_array_to_string(entity_keys, ' ')), 'B')
   || setweight(to_tsvector('english'::regconfig, coalesce(blurb, '')),   'C')
    ) STORED$$);

SELECT insidor.add_column('public.post', 'search_doc',
  $$tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english'::regconfig, coalesce(text, '')), 'A')
   || setweight(to_tsvector('english'::regconfig, coalesce(ocr_text, '')), 'B')
    ) STORED$$);

-- FTS leg of the RRF fusion.
CREATE INDEX IF NOT EXISTS story_search_doc_idx ON public.story USING gin (search_doc);
CREATE INDEX IF NOT EXISTS post_search_doc_idx  ON public.post  USING gin (search_doc);

-- Trigram leg. 0.30 on titles; 0.18 on ticker columns, because ticker drift is
-- one or two characters and the shared GUC default of 0.3 returns double the
-- candidate set on a bare % operator.
CREATE INDEX IF NOT EXISTS story_title_trgm_idx
  ON public.story USING gin (title gin_trgm_ops);

-- Vector leg. The story centroid is what search compares against; a story with
-- no embedded post has a NULL centroid, which is why the meta strip must read
-- "semantic recall partial" rather than implying full coverage.
CREATE INDEX IF NOT EXISTS story_centroid_hnsw
  ON public.story USING hnsw (centroid halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ===========================================================================
-- search_log — ships with v1. Without it the boost weights below are guesses
-- and the pgvector A/B in build step 14 has nothing to test against.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.search_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid REFERENCES public.app_user(id) ON DELETE SET NULL,
  device_id      text,
  query          text NOT NULL,
  parsed_mode    text NOT NULL,       -- contract|ticker|poster|text|ambiguous
  result_count   integer NOT NULL,
  duration_ms    integer NOT NULL,
  legs_used      text[] NOT NULL DEFAULT '{}',   -- fts|trgm|vector
  clicked_kind   text,                -- story|coin|post
  clicked_id     text,
  clicked_rank   smallint,
  had_confirmed_coin boolean,          -- measures the disclosed +1.05 boost
  created_at     timestamptz NOT NULL DEFAULT now()
);
SELECT insidor.add_constraint('public.search_log', 'search_log_mode_enum',
  $$CHECK (parsed_mode IN ('contract','ticker','poster','text','ambiguous'))$$);
CREATE INDEX IF NOT EXISTS search_log_recent_idx ON public.search_log (created_at DESC);
CREATE INDEX IF NOT EXISTS search_log_query_idx  ON public.search_log (lower(query), created_at DESC);

-- ===========================================================================
-- The eligibility CTE, as a view, so all three retrieval legs join the SAME
-- predicate. A tier-`never` story must not be reachable through the vector leg
-- because somebody paraphrased its title; a CI test seeds one and asserts zero
-- rows across all three legs.
-- ===========================================================================
CREATE OR REPLACE VIEW public.eligible_story AS
SELECT s.id, s.title, s.blurb, s.subject, s.entity_keys, s.search_doc, s.centroid,
       s.heat, s.presented_heat, s.promoted_at, s.coinability_tier, s.can_create,
       s.confirmed_coin_count, s.unsure_coin_count, s.combined_views, s.status,
       s.needs_review, s.top_post_id
  FROM public.story s
 WHERE s.display_eligible;

COMMENT ON VIEW public.eligible_story IS
  'The single eligibility predicate for search. FTS, trigram and vector legs all join this view; none of them touches story directly.';

SELECT insidor.migration_end('0009', 'search', '@@CHECKSUM_0009@@');
COMMIT;
