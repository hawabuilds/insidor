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
 * ★ THE OWNER'S PUSH LIST (2026-10-14), on For You posts, each once and each on its own switch:
 *   New on FYP     every post new to For You, one by one ("@handle: words… 751K views, +38K in 5m"),
 *                  opening the post's sheet
 *   a coin found   the first coin a For You post gets — its own line's coin, or the first of its
 *                  list ("See 3 coins") — "launched 33m after" or "before" the post (`fyp_coin`)
 *   a proven coin  a coin whose own links carry the post (`fyp_proven`)
 *   story coin     a For You post on a story whose coin the owner confirmed (`story_post`)
 * The coin pushes open the coin's page; a post someone watches is the watch's (watch.ts), so its
 * watchers are left out of these two rather than told twice.
 *
 * Watched posts are checked on their own, faster loop (watch.ts), not here.
 *
 * Each alert carries the face its row shows: a rising post its poster's picture, a coin its address.
 *
 * ★ ONLY OBSERVED, NEVER SAMPLE. Stories are read where `origin = 'observed'`; a fixture never
 * alerts anyone.
 *
 * The diffing is pure (`newRising`, `newPromoted`, `coinEvents`) and tested on recorded frames;
 * `checkPipeline` is the database around it. Works the moment SPEND=live feeds the pipeline; until
 * then the frames are whatever is in the projection, and the tests prove it on recorded ones.
 */

import type { AlertKind } from '@insidor/core';

import { coinFacts, type Quotes } from './coin-facts.ts';
import { queue, type Db } from './deliver.ts';
import { posterPictures } from './faces.ts';
import { lineCoin } from './post-watch.ts';
import type { Facts } from './text.ts';

export interface RisingRow {
  readonly itemId: string;
  readonly payload: {
    readonly sourceLabel?: string;
    readonly authorLabel?: string;
    readonly reach?: { readonly v?: number | null } | null;
    readonly storyId?: string | null;
    readonly excerpt?: string;
    readonly thumbUrl?: string | null;
    readonly sheet?: { readonly views?: readonly { readonly atMs?: number; readonly value?: number | null }[] } | null;
    readonly coins?: unknown;
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
  /**
   * 'everyone': every profile (the switch decides); `watchers`: the people starring that narrative;
   * `notWatching`: everyone except the people watching that post (the watch tells them itself);
   * `owner`: the owner's profiles only.
   */
  readonly audience: 'everyone' | 'owner' | { readonly watchers: string } | { readonly notWatching: string };
}

const storyHref = (id: string) => `/#/story/${encodeURIComponent(id)}`;
/** A post's own sheet over For You (mobile shared/route.ts `post`). */
export const postHref = (itemId: string) => `/#/post/${encodeURIComponent(itemId)}`;
/** A coin's own page (mobile shared/route.ts `token`). */
export const tokenHref = (mint: string) => `/#/token/${encodeURIComponent(`solana:${mint}`)}`;
const httpsOr = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/\S+$/.test(v) && v.length <= 2_000 ? v : null);

/** How far back "+38K in 5m" looks, and how far from that a reading may be and still count. */
const GAIN_MS = 5 * 60_000;
const GAIN_SLACK_MS = 2 * 60_000;

/**
 * The views gained over about five minutes, from the post's own readings: the newest reading
 * against the one nearest five minutes before it (three to seven minutes back). Null when there
 * is no such pair — a post new to For You often has one reading, and then the push says the views
 * alone rather than a made-up change.
 */
export function viewGain(readings: readonly { readonly atMs?: number; readonly value?: number | null }[] | undefined): { readonly gain: number; readonly minutes: number } | null {
  const known = (readings ?? []).flatMap((r) => (typeof r.atMs === 'number' && typeof r.value === 'number' ? [{ at: r.atMs, v: r.value }] : [])).sort((a, b) => a.at - b.at);
  const last = known[known.length - 1];
  if (last === undefined) return null;
  let best: { at: number; v: number } | null = null;
  for (const r of known) {
    const back = last.at - r.at;
    if (Math.abs(back - GAIN_MS) > GAIN_SLACK_MS) continue;
    if (best === null || Math.abs(back - GAIN_MS) < Math.abs(last.at - best.at - GAIN_MS)) best = r;
  }
  return best === null ? null : { gain: last.v - best.v, minutes: Math.round((last.at - best.at) / 60_000) };
}

