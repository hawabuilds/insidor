/**
 * AUTO BUY ON A WATCHED POST: the routes the auto buy sheet saves to (the owner, 2026-11-05).
 *
 *   GET    /auto-buy/config        { allowed, choices }   whether this person may set one, and the sheet's choices
 *   GET    /auto-buy               { buys: [...] }        my auto buys that are still on, newest first
 *   GET    /auto-buy/:itemId       { buy | null }         my auto buy on this post
 *   PUT    /auto-buy/:itemId       { buy }                set or change it (and watch the post)
 *   DELETE /auto-buy/:itemId       { buy: null }          turn it off
 *
 * Its own file because it is one feature with its own tables (people.auto_buy, 0167) and the one
 * route in this service that can lead to money moving. The buying itself is not here: this only
 * saves what the person chose.
 *
 * ★ EVERY NUMBER IS CHECKED AGAINST THE POLICY, NOT TRUSTED FROM THE SHEET. The amount is capped at
 * `autoBuy.maxSol`; the market cap, slippage and time on must be one of the policy's choices
 * (or a positive custom cap); PvP at most `maxPvpCoins`. The wallet is the person's own embedded
 * wallet from their verified sign-in, never one the request names.
 *
 * ★ OWNER ONLY while `ownerOnly` is on: anyone else is told it is not available (403), and
 * `config` says `allowed: false`, so the app never draws the sheet for them.
 *
 * What breaks if changed carelessly: taking the wallet from the request body would let a request
 * point a buy at someone else's wallet; dropping a check lets the sheet send any amount.
 */

import type { AutoBuyPolicy, OwnerPolicy } from '@insidor/contracts/policy.ts';
import type { Person } from '@insidor/contracts/ports/people.ts';

import type { Db } from './deliver.ts';
import { json, type Reply } from './http.ts';
import { postWatchRoute } from './post-watch.ts';

const ITEM = /^[A-Za-z0-9:_\-.]{1,200}$/;
const LAMPORTS = 1_000_000_000;
const SPEEDS = ['normal', 'fast', 'turbo'] as const;
type Speed = (typeof SPEEDS)[number];

export interface AutoBuy {
  readonly itemId: string;
  readonly lamports: number;
  readonly maxCapUsd: number | null;
  readonly pvpCoins: number;
  readonly speed: Speed;
  readonly slippageBps: number;
  readonly activeUntil: number;
}

/** One buy's estimated fees at a speed: the base fee plus the priority fee over the buy's compute units. */
export const feeLamports = (p: AutoBuyPolicy, speed: Speed): number => Math.round(p.baseFeeSol * LAMPORTS) + Math.ceil((p.speedPriority[speed] * p.estComputeUnits) / 1_000_000);
/** The most one buy may be, in lamports. */
export const maxLamports = (p: AutoBuyPolicy): number => Math.round(p.maxSol * LAMPORTS);

/** Whether this person is the owner, as social's `ownerRefOf` decides it: a wallet exactly, an X handle in any case. */
export function isOwner(me: Person, owner: OwnerPolicy): boolean {
  if (me.wallets.some((w) => owner.wallets.includes(w.address))) return true;
  return me.handle !== null && owner.xHandles.includes(me.handle.toLowerCase());
}

/** Whether this person may set an auto buy at all, and the wallet it would come from. */
export function allowedWallet(me: Person, p: AutoBuyPolicy, owner: OwnerPolicy): string | null {
  if (!p.on) return null;
  if (p.ownerOnly && !isOwner(me, owner)) return null;
  return me.wallets.find((w) => w.kind === 'embedded')?.address ?? null;
}

/** The sheet's body checked against the policy; a reason when it is refused. */
export function readSettings(body: unknown, p: AutoBuyPolicy, now: number): { settings: Omit<AutoBuy, 'itemId'> } | { refused: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
  const lamports = int(b['lamports']);
  if (lamports === null || lamports <= 0) return { refused: 'Choose an amount.' };
  if (lamports > maxLamports(p)) return { refused: `At most ${p.maxSol} SOL a buy while auto buy is being tested.` };
  const cap = b['maxCapUsd'] === null ? null : typeof b['maxCapUsd'] === 'number' && b['maxCapUsd'] > 0 && Number.isFinite(b['maxCapUsd']) ? b['maxCapUsd'] : undefined;
  if (cap === undefined) return { refused: 'Choose a market cap limit.' };
  const pvp = int(b['pvpCoins']);
  if (pvp === null || pvp < 1 || pvp > p.maxPvpCoins) return { refused: 'Choose how many PvP coins.' };
  const speed = SPEEDS.find((s) => s === b['speed']);
  if (speed === undefined) return { refused: 'Choose a speed.' };
  const slippage = int(b['slippageBps']);
  if (slippage === null || !p.slippageChoicesBps.includes(slippage)) return { refused: 'Choose a slippage.' };
  const active = int(b['activeMs']);
  if (active === null || !p.activeChoicesMs.includes(active)) return { refused: 'Choose how long it stays on.' };
  return { settings: { lamports, maxCapUsd: cap, pvpCoins: pvp, speed, slippageBps: slippage, activeUntil: now + active } };
}

