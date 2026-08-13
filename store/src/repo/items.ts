/**
 * Items and their authors.
 *
 * Nothing in this file knows a platform's field names. By the time an Item reaches
 * here it is already in our vocabulary; the adapter did the translating and is the
 * only code permitted to have done it. If a vendor word ever appears in this file,
 * the boundary has already been crossed somewhere upstream.
 *
 * The `counters` column is written here as a convenience cache of the newest
 * reading. It is NOT the record — public.observation is — and nothing that
 * differences counters may read it, because a cache that is one pass stale
 * produces a rate that is silently wrong rather than absent.
 */

import type { Item, CounterSet, Fingerprint, MediaRef, Millis } from '@insidor/contracts';
import type { ItemId, SourceId } from '@insidor/contracts/ids.ts';
import type { ItemRepo } from '@insidor/contracts/ports/store.ts';

import type { Db } from '../client.ts';
import { NotImplemented } from '../not-implemented.ts';
import { reBrand, toBitLiteral, toMillis, toMillisRequired, toTimestamp } from '../rows.ts';
import type { TimestampColumn } from '../rows.ts';

interface ItemRow {
  item_id: string;
  source: string;
  source_item_id: string;
  author_key: string;
  posted_at: TimestampColumn;
  first_seen_at: TimestampColumn;
  lang: string | null;
  body: string;
  media: MediaRef[];
  counters: CounterSet;
  rebroadcast_of: string | null;
  reproduction_of: string | null;
  format_ids: string[];
  raw_ref: string;
}

interface FingerprintRow {
  item_id: string;
  kind: Fingerprint['kind'];
  key: string;
}

const SELECT_ITEM = `
  select item_id, source, source_item_id, author_key, posted_at, first_seen_at,
         lang, body, media, counters, rebroadcast_of, reproduction_of,
         format_ids, raw_ref
    from public.item
`;

