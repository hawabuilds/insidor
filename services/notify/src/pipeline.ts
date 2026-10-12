/**
 * ALERTS FROM THE PIPELINE — Insidor's own, and the lead feature: a rising post, a new narrative
 * on the board, a narrative's first coin, and a coin matched to a narrative someone watches.
 *
 * ★ THE PROJECTION KEEPS NO HISTORY, SO WE KEEP WHAT WE ALERTED ON. Rising rows and coin links
 * are rewritten every frame (services/project), with no "first seen" time. So each check compares
 * the frame now with `people.pipeline_seen` and alerts only on what is new to it.
 *
 * ★ THE FIRST LOOK ALERTS ON NOTHING. When a stream has never been read, everything on it is
 * recorded as seen and nothing is sent — turning alerts on must not send a hundred alerts about
 * the board as it already was.
 *
 * ★ ONLY OBSERVED, NEVER SAMPLE. Stories are read where `origin = 'observed'`; a fixture never
 * alerts anyone.
 *
 * The diffing is pure (`newRising`, `newPromoted`, `coinEvents`) and tested on recorded frames;
 * `checkPipeline` is the database around it. Works the moment SPEND=live feeds the pipeline; until
 * then the frames are whatever is in the projection, and the tests prove it on recorded ones.
 */

import type { AlertKind } from '@insidor/core';

import { queue, type Db } from './deliver.ts';
import type { Facts } from './text.ts';

export interface RisingRow {
  readonly itemId: string;
  readonly payload: {
    readonly sourceLabel?: string;
    readonly authorLabel?: string;
    readonly reach?: { readonly v?: number | null } | null;
    readonly storyId?: string | null;
  };
}
export interface BoardStory {
  readonly storyId: string;
  readonly title: string;
  readonly promoted: boolean;
  /** The coin addresses the frame settled on: one, several, or none (none, pending and unsure carry none). */
  readonly coins: readonly { readonly address: string; readonly ticker: string }[];
}

export interface Proposed {
  readonly kind: AlertKind;
  readonly subject: string;
  readonly facts: Facts;
  readonly href: string;
  /** null: everyone with the switch on; a story id: only the people watching it. */
  readonly audience: 'everyone' | { readonly watchers: string };
}

const storyHref = (id: string) => `/#/story/${encodeURIComponent(id)}`;

export function newRising(rows: readonly RisingRow[], seen: ReadonlySet<string>): Proposed[] {
  return rows
    .filter((r) => !seen.has(r.itemId))
    .map((r) => ({
      kind: 'rising_post' as const,
      subject: r.itemId,
      facts: { source: r.payload.sourceLabel ?? null, author: r.payload.authorLabel ?? null, views: typeof r.payload.reach?.v === 'number' ? r.payload.reach.v : null },
      href: r.payload.storyId ? storyHref(r.payload.storyId) : '/#/',
      audience: 'everyone' as const,
    }));
}

export function newPromoted(stories: readonly BoardStory[], seen: ReadonlySet<string>): Proposed[] {
  return stories
    .filter((s) => s.promoted && !seen.has(s.storyId))
    .map((s) => ({ kind: 'narrative_promoted' as const, subject: s.storyId, facts: { title: s.title }, href: storyHref(s.storyId), audience: 'everyone' as const }));
}

/** `story|mint` keys already seen → a narrative's first coin (to everyone) and each newly matched coin (to its watchers). */
export function coinEvents(stories: readonly BoardStory[], seen: ReadonlySet<string>): { readonly proposed: Proposed[]; readonly keys: string[] } {
  const proposed: Proposed[] = [];
  const keys: string[] = [];
  const storiesWithCoins = new Set([...seen].map((k) => k.split('|')[0] ?? ''));
  for (const s of stories) {
    const fresh = s.coins.filter((c) => !seen.has(`${s.storyId}|${c.address}`));
    if (fresh.length === 0) continue;
    if (!storiesWithCoins.has(s.storyId)) {
      const first = fresh[0];
      if (first !== undefined) proposed.push({ kind: 'narrative_coin', subject: s.storyId, facts: { title: s.title, symbol: first.ticker }, href: storyHref(s.storyId), audience: 'everyone' });
    }
    for (const c of fresh) {
      keys.push(`${s.storyId}|${c.address}`);
      proposed.push({ kind: 'coin_matched', subject: `${s.storyId}|${c.address}`, facts: { title: s.title, symbol: c.ticker }, href: storyHref(s.storyId), audience: { watchers: s.storyId } });
    }
  }
  return { proposed, keys };
}