export function newRising(rows: readonly RisingRow[], seen: ReadonlySet<string>): Proposed[] {
  return rows
    .filter((r) => !seen.has(r.itemId))
    .map((r) => {
      const gain = viewGain(r.payload.sheet?.views);
      return {
        kind: 'rising_post' as const,
        subject: r.itemId,
        facts: {
          source: r.payload.sourceLabel ?? null,
          author: r.payload.authorLabel ?? null,
          views: typeof r.payload.reach?.v === 'number' ? r.payload.reach.v : null,
          excerpt: r.payload.excerpt ?? '',
          gain: gain?.gain ?? null,
          gainMinutes: gain?.minutes ?? null,
          image: httpsOr(r.payload.thumbUrl),
        },
        href: postHref(r.itemId),
        audience: 'everyone' as const,
      };
    });
}

/** The first coin in a For You post's list ("See 3 coins"), by the projector's order. */
export interface ListedCoin {
  readonly address: string;
  readonly launchedAfterMs: number | null;
}

/** What a For You post's coins are news for, once each (see the header). Facts are filled in by the caller. */
export interface FypCoinEvent {
  readonly kind: 'fyp_coin' | 'fyp_proven' | 'story_post';
  readonly itemId: string;
  readonly address: string;
  readonly ticker: string;
  readonly launchedAfterMs: number | null;
  readonly mcUsd: number | null;
  readonly logo: string | null;
  /** The key it is remembered under in its stream. */
  readonly key: string;
}

export function fypCoinEvents(
  rows: readonly RisingRow[],
  listed: ReadonlyMap<string, ListedCoin>,
  seen: { readonly coin: ReadonlySet<string>; readonly proven: ReadonlySet<string>; readonly story: ReadonlySet<string> },
): { readonly events: FypCoinEvent[]; readonly coinKeys: string[]; readonly provenKeys: string[]; readonly storyKeys: string[] } {
  const events: FypCoinEvent[] = [];
  const coinKeys: string[] = [];
  const provenKeys: string[] = [];
  const storyKeys: string[] = [];
  for (const r of rows) {
    const line = lineCoin(r.payload);
    if (line !== null && line.linksPost) {
      /* Proven: said as proven, and the post's "coin found" is spent with it. */
      const key = `${r.itemId}|${line.address}`;
      if (!seen.proven.has(key)) events.push({ kind: 'fyp_proven', itemId: r.itemId, address: line.address, ticker: line.ticker, launchedAfterMs: line.launchedAfterMs, mcUsd: line.mcUsd, logo: line.imageUrl, key });
      provenKeys.push(key);
      coinKeys.push(r.itemId);
      continue;
    }
    if (line !== null && line.storyCoin) {
      if (!seen.story.has(r.itemId)) events.push({ kind: 'story_post', itemId: r.itemId, address: line.address, ticker: line.ticker, launchedAfterMs: line.launchedAfterMs, mcUsd: line.mcUsd, logo: line.imageUrl, key: r.itemId });
      storyKeys.push(r.itemId);
      coinKeys.push(r.itemId);
      continue;
    }
    const first = line !== null ? { address: line.address, launchedAfterMs: line.launchedAfterMs } : (listed.get(r.itemId) ?? null);
    if (first === null) continue;
    if (!seen.coin.has(r.itemId)) events.push({ kind: 'fyp_coin', itemId: r.itemId, address: first.address, ticker: line?.ticker ?? '', launchedAfterMs: first.launchedAfterMs, mcUsd: line?.mcUsd ?? null, logo: line?.imageUrl ?? null, key: r.itemId });
    coinKeys.push(r.itemId);
  }
  return { events, coinKeys, provenKeys, storyKeys };
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
      if (first !== undefined) proposed.push({ kind: 'narrative_coin', subject: s.storyId, facts: { title: s.title, symbol: first.ticker, address: first.address }, href: storyHref(s.storyId), audience: 'everyone' });
    }
    for (const c of fresh) {
      keys.push(`${s.storyId}|${c.address}`);
      proposed.push({ kind: 'coin_matched', subject: `${s.storyId}|${c.address}`, facts: { title: s.title, symbol: c.ticker, address: c.address }, href: storyHref(s.storyId), audience: { watchers: s.storyId } });
    }
  }
  return { proposed, keys };
}

