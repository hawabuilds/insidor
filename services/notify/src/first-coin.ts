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
 * What breaks if changed carelessly: remembering only the starred narratives' coins. Then a person
 * starring a narrative that got its coin a week ago would be told it "has its first coin" now.
 */

import type { NotifyPolicy } from '@insidor/contracts/policy.ts';

import { coinFacts, type Quotes } from './coin-facts.ts';
import { queue, type Db } from './deliver.ts';

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

const COINS_SQL = `select story_id as "storyId", coalesce(payload ->> 'title', '') as title, payload -> 'coins' as coins
  from public.story_view where payload #>> '{provenance,kind}' = 'observed' order by story_id`;

export interface FirstCoinPorts {
  readonly policy: NotifyPolicy;
  readonly quotes?: Quotes;
}

const storyHref = (id: string) => `/#/story/${encodeURIComponent(id)}`;

/**
 * One pass. Returns how many alerts were queued and, per narrative told, who was told: the board's
 * own coin alerts for that narrative leave those people out (pipeline.ts), so one coin is one push.
 */
export async function checkFirstCoins(db: Db, ports: FirstCoinPorts): Promise<{ readonly queued: number; readonly told: ReadonlyMap<string, ReadonlySet<string>> }> {
  const rows = (await db.query<{ storyId: string; title: string; coins: unknown }>(COINS_SQL)).map((r): NarrativeCoin => ({ storyId: r.storyId, title: r.title, coin: settledCoin(r.coins) }));
  const seen = new Set((await db.query<{ key: string }>('select key from people.pipeline_seen where stream = $1', [FIRST_COIN_STREAM])).map((r) => r.key));
  const seeded = seen.delete(SEEDED);
  const watches = await db.query<{ userId: string; storyId: string }>('select user_id as "userId", story_id as "storyId" from people.watch');
  const byStory = new Map<string, string[]>();
  for (const w of watches) byStory.set(w.storyId, [...(byStory.get(w.storyId) ?? []), w.userId]);
  const { due, keys } = firstCoins(rows, seen, new Set(byStory.keys()), ports.policy.firstCoinPerPass);

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
  const remember = seeded ? keys : [SEEDED, ...rows.flatMap((r) => (r.coin === null ? [] : [r.storyId]))];
  if (remember.length > 0) await db.query('insert into people.pipeline_seen (stream, key) select $1, unnest($2::text[]) on conflict do nothing', [FIRST_COIN_STREAM, [...remember]]);
  return { queued, told };
}
