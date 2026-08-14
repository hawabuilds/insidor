-- 0010_market.sql
--
-- What a market said about a coin, at an instant. One row is one reading.
--
-- ★ WHY THIS IS A TABLE AND NOT FIVE COLUMNS ON public.asset.
-- 0005 has no price, market-cap or liquidity column and that was a decision, not an
-- omission: those are readings taken FROM a market, not properties OF a coin. A
-- column on the asset row would have exactly one value at a time, so it would either
-- be stale or be overwritten — and overwriting is how you lose the only evidence of
-- what the market said five minutes ago, which on a product about the first hour of a
-- coin's life is the evidence that matters. Worse, public.asset IS granted to
-- insidor_app (0005:107), so a price column there is a number the browser's own role
-- can select directly, around the projection, around the censor, and around the
-- staleness labelling. That is the exact shape 0001's opening paragraph describes as
-- the previous build's failure.
--
-- So readings live here, keyed by (chain, address, taken_at), and the app is not
-- granted a single privilege on this table. It reads the projection or nothing.
--
-- APPEND-ONLY, like public.observation and for the same reason. A correction is a new
-- row. The `internal.forbid_mutation()` trigger from 0001 is attached below and holds
-- for everybody including the migration owner and including a psql session at 3am.
--
-- ★ AND EVERY NUMBER IS NULLABLE, WITH THE REASON BESIDE IT.
-- An absent reading is the COMMON case here: a coin minted four minutes ago has no
-- pool, no pair and no vendor row, and that is the population this product exists to
-- serve. A zero would say "worthless" about a coin whose actual state is "nobody has
-- traded it yet", and those are opposite claims. But a bare NULL is not enough
-- either: a null with no reason cannot be told apart from a null nobody ever tried to
-- fill. So each nullable quantity carries a reason column and a constraint saying
-- exactly one of the two is set — the same shape as observation's `rate_xor_censor`,
-- arrived at for the same reason.

