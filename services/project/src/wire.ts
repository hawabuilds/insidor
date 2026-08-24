/**
 * THE WIRE SHAPE, AS THE SERVER SPELLS IT — plus the censor, run BEFORE anything is
 * stored.
 *
 * WHY THIS IS A SECOND COPY OF app/src/shared/api/wire/, KNOWINGLY:
 * the app's copy is a CLIENT-SIDE BACKSTOP. It throws when a payload arrives carrying
 * something the client is not allowed to have, and that is worth having — but by the
 * time it fires, the leak has been projected, stored, served, and is sitting in a
 * response body. The place to catch it is here, before the insert, where the failure
 * is one story that does not get projected instead of a value that reached a browser.
 * Importing the app's copy is not the alternative: the app is a bundled React package
 * and services must not pull it in. So the two are deliberate mirrors and the app's
 * copy stays the authority on the shape — if these ever disagree, the app is right and
 * this file is broken.
 *
 * The types below describe JSON, not the app's domain objects. `Measured` on the wire
 * is `{ v }` or `{ v: null, why }`; the app decodes that into a two-branch union with
 * no numeric member on the absent side. The absence has to be able to say WHY it is
 * absent, which is why there is no overload here taking a bare number, and why a
 * projector cannot express "we did not read it" as a zero even by accident.
 */

/* ── absences ─────────────────────────────────────────────────────────── */

/**
 * Why a number or an instant is not here. Closed list, and these are the USER'S
 * reasons: none of them names a stage, a platform, or a vendor. `not_read_yet` says
 * nothing about which loop is behind; `not_reported` says nothing about which source
 * withholds it.
 */
export type PendingReason =
  /** Nothing has been minted from this story, so there is no market to have a number in. */
  | 'not_minted'
  /** Minted, but nothing is quotable yet — no price because nobody has traded. */
  | 'no_market'
  /** We simply have not read it yet. The commonest case in the first minutes. */
  | 'not_read_yet'
  /** The source has no such concept. Distinct from zero: absence is not a value of zero. */
  | 'not_reported'
  /** We read something and it did not make sense — out of range, backwards, malformed. */
  | 'unreadable';

export type WireMeasured =
  | { readonly v: number }
  | { readonly v: null; readonly why: PendingReason };

export type WireInstant =
  | { readonly at: number }
  | { readonly at: null; readonly why: PendingReason };

/**
 * The one bridge from a domain number into the wire.
 *
 * There is deliberately no second argument that could serve as a default. A caller
 * that wants a zero has to type the zero itself, in its own file, where a reviewer can
 * see it — nothing in this module will write one on their behalf. A non-finite number
 * is not a number we have, so it degrades to a visible absence rather than putting
 * "NaN" on the board, which is the same failure as putting 0 there, only louder.
 */
export function measured(value: number | null, why: PendingReason): WireMeasured {
  if (value === null || !Number.isFinite(value)) return { v: null, why };
  return { v: value };
}

export function instant(at: number | null, why: PendingReason): WireInstant {
  if (at === null || !Number.isFinite(at)) return { at: null, why };
  return { at };
}

/* ── the board ────────────────────────────────────────────────────────── */

export type Tone = 'rising' | 'steady' | 'cooling';

/**
 * One point on the small line graph.
 *
 * `value: null` is a censored reading — we read the counter and learned nothing about
 * how it changed. It is NOT a zero and it is NOT a point to drop. Dropping it loses
 * the gap in `atMs`; zeroing it draws a cliff, and a cliff reads as collapse on a
 * chart whose whole job is to show acceleration.
 */
export interface WireSparkPoint {
  readonly atMs: number;
  readonly value: number | null;
}

export interface WireSpark {
  readonly points: readonly WireSparkPoint[];
  /** The window the points cover, so a graph with two points is not drawn as a full window. */
  readonly windowMs: number;
}

export type MarketCapBasis = 'fully-diluted' | 'circulating';

