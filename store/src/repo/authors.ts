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
 */

import type { Author, Counter } from '@insidor/contracts';
import type { AuthorKey, SourceId } from '@insidor/contracts/ids.ts';
import type { AuthorRepo } from '@insidor/contracts/ports/store.ts';

import type { Db } from '../client.ts';
import { reBrand, toMillis, toMillisRequired, toTimestamp } from '../rows.ts';
import type { TimestampColumn } from '../rows.ts';

interface AuthorRow {
  author_key: string;
  source: string;
  first_seen_at: TimestampColumn;
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
  select a.author_key, a.source, a.first_seen_at,
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
   */
  async upsert(authors: readonly Author[]): Promise<number> {
    for (const author of authors) {
      const separator = author.authorKey.indexOf(':');
      if (separator <= 0) {
        throw new TypeError(
          `authorKey '${author.authorKey}' is not '<source>:<stable id>'; the adapter must namespace it`,
        );
      }
      await this.#db.query(
        `insert into public.author (
           author_key, source, source_author_id, first_seen_at, last_seen_at,
           follower_count, follower_count_observed_at
         ) values ($1, $2, $3, $4, $4, $5, $6)
         on conflict (author_key) do update
            set last_seen_at = greatest(public.author.last_seen_at, excluded.last_seen_at),
                follower_count = coalesce(excluded.follower_count, public.author.follower_count),
                follower_count_observed_at = coalesce(
                  excluded.follower_count_observed_at,
                  public.author.follower_count_observed_at
                )`,
        [
          author.authorKey,
          author.source,
          author.authorKey.slice(separator + 1),
          toTimestamp(author.firstSeenAt),
          author.audience?.value ?? null,
          toTimestamp(author.audience?.observedAt ?? null),
        ],
      );
    }
    return authors.length;
  }

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
    audience,
    rosterTier: row.roster_tier,
  };
}
