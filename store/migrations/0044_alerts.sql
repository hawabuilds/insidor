-- 0044_alerts.sql
--
-- ALERTS: each person's settings, their devices, the alerts they were sent, and the claims that
-- make every alert fire once (services/notify, as `insidor_people`).
--
-- ★ ONCE PER LEVEL, EVER, BY CONSTRAINT. `alert_claim` is unique on (person, kind, subject,
-- level). Delivering an alert starts by inserting its claim; a second insert does nothing, and
-- nothing is sent. A holding that reached 5× is claimed at 5× for good.
--
-- ★ PRODUCERS QUEUE, ONE DELIVERER DECIDES. The social service (a follow, a reply, a rank-up) and
-- the notify service's own checks (prices, curves, the pipeline) only add rows to `alert_queue`.
-- One loop takes them, claims, reads the person's settings, writes the list row and pushes or not.
-- So the hourly limit, mute and quiet hours are enforced in one place.
--
-- `watch` mirrors the narratives a person stars in the app, so alerts about them can be sent
-- while the app is closed. `pipeline_seen` is what the notify service has already alerted on
-- from the projection, which keeps no history of its own (rising rows and coin links are
-- rewritten every frame).

create table people.alert_prefs (
  user_id      text primary key references people.profile(user_id) on delete cascade,
  prefs        jsonb not null,
  updated_at   timestamptz not null default now()
);

create table people.push_subscription (
  endpoint     text primary key,
  user_id      text not null references people.profile(user_id) on delete cascade,
  p256dh       text not null,
  auth         text not null,
  user_agent   text not null default '',
  created_at   timestamptz not null default now()
);
create index push_subscription_user_idx on people.push_subscription (user_id);

create table people.alert_queue (
  queue_id     bigserial primary key,
  user_id      text not null references people.profile(user_id) on delete cascade,
  kind         text not null,
  subject      text not null,
  rung         integer not null default 0,
  -- What the text is built from: names, tickers, multiples, views. Never a score.
  facts        jsonb not null,
  href         text not null,
  queued_at    timestamptz not null default now()
);

create table people.alert_claim (
  user_id      text not null references people.profile(user_id) on delete cascade,
  kind         text not null,
  subject      text not null,
  rung         integer not null,
  claimed_at   timestamptz not null default now(),
  primary key (user_id, kind, subject, rung)
);

create table people.alert (
  alert_id     bigserial primary key,
  user_id      text not null references people.profile(user_id) on delete cascade,
  kind         text not null,
  subject      text not null,
  rung         integer not null,
  title        text not null,
  body         text not null,
  href         text not null,
  facts        jsonb not null,
  -- push | quiet | hourly-limit | no-device | list-only
  delivery     text not null,
  at           timestamptz not null default now()
);
create index alert_user_idx on people.alert (user_id, at desc);
create index alert_pushed_idx on people.alert (user_id, at) where delivery = 'push';

create table people.alert_seen (
  user_id      text primary key references people.profile(user_id) on delete cascade,
  seen_at      timestamptz not null
);

create table people.watch (
  user_id      text not null references people.profile(user_id) on delete cascade,
  story_id     text not null,
  created_at   timestamptz not null default now(),
  primary key (user_id, story_id)
);

-- The price a watched coin was at when this person first watched it: what its multiples count from.
create table people.watch_coin (
  user_id      text not null references people.profile(user_id) on delete cascade,
  mint         text not null,
  reference_usd double precision not null check (reference_usd > 0),
  set_at       timestamptz not null default now(),
  primary key (user_id, mint)
);

create table people.pipeline_seen (
  stream       text not null,
  key          text not null,
  seen_at      timestamptz not null default now(),
  primary key (stream, key)
);

grant select, insert, update, delete on all tables in schema people to insidor_people;
grant usage, select on all sequences in schema people to insidor_people;
