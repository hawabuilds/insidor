/**
 * What stops the board flickering.
 *
 * A client-side sort over a live-updating value flickers, and no amount of smoothing
 * fixes it — the fix is that the server commits an order and the client renders the
 * order it was given, patching values in place. This file is the committing half.
 *
 * Five rules, and every one of them is in Policy: a challenger must beat the
 * incumbent by an edge to swap at all; two consecutive ticks to enter; three to
 * leave; a minimum dwell in seconds; and a cap on how many positions anything moves
 * in one tick. Plus one escape hatch, because without it a genuinely explosive new
 * entrant is held out of the board by the dwell rule for exactly the minutes it
 * mattered — and being early is the product.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ WHAT A BOARD WITHOUT HYSTERESIS FEELS LIKE, written down because it is the whole
 * reason this file exists and it is invisible in a screenshot.
 *
 * A user is reading row four. The tick fires. Row four is now row six, because two
 * stories a thousandth of a point behind it crossed over. They cross back on the next
 * tick. The row the user was reaching for moves under the cursor, twice, in the time
 * it takes to move a hand — so they miss, click the wrong thing, and learn within
 * about ninety seconds that this board cannot be read, only stared at. Nothing on the
 * page is wrong. Every number is correct and freshly computed. The board is unusable
 * anyway.
 *
 * ★ AND WHY SMOOTHING GENUINELY CANNOT FIX IT, which is the part people try first.
 * Smoothing acts on the VALUE; the flicker is in the COMPARISON. However smooth two
 * curves are, where they cross they cross repeatedly, because a crossing is the place
 * their difference is zero and therefore the place noise decides the sign. Smoothing
 * lowers the crossing RATE and never removes a crossing. The only fix is to make the
 * ordering depend on more than the current instant — that is, to give the board
 * memory. Hysteresis is that memory, and the five rules are its shape.
 *
 * ★ THE ASYMMETRY IS DELIBERATE: two ticks to enter, three to leave. A row that
 * vanishes and reappears is worse to read than one that lingers a beat too long,
 * because the first breaks the reader's model of what the board IS and the second
 * only makes it slightly stale.
 *
 * ★ AND THE HATCH HAS A PRICE, WITH A NUMBER ON IT. The dwell rule otherwise costs
 * about forty seconds of the product's core claim — the minutes in which being early
 * is the entire value — so the hatch buys those back and pays for them in occasional
 * churn at the bottom of the board. That is a written commitment with a number
 * attached rather than a principle.
 *
 * ★ PURE, AND THAT BUYS ANSWERABILITY. A past board can be reproduced from stored
 * scores, which is the only way to answer "why was this in slot three an hour ago".
 * A client-side sort is not reconstructible at all: the ordering existed only inside
 * a browser that has since been closed.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

import { MS_PER_SECOND } from '../math.ts';

/**
 * One place on the board — and THE MEMORY the header argues the board must have. These
 * three fields are all of it: without them `commitBoard` sees only the current instant
 * and cannot be anything but a sort.
 *
 * Two counters and not one because they count for two different populations against two
 * different bars: `ticksBelow` accrues only on a COMMITTED row that keeps failing, and
 * `ticksAbove` only on a BENCHED row that keeps qualifying. Each is zeroed the moment a
 * row changes side. A single signed counter would carry a row's benched history into its
 * committed life and let one tick above pay for one tick below, which is precisely the
 * cancellation the asymmetry exists to prevent. `enteredAt` is the clock the minimum
 * dwell is measured from — stamped on entry, then never touched again.
 *
 * ★ AND THE CONSEQUENCE OF LOSING THEM: this struct is the caller's to persist between
 * ticks. Hand `commitBoard` a freshly-built slot each tick and every rule here still
 * runs, still typechecks and does nothing — every counter reads zero forever, and the
 * board flickers exactly as if this file did not exist.
 */
export interface BoardSlot {
  readonly subjectId: string;
  readonly score: number;
  readonly enteredAt: Millis;
  readonly ticksAbove: number;
  readonly ticksBelow: number;
}

