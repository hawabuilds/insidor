/**
 * A NARRATIVE YOU STARRED GOT ITS FIRST COIN (the owner, 2026-10-18, for buyers): "Pancake the cat
 * has its first coin: $PANCAKE", pushed to each person who starred it (people.watch), once per
 * person and narrative, opening the narrative's page.
 *
 * ★ EVERY NARRATIVE, NOT ONLY THE BOARD'S. The board's coin alerts (pipeline.ts `coinEvents`) read
 * the stories on today's board; a starred narrative is any page on the Narratives tab, most of them
 * off the board. So this reads every observed page's coin (public.story_view, about 400 narrow rows
 * on 18 Oct) and keeps, in people.pipeline_seen under `first-coin`, the narratives that have ever
 * had one. A narrative not in that set that has a coin now got its first one since the last pass.
 *
 * ★ ONLY A SETTLED COIN COUNTS: the page's `coins` is `one` or `several`, which the projector writes
 * only for a coin the owner confirmed or its posts prove. `unsure` (coins share its name, none is
 * sure), `pending` (still checking) and the page's top coin ("Top coin, not checked") are not a
 * coin of the narrative, and "has its first coin" would say they were.
 *
 * ★ ONCE, EVER, PER NARRATIVE. Every narrative with a coin is remembered whether or not anybody had
 * starred it, so starring a narrative that already has its coin never sends "first coin" about it,
 * and a coin that is unsettled and settled again is not a second first. The first look remembers
 * every coin and sends nothing, as the other pipeline streams do. people.alert_claim then holds it
 * to once per person and narrative, whatever the stream says.
 *
 * Bounded: at most Policy.notify.firstCoinPerPass starred narratives a pass. Those over it are left
 * unremembered and are the next pass's; nothing is dropped. The person's switch, mute, quiet hours
 * and hourly limit are the deliverer's (deliver.ts), as for every alert.
 *
 * ★ ONE NARRATIVE, ONE COIN (Policy.oneCoin.mode 'live', `onPick`): the page's coin is then the
 * runner's pick, so a later, different coin is the pick handed over: pushed once to each starrer as
 * `starred_first_coin` with `handover` ("Pancake the cat's coin is now $PANCAKE"). Each coin a
 * narrative has had is remembered as `story|address`; the first live look remembers every coin
 * already shown and sends nothing, so switching to live is not itself news.
 *
 * What breaks if changed carelessly: remembering only the starred narratives' coins. Then a person
 * starring a narrative that got its coin a week ago would be told it "has its first coin" now.
 */

import { DEFAULT_POLICY, type NotifyPolicy } from '@insidor/contracts/policy.ts';

import { coinFacts, type Quotes } from './coin-facts.ts';
import { queue, type Db } from './deliver.ts';
import { seenKeys } from './seen.ts';

export const FIRST_COIN_STREAM = 'first-coin';
const SEEDED = '#seeded';

export interface NarrativeCoin {
  readonly storyId: string;
  readonly title: string;
  /** The first settled coin as the page orders them; null when the page has none settled. */
  readonly coin: { readonly address: string; readonly ticker: string } | null;
}

type CoinsJson = { kind?: unknown; coin?: { address?: unknown; ticker?: unknown }; coins?: { address?: unknown; ticker?: unknown }[] } | null;

/** The page's first settled coin: `one`'s coin or the first of `several`; null for none, pending and unsure. */
export function settledCoin(raw: unknown): NarrativeCoin['coin'] {
  const c = (typeof raw === 'string' ? (JSON.parse(raw) as CoinsJson) : (raw as CoinsJson)) ?? null;
  const first = c?.kind === 'one' ? c.coin : c?.kind === 'several' ? c.coins?.[0] : undefined;
  if (first === undefined || typeof first.address !== 'string' || first.address === '') return null;
  return { address: first.address, ticker: typeof first.ticker === 'string' ? first.ticker : '' };
}

/**
 * The pure step. `keys` are the narratives to remember now: every one with a coin not yet seen,
 * except the starred ones past `max`, which wait. `due` are the starred ones to tell, at most `max`.
 */