interface Row { itemId: string; lamports: string; maxCapUsd: string | null; pvpCoins: number; speed: Speed; slippageBps: number; activeUntil: string }
const SELECT = `select item_id as "itemId", lamports, max_cap_usd as "maxCapUsd", pvp_coins as "pvpCoins", speed, slippage_bps as "slippageBps", active_until as "activeUntil" from people.auto_buy`;
const fromRow = (r: Row): AutoBuy => ({
  itemId: r.itemId,
  lamports: Number(r.lamports),
  maxCapUsd: r.maxCapUsd === null ? null : Number(r.maxCapUsd),
  pvpCoins: r.pvpCoins,
  speed: r.speed,
  slippageBps: r.slippageBps,
  activeUntil: new Date(r.activeUntil).getTime(),
});

export async function autoBuyRoute(db: Db, method: string, seg: readonly string[], me: Person, body: unknown, deps: { readonly policy: AutoBuyPolicy; readonly owner: OwnerPolicy; readonly now: () => number }): Promise<Reply | null> {
  if (seg[0] !== 'auto-buy') return null;
  const p = deps.policy;
  const wallet = allowedWallet(me, p, deps.owner);
  if (seg.length === 2 && seg[1] === 'config' && method === 'GET') {
    return json(200, {
      allowed: wallet !== null,
      choices: { amountsLamports: p.amountChoicesSol.map((sol) => Math.round(sol * LAMPORTS)), capsUsd: p.capChoicesUsd, slippagesBps: p.slippageChoicesBps, activeMs: p.activeChoicesMs, maxPvpCoins: p.maxPvpCoins, maxLamports: maxLamports(p) },
      mode: p.mode,
      /* What each speed costs a buy in fees (network base fee plus priority fee), for the sheet's "Est. fees". Insidor takes no fee (Policy.trade.platformFeeBps 0). */
      feeLamports: Object.fromEntries(SPEEDS.map((sp) => [sp, feeLamports(p, sp)])),
    });
  }
  if (wallet === null) return json(403, { error: 'Auto buy is not available yet.' });
  if (seg.length === 1 && method === 'GET') {
    const rows = await db.query<Row>(`${SELECT} where user_id = $1 and active_until > now() order by created_at desc limit 200`, [me.userId]);
    return json(200, { buys: rows.map(fromRow) });
  }
  if (seg.length !== 2) return null;
  let itemId: string;
  try {
    itemId = decodeURIComponent(seg[1] ?? '');
  } catch {
    return json(400, { error: 'bad request' });
  }
  if (!ITEM.test(itemId)) return json(400, { error: 'bad request' });
  if (method === 'GET') {
    const [row] = await db.query<Row>(`${SELECT} where user_id = $1 and item_id = $2 and active_until > now()`, [me.userId, itemId]);
    return json(200, { buy: row === undefined ? null : fromRow(row) });
  }
  if (method === 'PUT') {
    const read = readSettings(body, p, deps.now());
    if ('refused' in read) return json(400, { error: read.refused });
    const s = read.settings;
    await db.query(
      `insert into people.auto_buy (user_id, item_id, wallet, lamports, max_cap_usd, pvp_coins, speed, slippage_bps, active_until)
       values ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9 / 1000.0))
       on conflict (user_id, item_id) do update set wallet = excluded.wallet, lamports = excluded.lamports, max_cap_usd = excluded.max_cap_usd,
         pvp_coins = excluded.pvp_coins, speed = excluded.speed, slippage_bps = excluded.slippage_bps, active_until = excluded.active_until, updated_at = now()`,
      [me.userId, itemId, wallet, s.lamports, s.maxCapUsd, s.pvpCoins, s.speed, s.slippageBps, s.activeUntil],
    );
    /* An auto buy is on a watched post: watched through the star's own route, so what the post already shows is marked seen the same way. */
    await postWatchRoute(db, 'PUT', ['post-watch', encodeURIComponent(itemId)], me.userId);
    return json(200, { buy: { itemId, ...s } });
  }
  if (method === 'DELETE') {
    await db.query('delete from people.auto_buy where user_id = $1 and item_id = $2', [me.userId, itemId]);
    return json(200, { buy: null });
  }
  return null;
}
