/**
 * THE SOURCE INDICATOR PROJECTOR, run once: read what the ingest side recorded about each
 * source, make the three-way call, commit one frame, exit.
 *
 * ★ WHY THIS IS A THIRD ENTRYPOINT AND NOT SIX MORE LINES INSIDE main.ts. `pairs-main.ts`
 * argues the general case; this one has its own version of it, and the version is stronger.
 *
 *   1. IT RUNS ON A DIFFERENT CLOCK ENTIRELY. A board frame changes when the world does —
 *      every tick, all day. This changes when somebody adds a credential or a vendor starts
 *      erroring, which is rarely and unpredictably. Bolting it onto the board's cadence
 *      would either project it hundreds of times an hour for nothing, or tie "how fast does
 *      a dark source become visible" to a number chosen for an entirely different reason.
 *   2. IT MUST NOT BE ABLE TO TAKE THE BOARD DOWN. It reads `internal.source_health`, which
 *      the ingest side owns and writes on its own schedule. Inside main.ts's transaction, a
 *      change on that table stops the BOARD from projecting at all — the surface with the
 *      most to lose held hostage by the surface with the least.
 *   3. ITS OPTIONS ARE NOT THE BOARD'S. `ProjectOptions` carries `marketFreshnessMs`, the
 *      five-minute window inside which a price may be published as current, and this
 *      projection has no business anywhere near it. One options object serving both would
 *      eventually grow a "which surface is this" field, and then the board's five minutes
 *      would be a parameter somebody could pass differently.
 *
 * IT HOLDS THE SERVICE CREDENTIAL, for the reason main.ts and pairs-main.ts both give, and
 * here it is the entire architecture of the feature: whether a source is erroring is a fact
 * that lives in `internal`, where 0001 never granted the app role USAGE — measured, not
 * assumed, in 0015's header. The browser's process cannot read it and cannot even ask
 * whether it may. So the call is made once, here, behind a connection allowed to see the
 * ingredients, and what is left behind on `public.source_view` is the finished sentence.
 *
 * ★ AND THIS PROCESS DOES NOT READ A SINGLE PLATFORM CREDENTIAL, WHICH IS DELIBERATE.
 * `process.env` is touched exactly once below, for DATABASE_URL. Whether a source is
 * configured is knowable only where the credential lives, and that is the ingest process —
 * a different process with, on any real deploy, a different environment. Reading X_API_KEY
 * here would answer a question about THIS container and publish it as a fact about THAT
 * one, and it would be wrong in the quiet direction: a projector deployed without the
 * platform block would report every source dormant while the pipeline hummed along beside
 * it. The ingest side records what it knows; this side reads it back.
 */

import { DEFAULT_POLICY } from '@insidor/contracts';
import { createPool, DB_ROLE, PgSourceHealthRepo, withTransaction } from '@insidor/store';

import { nextSourceTick, sourceLabel, writeSources } from './db.ts';
import { projectSourceFeed, projectSourceHealth } from './project.ts';
import type { SourceOptions } from './project.ts';
import { WireLeakError } from './wire.ts';
import type { WireSourceHealth } from './wire.ts';

/**
 * The indicator the app asks for. `SOURCE_VIEW_ID` in app/src/features/sources is this
 * string, and it is the board's `VIEW_ID` by coincidence rather than by joining: they key
 * different tables and neither reads the other's.
 */
const SOURCE_VIEW_ID = 'default';

function connectionUrl(env: Readonly<Record<string, string | undefined>>): string {
  const url = env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL is not set; refusing to start. This projector needs the credential that ' +
        'can read internal.source_health — the app role has no USAGE on that schema at all, ' +
        'deliberately, and starting under it would fail halfway through a frame rather than ' +
        'at boot.',
    );
  }
  return url;
}

async function main(): Promise<void> {
  const pool = createPool(DB_ROLE.service, {
    applicationName: 'insidor-project-sources',
    env: { DATABASE_URL_SERVICE: connectionUrl(process.env) },
  });

  try {
    const options: SourceOptions = {
      nowMs: Date.now(),
      /* The whole policy, because `sourceState` in core is what reads it and pulling its
         two bars out here would be a second, silent copy of which bars that rule uses. */
      policy: DEFAULT_POLICY,
    };

    const result = await withTransaction(pool, async (db) => {
      const tick = await nextSourceTick(db, SOURCE_VIEW_ID);

      /* ★ EVERY SOURCE ANYTHING HAS EVER DECLARED, in the repo's committed order — which is
         by key and NOT by severity. The obvious ordering is "problems first" and it is wrong
         for this surface: these are three shapes somebody glances at dozens of times a day,
         and an order that moved when a state moved would mean the pip under the cursor is
         not the pip that was there a second ago.

         ★ AND A SOURCE THAT WAS NEVER DECLARED CANNOT APPEAR HERE, which is a real
         obligation on the ingest side rather than a limitation of this read: the process
         holding the credentials must declare EVERY source it knows about at boot, including
         the ones with no credential at all. A source nobody turned on has to be DORMANT on
         the indicator; absent from it is the one state this whole feature exists to make
         impossible. */
      const health = await new PgSourceHealthRepo(db).all();

      const sources: WireSourceHealth[] = [];
      let unnamed = 0;
      let withheld = 0;

      for (const record of health) {
        let projected: WireSourceHealth;
        try {
          projected = projectSourceHealth(record, sourceLabel(record.source), options);
        } catch (error: unknown) {
          /* One unpublishable source must not take the frame down with it. The realistic
             cause is a source key that carries a vendor's name — which the censor refuses in
             a value, not only in a key — and it costs one pip, printed, rather than an
             indicator that silently stops updating for every source at once. */
          if (!(error instanceof WireLeakError)) throw error;
          withheld += 1;
          console.warn(`source ${record.source} was withheld: its payload would have leaked`);
          continue;
        }
        /* ★ A SOURCE THAT CANNOT BE NAMED IS NOT SHOWN, and it is not given a placeholder.
           `boundedText` returns the empty string when a label is nothing but control or bidi
           characters, and a nameless pip is a coloured shape a reader cannot act on. The
           alternative — printing the raw source id — is the exact failure the
           server-chooses-the-label rule exists to prevent, and inventing "Source 2" would be
           a fiction on a surface whose whole job is to say what is true. */
        if (projected.label === '') {
          unnamed += 1;
          console.warn(
            `source ${projected.sourceId} has no renderable label, so it is not on the ` +
              'indicator. Add it to SOURCE_LABELS in services/project/src/db.ts.',
          );
          continue;
        }
        sources.push(projected);
      }

      const frame = projectSourceFeed(tick, sources);
      const written = await writeSources(db, SOURCE_VIEW_ID, tick, frame.sources);
      return { tick, written, declared: health.length, unnamed, withheld, sources: frame.sources };
    });

    /* Every field printed every run, including the zeroes and including the healthy case. A
       line that only appears when something is wrong is a line nobody knows the normal shape
       of — main.ts and pairs-main.ts both say so, and this surface earns it twice over,
       because "all dormant" is simultaneously the most alarming-looking output here and the
       correct one on a machine where nobody has bought anything yet. */
    const tally = { live: 0, dormant: 0, failing: 0 };
    for (const source of result.sources) tally[source.state] += 1;
    console.log(
      `projected sources view=${SOURCE_VIEW_ID} tick=${result.tick} ` +
        `source_view=${result.written} declared=${result.declared} ` +
        `live=${tally.live} dormant=${tally.dormant} failing=${tally.failing} ` +
        `unnamed=${result.unnamed} withheld=${result.withheld}`,
    );
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(
      `the source projection failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