/* ── the database around it ───────────────────────────────────────── */

const RISING_SQL = `select item_id as "itemId", payload from public.rising_row where feed_id = 'fyp'`;
const BOARD_SQL = `
  select r.story_id as "storyId", coalesce(v.payload ->> 'title', '') as title, s.state = 'promoted' as promoted, v.payload -> 'coins' as coins
    from public.board_row r
    join public.story s on s.story_id = r.story_id and s.origin = 'observed'
    join public.story_view v on v.story_id = r.story_id
   where r.view_id = 'default'`;

type CoinsJson = { kind?: string; coin?: { address?: string; ticker?: string }; coins?: { address?: string; ticker?: string }[] } | null;

export function settledCoins(raw: CoinsJson): BoardStory['coins'] {
  const list = raw?.kind === 'one' && raw.coin ? [raw.coin] : raw?.kind === 'several' ? (raw.coins ?? []) : [];
  return list.flatMap((c) => (typeof c.address === 'string' ? [{ address: c.address, ticker: c.ticker ?? '' }] : []));
}

async function seenSet(db: Db, stream: string): Promise<{ seeded: boolean; keys: Set<string> }> {
  const rows = await db.query<{ key: string }>('select key from people.pipeline_seen where stream = $1', [stream]);
  const keys = new Set(rows.map((r) => r.key));
  return { seeded: keys.has(SEEDED), keys };
}
const SEEDED = '#seeded';

async function markSeen(db: Db, stream: string, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  await db.query('insert into people.pipeline_seen (stream, key) select $1, unnest($2::text[]) on conflict do nothing', [stream, [...keys]]);
}

async function send(db: Db, proposed: readonly Proposed[]): Promise<number> {
  if (proposed.length === 0) return 0;
  const everyone = await db.query<{ userId: string }>('select user_id as "userId" from people.profile');
  let n = 0;
  for (const p of proposed) {
    const to = p.audience === 'everyone' ? everyone.map((e) => e.userId) : (await db.query<{ userId: string }>('select user_id as "userId" from people.watch where story_id = $1', [p.audience.watchers])).map((w) => w.userId);
    for (const userId of to) {
      await queue(db, { userId, kind: p.kind, subject: p.subject, rung: 0, facts: p.facts, href: p.href });
      n += 1;
    }
  }
  return n;
}

/** One pass over the projection. Returns how many alerts were queued. */
export async function checkPipeline(db: Db): Promise<number> {
  const rising = await db.query<RisingRow>(RISING_SQL);
  const board = (await db.query<{ storyId: string; title: string; promoted: boolean; coins: CoinsJson | string }>(BOARD_SQL)).map((r) => ({
    storyId: r.storyId,
    title: r.title,
    promoted: r.promoted,
    coins: settledCoins(typeof r.coins === 'string' ? (JSON.parse(r.coins) as CoinsJson) : r.coins),
  }));
  let queued = 0;

  const r = await seenSet(db, 'rising');
  if (r.seeded) queued += await send(db, newRising(rising, r.keys));
  await markSeen(db, 'rising', [SEEDED, ...rising.map((x) => x.itemId)]);

  const p = await seenSet(db, 'promoted');
  if (p.seeded) queued += await send(db, newPromoted(board, p.keys));
  await markSeen(db, 'promoted', [SEEDED, ...board.filter((s) => s.promoted).map((s) => s.storyId)]);

  const c = await seenSet(db, 'story-coin');
  c.keys.delete(SEEDED);
  const events = coinEvents(board, c.keys);
  if (c.seeded) queued += await send(db, events.proposed);
  await markSeen(db, 'story-coin', [SEEDED, ...events.keys]);

  return queued;
}