export interface WireCoin {
  readonly coinId: string;
  readonly ticker: string;
  readonly name: string;
  readonly address: string;
  readonly venueLabel: string;
  readonly imageUrl: string | null;
  readonly mintedAt: WireInstant;
  readonly priceUsd: WireMeasured;
  readonly marketCapUsd: WireMeasured;
  readonly marketCapBasis: MarketCapBasis | null;
  readonly liquidityUsd: WireMeasured;
  /**
   * The trailing day's price move, as a SIGNED PERCENTAGE. The app decodes this into
   * `Delta` rather than `Measured` — the one field allowed to carry colour, and only
   * by sign — which is why the shape is the same on the wire and the difference is on
   * the far side of the decoder.
   */
  readonly priceChange24h: WireMeasured;
  readonly tradable: boolean;
}

/**
 * How many coins we will stand behind — the ONLY input to the row's button.
 *
 * ★ `unsure` carries NO coin. That is what makes the row render no button at all
 * rather than a disabled one, and it is not a stylistic choice: a disabled button says
 * "this exists but you may not have it", which invites the user to wait for it to
 * enable. If a coin rode along under this tag it would be one prop-drill away from a
 * buy panel, and the whole point of the union is that that path does not exist.
 */
export type WireCoinLink =
  | { readonly kind: 'none' }
  /* `claimCount`, not `candidateCount`: a candidate is what the resolve stage calls a
     coin it is still weighing, and that word is ours. What the user is told is a fact
     that would be true without us — this many coins name themselves after this story. */
  | { readonly kind: 'unsure'; readonly claimCount: number }
  | { readonly kind: 'one'; readonly coin: WireCoin }
  | { readonly kind: 'several'; readonly coins: readonly [WireCoin, WireCoin, ...WireCoin[]] };

export interface WireBoardRow {
  readonly id: string;
  readonly title: string;
  /** Exactly two lines of plain English. A tuple, so "two lines" is checked, not hoped for. */
  readonly summary: readonly [string, string];
  readonly thumbUrl: string | null;
  readonly reach: WireMeasured;
  readonly spark: WireSpark;
  readonly momentum: Tone | null;
  /**
   * The market cap of the story's coin — DERIVED from `coins`, never measured against the
   * story. A story does not have a market cap; a coin does. Absent for every branch but
   * `one`, and absent for `several` on purpose: see projectMarketCap in project.ts, which
   * is the only place the choice is made.
   */
  readonly marketCapUsd: WireMeasured;
  /**
   * The story's coin's 24-hour price move — DERIVED from `coins`, exactly like the cap
   * above and for the same reason. A story does not have a price to have changed; a
   * coin does. Absent for every branch but `one`, and absent for `several` on purpose:
   * averaging three rival tokens' moves is a number true of nothing, and showing the
   * biggest riser is picking which coin is the real one and calling the pick a
   * measurement. See projectPriceChange24h.
   */
  readonly priceChange24h: WireMeasured;
  readonly firstSeenAt: WireInstant;
  readonly coins: WireCoinLink;
  readonly isNew: boolean;
}

/**
 * ★ WHERE THE STORIES ON THIS FRAME CAME FROM — the frame's own provenance, not the row's.
 *
 * THE BUG THIS CLOSES, in the owner's words on being shown the board: "everything is just
 * a placeholder". He was right. `pnpm db:seed` writes six hand-written stories, the
 * projector publishes them, and the app renders them under a heading reading **Trending**
 * with a live pip beside it. Nothing on that screen said they were invented. That is the
 * one product rule this repository has — a fiction is labelled a fiction or it is not
 * shown — failing on the first surface anybody looks at.
 *
 * The rows themselves were never the problem: `public.story.origin` has existed since
 * 0016 and the coin retrieval already refuses to name an invented coin under a real
 * moment. What was missing was a sentence about the WHOLE BOARD, and no row could carry
 * it — a per-row badge would say "this one is made up" six times and still leave the
 * reader to work out that the answer is "all of them, and there is nothing else yet".
 *
 * ★ WHY IT IS A COUNT AND A KIND RATHER THAN A FINISHED SENTENCE. The same reason
 * `WireSourceHealth` is a three-way enum rather than a string: the judgement is made
 * server-side and the wording is the app's. A sentence on the wire is a sentence nobody
 * can restyle, translate or shorten without a projector deploy.
 *
 * ★ AND WHY `observed` HAS NO COUNTS. Because the notice must switch itself off, and a
 * shape that can only say "there is nothing to announce" is a shape that cannot be
 * rendered by mistake. The moment one story assembled from real posts reaches the frame,
 * this becomes `{ kind: 'observed' }`, the app has nothing to draw, and the banner
 * disappears with no code change and no flag — which was the requirement.
 */
