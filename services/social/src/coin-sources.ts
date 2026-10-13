/**
 * THE FREE SOURCES THE OWNER'S COIN CHECK READS, WIRED: the chain and the launchpad's image service
 * through the launchpad adapter, the two market sources' searches, and the on-chain market's
 * hourly candles. coin-check.ts holds the rule; this file only says which adapter answers which
 * question, so the rule never names a vendor.
 *
 * Separate from main.ts so a local check (and its test harness) can build the same sources
 * without starting the server.
 *
 * ★ FREE ONLY. The market candles are asked of the keyless public API at its own limit, kept
 * apart from the read service's paid plan: the owner checks one address at a time, and this
 * service holds no market key and must not need one.
 *
 * What breaks if changed carelessly: the timeouts. The owner taps Check and waits on the slowest
 * source; each read is cut at `TIMEOUT_MS` and a source that did not answer counts as not read.
 */

import { dexscreenerSearch } from '@insidor/market-dexscreener';
import { BASE_URLS, geckoterminal } from '@insidor/market-geckoterminal';
import { chainClient, launchpadPicture } from '@insidor/venue-solana-pumpfun';

import { coinCheck, type CoinCheck } from './coin-check.ts';

const TIMEOUT_MS = 8_000;

export function liveCoinCheck(rpcUrl: string | null, fetch: typeof globalThis.fetch = globalThis.fetch): CoinCheck {
  const chain = rpcUrl === null ? null : chainClient({ launchpadBaseUrl: '', rpcUrl, fetch });
  const candles = geckoterminal({ plan: 'free', baseUrl: BASE_URLS.free, fetch, timeoutMs: TIMEOUT_MS, now: Date.now });
  return coinCheck({
    launchpad:
      chain === null
        ? null
        : {
            known: async (mint) => (await chain.metadataUri(mint)) !== null,
            launchedAtSeconds: (mint) => chain.oldestSignatureBlockTime(mint),
            picture: (mint) => launchpadPicture(mint, { fetch, timeoutMs: TIMEOUT_MS }),
          },
    markets: [dexscreenerSearch({ baseUrl: 'https://api.dexscreener.com', fetch, timeoutMs: TIMEOUT_MS }), candles],
    history: async (mint) => {
      const m = await candles.coin(mint, '1h');
      if (m.pool === null || m.candles === null || m.candles.length === 0) return null;
      const last = m.candles.reduce((a, b) => (b.t > a.t ? b : a));
      return { highest: Math.max(...m.candles.map((c) => c.h)), last: last.c };
    },
  });
}