/**
 * One subject's contribution to one tick.
 *
 * ★ IT IS NOT A BARE NUMBER, AND IT COULD NOT BE. The escape hatch is a bar on
 * `burst`, and neither `BoardSlot` nor a `Record<string, number>` carries one — so
 * with a plain score map the hatch is a policy field that no code path can ever
 * reach, and `newEntrantBurst: 3` would sit in the policy object being hashed onto
 * every decision row while doing nothing at all. Two fields, both storable, so the
 * transition stays reproducible from what a tick wrote down.
 */
export interface TickScore {
  readonly score: number;
  /**
   * fast/slow for this subject at this tick, or null when it could not be measured.
   * NULL AND NOT 1: one is the claim "flat", and an unmeasured ratio is not a claim
   * about anything. The hatch below tests it with `?? 0`, so an absence can never
   * open it — which is the correct direction, because the hatch exists to let
   * measured explosions past a rule, not unmeasured ones.
   */
  readonly burst: number | null;
}

/**
 * The board transition, one tick.
 *
 * ★ THE RETURNED ARRAY IS THE BOARD STATE, NOT THE RENDERED BOARD. `committed()`
 * below returns the rendered slice; everything after it is the bench.
 *
 * The bench is not an optimisation, it is what makes `ticksToEnter: 2` mean two. A
 * challenger has to be above the line on two CONSECUTIVE ticks, so the transition has
 * to remember that it was above on the previous one — and a return type holding only
 * the rendered rows has nowhere to keep that. The rule then silently becomes
 * `ticksToEnter: 1`: a challenger enters the moment it first clears the edge, which
 * is precisely the flicker this file exists to stop, reintroduced by a type. Feeding
 * the whole array back in next tick is what makes the memory work.
 *
 * @param current the array this function returned last tick. Empty on the first one.
 * @param scores  this tick's scores, by subject id. A subject absent from it was not
 *                scored — which is not the same as scoring zero; see below.
 * @param now     the clock, as a value. The dwell rule reads it and nothing else does.
 */
