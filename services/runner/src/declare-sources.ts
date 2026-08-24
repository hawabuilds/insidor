/**
 * WRITE DOWN WHAT CONFIGURATION SAYS ABOUT EVERY SOURCE, THEN EXIT.
 *
 * ★ WHY THIS EXISTS AT ALL. `services/project/src/sources-main.ts` reads
 * `internal.source_health` and publishes the corner indicator from it. Its header states
 * the obligation this file discharges: "A source that was never declared cannot appear
 * here… the process holding the credentials must declare EVERY source it knows about at
 * boot, including the ones with no credential at all. A source nobody turned on has to be
 * DORMANT on the indicator; absent from it is the one state this whole feature exists to
 * make impossible."
 *
 * Until this file existed, the only processes that discharged it were the runner and
 * `db:decide`. So the documented first run — `db:up`, `db:migrate`, `db:seed`,
 * `db:project`, `db:sources` — projected an EMPTY indicator: `source_view=0`, and a nav
 * corner with no pips at all. Not three dormant pips saying "nobody turned these on",
 * which is what SETUP.md promises and what is true; no pips, which reads as a feature
 * that has not been built. The first thing a new clone showed about its sources was
 * nothing, and the fix was to run a long-lived process nobody had told her to start.
 *
 * ★ WHY IT IS ITS OWN ENTRYPOINT AND NOT SIX LINES IN THE PROJECTOR. Because the
 * projector must not read a platform credential — `sources-main.ts` argues that at
 * length and it is right: whether a source is configured is knowable only where the
 * credential lives, and on a real deploy that is a different container with a different
 * environment. A projector that read `X_API_KEY` would answer a question about ITSELF
 * and publish it as a fact about the ingest process. So the declaration happens here, in
 * a process that holds the credentials, and the projection reads it back. `pnpm
 * db:sources` runs the two in that order.
 *
 * ★ WHY IT GOES THROUGH `withRuntime` AND DECLARES NOTHING ITSELF. `withRuntime` already
 * resolves the registry from the environment and calls `declareSources` — that is how
 * the runner's indicator gets written at boot. Re-implementing the resolution here would
 * be a second opinion on the dormant/misconfigured judgement, and the two would drift on
 * the first source added. The body below is deliberately empty: everything this program
 * does happens on the way in. If the runner's declaration is wrong, this is wrong in
 * exactly the same way, which is the property worth having.
 *
 * WHAT BREAKS IF THIS IS CHANGED CARELESSLY: give it the runner's lock name and it will
 * refuse to run whenever the runner is up — and then `pnpm db:sources`, a read-only
 * bookkeeping command, fails on a healthy machine. It takes its own lock for the reason
 * `decide-once.ts` takes its own: the guarantee is that two writers of the SAME rows do
 * not race, and two copies of this command are that race.
 */

import { loadRunnerConfig } from './config.ts';
import { createLogger, errorText } from './log.ts';
import { withRuntime } from './wiring.ts';

const log = createLogger({ svc: 'declare-sources' });

async function main(): Promise<void> {
  const cfg = loadRunnerConfig(process.env);

  await withRuntime(cfg, log, async (runtime) => {
    /* Already written by `withRuntime`, above. This reports what it wrote, because a
       command whose entire output is "done" cannot be told from one that resolved
       nothing — and "nothing is configured" is a legitimate, common, correct answer
       here that has to be readable as one. */
    log.info('sources declared', {
      live: runtime.platforms.all().map((a) => String(a.id)),
      dark: runtime.platforms.absent().map((a) => `${a.source}:${a.configuration}`),
    });
    return null;
  });
}

main().catch((e: unknown) => {
  log.error('could not declare sources', { err: errorText(e) });
  process.exit(1);
});
