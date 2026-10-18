/**
 * WHICH STORED COIN LOGOS THE APP WILL NEVER SHOW, AND THE ONLY PATHS THE REMOVAL MAY TOUCH (the
 * owner, 2026-10-18: "Remove ones we'll never show, after copying the list"). The mirror copied a
 * logo for every coin we hold until that day; about 115,000 of the 120,000 files are coins no
 * surface draws. This is the pure part of tools/logo-prune.ts: given the bucket's listing, the
 * shown set (coin-logos.ts SHOWN_PARTS) and the coins we still hold, it says file by file what is
 * removed and why, and refuses any path that is not a logo.
 *
 * Separate from the tool so the path rule and the keep rules are tested without a bucket.
 *
 * ★ THE BUCKET ALSO HOLDS WHAT THE CHAIN POINTS AT FOREVER. launch-metadata keeps each coin created
 * on Insidor as `<uuid>.<png|jpg|webp|gif>` and `<uuid>.json` at its root, and the posters' faces
 * under `author-pics/`. Only two path shapes are logos, and only they can ever be listed here:
 *     coin-logos/<address>       the 256-pixel copy (or an original stored before the two sizes)
 *     coin-logos/64/<address>    the 64-pixel copy
 * where <address> is 32 to 44 base-58 characters. Anything else is counted as skipped and never
 * leaves this module in a removal list, and `assertLogoPath` checks each path again just before it
 * is sent for deletion.
 *
 * What breaks if changed carelessly: LOGO_PATH. Widen it and a launch file the chain points at can
 * be deleted, which no one can undo: the coin's metadata link would answer 404 for good.
 */

/** The only paths removal may touch. Anchored at both ends: no root file, no other folder. */
export const LOGO_PATH = /^coin-logos\/(?:64\/)?([1-9A-HJ-NP-Za-km-z]{32,44})$/;

export interface StoredFile {
  /** The path in the bucket, folder included. */
  readonly path: string;
  readonly bytes: number;
  /** When the file was last written, epoch ms; null when the listing did not say. */
  readonly writtenMs: number | null;
}

export type RemoveReason = 'not shown' | 'not shown; coin no longer held';

export interface Removal {
  readonly path: string;
  readonly coin: string;
  readonly bytes: number;
  readonly reason: RemoveReason;
}

export interface Plan {
  readonly remove: readonly Removal[];
  readonly keptShown: { readonly files: number; readonly bytes: number };
  /** Files written inside the age guard: a coin may be shown by the next frame. */
  readonly keptYoung: { readonly files: number; readonly bytes: number };
  /** Paths that are not logos. Never removed; counted so a surprise is seen. */
  readonly skipped: readonly string[];
}

/** The coin a logo path is for, or null when the path is not a logo. */
export function logoCoin(path: string): string | null {
  return LOGO_PATH.exec(path)?.[1] ?? null;
}

/** Throws unless `path` is a logo path: the last check before a delete is sent. */
export function assertLogoPath(path: string): void {
  if (logoCoin(path) === null) throw new Error(`refusing to delete ${JSON.stringify(path)}: not a coin-logos/<address> or coin-logos/64/<address> path`);
}

export function planRemoval(files: readonly StoredFile[], shown: ReadonlySet<string>, held: ReadonlySet<string>, nowMs: number, minAgeMs: number): Plan {
  const remove: Removal[] = [];
  const skipped: string[] = [];
  const keptShown = { files: 0, bytes: 0 };
  const keptYoung = { files: 0, bytes: 0 };
  for (const f of files) {
    const coin = logoCoin(f.path);
    if (coin === null) {
      skipped.push(f.path);
      continue;
    }
    if (shown.has(coin)) {
      keptShown.files += 1;
      keptShown.bytes += f.bytes;
      continue;
    }
    if (f.writtenMs === null || nowMs - f.writtenMs < minAgeMs) {
      keptYoung.files += 1;
      keptYoung.bytes += f.bytes;
      continue;
    }
    remove.push({ path: f.path, coin, bytes: f.bytes, reason: held.has(coin) ? 'not shown' : 'not shown; coin no longer held' });
  }
  return { remove, keptShown, keptYoung, skipped };
}

/** The list as CSV: path, coin, bytes, reason. Every field is a path, an address, a number or a fixed reason, so none needs quoting but the reason. */
export function removalCsv(rows: readonly Removal[]): string {
  return ['path,coin,bytes,reason', ...rows.map((r) => `${r.path},${r.coin},${r.bytes},"${r.reason}"`)].join('\n') + '\n';
}
