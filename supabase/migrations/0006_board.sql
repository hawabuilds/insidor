-- 0006_board.sql
-- The committed board. Without these two tables there is no rank delta, no
-- enter/exit counting, no delta-10m mode and no rail log — the ranking exists
-- but nothing can render a caret.
--
-- board_state is the CURRENT board: one row per (lane, band, entity).
-- board_tick is the history that Δ10m and the rail read.
BEGIN;
SELECT insidor.migration_begin('0006', 'board', '@@CHECKSUM_0006@@');

CREATE TABLE IF NOT EXISTS public.board_state (
  lane         board_lane NOT NULL,
  band         coin_band,                     -- NULL on the posts lane
  post_id      uuid REFERENCES public.post(id) ON DELETE CASCADE,
  mint         text REFERENCES public.coin(mint) ON DELETE CASCADE,
  rank         smallint NOT NULL,
  prev_rank    smallint,
  heat         double precision NOT NULL,
  presented_heat smallint,
  entered_at   timestamptz NOT NULL DEFAULT now(),
  pinned_until timestamptz NOT NULL DEFAULT now(),   -- PIN_MS = 90s dwell
  enter_ticks  smallint NOT NULL DEFAULT 0,
  exit_ticks   smallint NOT NULL DEFAULT 0,
  escape_hatch boolean NOT NULL DEFAULT false,       -- skipped the dwell, NEW badge
  tick_seq     bigint NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now()
);

-- One entity per lane, and exactly one kind of entity per row.
SELECT insidor.add_constraint('public.board_state', 'board_state_entity_xor',
  $$CHECK ((post_id IS NOT NULL)::int + (mint IS NOT NULL)::int = 1)$$);
SELECT insidor.add_constraint('public.board_state', 'board_state_lane_entity_agrees',
  $$CHECK ((lane = 'posts' AND post_id IS NOT NULL AND band IS NULL)
        OR (lane = 'coins' AND mint    IS NOT NULL AND band IS NOT NULL))$$);
SELECT insidor.add_constraint('public.board_state', 'board_state_rank_range',
  $$CHECK (rank BETWEEN 1 AND 200)$$);

CREATE UNIQUE INDEX IF NOT EXISTS board_state_post_key
  ON public.board_state (lane, post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS board_state_coin_key
  ON public.board_state (lane, band, mint) WHERE mint IS NOT NULL;
-- Q1 and Q2 both open here: a 40-row ordered index scan, no sort.
CREATE UNIQUE INDEX IF NOT EXISTS board_state_rank_key
  ON public.board_state (lane, COALESCE(band, 'fresh'::coin_band), rank);

-- ---------------------------------------------------------------------------
-- board_tick — history. ~173k rows/day/lane at a 20s commit and 40 rows.
-- Retention is 48 hours: the Δ10m lookback needs 10 minutes, the rail needs
-- one session, and the outcome record reads story_outcome, not this. A
-- partitioned-by-day table so the drop is a DETACH, not a DELETE storm.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.board_tick (
  tick_seq     bigint NOT NULL,
  committed_at timestamptz NOT NULL,
  lane         board_lane NOT NULL,
  band         coin_band,
  post_id      uuid,
  mint         text,
  rank         smallint NOT NULL,
  prev_rank    smallint,
  heat         double precision,
  presented_heat smallint,
  event        text,                       -- entered|left|second_wave|ct_pickup|retracted|rebased
  PRIMARY KEY (committed_at, lane, tick_seq, rank)
) PARTITION BY RANGE (committed_at);

-- Partitions are created a week ahead by pg_cron; two are created here so a
-- fresh database is immediately writable.
DO $$
DECLARE d date := current_date - 1;
BEGIN
  WHILE d <= current_date + 7 LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.board_tick_%s PARTITION OF public.board_tick
         FOR VALUES FROM (%L) TO (%L)',
      to_char(d, 'YYYYMMDD'), d::timestamptz, (d + 1)::timestamptz);
    d := d + 1;
  END LOOP;
END $$;

-- Δ10m: rank of this entity ten minutes ago.
CREATE INDEX IF NOT EXISTS board_tick_entity_idx
  ON public.board_tick (lane, post_id, committed_at DESC) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS board_tick_mint_idx
  ON public.board_tick (lane, mint, committed_at DESC) WHERE mint IS NOT NULL;
-- The rail: the last N events on a lane.
CREATE INDEX IF NOT EXISTS board_tick_event_idx
  ON public.board_tick (lane, committed_at DESC) WHERE event IS NOT NULL;

COMMENT ON TABLE public.board_tick IS
  'Retention 48h by partition detach. The p95 heat denominator rebases hourly, so a row can move 61 -> 88 with nothing changing underneath; the rebase writes event=''rebased'' and the client suppresses the tick animation on the next frame.';

-- ---------------------------------------------------------------------------
-- The gate breakdown under the board: "40 of 63 eligible - 12 hidden by gate".
-- Counted per commit so the empty-quiet state can distinguish a filtered
-- window from a slow night, INCLUDING a bare coinability count.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.board_gate_count (
  tick_seq     bigint NOT NULL,
  lane         board_lane NOT NULL,
  band         coin_band,
  committed_at timestamptz NOT NULL,
  eligible     integer NOT NULL,
  shown        integer NOT NULL,
  by_reason    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {meme_score:7, organic:3, author_cap:2, coinability:4}
  PRIMARY KEY (lane, tick_seq)
);
CREATE INDEX IF NOT EXISTS board_gate_count_recent_idx
  ON public.board_gate_count (lane, committed_at DESC);

SELECT insidor.migration_end('0006', 'board', '@@CHECKSUM_0006@@');
COMMIT;