export type WireBoardProvenance =
  | { readonly kind: 'observed' }
  | {
      readonly kind: 'seeded';
      /** How many stories on this frame were written by `pnpm db:seed`. */
      readonly seededStories: number;
      /** How many stories are on the frame in total. Equal to the above while nothing real exists. */
      readonly totalStories: number;
      /**
       * The post source that costs nothing to turn on, named so the notice can say what
       * to do about it. A display label from `sourceLabel`, never a source key: it is the
       * same string the pip in the corner of the nav uses, and the two saying different
       * words for one source is how somebody ends up looking for a second thing to fix.
       */
      readonly connectSourceLabel: string;
    };

export interface WireBoardTick {
  readonly tick: number;
  readonly order: readonly string[];
  readonly rows: readonly WireBoardRow[];
  /**
   * ★ ON THE FRAME, NOT BESIDE IT — `WireLaunchFeed.source`'s argument, unchanged. A board
   * of six seeded rows and a board of six real ones are the same array of six rows, and
   * this is the only field that separates them. Travelling with the rows is what stops the
   * app pairing this frame's stories with the previous frame's provenance.
   */
  readonly provenance: WireBoardProvenance;
}

/* ── the launches rail ────────────────────────────────────────────────── */

/**
 * ONE NEWLY MINTED COIN, AS THE RAIL SHOWS IT. Nine fields, and the list is short on
 * purpose: this is not a `WireCoin` with things missing, it is a different and smaller
 * statement. There is no price, no liquidity, no 24h move and no `tradable`, so no buy
 * affordance can be built from a launch however the rail is rewritten — a coin minutes
 * old has none of those things anyway, and a field that is present gets rendered
 * eventually.
 *
 * There is also NO `imageUrl`. A mint's image URI is a string typed by whoever made the
 * coin; putting it on this wire would put an attacker-chosen host into a browser's
 * request log for every row that scrolls past. The rail shows a letter tile instead.
 *
 * ★ AND NO SOCIAL LINKS, for the same reason and more so. `public.asset.declared_social`
 * is named as a warning; it never reaches a payload.
 */
export interface WireLaunch {
  /** The asset key, '<chain>:<address>'. A stable client key across frames. */
  readonly launchId: string;
  /** Observed, never an identifier — and bounded in length before it got here. */
  readonly ticker: string;
  readonly name: string;
  /** The on-chain identifier. The rail truncates it; it is never a link. */
  readonly address: string;
  /** The VENUE, chosen server-side from a Map. Never the feed we read it from. */
  readonly venueLabel: string;
  /**
   * When the coin was minted. Absent is ordinary and stays absent.
   *
   * ★ READ THIS TOGETHER WITH `mintedAtBoundS` AND NOT ALONE. On a socket-fed pipeline
   * this instant is the CENTRE of an interval, not a reading — see projectLaunch.
   */
  readonly mintedAt: WireInstant;
  /**
   * Half-width of the mint-time bound, in SECONDS, or null when the mint time is exact
   * (or absent). `mintedAt.at ± mintedAtBoundS` is the claim; the rail renders a "~"
   * and states the bound rather than presenting an estimate as a reading.
   *
   * ★ IT IS A WIDTH AND NOT A LABEL, and it is deliberately NOT called a confidence:
   * `confidence` is on FORBIDDEN_KEYS, and rightly — a confidence is a number about our
   * own certainty. A bound is a statement about the world that would be true whether or
   * not we existed, which is the test every field on this wire has to pass.
   */
  readonly mintedAtBoundS: number | null;
  /**
   * ★ ABSENT STAYS ABSENT. A coin minted four minutes ago has no pool and therefore no
   * cap, and that is the normal state of the population this rail exists to show. It is
   * never 0 — 0 says "worthless" about a coin whose actual state is "nobody has traded
   * it yet", and those are opposite claims.
   */
  readonly marketCapUsd: WireMeasured;
  /** Non-null exactly when the cap is known. Never guessed, never carried forward. */
  readonly marketCapBasis: MarketCapBasis | null;
}

