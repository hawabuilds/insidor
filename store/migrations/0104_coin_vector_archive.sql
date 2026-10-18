-- 0104_coin_vector_archive.sql
--
-- COIN PICTURE VECTORS MAY LEAVE internal.image_embedding: the internal role is given DELETE on that
-- one table, for tools/archive-coin-vectors.ts.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-18: "Coin picture vectors: Keep the last 30 days in the database (the origin
-- check's window). Archive older ones to the bucket the same way as the log, checked before
-- removing. Also stop storing vectors for coins that never got a single trade after 1 hour." 0027
-- wrote each vector once and never removed one; coin vectors were ~84 MB of the table's ~112 MB a
-- day. 0001's default privileges give insidor_internal SELECT, INSERT and UPDATE on internal tables
-- and no DELETE, so without this grant the tool fails on its first delete on any database run with
-- its own roles (0093 gave internal.narrative_member the same single grant, for the same reason).
--
-- No table and no column: what was archived is the bucket's manifests (vector-archive,
-- coin/<day>/<run>/manifest.json), and what was deleted as untraded is re-made from its picture.
--
-- What breaks if changed carelessly: the grant is to this table only. A schema-wide DELETE would let
-- the internal role remove the decision log's rows, the judge's answers and the owner's calls.

grant delete on internal.image_embedding to insidor_internal;

comment on table internal.image_embedding is
  'One embedding per post or coin image, per space, written once. Read by GROUP for image similarity; never served. Coin vectors older than Policy.coinVectors.keepMs are archived to the vector-archive bucket and deleted, and an untraded coin''s is deleted (0104, tools/archive-coin-vectors.ts).';
