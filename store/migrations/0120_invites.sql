-- 0120_invites.sql
--
-- INVITE-ONLY ACCESS: who may use Insidor, the codes that let people in, who joined with which
-- code, and the waitlist for people without one. Written by services/social (invites.ts), as
-- `insidor_people`, beside the profiles it is about.
--
-- ── WHO HAS ACCESS ────────────────────────────────────────────────────────
--
-- `member_access` is one row per person who may use the app, and how they got in: `before_invites`
-- (everyone with a profile when this runs: people already signed in keep their access, the
-- owner's call), `code`, `waitlist` (the owner let them in) or `owner`. A row is never removed by
-- the app; there is no "revoked". `extra_invites` is what the owner gave everyone on top of
-- policy `invites.perMember`, so changing that number changes everyone's allowance at once.
--
-- ── CODES ─────────────────────────────────────────────────────────────────
--
-- A `member` code belongs to one member, is one of their numbered slots (1..allowance) and works
-- once. A `partner` code is made by the owner, carries the partner's name for the front door and
-- works up to `max_uses` times. `uses <= max_uses` is a CHECK, so no write anywhere can let one
-- more person in than the code allows.
--
-- ★ REDEEMING IS ONE STATEMENT. The social service talks to the transaction-mode pooler and
-- holds no transaction across calls (services/social main.ts), so `redeem_invite` does the whole
-- thing inside one function call: it locks the code's row, checks it, records the person's access,
-- the redemption and the use, or none of them. Two people racing for the last use of a code: the
-- second waits on the lock, reads the spent count and is told it is used up. One person racing
-- two codes: the second waits on member_access's key and is told they are already in, and its
-- code is not spent. `invite_redemption` is keyed on the person: one code per person, ever.
--
-- ── THE WAITLIST ──────────────────────────────────────────────────────────
--
-- One row per person who asked, in the order they asked (`seq`). Their place is how many people
-- who are still waiting asked before them, counted when read, so a place never goes stale as
-- people ahead are let in or bring a code. `let_in_at` is when the owner let them in.
--
-- RLS: like the other `people` tables (0043), none. The schema is reachable by `insidor_people`
-- alone; the API roles have no USAGE on it.
--
-- What breaks if changed carelessly: the grandfather insert. It runs once, here; a profile made
-- after this migration gets no access row until it brings a code or is let in. Moving it into
-- application code would let everyone in on the first deploy that forgot it.

create table people.member_access (
  user_id        text primary key references people.profile(user_id) on delete cascade,
  via            text not null check (via in ('before_invites', 'code', 'waitlist', 'owner')),
  extra_invites  integer not null default 0 check (extra_invites >= 0),
  granted_at     timestamptz not null default now()
);

insert into people.member_access (user_id, via, granted_at)
select user_id, 'before_invites', created_at from people.profile
on conflict (user_id) do nothing;

create table people.invite_code (
  code           text primary key check (code ~ '^[A-Z0-9]{4,32}$'),
  kind           text not null check (kind in ('member', 'partner')),
  -- The member whose code it is, and which of their slots; null on a partner code.
  owner_id       text references people.profile(user_id) on delete cascade,
  slot           integer check (slot is null or slot >= 1),
  -- The partner's name as the front door shows it ("Superteam UK"); null on a member code.
  partner_label  text check (partner_label is null or length(partner_label) between 1 and 60),
  -- Who made a partner code: the owner reference that matched (`wallet:…` or `x:…`).
  created_by     text,
  max_uses       integer not null check (max_uses >= 1),
  uses           integer not null default 0 check (uses >= 0 and uses <= max_uses),
  created_at     timestamptz not null default now(),
  check ((kind = 'member' and owner_id is not null and slot is not null and partner_label is null and max_uses = 1)
      or (kind = 'partner' and owner_id is null and slot is null and partner_label is not null)),
  unique (owner_id, slot)
);
create index invite_code_owner_idx on people.invite_code (owner_id) where owner_id is not null;

create table people.invite_redemption (
  user_id      text primary key references people.profile(user_id) on delete cascade,
  code         text not null references people.invite_code(code),
  redeemed_at  timestamptz not null default now()
);
create index invite_redemption_code_idx on people.invite_redemption (code, redeemed_at desc);

create table people.waitlist (
  user_id    text primary key references people.profile(user_id) on delete cascade,
  seq        bigint generated always as identity unique,
  -- The X handle when they asked, for the owner's list; the profile keeps the live one.
  handle     text,
  joined_at  timestamptz not null default now(),
  let_in_at  timestamptz
);
create index waitlist_waiting_idx on people.waitlist (seq) where let_in_at is null;

-- One code, one person, in one call. Returns what happened: 'joined', 'member' (already had
-- access, nothing spent), 'used_up', or 'unknown'.
create function people.redeem_invite(p_code text, p_user text) returns text
language plpgsql as $$
declare
  c people.invite_code%rowtype;
  added integer;
begin
  if exists (select 1 from people.member_access where user_id = p_user) then
    return 'member';
  end if;
  select * into c from people.invite_code where code = p_code for update;
  if not found then
    return 'unknown';
  end if;
  if c.uses >= c.max_uses then
    return 'used_up';
  end if;
  insert into people.member_access (user_id, via) values (p_user, 'code') on conflict (user_id) do nothing;
  get diagnostics added = row_count;
  if added = 0 then
    return 'member';
  end if;
  insert into people.invite_redemption (user_id, code) values (p_user, p_code);
  update people.invite_code set uses = uses + 1 where code = p_code;
  return 'joined';
end;
$$;

-- The owner's "let the next N in": the longest-waiting people without access, in order, in one call.
create function people.let_in_next(p_count integer) returns integer
language plpgsql as $$
declare
  n integer;
begin
  with picked as (
    select w.user_id from people.waitlist w
     where w.let_in_at is null
       and not exists (select 1 from people.member_access a where a.user_id = w.user_id)
     order by w.seq
     limit greatest(p_count, 0)
     for update of w skip locked
  ), marked as (
    update people.waitlist w set let_in_at = now() from picked p where w.user_id = p.user_id returning w.user_id
  ), granted as (
    insert into people.member_access (user_id, via) select user_id, 'waitlist' from marked
    on conflict (user_id) do nothing returning user_id
  )
  select count(*)::int into n from granted;
  return n;
end;
$$;

grant select, insert, update on people.member_access, people.invite_code, people.invite_redemption, people.waitlist to insidor_people;
grant execute on function people.redeem_invite(text, text), people.let_in_next(integer) to insidor_people;
