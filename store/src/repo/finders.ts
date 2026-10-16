/**
 * The finders' records (0083): the posts coins name (internal.coin_post_link), the shortened
 * links in text posts and where they led (internal.short_link), and the extra search words
 * (internal.search_word) — plus the reads the finders and their reports need over them.
 *
 * Its own repo because none of these belongs to the coin universe's or the items' records: the
 * universe's metadata row is written here too (through PgCoinUniverseRepo, by the caller), and a
 * post found here is stored and credited through the items repo like any arrival.
 *
 * ★ SAFE BEFORE 0083. Every read answers "nothing" when its table is missing, and every write is
 * skipped the same way, so a runner deployed before the migration runs its passes empty rather
 * than failing its loop every few seconds. `missing` says which, once.
 *
 * What breaks if changed carelessly: `recordLinks` never overwrites. The first sighting's
 * `minted_at` is the coin's launch and `found_at` is when we first knew of the link — the lead-time
 * report reads both, and a rewrite on a re-read would move them.
 */

import type { Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { toMillis, toTimestamp } from '../rows.ts';

const MISSING_TABLE = '42P01';
const isMissing = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === MISSING_TABLE;

export interface FreshCoin {
  readonly assetKey: string;
  readonly address: string;
  readonly metadataUri: string | null;
  readonly mintedAt: Millis | null;
}

export interface CoinPostLink {
  readonly assetKey: string;
  readonly address: string;
  readonly source: string;
  readonly sourceItemId: string;
  readonly link: string;
  readonly mintedAt: Millis | null;
}

export interface ShortLinkCandidate {
  readonly itemId: string;
  readonly url: string;
}

export interface SearchWord {
  readonly origin: 'trend' | 'coined';
  readonly kind: 'tag' | 'sound' | 'creator' | 'video';
  readonly source: string;
  readonly value: string;
  readonly rank: number | null;
  readonly facts: Record<string, unknown> | null;
}

export interface CoinedPost {
  readonly itemId: string;
  readonly source: string;
  readonly handle: string | null;
  readonly body: string;
  readonly formatIds: readonly string[];
  readonly firstCoinAt: Millis | null;
}

export class PgFinderRepo {
  readonly #db: Db;
  #warned = false;

  constructor(db: Db) {
    this.#db = db;
  }

  /** True once a read or write found 0083 missing; the caller logs it once. */
  get missing(): boolean {
    return this.#warned;
  }

  async #guard<T>(empty: T, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (isMissing(e)) {
        this.#warned = true;
        return empty;
      }
      throw e;
    }
  }

  /**
   * Coins first seen since `sinceMs` whose metadata has never been read, newest first: the ones a
   * launch just made. A coin with any metadata row is the universe loop's (its retries included).
   */
  async freshUnread(sinceMs: Millis, limit: number): Promise<readonly FreshCoin[]> {
    const rows = await this.#db.query<{ asset_key: string; address: string; metadata_uri: string | null; minted_at: Date | string | null }>(
      `select a.asset_key, a.address, a.declared_social ->> 'metadata' as metadata_uri, a.minted_at
         from public.asset a
        where a.origin = 'live_stream'
          and a.first_seen_at >= $1
          and not exists (select 1 from internal.coin_metadata m where m.asset_key = a.asset_key)
        order by a.first_seen_at desc
        limit $2`,
      [toTimestamp(sinceMs), limit],
    );
    return rows.map((r) => ({ assetKey: r.asset_key, address: r.address, metadataUri: r.metadata_uri, mintedAt: toMillis(r.minted_at) }));
  }

  /** The posts a coin's metadata names; a link already recorded is kept as first recorded. */
  async recordLinks(links: readonly CoinPostLink[], at: Millis): Promise<number> {
    if (links.length === 0) return 0;
    return this.#guard(0, async () => {
      const rows = await this.#db.query<{ n: string }>(
        `with ins as (
           insert into internal.coin_post_link (asset_key, address, source, source_item_id, link, minted_at, found_at)
           select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::timestamptz[], $7::timestamptz[])
           on conflict do nothing
           returning 1)
         select count(*)::text as n from ins`,
        [
          links.map((l) => l.assetKey),
          links.map((l) => l.address),
          links.map((l) => l.source),
          links.map((l) => l.sourceItemId),
          links.map((l) => l.link.slice(0, 600)),
          links.map((l) => toTimestamp(l.mintedAt)),
          links.map(() => toTimestamp(at)),
        ],
      );
      return Number(rows[0]?.n ?? 0);
    });
  }

  /** When the first coin naming each post launched, for the posts asked about. */
  async firstCoinAt(itemIds: readonly string[]): Promise<ReadonlyMap<string, Millis>> {
    if (itemIds.length === 0) return new Map();
    return this.#guard(new Map<string, Millis>(), async () => {
      const rows = await this.#db.query<{ item_id: string; at: Date | string }>(
        `select l.source || ':' || l.source_item_id as item_id, min(l.minted_at) as at
           from unnest($1::text[], $2::text[]) as p(source, source_item_id)
           join internal.coin_post_link l on l.source = p.source and l.source_item_id = p.source_item_id
          where l.minted_at is not null
          group by 1`,
        [itemIds.map((id) => id.slice(0, id.indexOf(':'))), itemIds.map((id) => id.slice(id.indexOf(':') + 1))],
      );
      return new Map(rows.flatMap((r) => {
        const at = toMillis(r.at);
        return at === null ? [] : [[r.item_id, at] as const];
      }));
    });
  }

  /**
   * Shortened links (`pattern`, a SQL regular expression the source's adapter supplies) in posts of
   * `source` whose last reading is under `maxAgeMs` old and at least `minPerMinute` approvals per
   * minute of age, never followed before; fastest first.
   */
  async shortLinksToFollow(source: string, pattern: string, sinceMs: Millis, maxAgeMs: number, minPerMinute: number, limit: number): Promise<readonly ShortLinkCandidate[]> {
    return this.#guard([] as readonly ShortLinkCandidate[], async () => {
      const rows = await this.#db.query<{ item_id: string; url: string }>(
        `with fast as (
           select i.item_id, i.body,
                  (i.counters -> 'approval' ->> 'value')::double precision
                    / greatest(1, extract(epoch from (i.counters_observed_at - i.posted_at)) / 60) as per_minute
             from public.item i
            where i.source = $1
              and i.first_seen_at >= $2
              and i.posted_at is not null
              and i.counters_observed_at - i.posted_at <= make_interval(secs => $3::double precision / 1000)
              and i.body ~ $4)
         select f.item_id, m[1] as url
           from fast f
           cross join lateral regexp_matches(f.body, '(' || $4 || ')', 'g') as m
          where f.per_minute >= $5
            and not exists (select 1 from internal.short_link s where s.short_url = m[1])
          order by f.per_minute desc
          limit $6`,
        [source, toTimestamp(sinceMs), maxAgeMs, pattern, minPerMinute, limit],
      );
      return [...new Map(rows.map((r) => [r.url, { itemId: r.item_id, url: r.url }])).values()];
    });
  }

  async recordShortLinks(rows: readonly { shortUrl: string; target: string | null; itemId: string }[], at: Millis): Promise<void> {
    if (rows.length === 0) return;
    await this.#guard(undefined, async () => {
      await this.#db.query(
        `insert into internal.short_link (short_url, target, item_id, followed_at)
         select s, left(t, 2000), i, $4 from unnest($1::text[], $2::text[], $3::text[]) as x(s, t, i)
         on conflict (short_url) do nothing`,
        [rows.map((r) => r.shortUrl), rows.map((r) => r.target), rows.map((r) => r.itemId), toTimestamp(at)],
      );
    });
  }

  /** Every search word of these origins, best rank first. */
  async searchWords(origins: readonly SearchWord['origin'][]): Promise<readonly SearchWord[]> {
    return this.#guard([] as readonly SearchWord[], async () => {
      const rows = await this.#db.query<{ origin: SearchWord['origin']; kind: SearchWord['kind']; source: string; value: string; rank: number | null; facts: Record<string, unknown> | null }>(
        `select origin, kind, source, value, rank, facts from internal.search_word
          where origin = any($1::text[]) order by rank nulls last, value`,
        [[...origins]],
      );
      return rows.map((r) => ({ origin: r.origin, kind: r.kind, source: r.source, value: r.value, rank: r.rank, facts: r.facts }));
    });
  }

  /**
   * One origin's words replaced whole: the newest reading is the list. Upserted first and the words
   * no longer in it deleted after, so a failure between the two leaves the old words plus the new,
   * never an empty list.
   */
  async replaceSearchWords(origin: SearchWord['origin'], words: readonly SearchWord[], at: Millis): Promise<void> {
    await this.#guard(undefined, async () => {
      await this.#db.query(
        `insert into internal.search_word (origin, kind, source, value, rank, facts, updated_at)
         select distinct on (k, s, v) $1, k, s, v, r, f, $7
           from unnest($2::text[], $3::text[], $4::text[], $5::int[], $6::jsonb[]) as x(k, s, v, r, f)
         on conflict (origin, kind, source, value) do update set rank = excluded.rank, facts = excluded.facts, updated_at = excluded.updated_at`,
        [origin, words.map((w) => w.kind), words.map((w) => w.source), words.map((w) => w.value), words.map((w) => w.rank), words.map((w) => (w.facts === null ? null : JSON.stringify(w.facts))), toTimestamp(at)],
      );
      await this.#db.query('delete from internal.search_word where origin = $1 and updated_at < $2', [origin, toTimestamp(at)]);
    });
  }

  /** When the newest word of an origin was written; null when there is none. */
  async searchWordsAt(origin: SearchWord['origin']): Promise<Millis | null> {
    return this.#guard(null, async () => {
      const rows = await this.#db.query<{ at: Date | string | null }>('select max(updated_at) as at from internal.search_word where origin = $1', [origin]);
      return toMillis(rows[0]?.at ?? null);
    });
  }

  /**
   * A source's posts made since `sinceMs` that a lane found, fastest-rising reach first (the newest
   * reading's rate), at most `limit`: the young videos worth reading again soon.
   */
  async youngPosts(source: string, sinceMs: Millis, limit: number): Promise<readonly string[]> {
    const rows = await this.#db.query<{ source_item_id: string }>(
      `select i.source_item_id
         from public.item i
         join internal.item_found_by f on f.item_id = i.item_id
         left join lateral (
                select o.rate_per_min from public.observation o
                 where o.item_id = i.item_id and o.kind = 'reach'
                 order by o.captured_at desc limit 1) r on true
        where i.source = $1 and i.posted_at >= $2
        order by r.rate_per_min desc nulls last, i.posted_at desc
        limit $3`,
      [source, toTimestamp(sinceMs), limit],
    );
    return rows.map((r) => r.source_item_id);
  }

  /**
   * Every coined post we hold whose first coin launched since `sinceMs`: a coin's metadata named
   * it, or the owner confirmed its coin. With its creator, words and sounds, for the learned words.
   */
  async coinedPosts(sinceMs: Millis): Promise<readonly CoinedPost[]> {
    return this.#guard([] as readonly CoinedPost[], async () => {
      const rows = await this.#db.query<{ item_id: string; source: string; handle: string | null; body: string | null; format_ids: string[] | null; first_coin_at: Date | string | null }>(
        `select c.item_id, i.source, a.handle, i.body, i.format_ids, c.first_coin_at
           from internal.coined_post_lead c
           join public.item i on i.item_id = c.item_id
           left join public.author a on a.author_key = i.author_key
          where c.first_coin_at >= $1`,
        [toTimestamp(sinceMs)],
      );
      const held = rows.map((r) => ({ itemId: r.item_id, source: r.source, handle: r.handle, body: r.body ?? '', formatIds: r.format_ids ?? [], firstCoinAt: toMillis(r.first_coin_at) }));
      return [...held, ...(await this.#trainingSet(sinceMs, new Set(held.map((h) => h.itemId))))];
    });
  }

  /**
   * ★ THE SHORT-VIDEO TRAINING SET (0085) JOINS THE LEARNED WORDS: the coined videos we never held
   * (found again by id, or from the founders' sheets), with their caption, tags and sound as the
   * items' own spelling. A post already read above is not counted twice. Read on its own so a
   * database without 0085 still learns from the held posts (an error here is empty, never the
   * whole list).
   */
  async #trainingSet(sinceMs: Millis, seen: ReadonlySet<string>): Promise<readonly CoinedPost[]> {
    try {
      const rows = await this.#db.query<{ item_id: string; source: string; handle: string | null; caption: string | null; tags: string[] | null; sound: string | null; first_coin_at: Date | string | null }>(
        `select item_id, source, handle, caption, tags, sound, first_coin_at from internal.coined_video
          where first_coin_at >= $1 and (caption is not null or cardinality(tags) > 0 or sound is not null or handle is not null)`,
        [toTimestamp(sinceMs)],
      );
      return rows
        .filter((r) => !seen.has(r.item_id))
        .map((r) => {
          const caption = r.caption ?? '';
          /* Tags read from the caption and tags the source listed alone: both, as '#tag' words, so `learnWords` reads them as for a held post. */
          const listed = (r.tags ?? []).filter((t) => !caption.toLowerCase().includes(`#${t.toLowerCase()}`)).map((t) => `#${t}`);
          return { itemId: r.item_id, source: r.source, handle: r.handle, body: [caption, ...listed].join(' ').trim(), formatIds: r.sound === null ? [] : [r.sound], firstCoinAt: toMillis(r.first_coin_at) };
        });
    } catch (e) {
      if (isMissing(e)) return [];
      throw e;
    }
  }
}
