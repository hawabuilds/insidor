/**
 * THE RANKED BOARD, in Hawa's Trending view: her section head, her two sub-tabs, her toolbar,
 * and her narratives table.
 *
 * THREE PROPERTIES THIS COMPONENT MUST NOT LOSE
 *
 *   - It renders `order.map((id, i) => <FeedRow rank={i + 1}/>)` and never sorts, filters or
 *     slices. The server commits `(tick, order)`; a client that re-sorts has silently replaced
 *     the ranking design with whatever the component author thought was reasonable. Hawa's
 *     header cells were click-to-sort; ours are labels, and the sort affordances are gone
 *     rather than merely inert — see the note at the top of feed.module.css.
 *
 *   - The `#` column is that `i + 1` and nothing else. It is computed here, at render, from
 *     the committed order. It is not a field on `BoardRow`, it is not in `BOARD_ROW_FIELDS`,
 *     and it must never become either.
 *
 *   - Keying by story id means React MOVES existing DOM nodes on a reorder rather than
 *     recreating them, so hover, focus and text selection survive a reorder that is applied.
 *
 * The freeze is attached to the board element, because "inside the board" is what holds the
 * order. Values keep patching while frozen; the pill says how many frames are waiting. The
 * two panes are display-toggled rather than mounted and unmounted — that is Hawa's mechanism
 * (`.trend-pane` / `.trend-pane.on`) and it is also what keeps that element, and therefore its
 * listeners, alive across a tab switch.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { BoardStore } from '../../shared/api/index.ts';
import {
  fetchBoard,
  useBoardMeta,
  useBoardOrder,
  useFreezeWhileInteracting,
  USING_FIXTURES,
} from '../../shared/api/index.ts';
import { formatDuration } from '../../shared/format/duration.ts';
import type { BuyAction } from './row-action.ts';
import { FeedRow } from './FeedRow.tsx';
import { readLink } from './link-status.ts';
import styles from './feed.module.css';

/** How often the age column re-reads the clock. Ages are coarse; a second is plenty. */
const CLOCK_MS = 1_000;

/**
 * Where the numbers on this screen came from. Derived, not asserted: a hardcoded "ingest is
 * not running" is a sentence that goes stale the day it starts running, and a provenance
 * label that has quietly become false is worse than none.
 *
 * `USING_FIXTURES` is a build-time literal — false whenever a read endpoint is configured, and
 * the fixtures are dropped from the bundle entirely in a production build.
 */
const SOURCE = USING_FIXTURES
  ? {
      label: 'sample data',
      title:
        'Every number on this board is invented. No database and no ingest are connected — these rows exist to show the rules, not the market.',
    }
  : {
      label: 'local database',
      title:
        'This board is computed from the local database. Nothing is ingesting into it right now, so it is a snapshot rather than a market feed.',
    };

/**
 * Her Trending sub-tabs (index.html:769-774). Two bare words, not a chip group.
 *
 * ★ Her first tab read "Narratives". It reads "Stories" here for the reason set out in the
 * NAV MAPPING note in App.tsx: "narrative" is our internal name for the grouping stage and is
 * banned from app/src, while "story" is the word the wire and the projection actually use.
 * Styling untouched — this is the same two-bare-word tab strip she drew.
 */
type Pane = 'stories' | 'tokens';

export interface FeedProps {
  readonly viewId: string;
  readonly store: BoardStore;
  /** The view heading. Owned by the shell, which is what knows which route is on screen. */
  readonly title: string;
  readonly sub: string;
  readonly onOpenStory: (storyId: string) => void;
  readonly onBuy: (action: BuyAction) => void;
}

/**
 * ★ WHY "NO ROWS" IS NOT ONE STATE.
 *
 * An empty board has two causes and only one of them is the world's: the board was read and
 * had nothing on it, or it could not be read at all. They must not render the same, and the
 * second must never be rendered as the first — the sentence below used to say "This is an
 * empty board, not a board that failed to load" over a board that had just failed to load,
 * which is worse than saying nothing, because it denies the exact thing that happened.
 *
 * `launches.ts` states the same rule for the rail and is where the argument is written out
 * in full. This is that rule, applied to the surface next to it.
 */
