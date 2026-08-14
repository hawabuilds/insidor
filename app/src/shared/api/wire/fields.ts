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
];