export function commitBoard(
  current: readonly BoardSlot[],
  scores: Readonly<Record<string, TickScore>>,
  now: Millis,
  p: Policy,
): readonly BoardSlot[] {
  const slots = p.rank.slots;
  const swapEdge = p.rank.swapEdge;
  const dwellMs = p.rank.minDwellS * MS_PER_SECOND;

  /* ── 1. refresh what we already know about ────────────────────────────── */

  const rows: Row[] = [];
  const known = new Set<string>();

  for (let index = 0; index < current.length; index++) {
    const slot = current[index] as BoardSlot;
    known.add(slot.subjectId);
    const tick = scores[slot.subjectId];
    const wasCommitted = index < slots;
    // ★ AN UNSCORED ROW KEEPS ITS SCORE. A subject missing from this tick was not
    // measured at zero, it was not measured. Reading the absence as a zero would
    // evict every row on the board during a scorer outage and then let them all back
    // in when it cleared, which is the worst possible board to be looking at while
    // something is broken.
    rows.push({
      subjectId: slot.subjectId,
      score: tick?.score ?? slot.score,
      burst: tick?.burst ?? null,
      enteredAt: slot.enteredAt,
      ticksAbove: slot.ticksAbove,
      ticksBelow: slot.ticksBelow,
      committed: wasCommitted,
      scoredThisTick: tick !== undefined,
    });
  }

  /* ── 2. admit newcomers to the bench, never straight to the board ─────── */

  for (const subjectId of Object.keys(scores).sort()) {
    if (known.has(subjectId)) continue;
    const tick = scores[subjectId] as TickScore;
    rows.push({
      subjectId,
      score: tick.score,
      burst: tick.burst,
      enteredAt: now,
      ticksAbove: 0,
      ticksBelow: 0,
      committed: false,
      scoredThisTick: true,
    });
  }

  // A bench row nobody scored this tick is a subject that has left the pipeline. It
  // is dropped rather than kept, because the bench exists only to carry tick counts
  // for subjects still being scored. A committed row survives the same absence — see
  // above — because evicting it would be reading an outage as a claim.
  const live = rows.filter((row) => row.committed || row.scoredThisTick);

  /* ── 3. the provisional order: what a client-side sort would show ─────── */

  const provisional = [...live].sort(byScoreThenId);
  const provisionalIndex = new Map<string, number>();
  for (let i = 0; i < provisional.length; i++) {
    provisionalIndex.set((provisional[i] as Row).subjectId, i);
  }

  const board = live.filter((row) => row.committed);
  const bench = live.filter((row) => !row.committed);
  const cutScore = board.length < slots ? null : lowestScore(board);

  /* ── 4. the counters, which are the memory the five rules run on ─────── */

  for (const row of board) {
    row.ticksAbove = 0;
    // Only a row we actually scored can accumulate evidence against itself.
    if (!row.scoredThisTick) continue;
    row.ticksBelow = (provisionalIndex.get(row.subjectId) ?? 0) >= slots ? row.ticksBelow + 1 : 0;
  }

  for (const row of bench) {
    row.ticksBelow = 0;
    const clearsLine = cutScore === null || row.score >= cutScore + swapEdge;
    row.ticksAbove = clearsLine ? row.ticksAbove + 1 : 0;
  }

  /* ── 5. entry ─────────────────────────────────────────────────────────── */

  const hatched = (row: Row): boolean => (row.burst ?? 0) >= p.rank.newEntrantBurst;
  const waiting = [...bench].sort(byScoreThenId);

  // Free slots first, and WITHOUT the two-tick rule. That rule exists to stop a row
  // flickering in and out at the BOUNDARY, and a free slot has no boundary: nothing
  // is displaced, so there is nothing to flicker against. Applying it here would buy
  // no stability at all and would cost the first forty seconds of every cold start,
  // during which the product's core claim is a blank page.
  while (board.length < slots && waiting.length > 0) {
    const entrant = waiting.shift() as Row;
    seat(entrant, now);
    board.push(entrant);
  }

  // Displacement is where all five rules apply, because displacement is the only
  // thing a reader experiences as the board moving under them.
  const queue = waiting.filter((row) => row.ticksAbove >= p.rank.ticksToEnter || hatched(row));

  // Then swaps, weakest incumbent against strongest challenger, one at a time. The
  // loop is bounded by the queue because every iteration consumes exactly one entry
  // from it or stops.
  while (queue.length > 0) {
    const weakest = weakestOf(board);
    if (weakest === null) break;
    const challenger = queue[0] as Row;

    /*
     * ★ THE HATCH SKIPS EVERY DELAY AND NO BAR. That one sentence is the whole rule
     * and it is worth stating rather than inferring, because "skips the dwell" is
     * what the design note says and the dwell is only one of three delays.
     *
     * The edge below is a BAR: it says this challenger is not actually better, and no
     * amount of explosiveness makes a near-tie into a lead. Everything after it is a
     * DELAY: two ticks to enter, three to leave, ninety seconds of dwell — all three
     * are the board buying legibility with time, and all three cost a genuinely
     * explosive entrant exactly the minutes in which being early was the product.
     * A hatch that skipped only the last of them would still be a hundred seconds
     * late, which is most of the window it exists to protect.
     */
    if (challenger.score < weakest.score + swapEdge) break;

    if (!hatched(challenger)) {
      // Three ticks below before a row leaves. A row nobody scored this tick is
      // exempt from needing them — that is evidence about the CHALLENGER, and an
      // incumbent should not be able to hold a slot by going silent.
      if (weakest.scoredThisTick && weakest.ticksBelow < p.rank.ticksToLeave) break;
      // The dwell: a row that has only just taken its place is not displaced, so a
      // reader's eye has time to land on it before it moves.
      if (now - weakest.enteredAt < dwellMs) break;
    }

    queue.shift();
    board[board.indexOf(weakest)] = challenger;
    seat(challenger, now);
    unseat(weakest);
  }

  /* ── 6. the order INSIDE the board, which is where the flicker lives ──── */

  /*
   * ★ THE EDGE APPLIES TO REORDERING TOO, AND THIS IS THE PART THAT IS EASY TO MISS.
   *
   * Gating only entry and exit leaves the board's interior sorted by raw score, which
   * means the rows a reader is actually looking at still trade places on a
   * thousandth of a point — "row four is now row six" is a reorder, not an eviction,
   * and it is the failure in this file's header. So `board` is carried forward IN ITS
   * COMMITTED ORDER and rows move only by beating the row above them by `swapEdge`.
   *
   * ★ AND THE PASS COUNT IS THE MOVEMENT CAP, which is why this is a bubble rather
   * than a sort. Each pass moves any row by at most one position — the `i += 1` after
   * a swap is what guarantees it, by taking the row that just moved out of the rest of
   * this pass. So `maxPositionsMovedPerTick` passes move nothing further than that
   * many positions, with no separate clamp to keep in agreement with the sort. A row
   * that deserves to climb ten places gets there over three ticks, visibly, instead of
   * teleporting once.
   */
  for (let pass = 0; pass < p.rank.maxPositionsMovedPerTick; pass++) {
    let moved = false;
    for (let i = 0; i + 1 < board.length; i++) {
      const above = board[i] as Row;
      const below = board[i + 1] as Row;
      if (below.score < above.score + swapEdge) continue;
      board[i] = below;
      board[i + 1] = above;
      moved = true;
      i += 1;
    }
    // Settled. Every later pass would do nothing, and stopping says so.
    if (!moved) break;
  }

  const nextBench = live.filter((row) => !row.committed).sort(byScoreThenId);

  return [...board, ...nextBench].map(toSlot);
}

