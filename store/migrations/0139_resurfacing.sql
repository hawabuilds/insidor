-- 0139_resurfacing.sql
--
-- A HUGE ACCOUNT BROUGHT AN OLDER POST BACK: which stored post was shared, by which post, when, and
-- that the post question was asked again with the share in view.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- 2026-10-26 06:58 UTC @elonmusk quoted @tetsuoai's "hello, world" video, posted 16 days before,
-- with "So beautiful". We stored the video only then, the judge said a weak yes (under the bar) with
-- no idea Elon had just quoted it, and For You — six hours from a post's own time — could never have
-- shown it. To someone launching or buying a coin, a share by an account that big is the moment.
-- Policy.judge.resurface: the runner (work/resurface.ts) asks the post question again about such a
-- post with the share beside it, and the projector counts For You's six hours from the share.
--
--   item_id        the post that was shared (the original)
--   by_item_id     the post that shared it: a quote of it, or the same picture or video under the
--                  sharing account's own name
--   by_author_key  the sharing account
--   how            'quoted' or 'samePicture'
--   shared_at      the sharing post's own time (its first sight when the source gave none): For
--                  You's age for the original is counted from here
--   asked_at       when the answer given with the share came back
--   judge_id       the judge and prompt that answered; the answer itself is in internal.post_judgement,
--                  filed like any answer, so the coin links, the narratives and every hold read it as
--                  they read any post's newest answer
--   words_sha      the hash of the words the share was shown in (judge prompts/post-shared.txt):
--                  those words are not in the prompt id, so this is where a change to them shows
--
-- ★ ONLY AN ANSWERED ASK IS WRITTEN. An outage, a budget pause or a refused batch leaves no row, and
-- the share is asked about again on the next pass while it is inside the runner's window. A row
-- with no answer behind it would put the post on For You on its old, share-blind answer.
--
-- What breaks if changed carelessly: the primary key is per SHARE, not per post — a second huge
-- account sharing the same post a week later is a new moment and is asked again; the projector
-- reads the newest share of each post. Keying by post alone would hide the second share for good.

create table internal.resurfacing (
  item_id        text        not null references public.item (item_id) on delete cascade,
  by_item_id     text        not null references public.item (item_id) on delete cascade,
  by_author_key  text        not null,
  how            text        not null check (how in ('quoted', 'samePicture')),
  shared_at      timestamptz not null,
  asked_at       timestamptz not null,
  judge_id       text        not null check (length(judge_id) > 0),
  words_sha      text        not null,
  recorded_at    timestamptz not null default now(),
  primary key (item_id, by_item_id),
  check (item_id <> by_item_id)
);

create index resurfacing_shared_idx on internal.resurfacing (shared_at desc);

comment on table internal.resurfacing is
  'Posts a huge account shared (Policy.judge.resurface), each asked the post question again with the share in view (work/resurface.ts); For You counts its age from shared_at.';
