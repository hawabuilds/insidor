/**
 * THE OWNER'S MISSED POSTS, WORKED: each pasted link read once on the learning book, kept as a
 * "yes" example, diagnosed, and checked for a coin of its name (0055).
 *
 * Its own step, run by its own loop (loops/missed.ts) every half minute, because the social
 * service that takes the paste holds no source keys — the runner does. The social service writes
 * `queued` rows; this file is the only writer of everything after.
 *
 * ★ READ ONCE, ON THE LEARNING BOOK. A post we already hold is not read again: the diagnosis is
 * about what we had, and it costs nothing. A post we never had is read by id through the source's
 * own `lookup`, on a meter opened for this pass on the learning book (`learn:` endpoints,
 * Policy.budget.learningLines), so the live feed's lines never pay for it. A source whose
 * learning line is $0 cannot be read here at all, and the row says so (`no_line`) rather than
 * borrowing the live line; a line merely spent for today leaves the row queued until tomorrow.
 *
 * ★ STORED AS OBSERVED, NEVER AS FOUND. A post read here goes into public.item like a backfilled
 * post (origin `observed`) but gets no `item_found_by` row, so it never reaches For You through
 * this door, and the diagnosis is taken from what we held BEFORE it was stored.
 *
 * ★ A COIN OF ITS NAME IS LOOKED FOR, NEVER LINKED. Our own coin names first, then the free market
 * searches, by the judge's name for it and any cashtag in its text, keeping coins launched after
 * the post. `coin_address` is set only when exactly one came back — several is a list, not a pick.
 *
 * ★ SAFE BEFORE ITS TABLE EXISTS. A runner deployed before 0055 is applied finds no table, logs it
 * once and does nothing, rather than failing its loop every half minute.
 *
 * What breaks if changed carelessly: a failed read is retried `MAX_ATTEMPTS` times before the row
 * fails as `unreadable`. Failing it on the first outage would lose the owner's paste to a blip;
 * retrying forever would pay for a deleted post every half minute.
 */

import type { Author, Item, Millis } from '@insidor/contracts';
import type { CoinSearch } from '@insidor/contracts/ports/coin-search.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import { diagnoseMissed, missedSuggestion, outageGapMs, outages as outagesOf, type DiscoverySettings, type MissedFailure, type Outage, type SearchKind } from '@insidor/core';
import type { HeldPost, MissedOutcome, NamedCoin, PgMissedPostRepo, QueuedMissedPost } from '@insidor/store';

import { errorText, type Logger } from '../log.ts';

/** Rows taken a pass: one paste's worth and then some. */
const BATCH = 20;
/** Reads of one post tried before its row fails as unreadable. */
export const MAX_ATTEMPTS = 3;
/** How long one source read may take. */
const LOOKUP_DEADLINE_MS = 60_000;
/** Names searched per post, and coins kept per post. */
const MAX_TERMS = 3;
const MAX_COINS = 10;
const MS_PER_DAY = 86_400_000;
/* The reply heuristic tools/recall-check.ts uses: a post opening with a mention is a reply. */
const REPLY_OPENING = /^@\w/;
const TAG = /#([\p{L}\p{N}_]+)/gu;
const CASHTAG = /\$([A-Za-z][A-Za-z0-9]{1,15})\b/g;

export type MissedRepo = Pick<PgMissedPostRepo, 'queued' | 'doneFor' | 'held' | 'facts' | 'coinsNamed' | 'finish' | 'retry' | 'diagnosed' | 'writeSuggestion'>;

/** This pass's sources, metered on the learning book. */
export interface LearningSources {
  readonly sources: readonly PlatformAdapter[];
  readonly meter: Meter;
  readonly close: () => Promise<void>;
}

