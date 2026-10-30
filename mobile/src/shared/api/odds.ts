/**
 * A COIN'S LAUNCH PROFILE, as the phone app holds it (services/read/src/launch-odds.ts): for each moment the
 * coin has reached (its first second, minute 1, minute 5), what comparable past launches did from the price
 * at that moment beside what all launches did, and the coin's own opening facts with how launches like it
 * did. The token page's profile line and the Info tab's "Comparable launches" draw from it.
 *
 * Its own file beside about.ts, the shape and its decoder together, run through the same censor first
 * (`assertNoInternalVocabulary`), so a leak at the server is loud here rather than drawn.
 *
 * ★ HISTORY, NOT A FORECAST. Every share is of launches that already happened; the words come from the
 * server and say so. ★ AN ABSENCE IS A REASON, never a zero: a coin whose opening was not seen, or a profile
 * not yet built, decodes to `none` with why. A share that is not a number in 0..1 drops its row rather than
 * draw a bar at zero; a moment that does not decode is left out rather than shown empty.
 */

import { assertNoInternalVocabulary, WireShapeError } from './decode.ts';

export type OddsMoment = 'second_1' | 'minute_1' | 'minute_5';
export type OddsLook = 'runner' | 'mixed' | 'rug' | 'dead' | 'early';
export type OddsTone = 'green' | 'amber' | 'red';
export type OddsQualifier = 'Strong' | 'Typical' | 'Rug sign';

export interface OddsShares {
  readonly launches: number;
  readonly hit: readonly { readonly x: number; readonly share: number }[];
  readonly rugged: number | null;
  readonly neverMoved: number | null;
  /** Seconds from the moment by which half of these launches that doubled had peaked; null when too few doubled. */
  readonly halfPeakS: number | null;
}

export interface OddsSignal {
  readonly tone: OddsTone;
  readonly label: string;
  readonly value: string;
  readonly context: string;
  readonly qualifier: OddsQualifier;
  readonly explain: string;
}

export interface MomentOdds {
  readonly at: OddsMoment;
  readonly look: OddsLook;
  readonly group: string;
  readonly held: boolean;
  readonly like: OddsShares;
  readonly normal: OddsShares;
  readonly signals: readonly OddsSignal[];
}

export type CoinOdds =
  | { readonly kind: 'odds'; readonly at: OddsMoment; readonly days: number; readonly moments: readonly MomentOdds[] }
  | { readonly kind: 'none'; readonly why: 'not_launchpad' | 'not_seen' | 'not_built' };

const MOMENTS: readonly OddsMoment[] = ['second_1', 'minute_1', 'minute_5'];
const LOOKS: readonly OddsLook[] = ['runner', 'mixed', 'rug', 'dead', 'early'];
const TONES: readonly OddsTone[] = ['green', 'amber', 'red'];
const QUALIFIERS: readonly OddsQualifier[] = ['Strong', 'Typical', 'Rug sign'];
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
  const peak = o['halfPeakS'];
  return { launches: count(o['launches']), hit, rugged: share(o['rugged']), neverMoved: share(o['neverMoved']), halfPeakS: typeof peak === 'number' && Number.isFinite(peak) && peak >= 0 ? peak : null };
}

function signalOf(v: unknown): OddsSignal | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const tone = TONES.find((t) => t === r['tone']);
  const qualifier = QUALIFIERS.find((q) => q === r['qualifier']);
  const label = text(r['label']);
  if (tone === undefined || qualifier === undefined || label === '') return null;
  return { tone, qualifier, label, value: text(r['value']), context: text(r['context']), explain: text(r['explain']) };
}

function momentOf(v: unknown, path: string): MomentOdds | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const at = MOMENTS.find((m) => m === o['at']);
  const look = LOOKS.find((l) => l === o['look']);
  if (at === undefined || look === undefined) return null;
  const signals = (Array.isArray(o['signals']) ? o['signals'] : []).flatMap((s) => {
    const x = signalOf(s);
    return x === null ? [] : [x];
  });
  return { at, look, group: text(o['group']), held: o['held'] === true, like: sharesOf(o['like'], `${path}.like`), normal: sharesOf(o['normal'], `${path}.normal`), signals };
}

export function decodeCoinOdds(raw: unknown, path = '$.odds'): CoinOdds {
  assertNoInternalVocabulary(raw, path);
  const o = rec(raw, path);
  if (o['kind'] !== 'odds') return { kind: 'none', why: WHYS.find((w) => w === o['why']) ?? 'not_built' };
  const moments = (Array.isArray(o['moments']) ? o['moments'] : []).flatMap((m, i) => {
    const x = momentOf(m, `${path}.moments[${i}]`);
    return x === null ? [] : [x];
  });
  const last = moments[moments.length - 1];
  if (last === undefined) return { kind: 'none', why: 'not_built' };
  const at = MOMENTS.find((m) => m === o['at'] && moments.some((x) => x.at === m)) ?? last.at;
  return { kind: 'odds', at, days: count(o['days']), moments };
}
