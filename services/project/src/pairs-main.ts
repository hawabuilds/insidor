/**
 * THE PAIRS PROJECTOR, run once: read the mints that reached a market, project one frame,
 * commit, exit.
 *
 * ★ WHY THIS IS A SECOND ENTRYPOINT AND NOT SIX MORE LINES INSIDE main.ts.
 *
 * main.ts builds one `ProjectOptions` and hands it to everything it projects, and the field
 * that matters in it is `marketFreshnessMs` — the five-minute window inside which a reading
 * may be published as the CURRENT market. The board needs that window because every board
 * row carries a Buy button, and a price a user is about to act on is either current or it
 * is a dash.
 *
 * This surface makes the opposite call on purpose: it publishes the reading it holds
 * together with the instant it was taken at, and the screen states the age beside every
 * figure. Both calls are right for their own screen, and the danger is not that they
 * disagree — it is that they would be spelled one object apart. A single process carrying
 * both rules would sooner or later have one options object with a "which mode is this"
 * field on it, and then the board's five minutes would be a parameter somebody could pass
 * differently. So the divergence is a process boundary: `projectPair` takes no
 * `ProjectOptions` at all, this file constructs none, and there is no value here that could
 * be handed to `projectCoin`.
 *
 * The cost is a second transaction, and it is genuinely free: the pairs frame depends on
 * nothing the board frame writes, and carries its own tick precisely so it cannot.
 *
 * IT HOLDS THE SERVICE CREDENTIAL, for the reason main.ts gives: it must read
 * internal.mint_coverage, which the app role has no USAGE on and could not read even to ask
 * whether it may. The censoring happens here, behind a connection that is allowed to see the
 * ingredients, and what it leaves behind is the finished answer.
 */

import { createPool, DB_ROLE, withTransaction } from '@insidor/store';

import {
  assetOriginIsRecorded,
  lastMintHeardAt,
  loadPairCounts,
  loadPairFacts,
  nextPairTick,
  writePairs,
} from './db.ts';
import { projectPair, projectPairFeed, projectPairHead } from './project.ts';
import type { PairCounts } from './project.ts';
import { WireLeakError } from './wire.ts';
import type { WirePair } from './wire.ts';

/** The pairs feed the app asks for. `PAIR_FEED_ID` in app/src/features/pairs is this string. */
const PAIR_FEED_ID = 'default';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How far back this screen looks, and how many rows it keeps.
 *
 * Presentation bounds, like main.ts's STORY_WINDOW_MS and unlike anything in
 * contracts/src/policy.ts: nothing is admitted or rejected by these, they only decide how
 * much is fetched and stored, and the count of what the window held is published beside the
 * list so the bound is visible rather than implied.
 *
 * ★ FOURTEEN DAYS AND NOT SIX HOURS, WHICH IS A DIFFERENT QUESTION AND NOT A LOOSER ONE.
 * The launches rail asks "what has just been minted" and six hours is the honest width of
 * that question. This asks "what has ever reached a market", and a market is a thing a coin
 * arrives at hours or days after it is minted — measured here, 7 of 192 captured mints ever
 * did, and the newest of them was priced long after the six-hour rail would have dropped it.
 * A fortnight is wide enough that the ratio is a real ratio and narrow enough that the
 * screen is about the recent past rather than an archive.
 */
const PAIR_WINDOW_MS = 14 * DAY_MS;
const PAIR_LIMIT = 100;

function connectionUrl(env: Readonly<Record<string, string | undefined>>): string {
  const url = env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL is not set; refusing to start. This projector needs the credential that ' +
        'can read internal.mint_coverage — the app role has no USAGE on that schema at all, ' +
        'deliberately, and starting under it would fail halfway through a frame rather than ' +
        'at boot.',
    );
  }
  return url;
}

async function main(): Promise<void> {
  const pool = createPool(DB_ROLE.service, {
    applicationName: 'insidor-project-pairs',
    env: { DATABASE_URL_SERVICE: connectionUrl(process.env) },
  });

  try {
    const nowMs = Date.now();
    const window = { sinceMs: nowMs - PAIR_WINDOW_MS, limit: PAIR_LIMIT };

    const result = await withTransaction(pool, async (db) => {
      const tick = await nextPairTick(db, PAIR_FEED_ID);

      /* Read whatever we can say about the feed's own contact with the world FIRST, and
         unconditionally. It is true of the frame whether or not there is a single row to
         list — the empty case is the one where it matters most, because "nothing reached a
         market" and "nothing has been heard for six days" are two different reasons for an
         empty screen and only one of them is about the market. */
      const heardAt = await lastMintHeardAt(db);

      /* ★ THE PROVENANCE GATE. Asked once, of the database, before anything is listed.
         Without a record of where each row came from, a demo row and an observed one are
         the same row to every query in this system — so a screen whose heading says a venue
         priced these coins would be listing fictions under it. It withholds instead. That is
         not an error state and it is not an empty market; it is a third thing and it is
         published as one, so the screen can say which. */
      const separable = await assetOriginIsRecorded(db);

      let counts: PairCounts | null = null;
      let pairs: WirePair[] = [];
      let withheldRows = 0;

      if (separable) {
        counts = await loadPairCounts(db, window);
        /* One unpublishable pair must not take the frame down with it. The likeliest cause
           is a vendor's name inside a token name somebody chose on purpose — free to do,
           and it costs one row, printed, rather than a screen that stops updating. */
        for (const facts of await loadPairFacts(db, window)) {
          try {
            pairs.push(projectPair(facts));
          } catch (error: unknown) {
            if (!(error instanceof WireLeakError)) throw error;
            withheldRows += 1;
            console.warn(`pair ${facts.assetKey} was withheld: its payload would have leaked`);
          }
        }
      } else {
        console.warn(
          'public.asset has no record of where its rows came from, so the pairs screen is ' +
            'withholding its rows. A demo row and an observed one are the same row to every ' +
            'query here until that column exists, and this surface claims a venue priced ' +
            'what it lists.',
        );
      }

      const head = projectPairHead({ windowMs: PAIR_WINDOW_MS, lastMintHeardAt: heardAt, counts });
      const frame = projectPairFeed(tick, head, pairs);
      /* Read back off the frame rather than off the local: `projectPairFeed` is what empties
         the array on the withheld branch, and the number printed has to be the number
         written. */
      pairs = [...frame.pairs];

      const written = await writePairs(db, PAIR_FEED_ID, tick, frame.head, frame.pairs);
      return { tick, written, counts, heardAt, separable, withheldRows };
    });

    /* Every field printed every run, including the zeroes and including the absences: a
       line that only appears when something is wrong is a line nobody knows the normal
       shape of. `heard=never` is a real state and reads differently from `heard=0`. */
    console.log(
      `projected pairs feed=${PAIR_FEED_ID} tick=${result.tick} ` +
        `pair_row=${result.written} withheld=${result.withheldRows} ` +
        `origin_recorded=${String(result.separable)} ` +
        `minted=${result.counts === null ? '-' : result.counts.mintsInWindow} ` +
        `with_market=${result.counts === null ? '-' : result.counts.withMarket} ` +
        `heard=${result.heardAt === null ? 'never' : new Date(result.heardAt).toISOString()}`,
    );
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(
      `the pairs projection failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
