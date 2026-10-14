/**
 * The namer's tables (0076): the known post → coin pairs it learns from, their vectors, its
 * guesses, and the owner's picks on the Create sheet.
 *
 * Its own repository because these rows answer one question — what do people name a coin made
 * from a post like this — and have readers no other table has: the runner's namer step, the
 * projector's Create ideas, coin matching's search, and the before/after measurement. Each source
 * of pairs is spelled ONCE here (`fromDatabase`), so the runner's live copy and the measurement
 * learn from the same pairs.
 *
 * ★ BEFORE 0076 EVERYTHING IS EMPTY AND NOTHING FAILS. Every read answers empty and every write
 * answers false on a missing table: the runner asks for no guesses, the projector offers the
 * judge's names as before, matching searches as before.
 *
 * ★ THE OWNER'S CALL, AS THE STORE READS IT EVERYWHERE. A confirmed coin is CURRENT_COIN_CALLS'
 * `right` (the pick after "Wrong coin" included, a retraction of the same coin excluded), so a
 * coin the owner took back never becomes an example, and one he picked after "Wrong" does.
 *
 * What breaks if changed carelessly: `available_at`. A pair can only teach a post made AFTER the
 * coin existed (and, for the owner's call, after he made it); the measurement filters on it, and
 * a pair dated by when this row was written instead would hand a held-out post its own answer.
 */

import type { Db } from '../client.ts';
import { CURRENT_COIN_CALLS } from './owner-coin-calls.ts';

const UNDEFINED_TABLE = '42P01';
const missingTable = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === UNDEFINED_TABLE;

/** The table's own bounds (0076): longer names are cut, never refused. */
const NAME_MAX = 64;
const TICKER_MAX = 16;

export type NameExampleSource = 'sheet' | 'known' | 'owner' | 'gold' | 'created' | 'linked';

/** One known pair as a source says it. */
export interface NamePair {
  readonly itemId: string;
  readonly address: string | null;
  readonly name: string;
  readonly ticker: string;
  readonly source: NameExampleSource;
  readonly text: string;
  /** A picture named directly by the source; else the post's media, when held. */
  readonly picture: string | null;
  readonly media?: unknown;
  readonly seen?: string | null;
  readonly postedAtMs: number | null;
  /** When the pair existed: the coin's launch, or the owner's call. Null when unknown. */
  readonly availableAtMs: number | null;
}

/** One example post, all its coin names, and its vector. */
export interface StoredExample {
  readonly itemId: string;
  readonly text: string;
  readonly seen: string | null;
  readonly coins: readonly { readonly name: string; readonly ticker: string }[];
  readonly postedAtMs: number | null;
  readonly values: Float32Array;
}

/** A post the namer may be asked about: its newest answers and what it shows. */
export interface NameCandidate {
  readonly itemId: string;
  readonly text: string;
  readonly media: unknown;
  readonly coinable: boolean;
  readonly confidence: number;
  readonly lookedAt: string;
  readonly proposedName: string | null;
  readonly kind: string | null;
  readonly postedAtMs: number | null;
}

const parseVector = (v: unknown): Float32Array => {
  if (Array.isArray(v)) return Float32Array.from(v as number[]);
  const s = String(v ?? '').replace(/^\[|\]$/g, '');
  return s === '' ? new Float32Array() : Float32Array.from(s.split(',').map(Number));
};
const ms = (v: Date | string | null | undefined): number | null => (v === null || v === undefined ? null : new Date(v).getTime());

/* The coin's name and ticker: the name index first, then the asset row. */
const COIN_NAMES = `
  select a.address, coalesce(n.name, s.name) as name, coalesce(n.ticker, s.symbol) as ticker, coalesce(n.launched_at, s.minted_at) as launched_at
    from (select distinct address from addrs) a
    left join public.coin_name n on n.address = a.address
    left join public.asset s on s.chain = 'solana' and s.address = a.address`;

export class PgNameExampleRepo {
  readonly #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  async #soft<T>(read: () => Promise<T[]>): Promise<T[]> {
    try {
      return await read();
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
  }

