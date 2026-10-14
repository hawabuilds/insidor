-- 0081_post_translation.sql
--
-- A FEED POST'S WORDS IN ENGLISH, WHEN THEY WERE WRITTEN IN ANOTHER LANGUAGE (the owner,
-- 2026-10-14: "i want to see the translation of posts not in english with a small line that says
-- what language it was translated from similar to how X does it").
--
-- One row per post, written once by the runner (services/runner work/translate-posts.ts) for
-- every post on For You, Popular or the scroll, and read by the read service, which puts it on
-- the card and the post sheet beside the original words.
--
--   item_id        the post, as public.item names it
--   lang_from      the language the words were written in, as a two- or three-letter code
--                  (the model's reading of the words, not the source's tag, which mislabels
--                  short posts); 'en' when they are already English, 'zxx' when there is
--                  nothing to translate (only names, tags, links or emoji)
--   text_en        the English words; null when there was nothing to translate. A null is an
--                  answer, kept so the post is never asked about again
--   model          the model that translated it; null when no model was asked because the
--                  words were only tags, handles, links or emoji
--   prompt_id      the exact wording that produced it ('translate@<sha>'), or 'no-words'
--   translated_at  when
--
-- ★ IN `public`, READ BY THE APP ROLE. A translation is the post's own words in another
-- language, shown labelled as a translation with the original one tap away, as the text source
-- itself does it. It carries no score and nothing about why the post is on a feed.
--
-- What breaks if changed carelessly: the null. The read service shows a translation only where
-- `text_en` is set; writing '' instead would put an empty card under "Translated from …". The
-- runner and the read service both treat a missing table as "no translations yet", so code
-- deployed before this migration shows every post in its original words, exactly as before.

create table public.post_translation (
  item_id        text primary key check (length(item_id) > 0),
  lang_from      text not null check (lang_from ~ '^[a-z]{2,3}$'),
  text_en        text check (text_en is null or length(text_en) > 0),
  model          text,
  prompt_id      text not null check (length(prompt_id) > 0),
  translated_at  timestamptz not null default now()
);

create index post_translation_at_idx on public.post_translation (translated_at);

comment on table public.post_translation is
  'Each feed post''s words in English when written in another language, with the language; text_en null when there was nothing to translate.';

/* 0073's rule for every table in `public`: row security on, our four roles let through. */
alter table public.post_translation enable row level security;
create policy insidor_roles on public.post_translation for all
  to insidor_app, insidor_people, insidor_service, insidor_internal using (true) with check (true);

grant select on public.post_translation to insidor_app;
