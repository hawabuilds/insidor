-- 0007_user_and_social.sql
-- app_user, follow (story XOR coin), holding with signed minutes_early,
-- comment with its immutable stamp, notifications and push.
BEGIN;
SELECT insidor.migration_begin('0007', 'user_and_social', '@@CHECKSUM_0007@@');

-- ===========================================================================
-- app_user — nothing maps a Privy DID to anything today.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.app_user (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  privy_did      text UNIQUE NOT NULL,
  wallet_address text UNIQUE,
  wallet_kind    wallet_kind,
  claimed_device_id text,          -- the device whose anonymous follows were merged
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  exported_key_at timestamptz      -- drives the "holding $284 in an unbacked-up wallet" nudge
);
SELECT insidor.add_constraint('public.app_user', 'app_user_wallet_base58',
  $$CHECK (wallet_address IS NULL OR wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')$$);
-- An address is identity on Solana; it must never be reassigned to a new DID.
DROP TRIGGER IF EXISTS app_user_freeze ON public.app_user;
CREATE TRIGGER app_user_freeze BEFORE UPDATE ON public.app_user
  FOR EACH ROW EXECUTE FUNCTION insidor.freeze_columns('privy_did', 'wallet_address');

-- ===========================================================================
-- follow — targets a story OR a coin, never both. The watchlist is two
-- in-memory Sets today and dies on refresh. Anonymous device follows are the
-- highest-volume follower class and are first-class here, not a special case.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.follow (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES public.app_user(id) ON DELETE CASCADE,
  device_id        text,
  story_id         uuid REFERENCES public.story(id) ON DELETE CASCADE,
  coin_mint        text REFERENCES public.coin(mint) ON DELETE CASCADE,
  notify_mint      boolean NOT NULL DEFAULT true,
  muted_until      timestamptz,
  last_notified_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),

  target_kind text GENERATED ALWAYS AS (
    CASE WHEN story_id IS NOT NULL THEN 'story' ELSE 'coin' END
  ) STORED
);

-- Exactly one target. A story follow must never silently become a coin follow:
-- when a watched story mints, the story row stays and an explicit second row
-- is written for the coin.
SELECT insidor.add_constraint('public.follow', 'follow_target_xor',
  $$CHECK ((story_id IS NOT NULL)::int + (coin_mint IS NOT NULL)::int = 1)$$);
-- Exactly one principal, and at least one.
SELECT insidor.add_constraint('public.follow', 'follow_principal',
  $$CHECK ((user_id IS NOT NULL)::int + (device_id IS NOT NULL)::int = 1)$$);
SELECT insidor.add_constraint('public.follow', 'follow_device_id_shape',
  $$CHECK (device_id IS NULL OR device_id ~ '^[0-9a-f-]{16,64}$')$$);

CREATE UNIQUE INDEX IF NOT EXISTS follow_user_story_key
  ON public.follow (user_id, story_id)   WHERE user_id IS NOT NULL AND story_id  IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS follow_user_coin_key
  ON public.follow (user_id, coin_mint)  WHERE user_id IS NOT NULL AND coin_mint IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS follow_device_story_key
  ON public.follow (device_id, story_id) WHERE device_id IS NOT NULL AND story_id  IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS follow_device_coin_key
  ON public.follow (device_id, coin_mint) WHERE device_id IS NOT NULL AND coin_mint IS NOT NULL;

-- Fan-out on 0 -> >=1 confirmed coin: who is watching this story.
CREATE INDEX IF NOT EXISTS follow_story_fanout_idx
  ON public.follow (story_id) WHERE story_id IS NOT NULL AND notify_mint;
-- /you sections, stacked by urgency.
CREATE INDEX IF NOT EXISTS follow_user_recent_idx ON public.follow (user_id, created_at DESC);

-- ===========================================================================
-- holding — unique on (user_id, wallet, mint). NOT (user_id, mint): a second
-- wallet holding the same coin corrupts both cost basis and the frozen
-- earliness if they share a row.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.holding (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
  wallet            text NOT NULL,
  mint              text NOT NULL REFERENCES public.coin(mint) ON DELETE CASCADE,

  story_id          uuid REFERENCES public.story(id) ON DELETE SET NULL,
  -- Frozen at fill: was the clock measurable at the moment we froze the
  -- number. Deliberately a column on THIS row and not a live read of
  -- story_clock, so a gap discovered next week suppresses the render without
  -- invalidating a row that records what was true at fill.
  minutes_early_measurable boolean NOT NULL DEFAULT false,

  tokens_raw        numeric(40,0) NOT NULL,
  decimals          smallint NOT NULL,
  cost_sol          numeric(20,9),
  sol_usd_at_entry  numeric(20,6),
  entry_price_usd   numeric(38,18),
  opened_at         timestamptz NOT NULL DEFAULT now(),
  first_buy_at      timestamptz NOT NULL,
  closed_at         timestamptz,

  -- SIGNED. Renders "-12m" in red at the same weight as "+31m" in cyan.
  minutes_early     integer,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

SELECT insidor.add_constraint('public.holding', 'holding_wallet_mint_key',
  'UNIQUE (user_id, wallet, mint)');
SELECT insidor.add_constraint('public.holding', 'holding_wallet_base58',
  $$CHECK (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')$$);
SELECT insidor.add_constraint('public.holding', 'holding_tokens_nonneg',
  $$CHECK (tokens_raw >= 0)$$);

-- Row-local: an earliness number cannot exist without the flag that says it
-- was measurable. Never invalidated by a later write to another table.
SELECT insidor.add_constraint('public.holding', 'holding_minutes_early_requires_measurable',
  $$CHECK (minutes_early IS NULL OR (minutes_early_measurable AND story_id IS NOT NULL))$$);

-- And the flag itself cannot be set unless a story_clock row exists with both
-- watermarks satisfied and a computed lead. A trigger rather than a composite
-- FK, because a composite FK with ON UPDATE CASCADE would make it impossible
-- to later mark a clock unmeasurable while anyone held the coin -- and
-- discovering a sensor gap must never be blocked by a user's position.
CREATE OR REPLACE FUNCTION insidor.holding_assert_clock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ok boolean;
BEGIN
  IF NEW.minutes_early IS NULL THEN
    NEW.minutes_early_measurable := false;
    RETURN NEW;
  END IF;
  SELECT (c.unmeasurable = false AND c.lead_time_min IS NOT NULL)
    INTO ok FROM public.story_clock c WHERE c.story_id = NEW.story_id;
  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'refusing to freeze minutes_early for story %: no measurable story_clock row', NEW.story_id
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.minutes_early_measurable := true;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS holding_assert_clock ON public.holding;
CREATE TRIGGER holding_assert_clock BEFORE INSERT ON public.holding
  FOR EACH ROW EXECUTE FUNCTION insidor.holding_assert_clock();

DROP TRIGGER IF EXISTS holding_freeze ON public.holding;
CREATE TRIGGER holding_freeze BEFORE UPDATE ON public.holding
  FOR EACH ROW EXECUTE FUNCTION insidor.freeze_columns(
    'first_buy_at', 'minutes_early', 'entry_price_usd', 'sol_usd_at_entry');

DROP TRIGGER IF EXISTS holding_touch ON public.holding;
CREATE TRIGGER holding_touch BEFORE UPDATE ON public.holding
  FOR EACH ROW EXECUTE FUNCTION insidor.touch_updated_at();

CREATE INDEX IF NOT EXISTS holding_user_idx ON public.holding (user_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS holding_mint_idx ON public.holding (mint);

-- ===========================================================================
-- comment — the stamp is frozen at insert and unrecoverable afterwards, so it
-- ships in the same migration as the table.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.comment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id      uuid NOT NULL REFERENCES public.story(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
  author_wallet text NOT NULL,
  body          text NOT NULL,
  status        comment_status NOT NULL DEFAULT 'visible',
  status_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- ---- the immutable stamp, all written once at insert ------------------
  snap_views              bigint   NOT NULL,
  snap_coin_count         smallint NOT NULL,
  snap_unsure_count       smallint NOT NULL,
  snap_age_min            integer  NOT NULL,
  snap_top_mcap           numeric(20,2),
  snap_early              boolean  NOT NULL,
  snap_position_state     position_state NOT NULL,
  snap_position_lamports  numeric(40,0),
  snap_position_mint      text,
  snap_position_decimals  smallint
);

-- Tier 'never' means the story does not exist as far as the product is
-- concerned, so no comment may be written against one. This is an INSERT-time
-- trigger rather than a composite FK on (story_id, coinability_tier): a
-- composite FK would make a later reclassification to 'never' fail whenever
-- the story had comments, and moderation must never be blocked by content.
-- Existing comments on a reclassified story stop being READABLE via the RLS
-- policy in 0011, which is the correct half of the rule to enforce here.
CREATE OR REPLACE FUNCTION insidor.comment_assert_tier() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE t coinability_tier;
BEGIN
  SELECT coinability_tier INTO t FROM public.story WHERE id = NEW.story_id;
  IF t IS NULL OR t = 'never' THEN
    RAISE EXCEPTION 'story % is not discussable (coinability tier %)', NEW.story_id, t
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS comment_assert_tier ON public.comment;
CREATE TRIGGER comment_assert_tier BEFORE INSERT ON public.comment
  FOR EACH ROW EXECUTE FUNCTION insidor.comment_assert_tier();

SELECT insidor.add_constraint('public.comment', 'comment_body_len',
  $$CHECK (length(body) BETWEEN 1 AND 2000)$$);
SELECT insidor.add_constraint('public.comment', 'comment_wallet_base58',
  $$CHECK (author_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')$$);
-- "holds" is a factual claim about a person's money. It needs the amount and
-- the mint, or it is not that claim.
SELECT insidor.add_constraint('public.comment', 'comment_position_holds_needs_amount',
  $$CHECK (snap_position_state <> 'holds'
           OR (snap_position_lamports > 0 AND snap_position_mint IS NOT NULL
               AND snap_position_decimals IS NOT NULL))$$);
-- "$0 mcap" reads as a bug, not a fact: at zero coins there is no mcap.
SELECT insidor.add_constraint('public.comment', 'comment_no_mcap_without_coin',
  $$CHECK (snap_coin_count > 0 OR snap_top_mcap IS NULL)$$);
SELECT insidor.add_constraint('public.comment', 'comment_status_reason',
  $$CHECK (status = 'visible' OR status_reason IS NOT NULL)$$);

-- The stamp cannot drift in the author's favour as the story grows.
DROP TRIGGER IF EXISTS comment_freeze_stamp ON public.comment;
CREATE TRIGGER comment_freeze_stamp BEFORE UPDATE ON public.comment
  FOR EACH ROW EXECUTE FUNCTION insidor.freeze_columns(
    'created_at', 'author_wallet', 'user_id', 'body',
    'snap_views', 'snap_coin_count', 'snap_unsure_count', 'snap_age_min',
    'snap_top_mcap', 'snap_early', 'snap_position_state',
    'snap_position_lamports', 'snap_position_mint', 'snap_position_decimals');

-- The address gate, in the database. The client check is a courtesy and the
-- server route is the policy; this is what holds when both are wrong. It
-- blocks EVERY base58 run of 32-44 characters including this story's own
-- mints: there is nothing a user can say with a contract address that they
-- cannot say with $KANG, which is already auto-linked.
CREATE OR REPLACE FUNCTION insidor.comment_address_gate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE runs text[];
BEGIN
  runs := insidor.base58_runs(NEW.body);
  IF array_length(runs, 1) > 0 THEN
    RAISE EXCEPTION
      'comment body contains a contract address (%). Use the ticker instead.', runs[1]
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS comment_address_gate ON public.comment;
CREATE TRIGGER comment_address_gate BEFORE INSERT OR UPDATE OF body ON public.comment
  FOR EACH ROW EXECUTE FUNCTION insidor.comment_address_gate();

-- Per-wallet speed limit. Edge rate limiting is per-region and therefore not a
-- global cap; this is.
CREATE OR REPLACE FUNCTION insidor.comment_speed_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.comment
   WHERE author_wallet = NEW.author_wallet AND created_at > now() - interval '60 seconds';
  IF n >= 3 THEN
    RAISE EXCEPTION 'rate limit: 3 comments per wallet per minute' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS comment_speed_limit ON public.comment;
CREATE TRIGGER comment_speed_limit BEFORE INSERT ON public.comment
  FOR EACH ROW EXECUTE FUNCTION insidor.comment_speed_limit();

-- Discussion sort: earliest means "written when the story was smallest".
CREATE INDEX IF NOT EXISTS comment_story_earliest_idx
  ON public.comment (story_id, snap_views, created_at) WHERE status = 'visible';
CREATE INDEX IF NOT EXISTS comment_wallet_recent_idx
  ON public.comment (author_wallet, created_at DESC);

CREATE TABLE IF NOT EXISTS public.comment_report (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.comment(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES public.app_user(id) ON DELETE SET NULL,
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
SELECT insidor.add_constraint('public.comment_report', 'comment_report_once',
  'UNIQUE (comment_id, user_id)');

-- ===========================================================================
-- notification / push
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.notification (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES public.app_user(id) ON DELETE CASCADE,
  device_id    text,
  kind         notification_kind NOT NULL,
  story_id     uuid REFERENCES public.story(id) ON DELETE CASCADE,
  coin_mint    text REFERENCES public.coin(mint) ON DELETE SET NULL,
  coin_count   smallint NOT NULL DEFAULT 1,
  dedupe_key   text NOT NULL,
  lead_time_min integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  opened_at    timestamptz,
  corrected_at timestamptz,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb
);
SELECT insidor.add_constraint('public.notification', 'notification_dedupe_key_unique',
  'UNIQUE (dedupe_key)');
SELECT insidor.add_constraint('public.notification', 'notification_principal',
  $$CHECK ((user_id IS NOT NULL)::int + (device_id IS NOT NULL)::int = 1)$$);
-- Unsure never notifies. A mint notification names a confirmed coin or it
-- does not exist.
SELECT insidor.add_constraint('public.notification', 'notification_mint_names_coin',
  $$CHECK (kind <> 'mint' OR coin_mint IS NOT NULL)$$);
CREATE INDEX IF NOT EXISTS notification_user_unread_idx
  ON public.notification (user_id, created_at DESC) WHERE opened_at IS NULL;

CREATE TABLE IF NOT EXISTS public.push_subscription (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES public.app_user(id) ON DELETE CASCADE,
  device_id   text,
  endpoint    text NOT NULL,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_ok_at  timestamptz,
  failed_count smallint NOT NULL DEFAULT 0
);
SELECT insidor.add_constraint('public.push_subscription', 'push_subscription_endpoint_key',
  'UNIQUE (endpoint)');
SELECT insidor.add_constraint('public.push_subscription', 'push_subscription_principal',
  $$CHECK ((user_id IS NOT NULL)::int + (device_id IS NOT NULL)::int = 1)$$);

CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id        uuid PRIMARY KEY REFERENCES public.app_user(id) ON DELETE CASCADE,
  mint_alerts    boolean NOT NULL DEFAULT true,
  window_closing boolean NOT NULL DEFAULT true,
  accelerating   boolean NOT NULL DEFAULT false,
  quiet_from     time,
  quiet_to       time,
  safety_gated   boolean NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

SELECT insidor.migration_end('0007', 'user_and_social', '@@CHECKSUM_0007@@');
COMMIT;
