-- 0039_history_spend.sql
--
-- EVERY PAID CALL THE HISTORY PILOT MAKES: what it cost, which supplier, which step, and for
-- which past narrative.
--
-- This is the pilot's cap and its receipt at once. The pilot sums this table before each paid
-- call and stops cleanly when the next call would cross `universe.history.pilotUsd`; because the
-- sum is read from here and not from memory, a stopped run that is started again knows what
-- the first one spent and cannot go over the cap by restarting. A row is written after the
-- supplier answers, with what the supplier said it cost.
--
-- `narrative_id` is null for spend not yet tied to a narrative: pictures embedded and pairs
-- confirmed while the coins are still being grouped.
--
-- `internal`, no grant: what we paid for is ours.

create table internal.history_spend (
  spend_id      bigint generated always as identity primary key,
  narrative_id  text,
  supplier      text not null check (length(supplier) > 0),
  step          text not null check (step in ('picture', 'confirm', 'creator_post', 'search', 'judge')),
  usd           numeric(12, 6) not null check (usd >= 0),
  at            timestamptz not null
);

create index history_spend_narrative_idx on internal.history_spend (narrative_id);

comment on table internal.history_spend is
  'Each paid call the history pilot made: supplier, step, cost, narrative. Summed for the pilot''s cap.';