create table public.market_reading (
  -- The asset, spelled the two ways 0005 spells it. `asset_key` is redundant against
  -- (chain, address) and is stored anyway, for the reason 0005 gives: a join wants to
  -- name an asset with one column.
  chain     text not null,
  address   text not null,
  asset_key text not null,

  -- Which venue answered. NOT the vendor we bought the reading from — see the two
  -- source columns below, and see wire.ts, which throws on a vendor's name at any
  -- depth of a payload. This is a venue id like 'solana:pool'.
  venue_id  text not null,

  -- ★ WHEN THE READING WAS TAKEN. This is the column the freshness rule is enforced
  -- against: services/project refuses to present a reading older than
  -- Policy.market.readingFreshnessMs as the current market, and publishes an absence
  -- instead. An hour-old price rendered as live is the one market error a user acts
  -- on directly, so the instant travels with the number and is never assumed to be
  -- now. It comes from MarketState.observedAt, which equals source.fetchedAt.
  taken_at  timestamptz not null,
  -- When WE wrote the row. Distinct from taken_at so that reader lag is measurable
  -- rather than inferred: the two are usually milliseconds apart and the day they are
  -- not is the day something is wrong.
  recorded_at timestamptz not null default now(),

  -- The unit price in USD. Routinely a number like 0.0000000412, which is why this is
  -- double precision and not numeric(12,4) — a scale chosen for dollars rounds a real
  -- price to zero, and a zero here is the claim this whole file is arranged against.
  price_usd        double precision,
  price_absent     text,

  market_cap_usd   double precision,
  market_cap_absent text,
  -- WHICH QUANTITY THE CAP IS A CAP OF, as the venue said. Never guessed and never
  -- defaulted: on a coin with 8% of supply circulating, the two figures differ by more
  -- than a factor of ten, and a Buy screen showing the wrong one is a lie about the
  -- size of the thing being bought. The list is contracts' MARKET_CAP_BASES and
  -- store/src/migrations.test.ts asserts the two are the same list.
  market_cap_basis text check (market_cap_basis in ('fully-diluted', 'circulating')),

  -- ★ NULL ON A CURVE, AND NULL IS NOT ZERO. A bonding curve has no two-sided
  -- reserve, so the venue returns no liquidity object at all — measured at 23 pairs
  -- out of 23 on curve venues. The build this replaces read that absence through
  -- `Number(x) || 0` and then rejected anything at zero, which deleted the entire
  -- pre-graduation population. NOTHING MAY GATE ON THIS COLUMN.
  liquidity_usd    double precision,
  liquidity_absent text,

  -- The trailing day's price move, as a SIGNED PERCENTAGE: -7.86 means 7.86% lower
  -- than a day ago. The unit is in the name because the two plausible spellings differ
  -- by a factor of a hundred and neither is self-evident from a number like 0.0786.
  --
  -- NULL is ordinary: a coin minted forty minutes ago has no trailing day to have
  -- changed over. That is `not_reported`, and it is not a change of zero — zero says
  -- the price held, which is a claim about a period nobody observed.
  price_change_24h_pct    double precision,
  price_change_24h_absent text,

  -- ★ WHETHER A VENUE WOULD ACTUALLY QUOTE THIS COIN, AND NOTHING ELSE.
  -- It is not derived from any number in this row and it must never become so.
  -- contracts/src/asset.ts states the rule outright — "Nothing anywhere may gate on
  -- liquidityUsd. The gate is quotability" — because liquidity and quotability answer
  -- different questions on a curve and on a pool, and flattening them is the bug that
  -- made a quality filter into a survivorship filter.
  --
  -- `quoted_by` names the venue that answered, and the constraint below is the whole
  -- sentence: a reading nobody asked for a quote cannot claim the coin is tradable.
  -- A market-data vendor is not a venue that will fill an order, so a reading written
  -- from one leaves both columns at their honest values and the Buy affordance does
  -- not render. That is not pessimism; it is the absence of a quote.
  tradable  boolean not null default false,
  quoted_by text,

  -- Provenance. Kept so that a disagreement between two vendors is diagnosable, and
  -- so that a mapper bug can be found in the payload rather than argued about.
  --
  -- ★ THESE TWO NEVER TRAVEL. `source_vendor` holds a vendor's name, and a vendor's
  -- name reaching a user leaks who we pay. services/project's SELECT does not list
  -- these columns, and a column that is not in the result set cannot end up in a
  -- payload by accident — which is the same argument 0009 makes for the whole table.
  source_vendor   text not null,
  source_endpoint text not null,

  -- ★ EXACTLY ONE OF THE NUMBER AND ITS REASON, FOR ALL FOUR QUANTITIES.
  -- This is observation's `rate_xor_censor` applied four times. It makes the two
  -- states that look identical in a query result — "the venue said there is none" and
  -- "nobody filled this in" — impossible to confuse, because the second one cannot be
  -- written. The reason vocabulary is contracts' MARKET_ABSENCE_REASONS: `no_market`
  -- (the venue reported no market at all), `not_reported` (a market exists and does
  -- not carry this number), `unreadable` (a value arrived and was not one).
  constraint price_xor_reason check
    ((price_usd is null) = (price_absent is not null)),
  constraint market_cap_xor_reason check
    ((market_cap_usd is null) = (market_cap_absent is not null)),
  constraint liquidity_xor_reason check
    ((liquidity_usd is null) = (liquidity_absent is not null)),
  constraint price_change_24h_xor_reason check
    ((price_change_24h_pct is null) = (price_change_24h_absent is not null)),

  constraint price_absent_is_a_known_reason check
    (price_absent in ('no_market', 'not_reported', 'unreadable')),
  constraint market_cap_absent_is_a_known_reason check
    (market_cap_absent in ('no_market', 'not_reported', 'unreadable')),
  constraint liquidity_absent_is_a_known_reason check
    (liquidity_absent in ('no_market', 'not_reported', 'unreadable')),
  constraint price_change_24h_absent_is_a_known_reason check
    (price_change_24h_absent in ('no_market', 'not_reported', 'unreadable')),

  -- A basis without a cap is a label on nothing; a cap without a basis is a number
  -- whose meaning is missing. Both directions, because both are writable by accident.
  -- The same biconditional is asserted against every venue by
  -- adapters/test/contract/src/venue.contract.ts.
  constraint basis_iff_cap check
    ((market_cap_usd is null) = (market_cap_basis is null)),

  -- The sentence: nobody asked, so it is not tradable. A `true` we cannot name a
  -- quoting venue for would put a Buy button in front of an order that cannot fill.
  constraint tradable_requires_a_quoting_venue check
    (not tradable or quoted_by is not null),

  -- A price cannot be negative and neither can a reserve. A negative arriving here is
  -- a broken reading, and the honest record of a broken reading is `unreadable` with
  -- no number — which the xor constraints above already force. This one stops the
  -- number itself from being stored as if it were a reading we stand behind. The 24h
  -- change is deliberately NOT in this list: a negative there is the entire point.
  constraint quantities_are_not_negative check
    (coalesce(price_usd, 0) >= 0
     and coalesce(market_cap_usd, 0) >= 0
     and coalesce(liquidity_usd, 0) >= 0),

  -- A reading is about an asset we hold. No delete action is declared, so the default
  -- (restrict) applies: nothing in this schema removes an asset, and if something ever
  -- tried, the append-only trigger below would refuse the cascade anyway. Saying it
  -- once, here, is better than a cascade that cannot fire.
  foreign key (chain, address) references public.asset (chain, address),

  primary key (chain, address, taken_at)
);

