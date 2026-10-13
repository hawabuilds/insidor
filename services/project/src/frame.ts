/**
 * One frame of the story board: load the facts, project the board and every story page,
 * and write both. The launches rail and the announcement stay in main.ts.
 *
 * Split out of main.ts so the end-to-end test in e2e/ runs THIS code against a real
 * schema, rather than a copy of the sequence that could drift from what production runs.
 * main.ts calls it inside its own transaction; nothing here opens or commits one.
 *
 * What breaks if this is changed carelessly: the board and the story pages are written in
 * the caller's transaction as one frame. Committing inside here would let a board point at
 * story pages that were never written.
 */

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { PgFeedRejectionRepo, type Db } from '@insidor/store';

import {
  FREE_POST_SOURCE_LABEL,
  loadStoryFacts,
  nextTick,
  previousBoardStoryIds,
  writeBoard,
  writeStories,
} from './db.ts';
import { projectBoard, projectBoardProvenance, projectStory, projectStoryProvenance } from './project.ts';
import type { ProjectOptions } from './project.ts';
import { checkNarratives, loadPostReasons } from './narrative-rules.ts';
import { countAnchors, windowIsOrdered } from './window.ts';
import { WireLeakError } from './wire.ts';
import type { WireStory } from './wire.ts';

const MINUTE_MS = 60_000;

/** How much the frame reads. Bounds on fetching, chosen by the caller. */
export interface FrameWindows {
  readonly storiesSinceMs: number;
  readonly reachSinceMs: number;
  readonly limit: number;
}

export async function projectStoryFrame(db: Db, viewId: string, options: ProjectOptions, windows: FrameWindows) {
  const tick = await nextTick(db, viewId);
  const load = await loadStoryFacts(db, {
    storiesSinceMs: windows.storiesSinceMs,
    reachSinceMs: windows.reachSinceMs,
    limit: windows.limit,
    previousBoard: await previousBoardStoryIds(db, viewId),
  });
  /* ★ THE OWNER'S RULES, BEFORE ANYTHING IS PROJECTED: a narrative needs enough posts that pass
     the per-post rules, and lists only those. What is left out is recorded with why
     (public.feed_rejection) and stays in the database. See narrative-rules.ts. */
  const reasons = await loadPostReasons(db, load.stories.flatMap((s) => s.members.map((m) => m.itemId)), DEFAULT_POLICY);
  const checked = checkNarratives(load.stories, reasons, DEFAULT_POLICY);
  await new PgFeedRejectionRepo(db).record(checked.rejections);
  const facts = checked.kept;

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
  const boardRows = await writeBoard(db, viewId, tick, board.rows, provenance);
  const storyViews = await writeStories(db, pages);
  return {
    tick,
    anchors,
    boardRows,
    storyViews,
    considered: facts.length,
    skipped,
    withheld: board.withheld.length,
    /* Each story's coin link as this frame committed it. The For You feed reads a post's
       coin from here and nowhere else — see rising.ts. */
    coinsByStory: new Map(board.rows.map((row) => [row.id, row.coins])),
  };
}