/**
 * ★ THE STATE OF THE FEED BEHIND A FRAME — two keys, and the list is short on purpose.
 *
 * It exists because a healthy poll over a dead transport looks exactly like a healthy poll
 * over a live one. On the store this was written against, the rail's own status pill read
 * "updated 2s ago" with the pip lit — both TRUE — above coins last heard about 141 hours
 * earlier. The client could not tell, because nothing had ever told it: the coverage log
 * that knows the silence to the second lives in a schema the app role has no USAGE on.
 *
 * ★ WHAT IT DELIBERATELY DOES NOT CARRY, and the vocabulary is what enforces it. There is
 * no threshold here — `threshold` is a forbidden key and the bar is ours, not the user's.
 * There is no explanation of why we think the feed is stale — `reason` and `verdict` are
 * forbidden too. And there is no gap count: a coverage gap is a fact about OUR watching,
 * which is machinery. What crosses is the instant, which is a fact about the world's
 * contact with us, and the already-made judgement, which is a boolean.
 */
export interface WireFeedSource {
  /**
   * When this feed was last actually heard from.
   *
   * ★ ABSENT IS A DIFFERENT FACT FROM OLD AND MUST STAY SO. `{ at: null }` means nothing
   * has EVER been observed on this feed — a watcher that has never run. That is not the
   * same sentence as "we heard something, six days ago", and a surface that collapsed
   * them would tell a new deployment its feed had died.
   */
  readonly lastHeardAt: WireInstant;
  /**
   * Whether that instant is recent enough that the feed is being heard from now.
   *
   * ★ DECIDED SERVER-SIDE, exactly like `currentMarket`'s freshness gate and for the same
   * reason: the bar is a judgement, it lives in one hashed policy object so that "what was
   * this frame judged against in March" has an answer, and what crosses the wire is the
   * labelled result rather than the ingredients to re-derive it.
   */
  readonly live: boolean;
}

export interface WireLaunchFeed {
  readonly tick: number;
  /**
   * Newest mint first, in the order the projector committed.
   *
   * There is no `order` array beside this one, unlike WireBoardTick. The board needs one
   * because rows arrive individually over the live channel and the ordering has to
   * survive a patch; launches are polled whole, so the array IS the order and a second
   * spelling of it would be a second thing that can disagree.
   */
  readonly launches: readonly WireLaunch[];
  /**
   * ★ ON THE FRAME, NOT BESIDE IT. An empty `launches` array has two completely different
   * meanings — a quiet market, or a transport that has been dead for six days — and this
   * is the field that separates them. It travels with the rows so the two can never
   * describe different moments.
   */
  readonly source: WireFeedSource;
}

/* ── which sources we ingest from are answering ───────────────────────── */

/**
 * THE THREE-WAY CALL, ALREADY MADE.
 *
 * ★ A CLOSED ENUM AND NOT A BOOLEAN, AND THE THIRD MEMBER IS THE ENTIRE POINT.
 * `WireFeedSource.live` is a boolean because the mint transport has exactly two states we
 * can distinguish: heard from recently, or not. A source we buy has three, and two of them
 * are both "dark" while demanding opposite responses from a human:
 *
 *   live     — configured, and it answered inside the bar in the policy.
 *   dormant  — nobody turned it on. THIS IS NOT A FAULT. It is a sentence about a decision
 *              somebody made, and rendering it the way a failure is rendered would put a
 *              permanent alarm over a product working exactly as configured.
 *   failing  — configured, and it is not answering. THIS IS A FAULT, and it is the one the
 *              boolean could never say: "you are paying for this and it is broken" is a
 *              different sentence from "you have not turned this on", and a surface that
 *              spells them the same way is a surface on which a paid outage is invisible
 *              for as long as it lasts.
 *
 * ★ THE JUDGEMENT CROSSES, NOT THE INGREDIENTS. There is no `lastErrorAt` here, no attempt
 * count, no HTTP status, no vendor message and no bar to compare against — the same
 * argument `WireFeedSource` makes and for the same reason. A client holding the bar could
 * re-derive the call and disagree with us about it, and a client holding an error string
 * would be rendering a vendor's 500 body to a user. What the screen is entitled to say is
 * "not responding"; what the vendor said is ours.
 */
