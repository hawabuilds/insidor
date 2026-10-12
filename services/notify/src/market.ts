/**
 * ALERTS FROM PRICES AND CURVES — Trador's holding and watchlist multiples (which never fired in
 * Trador: nothing called them; here a loop does) and its graduation alerts, on free data: wallet
 * balances and buys from the chain, prices from DexScreener, curves from the launchpad's accounts.
 *
 *   - Your holdings: a coin you hold, worth at least `minPositionUsd`, priced at a multiple of
 *     your average buy price (in SOL, the unit the buys were made in). No buy history, no alert.
 *   - Your watchlist: a coin of a narrative you watch, at a multiple of its price when you
 *     started watching (recorded the first time it is seen for you).
 *   - Graduations: a watched or held coin past `graduatingSoonAt` of its curve, and a coin whose
 *     curve completed after we had seen it open — never one that had already graduated when we
 *     first looked, which would be news about the past.
 *
 * The level each fires at is decided in core (`highestMilestone`); the claim that makes it fire
 * once is the deliverer's. Every read here can fail; a failed read skips that coin this pass.
 */

import type { NotifyPolicy } from '@insidor/contracts/policy.ts';
import { highestMilestone, type AlertKind } from '@insidor/core';

import { prefsOf, queue, type Db } from './deliver.ts';
import type { Facts } from './text.ts';

export interface Quote {
  readonly ticker: string;
  readonly priceUsd: number | null;
  readonly priceSol: number | null;
}

export interface MarketPorts {
  /** UI amounts held, by mint. */
  balances(wallet: string): Promise<ReadonlyMap<string, number>>;
  /** Average buy price in SOL per token, by mint, from the wallet's recent buys; a mint with none is absent. */
  costBasis(wallet: string): Promise<ReadonlyMap<string, number>>;
  quotes(mints: readonly string[]): Promise<ReadonlyMap<string, Quote>>;
  curve(mint: string): Promise<{ readonly kind: 'curve'; readonly progress: number; readonly complete: boolean } | { readonly kind: 'none' }>;
}

const tokenHref = (mint: string) => `/#/token/${encodeURIComponent(`solana:${mint}`)}`;

async function spent(db: Db, userId: string, kind: AlertKind, subject: string): Promise<number[]> {
  const rows = await db.query<{ rung: number }>('select rung from people.alert_claim where user_id = $1 and kind = $2 and subject = $3', [userId, kind, subject]);
  return rows.map((r) => r.rung);
}

/** The level a holding should alert at now, if any. Pure. */
export function holdingLevel(r: { readonly held: number; readonly costSol: number | undefined; readonly quote: Quote | undefined; readonly multiples: readonly number[]; readonly spent: readonly number[] }, P: NotifyPolicy): { readonly level: number; readonly facts: Facts } | null {
  if (r.costSol === undefined || !(r.costSol > 0) || r.quote?.priceSol == null) return null;
  const positionUsd = r.quote.priceUsd === null ? null : r.held * r.quote.priceUsd;
  if (positionUsd === null || positionUsd < P.minPositionUsd) return null;
  const level = highestMilestone(r.quote.priceSol / r.costSol, r.multiples, r.spent, P);
  return level === null ? null : { level, facts: { symbol: r.quote.ticker, multiple: level, positionUsd } };
}

