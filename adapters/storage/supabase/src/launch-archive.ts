/**
 * THE LAUNCH ARCHIVE'S FILE FORMAT: what each launch looked like in its first minute, and when a
 * launched coin was seen graduating, as one gzip JSON-lines file per UTC hour in the private archive
 * bucket (r2-archive.ts). Written by chainwatch as launches happen and, once, by
 * tools/archive-launches.ts from the rows already in the database; read by the nightly smart-wallet job.
 *
 * Its own file so the writer and the reader cannot drift: both import `encodeRecords`/`decodeLaunches`
 * and the path builders from here, and nowhere else spells a path or a field name.
 *
 * ★ ONE FILE PER HOUR, ADDRESSED BY THE HOUR. `launches/2026-11-08/14.jsonl.gz` holds the launches
 * whose launch fell in 14:00–15:00 UTC. A file written again replaces the old one, so a re-run is safe;
 * the nightly job reads every file under a prefix and keeps one record per address.
 *
 * ★ AN UNKNOWN IS NULL, NEVER ZERO OR FALSE. `devSold: null` is "no opening buy was seen, so there was
 * no dev to watch"; `creator: null` is "not recorded" (every launch exported from before chainwatch kept
 * the creator). A reader must not treat either as a no.
 *
 * What breaks if changed carelessly: the field names. Files already in the bucket keep the old names
 * forever; a renamed field reads back as null on every file written before the rename.
 */

import { gunzipSync, gzipSync } from 'node:zlib';

export interface LaunchRecord {
  readonly address: string;
  /** The launch's time on the chain's clock, ms. */
  readonly launchedAt: number;
  /** The pool it first traded in; a later trade in another pool is a graduation. */
  readonly pool: string | null;
  /** The wallet that created the coin; null when not recorded. */
  readonly creator: string | null;
  readonly buyers: number;
  readonly buys: number;
  readonly devBuyUsd: number | null;
  readonly devBuySol: number | null;
  /** Share of supply bought in the launch block, 0–1. */
  readonly blockShare: number | null;
  /** First-second buyers in buying order. */
  readonly firstBuyers: readonly string[] | null;
  readonly devSold: boolean | null;
  /** The coin's name and ticker as launched; null when not recorded. */
  readonly name: string | null;
  readonly symbol: string | null;
  /** The launch's metadata document link (https only); null when not recorded. */
  readonly metadataUri: string | null;
  /** Every buy in the first minute, in order: wallet, SOL spent, ms after launch. Null when not recorded. */
  readonly minuteBuys: readonly { readonly w: string; readonly sol: number | null; readonly ms: number }[] | null;
}

/**
 * What a launch did by a horizon after it (1 hour, 24 hours, 7 days). Written by chainwatch from every
 * trade it saw. A coin no longer followed after 24 hours (quiet and small) has no 7-day record: its
 * 24-hour record is its last word. `complete: false` means chainwatch was not running for part of the
 * window, so a peak or a sale may be missing; a reader must not treat it as a whole record.
 */
export interface OutcomeRecord {
  readonly address: string;
  readonly launchedAt: number;
  readonly horizon: '1h' | '24h' | '7d';
  readonly complete: boolean;
  /** Highest market cap seen in the window, and when; null with no priced trade. */
  readonly peakCapUsd: number | null;
  readonly peakAt: number | null;
  /** The market cap at the end of the window (the last priced trade before it). */
  readonly endCapUsd: number | null;
  /** First time the cap fell to 20% or less of the peak so far, after a peak of at least twice the opening cap. */
  readonly crashAt: number | null;
  /** First seen trading outside its launch pool. */
  readonly graduatedAt: number | null;
  /** The creator's first sale, and the share of what they bought that they had sold by the end. */
  readonly devFirstSellAt: number | null;
  readonly devSoldShare: number | null;
  /** The launch-block buyers (bundle wallets): their first sale, and their share sold by the end. */
  readonly bundleFirstSellAt: number | null;
  readonly bundleSoldShare: number | null;
  readonly trades: number;
  readonly buys: number;
  /** Share of supply held by the 10 biggest wallets, from their own trades (wallet moves not seen); null when not followed or capped. */
  readonly top10Share: number | null;
  /** Wallets holding any of it, by the same count; null when not recorded. */
  readonly holders: number | null;
}

export interface GraduationRecord {
  readonly address: string;
  /** When it was first seen trading outside its launch pool, ms. */
  readonly seenAt: number;
  /** The pool it was seen in. */
  readonly pool: string | null;
}

const HOUR_MS = 3_600_000;

