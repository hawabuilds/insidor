/**
 * THE ACCOUNT WATCH (`feed.accountWatch`): the newest posts of the text source's accounts whose posts
 * get coined again and again, asked many accounts to a search every few minutes, the posts credited
 * to the 'account' lane (0115) so they are judged and may reach For You.
 *
 * Why it exists: the catch-all searches ask "every post over a like floor in a window", and a big
 * account's post clears every floor — yet replayed on a week of coined posts, the ones by accounts
 * coined before were found a median of hours after posting, often only through the coin's own link,
 * while their coins came within minutes. Asking those accounts by name finds such a post within one
 * cadence of its posting, whatever the floors and languages are doing.
 *
 * ★ MANY ACCOUNTS TO A SEARCH (`accountsPerAsk`): the text source bills a request one post even when
 * it returns nothing, so an account asked alone every three minutes is 480 billed empties a day; in a
 * group of fifteen the group pays one, and a busy ask pays what it returns. The adapter renders the
 * group and refuses a page carrying anyone else's post (adapters/platform/x/src/discover.ts).
 *
 * ★ EACH GROUP'S ORDER TURNS EVERY ASK (`turnedGroups`): the same supplier once answered an OR of
 * languages with its last member only, silently. If it did that to an OR of accounts, a fixed order
 * would watch one account per group forever; turned, every account is last in its turn, so the
 * watch degrades to slower instead of blind, and the pass log's `lastShare` (the share of answered
 * posts by the group's last account) near 1 says so.
 *
 * ★ FORWARD ONLY, PER ACCOUNT. Each account's next ask starts where its last answered ask began, or
 * one `everyMs` back on its first, never more than `maxWindowMs` back (a restart, a failed ask); kept
 * in this process. A group asks from the oldest start of its accounts, so a regrouped list (the
 * list is re-read every `listEveryMs`) never skips an account's minutes.
 *
 * What breaks if changed carelessly: moving an account's start before its ask answered skips those
 * minutes for good after a failure; a pass that keeps asking after `capped` or `budget` spends past
 * the lane's day.
 */

