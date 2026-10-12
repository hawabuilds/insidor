/**
 * THE COIN-ORIGIN GOLD SET: 866 graduated coins the founders checked by hand, each with the
 * post that started it, or the finding that nothing viral did.
 *
 * Separate from cases.ts, which is the resolver's regression set — a handful of failures that
 * shipped. This is a labelled population: it answers "how often do we find the right origin",
 * not "did we reintroduce that bug". The data is frozen in coin-origins.json, written once by
 * tools/gold-import.ts from the two blind sheets; what the import cleaned, and why, is in
 * coin-origins-cleaning.md beside it.
 *
 * ★ THE SPLIT IS IN THE DATA, NOT RECOMPUTED. Each coin carries `split`, assigned once at
 * import: 70% to tune on, 30% held out, stratified so both halves hold non-viral coins and
 * X, TikTok and Instagram origins. `assignSplit` is here so the test can prove the stored
 * split is the seeded one; nothing re-splits at run time.
 *
 * What breaks if changed carelessly: anything that reads `holdout()` while choosing a
 * threshold. A number tuned on the 30% is a number measured on its own training data, and
 * every result reported on the holdout afterwards is then worth nothing. Tune on `tuning()`;
 * read `holdout()` once, at the end, to report.
 */

import { readFileSync } from 'node:fs';

import { shuffle } from '../blind/seeded-random.ts';

export const ORIGIN_PLATFORMS = ['x', 'tiktok', 'instagram'] as const;
export type OriginPlatform = (typeof ORIGIN_PLATFORMS)[number];

/**
 * Where a coin came from, as the founders found it.
 *
 *   post     viral, and this is the post that started it
 *   account  viral, but only the account is known — left out of the "right origin" score
 *            until the post is found
 *   none     checked, and no viral origin
 */
export type CoinOrigin =
  | { readonly kind: 'post'; readonly platform: OriginPlatform; readonly url: string; readonly postId: string }
  | { readonly kind: 'account'; readonly platform: OriginPlatform; readonly url: string }
  | { readonly kind: 'none' };

export type GoldSplit = 'tune' | 'holdout';

export interface GoldCoin {
  /** `bt2:51` — the sheet and its row_id, so a coin can be found again in the sheet. */
  readonly id: string;
  readonly sheet: 'backtest2' | 'backtest3';
  readonly rowId: number;
  readonly mint: string;
  readonly ticker: string;
  readonly name: string;
  readonly description: string | null;
  /** ISO-8601 UTC: the block time of the coin's first transaction, read from the chain. */
  readonly createdAt: string;
  /** What the sheet said, as typed (it carries no time zone, and its year was filled in). */
  readonly createdAtSheet: string | null;
  /** The link the coin's creator gave (the sheet's `twitter` column), or null. */
  readonly creatorLink: string | null;
  readonly origin: CoinOrigin;
  /** The sheet's Y/N columns. Null is unlabelled, never "No". */
  readonly features: Readonly<Record<string, boolean | null>>;
  readonly labelledBy: string;
  readonly labelledOn: string;
  readonly split: GoldSplit;
}

export const SPLIT_SEED = 20_261_012;
export const HOLDOUT_SHARE = 0.3;

/** What the split is stratified on: no origin, or the origin's platform. */
export function stratumOf(origin: CoinOrigin): string {
  return origin.kind === 'none' ? 'none' : origin.platform;
}

/**
 * The seeded, stratified split. Within each stratum the ids are sorted, shuffled with the
 * seed, and the first `round(n × share)` held out — at least one, and never all, so every
 * stratum of two or more coins appears in both halves.
 */
export function assignSplit(
  coins: readonly { readonly id: string; readonly origin: CoinOrigin }[],
  seed = SPLIT_SEED,
  share = HOLDOUT_SHARE,
): ReadonlyMap<string, GoldSplit> {
  const byStratum = new Map<string, string[]>();
  for (const coin of coins) {
    const key = stratumOf(coin.origin);
    byStratum.set(key, [...(byStratum.get(key) ?? []), coin.id]);
  }
  const out = new Map<string, GoldSplit>();
  for (const ids of byStratum.values()) {
    const order = shuffle([...ids].sort(), seed);
    const held = order.length < 2 ? 0 : Math.min(order.length - 1, Math.max(1, Math.round(order.length * share)));
    order.forEach((id, i) => out.set(id, i < held ? 'holdout' : 'tune'));
  }
  return out;
}

let cache: readonly GoldCoin[] | null = null;

/** Every coin in the gold set. */
export function goldCoins(): readonly GoldCoin[] {
  cache ??= JSON.parse(readFileSync(new URL('./coin-origins.json', import.meta.url), 'utf8')) as readonly GoldCoin[];
  return cache;
}

/** The 70% to tune on. */
export function tuning(): readonly GoldCoin[] {
  return goldCoins().filter((c) => c.split === 'tune');
}

/** The 30% held out. Read once, to report — never while choosing a number. */
export function holdout(): readonly GoldCoin[] {
  return goldCoins().filter((c) => c.split === 'holdout');
}