export interface MissedDeps {
  readonly missed: MissedRepo;
  /** Opens the sources on the learning book; `handles` answers a source addressed by URL. */
  readonly openLearning: (handles: (source: string, sourceItemId: string) => string | null) => Promise<LearningSources>;
  readonly store: (items: readonly Item[], authors: readonly Author[]) => Promise<number>;
  readonly coinSearch: readonly CoinSearch[];
  readonly settings: () => Promise<DiscoverySettings | null>;
  /**
   * When the catch-all search was not running (core/src/learning/outage.ts), so a post made in an
   * outage is told so rather than "unexplained". Absent or failing: the diagnosis says nothing of outages.
   */
  readonly outages?: () => Promise<readonly Outage[] | null>;
  /** The floor search's live spend in the last day, for the suggestion's cost; null when unread. */
  readonly searchUsdPerDay: () => Promise<number | null>;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface MissedResult {
  readonly done: number;
  readonly failed: number;
  /** Left queued: spending off, a line spent for today, or a read to try again. */
  readonly waiting: number;
  readonly usd: number;
}

interface Parsed {
  readonly row: QueuedMissedPost;
  readonly adapter: PlatformAdapter;
  readonly sourceItemId: string;
}

const searchOf = (a: PlatformAdapter): SearchKind => (a.capabilities.discovery.includes('catchall') ? 'floor' : 'watch');
const tagsOf = (text: string): string[] => [...new Set([...text.matchAll(TAG)].map((m) => (m[1] ?? '').toLowerCase()).filter((t) => t !== ''))];

function failure(diagnosis: MissedFailure, detail: Record<string, unknown>, p: Partial<Pick<MissedOutcome, 'source' | 'sourceItemId' | 'postedAt'>> = {}): MissedOutcome {
  return { source: p.source ?? null, sourceItemId: p.sourceItemId ?? null, itemId: null, postedAt: p.postedAt ?? null, diagnosis, detail, coins: [], coinAddress: null, firstCoinAt: null, usd: 0 };
}

/** Every coin of the post's name launched after it: ours by name first, then the free searches. */
async function coinsFor(deps: MissedDeps, terms: readonly string[], postedAt: Millis | null): Promise<readonly NamedCoin[]> {
  const byAddress = new Map<string, NamedCoin>();
  for (const c of await deps.missed.coinsNamed(terms, postedAt, MAX_COINS)) byAddress.set(c.address, c);
  for (const term of terms) {
    const answers = await Promise.allSettled(deps.coinSearch.map((s) => s.search(term)));
    for (const a of answers) {
      if (a.status !== 'fulfilled') continue;
      for (const hit of a.value.hits) {
        if (postedAt !== null && (hit.createdAt === null || hit.createdAt < postedAt)) continue;
        if (!byAddress.has(hit.address)) byAddress.set(hit.address, { address: hit.address, name: hit.name, ticker: hit.ticker, launchedAt: hit.createdAt as Millis | null });
      }
    }
  }
  return [...byAddress.values()].sort((a, b) => (a.launchedAt ?? Number.POSITIVE_INFINITY) - (b.launchedAt ?? Number.POSITIVE_INFINITY)).slice(0, MAX_COINS);
}

/** Diagnose one post we now hold, from what we held before the paste. */
async function diagnose(
  deps: MissedDeps,
  parsed: Parsed,
  before: HeldPost | null,
  now: HeldPost,
  settings: DiscoverySettings | null,
  outages: readonly Outage[] | null,
  usd: number,
): Promise<MissedOutcome> {
  const facts = await deps.missed.facts(now.itemId);
  const postedAt = now.postedAt ?? (parsed.adapter.postTimeFromId?.(parsed.sourceItemId) ?? null);
  const names = [facts.judgement?.proposedName ?? null, ...(facts.judgement?.alternateNames ?? []), ...[...now.text.matchAll(CASHTAG)].map((m) => m[1] ?? null)];
  const terms = [...new Set(names.filter((n): n is string => n !== null && n.trim() !== '').map((n) => n.trim()))].slice(0, MAX_TERMS);
  const coins = await coinsFor(deps, terms, postedAt);
  const launches = coins.map((c) => c.launchedAt).filter((t): t is Millis => t !== null);
  const firstCoinAt = launches.length === 0 ? null : (Math.min(...launches) as Millis);
  const d = diagnoseMissed(
    {
      search: searchOf(parsed.adapter),
      postedAtMs: postedAt,
      post: {
        approvals: now.approvals ?? 0,
        lang: now.lang,
        hasMedia: now.hasMedia,
        isReply: REPLY_OPENING.test(now.text.trim()),
        isRebroadcast: now.isRebroadcast,
        tags: tagsOf(now.text),
      },
      held: before === null ? null : { firstSeenAtMs: before.firstSeenAt, foundBy: before.foundBy === null ? null : { lane: before.foundBy.lane, atMs: before.foundBy.at } },
      judgement: facts.judgement === null ? null : { ...facts.judgement, judgedAtMs: facts.judgement.judgedAt },
      reach: facts.reach,
      shownAtMs: facts.shownAt,
      firstCoinAtMs: firstCoinAt,
    },
    { settings, watchTags: deps.policy.feed.hashtags.map((t) => t.toLowerCase()), outages },
    deps.policy,
  );
  return {
    source: parsed.adapter.id,
    sourceItemId: parsed.sourceItemId,
    itemId: now.itemId,
    postedAt,
    diagnosis: d.diagnosis,
    detail: { ...d.detail, terms, approvalsUnread: now.approvals === null },
    coins,
    coinAddress: coins.length === 1 ? (coins[0]?.address ?? null) : null,
    firstCoinAt,
    usd,
  };
}

/** Postgres's "relation does not exist". */
const tableMissing = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42P01';
let warnedMissing = false;

export async function workMissedPosts(deps: MissedDeps): Promise<MissedResult> {
  let rows: readonly QueuedMissedPost[];
  try {
    rows = await deps.missed.queued(BATCH);
  } catch (e) {
    /* Deployed before 0055 is applied: nothing can have been pasted, so there is nothing to do. */
    if (tableMissing(e)) {
      if (!warnedMissing) deps.log.warn('internal.missed_post does not exist yet (0055 not applied); missed posts wait', {});
      warnedMissing = true;
      return { done: 0, failed: 0, waiting: 0, usd: 0 };
    }
    throw e;
  }
  if (rows.length === 0) return { done: 0, failed: 0, waiting: 0, usd: 0 };

  const handles = new Map<string, string>();
  const learning = await deps.openLearning((source, id) => handles.get(`${source}:${id}`) ?? null);
  let done = 0;
  let failed = 0;
  let waiting = 0;
  let usd = 0;
  const finish = async (id: number, o: MissedOutcome) => {
    await deps.missed.finish(id, o, deps.now());
    if (o.itemId === null) failed += 1;
    else done += 1;
  };

  try {
    const settings = await deps.settings().catch((e: unknown) => {
      deps.log.warn('discovery settings could not be measured; never-found reasons are unsure', { err: errorText(e) });
      return null;
    });
    const outages = deps.outages === undefined ? null : await deps.outages().catch((e: unknown) => {
      deps.log.warn('the search pass record could not be read; outages are not named this pass', { err: errorText(e) });
      return null;
    });

    /* 1. Read each link: which source, which post, and drop what cannot be a "yes". */
    const toRead: Parsed[] = [];
    const heldNow: { parsed: Parsed; held: HeldPost }[] = [];
    for (const row of rows) {
      let parsed: Parsed | null = null;
      for (const adapter of learning.sources) {
        const link = adapter.parseLink?.(row.url) ?? null;
        if (link?.kind !== 'post') continue;
        if (link.handle !== undefined) handles.set(`${adapter.id}:${link.sourceItemId}`, link.handle);
        parsed = { row, adapter, sourceItemId: link.sourceItemId };
        break;
      }
      if (parsed === null) {
        await finish(row.id, failure('not_a_post', { why: 'no source we read takes this link as a post' }));
        continue;
      }
      const same = await deps.missed.doneFor(parsed.adapter.id, parsed.sourceItemId);
      if (same !== null) {
        await finish(row.id, failure('duplicate', { sameAs: same }, { source: parsed.adapter.id, sourceItemId: parsed.sourceItemId }));
        continue;
      }
      const held = await deps.missed.held(parsed.adapter.id, parsed.sourceItemId);
      if (held !== null) heldNow.push({ parsed, held });
      else toRead.push(parsed);
    }

    /* 2. Posts we held: diagnosed for nothing. */
    for (const { parsed, held } of heldNow) await finish(parsed.row.id, await diagnose(deps, parsed, held, held, settings, outages, 0));

    /* 3. Posts we never had: read once per source, on the learning book. */
    const bySource = new Map<PlatformAdapter, Parsed[]>();
    for (const p of toRead) bySource.set(p.adapter, [...(bySource.get(p.adapter) ?? []), p]);
    for (const [adapter, list] of bySource) {
      const where = { source: adapter.id };
      if (adapter.lookup === undefined) {
        for (const p of list) await finish(p.row.id, failure('no_source', { why: 'this source cannot read one post by id' }, { source: adapter.id, sourceItemId: p.sourceItemId }));
        continue;
      }
      if (deps.mode === 'dry') {
        deps.log.info('DRY RUN: missed posts wait; reading them spends money', { ...where, posts: list.length });
        waiting += list.length;
        continue;
      }
      const ids = [...new Set(list.map((p) => p.sourceItemId))];
      const estimate = adapter.estimate({ kind: 'observe', sourceItemIds: ids });
      const line = learning.meter.line(estimate.vendor);
      if (line.capUsd <= 0) {
        for (const p of list) await finish(p.row.id, failure('no_line', { why: 'the learning book has no money for this source', vendorLine: 0 }, { source: adapter.id, sourceItemId: p.sourceItemId }));
        continue;
      }
      if (!learning.meter.mayspend(estimate.vendor, estimate.usd)) {
        deps.log.info('missed posts wait: the learning line for this source is spent for today', { ...where, posts: list.length, wouldSpendUsd: estimate.usd });
        waiting += list.length;
        continue;
      }
      try {
        const now = deps.now();
        const result = await adapter.lookup(ids, { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: (now + LOOKUP_DEADLINE_MS) as Millis });
        usd += result.spend.usd;
        const each = ids.length === 0 ? 0 : result.spend.usd / ids.length;
        if (result.value.items.length > 0) await deps.store(result.value.items, result.value.authors);
        const read = new Set(result.value.items.map((i) => i.sourceItemId));
        for (const p of list) {
          const stored = read.has(p.sourceItemId) ? await deps.missed.held(adapter.id, p.sourceItemId) : null;
          if (stored === null) {
            await finish(p.row.id, { ...failure('unreadable', { why: 'the source returned no post for this id: deleted, private or gone' }, { source: adapter.id, sourceItemId: p.sourceItemId }), usd: each });
            continue;
          }
          await finish(p.row.id, await diagnose(deps, p, null, stored, settings, outages, each));
        }
      } catch (e) {
        const err = errorText(e);
        deps.log.error('a missed-post read failed; tried again next pass', { ...where, err });
        for (const p of list) {
          if (p.row.attempts + 1 >= MAX_ATTEMPTS) {
            await finish(p.row.id, failure('unreadable', { why: 'every read failed', error: err.slice(0, 300) }, { source: adapter.id, sourceItemId: p.sourceItemId }));
          } else {
            await deps.missed.retry(p.row.id, err, deps.now());
            waiting += 1;
          }
        }
      }
    }

    /* 4. The suggestion, from every diagnosed row. */
    if (done > 0) await suggest(deps, learning.sources, settings);
  } finally {
    await learning.close();
  }
  if (done + failed > 0) deps.log.info('missed posts worked', { done, failed, waiting, usd });
  return { done, failed, waiting, usd };
}

async function suggest(deps: MissedDeps, sources: readonly PlatformAdapter[], settings: DiscoverySettings | null): Promise<void> {
  const kinds = new Map(sources.map((a) => [String(a.id), searchOf(a)] as const));
  const rows = (await deps.missed.diagnosed()).map((r) => ({ search: kinds.get(r.source ?? '') ?? ('floor' as const), diagnosis: r.diagnosis, detail: r.detail }));
  const floorSource = sources.find((a) => searchOf(a) === 'floor');
  const usdPerPost = floorSource === undefined ? null : floorSource.estimate({ kind: 'observe', sourceItemIds: ['0'] }).usd;
  const searchUsdPerDay = await deps.searchUsdPerDay().catch(() => null);
  const s = missedSuggestion({ rows, settings, searchUsdPerDay, usdPerPost }, deps.policy);
  await deps.missed.writeSuggestion(s.text, s.facts, deps.now());
}

/** When the catch-all search was not running, from the record of its passes. Exported for the wiring and the replay tool. */
export async function readOutages(repo: Pick<PgMissedPostRepo, 'passRecord'>, policy: Policy, nowMs: number): Promise<readonly Outage[]> {
  return outagesOf(await repo.passRecord(outageGapMs(policy)), nowMs, policy);
}

/** The window the suggestion's spend is read over. Exported for the wiring. */
export const SPEND_WINDOW_MS = MS_PER_DAY;
