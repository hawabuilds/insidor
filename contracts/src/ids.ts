/**
 * IDENTITY. Every id in the system is an opaque, branded string.
 *
 * WHY branded rather than `string`: the ids in this system are near-identical in
 * shape — `x:1823…`, `story_7f3a`, `story_7f3a|…` — so passing the wrong one is a
 * silent, plausible bug rather than a loud one. A brand costs nothing at runtime
 * (it is a type-space phantom, erased entirely) and turns that class into a
 * compile error. There is exactly one way to make each id: the constructor below.
 *
 * WHY constructors and not string templates at call sites: the id format is a
 * decision, and a decision made in forty places is not a decision. If the story
 * id scheme changes, it changes here.
 *
 * No platform, chain or vendor name appears here. `source` and `chain` are opaque
 * strings supplied by an adapter's registry entry — that is the whole point.
 */

declare const BRAND: unique symbol;

/** Phantom tag. Erased at runtime; unassignable across tags at compile time. */
type Branded<T, Tag extends string> = T & { readonly [BRAND]: Tag };

/* ── who is speaking ───────────────────────────────────────────────────── */

/** A registered source of items. The value comes from an adapter, never a literal here. */
export type SourceId = Branded<string, 'SourceId'>;

/** A stable account id, never a display handle: handles get renamed and reused. */
export type AuthorKey = Branded<string, 'AuthorKey'>;

/* ── what is being talked about ────────────────────────────────────────── */

/** One post, in our namespace. */
export type ItemId = Branded<string, 'ItemId'>;

/** A group of items judged to be the same real-world moment. */
export type StoryId = Branded<string, 'StoryId'>;

/** A (story, asset) pairing under consideration by RESOLVE. */
export type CandidateId = Branded<string, 'CandidateId'>;

/* ── where a market lives ──────────────────────────────────────────────── */

/**
 * A settlement layer. Opaque on purpose: naming one here would make every other
 * chain a special case, and would put a chain's name in the vocabulary.
 */
export type ChainId = Branded<string, 'ChainId'>;

/**
 * A market on a chain. Two markets on one chain differ more from each other than
 * two chains differ, so the venue — not the chain — is the unit of variation.
 */
export type VenueId = Branded<string, 'VenueId'>;

/**
 * An asset is (chain, address). NEVER a bare string, and never a symbol: a symbol
 * is an observation about an asset, not a name for one, and treating it as an
 * identifier is how a story gets matched to an unrelated coin.
 */
export interface AssetRef {
  readonly chain: ChainId;
  readonly address: string;
}

/** A single comparable, storable key for an AssetRef. Order-stable, collision-free. */
export type AssetKey = Branded<string, 'AssetKey'>;

/* ── constructors ──────────────────────────────────────────────────────── */

const SEP = ':';

/** Registers an opaque source token. Called once per adapter, in its registry entry. */
export function sourceId(token: string): SourceId {
  return assertToken(token, 'sourceId') as SourceId;
}

export function chainId(token: string): ChainId {
  return assertToken(token, 'chainId') as ChainId;
}

/** A venue is always qualified by its chain, so two chains may reuse a market name. */
export function venueId(chain: ChainId, market: string): VenueId {
  return `${chain}${SEP}${assertToken(market, 'venueId')}` as VenueId;
}

export function itemId(source: SourceId, sourceItemId: string): ItemId {
  return `${source}${SEP}${assertToken(sourceItemId, 'itemId')}` as ItemId;
}

export function authorKey(source: SourceId, stableAuthorId: string): AuthorKey {
  return `${source}${SEP}${assertToken(stableAuthorId, 'authorKey')}` as AuthorKey;
}

/**
 * @param token a caller-supplied, collision-resistant token (a hash prefix).
 * The prefix exists so a story id is recognisable in a log line without a lookup.
 */
export function storyId(token: string): StoryId {
  return `story_${assertToken(token, 'storyId')}` as StoryId;
}

/** A candidate is the pair it is about, so it is reproducible rather than allocated. */
export function candidateId(story: StoryId, asset: AssetRef): CandidateId {
  return `${story}|${assetKey(asset)}` as CandidateId;
}

/** `<chain>:<address>` — the one storable spelling of an asset. */
export function assetKey(asset: AssetRef): AssetKey {
  return `${asset.chain}${SEP}${assertToken(asset.address, 'assetKey')}` as AssetKey;
}

/** The inverse of assetKey. Returns null rather than throwing: it parses stored data. */
export function parseAssetKey(key: string): AssetRef | null {
  const cut = key.indexOf(SEP);
  if (cut <= 0 || cut === key.length - 1) return null;
  return {
    chain: key.slice(0, cut) as ChainId,
    address: key.slice(cut + 1),
  };
}

/* ── the one rule every constructor shares ─────────────────────────────── */

/**
 * A separator inside a component would make ids ambiguous, and an empty component
 * would make two different things equal. Both are corruption we cannot detect
 * later, so they throw here rather than propagate.
 */
function assertToken(value: string, where: string): string {
  if (value.length === 0) throw new TypeError(`${where}: empty component`);
  if (value.includes(SEP)) throw new TypeError(`${where}: component contains '${SEP}'`);
  if (value.includes('|')) throw new TypeError(`${where}: component contains '|'`);
  return value;
}