  /**
   * The pairs the database holds: the owner's confirmed coins, gold additions, coins created on
   * Insidor from a post, and coins whose own links carry a post the judge said yes to (`linked`,
   * only coins launched in the last `linkedDays` days when given — the runner's per-pass read).
   */
  async fromDatabase(opts: { readonly linkedDays: number | null; readonly linked: boolean } = { linkedDays: null, linked: true }): Promise<readonly NamePair[]> {
    type Row = { item_id: string; address: string | null; name: string | null; ticker: string | null; text: string | null; picture: string | null; media: unknown; posted_at: Date | null; available_at: Date | null };
    const pairs = (rows: readonly Row[], source: NameExampleSource): NamePair[] =>
      rows.flatMap((r) => {
        const name = (r.name ?? '').trim();
        const ticker = (r.ticker ?? '').replace(/^\$+/, '').trim();
        if (name === '' && ticker === '') return [];
        return [{ itemId: r.item_id, address: r.address, name: name === '' ? ticker : name, ticker: ticker === '' ? name : ticker, source, text: r.text ?? '', picture: r.picture, media: r.media, postedAtMs: ms(r.posted_at), availableAtMs: ms(r.available_at) }];
      });

    const owner = await this.#soft(() =>
      this.#db.query<Row>(
        `with cur as (select * from (${CURRENT_COIN_CALLS}) c where c.verdict = 'right' and c.coin_address is not null),
              addrs as (select coin_address as address from cur), names as (${COIN_NAMES})
         select cur.item_id, cur.coin_address as address, names.name, names.ticker, i.body as text, null::text as picture, i.media,
                i.posted_at, greatest(cur.created_at, names.launched_at) as available_at
           from cur join names on names.address = cur.coin_address
           left join public.item i on i.item_id = cur.item_id`,
      ),
    );
    const gold = await this.#soft(() =>
      this.#db.query<Row>(
        `with addrs as (select coin_mint as address from internal.gold_addition where coin_mint is not null), names as (${COIN_NAMES})
         select g.item_id, g.coin_mint as address, coalesce(names.name, g.coin_name) as name, names.ticker, g.post_text as text, g.image_uri as picture, i.media,
                coalesce(g.posted_at, i.posted_at) as posted_at, coalesce(g.launched_at, names.launched_at) as available_at
           from internal.gold_addition g left join names on names.address = g.coin_mint
           left join public.item i on i.item_id = g.item_id`,
      ),
    );
    const created = await this.#soft(() =>
      this.#db.query<Row>(
        `select p.item_id, p.address, p.name, p.ticker, i.body as text, null::text as picture, i.media, i.posted_at, p.created_at as available_at
           from internal.create_pick p left join public.item i on i.item_id = p.item_id`,
      ),
    );
    const linked = !opts.linked ? [] : await this.#soft(() =>
      this.#db.query<Row>(
        `with l as (
           select split_part(asset_key, ':', 2) as address,
                  substring(coalesce(social_link, '') || ' ' || coalesce(website, '') from '/status(?:es)?/([0-9]{15,20})') as sid
             from public.coin_link where asset_key like 'solana:%'),
         addrs as (select address from l where sid is not null), names as (${COIN_NAMES}),
         yes as (
           select distinct on (item_id) item_id, coinable from internal.post_judgement
            where prompt_id not like 'post-kind%' and item_id = any(select 'x:' || sid from l where sid is not null)
            order by item_id, judged_at desc)
         select i.item_id, l.address, names.name, names.ticker, i.body as text, null::text as picture, i.media, i.posted_at, names.launched_at as available_at
           from l join names on names.address = l.address
           join public.item i on i.item_id = 'x:' || l.sid
           join yes on yes.item_id = i.item_id and yes.coinable
          where ($1::int is null or names.launched_at > now() - make_interval(days => $1::int))`,
        [opts.linkedDays],
      ),
    );
    return [...pairs(owner, 'owner'), ...pairs(created, 'created'), ...pairs(gold, 'gold'), ...pairs(linked, 'linked')];
  }

  /** Writes new pairs; one already held (same post and name) is left as it is. The number written; 0 before 0076. */
  async put(pairs: readonly (NamePair & { readonly picture: string | null })[]): Promise<number> {
    if (pairs.length === 0) return 0;
    try {
      const rows = await this.#db.query<{ n: string }>(
        `with ins as (
           insert into internal.name_example (item_id, address, name, ticker, source, text, picture, seen, posted_at)
           select u.item_id, u.address, u.name, u.ticker, u.source, u.text, u.picture,
                  coalesce(u.seen, (select g.seen from internal.name_guess g where g.item_id = u.item_id and g.rank = 0)),
                  to_timestamp(u.posted_ms / 1000.0)
             from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::float8[])
                  as u(item_id, address, name, ticker, source, text, picture, seen, posted_ms)
           on conflict do nothing returning 1)
         select count(*)::text as n from ins`,
        [
          pairs.map((p) => p.itemId), pairs.map((p) => p.address), pairs.map((p) => p.name.slice(0, NAME_MAX)), pairs.map((p) => p.ticker.slice(0, TICKER_MAX)),
          pairs.map((p) => p.source), pairs.map((p) => p.text), pairs.map((p) => p.picture), pairs.map((p) => p.seen ?? null), pairs.map((p) => p.postedAtMs),
        ],
      );
      return Number(rows[0]?.n ?? 0);
    } catch (e) {
      if (missingTable(e)) return 0;
      throw e;
    }
  }

  /**
   * Example posts with no vector yet that the runner's own vectors already cover (0074's kept
   * post vectors, 0069's label vectors — the same space and input), copied over for free. The number copied.
   */
  async copyKnownVectors(space: string): Promise<number> {
    try {
      const rows = await this.#db.query<{ n: string }>(
        `with ins as (
           insert into internal.name_example_embedding (item_id, space, embedding)
           select distinct on (e.item_id) e.item_id, $1, coalesce(p.embedding, l.embedding)
             from internal.name_example e
             left join internal.post_embedding p on p.item_id = e.item_id and p.space = $1
             left join internal.label_embedding l on l.item_id = e.item_id and l.space = $1
            where coalesce(p.embedding, l.embedding) is not null
              and not exists (select 1 from internal.name_example_embedding v where v.item_id = e.item_id and v.space = $1)
           on conflict do nothing returning 1)
         select count(*)::text as n from ins`,
        [space],
      );
      return Number(rows[0]?.n ?? 0);
    } catch (e) {
      if (missingTable(e)) return 0;
      throw e;
    }
  }

  /** Example posts still without a vector: the owner's first, then the newest. */
  async needingVectors(space: string, limit: number): Promise<readonly { readonly itemId: string; readonly text: string; readonly picture: string | null; readonly media: unknown }[]> {
    const rows = await this.#soft(() =>
      this.#db.query<{ item_id: string; text: string; picture: string | null; media: unknown }>(
        `select e.item_id, max(e.text) as text, max(e.picture) as picture, (array_agg(i.media))[1] as media
           from internal.name_example e left join public.item i on i.item_id = e.item_id
          where not exists (select 1 from internal.name_example_embedding v where v.item_id = e.item_id and v.space = $1)
          group by e.item_id
          order by bool_or(e.source = 'owner') desc, max(e.added_at) desc
          limit $2`,
        [space, limit],
      ),
    );
    return rows.map((r) => ({ itemId: r.item_id, text: r.text, picture: r.picture, media: r.media }));
  }

  /** Writes example vectors. False before 0076. */
  async putVectors(rows: readonly { readonly itemId: string; readonly values: ArrayLike<number> }[], space: string): Promise<boolean> {
    const one = [...new Map(rows.map((r) => [r.itemId, r] as const)).values()];
    if (one.length === 0) return true;
    try {
      await this.#db.query(
        `insert into internal.name_example_embedding (item_id, space, embedding)
         select u.item_id, $2, u.v::vector from unnest($1::text[], $3::text[]) as u(item_id, v)
         on conflict (item_id, space) do update set embedding = excluded.embedding, embedded_at = now()`,
        [one.map((r) => r.itemId), space, one.map((r) => `[${Array.from(r.values).join(',')}]`)],
      );
      return true;
    } catch (e) {
      if (missingTable(e)) return false;
      throw e;
    }
  }

  /** What changes whenever an example or a vector is written: read before `all`. '' before 0076. */
  async version(space: string): Promise<string> {
    const rows = await this.#soft(() =>
      this.#db.query<{ v: string }>(
        `select (select count(*) from internal.name_example)::text || '|' || coalesce((select max(added_at)::text from internal.name_example), '') || '|' ||
                (select count(*) from internal.name_example_embedding where space = $1)::text as v`,
        [space],
      ),
    );
    return rows[0]?.v ?? '';
  }

  /** These posts' kept vectors (0074), the ones their precedents were found with; absent when not kept. */
  async postVectors(itemIds: readonly string[], space: string): Promise<ReadonlyMap<string, Float32Array>> {
    if (itemIds.length === 0) return new Map();
    const rows = await this.#soft(() =>
      this.#db.query<{ item_id: string; embedding: unknown }>('select item_id, embedding::text as embedding from internal.post_embedding where space = $1 and item_id = any($2::text[])', [space, [...itemIds]]),
    );
    return new Map(rows.map((r) => [r.item_id, parseVector(r.embedding)] as const));
  }

  /** Every example post with a vector in `space`, all its coin names; empty before 0076. */
  async all(space: string): Promise<readonly StoredExample[]> {
    const rows = await this.#soft(() =>
      this.#db.query<{ item_id: string; text: string; seen: string | null; coins: { name: string; ticker: string }[]; posted_at: Date | null; embedding: unknown }>(
        `select e.item_id, max(e.text) as text, max(e.seen) as seen,
                jsonb_agg(jsonb_build_object('name', e.name, 'ticker', e.ticker) order by e.added_at, e.name) as coins,
                min(e.posted_at) as posted_at, v.embedding::text as embedding
           from internal.name_example e
           join internal.name_example_embedding v on v.item_id = e.item_id and v.space = $1
          group by e.item_id, v.embedding`,
        [space],
      ),
    );
    return rows.map((r) => ({ itemId: r.item_id, text: r.text, seen: r.seen, coins: r.coins, postedAtMs: ms(r.posted_at), values: parseVector(r.embedding) }));
  }
}

