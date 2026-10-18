/**
 * GET /wallet/:address?range=1h|6h|24h — the Portfolio tab and the portfolio on a profile: what a
 * wallet holds, what it is worth, what each coin cost when Insidor made the buy, the narrative each
 * coin came from when the match is confident, and the coins it created through Insidor. Trador's
 * Stonkfolio, read-only, cut to launchpad coins.
 *
 * ★ READ-ONLY, AND NEEDS NO KEY. Everything here is public chain and market data plus the facts of
 * trades already on the chain: no signer, no TRADING switch. This route has no way to tell who is
 * asking (there is no sign-in token on it), so it serves what any block explorer would. Whether a
 * profile shows a wallet at all is the social service's decision (its `portfolio` field), as
 * Trador withholds the wallet of a private Stonkfolio; this route never edge-caches (edge-cache.ts).
 *
 * ★ COST BASIS FROM OUR OWN TRADE RECORD, NOT A GUESS. A coin's cost is the SOL its landed buys
 * paid, from `public.trade` (0062: status confirmed, kind buy or sell), at average cost, a sell
 * taking out its share (Trador's walletTrades.ts). A buy made outside Insidor is not in the record,
 * so a coin bought only elsewhere has no gain ("not_bought_here"), and one held beyond what was
 * bought here has its gain measured on the covered part only, marked partial. A buy's coin amount is
 * the quote the trade service recorded, not the landed amount, which slippage can raise (never
 * lower, past `bound`); the SOL paid is exact.
 *
 * ★ GAINS ARE IN SOL, SHOWN IN TODAY'S DOLLARS. Trador values each past buy at SOL's dollar price
 * that minute; we store no history of SOL's price, so the gain is measured in SOL (worth in SOL now,
 * minus SOL paid) and then converted at today's SOL price, `usd` null when that is unknown. The
 * screen says so under the list.
 *
 * ★ A NARRATIVE ONLY ON A CONFIDENT MATCH. A coin shows the narrative whose page names it as its
 * one coin (`kind: 'one'`); "several", "unsure" and "none" show nothing.
 *
 * Each read may add one point to the balance chart (0041's narrow append function, at most once
 * a `snapshotGapMs`); `history` serves those points. The chart starts when the wallet was first
 * read, and says so.
 *
 * An outage is said, never shown as an empty wallet. Answers are kept `wallet.keepMs` and each
 * client may ask `wallet.perClient` times a `windowMs`, so free RPC tiers last.
 *
 * What breaks if changed carelessly: reading trades whose status is not `confirmed` counts a buy
 * that never landed as money spent, and every gain on that coin comes out too low.
 */

import type { WalletPolicy } from '@insidor/contracts/policy.ts';
import { NATIVE, positionsFrom, profitOf, type Balances, type Profit, type Trade } from '@insidor/chain-portfolio';
import type { CoinQuote } from '@insidor/market-dexscreener';

import type { Logger } from './log.ts';
import type { Db, Row } from './queries.ts';

/* A coin's one confident narrative: its page names exactly this coin. */
export const CONFIDENT_NARRATIVE_SQL = `
select s.story_id, s.payload ->> 'title' as title, s.payload #>> '{coins,coin,address}' as address
  from public.story_view s
 where s.payload #>> '{coins,kind}' = 'one'
   and s.payload #>> '{coins,coin,address}' = any($1)`;

export const CREATED_SQL = `
select c.address, c.story_id, c.created_at, n.name, n.ticker
  from public.created_coin c
  left join public.coin_name n on n.address = c.address
 where c.creator = $1
 order by c.created_at desc`;

/* A wallet's landed buys and sells, newest `$2` (trade_landed_idx, 0109), turned oldest first in code. */
export const LANDED_TRADES_SQL = `
select kind, mint, in_amount::text as in_amount, out_amount::text as out_amount, (extract(epoch from settled_at) * 1000)::bigint as at
  from public.trade
 where wallet = $1 and status = 'confirmed' and kind in ('buy', 'sell') and settled_at is not null and mint is not null
 order by settled_at desc
 limit $2`;