export type WireSourceState = 'live' | 'dormant' | 'failing';

/**
 * ONE SOURCE, AS THE INDICATOR IN THE CORNER READS IT.
 *
 * Four fields, and every one of them had to argue its way on.
 *
 * ★ `label` IS CHOSEN BY THE SERVER AND THE APP NEVER DERIVES ONE. This is the rule
 * `WireBoardRow.sourceLabel` already states: the app never maps an internal source id to a
 * display name, because that mapping is exactly where a newly added platform silently
 * renders as its raw id in front of a user. The mapping lives in one Map in db.ts.
 *
 * ★ AND THE LABEL IS THE PLATFORM, NEVER THE VENDOR BEHIND IT. "X" and "TikTok" are what a
 * user is told; who resells us their data is commercially ours and is on
 * FORBIDDEN_SUBSTRINGS in both directions, so `assertNoInternalVocabulary` throws on it —
 * in a VALUE, not only in a key. The censor is what makes that structural rather than
 * remembered.
 *
 * ★ `sourceId` IS HERE ONLY SO THE CLIENT HAS A STABLE RENDER KEY. It is never rendered and
 * never mapped; a source whose label we somehow lack is a bug in db.ts, not something the
 * component should paper over by printing the id.
 */
export interface WireSourceHealth {
  /** The internal source key. A React key and nothing else — never displayed. */
  readonly sourceId: string;
  /** The display string, chosen here. Bounded in length before it got onto the wire. */
  readonly label: string;
  /** The already-made call. The client renders it; it never re-derives it. */
  readonly state: WireSourceState;
  /**
   * When this source last answered us.
   *
   * ★ ABSENT IS A DIFFERENT FACT FROM OLD AND STAYS SO, exactly as on `WireFeedSource`.
   * `{ at: null }` means this source has never once answered — a credential that has never
   * worked, or one supplied five minutes ago — which is not the same sentence as "it
   * answered, three hours ago, and has not since". The surface says the two differently and
   * gets that for free as long as nothing here collapses them.
   *
   * It is carried on the DORMANT branch too, and deliberately: a source that was turned off
   * this morning has a real last-heard instant, and hiding it would make "we switched this
   * off" and "this never worked" identical again one level down.
   */
  readonly lastHeardAt: WireInstant;
}

/**
 * One committed frame of the indicator.
 *
 * ★ AN EMPTY `sources` ARRAY IS A REAL ANSWER AND MEANS SOMETHING PRECISE: we ingest from
 * nothing at all. It is not a loading state and it is not a failure — the surface reads it
 * as "nothing is ingesting", which on a board full of rows is the most important sentence
 * on the screen. Nothing downstream may treat it as "no data yet".
 *
 * There is no `order` array beside it, for `WireLaunchFeed`'s reason: this is polled whole,
 * so the array IS the order and a second spelling of it would be a second thing that can
 * disagree. The order is decided once, by the projector, and is stable across frames so the
 * pips do not shuffle under a reader's eye between polls.
 */
export interface WireSourceFeed {
  readonly tick: number;
  readonly sources: readonly WireSourceHealth[];
}

/* ── the pairs screen: the mints that reached a market ────────────────── */

/**
 * ONE COIN A VENUE COULD PRICE.
 *
 * ★ IT IS NOT A `WireLaunch` WITH NUMBERS ADDED AND IT IS NOT A `WireCoin` WITH NUMBERS
 * REMOVED. A launch says "this came into existence"; a pair says "somebody made a market
 * in it". Those are different claims about different populations — 7 of 192 mints in this
 * store ever crossed from the first to the second — so they are different payloads, and
 * the difference is what makes the ratio on the head a real sentence rather than a filter.
 *
 * ★ NO `tradable`, AND NO `priceChange24h`, AND BOTH ABSENCES ARE STRUCTURAL.
 * `tradable` is a claim that a venue will quote this coin right now, and the only evidence
 * for it is a quote; the market reader declares `read` and not `trade`, so every reading
 * behind this screen carries `tradable = false` by constraint rather than by pessimism.
 * Carrying the field would put a false on the wire that a future editor could talk
 * themselves into flipping. The 24-hour move is absent because a coin that reached a pool
 * an hour ago has no trailing day, and a column of dashes teaches nobody anything.
 *
 * The consequence is the one that matters and it is the same one `WireLaunch` buys: no buy
 * affordance can be assembled from a pair however the screen is later rewritten. `actionFor`
 * takes a `CoinLink`, and a pair is not one.
 *
 * There is no `imageUrl` and no social link, for `WireLaunch`'s reason: a mint's image URI
 * is a string typed by whoever made the coin, and rendering one is a request to an
 * attacker-chosen host for every row that scrolls past.
 */
