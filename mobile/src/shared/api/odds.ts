/**
 * A COIN'S LAUNCH ODDS, as the phone app holds them (services/read/src/launch-odds.ts): what happened to
 * past launches that opened like this one, beside what happened to all launches, and a few of the coin's
 * own opening facts with how launches like it did. The token page's Info tab draws its odds block from it.
 *
 * Its own file beside about.ts, the shape and its decoder together, run through the same censor first
 * (`assertNoInternalVocabulary`), so a leak at the server is loud here rather than drawn.
 *
 * ★ HISTORY, NOT A FORECAST. Every share here is of launches that already happened; the words come from the
 * server and say so. ★ AN ABSENCE IS A REASON, never a zero: a coin whose opening was not seen, or odds not
 * yet built, decode to `none` with why, and the page says that. A share that is not a number in 0..1 drops
 * its row rather than draw a bar at zero.
 */

import { assertNoInternalVocabulary, WireShapeError } from './decode.ts';

export type OddsMoment = 'second_1' | 'minute_1' | 'minute_5';
export type OddsLook = 'runner' | 'mixed' | 'rug' | 'dead' | 'early';
export type OddsTone = 'green' | 'amber' | 'red';

export interface OddsShares {
  readonly launches: number;
  readonly hit: readonly { readonly x: number; readonly share: number }[];
  readonly rugged: number | null;
  readonly neverMoved: number | null;
}

export interface OddsBadge {
  readonly tone: OddsTone;
  readonly fact: string;
  readonly compare: string;
  readonly explain: string;
}

export type CoinOdds =
  | {
      readonly kind: 'odds';
      readonly at: OddsMoment;
      readonly look: OddsLook;
      readonly headline: string;
      readonly group: string;
      readonly held: boolean;
      readonly like: OddsShares;
      readonly normal: OddsShares;
      readonly badges: readonly OddsBadge[];
      readonly days: number;
    }
  | { readonly kind: 'none'; readonly why: 'not_launchpad' | 'not_seen' | 'not_built' };

const MOMENTS: readonly OddsMoment[] = ['second_1', 'minute_1', 'minute_5'];
const LOOKS: readonly OddsLook[] = ['runner', 'mixed', 'rug', 'dead', 'early'];
const TONES: readonly OddsTone[] = ['green', 'amber', 'red'];
const WHYS = ['not_launchpad', 'not_seen', 'not_built'] as const;

const rec = (v: unknown, path: string): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new WireShapeError(path, v);
  return v as Record<string, unknown>;
};
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const share = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

function sharesOf(v: unknown, path: string): OddsShares {
  const o = rec(v, path);
  const hit = (Array.isArray(o['hit']) ? o['hit'] : []).flatMap((h) => {
    if (typeof h !== 'object' || h === null) return [];
    const r = h as Record<string, unknown>;
    const s = share(r['share']);
    return typeof r['x'] === 'number' && s !== null ? [{ x: r['x'], share: s }] : [];
  });
  return { launches: count(o['launches']), hit, rugged: share(o['rugged']), neverMoved: share(o['neverMoved']) };
}

export function decodeCoinOdds(raw: unknown, path = '$.odds'): CoinOdds {
  assertNoInternalVocabulary(raw, path);
  const o = rec(raw, path);
  if (o['kind'] !== 'odds') {
    const why = WHYS.find((w) => w === o['why']) ?? 'not_built';
    return { kind: 'none', why };
  }
  const at = MOMENTS.find((m) => m === o['at']);
  const look = LOOKS.find((l) => l === o['look']);
  if (at === undefined || look === undefined) throw new WireShapeError(path, raw);
  const badges = (Array.isArray(o['badges']) ? o['badges'] : []).flatMap((b): OddsBadge[] => {
    if (typeof b !== 'object' || b === null) return [];
    const r = b as Record<string, unknown>;
    const tone = TONES.find((t) => t === r['tone']);
    const fact = text(r['fact']);
    return tone === undefined || fact === '' ? [] : [{ tone, fact, compare: text(r['compare']), explain: text(r['explain']) }];
  });
  return {
    kind: 'odds',
    at,
    look,
    headline: text(o['headline']),
    group: text(o['group']),
    held: o['held'] === true,
    like: sharesOf(o['like'], `${path}.like`),
    normal: sharesOf(o['normal'], `${path}.normal`),
    badges,
    days: count(o['days']),
  };
}
