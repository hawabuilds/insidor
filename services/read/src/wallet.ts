/**
 * GET /wallet/:address?range=1h|6h|24h — the Wallet tab: what a wallet holds, what it is worth,
 * what each coin cost when we can see it, the narrative each coin came from when the match is
 * confident, and the coins it created through Insidor. Trador's Stonkfolio, read-only, cut to
 * launchpad coins.
 *
 * ★ READ-ONLY, AND NEEDS NO KEY. Everything here is public chain and market data: no signer, no
 * TRADING switch. The phone app asks only for the signed-in person's own wallet; this route has
 * no way to tell who is asking (there is no sign-in token on it yet), so it serves what any block
 * explorer would — balances and public transactions — and nothing private. Checking the
 * vendor's sign-in token here is the step that would let it refuse other people's wallets.
 *
 * ★ NO BUY HISTORY, NO NUMBER. Profit is shown in SOL, only for a coin whose buys we read in the
 * wallet's recent transactions (`wallet.signaturesRead`). Anything else says "no buy history".
 *
 * ★ A NARRATIVE ONLY ON A CONFIDENT MATCH. A coin shows the narrative whose page names it as its
 * one coin (`kind: 'one'`); "several", "unsure" and "none" show nothing.
 *
 * An outage is said, never shown as an empty wallet. Answers are kept `wallet.keepMs` and each
 * client may ask `wallet.perClient` times a `windowMs`, so free RPC and parsing tiers last.
 */

import type { WalletPolicy } from '@insidor/contracts/policy.ts';
import { NATIVE, positionsFrom, profitOf, tradesFromTx, type Balances, type ParsedTx, type Profit } from '@insidor/chain-portfolio';
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
    signatures(owner: string, limit: number): Promise<readonly string[]>;
    parse(signatures: readonly string[]): Promise<readonly ParsedTx[]>;
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

    /* Buy history: the recent transactions, parsed once, read by balance change. */
    let positions: ReturnType<typeof positionsFrom> = new Map();
    let historyRead = false;
    try {
      const sigs = await deps.reader.signatures(address, deps.policy.signaturesRead);
      const parsed = await deps.reader.parse(sigs);
      positions = positionsFrom(parsed.flatMap((tx) => tradesFromTx(tx, address)));
      historyRead = parsed.length > 0 || sigs.length === 0;
    } catch (e) {
      deps.log.info('wallet history unavailable', { err: e instanceof Error ? e.message : String(e) });
    }

    const [narratives, names, pictures] = await Promise.all([
      deps.db.query(CONFIDENT_NARRATIVE_SQL, [mints]),
      deps.db.query(`select address, name, ticker from public.coin_name where address = any($1)`, [mints]),
      deps.images === null ? Promise.resolve(new Map<string, string>()) : deps.images(mints.slice(0, deps.policy.holdingsShown * 2)).catch(() => new Map<string, string>()),
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
        imageUrl: pictures.get(t.mint) ?? null,
        amount: t.amount,
        decimals: t.decimals,
        valueUsd: measured(valueUsd, q === undefined ? 'no_market' : 'not_reported'),
        change: measured(change, q === undefined ? 'no_market' : 'not_reported'),
        profit: profit.kind === 'known'
          ? { kind: 'known', sol: profit.sol, partial: profit.partial }
          : { kind: 'none', why: historyRead ? 'no_buy_history' : 'history_unread' },
        narrative: narrative !== undefined && narrative.storyId !== null && narrative.title !== null ? { storyId: narrative.storyId, title: narrative.title } : null,
      };
    }).sort((a, b) => (b.valueUsd.v ?? -1) - (a.valueUsd.v ?? -1));

    const coinsUsd = holdings.reduce((s, h) => s + (h.valueUsd.v ?? 0), 0);
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
      holdings: holdings.slice(0, deps.policy.holdingsShown),
      notShown: Math.max(0, holdings.length - deps.policy.holdingsShown),
      unpriced,
      historyDepth: deps.policy.signaturesRead,
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

  return {
    async wallet(address: string, rawRange: string | null, client: string) {
      if (!ADDRESS.test(address)) return json(400, { error: 'bad request' });
      const range: Range = (RANGES as readonly string[]).includes(rawRange ?? '') ? (rawRange as Range) : '24h';
      const now = deps.now();
      const recent = (calls.get(client) ?? []).filter((t) => now - t < deps.policy.windowMs);
      if (recent.length >= deps.policy.perClient) return json(429, { error: 'slow down' });
      calls.set(client, [...recent, now]);
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