-- ★ THE ONLY QUERY THE PROJECTOR MAKES: the latest reading per asset, for a set of
-- assets. `select distinct on (asset_key) … order by asset_key, taken_at desc` walks
-- this index backwards and stops at the first row per key, so the cost is one seek per
-- coin on the board rather than a scan of the series. Descending is not decoration:
-- an ascending index makes the planner read every reading a coin has ever had and
-- throw all but the last one away.
create index market_reading_latest_idx on public.market_reading (asset_key, taken_at desc);

-- Sweeps are "everything in this window". BRIN because the table is append-only and
-- therefore already physically ordered by time — a btree on taken_at would cost about
-- twenty times the space for the same plan.
create index market_reading_time_brin on public.market_reading using brin (taken_at);

-- Absence rate by day is the earliest sign a vendor changed shape under us: a mapper
-- that stops finding a field does not throw, it starts writing `not_reported` for
-- every coin, and the board fills with honest-looking dashes.
create index market_reading_absent_idx on public.market_reading (price_absent, taken_at)
  where price_absent is not null;

create trigger market_reading_is_append_only
  before update or delete on public.market_reading
  for each row execute function internal.forbid_mutation();

comment on table public.market_reading is
  'Append-only market readings. One row per asset per instant. A correction is a new row.';

comment on column public.market_reading.taken_at is
  'When the reading was TAKEN. The projection refuses to present one older than Policy.market.readingFreshnessMs as the current market.';

comment on column public.market_reading.tradable is
  'Whether a venue would quote this coin. Decided by asking, never by comparing liquidity to a number; requires quoted_by.';

-- NOT granted to insidor_app, and there is deliberately no grant line in this file.
-- 0001 gives the app role no default privileges in schema public, so forgetting is the
-- safe direction and this table is invisible to the browser's connection by default
-- rather than by anybody remembering. The app gets these numbers through the
-- projection, already censored and already labelled stale-or-not, or it does not get
-- them at all. insidor_service — which the market reader and the projector both run
-- as — needs no line either: 0001's default privileges already cover it.
