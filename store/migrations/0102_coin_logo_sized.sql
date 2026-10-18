-- 0102_coin_logo_sized.sql
--
-- WHICH STORED LOGOS ARE THE TWO SMALL COPIES, AND WHICH ARE STILL THE PICTURE AS ITS HOST SERVED IT.
--
-- The owner, 2026-10-18: "Resize each to small sizes (64px and 256px)". The mirror
-- (services/project/src/coin-logos.ts) now writes every logo it copies as a 256-pixel WebP at
-- `coin-logos/<address>` (the path every existing reference already loads) and a 64-pixel WebP at
-- `coin-logos/64/<address>` for the lists. A logo stored before that is the original, about 50 KB,
-- and has no small copy. `sized_at` tells them apart, so the mirror resizes each shown coin's
-- original once, reading it back from our own storage, and never again.
--
--   sized_at   null      the file at coin-logos/<address> is the original; no 64-pixel copy
--              a time    both copies were written then
--
-- Null for every row this migration finds: none of them was resized.
--
-- What breaks if changed carelessly: the mirror reads this column only once this migration has
-- run (it checks information_schema), so before it runs every new copy is still resized but none
-- is recorded so, and no original is resized. Setting it on a row whose file was not resized
-- leaves that coin's lists asking for a 64-pixel copy that is not there; the app then falls back to
-- the full copy, one wasted request per logo.

alter table internal.coin_logo add column sized_at timestamptz;

comment on column internal.coin_logo.sized_at is
  'When the 256 and 64 pixel copies were written (coin-logos/<address>, coin-logos/64/<address>). Null: the stored file is the original picture, with no small copy.';
