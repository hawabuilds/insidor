/**
 * THE TWO LABELS A COIN CAN WEAR ON A NARRATIVE PAGE: BIGGEST and FIRST.
 *
 * Both are facts about the world — the largest market cap among a narrative's coins, and the
 * earliest mint — and neither is a judgement about which coin is "the real one". That is why
 * they may be shown and a ranking may not.
 *
 * ★ A LABEL IS CLAIMED ONLY WHEN IT IS PROVABLY TRUE. If any coin's market cap is unknown, no
 * coin is "biggest": the unknown one might be bigger. If any coin's mint time is unknown, no
 * coin is "first". A tie is not a winner either. Picking the higher of the numbers we happen to
 * have would be choosing, and this file never chooses.
 */

import type { Coin } from './api/index.ts';

export type CoinLabel = 'biggest' | 'first';

function soleWinner(coins: readonly Coin[], value: (c: Coin) => number | null, better: (a: number, b: number) => boolean): string | null {
  if (coins.length < 2) return null;
  let best: { id: string; v: number } | null = null;
  let tied = false;
  for (const c of coins) {
    const v = value(c);
    if (v === null) return null;
    if (best === null || better(v, best.v)) {
      best = { id: c.coinId, v };
      tied = false;
    } else if (v === best.v) {
      tied = true;
    }
  }
  return tied || best === null ? null : best.id;
}

export function coinLabels(coins: readonly Coin[]): ReadonlyMap<string, readonly CoinLabel[]> {
  const biggest = soleWinner(coins, (c) => (c.marketCapUsd.known ? c.marketCapUsd.amount : null), (a, b) => a > b);
  const first = soleWinner(coins, (c) => (c.mintedAt.known ? c.mintedAt.at : null), (a, b) => a < b);
  const out = new Map<string, CoinLabel[]>();
  if (biggest !== null) out.set(biggest, ['biggest']);
  if (first !== null) out.set(first, [...(out.get(first) ?? []), 'first']);
  return out;
}
