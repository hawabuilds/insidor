/**
 * Accounts, and the one number about them that is ours.
 *
 * An author row is two things joined by a key, and the split is the architecture:
 *
 *   public.author            what the SOURCE says — handle, display name, follower
 *                            count, with the instant we read it. Theirs to change,
 *                            theirs to game, and readable by the app role.
 *   internal.author_roster   what WE concluded — a tier in [0,1] computed from
 *                            outcomes we observed. Ours, and unreachable from the
 *                            app credential because it lives in a schema that
 *                            credential has no USAGE on.
 *
 * `Author` presents them as one object because that is what a stage is handed, and
 * this file is the only place the join happens. A caller that wanted the tier
 * without the join would be a caller building its own author shape.
 *
 * ★ `rosterTier` IS NULL WHENEVER WE HAVE NOT COMPUTED ONE, AND NEVER 0. A zero is a
 * claim that the account is bad; an absence is not a claim about anything. The whole
 * roster starts absent and fills in as the nightly recompute reaches accounts, so on
 * day one every admission is scored with that term missing — which is correct, and
 * is visibly different in the log from every admission being scored with it at zero.
 *
 * The profile text rides along too (0080, internal.author_bio_reading): every text an account
 * showed, with when, because the coin match reads the addresses a poster puts in it.
 */

import type { Author, Counter, Millis } from '@insidor/contracts';
import type { AuthorKey, SourceId } from '@insidor/contracts/ids.ts';
import type { AuthorRepo } from '@insidor/contracts/ports/store.ts';

import type { Db } from '../client.ts';
import { reBrand, toMillis, toMillisRequired, toTimestamp } from '../rows.ts';
import type { TimestampColumn } from '../rows.ts';

interface AuthorRow {
  author_key: string;
  source: string;
  first_seen_at: TimestampColumn;
  handle: string | null;
  follower_count: string | null;
  follower_count_observed_at: TimestampColumn;
  roster_tier: number | null;
}

/**
 * The join, written once. A LEFT JOIN and not an inner one: an account with no
 * computed tier is an ordinary account we have not got to yet, not an account that
 * has stopped existing.
 */
const SELECT_AUTHOR = `
  select a.author_key, a.source, a.first_seen_at, a.handle,
         a.follower_count::text as follower_count, a.follower_count_observed_at,
         r.tier as roster_tier
    from public.author a
    left join internal.author_roster r using (author_key)
`;

