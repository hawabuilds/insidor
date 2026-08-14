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

export interface WireBoardTick {
  readonly tick: number;
  readonly order: readonly string[];
  readonly rows: readonly WireBoardRow[];
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
