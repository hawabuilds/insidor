/**
 * "LAUNCHED" FROM THE CHAIN (Policy.narrative.launchClock, on from 2026-10-18): the
 * coins the narrative pages name whose stored launch is not the create transaction's block time
 * have their oldest transaction's block time read and stored as the chain's (public.asset, through
 * the asset repo's `setMintTime`, which only ever raises a mint time's confidence).
 *
 * Why: the owner, 2026-10-18 — "'launched' must be the block time of the create transaction on
 * chain. Never use any other time." The read service now prints a launch only from the chain's
 * clock (services/read post-sheet.ts `launchClock`); most coins were stored from the live launch
 * notice (106,111 of 127,547 on 2026-10-18), which is seconds off the block and not the block. On
 * the Tesla Roadster's coin the notice said 01:59:23.4 UTC and the create transaction's block was
 * 01:59:28.
 *
 * Bounded three ways: ONE call a coin (the chain client's `oldestSignatureBlockTime` asks for the
 * oldest row only and never walks pages: a coin with a million trades costs what a new one does),
 * at most `perPass` reads a pass and `perDay` a UTC day in the process, and each coin tried once in
 * the process (an RPC that does not serve the oldest-first read fails the same way every time, and
 * must not be asked every two minutes). A coin not read stays "launch not known", never another
 * time. A restart starts a fresh count and tries again the coins that failed: at most `perDay` more.
 *
 * What breaks if changed carelessly: the block time is the oldest transaction's, so it is right only
 * for an address created by its first transaction, which a mint is. Never point this at a wallet.
 */

import type { Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';

import { errorText, type Logger } from '../log.ts';

export interface LaunchClockDeps {
  /** The page coins with no chain launch time, newest first (store narratives `pageCoinsWithoutChainTime`). */
  readonly due: (limit: number) => Promise<readonly string[]>;
  /** The oldest transaction's block time, in seconds; null when the address has none. Null: no chain access. */
  readonly oldestBlockTime: ((address: string) => Promise<number | null>) | null;
  /** Stores a chain launch time; never lowers a better one. */
  readonly keep: (address: string, atMs: Millis) => Promise<void>;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

/** What this process has read today: the `perDay` count, by UTC day. */
export interface LaunchClockDay {
  day: string;
  read: number;
}

export interface LaunchClockResult {
  readonly read: number;
  readonly kept: number;
  readonly failed: number;
}

export async function launchClockPass(deps: LaunchClockDeps, tried: Set<string>, today: LaunchClockDay = { day: '', read: 0 }): Promise<LaunchClockResult> {
  const p = deps.policy.narrative.launchClock;
  const read = deps.oldestBlockTime;
  if (!p.on || read === null || deps.mode !== 'live') return { read: 0, kept: 0, failed: 0 };
  const day = new Date(deps.now()).toISOString().slice(0, 10);
  if (today.day !== day) {
    today.day = day;
    today.read = 0;
  }
  const room = Math.min(p.perPass, p.perDay - today.read);
  if (room <= 0) return { read: 0, kept: 0, failed: 0 };
  const due = (await deps.due(room + tried.size)).filter((a) => !tried.has(a)).slice(0, room);
  today.read += due.length;
  let kept = 0;
  let failed = 0;
  for (const address of due) {
    tried.add(address);
    try {
      const seconds = await read(address);
      if (seconds === null) continue;
      await deps.keep(address, (seconds * 1_000) as Millis);
      kept += 1;
    } catch (e) {
      failed += 1;
      deps.log.warn("a coin's create block time could not be read; its launch stays not known", { address, err: errorText(e) });
    }
  }
  if (due.length > 0) deps.log.info('launch times read from the chain', { read: due.length, kept, failed });
  return { read: due.length, kept, failed };
}