export class PgItemRepo implements ItemRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Insert or refresh items. Idempotent on (source, source_item_id), because the
   * discovery path re-sees the same post constantly and a duplicate arrival must
   * cost nothing.
   *
   * `first_seen_at` is never overwritten: it is the clock the tracking schedule and
   * every age feature are computed from, and moving it forward would quietly make
   * old items look new.
   */
  async upsert(items: readonly Item[]): Promise<number> {
    if (items.length === 0) return 0;

    for (const item of items) {
      await this.#ensureAuthor(item);
      await this.#db.query(
        `insert into public.item (
           item_id, source, source_item_id, author_key, posted_at, first_seen_at,
           lang, body, media, counters, counters_observed_at,
           rebroadcast_of, reproduction_of, format_ids, raw_ref
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15)
         on conflict (item_id) do update set
           lang            = excluded.lang,
           body            = excluded.body,
           media           = excluded.media,
           counters        = excluded.counters,
           counters_observed_at = excluded.counters_observed_at,
           rebroadcast_of  = excluded.rebroadcast_of,
           reproduction_of = excluded.reproduction_of,
           format_ids      = excluded.format_ids`,
        [
          item.itemId,
          item.source,
          item.sourceItemId,
          item.authorKey,
          toTimestamp(item.postedAt),
          toTimestamp(item.firstSeenAt),
          item.lang,
          item.text,
          JSON.stringify(item.media),
          JSON.stringify(item.counters),
          toTimestamp(item.firstSeenAt),
          item.rebroadcastOf,
          item.reproductionOf,
          item.formatIds,
          item.rawRef,
        ],
      );
      await this.#writeFingerprints(item);
    }
    return items.length;
  }

  async byId(id: ItemId): Promise<Item | null> {
    const rows = await this.#db.query<ItemRow>(`${SELECT_ITEM} where item_id = $1`, [id]);
    const row = rows[0];
    if (!row) return null;
    return this.#toItem(row, await this.#fingerprintsFor([row.item_id]));
  }

  /**
   * A map rather than an array, and the difference is not cosmetic: a caller that
   * zips a returned array against the ids it asked for is silently wrong the first
   * time one of them is missing, and an item disappearing between two stages is
   * normal rather than exceptional. A map makes the absence something the caller
   * has to meet.
   */
  async byIds(ids: readonly ItemId[]): Promise<ReadonlyMap<ItemId, Item>> {
    const found = new Map<ItemId, Item>();
    if (ids.length === 0) return found;

    const rows = await this.#db.query<ItemRow>(`${SELECT_ITEM} where item_id = any($1)`, [[...ids]]);
    const fingerprints = await this.#fingerprintsFor(rows.map((row) => row.item_id));
    for (const row of rows) {
      const item = this.#toItem(row, fingerprints);
      found.set(item.itemId, item);
    }
    return found;
  }

  /**
   * Items admitted since an instant, oldest first — the query every stage that
   * walks forward in time lives on.
   *
   * `first_seen_at` IS the admission clock: an item is in this table because the
   * admit stage put it there, and the column is never moved forward on a re-arrival
   * (see upsert). It is not `posted_at`, which is the source's claim about the
   * world and is null whenever the source omits it or is known to lie.
   */
  async admittedSince(at: Millis, limit: number): Promise<readonly Item[]> {
    const rows = await this.#db.query<ItemRow>(
      `${SELECT_ITEM} where first_seen_at >= $1 order by first_seen_at asc limit $2`,
      [toTimestamp(at), limit],
    );
    const fingerprints = await this.#fingerprintsFor(rows.map((row) => row.item_id));
    return rows.map((row) => this.#toItem(row, fingerprints));
  }

  /**
   * Items due a re-read, newest tier first.
   *
   * Left unimplemented deliberately, and throwing rather than returning `[]`. The
   * re-read cadence is the tracking policy — which tier an item is in at what age,
   * and how long a tier waits — and policy does not belong in SQL, which is exactly
   * where the previous build's schedule went to hide. There is also no column to
   * schedule against yet: `counters_observed_at` records when we last read, not when
   * we next should, and deriving the second from the first here would bury the
   * cadence in this file.
   *
   * A tracking loop that calls this gets a loud, named gap in
   * `internal.stage_runs.err`. One that got an empty array would look exactly like a
   * loop with nothing to do, which is the failure this whole package is a reaction to.
   */
  async dueForObservation(_now: Millis, _limit: number): Promise<readonly Item[]> {
    throw new NotImplemented(
      'ItemRepo.dueForObservation',
      'the re-read cadence is tracking policy and there is no next_read_at column to schedule against',
    );
  }

  async bySourceItemId(source: SourceId, sourceItemId: string): Promise<Item | null> {
    const rows = await this.#db.query<ItemRow>(
      `${SELECT_ITEM} where source = $1 and source_item_id = $2`,
      [source, sourceItemId],
    );
    const row = rows[0];
    if (!row) return null;
    return this.#toItem(row, await this.#fingerprintsFor([row.item_id]));
  }

  /**
   * The author row exists so the item's foreign key resolves and so follower counts
   * have somewhere to live. The key's shape — `<source>:<stable id>` — is assigned
   * by the adapter; splitting on the first colon is the store's only assumption
   * about it, and it is asserted rather than assumed.
   */
  async #ensureAuthor(item: Item): Promise<void> {
    const separator = item.authorKey.indexOf(':');
    if (separator <= 0) {
      throw new TypeError(
        `authorKey '${item.authorKey}' is not '<source>:<stable id>'; the adapter must namespace it`,
      );
    }
    await this.#db.query(
      `insert into public.author (author_key, source, source_author_id, first_seen_at, last_seen_at)
       values ($1, $2, $3, $4, $4)
       on conflict (author_key) do update set last_seen_at = greatest(public.author.last_seen_at, excluded.last_seen_at)`,
      [
        item.authorKey,
        item.source,
        item.authorKey.slice(separator + 1),
        toTimestamp(item.firstSeenAt),
      ],
    );
  }

  /**
   * Carriers are append-only in practice: a fingerprint that once matched must keep
   * matching, or a story's membership stops being reproducible. Hence
   * `do nothing` rather than an update, and no delete path.
   */
  async #writeFingerprints(item: Item): Promise<void> {
    for (const fingerprint of item.fingerprints) {
      const width = fingerprint.bits;
      const imageBits =
        width !== undefined && fingerprint.kind === 'imageHash'
          ? toBitLiteral(fingerprint.key, width)
          : null;
      const textBits =
        width !== undefined && fingerprint.kind === 'textShingle'
          ? toBitLiteral(fingerprint.key, width)
          : null;

      await this.#db.query(
        `insert into public.item_fingerprint (item_id, kind, key, image_bits, text_bits)
         values ($1, $2, $3, $4::bit varying, $5::bit varying)
         on conflict (item_id, kind, key) do nothing`,
        [item.itemId, fingerprint.kind, fingerprint.key, imageBits, textBits],
      );
    }
  }

  async #fingerprintsFor(itemIds: readonly string[]): Promise<Map<string, Fingerprint[]>> {
    const byItem = new Map<string, Fingerprint[]>();
    if (itemIds.length === 0) return byItem;

    const rows = await this.#db.query<FingerprintRow>(
      `select item_id, kind, key from public.item_fingerprint where item_id = any($1)`,
      [[...itemIds]],
    );
    for (const row of rows) {
      const existing = byItem.get(row.item_id);
      const fingerprint: Fingerprint = { kind: row.kind, key: row.key };
      if (existing) existing.push(fingerprint);
      else byItem.set(row.item_id, [fingerprint]);
    }
    return byItem;
  }

  #toItem(row: ItemRow, fingerprints: Map<string, Fingerprint[]>): Item {
    return {
      itemId: reBrand<ItemId>(row.item_id),
      source: reBrand<SourceId>(row.source),
      sourceItemId: row.source_item_id,
      authorKey: reBrand(row.author_key),
      postedAt: toMillis(row.posted_at),
      firstSeenAt: toMillisRequired(row.first_seen_at, 'first_seen_at'),
      lang: row.lang,
      text: row.body,
      media: row.media,
      counters: row.counters,
      fingerprints: fingerprints.get(row.item_id) ?? [],
      rebroadcastOf: row.rebroadcast_of === null ? null : reBrand<ItemId>(row.rebroadcast_of),
      reproductionOf: row.reproduction_of === null ? null : reBrand<ItemId>(row.reproduction_of),
      formatIds: row.format_ids,
      rawRef: row.raw_ref,
    };
  }
}
