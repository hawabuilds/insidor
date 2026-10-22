-- 0123_member_onboarding.sql
--
-- SIGN-UP: a username the member chose, a picture they chose, the moment they finished signing
-- up, and their member number. Written by services/social (onboarding.ts), as `insidor_people`,
-- on the profile it is about.
--
-- ── WHY A CHOSEN USERNAME NEEDS ITS OWN MARK ─────────────────────────────
--
-- Until now `handle` was the X handle, copied from every sign-in and moved to whoever's X account
-- holds it now (routes.ts syncProfile). Sign-up opens email, Apple and Google, which carry no
-- handle, and asks everyone for a username. `handle_chosen_at` says the handle is the member's
-- own: the sign-in copy never overwrites it, and an X sign-in never takes it from them. A handle
-- with no mark is the X copy and still follows X, as before. `picture_chosen_at` does the same
-- for a photo uploaded or picked at sign-up: the X picture stops replacing it.
--
-- ── WHO COUNTS AS SIGNED UP ──────────────────────────────────────────────
--
-- `onboarded_at` is set when the member reaches the last sign-up screen. Everyone with access when
-- this runs is marked done here, with the handle they have marked chosen: they are members already
-- and are never sent back through sign-up (the owner's rule: existing members skip what they did).
-- People on the waitlist are not marked; they sign up when they are let in.
--
-- ── THE MEMBER NUMBER ───────────────────────────────────────────────────
--
-- `member_no` counts members in the order they got access, from 1, and never changes or repeats.
-- Numbered here for everyone with access, by when they got it; after that a number is taken from
-- the sequence when a member finishes sign-up (people.member_number), never for someone still on
-- the waitlist. It is a fact about the member — "Member 213" — and is shown to them on the last
-- screen.
--
-- What breaks if changed carelessly: the backfill below runs once. A profile created after this
-- migration gets `onboarded_at` only from the app; moving the backfill into code would mark every
-- new member done on the first deploy that forgot it, and nobody would pick a username.

alter table people.profile
  add column handle_chosen_at  timestamptz,
  add column picture_chosen_at timestamptz,
  add column onboarded_at      timestamptz,
  add column member_no         bigint unique;

create sequence people.member_no_seq;

update people.profile set handle_chosen_at = created_at where handle is not null;

update people.profile p set onboarded_at = now()
 where exists (select 1 from people.member_access a where a.user_id = p.user_id);

with numbered as (
  select p.user_id, row_number() over (order by a.granted_at, p.created_at, p.user_id) as n
    from people.profile p join people.member_access a on a.user_id = p.user_id
)
update people.profile p set member_no = numbered.n from numbered where numbered.user_id = p.user_id;

select setval('people.member_no_seq', coalesce((select max(member_no) from people.profile), 0) + 1, false);

-- One member's number: the one they have, or the next one when they have access and none yet.
-- Null for someone without access. One statement, so two phones finishing at once cannot take two.
create function people.member_number(p_user text) returns bigint
language plpgsql as $$
declare
  n bigint;
begin
  select member_no into n from people.profile where user_id = p_user;
  if n is not null then
    return n;
  end if;
  if not exists (select 1 from people.member_access where user_id = p_user) then
    return null;
  end if;
  update people.profile set member_no = nextval('people.member_no_seq')
   where user_id = p_user and member_no is null
   returning member_no into n;
  if n is null then
    select member_no into n from people.profile where user_id = p_user;
  end if;
  return n;
end;
$$;

grant usage, select on sequence people.member_no_seq to insidor_people;
grant execute on function people.member_number(text) to insidor_people;