type ReadState = 'asking' | 'answered' | 'failed';

export function Feed({ viewId, store, title, sub, onOpenStory, onBuy }: FeedProps) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const order = useBoardOrder();
  const meta = useBoardMeta();
  const [now, setNow] = useState(() => Date.now());
  const [pane, setPane] = useState<Pane>('stories');
  const [read, setRead] = useState<ReadState>('asking');

  useFreezeWhileInteracting(boardRef, store);

  /* Derived at render from the store's own facts and the clock this component already ticks,
     so there is no second copy of "are we live" that can disagree with the store. */
  const link = readLink(meta, now);

  /* The clock is state, ticked here and passed down, so that every row in one paint agrees
     on what time it is and a test can state the time. */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  /* The authoritative read. The live channel has no replay, so this is also what runs on
     every reconnect and on every detected gap — see App.tsx, which owns that wiring.

     ★ THE OUTCOME IS RECORDED RATHER THAN SWALLOWED. A failure still does not throw and
     still does not blank rows we already hold — a stale board is worth looking at. What it
     is NOT is something the transport status line covers: that line describes the live
     channel, and "the channel is fine" and "this read succeeded" are different facts. A
     board that failed its first read under a healthy green pip would be the same lie in a
     new place. `read` is the missing half, and the empty state below is the only place it
     is used. */
  useEffect(() => {
    const ac = new AbortController();
    setRead('asking');
    fetchBoard(viewId, ac.signal)
      .then((tick) => {
        if (ac.signal.aborted) return;
        store.reset(tick);
        setRead('answered');
      })
      .catch(() => {
        /* An aborted request is us leaving, not a failure of the board. Reporting it would
           flash "could not be read" every time the view id changed. */
        if (ac.signal.aborted) return;
        setRead('failed');
      });
    return () => ac.abort();
  }, [viewId, store]);

  const handleCompare = useCallback((storyId: string) => onOpenStory(storyId), [onOpenStory]);
  const handleCreate = useCallback((storyId: string) => onOpenStory(storyId), [onOpenStory]);

  return (
    <>
      <div className={styles['vhead']}>
        <div className={styles['vtitle']}>{title}</div>
        <div className={styles['vsub']}>
          <span>{sub}</span>
          <span
            className={`${styles['simtag']} ${USING_FIXTURES ? styles['simtagFixtures'] : ''}`}
            title={SOURCE.title}
          >
            {SOURCE.label}
          </span>
        </div>
      </div>

      <div className={styles['subs']} role="tablist" aria-label="board">
        <button
          type="button"
          role="tab"
          aria-selected={pane === 'stories'}
          className={`${styles['sub']} ${pane === 'stories' ? styles['subOn'] : ''}`}
          onClick={() => setPane('stories')}
        >
          Stories
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={pane === 'tokens'}
          className={`${styles['sub']} ${pane === 'tokens' ? styles['subOn'] : ''}`}
          onClick={() => setPane('tokens')}
        >
          Tokens
        </button>
      </div>

      <div className={`${styles['pane']} ${pane === 'stories' ? styles['paneOn'] : ''}`}>
        <div className={styles['tbar']}>
          <div className={styles['tbarMeta']}>
            {/* ★ FOUR STATES, NOT TWO, AND THE TWO NEW ONES ARE THE POINT. The pip pulses
                lime only while updates are actually arriving; it goes amber while the
                channel is being reopened, and red and still once it has been down long
                enough that these rows are a photograph rather than a board. A board that has
                silently stopped receiving updates must not look identical to a quiet market,
                and rows alone cannot tell those apart — so the difference is said in words.
                link-status.ts owns which sentence is true; this renders it. */}
            <span className={`${styles['lz']} ${link.status === 'off' ? styles['lzOff'] : ''} ${
              link.status === 'reconnecting' ? styles['lzWait'] : ''
            } ${link.status === 'stale' ? styles['lzDead'] : ''}`} />
            <span
              className={link.status === 'stale' ? styles['lzDeadTxt'] : ''}
              title={link.title}
              role={link.status === 'stale' ? 'status' : undefined}
            >
              {link.label}
            </span>
            {/* When the board last moved. A measurement, not a status, and shown in every
                state — it is what tells a reader whether "live" means anything is happening. */}
            {meta.lastFrameAt === null ? null : (
              <span
                className={styles['fresh']}
                title="How long ago the last committed frame arrived."
              >
                {formatDuration(now - meta.lastFrameAt)} ago
              </span>
            )}
            {meta.pendingCount > 0 ? (
              <button
                type="button"
                className={styles['pill']}
                title="The order is held while you are reading the board. Press to apply what is waiting."
                onClick={() => store.setFrozen(false)}
              >
                {meta.pendingCount} update{meta.pendingCount === 1 ? '' : 's'} waiting
              </button>
            ) : null}
          </div>

          {/* A count, not a rank. How many rows the committed order carries — and a dash
              rather than a zero when no order has been committed to us, because "0 stories"
              is a statement about the board and we do not have one to make it about. */}
          <div className={styles['tbarMeta']}>
            <span className={styles['tbarCount']}>
              {order.length === 0 && read !== 'answered' ? '—' : order.length}
            </span>{' '}
            stories
          </div>
        </div>

        <div className={styles['board']} ref={boardRef} role="table" aria-label="ranked stories">
          {/* Eight header cells, in the same order and the same tracks as the row. `.h` marks
              the two that the width query drops; they are rendered either way. */}
          <div className={styles['header']} role="row">
            <span className={styles['rank']}>#</span>
            <span>Story</span>
            <span className={`${styles['headerRight']} ${styles['h']}`}>Activity</span>
            <span className={styles['headerRight']}>Views</span>
            <span className={styles['headerRight']}>Gain 24h</span>
            <span className={styles['headerRight']}>Age</span>
            <span className={`${styles['headerRight']} ${styles['h']}`}>Mkt cap</span>
            <span />
          </div>

          {order.length === 0 ? (
            /* ★ Three sentences for three different facts, and the middle one is the one
               that used to be missing. Read them as a set: only the last is entitled to say
               the board is empty, because only the last has been told so. */
            <div className={styles['noresult']}>
              {read === 'asking' ? (
                <>
                  <b>Reading the board.</b>
                  Nothing is shown until it answers. No placeholder rows and no invented
                  stories — an empty table beats a table of shapes that never resolve.
                </>
              ) : read === 'failed' ? (
                <>
                  <b>The board could not be read.</b>
                  The request failed, so this board is empty because we could not ask — not
                  because nothing has been published. Reopen the screen to try again.
                </>
              ) : (
                <>
                  <b>Nothing is on the board yet.</b>
                  The board publishes stories once there are stories to publish. This is an
                  empty board, not a board that failed to load.
                </>
              )}
            </div>
          ) : (
            /* ★ order.map, and nothing between the array and the rows. No sort, no filter, no
               slice. `i + 1` is the # column and it exists only for the length of this call. */
            order.map((id, i) => (
              <FeedRow
                key={id}
                id={id}
                rank={i + 1}
                now={now}
                onOpen={onOpenStory}
                onBuy={onBuy}
                onCompare={handleCompare}
                onCreate={handleCreate}
              />
            ))
          )}
        </div>
      </div>

      {/* The Tokens pane. A board of coins rather than stories, and nothing publishes that
          list — the coins that exist today arrive attached to a story, one at a time. So it
          says so, in her panel, in one line. No placeholder rows, no skeleton that never
          resolves, no table of zeroes. */}
      <div className={`${styles['pane']} ${pane === 'tokens' ? styles['paneOn'] : ''}`}>
        <div className={styles['board']}>
          <div className={styles['noresult']}>
            <b>There is no coin index yet.</b>
            Tokens ranks coins the way this board ranks stories, so it needs a published list of
            coins and a price for each one. Neither exists — every coin you can see today
            reaches the screen through the story it belongs to.
            <span className={styles['noresultNote']}>
              needs: a coins endpoint, and prices for the coins on it
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