/* ── the database around it ───────────────────────────────────────── */

const RISING_SQL = `select item_id as "itemId", payload from public.rising_row where feed_id = 'fyp'`;
/* The first coin of each For You post's list (0078's grant; before it, none: the line alone). */
const LISTED_SQL = `select distinct on (subject_id) subject_id as "itemId", address, launched_after_ms as "launchedAfterMs"
                      from public.same_name_coin where subject_kind = 'post' and subject_id = any($1::text[])
                     order by subject_id, position nulls last`;
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

async function send(db: Db, proposed: readonly Proposed[], ownerWallets: readonly string[] = []): Promise<number> {
  if (proposed.length === 0) return 0;
  const everyone = await db.query<{ userId: string; wallet: string | null }>('select user_id as "userId", wallet from people.profile');
  let n = 0;
  for (const p of proposed) {
    const a = p.audience;
    const to =
      a === 'everyone' ? everyone.map((e) => e.userId)
      : a === 'owner' ? everyone.filter((e) => e.wallet !== null && ownerWallets.includes(e.wallet)).map((e) => e.userId)
      : 'notWatching' in a ? await notWatching(db, everyone.map((e) => e.userId), a.notWatching)
      : (await db.query<{ userId: string }>('select user_id as "userId" from people.watch where story_id = $1', [a.watchers])).map((w) => w.userId);
    for (const userId of to) {
      await queue(db, { userId, kind: p.kind, subject: p.subject, rung: 0, facts: p.facts, href: p.href });
      n += 1;
    }
  }
  return n;
}

/** Everyone but the people watching this post. */
async function notWatching(db: Db, everyone: readonly string[], itemId: string): Promise<string[]> {
  const watching = new Set((await db.query<{ userId: string }>('select user_id as "userId" from people.post_watch where item_id = $1', [itemId])).map((w) => w.userId));
  return everyone.filter((u) => !watching.has(u));
}

/** A rising post's alert carries its poster's picture (faces.ts), saved with it; none when it cannot be read. */
async function withPosterPictures(db: Db, proposed: readonly Proposed[]): Promise<Proposed[]> {
  const pictures = await posterPictures(db, proposed.map((p) => p.subject));
  return proposed.map((p) => {
    const picture = pictures.get(p.subject);
    return picture === undefined ? p : { ...p, facts: { ...p.facts, picture } };
  });
}

export interface PipelinePorts {
  /** The market source (coin-facts.ts); absent: caps come from what we stored, or are left out. */
  readonly quotes?: Quotes;
  /** The owner's wallets (Policy.owner): "Your coin" on a story coin is his. */
  readonly ownerWallets?: readonly string[];
}

async function listedCoins(db: Db, itemIds: readonly string[]): Promise<Map<string, ListedCoin>> {
  if (itemIds.length === 0) return new Map();
  try {
    const rows = await db.query<{ itemId: string; address: string; launchedAfterMs: string | number | null }>(LISTED_SQL, [[...itemIds]]);
    return new Map(rows.map((r) => [r.itemId, { address: r.address, launchedAfterMs: r.launchedAfterMs === null ? null : Number(r.launchedAfterMs) }]));
  } catch (e) {
    if ((e as { code?: unknown }).code === '42501') return new Map();
    throw e;
  }
}