/**
 * The namer's guesses (0076): what it is asked about, what it answered, and — for coin matching
 * and the Create sheet — each post's guesses, best first.
 */
export class PgNameGuessRepo {
  readonly #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Posts the judge said yes to inside the last `windowMs`, newest first, with no guess under
   * `promptId` yet: each with its newest answer and kind label, for the caller to hold to the
   * feed's bar (core `postScoreReason`). With `feedOnly`, only posts on a feed now. Empty before 0076.
   */
  async candidates(windowMs: number, limit: number, promptId: string, kindPrefix: string, feedOnly: boolean): Promise<readonly NameCandidate[]> {
    try {
      const rows = await this.#db.query<{ item_id: string; body: string | null; media: unknown; coinable: boolean; confidence: number; looked_at: string; proposed_name: string | null; kind: string | null; posted_at: Date | null }>(
        `with a as (
           select distinct on (item_id) item_id, coinable, confidence, looked_at, proposed_name, judged_at
             from internal.post_judgement
            where judged_at > now() - make_interval(secs => $1::float8 / 1000) and prompt_id not like $4 || '%'
            order by item_id, judged_at desc, id desc),
         k as (
           select distinct on (item_id) item_id, proposed_name as kind
             from internal.post_judgement
            where judged_at > now() - make_interval(secs => $1::float8 / 1000) and prompt_id like $4 || '%'
            order by item_id, judged_at desc, id desc)
         select a.item_id, i.body, i.media, a.coinable, a.confidence, a.looked_at, a.proposed_name, k.kind, i.posted_at
           from a join public.item i on i.item_id = a.item_id
           left join k on k.item_id = a.item_id
          where a.coinable
            and not exists (select 1 from internal.name_guess g where g.item_id = a.item_id and g.prompt_id = $3)
            and (not $5::boolean or exists (select 1 from public.rising_row r where r.item_id = a.item_id))
          order by a.judged_at desc
          limit $2`,
        [windowMs, limit, promptId, kindPrefix, feedOnly],
      );
      return rows.map((r) => ({ itemId: r.item_id, text: r.body ?? '', media: r.media, coinable: r.coinable, confidence: Number(r.confidence), lookedAt: r.looked_at, proposedName: r.proposed_name, kind: r.kind, postedAtMs: ms(r.posted_at) }));
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
  }

