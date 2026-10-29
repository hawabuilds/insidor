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
interface Logo {
  readonly address: string;
  readonly at: number;
  readonly hi: number;
  readonly lo: number;
}
interface HeldHour {
  readonly digest: string;
  readonly logos: readonly Logo[];
}
/** The picture search's logos, by hash version then mint hour (UTC): see `#logosBetween`. */
const HELD_LOGOS = new Map<string, Map<number, HeldHour>>();

export class PgImageHashRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
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
   * share of the database's egress, nearly all of it the rows the frame before was sent. Now each
   * hour's rows are first asked for as one digest (count and md5 of every address, mint time and
   * hash in it); an hour whose digest is the one held is served from memory, and only the hours
   * that differ (new launches, a logo hashed or re-read since) are read whole. The answer is the
   * one the single statement gave, a moment later. Held per process across repos (post-match makes
   * a repo per frame), by hash version; hours outside the asked window are dropped.
   *
   * What breaks if changed carelessly: a digest that leaves out a field the search uses (address,
   * mint time, bits) serves a stale logo for as long as the hour is asked about.
   */
  async #logosBetween(fromMs: number, toMs: number, version: string): Promise<readonly Logo[]> {
    const firstHour = Math.floor(fromMs / HOUR_MS);
    const lastHour = Math.floor(toMs / HOUR_MS);
    const range = [new Date(firstHour * HOUR_MS).toISOString(), new Date((lastHour + 1) * HOUR_MS).toISOString(), version];
    const digests = await this.#db.query<{ h: string; d: string }>(
      `select floor(extract(epoch from a.minted_at) / 3600)::bigint::text as h,
              count(*)::text || '/' || md5(string_agg(a.address || ' ' || a.minted_at::text || ' ' || ch.bits::text, ',' order by a.address, a.minted_at, ch.bits)) as d
         from public.asset a
         left join internal.coin_metadata m on m.asset_key = a.asset_key and m.outcome = 'read'
         join internal.image_hash ch on ch.uri = coalesce(m.image_uri, a.image_uri) and ch.bits is not null and ch.version = $3
        where a.minted_at >= $1 and a.minted_at < $2
        group by 1`,
      range,
    );
    const held = HELD_LOGOS.get(version) ?? new Map<number, HeldHour>();
    HELD_LOGOS.set(version, held);
    for (const h of [...held.keys()]) if (h < firstHour || h > lastHour) held.delete(h);
    const now = new Map(digests.map((r) => [Number(r.h), r.d] as const));
    /* An hour with no logos now has no digest row: it holds nothing. */
    for (const h of [...held.keys()]) if (!now.has(h)) held.delete(h);
    const stale = [...now].filter(([h, d]) => held.get(h)?.digest !== d).map(([h]) => h);
    if (stale.length > 0) {
      const lo = Math.min(...stale);
      const hi = Math.max(...stale);
      const rows = await this.#db.query<{ address: string; minted_at: string | Date; bits: string }>(
        `select a.address, a.minted_at, ch.bits::text as bits
           from public.asset a
           left join internal.coin_metadata m on m.asset_key = a.asset_key and m.outcome = 'read'
           join internal.image_hash ch on ch.uri = coalesce(m.image_uri, a.image_uri) and ch.bits is not null and ch.version = $3
          where a.minted_at >= $1 and a.minted_at < $2 and floor(extract(epoch from a.minted_at) / 3600)::bigint = any($4::bigint[])`,
        [new Date(lo * HOUR_MS).toISOString(), new Date((hi + 1) * HOUR_MS).toISOString(), version, stale.map(String)],
      );
      const fresh = new Map<number, Logo[]>(stale.map((h) => [h, []] as const));
      for (const r of rows) {
        const at = new Date(r.minted_at).getTime();
        fresh.get(Math.floor(at / HOUR_MS))?.push({ address: r.address, at, ...halves(fromBits(r.bits)) });
      }
      /* Held under the digest read first: a change between the two reads differs next time and is read again. */
      for (const [h, list] of fresh) held.set(h, { digest: now.get(h) ?? '', logos: list });
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
