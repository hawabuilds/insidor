-- 0094_judge_cutoff_model.sql
--
-- WHICH MODEL A BLOCK'S CUTOFF WAS CHOSEN ON: the applied learned block's yes/no cutoff (0086) is
-- one model's confidence scale, and from 2026-10-17 the feed holds answers from two models.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-17: "switch the live post judge to Nemotron at cutoff 0.70, Gemma 3 as its
-- automatic fallback". Block 10's 0.90 was chosen on Gemma 3's answers; Nemotron's yeses on hand
-- gold sit at a median 0.88, so held to 0.90 it passes about half the gold it passes at 0.70. Each
-- model therefore has its own number in policy (Policy.judge.cutoffs) until a re-tune has chosen
-- one on its answers — and the re-tune now grades with the primary model, so the cutoff it stores
-- is that model's alone. This column says whose it is, so the projector holds that model's answers
-- to it and the other model's to its own number, rather than both to one.
--
-- `judge_cutoff_model` is the judge id up to its prompt hash ('judge:<vendor>/<model>'), as
-- the judge adapter's `judgeModelKey` writes it. Null: not recorded (every row before this), and
-- each model's answers are held to its policy number where it has one, else the block's cutoff.
--
-- What breaks if changed carelessly: writing a cutoff without its model. The projector would then
-- hold the primary's answers to its policy number and ignore the cutoff the re-tune chose for it.
-- The readers and the re-tune treat the missing column as "not recorded" until this is applied.

alter table internal.judge_examples_version
  add column judge_cutoff_model text check (judge_cutoff_model is null or judge_cutoff is not null);

comment on column internal.judge_examples_version.judge_cutoff_model is
  'The judge (judge:<vendor>/<model>) whose answers judge_cutoff was chosen on. Null: not recorded.';
