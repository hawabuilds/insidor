/**
 * PICTURE HASHES (internal.image_hash, 0070): which pictures still need one, and the coins whose
 * logo is close to a post's picture.
 *
 * The runner hashes (services/runner picture-hashes.ts) and the projector reads (services/project
 * post-match.ts); this file is the one place the table's shape — a hash as a signed 64-bit
 * integer, compared by XOR and a bit count — is spelled out, so the two can never disagree on it.
 *
 * ★ BEFORE 0070 IS APPLIED every read here answers "nothing" (an empty list, an empty map) and
 * every write is skipped, so the runner and projector run as they did: an unknown hash is an
 * unknown, never "different". `missingTable` is the one test for that, by Postgres's own code.
 *
 * What breaks if changed carelessly: `toBits`. The 16 hex digits are read as one unsigned 64-bit
 * number and stored as its signed twin (Postgres has no unsigned bigint); any other packing makes
 * every distance in SQL wrong while the hashes in JavaScript still look fine.
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs';

import type { Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';

/** A picture to hash: a feed post's (already embedded, so it passed the judge) or a recent coin's logo. */
export interface DuePicture {
  readonly uri: string;
  readonly kind: 'post' | 'coin';
}

/** A coin whose logo is within the bar of a post's picture, with its distance in bits. */
export interface PictureNeighbour {
  readonly itemId: string;
  readonly address: string;
  readonly distance: number;
}

const UNDEFINED_TABLE = '42P01';
const UNDEFINED_COLUMN = '42703';
/** True when the error is Postgres saying the table or column (0070) is not there yet. */
export const missingTable = (e: unknown): boolean => {
  const code = (e as { code?: unknown } | null)?.code;
  return code === UNDEFINED_TABLE || code === UNDEFINED_COLUMN;
};

const TWO_63 = 1n << 63n;
const TWO_64 = 1n << 64n;
/** 16 hex digits as the signed 64-bit integer Postgres stores. */
export function toBits(hex: string): string {
  const u = BigInt(`0x${hex}`);
  return (u >= TWO_63 ? u - TWO_64 : u).toString();
}
/** The stored integer back to 16 hex digits. */
export function fromBits(bits: string | number | bigint): string {
  const s = BigInt(bits);
  return (s < 0n ? s + TWO_64 : s).toString(16).padStart(16, '0');
}

const HOUR_MS = 3_600_000;
/**
 * ★ WHICH HOURS ARE ASKED ABOUT EACH FRAME. An hour that ended within HOT_MS is digested every
 * frame: new launches land there, and nearly every logo is hashed within half an hour of its mint
 * (on 30 Oct, 370 of the 372 logos of one hour eleven hours back were hashed within 30 minutes).
 * An older hour is digested again once COLD_RECHECK_MS has passed since it last was, so a logo
 * hashed hours late, or a coin whose metadata was re-read, reaches the picture search at most that
 * much later. Before 2026-10-30 every hour of the three-day window was digested every frame: the
 * digest joins ~90,000 coins with their metadata and hashes, ~27,000 disk blocks and 15–100 s a
 * frame on a disk-bound database — as much as the read it was saving.
 */
const HOT_MS = 2 * HOUR_MS;
const COLD_RECHECK_MS = 15 * 60_000;
interface Logo {
  readonly address: string;
  readonly at: number;
  readonly hi: number;
  readonly lo: number;
}
interface HeldHour {
  readonly digest: string;
  readonly logos: readonly Logo[];
  /** When this hour's digest was last compared with the database's (wall clock, ms). */
  readonly checkedAt: number;
}
/** The picture search's logos, by hash version then mint hour (UTC): see `#logosBetween`. */
const HELD_LOGOS = new Map<string, Map<number, HeldHour>>();

/** The held hours as the hold file keeps them: [hour, digest, checkedAt, [address, at, hi, lo][]]. */
interface HoldFile {
  readonly version: string;
  readonly hours: readonly (readonly [number, string, number, readonly (readonly [string, number, number, number])[]])[];
}

function loadHold(file: string, version: string): Map<number, HeldHour> | null {
  try {
    const f = JSON.parse(readFileSync(file, 'utf8')) as HoldFile;
    if (f.version !== version) return null;
    return new Map(f.hours.map(([h, digest, checkedAt, logos]) => [h, { digest, checkedAt, logos: logos.map(([address, at, hi, lo]) => ({ address, at, hi, lo })) }] as const));
  } catch {
    /* No file yet, or an unreadable one: the hours are read as on a first frame. */
    return null;
  }
}

