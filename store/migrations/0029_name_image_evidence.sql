-- 0029_name_image_evidence.sql
--
-- A SIXTH KIND OF REASON A POST JOINED A STORY: THE SAME NAME, AND LIKELY THE SAME SUBJECT.
--
-- Memes are cropped, captioned, recoloured and redrawn, and the free image carrier only finds
-- near-copies. GROUP now also joins a post when the judge's name for it matches the story's
-- AND its picture is likely the same subject (image similarity over `group.image.likely`, or
-- borderline and confirmed "yes" by the judge — 0028). The member row records exactly that,
-- so "why is this post in this story" stays answerable from the row: which name, how similar,
-- in which space, and whether the judge was asked.
--
-- Separate columns rather than the representation pair, because 0004 makes those columns
-- mean "kind = representation" and nothing else; reusing them would make a whole-variant
-- check lie.

alter table public.story_member add column name_key text;
alter table public.story_member add column image_similarity double precision;
alter table public.story_member add column image_space text;
alter table public.story_member add column image_confirmed boolean;

alter table public.story_member drop constraint story_member_evidence_kind_check;
alter table public.story_member add constraint story_member_evidence_kind_check check (evidence_kind in
  ('seed', 'carrier', 'lineage', 'representation', 'adjudicated', 'nameImage'));

alter table public.story_member add constraint evidence_name_image_is_whole check
  ((evidence_kind = 'nameImage') =
   (name_key is not null and image_similarity is not null and image_space is not null and image_confirmed is not null));

comment on column public.story_member.name_key is
  'kind = nameImage: the normalised name the post and the story share.';
comment on column public.story_member.image_confirmed is
  'kind = nameImage: true when the picture was only borderline-similar and the judge answered "yes" to the same-subject question.';
