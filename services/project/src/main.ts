/**
 * The projector, run once: read the domain, project, commit one frame, exit.
 *
 * It is a one-shot rather than a loop on purpose. There is nothing to supervise here —
 * no cursor to lose, no vendor to back off from, no partial state that survives a crash
 * — so a process that runs, prints what it wrote, and exits is the whole thing. Put it
 * behind a timer or call it from the runner when the cadence matters; adding a loop, a
 * health port and a shutdown grace to a program that does one atomic transaction would
 * be machinery guarding nothing.
 *
 * THE WHOLE FRAME IS ONE TRANSACTION. A board is a committed frame — the client trusts
 * `(tick, order)` absolutely and never sorts — so a partially written board is not a
 * slightly-stale board, it is a board whose order refers to rows that are not there.
 * Everything between `begin` and `commit` or nothing.
 *
 * IT HOLDS THE SERVICE CREDENTIAL, AND THAT IS THE ARCHITECTURE. This process must read
 * public.observation, which has no grant to the app role, because that is where the
 * censoring lives. The read service holds the app credential and therefore could not
 * build these payloads if it wanted to. Neither process is trusted to behave; each one
 * is handed a connection that makes the wrong behaviour impossible.
 */

import { asDb, createPool, DB_ROLE, withTransaction } from '@insidor/store';

import { loadStoryFacts, nextTick, previousBoardStoryIds, writeBoard, writeStories } from './db.ts';
import { projectBoard, projectStory } from './project.ts';
import type { ProjectOptions } from './project.ts';
import { WireLeakError } from './wire.ts';
import type { WireStory } from './wire.ts';

/** The board the app asks for. `VIEW_ID` in app/src/App.tsx is this string. */
const VIEW_ID = 'default';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Presentation windows, not judgements. Nothing branches on them and no story is
 * admitted or rejected by one — they only bound how much is fetched and how wide the
 * sparkline's axis is drawn. The thresholds that decide what belongs on a board live in
 * contracts/src/policy.ts and are read by core, not here.
 */
const STORY_WINDOW_MS = 48 * HOUR_MS;
const SPARK_WINDOW_MS = 30 * MINUTE_MS;
/** Enough rows to fill the feed several times over. Not a cut; the ordering is upstream. */
const BOARD_LIMIT = 200;

/**
 * The reach series is fetched over a day PLUS SLACK so `reachDelta24h` has both of its
 * ends. The spark shows the last SPARK_WINDOW_MS of it; the rest is there to answer the
 * day's change honestly instead of quietly relabelling "since the oldest reading we
 * hold" as "since yesterday".
 *
 * ★ THE SLACK IS THE WHOLE POINT AND EXACTLY 24 HOURS WOULD BE A BUG. projectReachDelta24h
 * asks for the newest measured level AT OR BEFORE now-24h. A window of exactly 24 hours
 * fetches readings at or after now-24h, so the two sets intersect only at the single
 * millisecond boundary and the older end is never found — the day's change would be
 * `not_read_yet` on every story forever, which is an absence rather than a lie but is
 * still a field that never renders. Two hours is a couple of dozen missed passes at the
 * cadence we read at, which is slack for an outage rather than a tuned number: nothing
 * branches on it, it only bounds how far back the statement reaches.
 */
const REACH_WINDOW_MS = 26 * HOUR_MS;

function connectionUrl(env: Readonly<Record<string, string | undefined>>): string {
  const url = env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL is not set; refusing to start. The projector needs the credential that ' +
        'can read public.observation — the app role cannot, deliberately, and starting under ' +
        'it would fail halfway through a frame rather than at boot.',
    );
  }
  return url;
}

async function main(): Promise<void> {
  /* createPool takes the role's own variable name. The projector is deployed with the
     owner credential that .env.example calls DATABASE_URL, so it is handed in under the
     service role's key rather than duplicating the pool tuning and the session-mode
     check that live in store/src/client.ts. That check still applies, which is what we
     want: the transaction-mode pooler releases advisory locks between statements and
     drops prepared statements, and a projector that silently ran there would be a
     problem discovered much later. */
  const pool = createPool(DB_ROLE.service, {
    applicationName: 'insidor-project',
    env: { DATABASE_URL_SERVICE: connectionUrl(process.env) },
  });

  try {
    const nowMs = Date.now();
    const options: ProjectOptions = { nowMs, sparkWindowMs: SPARK_WINDOW_MS };

    const result = await withTransaction(pool, async (db) => {
      const tick = await nextTick(db, VIEW_ID);
      const facts = await loadStoryFacts(db, {
        storiesSinceMs: nowMs - STORY_WINDOW_MS,
        reachSinceMs: nowMs - REACH_WINDOW_MS,
        limit: BOARD_LIMIT,
        previousBoard: await previousBoardStoryIds(db, VIEW_ID),
      });

      /* One frame, built in one pass, so `order` and `rows` cannot disagree. A story
         with nothing nameable in it is dropped here rather than given a placeholder
         title — see projectTitle. A story whose payload would leak is withheld by
         projectBoard and named below, so the hole is one row and not the whole frame. */
      const board = projectBoard(facts, options);
      for (const storyId of board.withheld) {
        console.warn(`story ${storyId} was withheld from the board: its payload would have leaked`);
      }

      /* A story page that cannot be projected must not take the whole frame down with
         it. The likeliest cause is a vendor name inside text a person typed, which is
         one story's problem; the board keeps its other rows and the count is printed so
         the hole is visible rather than quiet. */
      const pages: WireStory[] = [];
      let skipped = 0;
      for (const story of facts) {
        try {
          const page = projectStory(story, options);
          if (page === null) skipped += 1;
          else pages.push(page);
        } catch (error: unknown) {
          if (!(error instanceof WireLeakError)) throw error;
          skipped += 1;
          console.warn(`story ${story.storyId} was not projected: ${error.message}`);
        }
      }

      const boardRows = await writeBoard(db, VIEW_ID, tick, board.rows);
      const storyViews = await writeStories(db, pages);
      return {
        tick,
        boardRows,
        storyViews,
        considered: facts.length,
        skipped,
        withheld: board.withheld.length,
      };
    });

    console.log(
      `projected view=${VIEW_ID} tick=${result.tick} ` +
        `board_row=${result.boardRows} story_view=${result.storyViews} ` +
        `considered=${result.considered} skipped=${result.skipped} withheld=${result.withheld}`,
    );
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(`projection failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