/**
 * The rows a client renders, in the order it renders them. The client sorts nothing —
 * whatever this returns IS the board, and a browser that re-sorts it has reintroduced
 * every problem in this file's header.
 */
export function committed(state: readonly BoardSlot[], p: Policy): readonly BoardSlot[] {
  return state.slice(0, p.rank.slots);
}

/* ── the working row ──────────────────────────────────────────────────── */

interface Row {
  readonly subjectId: string;
  score: number;
  burst: number | null;
  enteredAt: Millis;
  ticksAbove: number;
  ticksBelow: number;
  committed: boolean;
  scoredThisTick: boolean;
}

/**
 * Descending by score, then ascending by id.
 *
 * The id tiebreak is not cosmetic: without it two equal scores order by whatever the
 * sort happened to do, and `commitBoard` stops being reproducible from stored scores —
 * which is the property the whole file is claiming. Equal scores are common, because
 * a score is a float that clamps.
 */
function byScoreThenId(a: Row, b: Row): number {
  return b.score - a.score || compareId(a, b);
}

function compareId(a: Row, b: Row): number {
  return a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0;
}

function lowestScore(board: readonly Row[]): number {
  let lowest = Number.POSITIVE_INFINITY;
  for (const row of board) if (row.score < lowest) lowest = row.score;
  return lowest;
}

function weakestOf(board: readonly Row[]): Row | null {
  let weakest: Row | null = null;
  for (const row of board) {
    if (weakest === null || row.score < weakest.score || (row.score === weakest.score && compareId(row, weakest) > 0)) {
      weakest = row;
    }
  }
  return weakest;
}

/** Taking a slot restarts the dwell clock, because the dwell is on the PLACE. */
function seat(row: Row, now: Millis): void {
  row.committed = true;
  row.enteredAt = now;
  row.ticksAbove = 0;
  row.ticksBelow = 0;
}

function unseat(row: Row): void {
  row.committed = false;
  row.ticksAbove = 0;
  row.ticksBelow = 0;
}

function toSlot(row: Row): BoardSlot {
  return {
    subjectId: row.subjectId,
    score: row.score,
    enteredAt: row.enteredAt,
    ticksAbove: row.ticksAbove,
    ticksBelow: row.ticksBelow,
  };
}