const hourParts = (ms: number): { day: string; hour: string } => {
  const iso = new Date(Math.floor(ms / HOUR_MS) * HOUR_MS).toISOString();
  return { day: iso.slice(0, 10), hour: iso.slice(11, 13) };
};

export const launchesPath = (hourMs: number): string => { const p = hourParts(hourMs); return `launches/${p.day}/${p.hour}.jsonl.gz`; };
export const graduationsPath = (hourMs: number): string => { const p = hourParts(hourMs); return `graduations/${p.day}/${p.hour}.jsonl.gz`; };
export const outcomesPath = (horizon: OutcomeRecord['horizon'], hourMs: number): string => { const p = hourParts(hourMs); return `outcomes/${horizon}/${p.day}/${p.hour}.jsonl.gz`; };
/** Chainwatch's in-memory follow state, saved so a restart picks up where it stopped. */
export const TRACKER_STATE_PATH = 'state/chainwatch-tracker.json.gz';
export const smartListPath = (day: string): string => `smart-wallets/${day}.json`;
export const SMART_LATEST_PATH = 'smart-wallets/latest.json';

export function encodeRecords(records: readonly (LaunchRecord | GraduationRecord | OutcomeRecord)[]): Uint8Array {
  return gzipSync(Buffer.from(records.map((r) => JSON.stringify(r)).join('\n')));
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function lines(bytes: Uint8Array): unknown[] {
  return gunzipSync(bytes).toString('utf8').split('\n').flatMap((l) => {
    if (l.trim() === '') return [];
    try { return [JSON.parse(l) as unknown]; } catch { return []; }
  });
}

/** A file's launches; a line that does not read is skipped, never guessed. */
export function decodeLaunches(bytes: Uint8Array): LaunchRecord[] {
  return lines(bytes).flatMap((raw): LaunchRecord[] => {
    const o = rec(raw);
    const address = str(o['address']);
    const launchedAt = num(o['launchedAt']);
    const buyers = num(o['buyers']);
    const buys = num(o['buys']);
    if (address === null || launchedAt === null || buyers === null || buys === null) return [];
    const fb = o['firstBuyers'];
    return [{
      address, launchedAt, buyers, buys,
      pool: str(o['pool']),
      creator: str(o['creator']),
      devBuyUsd: num(o['devBuyUsd']),
      devBuySol: num(o['devBuySol']),
      blockShare: num(o['blockShare']),
      firstBuyers: Array.isArray(fb) ? fb.filter((w): w is string => typeof w === 'string' && w !== '') : null,
      devSold: typeof o['devSold'] === 'boolean' ? o['devSold'] : null,
      name: str(o['name']),
      symbol: str(o['symbol']),
      metadataUri: str(o['metadataUri']),
      minuteBuys: Array.isArray(o['minuteBuys'])
        ? (o['minuteBuys'] as unknown[]).flatMap((b) => { const x = rec(b); const w = str(x['w']); const ms = num(x['ms']); return w === null || ms === null ? [] : [{ w, sol: num(x['sol']), ms }]; })
        : null,
    }];
  });
}

export function decodeOutcomes(bytes: Uint8Array): OutcomeRecord[] {
  return lines(bytes).flatMap((raw): OutcomeRecord[] => {
    const o = rec(raw);
    const address = str(o['address']);
    const launchedAt = num(o['launchedAt']);
    const horizon = o['horizon'];
    if (address === null || launchedAt === null || (horizon !== '1h' && horizon !== '24h' && horizon !== '7d')) return [];
    return [{
      address, launchedAt, horizon, complete: o['complete'] === true,
      peakCapUsd: num(o['peakCapUsd']), peakAt: num(o['peakAt']), endCapUsd: num(o['endCapUsd']), crashAt: num(o['crashAt']),
      graduatedAt: num(o['graduatedAt']), devFirstSellAt: num(o['devFirstSellAt']), devSoldShare: num(o['devSoldShare']),
      bundleFirstSellAt: num(o['bundleFirstSellAt']), bundleSoldShare: num(o['bundleSoldShare']),
      trades: num(o['trades']) ?? 0, buys: num(o['buys']) ?? 0,
      top10Share: num(o['top10Share']), holders: num(o['holders']),
    }];
  });
}

export function decodeGraduations(bytes: Uint8Array): GraduationRecord[] {
  return lines(bytes).flatMap((raw): GraduationRecord[] => {
    const o = rec(raw);
    const address = str(o['address']);
    const seenAt = num(o['seenAt']);
    return address === null || seenAt === null ? [] : [{ address, seenAt, pool: str(o['pool']) }];
  });
}
