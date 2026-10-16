-- 0086_judge_cutoff.sql
--
-- THE APPLIED BLOCK'S OWN YES/NO CUTOFF: a learned-examples block (0056) may be applied together
-- with a stricter confidence cutoff, and the cutoff is part of the version.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-16: "Re-tunes keep failing the gate: more gold and missed caught, but more
-- junk. Before refusing a new version, tune its yes/no cutoff, aiming for LESS junk." The re-tune
-- (tools/retune.ts) now raises the new block's cutoff on the answers its test already collected
-- and, when a cutoff gives less junk with no gold or missed post lost, applies the block WITH that
-- cutoff. The block alone at the policy bar is the version that let more junk through, so the two
-- must travel together: the runner and the projector read the cutoff off the same applied row.
--
-- `judge_cutoff` null: no cutoff of its own, the policy's bar (Policy.qualify.minJudgeConfidence),
-- which is every row written before this. A value raises each evidence's bar to it, never lowers.
--
-- What breaks if changed carelessly: applying a block without its cutoff. Until this is applied the
-- re-tune refuses a block that needs a cutoff above the policy bar (it cannot be stored), and the
-- readers treat the missing column as "no cutoff".

alter table internal.judge_examples_version
  add column judge_cutoff numeric check (judge_cutoff is null or (judge_cutoff > 0 and judge_cutoff <= 1));

comment on column internal.judge_examples_version.judge_cutoff is
  'The yes/no confidence cutoff applied with this block: each evidence''s bar raised to it. Null: the policy bar.';
