/**
 * The owner's missed posts (0055), as the runner works them: the queue, the facts each diagnosis
 * is made from, and the outcome. The social service writes the queued rows with its own SQL; this
 * is the pipeline's side.
 *
 * Its own repo, apart from items and judgements, because every read here is a question about ONE
 * post the owner named — what we held of it, when, what the judge said, whether it was shown — and
 * those questions read five schemas' worth of tables that no other repo joins.
 *
 * ★ "SHOWN" IS WHAT WAS RECORDED AS SHOWN. The projection keeps no history (rising rows are
 * rewritten every frame), so the first time a post was on For You or Popular is the notify
 * service's `people.pipeline_seen` row for the `rising` stream — written while that service
 * runs — or now, when the post is on a feed at this moment. A post shown while neither held is
 * not recorded as shown, and the diagnosis then says `unsure` rather than claiming it never was.
 *
 * What breaks if changed carelessly: `reach` reads MEASURED levels only, as the projector does
 * (services/project/src/rising.ts). Counting a censored row's last level would let this file say
 * a post cleared the bar that the feed itself never saw clear.
 */

import type { Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { toMillis, toTimestamp } from '../rows.ts';

export interface QueuedMissedPost {
  readonly id: number;
  readonly url: string;
  readonly ownerRef: string;
  readonly attempts: number;
  readonly addedAt: Millis;
}

/** What we held of one post, read before anything of this paste was stored. */
export interface HeldPost {
  readonly itemId: string;
  readonly firstSeenAt: Millis;
  readonly postedAt: Millis | null;
  /** The catch-all lane that found it, and when; null when we held it by another route. */
  readonly foundBy: { readonly lane: string; readonly at: Millis } | null;
  /** The post as we last read it: what the recall model asks of it. */
  readonly lang: string | null;
  readonly text: string;
  readonly hasMedia: boolean;
  readonly isRebroadcast: boolean;
  /** Approvals at the newest reading; null when the source gave none. */
  readonly approvals: number | null;
}

export interface MissedJudgement {
  readonly coinable: boolean;
  readonly confidence: number;
  readonly lookedAt: 'text' | 'videoFrame';
  readonly proposedName: string | null;
  readonly alternateNames: readonly string[];
  readonly judgedAt: Millis;
}

export interface MissedPostFacts {
  readonly judgement: MissedJudgement | null;
  /** Measured view readings, oldest first. */
  readonly reach: readonly { readonly atMs: number; readonly reach: number }[];
  /** First recorded on For You or Popular; null when never recorded there. */
  readonly shownAt: Millis | null;
}

export interface NamedCoin {
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly launchedAt: Millis | null;
}

export interface MissedOutcome {
  readonly source: string | null;
  readonly sourceItemId: string | null;
  readonly itemId: string | null;
  readonly postedAt: Millis | null;
  readonly diagnosis: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly coins: readonly NamedCoin[];
  readonly coinAddress: string | null;
  readonly firstCoinAt: Millis | null;
  readonly usd: number;
}

export interface MissedRow {
  readonly id: number;
  readonly url: string;
  readonly addedAt: Millis;
  readonly status: 'queued' | 'done' | 'failed';
  readonly source: string | null;
  readonly diagnosis: string | null;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly coins: readonly unknown[];
  readonly usd: number;
  readonly checkedAt: Millis | null;
}

export class PgMissedPostRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Whether anything waits: the one query a quiet pass makes. */
  async anyQueued(): Promise<boolean> {
    const rows = await this.#db.query(`select 1 from internal.missed_post where status = 'queued' limit 1`);
    return rows.length > 0;
  }

  /** The oldest queued rows first. */
  async queued(limit: number): Promise<readonly QueuedMissedPost[]> {
    const rows = await this.#db.query<{ id: string; url: string; owner_ref: string; attempts: number; added_at: Date }>(
      `select id::text, url, owner_ref, attempts, added_at from internal.missed_post
        where status = 'queued' order by added_at asc, id asc limit $1`,
      [limit],
    );
    return rows.map((r) => ({ id: Number(r.id), url: r.url, ownerRef: r.owner_ref, attempts: r.attempts, addedAt: toMillis(r.added_at) as Millis }));
  }

  /** Another row already holding this post as a "yes", or null. */
  async doneFor(source: string, sourceItemId: string): Promise<number | null> {
    const rows = await this.#db.query<{ id: string }>(
      `select id::text from internal.missed_post where source = $1 and source_item_id = $2 and status = 'done' limit 1`,
      [source, sourceItemId],
    );
    return rows[0] === undefined ? null : Number(rows[0].id);
  }

  async held(source: string, sourceItemId: string): Promise<HeldPost | null> {
    const rows = await this.#db.query<{ item_id: string; first_seen_at: Date; posted_at: Date | null; lane: string | null; found_at: Date | null; lang: string | null; body: string; media: number; rebroadcast: boolean; approvals: number | null }>(
      `select i.item_id, i.first_seen_at, i.posted_at, f.lane, f.found_at, i.lang, i.body,
              jsonb_array_length(i.media) as media, i.rebroadcast_of is not null as rebroadcast,
              (i.counters #>> '{approval,value}')::float8 as approvals
         from public.item i left join internal.item_found_by f on f.item_id = i.item_id
        where i.source = $1 and i.source_item_id = $2 and i.origin = 'observed'`,
      [source, sourceItemId],
    );
    const r = rows[0];
    if (r === undefined) return null;
    return {
      itemId: r.item_id,
      firstSeenAt: toMillis(r.first_seen_at) as Millis,
      postedAt: toMillis(r.posted_at),
      foundBy: r.lane === null || r.found_at === null ? null : { lane: r.lane, at: toMillis(r.found_at) as Millis },
      lang: r.lang,
      text: r.body,
      hasMedia: Number(r.media) > 0,
      isRebroadcast: r.rebroadcast,
      approvals: r.approvals === null ? null : Number(r.approvals),
    };
  }

  /** The judge's latest answer, the measured views, and when it was first recorded as shown. */
  async facts(itemId: string): Promise<MissedPostFacts> {
    const judged = await this.#db.query<{ coinable: boolean; confidence: number; looked_at: 'text' | 'videoFrame'; proposed_name: string | null; alternate_names: unknown; judged_at: Date }>(
      `select coinable, confidence, looked_at, proposed_name, alternate_names, judged_at from internal.post_judgement
        where item_id = $1 order by judged_at desc, id desc limit 1`,
      [itemId],
    );
    const reach = await this.#db.query<{ captured_at: Date; level: number }>(
      `select captured_at, rate_level::float8 as level from public.observation
        where item_id = $1 and kind = 'reach' and rate_per_min is not null and rate_level is not null
        order by captured_at asc`,
      [itemId],
    );
    const shown = await this.#db.query<{ at: Date | null }>(
      `select least(
                (select seen_at from people.pipeline_seen where stream = 'rising' and key = $1),
                (select case when exists (select 1 from public.rising_row where item_id = $1) then now() end)
              ) as at`,
      [itemId],
    );
    const j = judged[0];
    return {
      judgement:
        j === undefined
          ? null
          : {
              coinable: j.coinable,
              confidence: Number(j.confidence),
              lookedAt: j.looked_at,
              proposedName: j.proposed_name,
              alternateNames: Array.isArray(j.alternate_names) ? j.alternate_names.filter((n): n is string => typeof n === 'string') : [],
              judgedAt: toMillis(j.judged_at) as Millis,
            },
      reach: reach.map((r) => ({ atMs: toMillis(r.captured_at) as number, reach: Number(r.level) })),
      shownAt: toMillis(shown[0]?.at ?? null),
    };
  }

  /** Coins we hold by one of these names or tickers, launched at or after `launchedFrom`. Free: our own table. */
  async coinsNamed(terms: readonly string[], launchedFrom: Millis | null, limit: number): Promise<readonly NamedCoin[]> {
    if (terms.length === 0) return [];
    const rows = await this.#db.query<{ address: string; name: string | null; ticker: string | null; launched_at: Date | null }>(
      `select address, name, ticker, launched_at from public.coin_name
        where (lower(name) = any($1::text[]) or upper(ticker) = any($2::text[]))
          and ($3::timestamptz is null or launched_at >= $3)
        order by launched_at asc nulls last limit $4`,
      [terms.map((t) => t.toLowerCase()), terms.map((t) => t.toUpperCase()), toTimestamp(launchedFrom), limit],
    );
    return rows.map((r) => ({ address: r.address, name: r.name, ticker: r.ticker, launchedAt: toMillis(r.launched_at) }));
  }

  /**
   * When the catch-all lanes STORED posts (internal.item_found_by), as core's outage check reads it
   * (core/src/learning/outage.ts): the first and last, and every gap over `minGapMs`. Stored, not
   * paid: a search whose posts never reached the database found nothing we could show. The watch
   * lane runs on its own hourly cadence and is left out, or its quiet hours would read as outages.
   */
  async passRecord(minGapMs: number): Promise<{ readonly firstMs: number | null; readonly lastMs: number | null; readonly gaps: readonly { readonly fromMs: number; readonly toMs: number }[] }> {
    const ends = await this.#db.query<{ first: Date | null; last: Date | null }>(
      `select min(found_at) as first, max(found_at) as last from internal.item_found_by where lane in ('all', 'media', 'slow')`,
    );
    const gaps = await this.#db.query<{ from_at: Date; to_at: Date }>(
      `select prev as from_at, found_at as to_at from (
         select found_at, lag(found_at) over (order by found_at) as prev
           from internal.item_found_by where lane in ('all', 'media', 'slow')) t
        where prev is not null and found_at - prev > make_interval(secs => $1::float8 / 1000)
        order by prev`,
      [minGapMs],
    );
    return {
      firstMs: toMillis(ends[0]?.first ?? null),
      lastMs: toMillis(ends[0]?.last ?? null),
      gaps: gaps.map((g) => ({ fromMs: toMillis(g.from_at) as number, toMs: toMillis(g.to_at) as number })),
    };
  }

  /** What the catch-all search cost on the live book in the day before `now`, for the suggestion's price. */
  async liveSpendSince(vendor: string, endpoint: string, sinceMs: Millis): Promise<number> {
    const rows = await this.#db.query<{ usd: string | null }>(
      `select sum(usd)::text as usd from internal.spend where vendor = $1 and endpoint = $2 and at >= $3`,
      [vendor, endpoint, toTimestamp(sinceMs)],
    );
    return Number(rows[0]?.usd ?? 0);
  }

  async finish(id: number, o: MissedOutcome, at: Millis): Promise<void> {
    const failed = o.itemId === null;
    await this.#db.query(
      `update internal.missed_post
          set status = $2, source = $3, source_item_id = $4, item_id = $5, posted_at = $6, diagnosis = $7,
              diagnosis_detail = $8::jsonb, coins = $9::jsonb, coin_address = $10, first_coin_at = $11,
              usd = $12, checked_at = $13, attempts = attempts + 1, last_error = null
        where id = $1`,
      [
        id,
        failed ? 'failed' : 'done',
        o.source,
        o.sourceItemId,
        o.itemId,
        toTimestamp(o.postedAt),
        o.diagnosis,
        JSON.stringify(o.detail),
        JSON.stringify(o.coins.map((c) => ({ ...c, launchedAt: c.launchedAt === null ? null : new Date(c.launchedAt).toISOString() }))),
        o.coinAddress,
        toTimestamp(o.firstCoinAt),
        o.usd,
        toTimestamp(at),
      ],
    );
  }

  /** A read that may pass later: counted, kept queued, with what went wrong. */
  async retry(id: number, error: string, at: Millis): Promise<void> {
    await this.#db.query(`update internal.missed_post set attempts = attempts + 1, last_error = $2, checked_at = $3 where id = $1`, [id, error.slice(0, 500), toTimestamp(at)]);
  }

  /** Every diagnosed row, for the suggestion. */
  async diagnosed(): Promise<readonly { readonly source: string | null; readonly diagnosis: string; readonly detail: Readonly<Record<string, unknown>> }[]> {
    const rows = await this.#db.query<{ source: string | null; diagnosis: string; diagnosis_detail: Record<string, unknown> }>(
      `select source, diagnosis, diagnosis_detail from internal.missed_post where status = 'done'`,
    );
    return rows.map((r) => ({ source: r.source, diagnosis: r.diagnosis, detail: r.diagnosis_detail }));
  }

  async writeSuggestion(text: string | null, facts: Readonly<Record<string, unknown>>, at: Millis): Promise<void> {
    await this.#db.query(
      `insert into internal.missed_post_suggestion (id, text, facts, computed_at) values (1, $1, $2::jsonb, $3)
       on conflict (id) do update set text = excluded.text, facts = excluded.facts, computed_at = excluded.computed_at`,
      [text, JSON.stringify(facts), toTimestamp(at)],
    );
  }

  async suggestion(): Promise<{ readonly text: string | null; readonly facts: Readonly<Record<string, unknown>>; readonly computedAt: Millis } | null> {
    const rows = await this.#db.query<{ text: string | null; facts: Record<string, unknown>; computed_at: Date }>(`select text, facts, computed_at from internal.missed_post_suggestion where id = 1`);
    const r = rows[0];
    return r === undefined ? null : { text: r.text, facts: r.facts, computedAt: toMillis(r.computed_at) as Millis };
  }

  /** Newest first, for the report tool. */
  async list(limit: number): Promise<readonly MissedRow[]> {
    const rows = await this.#db.query<{ id: string; url: string; added_at: Date; status: MissedRow['status']; source: string | null; diagnosis: string | null; diagnosis_detail: Record<string, unknown>; coins: unknown[]; usd: string; checked_at: Date | null }>(
      `select id::text, url, added_at, status, source, diagnosis, diagnosis_detail, coins, usd::text, checked_at
         from internal.missed_post order by added_at desc, id desc limit $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      url: r.url,
      addedAt: toMillis(r.added_at) as Millis,
      status: r.status,
      source: r.source,
      diagnosis: r.diagnosis,
      detail: r.diagnosis_detail,
      coins: r.coins,
      usd: Number(r.usd),
      checkedAt: toMillis(r.checked_at),
    }));
  }
}