export interface WirePair {
  /** The asset key, '<chain>:<address>'. A stable client key across frames. */
  readonly pairId: string;
  /** Observed, never an identifier — and bounded in length before it got here. */
  readonly ticker: string;
  readonly name: string;
  /** The on-chain identifier. The screen truncates it; it is never a link. */
  readonly address: string;
  /** The VENUE the coin was first seen on. Never the feed we read it from. */
  readonly venueLabel: string;
  /**
   * When the coin was MINTED — not when the pool opened, which nothing here knows.
   *
   * ★ READ THIS WITH `mintedAtBoundS` AND NOT ALONE, exactly as on `WireLaunch`. On a
   * socket-fed pipeline it is the centre of an interval and the screen renders a "~".
   */
  readonly mintedAt: WireInstant;
  /** Half-width of the mint-time bound, in SECONDS, or null when the instant is exact. */
  readonly mintedAtBoundS: number | null;

  /**
   * ★ THE READING, AND THE INSTANT IT WAS TAKEN AT, TRAVELLING TOGETHER.
   *
   * `projectCoin` drops a reading older than `Policy.market.readingFreshnessMs` WHOLE, and
   * that is right for the board, which has a Buy button on every row: a price a user is
   * about to act on has to be current or it has to be a dash.
   *
   * This screen makes the opposite call DELIBERATELY, and it is allowed to because it has
   * no trade affordance at all — see the two absent fields above. A 52-minute-old reading
   * suppressed here is not caution, it is deletion: it turns the one screen that exists to
   * say "six of these reached a market" into six names and eighteen dashes, and the
   * sentence that made the screen worth building is unsupportable. So the number is
   * published WITH the instant it was read at, and the screen states the age beside every
   * figure. A stale reading that says it is stale is the honest form; a stale reading
   * wearing no label is the only thing that is not allowed.
   */
  readonly readAt: WireInstant;
  readonly priceUsd: WireMeasured;
  readonly marketCapUsd: WireMeasured;
  /** Non-null exactly when the cap is known. Never guessed, never carried forward. */
  readonly marketCapBasis: MarketCapBasis | null;
  /**
   * ★ ABSENT ON A CURVE, AND ABSENCE IS NOT ILLIQUIDITY. A bonding curve has no two-sided
   * reserve, so the venue reports no liquidity object at all and the reading carries
   * `not_reported` — which is a different fact from `no_market` and stays different.
   */
  readonly liquidityUsd: WireMeasured;
}

/**
 * ★ WHETHER THE ROWS OF THIS FRAME MAY BE LISTED AT ALL.
 *
 * A closed two-branch union rather than a flag, and the `withheld` branch carries NO rows
 * and NO counts — the same shape, and the same argument, as `WireCoinLink`'s `unsure`
 * branch. If the rows rode along under this tag they would be one prop-drill away from a
 * table, and the whole point of a union is that the unsafe path does not exist.
 *
 * `withheld` is published when public.asset holds no record of where each row came from.
 * Without that record a demo row and an observed one are the same row to every query in
 * the system, so a screen whose heading says a venue priced these coins would be listing
 * fictions under it. The honest answer is then no rows and a sentence saying why, which is
 * what this branch is. It is NOT an error and it is NOT an empty market: those are the
 * `shown` branch with a count of zero, and the three must stay distinguishable.
 */
