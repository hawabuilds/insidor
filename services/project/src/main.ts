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

import { DEFAULT_POLICY } from '@insidor/contracts';
import { asDb, createPool, DB_ROLE, PgAssetRepo, withTransaction } from '@insidor/store';

import {
  FREE_POST_SOURCE_LABEL,
  loadLaunchFacts,
  loadStoryFacts,
  nextLaunchTick,
  nextTick,
  previousBoardStoryIds,
  writeBoard,
  writeLaunches,
  writeStories,
} from './db.ts';
import { announceBoard } from './notify.ts';
import {
  projectBoard,
  projectBoardProvenance,
  projectStoryProvenance,
  projectFeedSource,
  projectLaunch,
  projectStory,
} from './project.ts';
import type { ProjectOptions } from './project.ts';
import { countAnchors, windowIsOrdered } from './window.ts';
import { WireLeakError } from './wire.ts';
import type { WireLaunch, WireStory } from './wire.ts';

/** The board the app asks for. `VIEW_ID` in app/src/App.tsx is this string. */
const VIEW_ID = 'default';
/** The launches rail the app asks for. `LAUNCH_FEED_ID` in app/src/features/rail is this string. */
const LAUNCH_FEED_ID = 'default';

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

/**
 * How far back the launches rail looks, and how many rows it keeps.
 *
 * Presentation bounds, like STORY_WINDOW_MS above and not like `marketFreshnessMs` below:
 * nothing is admitted or rejected by these, they only decide how much of the mint stream is
 * fetched and stored. Six hours is wide enough that the rail is not empty on a quiet morning
 * and narrow enough that "new launches" still means new. The row cap is above what the rail
 * renders, so scrolling reaches the end of the frame rather than the end of the cap.
 */
