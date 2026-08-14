/**
 * The bonding-curve venue, assembled.
 *
 * A venue is a market on a chain, and it is the unit of variation: this venue
 * differs from a pooled market on the same chain more than that pooled market
 * differs from one on another chain. Flattening the two into "the chain
 * adapter" pushes the difference into branches, which is the failure being
 * fixed one layer up.
 *
 * `enabled` is a field rather than a deletion: a venue that breaks gets turned
 * off, keeps its recorded history and its labels, and can be turned back on.
 */

import type { Millis } from '@insidor/contracts';
import type { MarketState, MintTime, TransferRules } from '@insidor/contracts/asset.ts';
import { chainId, venueId } from '@insidor/contracts/ids.ts';
import type { AssetRef, ChainId, VenueId } from '@insidor/contracts/ids.ts';
import type { Budget, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { MintEvent, MintPage, QuoteRequest, QuoteResult, Venue } from '@insidor/contracts/ports/venue.ts';
import { mergeSpend, metered } from '@insidor/meter';
import type { Price, PriceBook } from '@insidor/meter';

import { toTransferRules } from './assess.ts';
import type { ChainClient, LaunchpadClient } from './client.ts';
import { mintTime } from './mint-time.ts';
import type { MintTimeOptions } from './mint-time.ts';
import { toMarketState, toReserves } from './read.ts';
import { execute, quoteBuy } from './trade.ts';
import { toMintEvent } from './watch.ts';

export const CHAIN: ChainId = chainId('solana');
export const VENUE_ID: VenueId = venueId(CHAIN, 'pumpfun');
export const VENDOR = 'pumpfun';
export const RPC_VENDOR = 'chain-rpc';

/** A venue fact: every asset issued here has the same decimals. */
export const TOKEN_DECIMALS = 6;
/** A chain fact: the base asset's decimals. */
export const BASE_DECIMALS = 9;

const LIST = 'list';
const COIN = 'coin';
const SIGNATURES = 'signatures';
const ACCOUNT = 'account';

const price = (vendor: string, endpoint: string, unit: Price['unit'], usdPerUnit: number, unitName: string): Price => ({
  vendor,
  endpoint,
  unit,
  usdPerUnit,
  unitName,
  measuredAt: '2026-08-05',
});

export const PRICES: PriceBook = {
  [`${VENDOR}:${LIST}`]: price(VENDOR, LIST, 'flat', 0, 'call on a free endpoint'),
  [`${VENDOR}:${COIN}`]: price(VENDOR, COIN, 'flat', 0, 'call on a free endpoint'),
  [`${RPC_VENDOR}:${SIGNATURES}`]: price(RPC_VENDOR, SIGNATURES, 'per-call', 0.000_02, 'rpc call'),
  [`${RPC_VENDOR}:${ACCOUNT}`]: price(RPC_VENDOR, ACCOUNT, 'per-call', 0.000_02, 'rpc call'),
};

export interface PumpfunVenueDeps {
  readonly issuer: LaunchpadClient;
  readonly chain: ChainClient;
  readonly meter: Meter;
  readonly now: () => Millis;
  /** How far two sources may disagree and still be 'exact'. From policy. */
  readonly mintTimeOptions: MintTimeOptions;
  /** OUR fee, in bps. From policy. This package names no product number. */
  readonly platformFeeBps: number;
  /** Price of the base asset, or null. Null renders as no USD figure, never 0. */
  readonly baseUsd: () => number | null;
  /** Fees the caller intends to attach, so the quote itemises what will be paid. */
  readonly networkLamports: bigint;
  readonly priorityLamports: bigint;
  /**
   * How many of this venue's own adjudicated labels exist. Read from the store,
   * never assumed: scores are not comparable across venues, so a venue under
   * the policy floor may produce 'unsure' at most and its first month is
   * read-only by construction.
   */
  readonly adjudicatedLabels: number;
  /** Items per page when polling for new assets. */
  readonly pageSize: number;
  readonly prices?: PriceBook;
}

export function pumpfunVenue(deps: PumpfunVenueDeps): Venue {
  const prices = deps.prices ?? PRICES;

  const readCoin = async (address: string, at: Millis): Promise<Metered<unknown>> =>
    metered(deps.meter, prices, { vendor: VENDOR, endpoint: COIN, unit: 'flat', estUnits: 1, at }, async () => ({
      value: await deps.issuer.getCoin(address),
      units: 1,
    }));

  const readAccount = async (address: string, at: Millis): Promise<Metered<TransferRules>> =>
    metered(
      deps.meter,
      prices,
      { vendor: RPC_VENDOR, endpoint: ACCOUNT, unit: 'per-call', estUnits: 1, at },
      async () => ({ value: toTransferRules(await deps.chain.tokenAccountState(address)), units: 1 }),
    );

  const stateOf = async (asset: AssetRef, at: Millis): Promise<Metered<MarketState>> => {
    const coin = await readCoin(asset.address, at);

    // Read once, from the same payload the price came from. A mint time
    // assembled from a different read is a different fact.
    const minted: MintTime = mintTime(
      { issuerMs: readCreatedAt(coin.value), chainMs: null, vendorMs: null, observedMs: null },
      deps.mintTimeOptions,
    );

    let rules: TransferRules | null = null;
    let rulesSpend = coin.spend;
    try {
      const read = await readAccount(asset.address, at);
      rules = read.value;
      rulesSpend = read.spend;
    } catch {
      // Unread, not fine. `transferRules: null` downstream is what stops the
      // gate; swallowing this into a passing rule set is how an outage becomes
      // a market full of safe-looking assets.
      rules = null;
    }

    return {
      value: toMarketState(coin.value, {
        asset,
        venue: VENUE_ID,
        observedAt: at,
        baseUsd: deps.baseUsd(),
        tokenDecimals: TOKEN_DECIMALS,
        mintedAt: minted,
        transferRules: rules,
        endpoint: 'GET /coins/{address}',
        vendor: VENDOR,
      }),
      spend: mergeSpend(
        [coin.spend, rulesSpend],
        { vendor: VENDOR, endpoint: COIN, unit: 'flat', estUnits: 1, at },
        'flat',
      ),
    };
  };

  return {
    id: VENUE_ID,
    chain: CHAIN,
    market: 'bonding-curve',
    capabilities: ['watch', 'read', 'assess', 'trade'],
    enabled: true,
    adjudicatedLabels: deps.adjudicatedLabels,

    watch: {
      /**
       * Polling, not streaming. A creation stream decodes one program's create
       * instruction — venue-specific, not chain-specific — and buys nothing
       * against a six-day median to peak. The cursor is the caller's, so a
       * restart is a resumption rather than a gap, and a gap makes an outcome
       * label CENSORED rather than negative.
       */
      async since(cursor: string | null, _budget: Budget): Promise<Metered<MintPage>> {
        const seenAt = deps.now();
        const offset = cursor === null ? 0 : Math.max(0, Number.parseInt(cursor, 10) || 0);

        const rows = await metered(
          deps.meter,
          prices,
          { vendor: VENDOR, endpoint: LIST, unit: 'flat', estUnits: 1, at: seenAt },
          async () => ({ value: await deps.issuer.listNewCoins({ limit: deps.pageSize, offset }), units: 1 }),
        );

        const ctx = {
          chain: CHAIN,
          venue: VENUE_ID,
          seenAt,
          decimals: TOKEN_DECIMALS,
          mintTimeOptions: deps.mintTimeOptions,
        };
        const events: MintEvent[] = [];
        for (const row of rows.value) {
          // No chain confirmation on the polling path: a fresh asset is
          // 'bounded' until a second source agrees with the first.
          const event = toMintEvent(row, ctx, null);
          if (event !== null) events.push(event);
        }

        return {
          value: {
            events,
            cursor: String(offset + rows.value.length),
            // What this page ACTUALLY covers, so coverage is provable rather
            // than assumed — an unprovable window is a censored label.
            coveredFrom: events.reduce((min, e) => Math.min(min, e.mintedAt.at ?? min), seenAt),
            coveredTo: seenAt,
          },
          spend: rows.spend,
        };
      },
    },

    read: {
      async state(asset: AssetRef, _budget: Budget): Promise<Metered<MarketState>> {
        return stateOf(asset, deps.now());
      },

      async states(assets: readonly AssetRef[], _budget: Budget): Promise<Metered<readonly MarketState[]>> {
        const at = deps.now();
        const out: MarketState[] = [];
        const spends = [];
        // No batch endpoint here: one asset, one read. Saying so is better than
        // a helper that hides the call count from the ledger.
        for (const asset of assets) {
          const state = await stateOf(asset, at);
          out.push(state.value);
          spends.push(state.spend);
        }
        return {
          value: out,
          spend: mergeSpend(spends, { vendor: VENDOR, endpoint: COIN, unit: 'flat', estUnits: assets.length, at }, 'flat'),
        };
      },
    },

    assess: {
      async transferRules(asset: AssetRef, _budget: Budget): Promise<Metered<TransferRules>> {
        return readAccount(asset.address, deps.now());
      },
    },

    trade: {
      /**
       * Quotability, which is what "is there a market here?" means on a curve.
       * A vendor failure comes back as `unavailable`, never as `unquotable`, so
       * "this asset cannot be traded" and "our vendor is down" stay
       * distinguishable in one query.
       */
      async quote(request: QuoteRequest, _budget: Budget): Promise<Metered<QuoteResult>> {
        const at = deps.now();
        let coin: Metered<unknown>;
        try {
          coin = await readCoin(request.asset.address, at);
        } catch (error) {
          return {
            value: { kind: 'unavailable', detail: error instanceof Error ? error.message : 'read failed' },
            spend: { vendor: VENDOR, endpoint: COIN, unit: 'flat', units: 1, usd: 0, at },
          };
        }

        const reserves = toReserves(coin.value);
        if (reserves === null) {
          return { value: { kind: 'unavailable', detail: 'reserves missing from the payload' }, spend: coin.spend };
        }

        return {
          value: quoteBuy(request, {
            venue: VENUE_ID,
            reserves,
            tokenDecimals: TOKEN_DECIMALS,
            baseDecimals: BASE_DECIMALS,
            observedAt: at,
            networkLamports: deps.networkLamports,
            priorityLamports: deps.priorityLamports,
            // Whether the buyer already holds an account is the caller's fact,
            // not ours; assumed true so the quote never understates.
            needsTokenAccount: true,
            platformFeeBps: deps.platformFeeBps,
            baseUsd: deps.baseUsd(),
          }),
          spend: coin.spend,
        };
      },

      execute,
    },
  };
}

/** The issuer's creation timestamp, read from the same payload as the price. */
function readCreatedAt(raw: unknown): Millis | null {
  const value = (raw as { readonly created_timestamp?: unknown } | null)?.created_timestamp;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export { allInBps, buyOut, itemiseCosts, priceImpactBps, withSlippage, VENUE_FEE_BPS, NONCE_VALID_MS } from './curve.ts';
export { mintTime, assertMintTimeInvariants } from './mint-time.ts';
export type { MintTimeInputs, MintTimeOptions } from './mint-time.ts';
export { curveProgress, toMarketState, toReserves, GRADUATION_LAMPORTS } from './read.ts';
export type { CurveReserves, ReadContext } from './read.ts';
export { isTradeable, toTransferRules, REQUIRED_ON_CURVE, CHECK_CODES } from './assess.ts';
export type { CheckCode } from './assess.ts';
export { quoteBuy, execute } from './trade.ts';
export type { QuoteContext } from './trade.ts';
export { toMintEvent } from './watch.ts';
export { launchpadClient, chainClient } from './client.ts';
export type { ChainClient, LaunchpadClient, SolanaVenueClientConfig } from './client.ts';
export { createMintStream, openWebSocket, toStreamMintEvent } from './stream.ts';
export type {
  MintStream,
  MintStreamOptions,
  OpenSocket,
  StreamDecodeContext,
  StreamDrain,
  StreamHandlers,
  StreamNote,
  StreamOutage,
  StreamSocket,
} from './stream.ts';
export { boundedText, httpsUri, mintAddress } from './hostile.ts';