  /** Replaces a post's guesses. False before 0076. */
  async put(itemId: string, guesses: readonly { readonly name: string; readonly ticker: string }[], seen: string | null, model: string, promptId: string): Promise<boolean> {
    try {
      await this.#db.query('delete from internal.name_guess where item_id = $1', [itemId]);
      if (guesses.length === 0) return true;
      await this.#db.query(
        `insert into internal.name_guess (item_id, rank, name, ticker, seen, model, prompt_id)
         select $1, u.rank - 1, u.name, u.ticker, $4, $5, $6 from unnest($2::text[], $3::text[]) with ordinality as u(name, ticker, rank)`,
        [itemId, guesses.map((g) => g.name.slice(0, NAME_MAX)), guesses.map((g) => g.ticker), seen, model, promptId],
      );
      return true;
    } catch (e) {
      if (missingTable(e)) return false;
      throw e;
    }
  }

  /**
   * ★ THE INTERFACE FOR COIN MATCHING AND THE CREATE SHEET: each post's guesses, best first (at
   * most the policy's `guesses`). A post with none is absent — not asked yet, or switched off —
   * and the caller searches with the judge's names alone. Empty before 0076.
   */
  async top(itemIds: readonly string[]): Promise<ReadonlyMap<string, readonly { readonly name: string; readonly ticker: string }[]>> {
    const out = new Map<string, { name: string; ticker: string }[]>();
    if (itemIds.length === 0) return out;
    try {
      const rows = await this.#db.query<{ item_id: string; name: string; ticker: string }>(
        'select item_id, name, ticker from internal.name_guess where item_id = any($1::text[]) order by item_id, rank',
        [[...itemIds]],
      );
      for (const r of rows) {
        const list = out.get(r.item_id) ?? [];
        list.push({ name: r.name, ticker: r.ticker });
        out.set(r.item_id, list);
      }
      return out;
    } catch (e) {
      if (missingTable(e)) return out;
      throw e;
    }
  }
}
