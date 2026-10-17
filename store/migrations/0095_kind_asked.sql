-- 0095_kind_asked.sql
--
-- WHICH POSTS THE KIND QUESTION WAS ASKED ABOUT, AND ABOUT WHICH ANSWER.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- From 2026-10-17 11:06 to about 15:20 UTC the kind question had no judge, and the runner only
-- asked it in the same pass as a post's first answer, so every post the judge passed in that
-- window was left with no kind answer — an ad or a sports post among them was never screened. The
-- scorer now also asks it, a few a pass, of any post whose newest answer could pass and has not
-- been asked since (work/score-posts.ts, Policy.rising.kindCatchUpPerPass).
--
-- It cannot tell "asked" from internal.post_judgement alone: an OTHER answer files nothing there,
-- on purpose — more than a dozen readers take a post's newest row as the judge's verdict, and two
-- OTHER answers filed as "no" hid two posts on 2026-10-13. Without this table the catch-up would
-- ask the same newest OTHER posts every pass, forever, and never reach the rest. So each ask is
-- recorded here, whatever it answered, beside nothing that any feed reader reads.
--
--   item_id           the post
--   answer_judged_at  the judged_at of the post-question answer the kind was asked about: a newer
--                     answer (a re-score after a prompt change) is a new question, asked again
--   asked_at          when the kind judge answered
--   kind              the label it gave (OTHER, AD, ...), or null when the answer named none
--
-- Only answered asks are written: an outage or a budget pause leaves the post to be asked again.
--
-- What breaks if changed carelessly: writing a row for an ask that got no answer. The post would
-- then never be asked again, and an unscreened post stays on the feed — the very hole this closes.
-- The runner treats the table missing as "nothing recorded" and skips the catch-up until applied.

create table internal.kind_asked (
  item_id          text        not null,
  answer_judged_at timestamptz not null,
  asked_at         timestamptz not null,
  kind             text,
  primary key (item_id, answer_judged_at)
);

comment on table internal.kind_asked is
  'Each post the kind question was answered about, keyed by the post-question answer it was asked about (work/score-posts.ts).';
