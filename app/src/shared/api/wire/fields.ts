/**
 * THE ALLOWLIST, AND THE BANNED LIST.
 *
 * Six internal-scoring leaks shipped in the build this replaces, and three of them arrived
 * as reasonable-looking UI written against data the client happened to have: the query asked
 * for the score, so the client had the score, so the client rendered it. A leak that arrives
 * as a `.select()` string is not something code review catches.
 *
 * So the app does not decline to render a score. It cannot obtain one:
 *
 *   1. The wire types in this directory have no scoring field, so a score has no name here.
 *   2. Decoding is a runtime pick against the allowlists below, so a server that starts
 *      sending a score has it dropped before any component can see it.
 *   3. `assertNoInternalVocabulary` throws on the way in, so the leak is loud at our
 *      boundary instead of silent until someone renders it.
 *
 * Rule 1 alone would be a type-level promise, and types erase at runtime. Rules 2 and 3 are
 * what make it true of the running program.
 *
 * There is no `rank` field anywhere, deliberately: position on the board is the array index,
 * so a row cannot carry "our rank" off the board and into a screenshot.
 */

export const BOARD_ROW_FIELDS = [
  'id',
  'title',
  'summary',
  'thumbUrl',
  'reach',
  'spark',
  'momentum',
  /* Derived from `coins` by the projector, never measured against the story — see the
     comment on BoardRow.marketCapUsd. It is on the allowlist because the board shows it;
     the rule about WHICH coin's cap it is lives in one place and it is not this one. */
  'marketCapUsd',
  /* Derived from `coins` too, and on the allowlist for the same reason: the board shows
     it. Which coin's move it is — and that there must be exactly one — is decided in
     projectPriceChange24h, once, and it is not decided here. */
  'priceChange24h',
  'firstSeenAt',
  'coins',
  'isNew',
] as const;

export const STORY_FIELDS = [
  'id',
  'title',
  'summary',
  'thumbUrl',
  'reach',
  'reachDelta24h',
  'spark',
  'momentum',
  'firstSeenAt',
  'coins',
  'evidence',
  'discussion',
] as const;

/**
 * The launches rail's row. NINE fields, and what is absent is the point.
 *
 * There is no `priceUsd`, no `liquidityUsd`, no `priceChange24h` and no `tradable` here,
 * so no buy affordance can be assembled from a launch at runtime even if a server started
 * sending those keys — `pick` drops them before any component sees them. There is no
 * `imageUrl` either: a mint's image URI is a string an attacker chose, and a rendered
 * `<img src>` is a request to a host of their choosing for every row that scrolls past.
 *
 * `mintedAtBoundS` is the honest half of `mintedAt` and the two are only ever read
 * together — an age computed from a bounded instant and shown as a plain "3m ago" is an
 * estimate wearing a reading's clothes. It is not called a confidence: `confidence` is on
 * FORBIDDEN_KEYS below, because a confidence is a number about our certainty, whereas a
 * bound is a fact about the world that would hold whether or not we existed.
 */
export const LAUNCH_FIELDS = [
  'launchId',
  'ticker',
  'name',
  'address',
  'venueLabel',
  'mintedAt',
  'mintedAtBoundS',
  'marketCapUsd',
  'marketCapBasis',
] as const;

/**
 * The state of the feed a launches frame came off. TWO fields, and the list is the point.
 *
 * There is no threshold here and there cannot be one: `threshold` is on FORBIDDEN_KEYS
 * below, a bar is a number about our own machinery, and a client holding the bar could
 * re-derive the judgement and disagree with the server about it. There is no coverage-gap
 * count either — a gap is a fact about OUR watching. What is picked is an instant, which is
 * a fact about the world, and a boolean that is the judgement already made.
 */
export const FEED_SOURCE_FIELDS = ['lastHeardAt', 'live'] as const;

/**
 * The pairs screen's row. TWELVE fields, and what is absent is the point.
 *
 * There is no `tradable` and no `priceChange24h`, so no buy affordance can be assembled
 * from a pair at runtime even if a server started sending those keys — `pick` drops them
 * before any component sees them. There is no `imageUrl` either, for LAUNCH_FIELDS' reason:
 * a mint's image URI is a string an attacker chose, and a rendered `<img src>` is a request
 * to a host of their choosing for every row that scrolls past.
 *
 * `readAt` is the honest half of the three figures beside it and is never dropped: this
 * screen publishes a reading with its age rather than suppressing a stale one, which is only
 * defensible while the age travels with it and reaches the screen.
 */
export const PAIR_FIELDS = [
  'pairId',
  'ticker',
  'name',
  'address',
  'venueLabel',
  'mintedAt',
  'mintedAtBoundS',
  'readAt',
  'priceUsd',
  'marketCapUsd',
  'marketCapBasis',
  'liquidityUsd',
] as const;

/**
 * The head of a pairs frame: the window, the last-heard instant, and the listing union.
 *
 * ★ THE COUNTS ARE INSIDE `rows` AND NOT LISTED HERE, which is what makes them unreachable
 * on the withheld branch. They are picked by `decodePairFeed` only after the tag has been
 * read, so a server that sent a count alongside `listing: 'withheld'` would have it dropped
 * rather than rendered — and a count over a population that may contain fictions is exactly
 * the number this screen must not print.
 */
export const PAIR_HEAD_FIELDS = ['windowMs', 'lastMintHeardAt', 'rows'] as const;

export const COIN_FIELDS = [
  'coinId',
  'ticker',
  'name',
  'address',
  'venueLabel',
  'imageUrl',
  'mintedAt',
  'priceUsd',
  'marketCapUsd',
  'marketCapBasis',
  'liquidityUsd',
  'priceChange24h',
  'tradable',
] as const;

/**
 * Keys that must never appear in a payload, matched EXACTLY against a lowercased key name.
 *
 * Exact rather than substring, because substring matching on short internal words produces
 * false positives that get the check switched off — 'eta' is inside 'meta', 'details' and
 * 'beta', and a guard that cries wolf is a guard someone deletes. The substring pass below
 * handles the words where a substring match is safe and worth having.
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
 * Substrings that cannot occur innocently in a key or a value. Vendor names are here rather
 * than in the exact list because they arrive attached to other words — `dexscreener_url`,
 * `helius_rpc` — and because a vendor name reaching a user is a leak of who we pay, which is
 * commercially ours and not theirs.
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
  /* The mint feed the launches rail is fed by. It is free and needs no key, which changes
     nothing: naming it still tells a user which relay we chose, and it would arrive
     attached to other words — a host inside an image URI, a link inside a token's declared
     socials. It is not a substring of 'pumpfun' or 'Pump.fun', so `venueLabel` is
     unaffected: the venue is the venue, and the feed appears nowhere. */
  'pumpportal',
];
