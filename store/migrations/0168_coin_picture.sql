-- 0168_coin_picture.sql
--
-- A COIN'S OWN PICTURE, AS ITS LAUNCH DECLARED IT, FOR THE READ SERVICE.
--
-- Why: a coin's token page draws its logo from our stored copy first, then the launchpad's image
-- (pump addresses only), then the `imageUrl` GET /coin/:id sends — which came only from
-- public.asset.image_uri, empty for about 733,000 of the 755,000 coins whose metadata we read. The
-- picture the metadata names sits in internal.coin_metadata, which the app role cannot read. So a
-- coin that was never on a feed (its logo never copied) and is not a pump address showed a letter
-- (the owner, 2026-11-05: $COGE, "no pfp for this token chart page").
--
-- Why a view, as 0059's public.coin_link: the app role reads the one column it needs and nothing
-- else of the metadata row. An https link only; anything else is no picture, never a broken one.
--
-- What it claims: the picture the coin's creator put in its metadata. A claim like the coin's links,
-- shown as the coin's picture because that is what the coin says it is — never as verified.
--
-- What breaks if changed carelessly: widening it to non-https links puts mixed content on the page;
-- dropping `outcome = 'read'` lets a failed read's leftovers through.

create view public.coin_picture as
select m.asset_key, m.image_uri
  from internal.coin_metadata m
 where m.outcome = 'read'
   and m.image_uri ~ '^https://';

comment on view public.coin_picture is
  'A coin''s own picture from its launch metadata, an https link as the creator wrote it. A claim, shown as the coin''s picture and never as verified.';

grant select on public.coin_picture to insidor_app;