export function firstCoins(rows: readonly NarrativeCoin[], seen: ReadonlySet<string>, starred: ReadonlySet<string>, max: number): { readonly due: readonly NarrativeCoin[]; readonly keys: readonly string[] } {
  const due: NarrativeCoin[] = [];
  const keys: string[] = [];
  for (const r of rows) {
    if (r.coin === null || seen.has(r.storyId)) continue;
    if (!starred.has(r.storyId)) {
      keys.push(r.storyId);
      continue;
    }
    if (due.length >= max) continue;
    due.push(r);
    keys.push(r.storyId);
  }
  return { due, keys };
}

/** Marks that the first look on the pick has remembered every narrative's coin already shown. */
const PICK_SEEDED = '#seeded-pick';

/**
 * The pure step for the pick's hand-overs: starred narratives that had a first coin and now show a
 * coin they never showed, at most `max`.
 */
export function handedOver(rows: readonly NarrativeCoin[], seen: ReadonlySet<string>, starred: ReadonlySet<string>, max: number): readonly NarrativeCoin[] {
  const out: NarrativeCoin[] = [];
  for (const r of rows) {
    if (out.length >= max) break;
    if (r.coin === null || !starred.has(r.storyId) || !seen.has(r.storyId) || seen.has(`${r.storyId}|${r.coin.address}`)) continue;
    out.push(r);
  }
  return out;
}

/*
 * ★ EVERY OBSERVED NARRATIVE'S TITLE AND COINS, HELD BY THEIR DIGEST. Each pass needs every observed
 * page's coins (one not starred is remembered as seen), and nearly every page is the one the pass
 * before was sent (with the Blowing up read of the same pages, ~0.9 GB a day of database egress,
 * 2026-10-29). So the pass asks for each page's digest of the two, and reads the title and coins
 * only of a page not held at its digest. The rows are the ones the single statement gave, in its
 * order. Held in the process; a page that leaves the read is dropped from what is held.
 */
const DIGEST = `md5(coalesce(payload ->> 'title', '') || '|' || coalesce((payload -> 'coins')::text, ''))`;
const VERSIONS_SQL = `select story_id as "storyId", ${DIGEST} as v
  from public.story_view where payload #>> '{provenance,kind}' = 'observed' order by story_id`;
const COINS_SQL = `select story_id as "storyId", ${DIGEST} as v, coalesce(payload ->> 'title', '') as title, payload -> 'coins' as coins
  from public.story_view where story_id = any($1::text[])`;
const HELD_PAGES = new Map<string, { readonly v: string; readonly title: string; readonly coins: unknown }>();

/** Every observed page's title and coins, by story, from what is held or read now. */
export async function pageCoins(db: Db): Promise<readonly { readonly storyId: string; readonly title: string; readonly coins: unknown }[]> {
  const versions = await db.query<{ storyId: string; v: string }>(VERSIONS_SQL);
  const stale = versions.filter((r) => HELD_PAGES.get(r.storyId)?.v !== r.v).map((r) => r.storyId);
  if (stale.length > 0) {
    for (const r of await db.query<{ storyId: string; v: string; title: string; coins: unknown }>(COINS_SQL, [stale])) HELD_PAGES.set(r.storyId, { v: r.v, title: r.title, coins: r.coins });
  }
  const asked = new Set(versions.map((r) => r.storyId));
  for (const k of [...HELD_PAGES.keys()]) if (!asked.has(k)) HELD_PAGES.delete(k);
  return versions.flatMap((r) => {
    const held = HELD_PAGES.get(r.storyId);
    return held === undefined ? [] : [{ storyId: r.storyId, title: held.title, coins: held.coins }];
  });
}

export interface FirstCoinPorts {
  readonly policy: NotifyPolicy;
  /** Push a hand-over of the one-coin pick too (Policy.oneCoin.mode 'live'); absent: read from the policy in force. */
  readonly onPick?: boolean;
  readonly quotes?: Quotes;
}

const storyHref = (id: string) => `/#/story/${encodeURIComponent(id)}`;

/**
 * One pass. Returns how many alerts were queued and, per narrative told, who was told: the board's
 * own coin alerts for that narrative leave those people out (pipeline.ts), so one coin is one push.
 */