/**
 * Our trade rows as trades, for the coins held now (only their decimals are known). A buy's SOL is
 * `in_amount` lamports and its coins `out_amount`; a sell's coins are `in_amount` and its SOL
 * `out_amount`. A row with an amount that is not a positive number is skipped, never read as zero.
 */
export function tradesFromRecord(rows: readonly Row[], decimalsOf: ReadonlyMap<string, number>): Trade[] {
  return rows.flatMap((r): Trade[] => {
    const mint = str(r['mint']);
    const kind = r['kind'];
    const decimals = mint === null ? undefined : decimalsOf.get(mint);
    if (mint === null || decimals === undefined || (kind !== 'buy' && kind !== 'sell')) return [];
    const inAmount = Number(r['in_amount']);
    const outAmount = Number(r['out_amount']);
    if (!(inAmount > 0) || !(outAmount > 0)) return [];
    const coins = (kind === 'buy' ? outAmount : inAmount) / 10 ** decimals;
    const sol = (kind === 'buy' ? inAmount : outAmount) / 1e9;
    return [{ signature: '', at: Number(r['at']), mint, side: kind, amount: coins, sol }];
  });
}

/* The balance chart's one write: append a point if the wallet's newest is older than the gap (0041). */
export const RECORD_SNAPSHOT_SQL = `select public.record_wallet_snapshot($1, $2, $3)`;
export const SNAPSHOTS_SQL = `
select (extract(epoch from at) * 1000)::bigint as t, total_usd
  from public.wallet_snapshot
 where address = $1 and at >= $2
 order by at asc`;

/** The chart's windows, Trador's: a day, a week, a month, everything. */
const HISTORY_RANGES: Readonly<Record<string, number | null>> = { '1d': 86_400_000, '1w': 604_800_000, '1m': 2_592_000_000, all: null };

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RANGES = ['1h', '6h', '24h'] as const;
type Range = (typeof RANGES)[number];
/** Coins asked about for prices at most: a wallet sent a thousand airdrops is not priced a thousand times. */
const PRICED_AT_MOST = 300;

export interface WalletDeps {
  readonly db: Db;
  readonly log: Logger;
  readonly policy: WalletPolicy;
  readonly reader: {
    balances(owner: string): Promise<Balances>;
  } | null;
  readonly quotes: { quotes(addresses: readonly string[]): Promise<ReadonlyMap<string, CoinQuote>> };
  readonly images: ((mints: readonly string[]) => Promise<ReadonlyMap<string, string>>) | null;
  readonly creatorFees: ((creator: string) => Promise<bigint>) | null;
  readonly now: () => number;
}

type Measured = { readonly v: number } | { readonly v: null; readonly why: string };
const measured = (v: number | null | undefined, why: string): Measured => (v === null || v === undefined || !Number.isFinite(v) ? { v: null, why } : { v });
const json = (status: number, value: unknown) => ({ status, body: JSON.stringify(value) });
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Base units → a decimal number of coins, for valuing only. The exact amount travels as text. */
const units = (amount: string, decimals: number): number => Number(amount) / 10 ** decimals;

/**
 * A holding's gain on the wire: SOL, its share of what was paid, and today's dollars (null with no
 * SOL price). No recorded buy is `not_bought_here`; a record that could not be read is
 * `history_unread`.
 */
export function profitWire(profit: Profit, solUsd: number | null, historyRead: boolean) {
  if (!historyRead) return { kind: 'none', why: 'history_unread' } as const;
  if (profit.kind === 'none') return { kind: 'none', why: 'not_bought_here' } as const;
  return {
    kind: 'known',
    sol: profit.sol,
    costSol: profit.costSol,
    pct: (profit.sol / profit.costSol) * 100,
    usd: measured(solUsd === null ? null : profit.sol * solUsd, 'no_market'),
    partial: profit.partial,
  } as const;
}

