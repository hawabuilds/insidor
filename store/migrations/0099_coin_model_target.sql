-- 0099_coin_model_target.sql
--
-- WHAT OUR OWN MODEL WAS TAUGHT TO PREDICT: a target on every fit and every score, so a second
-- target can be shadowed beside the first.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-18: the safety net (0096) predicts "will get coined"; retrain it to predict
-- "memeable and about to go viral", with coins as one input and not the label, and shadow it for 24
-- hours. The two are different models over the same facts, and the coined one (fit 1) keeps
-- scoring while the new one is shadowed, so the owner's report compares them on the same posts.
--
--   coined   y = 1 a coin launched for it late, by others (0096's fit 1, tools/lib/coin-model.ts)
--   viral    y = 1 it went over the scorecard's viral line from under it, or the owner called it
--            a meme; never a post he tapped Not a meme
--
-- ── ONE SCORE PER POST PER TARGET ────────────────────────────────────────
--
-- The score's key becomes (item_id, target): each target scores a post once, on its facts at the
-- answer. A score names its fit and the fit's target together (the foreign key below), so a viral
-- score can never point at a coined fit. Every row written before this migration is `coined`.
--
-- What breaks if changed carelessly: the projector and the owner's safety-net list read `would_add`
-- of Policy.judge.coinModel.liveTarget only. Without the target filter a shadowed target's would-add
-- would let posts onto For You the moment `on` is switched.

alter table internal.coin_model
  add column target text not null default 'coined' check (target in ('coined', 'viral'));

alter table internal.coin_model add constraint coin_model_id_target_key unique (id, target);

drop index internal.coin_model_applied_idx;
create index coin_model_applied_idx on internal.coin_model (target, applied_at desc) where applied;

alter table internal.coin_model_score
  add column target text not null default 'coined' check (target in ('coined', 'viral'));

alter table internal.coin_model_score drop constraint coin_model_score_pkey;
alter table internal.coin_model_score add primary key (item_id, target);

alter table internal.coin_model_score
  add constraint coin_model_score_fit_target_fkey foreign key (fit_id, target) references internal.coin_model (id, target);

comment on column internal.coin_model.target is
  'What the fit predicts: coined (a coin launched for it late, by others) or viral (memeable and over the viral line from under it).';
comment on column internal.coin_model_score.target is
  'The fit''s target: each target scores a post once.';
