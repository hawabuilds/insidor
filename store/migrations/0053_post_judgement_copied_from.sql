-- 0053_post_judgement_copied_from.sql
--
-- AN ANSWER THE JUDGE GAVE ABOUT ANOTHER POST, FILED FOR THIS ONE — AND SAYING SO.
--
-- The per-post scorer no longer pays to judge the same thing twice (services/runner/src/work/
-- score-posts.ts). A plain repost, a quote with no words of its own, and a post whose first
-- picture is the very file of a post already judged are given that post's answer — the same
-- judge and prompt ids, at no cost — instead of a fresh call.
--
-- The copy is a row like any other, so every reader of "the newest answer about this post" (the
-- projector, TRACK, the embedder) treats it exactly as a judged post. `copied_from` names the
-- post whose answer it is, and is null on every answer the judge gave about the post itself. It
-- exists for whoever reads these rows as labelled examples: a copy is not a second, independent
-- look, and counting it as one would let one judgement vote twice.
--
-- Nullable with no default, and rows already written keep null: every one of them was judged
-- on its own post. No foreign key — the source post may age out of public.item while the copy
-- is still worth keeping as a record of where the answer came from.

alter table internal.post_judgement
  add column copied_from text check (copied_from is null or length(copied_from) > 0);

comment on column internal.post_judgement.copied_from is
  'The post whose answer this row repeats (a repost, a bare quote, the same picture); null when the judge looked at this post itself.';
