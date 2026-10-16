-- 0090_reading_ask.sql
--
-- A POST SHEET THAT WAS JUST OPENED, AS A REQUEST FOR A FRESH VIEW READING.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-16: "Plus a reading whenever someone opens the post sheet, if the last one is
-- over 1 minute old." The sheet is served by the read service, which holds a read-only role and no
-- source keys, and the runner, which holds the keys, never sees the phone. The phone tells the
-- social service (POST /post/:id/reading, as insidor_people); the social service writes one row
-- here; the runner's readings loop (services/runner/src/work/readings.ts, Policy.feed.readings)
-- takes rows asked within `openAskMaxAgeMs`, reads the post when its newest reading is older than
-- `openReadMinGapMs`, and deletes the rows it answered. No earlier table could carry this: the
-- other queues the social service writes (internal.missed_post, people.post_watch) each mean
-- something else to the code that reads them.
--
-- ── ONE ROW PER POST, SO A BUSY POST COSTS ONE READ ──────────────────────
--
-- Keyed by the post, not by the person: a hundred people opening the same sheet in a minute are
-- one request. The social service only moves `asked_at` forward, so a stream of opens cannot keep a
-- row young forever without the runner seeing it. Only a post a feed holds may be asked about (the
-- insert checks public.rising_row and public.feed_post), so the table cannot be filled with ids
-- nothing will ever read. The money is bounded on the runner's side, not here: per pass
-- (`openMaxPerPass`) and per day (the readings lane in internal.lane_spend, 0088).
--
-- What breaks if changed carelessly: granting the people role delete. The runner deletes a row only
-- after the read it asked for is stored; a second deleter could drop a request nobody answered.

create table internal.reading_ask (
  item_id   text primary key check (length(item_id) between 1 and 200),
  asked_at  timestamptz not null
);

comment on table internal.reading_ask is
  'Post sheets opened recently, one row per post: the runner''s readings loop reads each such post again when its newest view reading is over a minute old, then deletes the row.';

grant usage on schema internal to insidor_people;
grant select, insert, update on internal.reading_ask to insidor_people;
-- The insert asks only about posts a feed holds; the people role could not read either table.
grant select on public.rising_row, public.feed_post to insidor_people;
