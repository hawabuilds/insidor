/**
 * A COIN IN THE MINUTE IT APPEARED — the launches rail's row.
 *
 * ★ THIS IS NOT A `Coin` WITH FIELDS MISSING. It is a smaller and different statement,
 * and the difference is structural rather than stylistic: there is no `priceUsd`, no
 * `liquidityUsd`, no `priceChange24h` and no `tradable`, so a buy affordance cannot be
 * built from a `Launch` however the rail is rewritten. `actionFor` takes a `CoinLink`;
 * a `Launch` is not one and cannot be made into one without going back through the
 * server. That is the same argument `CoinLink`'s `unsure` branch makes — the safe state
 * is the one the types cannot express your way out of.
 *
 * It also carries no image URL and no social links. A mint's image URI is a string typed
 * by whoever made the coin, and rendering one would put an attacker-chosen host into a
 * request log for every row that scrolls past. The rail draws a letter tile instead.
 *
 * ★ AND EVERY STRING HERE IS HOSTILE INPUT. `ticker` and `name` are typed by the person
 * who minted the coin; they can impersonate another token, contain markup, contain a URL,
 * or be pure control characters. The projection bounds their length and strips control and
 * bidi characters before they are stored, so what arrives here is already short and
 * already inert — and the rail still renders them as TEXT and never as markup or a link,
 * because a single door is not a door you rely on alone.
 */

import type { Instant, Measured } from '../../format/measure.ts';
import type { MarketCapBasis } from './coin.ts';

export interface Launch {
  /** The asset key, '<chain>:<address>'. Stable across frames, so it is the render key. */
  readonly launchId: string;
  /** Observed, never an identifier. Two coins may share one, and on this rail they will. */
  readonly ticker: string;
  readonly name: string;
  /** The on-chain identifier. Shown truncated. Never a link and never a label. */
  readonly address: string;
  /** Human-readable, chosen by the server. The VENUE — never where we read it from. */
  readonly venueLabel: string;

  /**
   * When the coin was minted.
   *
   * ★ NEVER READ THIS WITHOUT `mintedAtBoundS`. Unknown is normal and stays unknown — it
   * is not backfilled from when we first saw the row, which can postdate a mint by hours
   * and would make the oldest, least-known coins render as the freshest ones on the one
   * axis this whole product hangs on.
   */
  readonly mintedAt: Instant;

  /**
   * ★ HOW WIDE THE MINT-TIME CLAIM IS, in SECONDS, as a half-width — or null when the
   * instant above is exact (or absent).
   *
   * A live mint feed does not report when a coin was minted. It reports when we heard
   * about it, and the mint happened at or shortly before that. So `mintedAt` is usually
   * the centre of an interval rather than a reading, and rendering "3m ago" from it would
   * present an estimate as a measurement. With this field the rail can say "~3m" and name
   * the bound, which is the same number said honestly.
   *
   * It is a WIDTH and not a confidence. `confidence` is a forbidden key and rightly: a
   * confidence is a number about our own certainty, and this is a statement about the
   * world that would be true whether or not we existed.
   */
  readonly mintedAtBoundS: number | null;

  /**
   * ★ ABSENT IS THE NORMAL CASE AND STAYS ABSENT. A coin minted four minutes ago has no
   * pool, so there is no cap; that is not a small cap and it is certainly not zero. Zero
   * says "worthless" about a coin whose actual state is "nobody has traded it yet".
   */
  readonly marketCapUsd: Measured;
  /** Non-null exactly when the cap is known. The venue tells us; we never guess. */
  readonly marketCapBasis: MarketCapBasis | null;
}

/**
 * One committed frame of the rail.
 *
 * `launches` is the order — newest mint first, decided by the projector and never sorted
 * here. There is deliberately no `order` array beside it, unlike `BoardTick`: the board
 * needs one because rows arrive individually over the live channel, and launches are
 * polled whole. Two spellings of one ordering is two things that can disagree.
 */
export interface LaunchFeed {
  readonly tick: number;
  readonly launches: readonly Launch[];
}