export function createWallet(deps: WalletDeps) {
  const kept = new Map<string, { at: number; reply: { status: number; body: string } }>();
  const calls = new Map<string, number[]>();

  async function read(address: string, range: Range): Promise<{ status: number; body: string }> {
    if (deps.reader === null) return json(200, { kind: 'unavailable', why: 'not_reported' });
    let balances: Balances;
    try {
      balances = await deps.reader.balances(address);
    } catch (e) {
      deps.log.info('wallet balances unavailable', { err: e instanceof Error ? e.message : String(e) });
      return json(200, { kind: 'unavailable', why: 'not_read_yet' });
    }

    const mints = balances.tokens.map((t) => t.mint);
    const priced = mints.slice(0, PRICED_AT_MOST);
    let quotes: ReadonlyMap<string, CoinQuote> = new Map();
    try {
      quotes = await deps.quotes.quotes([NATIVE, ...priced]);
    } catch (e) {
      deps.log.info('wallet prices unavailable', { err: e instanceof Error ? e.message : String(e) });
    }
    const solUsd = quotes.get(NATIVE)?.priceUsd ?? null;
    const sol = units(balances.lamports, 9);

    /* Cost basis: this wallet's landed trades in Insidor. A failed read is said, never a zero. */
    let positions: ReturnType<typeof positionsFrom> = new Map();
    let historyRead = false;
    try {
      const rows = await deps.db.query(LANDED_TRADES_SQL, [address, deps.policy.tradesRead]);
      positions = positionsFrom(tradesFromRecord(rows, new Map(balances.tokens.map((t) => [t.mint, t.decimals]))));
      historyRead = true;
    } catch (e) {
      deps.log.info('wallet trades unavailable', { err: e instanceof Error ? e.message : String(e) });
    }

    const [narratives, names] = await Promise.all([
      deps.db.query(CONFIDENT_NARRATIVE_SQL, [mints]),
      deps.db.query(`select address, name, ticker from public.coin_name where address = any($1)`, [mints]),
    ]);
    const narrativeOf = new Map(narratives.map((r: Row) => [str(r['address']) ?? '', { storyId: str(r['story_id']), title: str(r['title']) }]));
    const nameOf = new Map(names.map((r: Row) => [str(r['address']) ?? '', { name: str(r['name']), ticker: str(r['ticker']) }]));

    const holdings = balances.tokens.map((t) => {
      const q = quotes.get(t.mint);
      const held = units(t.amount, t.decimals);
      const valueUsd = q?.priceUsd == null ? null : held * q.priceUsd;
      const valueSol = q?.priceSol == null ? null : held * q.priceSol;
      const change = q === undefined ? null : range === '1h' ? q.change.h1 : range === '6h' ? q.change.h6 : q.change.h24;
      const profit: Profit = profitOf(held, valueSol, positions.get(t.mint));
      const narrative = narrativeOf.get(t.mint);
      const name = nameOf.get(t.mint);
      return {
        coinId: `solana:${t.mint}`,
        address: t.mint,
        ticker: name?.ticker ?? q?.ticker ?? null,
        name: name?.name ?? q?.name ?? null,
        imageUrl: null as string | null,
        amount: t.amount,
        decimals: t.decimals,
        priceUsd: measured(q?.priceUsd, q === undefined ? 'no_market' : 'not_reported'),
        valueUsd: measured(valueUsd, q === undefined ? 'no_market' : 'not_reported'),
        change: measured(change, q === undefined ? 'no_market' : 'not_reported'),
        profit: profitWire(profit, solUsd, historyRead),
        story: narrative !== undefined && narrative.storyId !== null && narrative.title !== null ? { storyId: narrative.storyId, title: narrative.title } : null,
      };
    }).sort((a, b) => (b.valueUsd.v ?? -1) - (a.valueUsd.v ?? -1));

    /* Pictures only for the coins shown, biggest first: the coin's own, from the chain. */
    const shown = holdings.slice(0, deps.policy.holdingsShown);
    const pictures = deps.images === null ? new Map<string, string>() : await deps.images(shown.map((h) => h.address)).catch(() => new Map<string, string>());
    for (const h of shown) h.imageUrl = pictures.get(h.address) ?? null;

    const coinsUsd = holdings.reduce((s, h) => s + (h.valueUsd.v ?? 0), 0);
    /* One point for the balance chart, at most once a gap; best effort — the holdings are the
       product, the chart is the decoration, and a failed write never fails the read. */
    if (solUsd !== null) {
      deps.db.query(RECORD_SNAPSHOT_SQL, [address, sol * solUsd + coinsUsd, deps.policy.snapshotGapMs]).catch((e: unknown) => {
        deps.log.info('wallet snapshot not recorded', { err: e instanceof Error ? e.message : String(e) });
      });
    }
    const unpriced = holdings.filter((h) => h.valueUsd.v === null).length;

    const createdRows = await deps.db.query(CREATED_SQL, [address]);
    let fees: Measured = measured(null, 'not_reported');
    if (createdRows.length > 0 && deps.creatorFees !== null) {
      try {
        fees = measured(units((await deps.creatorFees(address)).toString(), 9), 'not_read_yet');
      } catch {
        fees = measured(null, 'not_read_yet');
      }
    }
    let createdQuotes: ReadonlyMap<string, CoinQuote> = new Map();
    if (createdRows.length > 0) createdQuotes = await deps.quotes.quotes(createdRows.map((r) => str(r['address']) ?? '')).catch(() => new Map());

    return json(200, {
      kind: 'read',
      address,
      range,
      solBalance: { v: sol },
      totalUsd: measured(solUsd === null ? null : sol * solUsd + coinsUsd, 'no_market'),
      totalSol: measured(solUsd === null ? null : sol + coinsUsd / solUsd, 'no_market'),
      holdings: shown,
      notShown: Math.max(0, holdings.length - deps.policy.holdingsShown),
      unpriced,
      created: {
        unclaimedFeesSol: fees,
        coins: createdRows.map((r) => {
          const a = str(r['address']) ?? '';
          const q = createdQuotes.get(a);
          return { coinId: `solana:${a}`, address: a, name: str(r['name']) ?? q?.name ?? null, ticker: str(r['ticker']) ?? q?.ticker ?? null, marketCapUsd: measured(q?.marketCapUsd, 'no_market'), storyId: str(r['story_id']) };
        }),
      },
    });
  }

  const allow = (client: string, now: number): boolean => {
    const recent = (calls.get(client) ?? []).filter((t) => now - t < deps.policy.windowMs);
    if (recent.length >= deps.policy.perClient) return false;
    calls.set(client, [...recent, now]);
    return true;
  };

  return {
    /** GET /wallet/:address/history?range= — the balance chart's points, oldest first. */
    async history(address: string, rawRange: string | null, client: string) {
      if (!ADDRESS.test(address)) return json(400, { error: 'bad request' });
      const now = deps.now();
      if (!allow(client, now)) return json(429, { error: 'slow down' });
      const range = rawRange !== null && rawRange in HISTORY_RANGES ? rawRange : '1w';
      const span = HISTORY_RANGES[range] ?? null;
      const rows = await deps.db.query(SNAPSHOTS_SQL, [address, new Date(span === null ? 0 : now - span)]);
      return json(200, {
        range,
        points: rows.flatMap((r) => {
          const t = Number(r['t']);
          const v = Number(r['total_usd']);
          return Number.isFinite(t) && Number.isFinite(v) ? [{ t, value: v }] : [];
        }),
      });
    },

    async wallet(address: string, rawRange: string | null, client: string) {
      if (!ADDRESS.test(address)) return json(400, { error: 'bad request' });
      const range: Range = (RANGES as readonly string[]).includes(rawRange ?? '') ? (rawRange as Range) : '24h';
      const now = deps.now();
      if (!allow(client, now)) return json(429, { error: 'slow down' });
      const key = `${address}:${range}`;
      const held = kept.get(key);
      if (held !== undefined && now - held.at < deps.policy.keepMs) return held.reply;
      const reply = await read(address, range);
      kept.set(key, { at: now, reply });
      for (const [k, v] of kept) if (now - v.at >= deps.policy.keepMs) kept.delete(k);
      return reply;
    },
  };
}

export type WalletRoute = ReturnType<typeof createWallet>;