export async function checkFirstCoins(db: Db, ports: FirstCoinPorts): Promise<{ readonly queued: number; readonly told: ReadonlyMap<string, ReadonlySet<string>> }> {
  const rows = (await pageCoins(db)).map((r): NarrativeCoin => ({ storyId: r.storyId, title: r.title, coin: settledCoin(r.coins) }));
  const seen = await seenKeys(db, FIRST_COIN_STREAM);
  const seeded = seen.delete(SEEDED);
  const watches = await db.query<{ userId: string; storyId: string }>('select user_id as "userId", story_id as "storyId" from people.watch');
  const byStory = new Map<string, string[]>();
  for (const w of watches) byStory.set(w.storyId, [...(byStory.get(w.storyId) ?? []), w.userId]);
  const { due, keys } = firstCoins(rows, seen, new Set(byStory.keys()), ports.policy.firstCoinPerPass);
  const onPick = ports.onPick ?? DEFAULT_POLICY.oneCoin.mode === 'live';
  const pickSeeded = seen.delete(PICK_SEEDED);
  const handovers = onPick && seeded && pickSeeded ? handedOver(rows, seen, new Set(byStory.keys()), ports.policy.firstCoinPerPass - due.length) : [];

  let queued = 0;
  const told = new Map<string, Set<string>>();
  if (seeded && due.length > 0) {
    const facts = await coinFacts(db, ports.quotes, due.flatMap((d) => (d.coin === null ? [] : [d.coin.address])));
    for (const d of due) {
      if (d.coin === null) continue;
      const f = facts.get(d.coin.address);
      for (const userId of byStory.get(d.storyId) ?? []) {
        await queue(db, {
          userId,
          kind: 'starred_first_coin',
          subject: d.storyId,
          rung: 0,
          facts: { title: d.title, symbol: d.coin.ticker !== '' ? d.coin.ticker : (f?.symbol ?? ''), address: d.coin.address, mcUsd: f?.mcUsd ?? null, logo: f?.logo ?? null },
          href: storyHref(d.storyId),
        });
        queued += 1;
        told.set(d.storyId, (told.get(d.storyId) ?? new Set<string>()).add(userId));
      }
    }
  }
  if (handovers.length > 0) {
    const facts = await coinFacts(db, ports.quotes, handovers.flatMap((d) => (d.coin === null ? [] : [d.coin.address])));
    for (const d of handovers) {
      if (d.coin === null) continue;
      const f = facts.get(d.coin.address);
      for (const userId of byStory.get(d.storyId) ?? []) {
        await queue(db, {
          userId,
          kind: 'starred_first_coin',
          subject: `${d.storyId}|${d.coin.address}`,
          rung: 0,
          facts: { title: d.title, symbol: d.coin.ticker !== '' ? d.coin.ticker : (f?.symbol ?? ''), address: d.coin.address, mcUsd: f?.mcUsd ?? null, logo: f?.logo ?? null, handover: true },
          href: storyHref(d.storyId),
        });
        queued += 1;
        told.set(d.storyId, (told.get(d.storyId) ?? new Set<string>()).add(userId));
      }
    }
  }
  /* Each coin a narrative has shown, as `story|address`: on the pick, a coin not among them is a hand-over. */
  const sent = new Set(handovers.flatMap((h) => (h.coin === null ? [] : [`${h.storyId}|${h.coin.address}`])));
  /* A starred narrative's hand-over held back by the cap stays unremembered: it is the next pass's. */
  const waitsForCap = (r: NarrativeCoin, key: string): boolean => pickSeeded && seeded && byStory.has(r.storyId) && seen.has(r.storyId) && !sent.has(key);
  const coinKeys = !onPick ? [] : [
    ...(pickSeeded ? [] : [PICK_SEEDED]),
    ...rows.flatMap((r) => {
      const key = r.coin === null ? null : `${r.storyId}|${r.coin.address}`;
      return key === null || seen.has(key) || waitsForCap(r, key) ? [] : [key];
    }),
  ];
  if (coinKeys.length > 0) await db.query('insert into people.pipeline_seen (stream, key) select $1, unnest($2::text[]) on conflict do nothing', [FIRST_COIN_STREAM, coinKeys]);
  const remember = seeded ? keys : [SEEDED, ...rows.flatMap((r) => (r.coin === null ? [] : [r.storyId]))];
  if (remember.length > 0) await db.query('insert into people.pipeline_seen (stream, key) select $1, unnest($2::text[]) on conflict do nothing', [FIRST_COIN_STREAM, [...remember]]);
  return { queued, told };
}
