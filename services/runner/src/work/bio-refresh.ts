/**
 * POSTERS' PROFILES, READ AGAIN WHILE THEIR POST'S COIN MAY STILL COME (the owner, 2026-10-14:
 * "will it update if ca is added later to bio and would we receive notification that it matched
 * later").
 *
 * A creator puts the coin's address in their profile after the launch, hours after the post. Every
 * read of a post already stores its poster's profile (store/src/repo/authors.ts, 0080), but a
 * poster we do not happen to read again is never seen adding it. So for every poster of a post on
 * For You, Popular or someone's watch list, posted within `postCoin.bio.refreshForMs`, whose newest
 * profile reading is older than `refreshEveryMs`, one of their posts is read again by id — the
 * account comes with the post, as in post-refill.ts — and the profile stored. Watched posts first.
 *
 * What happens next is not this file's: the projector's next frame weighs the post again
 * (services/project post-match.ts), the profile now names the coin, the rule proves it (core
 * match/post-coin.ts (4)), and the notifier pushes it as it pushes any coin that becomes proven
 * later — "Coin links this post" on For You, "Watchlist: coin found" for a watched post, each once
 * per post and coin (services/notify pipeline.ts, watch.ts).
 *
 * ★ A PAID READ, OFF UNTIL THE OWNER SAYS. `refreshOn` is false in the policy; and only a source
 * whose re-read quotes at most `refreshMaxUsdPerPost` a post is asked, so a source billed by the run
 * is left out unless the owner raises that bar. On the live posts line, capped per pass and per UTC
 * day; the day's count is this process's (a restart forgets it).
 *
 * What breaks if changed carelessly: the profile reading's own time is what spaces the reads, so a
 * poster whose read failed is asked again next pass; a poster whose source returns no profile at
 * all would be asked every pass — `refreshEveryMs` from the last ask, kept in memory, stops that.
 * Before 0080 the query fails on the missing table and the step does nothing.
 */