const LAUNCH_WINDOW_MS = 6 * HOUR_MS;
const LAUNCH_LIMIT = 60;

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
    const options: ProjectOptions = {
      nowMs,
      sparkWindowMs: SPARK_WINDOW_MS,
      /* Read from the policy rather than typed here, unlike the two windows above.
         Those bound how much is fetched and how wide an axis is drawn; this one decides
         whether a price is published as the current price or as a dash, which is a
         judgement — and every threshold in this system lives in one hashed object so
         that "what was this board judged against in March" has an answer. */
      marketFreshnessMs: DEFAULT_POLICY.market.readingFreshnessMs,
      /* From the policy for the same reason, and it decides the same KIND of thing: not
         how much is fetched, but whether what is on screen may present itself as current.
         A feed silent for longer than this is published as not live, and the rail says so
         above rows it keeps rather than hides. */
      feedFreshnessMs: DEFAULT_POLICY.assets.feedFreshnessMs,
    };

    const result = await withTransaction(pool, async (db) => {
      const tick = await nextTick(db, VIEW_ID);
      const load = await loadStoryFacts(db, {
        storiesSinceMs: nowMs - STORY_WINDOW_MS,
        reachSinceMs: nowMs - REACH_WINDOW_MS,
        limit: BOARD_LIMIT,
        previousBoard: await previousBoardStoryIds(db, VIEW_ID),
      });
      const facts = load.stories;

      /* ★ NAMED, ONE LINE PER STORY, BECAUSE THIS PROJECTOR CANNOT WRITE IT DOWN ANYWHERE
         ELSE. A story with no post time on any member has its coin window hung on when WE
         first read it, which is a weaker claim than the one every other row on the board
         is making: the window reaches backwards past its own anchor precisely because we
         cannot say the coin came after anything. That difference belongs in
         internal.decisions as an `abstain` with a null `subject_origin`, and this process
         cannot put it there — it holds the service credential, and 0001 grants the service
         role SELECT on `internal` and no more. So it is printed, with the story named, and
         the day this frame is reconstructed the run that built it says which rows were
         retrieved against our own reading schedule. It reaches an operator; by the product
         rule it must never reach the wire, and nothing below adds a field for it. */
      for (const [storyId, retrieval] of load.coinWindows) {
        if (windowIsOrdered(retrieval)) continue;
        const reachMin = Math.round((retrieval.anchorMs - retrieval.fromMs) / MINUTE_MS);
        console.warn(
          `story ${storyId} carries no post time on any member: its coins were retrieved ` +
            `against ${retrieval.anchor}, reaching ${reachMin} minutes before that anchor. ` +
            `Nothing on this row may be read as "minted after the post".`,
        );
      }
      const anchors = countAnchors(load.coinWindows.values());

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
          const page = projectStory(
            story,
            options,
            /* The page's own answer, from the same story rows the facts came from — not
               borrowed from the frame, because a story page is reachable by a shared link
               with no frame in sight. See projectStoryProvenance. */
            projectStoryProvenance(load.origins.get(story.storyId), FREE_POST_SOURCE_LABEL),
          );
          if (page === null) skipped += 1;
          else pages.push(page);
        } catch (error: unknown) {
          if (!(error instanceof WireLeakError)) throw error;
          skipped += 1;
          console.warn(`story ${story.storyId} was not projected: ${error.message}`);
        }
      }

      /* ★ COMPUTED FROM THE ORIGINS OF THE STORIES THAT ACTUALLY REACHED THE FRAME, and
         from `board.order` rather than from `facts`, so a story that was withheld or that
         had nothing nameable in it is not counted in a sentence about what is on screen.
         See projectBoardProvenance, and 0021 for why it rides on the view row. */
      const provenance = projectBoardProvenance(load.origins, board.order, FREE_POST_SOURCE_LABEL);
      const boardRows = await writeBoard(db, VIEW_ID, tick, board.rows, provenance);
      const storyViews = await writeStories(db, pages);

      /* ── the launches rail ──
         In the SAME transaction as the board, and not because the two frames depend on each
         other — they do not, and they carry separate ticks precisely so they cannot. It is
         one transaction because this process is one one-shot: two transactions would mean a
         run that could half-succeed, and "the board committed but the rail did not" is a
         state with no owner and no retry. If the rail ever needs its own cadence, it gets
         its own entrypoint rather than a second commit inside this one. */
      const launchLoad = await loadLaunchFacts(db, {
        sinceMs: nowMs - LAUNCH_WINDOW_MS,
        limit: LAUNCH_LIMIT,
      });

      /* One bad launch must not take the frame down with it. The likeliest cause is a
         vendor's name inside a token name somebody chose on purpose — which is free to do
         and costs us one row, printed, rather than a rail that stops updating. */
      const launches: WireLaunch[] = [];
      let launchesWithheld = 0;
      for (const launchFacts of launchLoad.launches) {
        try {
          launches.push(projectLaunch(launchFacts, options));
        } catch (error: unknown) {
          if (!(error instanceof WireLeakError)) throw error;
          launchesWithheld += 1;
          console.warn(`launch ${launchFacts.assetKey} was withheld: its payload would have leaked`);
        }
      }

      /* ── when this feed was last actually heard from ──
         ★ THE FACT THE RAIL COULD NOT STATE. The coverage log knows the silence to the
         second and the app role has no USAGE on the schema it lives in — measured, not
         assumed: `set role insidor_app; select … from internal.mint_coverage` answers
         "permission denied for schema internal", and so does asking whether it has the
         privilege. So this is the only process that can put the fact on the wire, and it
         does it here, in the transaction that commits the frame the fact describes.

         ★ THE MINIMUM ACROSS CHAINS, and the rule is written now rather than when it
         starts to matter: a feed is only as live as its STALEST source. One chain still
         answering does not make a rail current when another has been silent for a week,
         and taking a max would let the healthy one hide the dead one — which is this
         whole bug, one level up. A chain we have never heard anything from is `null` and
         collapses the answer to `null`, because "we have heard nothing on one of these"
         is exactly the state the absent branch describes.

         The chain set comes from the store rather than from a constant here: `chains()`
         exists so no service has to type a chain's name, which is the first step of the
         leak the vocabulary gate stops one layer up. */
      const assets = new PgAssetRepo(db);
      let lastHeardAtMs: number | null = null;
      let heardOnEvery = true;
      for (const chain of await assets.chains()) {
        const heard = await assets.lastHeardAt(chain);
        if (heard === null) heardOnEvery = false;
        else lastHeardAtMs = lastHeardAtMs === null ? heard : Math.min(lastHeardAtMs, heard);
      }
      const source = projectFeedSource(heardOnEvery ? lastHeardAtMs : null, options);

      const launchTick = await nextLaunchTick(db, LAUNCH_FEED_ID);
      const launchRows = await writeLaunches(db, LAUNCH_FEED_ID, launchTick, launches, source);

      /* ── the announcement ──
         The last statement before commit, and INSIDE the transaction deliberately. Postgres
         queues a notification at commit and discards it on rollback, so this can neither
         announce a frame that is not yet selectable nor survive a projection that failed.
         It carries the view id and the tick and nothing else; see notify.ts for why a
         payload must never carry anything its reader could not already read.

         It is not wrapped in a try/catch. A frame nobody is told about is a board that
         stops updating in every browser until someone reloads — which is the failure this
         whole wiring exists to remove, so it is not a failure worth committing around. */
      await announceBoard(db, VIEW_ID, tick);

      return {
        tick,
        anchors,
        boardRows,
        storyViews,
        considered: facts.length,
        skipped,
        withheld: board.withheld.length,
        launchTick,
        launchRows,
        launchesWithheld,
        /* Printed rather than swallowed: these are coins we hold that the rail cannot show
           because their mint time is unknown, and a rail quieter than the world has to be
           diagnosable from the run that made it quiet. */
        launchesWithoutMintTime: launchLoad.withoutMintTime,
        /* Printed for the same reason `no_mint_time` is: an empty rail has to be
           diagnosable from the run that emptied it. With the origin filter in place, "0
           rows" and "the transport has been dead for six days" are the common pair, and an
           operator reading this line should not have to open psql to tell them apart. */
        source,
      };
    });

    console.log(
      `projected view=${VIEW_ID} tick=${result.tick} ` +
        `board_row=${result.boardRows} story_view=${result.storyViews} ` +
        `considered=${result.considered} skipped=${result.skipped} withheld=${result.withheld} ` +
        /* Two counts, always both printed, including when the second is zero. A field that
           only appears when something is wrong is a field nobody knows the normal value of. */
        `coin_window=post:${result.anchors.earliest_post}/sight:${result.anchors.first_sight}`,
    );
    console.log(
      `projected launches feed=${LAUNCH_FEED_ID} tick=${result.launchTick} ` +
        `launch_row=${result.launchRows} withheld=${result.launchesWithheld} ` +
        `no_mint_time=${result.launchesWithoutMintTime} ` +
        /* Always both, including when the feed is healthy. A field that only appears when
           something is wrong is a field nobody knows the normal value of. */
        `feed_live=${String(result.source.live)} ` +
        `last_heard=${
          result.source.lastHeardAt.at === null
            ? 'never'
            : new Date(result.source.lastHeardAt.at).toISOString()
        }`,
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
