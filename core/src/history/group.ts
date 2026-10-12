/**
 * HISTORICAL NARRATIVES FROM COINS: which past coins are one narrative.
 *
 * The live system groups posts; history has only coins, so this groups coins, with the same
 * kinds of evidence GROUP uses and the same rule about them (core/src/group/picture.ts):
 *
 *   a post both coins' creators linked                 one narrative
 *   a picture so close it is the same image            one narrative
 *   the same name AND (the same ticker, or a likely-same picture)   one narrative
 *
 * ★ A NAME ALONE IS NOT EVIDENCE. Hundreds of coins are called "chill guy" or "the"; joining on
 * the name alone would make one narrative of every coin that shares a common word. A name counts
 * only with a second, independent signal. A picture similarity nobody computed is "not
 * consulted", never zero — the pairs passed in are the only pictures this knows about.
 *
 * Pure: the runner reads coins, links and picture pairs; this decides. What breaks if changed
 * carelessly: grouping is transitive (A~B and B~C puts A, B and C together), so one loose rule
 * here chains unrelated coins into a single narrative.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { nameKey } from '../group/picture.ts';

export interface HistoryCoin {
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly launchedAt: number | null;
  /** Today's market cap, or null when no source reported one. */
  readonly marketCapUsd: number | null;
  /** The post the creator's metadata links, by our id; null when it links none. */
  readonly linkedPost: string | null;
}

/** The picture similarity of two coins, in `group.image.space`. Pairs not listed were not compared. */
export interface PicturePair {
  readonly a: string;
  readonly b: string;
  readonly similarity: number;
}

export interface HistoryNarrative {
  readonly coins: readonly HistoryCoin[];
  /** The narrative's name: its earliest coin's name, as that coin's creator wrote it. */
  readonly title: string;
}

function find(parent: Map<string, string>, x: string): string {
  let root = x;
  while (parent.get(root) !== root) root = parent.get(root) ?? root;
  parent.set(x, root);
  return root;
}

export function groupCoins(coins: readonly HistoryCoin[], pairs: readonly PicturePair[], p: Policy): readonly HistoryNarrative[] {
  const image = p.group.image;
  const parent = new Map(coins.map((c) => [c.address, c.address]));
  const join = (a: string, b: string): void => {
    if (!parent.has(a) || !parent.has(b)) return;
    parent.set(find(parent, a), find(parent, b));
  };

  const similar = new Map<string, number>();
  for (const pair of pairs) {
    similar.set(`${pair.a}|${pair.b}`, pair.similarity);
    similar.set(`${pair.b}|${pair.a}`, pair.similarity);
    if (pair.similarity >= image.nearIdentical) join(pair.a, pair.b);
  }

  const byPost = new Map<string, string>();
  for (const c of coins) {
    if (c.linkedPost === null) continue;
    const held = byPost.get(c.linkedPost);
    if (held === undefined) byPost.set(c.linkedPost, c.address);
    else join(held, c.address);
  }

  const byName = new Map<string, HistoryCoin[]>();
  for (const c of coins) {
    const key = c.name === null ? '' : nameKey(c.name);
    if (key === '') continue;
    byName.set(key, [...(byName.get(key) ?? []), c]);
  }
  for (const same of byName.values()) {
    for (let i = 0; i < same.length; i += 1) {
      for (let j = i + 1; j < same.length; j += 1) {
        const a = same[i];
        const b = same[j];
        if (a === undefined || b === undefined) continue;
        const ta = a.ticker === null ? '' : nameKey(a.ticker);
        const sameTicker = ta !== '' && b.ticker !== null && ta === nameKey(b.ticker);
        const likely = (similar.get(`${a.address}|${b.address}`) ?? -1) >= image.likely;
        if (sameTicker || likely) join(a.address, b.address);
      }
    }
  }

  const groups = new Map<string, HistoryCoin[]>();
  for (const c of coins) {
    const root = find(parent, c.address);
    groups.set(root, [...(groups.get(root) ?? []), c]);
  }
  const launch = (c: HistoryCoin): number => c.launchedAt ?? Number.POSITIVE_INFINITY;
  return [...groups.values()].map((g) => {
    const ordered = [...g].sort((a, b) => launch(a) - launch(b) || a.address.localeCompare(b.address));
    const first = ordered[0];
    return { coins: ordered, title: first?.name ?? first?.ticker ?? first?.address ?? '' };
  });
}

/** Biggest first: most coins, then the largest market cap today. An unknown cap sorts last. */
export function biggestFirst(narratives: readonly HistoryNarrative[]): readonly HistoryNarrative[] {
  const cap = (n: HistoryNarrative): number => Math.max(...n.coins.map((c) => c.marketCapUsd ?? Number.NEGATIVE_INFINITY));
  return [...narratives].sort((a, b) => b.coins.length - a.coins.length || cap(b) - cap(a));
}