export class PgAuthorRepo implements AuthorRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Upsert what the source told us. It never touches the roster tier — that is a
   * different table on purpose, so a discovery pass cannot overwrite a conclusion
   * with a fact, and a source that starts reporting a different handle cannot reset
   * our standing for the account.
   *
   * The handle is written because it is the half of a permalink the post id cannot supply;
   * the name and picture because the post sheet shows them beside the post. A newly seen
   * value replaces the old one — the account renamed itself, and the old name's links now
   * point at somebody else or at nothing — and a read that carried none leaves the known
   * one in place.
   */
  async upsert(authors: readonly Author[]): Promise<number> {
    for (const author of authors) {
      const separator = author.authorKey.indexOf(':');
      if (separator <= 0) {
        throw new TypeError(
          `authorKey '${author.authorKey}' is not '<source>:<stable id>'; the adapter must namespace it`,
        );
      }
    }
    if (authors.length === 0) return 0;
    /* ★ ONE STATEMENT A BATCH, NOT ONE TO THREE AN ACCOUNT (2026-11-03: a discovery pass's accounts
       were written one after another on the disk-bound database, part of a pass taking 15 to 75
       minutes). An account seen twice in one call ends as the loop left it: first seen at its first
       sighting, last seen at its latest, and each of handle, name, followers, picture the latest one
       a read carried — a read that carried none leaves the known one in place, as before. */
    const merged = new Map<string, { a: Author; last: Millis | null; handle: string | null; name: string | null; followers: number | null; followersAt: Millis | null; picture: string | null }>();
    const bios = new Map<string, { key: string; bio: string; first: Millis; last: Millis }>();
    for (const author of authors) {
      const had = merged.get(author.authorKey);
      const at = author.firstSeenAt;
      if (had === undefined) {
        merged.set(author.authorKey, {
          a: author, last: at, handle: author.handle ?? null, name: author.displayName ?? null,
          followers: author.audience?.value ?? null, followersAt: author.audience?.observedAt ?? null, picture: author.pictureUri ?? null,
        });
      } else {
        if (at !== null && (had.last === null || at > had.last)) had.last = at;
        if (author.handle != null) had.handle = author.handle;
        if (author.displayName != null) had.name = author.displayName;
        if (author.audience?.value != null) had.followers = author.audience.value;
        if (author.audience?.observedAt != null) had.followersAt = author.audience.observedAt;
        if (author.pictureUri != null) had.picture = author.pictureUri;
      }
      if (author.bio != null) {
        const k = `${author.authorKey}\u0000${author.bio}`;
        const b = bios.get(k);
        if (b === undefined) bios.set(k, { key: author.authorKey, bio: author.bio, first: at, last: at });
        else {
          if (at < b.first) b.first = at;
          if (at > b.last) b.last = at;
        }
      }
    }
    const rows = [...merged.values()];
    await this.#db.query(
      `insert into public.author (
         author_key, source, source_author_id, first_seen_at, last_seen_at,
         follower_count, follower_count_observed_at, handle, display_name
       )
       select * from unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[], $5::timestamptz[],
                            $6::float8[], $7::timestamptz[], $8::text[], $9::text[])
       on conflict (author_key) do update
          set last_seen_at = greatest(public.author.last_seen_at, excluded.last_seen_at),
              handle = coalesce(excluded.handle, public.author.handle),
              display_name = coalesce(excluded.display_name, public.author.display_name),
              follower_count = coalesce(excluded.follower_count, public.author.follower_count),
              follower_count_observed_at = coalesce(
                excluded.follower_count_observed_at,
                public.author.follower_count_observed_at
              )`,
      [
        rows.map((r) => r.a.authorKey),
        rows.map((r) => r.a.source),
        rows.map((r) => r.a.authorKey.slice(r.a.authorKey.indexOf(':') + 1)),
        rows.map((r) => toTimestamp(r.a.firstSeenAt)),
        rows.map((r) => toTimestamp(r.last)),
        rows.map((r) => r.followers),
        rows.map((r) => toTimestamp(r.followersAt)),
        rows.map((r) => r.handle),
        rows.map((r) => r.name),
      ],
    );
    const pictured = rows.filter((r) => r.picture !== null);
    if (pictured.length > 0 && this.#pictures) await this.#pictureAll(pictured.map((r) => [r.a.authorKey, r.picture as string] as const));
    if (bios.size > 0 && this.#bios) await this.#bioAll([...bios.values()]);
    return authors.length;
  }

  /** Every account's profile text as this read showed it (0080), in one statement: a text seen before moves its last read, a new one is a new row. A missing table (42P01) is remembered and the texts skipped until a restart. */
  async #bioAll(list: readonly { key: string; bio: string; first: Millis; last: Millis }[]): Promise<void> {
    try {
      await this.#db.query(
        `insert into internal.author_bio_reading (author_key, bio, first_read_at, last_read_at)
         select * from unnest($1::text[], $2::text[], $3::timestamptz[], $4::timestamptz[])
         on conflict (author_key, bio_md5) do update
            set first_read_at = least(internal.author_bio_reading.first_read_at, excluded.first_read_at),
                last_read_at = greatest(internal.author_bio_reading.last_read_at, excluded.last_read_at)`,
        [list.map((x) => x.key), list.map((x) => x.bio), list.map((x) => toTimestamp(x.first)), list.map((x) => toTimestamp(x.last))],
      );
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code !== '42P01') throw e;
      this.#bios = false;
    }
  }

  /** Every account's picture, in its own statement so a database without 0067 still takes the authors: the missing column (42703) is remembered and the pictures skipped until a restart. */
  async #pictureAll(list: readonly (readonly [string, string])[]): Promise<void> {
    try {
      await this.#db.query(
        `update public.author a set picture_url = u.uri from unnest($1::text[], $2::text[]) as u(key, uri) where a.author_key = u.key`,
        [list.map((x) => x[0]), list.map((x) => x[1])],
      );
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code !== '42703') throw e;
      this.#pictures = false;
    }
  }

  /** Whether internal.author_bio_reading exists (0080); false after the first write finds it missing. */
  #bios = true;



  /**
   * Every profile text each account showed, newest read first, with when (0080). An account never
   * read with a profile has no entry; before 0080 the answer is empty.
   */
  async biosOf(keys: readonly string[]): Promise<ReadonlyMap<string, readonly { readonly bio: string; readonly firstReadAt: number; readonly lastReadAt: number }[]>> {
    const out = new Map<string, { bio: string; firstReadAt: number; lastReadAt: number }[]>();
    if (keys.length === 0) return out;
    let rows: { author_key: string; bio: string; first_read_at: TimestampColumn; last_read_at: TimestampColumn }[];
    try {
      rows = await this.#db.query(
        `select author_key, bio, first_read_at, last_read_at from internal.author_bio_reading
          where author_key = any($1::text[]) order by author_key, last_read_at desc`,
        [[...keys]],
      );
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code === '42P01') return out;
      throw e;
    }
    for (const r of rows) {
      const list = out.get(r.author_key) ?? [];
      list.push({ bio: r.bio, firstReadAt: toMillisRequired(r.first_read_at, 'first_read_at'), lastReadAt: toMillisRequired(r.last_read_at, 'last_read_at') });
      out.set(r.author_key, list);
    }
    return out;
  }

  /** Whether `picture_url` exists (0067); false after the first write finds it missing. */
  #pictures = true;



  async byKey(key: AuthorKey): Promise<Author | null> {
    const rows = await this.#db.query<AuthorRow>(`${SELECT_AUTHOR} where a.author_key = $1`, [key]);
    const row = rows[0];
    return row ? toAuthor(row) : null;
  }

  /**
   * A page of accounts in one round trip, keyed by their own key.
   *
   * A map rather than an array, for the reason `ItemRepo.byIds` gives: a caller
   * zipping a returned array against the keys it asked for is silently wrong the
   * first time one is missing, and an item whose author row has not landed yet is
   * normal rather than exceptional.
   */
  async byKeys(keys: readonly AuthorKey[]): Promise<ReadonlyMap<AuthorKey, Author>> {
    const found = new Map<AuthorKey, Author>();
    if (keys.length === 0) return found;

    const rows = await this.#db.query<AuthorRow>(
      `${SELECT_AUTHOR} where a.author_key = any($1::text[])`,
      [[...keys]],
    );
    for (const row of rows) {
      const author = toAuthor(row);
      found.set(author.authorKey, author);
    }
    return found;
  }

  /**
   * Write our own standing for an account.
   *
   * Recomputed offline, nightly, over the whole corpus — never on the admission path,
   * which is handed the already-computed tier as data. `computed_at` moves every time,
   * because a tier that is not re-derived is a tier about a population that has moved
   * on, and the staleness has to be visible rather than inferred from when the job
   * last ran.
   */
  async setRosterTier(key: AuthorKey, tier: number): Promise<void> {
    await this.#db.query(
      `insert into internal.author_roster (author_key, tier, computed_at, observed_items)
       values ($1, $2, now(), $3)
       on conflict (author_key) do update
          set tier = excluded.tier,
              computed_at = excluded.computed_at,
              observed_items = excluded.observed_items`,
      [key, tier, 0],
    );
  }
}

function toAuthor(row: AuthorRow): Author {
  // `follower_count` is bigint, so pg hands it back as a string rather than silently
  // rounding past 2^53. Widened here because Counter.value is a number, and an
  // audience that large is a different problem from a rounding one.
  const followers = row.follower_count === null ? null : Number(row.follower_count);
  const observedAt = toMillis(row.follower_count_observed_at);

  // No instant, no counter. `Counter.observedAt` is when WE read it and it is
  // required; a follower count with no read time is a number nobody can age, and
  // ageing it against the wrong clock is worse than not having it. The value itself
  // may be null inside a present Counter — that is "we asked and it was not there",
  // which the fidelity records — so only the missing instant makes the whole thing
  // absent.
  const audience: Counter | null =
    observedAt === null
      ? null
      : {
          value: followers,
          fidelity: followers === null ? { kind: 'absent' } : { kind: 'exact' },
          observedAt,
        };

  return {
    authorKey: reBrand<AuthorKey>(row.author_key),
    source: reBrand<SourceId>(row.source),
    firstSeenAt: toMillisRequired(row.first_seen_at, 'first_seen_at'),
    handle: row.handle,
    audience,
    rosterTier: row.roster_tier,
  };
}