export type WirePairListing =
  | {
      readonly listing: 'shown';
      /**
       * How many mints the window held. The denominator of the sentence on screen, and a
       * real count rather than a stand-in — it comes from one statement with no limit on
       * it, so it is a count and not a count under a cap.
       */
      readonly mintsInWindow: number;
      /** How many of those a venue could price. The numerator. */
      readonly withMarket: number;
      /**
       * How many had none. Computed in the SAME statement as the two above rather than
       * subtracted afterwards, so the three cannot disagree about one population.
       */
      readonly withoutMarket: number;
    }
  | { readonly listing: 'withheld' };

/**
 * The head of the pairs screen: what the list covers, and what has been heard lately.
 *
 * ★ `lastMintHeardAt` IS A FACT ABOUT THE WORLD'S CONTACT WITH US AND IS NOT A STATUS.
 * It is the newest instant covered by a window in which something was actually observed —
 * never the newest window recorded, because a window recorded as a GAP advances while
 * nothing was heard, and a freshness signal built on one would announce a feed live over
 * precisely the interval we declared dark.
 *
 * Note what is NOT here, because this payload is policed by `assertNoInternalVocabulary`
 * and by FORBIDDEN_KEYS below: no `reason` for the silence, no `threshold` it is measured
 * against, no count of gaps, and no boolean verdict. Those are our machinery. What crosses
 * is the instant; how long ago that was is arithmetic anybody can do, and what to say
 * about it belongs to the screen.
 */
export interface WirePairHead {
  /** How far back the list reaches, in milliseconds. The screen states it in words. */
  readonly windowMs: number;
  /** When a mint was last heard. Absent means nothing has ever been observed on this feed. */
  readonly lastMintHeardAt: WireInstant;
  readonly rows: WirePairListing;
}

export interface WirePairFeed {
  readonly tick: number;
  readonly head: WirePairHead;
  /**
   * Newest MINT first, in the order the projector committed — never newest pair, which is
   * an ordering nothing in this system can derive.
   *
   * Empty whenever `head.rows.listing` is 'withheld', and the decoder on the far side does
   * not read this array at all on that branch. The two cannot disagree because only one of
   * them is ever consulted.
   */
  readonly pairs: readonly WirePair[];
}

/* ── the story page ───────────────────────────────────────────────────── */

export interface WireEvidence {
  readonly evidenceId: string;
  readonly sourceLabel: string;
  readonly authorLabel: string;
  readonly permalink: string;
  readonly excerpt: string;
  readonly thumbUrl: string | null;
  readonly postedAt: WireInstant;
  /**
   * Why this post is in the story, in plain English. Never a contribution number —
   * "this post scored 0.83 on the carrier join" is exactly the sentence the wire
   * vocabulary exists to make unsayable. Naming this field `reason` is fatal at the
   * client, which is the vocabulary defending itself.
   */
  readonly relation: string;
}

export interface WireDiscussionPost {
  readonly postId: string;
  readonly authorLabel: string;
  readonly text: string;
  readonly postedAt: WireInstant;
}

/**
 * ★ WHERE THIS ONE STORY CAME FROM.
 *
 * The board's `WireBoardProvenance` closed this hole on the list; a reader who clicked a
 * row landed on a page with the same six invented numbers and nothing over them. Two
 * surfaces, one fiction, and the notice was on only one of them.
 *
 * ★ IT REVERSES A DECISION THAT IS WRITTEN DOWN, so here is why. `StoryRow.origin` in
 * db.ts says the column "is never projected — a story does not tell a user how it was
 * assembled", and that sentence is still exactly right about HOW: which posts joined,
 * what matched them, how confident anything was. None of that is here or ever will be.
 * What travels is the one bit a reader is entitled to before believing a number —
 * whether this thing happened. "Assembled from observed posts" versus "typed into a seed
 * file" is not our reasoning about the world; it is a fact about whether there is a world
 * behind the row at all.
 *
 * No counts, unlike the board's: a page is one story, so "how many" has one answer and
 * printing it would be furniture.
 */
export type WireStoryProvenance =
  | { readonly kind: 'observed' }
  | { readonly kind: 'seeded'; readonly connectSourceLabel: string };

