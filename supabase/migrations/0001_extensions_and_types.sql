-- 0001_extensions_and_types.sql
-- Extensions, every enum in the product, and the four trigger functions that
-- enforce write-once semantics. Nothing here creates a table.
BEGIN;
SELECT insidor.migration_begin('0001', 'extensions_and_types', '@@CHECKSUM_0001@@');

CREATE EXTENSION IF NOT EXISTS pgcrypto      WITH SCHEMA public;  -- gen_random_uuid, digest
CREATE EXTENSION IF NOT EXISTS pg_trgm       WITH SCHEMA public;  -- ticker/symbol fuzzy search
CREATE EXTENSION IF NOT EXISTS vector        WITH SCHEMA public;  -- halfvec + HNSW (pgvector >= 0.7)
CREATE EXTENSION IF NOT EXISTS btree_gin     WITH SCHEMA public;  -- composite GIN on (platform, tsvector)

-- pg_cron (heat refresh, rank commit, health evaluation) and pg_net (the
-- in-database third observer that survives total loss of the app platform)
-- need shared_preload_libraries and are absent in the CI container. They are
-- optional here and asserted present by the boot check in the pipeline app, so
-- a missing one is loud in production and silent in CI rather than the reverse.
DO $$
BEGIN
  BEGIN CREATE EXTENSION IF NOT EXISTS pg_cron; EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron unavailable: scheduled jobs must be installed separately'; END;
  BEGIN CREATE EXTENSION IF NOT EXISTS pg_net;  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_net unavailable: the in-database health observer is not installed'; END;
END $$;

-- ---------------------------------------------------------------------------
-- Enums. Every one of these replaces a text column or a boolean pair that in
-- the old build could hold a value nobody had thought about.
-- ---------------------------------------------------------------------------
SELECT insidor.create_enum('platform',          ARRAY['x','tiktok']);
SELECT insidor.create_enum('story_status',      ARRAY['provisional','open','dormant','closed','merged']);
SELECT insidor.create_enum('lifecycle',         ARRAY['heating','peaking','cooling','dead']);

-- D3. Ordered least-permissive first so `>` comparisons read naturally.
SELECT insidor.create_enum('coinability_tier',  ARRAY['never','no_create','normal']);

-- The provenance column whose absence produced the $KANG Buy button.
SELECT insidor.create_enum('ticker_source',     ARRAY['cashtag','mint_in_post','llm','insidor_launch']);

SELECT insidor.create_enum('match_verdict',     ARRAY['confirmed','unsure','rejected']);
SELECT insidor.create_enum('match_relation',    ARRAY['derived','adopted','mentioned']);

-- Three-valued, never boolean. There is no `mint_revoked boolean` column in
-- this schema, so api/safety.js's "every token is safe" defect is unwritable.
SELECT insidor.create_enum('authority_state',   ARRAY['unknown','revoked','active']);
SELECT insidor.create_enum('route_state',       ARRAY['unknown','ok','absent']);

SELECT insidor.create_enum('coin_band',         ARRAY['fresh','graduating','live']);
SELECT insidor.create_enum('board_lane',        ARRAY['posts','coins']);
SELECT insidor.create_enum('comment_status',    ARRAY['visible','held','blocked','removed']);
SELECT insidor.create_enum('position_state',    ARRAY['holds','sold','none','unknown']);
SELECT insidor.create_enum('story_outcome_kind',ARRAY['hit','dud','no_coin','late','unmeasurable']);
SELECT insidor.create_enum('sensor',            ARRAY['mint_stream','ct_poll','ingest_x','ingest_tiktok','snapshotter']);
SELECT insidor.create_enum('notification_kind', ARRAY['mint','window_closing','accelerating','correction']);
SELECT insidor.create_enum('trade_side',        ARRAY['buy','sell']);
SELECT insidor.create_enum('trade_status',      ARRAY['ordering','signed','submitted','confirmed','failed','expired','cancelled']);
SELECT insidor.create_enum('media_kind',        ARRAY['image','video','gif']);
SELECT insidor.create_enum('wallet_kind',       ARRAY['embedded','external']);

-- ---------------------------------------------------------------------------
-- Write-once enforcement.
--
-- insidor.freeze_columns() is a generic BEFORE UPDATE trigger: once a listed
-- column is non-NULL it can never change. Used for narrative promoted_at (lead
-- time must be immutable), comment snap columns, launch mint keypairs and
-- trade signatures. Convention beats nothing; a trigger beats convention.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION insidor.freeze_columns() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  col  text;
  oldv text;
  newv text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    EXECUTE format('SELECT ($1).%I::text', col) INTO oldv USING OLD;
    EXECUTE format('SELECT ($1).%I::text', col) INTO newv USING NEW;
    IF oldv IS NOT NULL AND newv IS DISTINCT FROM oldv THEN
      RAISE EXCEPTION
        '%.% is write-once: it was set to % and cannot be changed to % (row %)',
        TG_TABLE_NAME, col, oldv, COALESCE(newv, 'NULL'), OLD;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION insidor.freeze_columns() IS
  'BEFORE UPDATE trigger. Args are column names that may be set once and never moved.';

-- Rejects the known posted_at double-conversion bug at the door rather than
-- letting one future-dated row render "+31m early" on a dead board.
CREATE OR REPLACE FUNCTION insidor.reject_future_timestamp() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE col text; v timestamptz;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    EXECUTE format('SELECT ($1).%I', col) INTO v USING NEW;
    IF v IS NOT NULL AND v > now() + interval '5 minutes' THEN
      RAISE EXCEPTION '%.% is % which is in the future; refusing the row', TG_TABLE_NAME, col, v;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION insidor.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- base58 run detector for the comment address gate. Deliberately in the
-- database: the client check is a courtesy, the server route is the policy,
-- this is the enforcement that survives both being wrong.
CREATE OR REPLACE FUNCTION insidor.base58_runs(p_text text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    array_agg(m[1]),
    ARRAY[]::text[]
  )
  FROM regexp_matches(COALESCE(p_text,''), '([1-9A-HJ-NP-Za-km-z]{32,44})', 'g') m
$$;

SELECT insidor.migration_end('0001', 'extensions_and_types', '@@CHECKSUM_0001@@');
COMMIT;