import type { Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { PlatformRegistry } from '@insidor/platform-registry';
import type { Db, PgAuthorRepo } from '@insidor/store';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';

const DAY_MS = 86_400_000;

export interface BioRefreshDeps {
  readonly db: Db;
  readonly platforms: Pick<PlatformRegistry, 'all'>;
  readonly authors: Pick<PgAuthorRepo, 'upsert'>;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
  /** Sources the owner allowed this re-read for (runner env BIO_REFRESH_SOURCES); unset or empty asks nobody. */
  readonly onlySources?: readonly string[] | undefined;
}

export interface BioRefreshResult {
  readonly due: number;
  readonly asked: number;
  /** Accounts stored again with the profile the re-read showed. */
  readonly read: number;
  readonly wouldSpendUsd: number;
  readonly spentUsd: number;
}

/** Each account's last ask, and the day's reads. */
export interface BioRefreshMemory {
  readonly asked: Map<string, number>;
  day: number;
  readToday: number;
}

export const bioRefreshMemory = (): BioRefreshMemory => ({ asked: new Map(), day: -1, readToday: 0 });

export interface DuePoster {
  readonly authorKey: string;
  readonly source: string;
  readonly sourceItemId: string;
  readonly watched: boolean;
}

/** Posters owed a profile read: on a feed or watched, posted inside the window, profile older than the cadence. */
export async function duePosters(db: Db, sources: readonly string[], now: number, forMs: number, everyMs: number, limit: number): Promise<readonly DuePoster[]> {
  let watched: readonly string[] = [];
  try {
    watched = (await db.query<{ item_id: string }>(`select distinct item_id from people.post_watch`)).map((r) => r.item_id);
  } catch {
    /* The runner's credential may not reach the watch list: the feeds alone, then. */
  }
  const rows = await db.query<{ author_key: string; source: string; source_item_id: string; watched: boolean }>(
    `with shown as (
       select item_id from public.rising_row
       union select item_id from public.feed_post where withdrawn_at is null
       union select unnest($5::text[])
     ), latest as (
       select distinct on (i.author_key) i.author_key, i.source, i.source_item_id, i.item_id = any($5::text[]) as watched
         from shown s join public.item i on i.item_id = s.item_id
        where i.source = any($1::text[])
          and coalesce(i.posted_at, i.first_seen_at) > $2::timestamptz - make_interval(secs => $3::double precision / 1000)
        order by i.author_key, coalesce(i.posted_at, i.first_seen_at) desc
     )
     select l.* from latest l
      where not exists (select 1 from internal.author_bio_reading b
                         where b.author_key = l.author_key
                           and b.last_read_at > $2::timestamptz - make_interval(secs => $4::double precision / 1000))
      order by l.watched desc
      limit $6`,
    [[...sources], new Date(now).toISOString(), forMs, everyMs, [...watched], limit],
  );
  return rows.map((r) => ({ authorKey: r.author_key, source: r.source, sourceItemId: r.source_item_id, watched: r.watched }));
}

export async function refreshBios(deps: BioRefreshDeps, memory: BioRefreshMemory): Promise<BioRefreshResult> {
  const now = deps.now();
  const b = deps.policy.postCoin.bio;
  const none: BioRefreshResult = { due: 0, asked: 0, read: 0, wouldSpendUsd: 0, spentUsd: 0 };
  if (!b.refreshOn) return none;
  const day = Math.floor(now / DAY_MS);
  if (memory.day !== day) {
    memory.day = day;
    memory.readToday = 0;
  }
  const room = Math.min(b.refreshPerPass, b.refreshPerDay - memory.readToday);
  if (room <= 0) return none;
  /* Only a source whose one-post re-read is cheap enough (see the header). */
  const readers = new Map(
    deps.platforms.all().flatMap((p) => {
      if (p.lookup === undefined) return [];
      if (!(deps.onlySources ?? []).includes(String(p.id))) return [];
      const n = p.capabilities.observeBatchSize ?? 1;
      const perPost = p.estimate({ kind: 'observe', sourceItemIds: Array.from({ length: n }, (_, i) => String(i)) }).usd / n;
      return perPost <= b.refreshMaxUsdPerPost ? [[String(p.id), p] as const] : [];
    }),
  );
  if (readers.size === 0) return none;

  let due: readonly DuePoster[];
  try {
    due = await duePosters(deps.db, [...readers.keys()], now, b.refreshForMs, b.refreshEveryMs, room + memory.asked.size);
  } catch (e) {
    deps.log.warn('posters owed a profile read could not be listed; tried again next pass', { err: errorText(e) });
    return none;
  }
  const queue = due.filter((d) => now - (memory.asked.get(d.authorKey) ?? -Infinity) >= b.refreshEveryMs).slice(0, room);
  if (queue.length === 0) return none;

  let asked = 0;
  let read = 0;
  let wouldSpendUsd = 0;
  let spentUsd = 0;
  for (const [source, adapter] of readers) {
    const posts = queue.filter((d) => d.source === source);
    if (posts.length === 0) continue;
    const estimate = adapter.estimate({ kind: 'observe', sourceItemIds: posts.map((p) => p.sourceItemId) });
    if (!deps.meter.mayspend(estimate.vendor, estimate.usd)) {
      deps.log.warn('profile reads paused for budget; they wait', { posters: posts.length });
      continue;
    }
    if (deps.mode === 'dry') {
      wouldSpendUsd += estimate.usd;
      continue;
    }
    for (const p of posts) memory.asked.set(p.authorKey, now);
    memory.readToday += posts.length;
    asked += posts.length;
    try {
      const line = deps.meter.line(estimate.vendor);
      const result = await adapter.lookup!(
        posts.map((p) => p.sourceItemId),
        { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: (now + DAY_MS) as Millis },
      );
      spentUsd += result.spend.usd;
      const wanted = new Set(posts.map((p) => p.authorKey));
      const accounts = result.value.authors.filter((a) => wanted.has(String(a.authorKey)));
      if (accounts.length > 0) read += await deps.authors.upsert(accounts);
    } catch (e) {
      if (e instanceof BudgetRefused) {
        deps.log.warn('profile reads paused for budget at the vendor edge; they wait', { posters: posts.length });
        continue;
      }
      deps.log.warn('profiles could not be read again; tried again later', { posters: posts.length, err: errorText(e) });
    }
  }
  if (deps.mode === 'dry') deps.log.info('DRY RUN — poster profiles priced, not read', { posters: queue.length, wouldSpendUsd: Number(wouldSpendUsd.toFixed(6)) });
  else deps.log.info('poster profiles read again', { asked, read, today: memory.readToday, usd: Number(spentUsd.toFixed(6)) });
  return { due: queue.length, asked, read, wouldSpendUsd, spentUsd };
}