export interface WireStory {
  readonly id: string;
  readonly title: string;
  readonly summary: readonly [string, string];
  readonly thumbUrl: string | null;
  readonly reach: WireMeasured;
  readonly reachDelta24h: WireMeasured;
  readonly spark: WireSpark;
  readonly momentum: Tone | null;
  readonly firstSeenAt: WireInstant;
  readonly coins: WireCoinLink;
  readonly evidence: readonly WireEvidence[];
  readonly discussion: readonly WireDiscussionPost[];
  /**
   * ★ ON THE PAGE, because the page is reachable without the board. A story link survives
   * being shared, bookmarked and opened cold, and every one of those arrives without a
   * board frame to borrow a provenance from. A page that could only be honest when it was
   * clicked through from the list would be dishonest in exactly the case where the reader
   * has the least context.
   */
  readonly provenance: WireStoryProvenance;
}

/* ── the censor ───────────────────────────────────────────────────────── */

/**
 * Keys that must never appear in a payload, matched EXACTLY against a lowercased key.
 *
 * Exact rather than substring, because substring matching on short internal words
 * produces false positives that get the check switched off — 'eta' is inside 'meta',
 * 'details' and 'beta', and a guard that cries wolf is a guard someone deletes.
 */
export const FORBIDDEN_KEYS: readonly string[] = [
  'score',
  'memescore',
  'confidence',
  'propensity',
  'policyhash',
  'policy',
  'explore',
  'explorearm',
  'holdout',
  'eta',
  'burst',
  'heat',
  'threshold',
  'verdict',
  'decider',
  'reason',
  'features',
  'featureset',
  'featurevector',
  'costusd',
  'budget',
  'spend',
  'rank',
  'candidate',
  'admit',
  'qualify',
  'cluster',
  'narrative',
];

/**
 * Substrings that cannot occur innocently in a key or in a string VALUE.
 *
 * Vendor names are here rather than in the exact list because they arrive attached to
 * other words — a CDN host inside a thumbnail URL, an RPC host inside a link — and
 * because a vendor name reaching a user leaks who we pay, which is commercially ours
 * and not theirs. This is why a thumbnail has to be re-hosted rather than linked.
 */
export const FORBIDDEN_SUBSTRINGS: readonly string[] = [
  'propensity',
  'policyhash',
  'memescore',
  'anthropic',
  'apify',
  'twitterapi',
  'dexscreener',
  'helius',
  'rugcheck',
  'supabase',
  /* The mint feed. It is free and needs no key, which changes nothing: naming it still
     tells a user which relay we chose, and it arrives attached to other words — a
     `pumpportal.fun` inside a declared social link, a host inside an image URI. Note it
     is NOT a substring of 'pumpfun' or 'Pump.fun', so the venue label is unaffected;
     venueLabel stays the venue and the feed never appears anywhere. */
  'pumpportal',
];

/** A payload that must not be published. Fatal on purpose; storing it is worse. */
export class WireLeakError extends Error {
  readonly where: string;

  constructor(where: string) {
    super(`wire: ${where} must not be published`);
    this.name = 'WireLeakError';
    this.where = where;
  }
}

/**
 * Walk a finished payload and throw if anything in it is internal vocabulary.
 *
 * Run on the WHOLE object, at every depth, over keys and over string values alike —
 * free text included. A story title or a post excerpt that happens to contain a vendor
 * name is a leak exactly as much as a `policyHash` key is, and it is the likelier of
 * the two because nobody typed it.
 */
export function assertNoInternalVocabulary(raw: unknown, path = '$'): void {
  if (typeof raw === 'string') {
    const lowered = raw.toLowerCase();
    for (const bad of FORBIDDEN_SUBSTRINGS) {
      if (lowered.includes(bad)) throw new WireLeakError(`${path} (value contains "${bad}")`);
    }
    return;
  }
  if (Array.isArray(raw)) {
    raw.forEach((entry, i) => assertNoInternalVocabulary(entry, `${path}[${i}]`));
    return;
  }
  if (typeof raw === 'object' && raw !== null) {
    for (const [key, entry] of Object.entries(raw)) {
      const lowered = key.toLowerCase();
      if (FORBIDDEN_KEYS.includes(lowered)) throw new WireLeakError(`${path}.${key}`);
      for (const bad of FORBIDDEN_SUBSTRINGS) {
        if (lowered.includes(bad)) throw new WireLeakError(`${path}.${key}`);
      }
      assertNoInternalVocabulary(entry, `${path}.${key}`);
    }
  }
}