export async function checkMarket(db: Db, ports: MarketPorts, P: NotifyPolicy): Promise<number> {
  let queued = 0;
  const people = await db.query<{ userId: string; wallet: string | null }>('select user_id as "userId", wallet from people.profile');
  const watches = await db.query<{ userId: string; storyId: string; title: string; coins: unknown }>(
    `select w.user_id as "userId", w.story_id as "storyId", coalesce(v.payload ->> 'title', '') as title, v.payload -> 'coins' as coins
       from people.watch w join public.story_view v on v.story_id = w.story_id`,
  );
  const held = new Map<string, Map<string, number>>();
  const basis = new Map<string, ReadonlyMap<string, number>>();
  for (const p of people) {
    if (p.wallet === null) continue;
    try {
      held.set(p.userId, new Map(await ports.balances(p.wallet)));
      basis.set(p.userId, await ports.costBasis(p.wallet));
    } catch {
      /* This wallet is skipped this pass. */
    }
  }
  const watchedCoins = watches.flatMap((w) => {
    const c = (typeof w.coins === 'string' ? JSON.parse(w.coins) : w.coins) as { kind?: string; coin?: { address?: string }; coins?: { address?: string }[] } | null;
    const list = c?.kind === 'one' && c.coin ? [c.coin] : c?.kind === 'several' ? (c.coins ?? []) : [];
    return list.flatMap((x) => (typeof x.address === 'string' ? [{ userId: w.userId, mint: x.address, title: w.title }] : []));
  });
  const mints = [...new Set([...[...held.values()].flatMap((m) => [...m.keys()]), ...watchedCoins.map((w) => w.mint)])];
  let quotes: ReadonlyMap<string, Quote> = new Map();
  try {
    quotes = await ports.quotes(mints);
  } catch {
    return 0;
  }

  for (const p of people) {
    const prefs = await prefsOf(db, p.userId, P);
    const h = held.get(p.userId);
    const b = basis.get(p.userId);
    if (h !== undefined && b !== undefined) {
      for (const [mint, amount] of h) {
        const hit = holdingLevel({ held: amount, costSol: b.get(mint), quote: quotes.get(mint), multiples: prefs.multiples, spent: await spent(db, p.userId, 'holding_multiple', mint) }, P);
        if (hit !== null) {
          await queue(db, { userId: p.userId, kind: 'holding_multiple', subject: mint, rung: hit.level, facts: hit.facts, href: tokenHref(mint) });
          queued += 1;
        }
      }
    }
  }

  for (const w of watchedCoins) {
    const q = quotes.get(w.mint);
    if (q?.priceUsd == null) continue;
    await db.query('insert into people.watch_coin (user_id, mint, reference_usd) values ($1, $2, $3) on conflict do nothing', [w.userId, w.mint, q.priceUsd]);
    const [ref] = await db.query<{ ref: number }>('select reference_usd as ref from people.watch_coin where user_id = $1 and mint = $2', [w.userId, w.mint]);
    if (ref === undefined) continue;
    const prefs = await prefsOf(db, w.userId, P);
    const level = highestMilestone(q.priceUsd / ref.ref, prefs.multiples, await spent(db, w.userId, 'watchlist_multiple', w.mint), P);
    if (level !== null) {
      await queue(db, { userId: w.userId, kind: 'watchlist_multiple', subject: w.mint, rung: level, facts: { symbol: q.ticker, multiple: level, title: w.title }, href: tokenHref(w.mint) });
      queued += 1;
    }
  }

  /* Curves: each coin read once, then told to everyone holding or watching it. */
  const audience = new Map<string, Set<string>>();
  for (const [userId, m] of held) for (const mint of m.keys()) audience.set(mint, (audience.get(mint) ?? new Set()).add(userId));
  for (const w of watchedCoins) audience.set(w.mint, (audience.get(w.mint) ?? new Set()).add(w.userId));
  const opened = new Set((await db.query<{ key: string }>(`select key from people.pipeline_seen where stream = 'curve-open'`)).map((r) => r.key));
  for (const [mint, users] of audience) {
    const curve = await ports.curve(mint).catch(() => ({ kind: 'none' as const }));
    if (curve.kind === 'none') continue;
    const symbol = quotes.get(mint)?.ticker ?? '';
    if (!curve.complete) {
      await db.query(`insert into people.pipeline_seen (stream, key) values ('curve-open', $1) on conflict do nothing`, [mint]);
      if (curve.progress >= P.graduatingSoonAt) {
        for (const userId of users) {
          if ((await spent(db, userId, 'graduating_soon', mint)).length > 0) continue;
          await queue(db, { userId, kind: 'graduating_soon', subject: mint, rung: 0, facts: { symbol, percent: curve.progress * 100 }, href: tokenHref(mint) });
          queued += 1;
        }
      }
    } else if (opened.has(mint)) {
      for (const userId of users) {
        if ((await spent(db, userId, 'graduated', mint)).length > 0) continue;
        await queue(db, { userId, kind: 'graduated', subject: mint, rung: 0, facts: { symbol }, href: tokenHref(mint) });
        queued += 1;
      }
    }
  }
  return queued;
}