/** The For You coin events with what the push says filled in: who, the words, the pictures, the cap. */
export async function fypCoinProposals(db: Db, rows: readonly RisingRow[], events: readonly FypCoinEvent[], ports: PipelinePorts): Promise<Proposed[]> {
  if (events.length === 0) return [];
  const byItem = new Map(rows.map((r) => [r.itemId, r.payload]));
  const coins = await coinFacts(db, ports.quotes, events.map((e) => e.address));
  const pictures = await posterPictures(db, events.map((e) => e.itemId));
  const storyIds = [...new Set(events.flatMap((e) => (byItem.get(e.itemId)?.storyId ? [byItem.get(e.itemId)?.storyId as string] : [])))];
  const titles = new Map(
    storyIds.length === 0 ? [] : (await db.query<{ storyId: string; title: string }>(`select story_id as "storyId", coalesce(payload ->> 'title', '') as title from public.story_view where story_id = any($1::text[])`, [storyIds])).map((t) => [t.storyId, t.title] as const),
  );
  return events.map((e) => {
    const post = byItem.get(e.itemId);
    const coin = coins.get(e.address);
    const story = post?.storyId ? (titles.get(post.storyId) ?? '') : '';
    const facts: Record<string, unknown> = {
      symbol: e.ticker !== '' ? e.ticker : (coin?.symbol ?? ''),
      address: e.address,
      author: post?.authorLabel ?? null,
      launchedAfterMs: e.launchedAfterMs,
      mcUsd: e.mcUsd ?? coin?.mcUsd ?? null,
      image: httpsOr(post?.thumbUrl),
      logo: e.logo ?? coin?.logo ?? null,
      ...(pictures.has(e.itemId) ? { picture: pictures.get(e.itemId) } : {}),
    };
    if (e.kind === 'fyp_proven' && story !== '') facts['subject'] = story;
    if (e.kind === 'story_post') {
      facts['story'] = story !== '' ? story : (coin?.name ?? '');
      facts['mine'] = true;
    }
    return {
      kind: e.kind,
      subject: e.kind === 'fyp_proven' ? e.key : e.itemId,
      facts,
      /* A coin opens its page; a new post on a story with a coin opens the post, where its coin and Buy are. */
      href: e.kind === 'story_post' ? postHref(e.itemId) : tokenHref(e.address),
      audience: e.kind === 'story_post' ? ('owner' as const) : { notWatching: e.itemId },
    };
  });
}

/** One pass over the projection. Returns how many alerts were queued. */
export async function checkPipeline(db: Db, ports: PipelinePorts = {}): Promise<number> {
  const rising = await db.query<RisingRow>(RISING_SQL);
  const board = (await db.query<{ storyId: string; title: string; promoted: boolean; coins: CoinsJson | string }>(BOARD_SQL)).map((r) => ({
    storyId: r.storyId,
    title: r.title,
    promoted: r.promoted,
    coins: settledCoins(typeof r.coins === 'string' ? (JSON.parse(r.coins) as CoinsJson) : r.coins),
  }));
  let queued = 0;

  const r = await seenSet(db, 'rising');
  if (r.seeded) queued += await send(db, await withPosterPictures(db, newRising(rising, r.keys)));
  await markSeen(db, 'rising', [SEEDED, ...rising.map((x) => x.itemId)]);

  const p = await seenSet(db, 'promoted');
  if (p.seeded) queued += await send(db, newPromoted(board, p.keys));
  await markSeen(db, 'promoted', [SEEDED, ...board.filter((s) => s.promoted).map((s) => s.storyId)]);

  const c = await seenSet(db, 'story-coin');
  c.keys.delete(SEEDED);
  const events = coinEvents(board, c.keys);
  if (c.seeded) queued += await send(db, events.proposed);
  await markSeen(db, 'story-coin', [SEEDED, ...events.keys]);

  /* The owner's push list on For You posts: a coin found, a proven coin, a story's coin (see the header). */
  const fc = await seenSet(db, 'fyp-coin');
  const fp = await seenSet(db, 'fyp-proven');
  const fs = await seenSet(db, 'story-post');
  const fyp = fypCoinEvents(rising, await listedCoins(db, rising.map((x) => x.itemId)), { coin: fc.keys, proven: fp.keys, story: fs.keys });
  const due = fyp.events.filter((e) => (e.kind === 'fyp_coin' ? fc.seeded : e.kind === 'fyp_proven' ? fp.seeded : fs.seeded));
  queued += await send(db, await fypCoinProposals(db, rising, due, ports), ports.ownerWallets ?? []);
  await markSeen(db, 'fyp-coin', [SEEDED, ...fyp.coinKeys]);
  await markSeen(db, 'fyp-proven', [SEEDED, ...fyp.provenKeys]);
  await markSeen(db, 'story-post', [SEEDED, ...fyp.storyKeys]);

  return queued;
}
