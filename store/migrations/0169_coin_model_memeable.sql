-- 0169_coin_model_memeable.sql
--
-- OUR OWN MODEL'S THIRD TARGET, `memeable`: the judge in training.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-11-13: our own model is to replace the open judge. It is taught what the app is for
-- (is this post memeable, from the owner's calls and what he saw and kept) and scored on every post
-- the judge answers, beside the judge, in shadow (Policy.judge.coinModel, policy.v241). Its fits and
-- scores go in the same two tables as `coined` and `viral`, one score per post per target (0099).
--
-- Only the CHECKs change: the list here must match contracts COIN_MODEL_TARGETS. `viral` stays allowed,
-- because its fits and scores from 18 Oct to 13 Nov are kept.
--
-- What breaks if changed carelessly: the projector reads `would_add` of Policy.judge.coinModel.liveTarget
-- only. A memeable score's `would_add` is "the model passes it", for the side-by-side report; with the
-- target filter gone it would put posts on For You the moment `on` is switched.

alter table internal.coin_model drop constraint coin_model_target_check;
alter table internal.coin_model
  add constraint coin_model_target_check check (target in ('coined', 'viral', 'memeable'));

alter table internal.coin_model_score drop constraint coin_model_score_target_check;
alter table internal.coin_model_score
  add constraint coin_model_score_target_check check (target in ('coined', 'viral', 'memeable'));

comment on column internal.coin_model.target is
  'What the fit predicts: coined (a coin launched for it late, by others), viral (memeable and over the viral line from under it), or memeable (the owner''s calls and what he saw and kept; the judge in training).';
