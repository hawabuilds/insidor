-- 0066_alert_faces.sql
--
-- THE FACE ON AN ALERT: who it is from, or whose post, or which coin, saved on the alert itself.
--
-- The Feed and Notifications show a picture at the left of each row, as Trador does: the follower's
-- or the replier's own picture, the poster's picture on a rising post, the coin's logo. New alerts
-- carry it in their facts when they are queued (`picture`, an https link; `address`, the coin;
-- `userId`, the person a follow or a reply is from). This fills the same facts in on the alerts
-- already sent, where the picture can be found now. A picture that cannot be found is left out,
-- and the row shows a letter, never an empty circle.
--
-- No new column: `facts` already holds what an alert is built from, and a column would have had
-- to exist before the services could write a single alert. The alert service reads only the named
-- fact fields (services/notify/src/text.ts), so a picture can never reach the words of a push.
--
-- ★ THE POSTER'S PICTURE IS READ THROUGH to_jsonb ON PURPOSE. public.author.picture_url arrives in
-- 0067, after this one; to_jsonb(row) ->> 'picture_url' is null while the column does not exist
-- instead of an error. Alerts sent before it are given their poster's picture when the list is read
-- (services/notify/src/faces.ts), which needs the grant below.
--
-- The grant lets the alert service (insidor_people) read which account wrote a post and that
-- account's picture: public.item and public.author, read-only, the same facts the app role reads.

grant select on public.item, public.author to insidor_people;

-- A follow: the follower, by the handle (or id) the alert was filed under.
update people.alert a
   set facts = a.facts || jsonb_build_object('userId', p.user_id)
                       || case when p.picture_url like 'https://%' then jsonb_build_object('picture', p.picture_url) else '{}'::jsonb end
  from people.profile p
 where a.kind = 'follow'
   and not (a.facts ? 'userId')
   and (p.user_id = a.subject or p.handle = lower(a.subject));

-- A reply: the subject is the reply's own comment id; its author is the person.
update people.alert a
   set facts = a.facts || jsonb_build_object('userId', p.user_id)
                       || case when p.picture_url like 'https://%' then jsonb_build_object('picture', p.picture_url) else '{}'::jsonb end
  from people.comment c join people.profile p on p.user_id = c.author_id
 where a.kind = 'reply'
   and not (a.facts ? 'userId')
   and c.comment_id::text = a.subject;

-- A rising post: its poster's account picture, once one has been read.
update people.alert a
   set facts = a.facts || jsonb_build_object('picture', to_jsonb(au) ->> 'picture_url')
  from public.item i join public.author au on au.author_key = i.author_key
 where a.kind = 'rising_post'
   and not (a.facts ? 'picture')
   and i.item_id = a.subject
   and (to_jsonb(au) ->> 'picture_url') like 'https://%';

-- A narrative's first coin: the coin it settled on, for its logo.
update people.alert a
   set facts = a.facts || jsonb_build_object('address', v.payload #>> '{coins,coin,address}')
  from public.story_view v
 where a.kind = 'narrative_coin'
   and not (a.facts ? 'address')
   and v.story_id = a.subject
   and v.payload #>> '{coins,kind}' = 'one'
   and v.payload #>> '{coins,coin,address}' is not null;
