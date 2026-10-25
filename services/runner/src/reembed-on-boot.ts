/**
 * THE RE-EMBED, RUN BY THE RUNNER ITSELF (the owner, 2026-10-24: "do 1"). The switch from the hosted
 * embedding model to our own (services/embed) needs every stored post, label, name example and post
 * picture embedded again in the new space first (work/reembed.ts says why and how). That work has to
 * reach the embed service on Railway's private network, which only a Railway service can; so with
 * Policy.group.image.backfill on and the service configured, the runner does it once per boot, in
 * its own process, in the background.
 *
 * Its own file so the runner's loops never wait on it: the boot does not await it, it runs on the
 * runtime's pool at two requests at a time, and it never throws into the runner — a failure is
 * logged and the runner carries on. The work lists skip what is done, so a restart picks up where
 * the last run stopped, and a run with nothing left finishes at once: leaving the switch on after the
 * fill costs one empty page per kind a boot.
 *
 * In-process, not a child process: `check-python` forbids a production package from spawning
 * anything, and an earlier version of this file did exactly that with tools/reembed.ts.
 *
 * Metered on its own in-memory meter: the service is $0 a call, and the runner's durable meter would
 * write a ledger row per request for nothing.
 *
 * What breaks if changed carelessly: logging the port's configuration. `cfg.selfEmbed` holds the
 * secret; only the kinds and counts are ever logged. And awaiting the returned promise at boot,
 * which would hold every loop until the fill is done — hours, the first time.
 */

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import { httpClient, selfEmbed } from '@insidor/embed-selfhost';
import { inMemoryMeter } from '@insidor/meter';
import type { Db } from '@insidor/store';

import type { RunnerConfig } from './config.ts';
import { errorText, type Logger } from './log.ts';
import { reembedKinds, reembedSources, type ReembedKind } from './work/reembed.ts';

/* Coin pictures only as far back as a coin can still be matched to a new post (`universe.matchWindowMs`,
   two days; the owner, 2026-10-25): an older coin's picture is never compared again before it is
   archived, and a fresh coin is embedded in the new space as it launches. */
const KINDS: readonly ReembedKind[] = ['posts', 'labels', 'names', 'pictures', 'coins', 'coined'];
/** The service runs one inference at a time; two keeps it fed while the next pictures download. */
const CONCURRENCY = 2;

export interface ReembedOnBootDeps {
  readonly cfg: Pick<RunnerConfig, 'selfEmbed'>;
  readonly db: Db;
  readonly log: Logger;
  /** The runner's shutdown: the walk stops before its next page, and resumes next boot. */
  readonly signal: AbortSignal;
  readonly policy?: Policy;
  readonly fetchFn?: typeof globalThis.fetch;
}

/**
 * Starts the fill when the policy asks for it and the service is configured. Returns a promise that
 * settles when the fill stops — for the shutdown to wait on alongside the loops, never for the boot —
 * and that never rejects.
 */
export function startReembed(deps: ReembedOnBootDeps): Promise<void> {
  const policy = deps.policy ?? DEFAULT_POLICY;
  const self = deps.cfg.selfEmbed;
  if (policy.group.image.backfill !== true || self.state !== 'configured') return Promise.resolve();
  const log = deps.log;
  const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => Date.now() });
  const port = selfEmbed({ client: httpClient({ baseUrl: self.baseUrl, secret: self.secret, fetch: deps.fetchFn ?? globalThis.fetch }), meter, now: () => Date.now() as Millis });
  log.info('reembed started', { kinds: KINDS.join(','), concurrency: CONCURRENCY });
  return reembedKinds(deps.db, port, {
    kinds: KINDS,
    concurrency: CONCURRENCY,
    limit: Infinity,
    sources: reembedSources({ policy, coinSinceMs: Date.now() - policy.universe.matchWindowMs }),
    signal: deps.signal,
    log: (e) => {
      if (e.event === 'page') log.info('reembed', { kind: e.kind, done: e.done, unread: e.unread, ratePerSec: Number(e.ratePerSec.toFixed(1)) });
      else log.info('reembed kind finished', { kind: e.kind, written: e.written, unread: e.unread });
    },
  }).then(
    (results) => log.info('reembed finished', { stopped: deps.signal.aborted, written: results.reduce((n, r) => n + r.written, 0), unread: results.reduce((n, r) => n + r.unread, 0) }),
    (e: unknown) => log.warn('reembed failed; the next boot resumes it', { err: errorText(e) }),
  );
}