import type { Author, Item, Millis } from '@insidor/contracts';
import type { DiscoveryQuery, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { WatchAccount } from '@insidor/store';

import { errorText } from '../log.ts';
import type { FoundLane } from './arrivals.ts';
import { laneSearch, type LaneAskEnd, type LaneSearchDeps } from './lane-search.ts';

type WatchPolicy = Policy['feed']['accountWatch'];

export interface AccountWatchDeps extends LaneSearchDeps {
  readonly sources: () => readonly PlatformAdapter[];
  readonly accounts: {
    coinedAccounts(args: {
      readonly source: string;
      readonly minReach: number;
      readonly minPosts: number;
      readonly coinedSinceMs: number;
      readonly coinWithinMs: number;
      readonly limit: number;
    }): Promise<readonly WatchAccount[]>;
  };
  readonly policy: Policy;
}

/** What the watch keeps between passes, in this process. */
export interface AccountWatchState {
  /** Where each account's last answered ask began, by handle in lower case. */
  readonly since: Map<string, number>;
  /** The list as last read, and when. */
  list: { readonly at: number; readonly handles: readonly string[] } | null;
}

export const accountWatchState = (): AccountWatchState => ({ since: new Map(), list: null });

export interface AccountWatchResult {
  readonly accounts: number;
  readonly groups: number;
  readonly asked: number;
  readonly returned: number;
  readonly fresh: number;
  readonly usd: number;
  /** Of the posts stored, the share by the account asked last in its group; null when none came back. */
  readonly lastShare: number | null;
  readonly stopped: LaneAskEnd | null;
}

const NONE: AccountWatchResult = { accounts: 0, groups: 0, asked: 0, returned: 0, fresh: 0, usd: 0, lastShare: null, stopped: null };

/** The ends that stop the whole pass, not just one group's ask. */
const PASS_ENDS: ReadonlySet<LaneAskEnd> = new Set(['capped', 'unreadable', 'budget', 'deadline', 'dry']);

/**
 * The list cut into groups of `perAsk`, in list order, each group turned by the ask's slot of the
 * clock so a different account is last on every ask. Pure; from the clock, like the watch words'
 * rotation (discover.ts `watchTermsFor`), so a restart neither repeats nor skips a turn.
 */
export function turnedGroups(handles: readonly string[], perAsk: number, everyMs: number, now: number): readonly (readonly string[])[] {
  const size = Math.max(1, Math.trunc(perAsk));
  const slot = Math.floor(now / Math.max(1, everyMs));
  const groups: string[][] = [];
  for (let k = 0; k < handles.length; k += size) {
    const g = handles.slice(k, k + size);
    const turn = slot % g.length;
    groups.push([...g.slice(turn), ...g.slice(0, turn)]);
  }
  return groups;
}

/** Where a group's ask starts: the oldest start of its accounts, never before `maxWindowMs` back. Pure. */
export function groupSince(group: readonly string[], since: ReadonlyMap<string, number>, now: number, p: WatchPolicy): number {
  const floor = now - p.maxWindowMs;
  const starts = group.map((h) => since.get(h.toLowerCase()) ?? now - p.everyMs);
  return Math.max(floor, Math.min(...starts));
}

/** The text source: it can ask an account and run the catch-all; the short-video source asks accounts too, but has no catch-all. */
const watchSource = (sources: readonly PlatformAdapter[]): PlatformAdapter | undefined =>
  sources.find((a) => a.capabilities.discovery.includes('account') && a.capabilities.discovery.includes('catchall'));

export async function accountWatchPass(deps: AccountWatchDeps, state: AccountWatchState): Promise<AccountWatchResult> {
  const p = deps.policy.feed.accountWatch;
  if (!p.on) return NONE;
  const source = watchSource(deps.sources());
  if (source === undefined) {
    deps.log.info('account watch skipped: no source asks accounts beside a catch-all search');
    return NONE;
  }
  const started = deps.now();
  const deadline = (started + p.passDeadlineMs) as Millis;

  if (state.list === null || started - state.list.at >= p.listEveryMs) {
    try {
      const rows = await deps.accounts.coinedAccounts({
        source: String(source.id),
        minReach: p.minReach,
        minPosts: p.minCoinedPosts,
        coinedSinceMs: started - p.lookbackMs,
        coinWithinMs: p.coinWithinMs,
        limit: p.maxAccounts,
      });
      state.list = { at: started, handles: rows.map((r) => r.handle) };
      deps.log.info('account watch list read', { accounts: rows.length, top: rows.slice(0, 5).map((r) => `${r.handle}:${r.coinedPosts}`) });
    } catch (e) {
      /* The last list stands; with none yet, nothing is asked this pass. */
      deps.log.warn('the account watch list could not be read; the last one stands', { err: errorText(e), held: state.list?.handles.length ?? 0 });
    }
  }
  const handles = state.list?.handles ?? [];
  if (handles.length === 0) return NONE;

  const groups = turnedGroups(handles, p.accountsPerAsk, p.everyMs, started);
  let asked = 0;
  let returned = 0;
  let fresh = 0;
  let usd = 0;
  let byLast = 0;
  let stored = 0;
  let stopped: LaneAskEnd | null = null;
  for (const group of groups) {
    const now = deps.now();
    const last = group[group.length - 1]?.toLowerCase() ?? '';
    const query: DiscoveryQuery = {
      mode: 'account',
      term: group[0] ?? '',
      terms: group,
      sinceMs: groupSince(group, state.since, now, p) as Millis,
      untilMs: null,
      limit: deps.policy.feed.pageLimit,
      cursor: null,
    };
    /* Counts who answered on the way into the store, for `lastShare`; the store itself is the lane's. */
    const store = async (items: readonly Item[], authors: readonly Author[], lane?: FoundLane | null): Promise<number> => {
      const handleOf = new Map(authors.map((a) => [String(a.authorKey), a.handle?.toLowerCase() ?? null]));
      for (const item of items) {
        stored += 1;
        if (handleOf.get(String(item.authorKey)) === last) byLast += 1;
      }
      return deps.store(items, authors, lane);
    };
    const r = await laneSearch({ ...deps, store }, { adapter: source, query, lane: 'account', cap: p.cap, maxPages: p.maxPagesPerAsk, deadline });
    usd += r.usd;
    returned += r.returned;
    fresh += r.fresh;
    if (r.pages > 0) asked += 1;
    /* Forward from this ask's start only when it answered; a failed or cut ask keeps its minutes. */
    if (r.end === 'done' || r.end === 'pages') for (const h of group) state.since.set(h.toLowerCase(), now);
    if (r.end === 'failed') deps.log.warn('an account watch ask failed; its minutes are asked again next pass', { accounts: group.length, err: r.error });
    if (PASS_ENDS.has(r.end)) {
      stopped = r.end;
      break;
    }
  }
  const result: AccountWatchResult = {
    accounts: handles.length,
    groups: groups.length,
    asked,
    returned,
    fresh,
    usd,
    lastShare: stored === 0 ? null : byLast / stored,
    stopped,
  };
  deps.log.info('account watch pass', { ...result, ms: deps.now() - started });
  return result;
}
