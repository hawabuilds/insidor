/**
 * OLDER FEED POSTS' VIDEOS, READ AGAIN: a post on For You or Popular, or the subject of a Feed
 * alert, whose video was stored before the text source's read kept the video's playable file, is
 * read again by id and its media stored with the file (the owner, 2026-10-13: "fetch the video file
 * again from X if it's missing, so older posts play too, not just new ones").
 *
 * Its own step, run by its own half-minute loop (loops/refill.ts), because it is a backfill with an
 * end: posts found since the adapter kept the file arrive with it, and the queue empties as the
 * older posts leave the feeds. ★ "A POST THE SHEET OPENS" NEEDS NO REQUEST PATH: the sheet opens
 * only posts a feed holds (services/read/src/post-sheet.ts reads public.rising_row), every one of
 * them is in this queue, For You first, and the loop's cadence reads it within a minute.
 *
 * ★ ON THE LIVE POSTS LINE, CAPPED. At most `rising.refillPerPass` posts a pass (batched reads by
 * id), `rising.refillPerDay` a UTC day, and each post at most `rising.refillMaxTries` times, at
 * least `RETRY_AFTER_MS` apart — a deleted post, or a video the source serves no mp4 for, stops
 * being asked. The tries and the day's count are this process's: a restart forgets them, which
 * costs at most a few more reads of the same posts.
 *
 * What breaks if changed carelessly: the media is replaced only when the re-read has a playable
 * file for the post, only with the re-read's own list for that post, and only while the stored
 * post still lacks one (PgPostRefillRepo.setMedia). Sources are those that can read a post by id;
 * a source whose videos never carry a file stores its videos as stills, so none of its posts queue.
 */

import type { Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { PlatformRegistry } from '@insidor/platform-registry';
import type { PgPostRefillRepo } from '@insidor/store';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';

const DAY_MS = 86_400_000;
/** Feed alerts are looked at this far back: the Feed tab's newest pages. */
const ALERTS_BACK_MS = 3 * DAY_MS;
/** A post that came back without a file is asked again no sooner than this. */
const RETRY_AFTER_MS = 10 * 60_000;

export interface RefillDeps {
  readonly platforms: Pick<PlatformRegistry, 'all'>;
  readonly refill: Pick<PgPostRefillRepo, 'due' | 'setMedia'>;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface RefillResult {
  /** Posts owed a read this pass, after the tries and the caps. */
  readonly due: number;
  /** Posts read from the source. */
  readonly asked: number;
  /** Posts whose media now carries a playable file. */
  readonly filled: number;
  readonly wouldSpendUsd: number;
  readonly spentUsd: number;
}

/** What the step remembers between passes: each post's tries, and the day's reads. */
export interface RefillMemory {
  readonly tries: Map<string, { count: number; at: number }>;
  day: number;
  readToday: number;
}

export const refillMemory = (): RefillMemory => ({ tries: new Map(), day: -1, readToday: 0 });

const playable = (m: { readonly kind: string; readonly playUri?: string | null }) => m.kind === 'video' && typeof m.playUri === 'string' && m.playUri !== '';

export async function refillPosts(deps: RefillDeps, memory: RefillMemory): Promise<RefillResult> {
  const now = deps.now();
  const r = deps.policy.rising;
  const none: RefillResult = { due: 0, asked: 0, filled: 0, wouldSpendUsd: 0, spentUsd: 0 };
  const day = Math.floor(now / DAY_MS);
  if (memory.day !== day) {
    memory.day = day;
    memory.readToday = 0;
  }
  const room = Math.min(r.refillPerPass, r.refillPerDay - memory.readToday);
  if (room <= 0) return none;
  const readers = new Map(deps.platforms.all().filter((p) => p.lookup !== undefined).map((p) => [String(p.id), p] as const));
  if (readers.size === 0) return none;

  let found;
  try {
    /* Asked for more than `room`: posts out of tries are dropped below, and must not starve the rest. */
    found = await deps.refill.due([...readers.keys()], new Date(now - ALERTS_BACK_MS), room + memory.tries.size);
  } catch (e) {
    deps.log.warn('posts to fill in could not be read; tried again next pass', { err: errorText(e) });
    return none;
  }
  const ready = (id: string) => {
    const t = memory.tries.get(id);
    return t === undefined || (t.count < r.refillMaxTries && now - t.at >= RETRY_AFTER_MS);
  };
  const queue = found.filter((d) => ready(d.itemId)).slice(0, room);
  if (queue.length === 0) return none;

  let asked = 0;
  let filled = 0;
  let wouldSpendUsd = 0;
  let spentUsd = 0;
  for (const [source, adapter] of readers) {
    const posts = queue.filter((d) => d.source === source);
    if (posts.length === 0) continue;
    const estimate = adapter.estimate({ kind: 'observe', sourceItemIds: posts.map((p) => p.sourceItemId) });
    if (!deps.meter.mayspend(estimate.vendor, estimate.usd)) {
      deps.log.warn('filling in videos paused for budget; they wait', { posts: posts.length });
      continue;
    }
    if (deps.mode === 'dry') {
      wouldSpendUsd += estimate.usd;
      continue;
    }
    /* Counted before the read: a read that throws after the vendor billed it still used a try. */
    for (const p of posts) memory.tries.set(p.itemId, { count: (memory.tries.get(p.itemId)?.count ?? 0) + 1, at: now });
    memory.readToday += posts.length;
    asked += posts.length;
    try {
      const line = deps.meter.line(estimate.vendor);
      const read = await adapter.lookup!(
        posts.map((p) => p.sourceItemId),
        { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: (now + DAY_MS) as Millis },
      );
      spentUsd += read.spend.usd;
      const bySourceId = new Map(read.value.items.map((i) => [i.sourceItemId, i] as const));
      for (const p of posts) {
        const item = bySourceId.get(p.sourceItemId);
        if (item === undefined || !item.media.some(playable)) continue;
        if (await deps.refill.setMedia(p.itemId, item.media)) filled += 1;
      }
    } catch (e) {
      if (e instanceof BudgetRefused) {
        deps.log.warn('filling in videos paused for budget at the vendor edge; they wait', { posts: posts.length });
        continue;
      }
      deps.log.warn('posts could not be read again; tried again later', { posts: posts.length, err: errorText(e) });
    }
  }

  if (deps.mode === 'dry') deps.log.info('DRY RUN — feed videos to fill in priced, not read', { posts: queue.length, wouldSpendUsd: Number(wouldSpendUsd.toFixed(6)) });
  else deps.log.info('feed videos filled in', { asked, filled, today: memory.readToday, usd: Number(spentUsd.toFixed(6)) });
  return { due: queue.length, asked, filled, wouldSpendUsd, spentUsd };
}
