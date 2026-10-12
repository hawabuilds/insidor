-- 0033_backfill_search.sql
--
-- THE BACKFILL'S SEARCH BACK: ONE SEARCH FOR THE STORY'S NAME, ENDING AT OUR EARLIEST POST.
--
-- After the quotes, a promoted story's backfill searches once for the name the judge gave it,
-- for posts published before the earliest one we hold. Results are fetched for the story
-- (item_backfill, via 'search', with no post they were reached from) and GROUP decides each
-- against that story alone, by its ordinary rules. The story's row keeps what was searched
-- and how many posts came back, so the search can be read beside what it cost.
--
-- `search_name` null means no search was made, and `search_note` says why in our words
-- ('no_name': the judge has not named the story; 'not_supported': no source of its posts can
-- search back to a cutoff). A search that ran and found nothing is `search_returned = 0`, a
-- real zero, never a null.

alter table internal.item_backfill drop constraint item_backfill_via_check;
alter table internal.item_backfill add constraint item_backfill_via_check check (via in ('quote', 'search'));

alter table internal.story_backfill
  add column search_name     text,
  add column search_returned integer check (search_returned >= 0),
  add column search_note     text check (search_note in ('no_name', 'not_supported')),
  add constraint search_is_whole check (
    (search_name is not null and search_returned is not null and search_note is null)
    or (search_name is null and search_returned is null)
  );
