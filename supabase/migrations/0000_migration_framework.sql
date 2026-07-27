-- 0000_migration_framework.sql
-- Replaces 24 loose schema-*.sql files and 12 ad-hoc apply scripts.
-- Every migration is: ordered, checksummed, idempotent, and recorded.
--
-- Contract for every file 0001+:
--   BEGIN;
--   SELECT insidor.migration_begin('0007','user_and_social','<sha256 of this file>');
--   ... DDL, every statement idempotent ...
--   SELECT insidor.migration_end('0007','user_and_social','<same sha256>');
--   COMMIT;
--
-- migration_begin enforces three things the old setup had none of:
--   1. ORDERING     — refuses to apply 0007 if 0008 is already applied.
--   2. DRIFT        — refuses to re-apply a file whose bytes changed after it was applied.
--   3. SINGLETON    — transaction-scoped advisory lock; two runners cannot interleave.

CREATE SCHEMA IF NOT EXISTS insidor;

CREATE TABLE IF NOT EXISTS insidor.schema_migrations (
  version     text        PRIMARY KEY,
  name        text        NOT NULL,
  checksum    text        NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  applied_by  text        NOT NULL DEFAULT current_user,
  duration_ms integer,
  CONSTRAINT schema_migrations_version_fmt CHECK (version ~ '^[0-9]{4}$')
);

COMMENT ON TABLE insidor.schema_migrations IS
  'The record of what is applied to this database. If a version is not here, it is not applied.';

-- Scratch table so migration_end can compute duration without a session variable.
CREATE TABLE IF NOT EXISTS insidor.migration_run (
  version    text PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION insidor.migration_begin(
  p_version  text,
  p_name     text,
  p_checksum text
) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_existing insidor.schema_migrations%ROWTYPE;
  v_ahead    text;
BEGIN
  -- 3. SINGLETON: released automatically at COMMIT/ROLLBACK.
  PERFORM pg_advisory_xact_lock(hashtext('insidor.schema_migrations'));

  SELECT * INTO v_existing FROM insidor.schema_migrations WHERE version = p_version;

  IF FOUND THEN
    -- 2. DRIFT
    IF v_existing.checksum <> p_checksum THEN
      RAISE EXCEPTION
        'migration % (%) was applied at % with checksum %, but the file on disk now hashes to %. '
        'Migrations are immutable once applied. Write a new migration.',
        p_version, v_existing.name, v_existing.applied_at, v_existing.checksum, p_checksum;
    END IF;
    INSERT INTO insidor.migration_run(version) VALUES (p_version)
      ON CONFLICT (version) DO UPDATE SET started_at = clock_timestamp();
    RETURN true;  -- already applied; the DDL below must be a no-op
  END IF;

  -- 1. ORDERING
  SELECT version INTO v_ahead
    FROM insidor.schema_migrations
   WHERE version > p_version
   ORDER BY version LIMIT 1;
  IF v_ahead IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing to apply % after %: migrations must be applied in ascending order',
      p_version, v_ahead;
  END IF;

  INSERT INTO insidor.migration_run(version) VALUES (p_version)
    ON CONFLICT (version) DO UPDATE SET started_at = clock_timestamp();
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION insidor.migration_end(
  p_version  text,
  p_name     text,
  p_checksum text
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_started timestamptz;
BEGIN
  SELECT started_at INTO v_started FROM insidor.migration_run WHERE version = p_version;
  INSERT INTO insidor.schema_migrations(version, name, checksum, duration_ms)
  VALUES (
    p_version, p_name, p_checksum,
    GREATEST(0, (EXTRACT(epoch FROM clock_timestamp() - COALESCE(v_started, clock_timestamp())) * 1000)::int)
  )
  ON CONFLICT (version) DO NOTHING;
  DELETE FROM insidor.migration_run WHERE version = p_version;
END $$;

-- ---------------------------------------------------------------------------
-- Idempotency helpers. ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS, and
-- a schema this constraint-heavy needs one or every file is 40% DO-block noise.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION insidor.add_constraint(p_table regclass, p_name text, p_def text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = p_table AND conname = p_name
  ) THEN
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', p_table::text, p_name, p_def);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION insidor.add_column(p_table regclass, p_name text, p_def text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS %I %s', p_table::text, p_name, p_def);
END $$;

CREATE OR REPLACE FUNCTION insidor.create_enum(p_name text, p_values text[])
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = p_name) THEN
    EXECUTE format('CREATE TYPE public.%I AS ENUM (%s)',
      p_name, (SELECT string_agg(quote_literal(v), ', ') FROM unnest(p_values) v));
  END IF;
END $$;

-- Bootstrap record for 0000 itself.
INSERT INTO insidor.schema_migrations(version, name, checksum)
VALUES ('0000', 'migration_framework', 'bootstrap')
ON CONFLICT (version) DO NOTHING;
