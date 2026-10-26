-- 0138_viral_moment.sql
--
-- THE VIRAL EXCEPTION'S ANSWERS: for each huge, fast post the judge turned down, whether it is a
-- moment people coin, what they would call it, and what kind of post it is.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- 2026-10-26, the owner: "let viral politics/showbiz through". @PopBase's "Trump says Nicki Minaj
-- has a beautiful a**" (judge no, 2.96M views) and @elonmusk's "So beautiful" (judge no, 590k in 51
-- minutes) were both coined and neither could reach For You. A post the judge said no to, or the
-- kind question held as politics or showbiz, that clears Policy.judge.viral's huge-and-fast bar is
-- now asked the viral-moment question and the kind question (work/viral-moments.ts), and the
-- projector lets it onto For You when both say so (core viral.ts `passesAsViral`).
--
-- ★ ITS OWN TABLE, NOT internal.post_judgement. More than thirty readers take a post's newest row
-- there as the post question's verdict or its kind; a viral answer filed there would turn a "no"
-- into a yes for some of them and lift a politics hold for others. Here, only the projector's viral
-- route and the runner's queue read it.
--
--   item_id          the post; one row a post — it is asked once
--   asked_at         when the moment answer came back
--   judge_id         the judge and prompt hash that answered the moment question
--   moment           its yes or no
--   confidence       how sure it said it was, 0 to 1
--   name             the moment's name, or null
--   kind_judge_id    the judge that answered the kind question; null when it was not asked (a
--                    "no" moment, or the owner's close "not a meme" match decided it by rule)
--   kind             the kind label (OTHER, POLITICS, TRAGEDY, ...), or null
--   kind_asks        how many times the kind question was asked about a "yes" moment; a reply that
--                    named no kind (the open model sometimes runs on inside a number and cuts its
--                    JSON) is asked again, up to Policy.judge.viral.maxKindAsks, never for ever
--   cost_usd         both questions together
--
-- Only an answered moment question is written: an outage or a budget pause leaves the post to be
-- asked again. A "yes" whose kind is still null waits off the feed (core `passesAsViral`).
--
-- What breaks if changed carelessly: a second row for a post. The projector reads one answer a
-- post; the primary key makes a second ask a no-op rather than a second, disagreeing verdict. Only
-- the kind fields are ever updated after the first write, and only while the kind is null.

create table internal.viral_moment (
  item_id        text        not null primary key references public.item (item_id) on delete cascade,
  asked_at       timestamptz not null,
  judge_id       text        not null check (length(judge_id) > 0),
  moment         boolean     not null,
  confidence     double precision not null check (confidence >= 0 and confidence <= 1),
  name           text,
  kind_judge_id  text,
  kind           text,
  kind_asks      integer     not null default 0 check (kind_asks >= 0),
  cost_usd       numeric(12, 8) not null default 0 check (cost_usd >= 0),
  recorded_at    timestamptz not null default now()
);

create index viral_moment_asked_idx on internal.viral_moment (asked_at desc);
create index viral_moment_kind_due_idx on internal.viral_moment (asked_at desc) where moment and kind is null;

comment on table internal.viral_moment is
  'The viral exception (Policy.judge.viral): for each huge, fast post the judge turned down, the moment answer and the kind answer (work/viral-moments.ts).';