function saveHold(file: string, version: string, held: ReadonlyMap<number, HeldHour>): void {
  const body: HoldFile = { version, hours: [...held].map(([h, x]) => [h, x.digest, x.checkedAt, x.logos.map((l) => [l.address, l.at, l.hi, l.lo] as const)] as const) };
  /* Written aside and renamed, so a frame starting meanwhile reads the old file or the new one, never half. */
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(body));
    renameSync(tmp, file);
  } catch {
    /* A full or read-only disk: the next frame reads the hours from the database, as before the file. */
  }
}

/**
 * Whole hours as a mint-time condition, neighbouring hours merged into one [start, end) range each,
 * the bounds as parameters from `$2` (`$1` is the hash version). Written out range by range rather
 * than joined to an array of ranges: against an array the planner guessed ~70,000 coins for an
 * hour's ~600 and hashed the whole of internal.image_hash (5,000 blocks) to join them; written out,
 * it looks each coin's metadata and hash up by key.
 */
function hourRanges(hours: readonly number[]): { readonly where: string; readonly params: string[] } {
  const params: string[] = [];
  const parts: string[] = [];
  const sorted = [...hours].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j += 1;
    params.push(new Date(sorted[i]! * HOUR_MS).toISOString(), new Date((sorted[j]! + 1) * HOUR_MS).toISOString());
    parts.push(`(a.minted_at >= $${params.length} and a.minted_at < $${params.length + 1})`);
    i = j + 1;
  }
  return { where: parts.join(' or '), params };
}

/** Tests only: forget the hours held in memory, as a new process starts without them. */
export function forgetHeldLogos(): void {
  HELD_LOGOS.clear();
}

/** Where the picture search's held hours are kept between frames; see `PgImageHashRepo`'s constructor. */
export interface LogoHoldOptions {
  /** The file the held hours are kept in (one process a frame); null keeps them in memory only. */
  readonly file: string | null;
  /** The wall clock, ms, against which an hour's last digest is aged. A stand-in in tests. */
  readonly now?: () => number;
}

export class PgImageHashRepo {
  readonly #db: Db;
  readonly #hold: LogoHoldOptions;

  /**
   * `hold.file`: the projector runs each frame as a new process (tools/railway-start.mjs), so hours
   * held in memory alone were gone by the next frame and every frame read the whole window again;
   * post-match.ts names a file here so they outlive the process.
   */
  constructor(db: Db, hold: LogoHoldOptions = { file: null }) {
    this.#db = db;
    this.#hold = hold;
  }

  /**
   * Pictures with no hash yet, coins first (a logo hashed late is a coin the picture search
   * cannot find), newest first: coin logos minted since `coinsSinceMs` whose metadata was read,
   * and the pictures of posts embedded since `postsSinceMs`. A picture that failed `maxAttempts`
   * times is not asked about again.
   */
  async due(coinsSinceMs: Millis, postsSinceMs: Millis, coins: number, posts: number, maxAttempts: number): Promise<readonly DuePicture[]> {
    try {
      const rows = await this.#db.query<{ uri: string; kind: 'post' | 'coin' }>(
        `(select distinct on (u.uri) u.uri, 'coin' as kind
            from (select coalesce(m.image_uri, a.image_uri) as uri, a.minted_at
                    from public.asset a
                    left join internal.coin_metadata m on m.asset_key = a.asset_key and m.outcome = 'read'
                   where a.minted_at >= $1 and coalesce(m.image_uri, a.image_uri) is not null
                   order by a.minted_at desc
                   limit $3 * 4) u
            left join internal.image_hash h on h.uri = u.uri
           where h.uri is null or (h.bits is null and h.attempts < $5)
           limit $3)
         union all
         (select distinct e.uri, 'post' as kind
            from internal.image_embedding e
            left join internal.image_hash h on h.uri = e.uri
           where e.subject_kind = 'item' and e.embedded_at >= $2
             and (h.uri is null or (h.bits is null and h.attempts < $5))
           limit $4)`,
        [new Date(coinsSinceMs).toISOString(), new Date(postsSinceMs).toISOString(), coins, posts, maxAttempts],
      );
      return rows;
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
  }

