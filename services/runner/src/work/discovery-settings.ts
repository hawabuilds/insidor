/**
 * TODAY'S DISCOVERY SETTINGS, AS THE RECALL MODEL SEES THEM: the floors as sent, how far back
 * each lane really reached, how often it ran, and how approvals grow — read from the database.
 *
 * Its own file because two callers ask it the same question and must get the same answer: the
 * daily recall check (tools/recall-check.ts), and the owner's missed posts the minute they are
 * pasted (work/missed-posts.ts). Moved here from the tool so the runner need not import a tool.
 *
 * ★ MEASURED, NOT CONFIGURED. A lane reaches as far back as it really found posts (the 95th
 * percentile of the ages it found them at), never past the window it asked for; a lane whose
 * result cap fills early reaches less far than its window says (store/src/repo/recall.ts).
 *
 * What breaks if changed carelessly: null when no post has two approval readings — the growth
 * curve cannot be fitted then, and a reason named without it would be a guess. The tool refuses
 * on null; a missed post is diagnosed `unsure` why it was never found.
 */

import type { Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';
import { fitGrowthTau, sentFloors, startFloors, type DiscoverySettings } from '@insidor/core';
import type { LaneMeasured, PgFeedFloorRepo, PgRecallRepo } from '@insidor/store';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
/* The span the lane measurements and the growth fit read: the last week of live discovery. */
const MEASURE_SPAN_MS = 7 * 24 * MS_PER_HOUR;
/* A growth pair needs its two readings this far apart to say anything about the curve. */
const GROWTH_MIN_SPAN_MIN = 20;
const TAU_GRID = { fromMin: 5, toMin: 5_000, step: 1.02 };
/* The main lanes run on the runner's discovery cadence (loops/discover.ts); used only when the
   database has too few passes to measure it. */
const MAIN_EVERY_MIN_FALLBACK = 2;

const round = (n: number, places = 1) => Number(n.toFixed(places));

export interface SettingsSnapshot {
  readonly readAt: string;
  readonly settings: DiscoverySettings;
  /** What the settings were read from, so a report can show its working. */
  readonly measured: {
    readonly baseFloors: Readonly<Record<string, number>>;
    readonly lanes: readonly LaneMeasured[];
    readonly growthPairs: number;
    readonly configuredWindowMin: Readonly<Record<string, number>>;
  };
}

export async function measureDiscovery(
  repos: { readonly recall: Pick<PgRecallRepo, 'lanes' | 'growthPairs'>; readonly floors: Pick<PgFeedFloorRepo, 'floors'> },
  now: Millis,
  P: Policy,
): Promise<SettingsSnapshot | null> {
  const stored = await repos.floors.floors();
  const base = { ...startFloors(P) } as Record<'all' | 'media' | 'slow', number>;
  for (const lane of ['all', 'media', 'slow'] as const) {
    const held = stored[lane];
    if (held !== undefined && Number.isFinite(held) && held > 0) base[lane] = held;
  }
  const sent = sentFloors(base, P);
  const lanes = await repos.recall.lanes((now - MEASURE_SPAN_MS) as Millis);
  const pairs = await repos.recall.growthPairs('x', (now - MEASURE_SPAN_MS) as Millis, GROWTH_MIN_SPAN_MIN);
  const tau = fitGrowthTau(pairs, TAU_GRID);
  if (tau === null) return null;
  const of = (lane: string) => lanes.find((l) => l.lane === lane);
  const window = { all: P.feed.windowMin, media: P.feed.windowMin, slow: P.feed.slow.windowMin };
  /* A lane reaches as far back as it really found posts, and never past the window it asked for. */
  const reach = (lane: 'all' | 'media' | 'slow') => Math.min(window[lane], of(lane)?.p95AgeMin ?? window[lane]);
  const mainEvery = of('all')?.passGapMin ?? MAIN_EVERY_MIN_FALLBACK;
  return {
    readAt: new Date(now).toISOString(),
    settings: {
      langs: P.feed.langs.length === 0 ? null : [...P.feed.langs],
      /* What work/discover.ts sends: plain reposts left out, replies kept. */
      excludeReplies: false,
      excludeRebroadcasts: true,
      tauMin: round(tau),
      lanes: [
        { lane: 'all', floor: sent.all, reachMin: round(reach('all')), everyMin: round(mainEvery), mediaOnly: false },
        { lane: 'media', floor: sent.media, reachMin: round(reach('media')), everyMin: round(mainEvery), mediaOnly: true },
        /* The slow lane looks at a post once an hour of its age (one time slice each, see
           work/discover.ts `slowSliceQueries`), so that is how often it checks any one post. */
        { lane: 'slow', floor: sent.slow, reachMin: round(reach('slow')), everyMin: P.feed.slow.windowMin / Math.max(1, P.feed.slow.slices), mediaOnly: false },
      ],
    },
    measured: { baseFloors: base, lanes, growthPairs: pairs.length, configuredWindowMin: window },
  };
}