  /** One picture's hash; null when it could not be read (counted, so it stops being asked). */
  async record(uri: string, hex: string | null, version: string, at: Millis): Promise<void> {
    try {
      await this.#db.query(
        `insert into internal.image_hash (uri, bits, version, attempts, hashed_at) values ($1, $2::bigint, $3, 1, $4)
         on conflict (uri) do update set bits = coalesce(excluded.bits, internal.image_hash.bits), version = excluded.version,
                attempts = internal.image_hash.attempts + 1, hashed_at = excluded.hashed_at`,
        [uri, hex === null ? null : toBits(hex), version, new Date(at).toISOString()],
      );
    } catch (e) {
      if (!missingTable(e)) throw e;
    }
  }

  /** The hashes held for these pictures, as hex. */
  async hashesOf(uris: readonly string[], version: string): Promise<ReadonlyMap<string, string>> {
    if (uris.length === 0) return new Map();
    try {
      const rows = await this.#db.query<{ uri: string; bits: string }>(
        `select uri, bits::text as bits from internal.image_hash where uri = any($1::text[]) and bits is not null and version = $2`,
        [[...uris], version],
      );
      return new Map(rows.map((r) => [r.uri, fromBits(r.bits)]));
    } catch (e) {
      if (missingTable(e)) return new Map();
      throw e;
    }
  }

  /**
   * What is held for these pictures: the hash as hex, or null when it could not be read, and how
   * many times it was tried. A picture never tried is absent. For a step that hashes the few it
   * needs itself (the narratives' GIF thumbnails), so it neither re-asks an unreadable one forever
   * nor scans the feed for them.
   */
  async heldOf(uris: readonly string[], version: string): Promise<ReadonlyMap<string, { readonly hex: string | null; readonly attempts: number }>> {
    if (uris.length === 0) return new Map();
    try {
      const rows = await this.#db.query<{ uri: string; bits: string | null; attempts: number }>(
        `select uri, bits::text as bits, attempts from internal.image_hash where uri = any($1::text[]) and (bits is null or version = $2)`,
        [[...uris], version],
      );
      return new Map(rows.map((r) => [r.uri, { hex: r.bits === null ? null : fromBits(r.bits), attempts: Number(r.attempts) }]));
    } catch (e) {
      if (missingTable(e)) return new Map();
      throw e;
    }
  }

  /**
   * For each post picture, the coins minted in [post − allowance, post + window] whose logo is
   * within `maxDistance` bits of it: the picture search over the whole universe.
   */
  async neighbours(posts: readonly { readonly itemId: string; readonly uri: string; readonly postedAt: Millis }[], allowanceMs: number, windowMs: number, maxDistance: number, perPost: number, version: string): Promise<readonly PictureNeighbour[]> {
    /* ★ THE LOGOS ARE READ ONCE AND COMPARED HERE, NOT IN SQL. Comparing in the database joined every
       post with every logo minted in its window, a lookup per logo per post: on 2026-10-16 one
       statement over the evening's posts took 33 s, and split ten posts a statement it crept back as
       launches grew — by 2026-10-25, 86,000 coins in two days, ten posts spread over the feed's three
       days took 39 s, the service role's 30 s timeout failed nearly every frame and For You froze from
       07:00 UTC. The window's logos are one indexed read (109,000 in 3.4 s); the XOR and bit count of
       a few hundred posts against them is a fraction of a second here. */
    if (posts.length === 0) return [];
    try {
      const own = await this.hashesOf([...new Set(posts.map((p) => p.uri))], version);
      const asked = posts.flatMap((p) => {
        const hex = own.get(p.uri);
        return hex === undefined ? [] : [{ ...p, ...halves(hex) }];
      });
      if (asked.length === 0) return [];
      const from = Math.min(...asked.map((p) => p.postedAt)) - allowanceMs;
      const to = Math.max(...asked.map((p) => p.postedAt)) + windowMs;
      const logos = (await this.#logosBetween(from, to, version)).filter((l) => l.at >= from && l.at <= to);
      const out: PictureNeighbour[] = [];
      for (const p of asked) {
        const lo = p.postedAt - allowanceMs;
        const hi = p.postedAt + windowMs;
        const near: { address: string; at: number; distance: number }[] = [];
        for (let i = firstAtOrAfter(logos, lo); i < logos.length && logos[i]!.at <= hi; i += 1) {
          const l = logos[i]!;
          const distance = popcount32((p.hi ^ l.hi) >>> 0) + popcount32((p.lo ^ l.lo) >>> 0);
          if (distance <= maxDistance) near.push({ address: l.address, at: l.at, distance });
        }
        near.sort((a, b) => a.distance - b.distance || a.at - b.at);
        for (const n of near.slice(0, perPost)) out.push({ itemId: p.itemId, address: n.address, distance: n.distance });
      }
      return out;
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
  }

  /**
   * Every coin logo minted in the whole UTC hours covering [fromMs, toMs], sorted by mint time.
   *
   * ★ HELD BY THE HOUR, RE-READ ONLY WHERE AN HOUR CHANGED. The picture search asks for three days
   * of logos each frame: ~450,000 rows a read, about 20 GB a day on 29 Oct 2026 and the largest
   * share of the database's egress, nearly all of it the rows the frame before was sent. Now an
   * hour's rows are first asked for as one digest (count and md5 of every address, mint time and
   * hash in it); an hour whose digest is the one held is served from what is held, and only the
   * hours that differ (new launches, a logo hashed or re-read since) are read whole. Which hours
   * are digested in a frame: HOT_MS and COLD_RECHECK_MS. Held per process across repos (post-match
   * makes a repo per frame) and, with `hold.file`, across processes; by hash version; hours outside
   * the asked window are dropped.
   *
   * What breaks if changed carelessly: a digest that leaves out a field the search uses (address,
   * mint time, bits) serves a stale logo for as long as the hour is held. And the ranges: both
   * statements read only the asked hours, as ranges of the mint-time index. One range from the
   * first stale hour to the last, as before 2026-10-30, read the whole window whenever an old hour
   * and the newest changed together.
   */
  async #logosBetween(fromMs: number, toMs: number, version: string): Promise<readonly Logo[]> {
    const now = (this.#hold.now ?? Date.now)();
    const firstHour = Math.floor(fromMs / HOUR_MS);
    const lastHour = Math.floor(toMs / HOUR_MS);
    let held = HELD_LOGOS.get(version);
    if (held === undefined) {
      held = (this.#hold.file === null ? null : loadHold(this.#hold.file, version)) ?? new Map<number, HeldHour>();
      HELD_LOGOS.set(version, held);
    }
    for (const h of [...held.keys()]) if (h < firstHour || h > lastHour) held.delete(h);

    const asked: number[] = [];
    for (let h = firstHour; h <= lastHour; h += 1) {
      const x = held.get(h);
      const hot = (h + 1) * HOUR_MS > now - HOT_MS;
      if (x === undefined || hot || x.checkedAt <= now - COLD_RECHECK_MS) asked.push(h);
    }
    if (asked.length > 0) {
      const r = hourRanges(asked);
      const digests = await this.#db.query<{ h: string; d: string }>(
        `select floor(extract(epoch from a.minted_at) / 3600)::bigint::text as h,
                count(*)::text || '/' || md5(string_agg(a.address || ' ' || a.minted_at::text || ' ' || ch.bits::text, ',' order by a.address, a.minted_at, ch.bits)) as d
           from public.asset a
           left join internal.coin_metadata m on m.asset_key = a.asset_key and m.outcome = 'read'
           join internal.image_hash ch on ch.uri = coalesce(m.image_uri, a.image_uri) and ch.bits is not null and ch.version = $1
          where ${r.where}
          group by 1`,
        [version, ...r.params],
      );
      const digest = new Map(digests.map((x) => [Number(x.h), x.d] as const));
      /* An asked hour with no logos now has no digest row: it is held empty, under the empty digest. */
      const stale = new Set(asked.filter((h) => held.get(h)?.digest !== (digest.get(h) ?? '')));
      for (const h of asked) {
        const x = held.get(h);
        if (x !== undefined && !stale.has(h)) held.set(h, { ...x, checkedAt: now });
      }
      const fresh = new Map<number, Logo[]>([...stale].map((h) => [h, []] as const));
      const read = [...stale].filter((h) => digest.has(h));
      if (read.length > 0) {
        const w = hourRanges(read);
        const rows = await this.#db.query<{ address: string; minted_at: string | Date; bits: string }>(
          `select a.address, a.minted_at, ch.bits::text as bits
             from public.asset a
             left join internal.coin_metadata m on m.asset_key = a.asset_key and m.outcome = 'read'
             join internal.image_hash ch on ch.uri = coalesce(m.image_uri, a.image_uri) and ch.bits is not null and ch.version = $1
            where ${w.where}`,
          [version, ...w.params],
        );
        for (const row of rows) {
          const at = new Date(row.minted_at).getTime();
          fresh.get(Math.floor(at / HOUR_MS))?.push({ address: row.address, at, ...halves(fromBits(row.bits)) });
        }
      }
      /* Held under the digest read first: a change between the two reads differs next time and is read again. */
      for (const [h, list] of fresh) held.set(h, { digest: digest.get(h) ?? '', logos: list, checkedAt: now });
      if (this.#hold.file !== null) saveHold(this.#hold.file, version, held);
    }
    return [...held.values()]
      .flatMap((x) => x.logos)
      .sort((a, b) => a.at - b.at || (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  }
}

/** A stored hash's 16 hex digits as two unsigned 32-bit halves, for a bit count without BigInt in the loop. */
function halves(hex: string): { readonly hi: number; readonly lo: number } {
  return { hi: parseInt(hex.slice(0, 8), 16), lo: parseInt(hex.slice(8, 16), 16) };
}

function popcount32(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** The first logo minted at or after `at`, in a list sorted by mint time. */
function firstAtOrAfter(logos: readonly { readonly at: number }[], at: number): number {
  let lo = 0;
  let hi = logos.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (logos[mid]!.at < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
