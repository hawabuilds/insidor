/**
 * THE LIVE RAIL — the permanent right column.
 *
 * Hawa's rail is not a drawer and there is no control to dismiss it: "main-left + permanent
 * live feed right (never hides)". It is part of the shell's grid, and it leaves only when the
 * viewport is too narrow to hold it (≤1040px, in rail.module.css).
 *
 * ★ ONE OF THE THREE TABS NOW HAS SOMETHING BEHIND IT. Launches reads
 * `GET /launches/:feedId` — coins in the order they were minted, projected once, server
 * side, already censored and already length-bounded. Trades and Viral keep their honest
 * empty cards, unchanged, because nothing is streaming fills and nothing is ingesting
 * posts. A tab that has data and a tab that does not must not look alike.
 *
 * ★ IT POLLS, AND IT SAYS SO. There is no live channel for launches — `openLiveChannel`
 * covers the board and is unimplemented besides — so the pill reads "updated 4s ago" and
 * never "feed live". rail.module.css makes the same argument about the pip: a pulsing cyan
 * dot over a feed nobody is streaming is the cheapest lie in the app.
 *
 * ★ AND THE PIP NOW ANSWERS TO TWO THINGS, NOT ONE. It used to light whenever the last read
 * succeeded, which was true and insufficient: for six days it pulsed over a mint feed that
 * had not been heard from in 141 hours, because our fetch loop was healthy the entire time.
 * `railView` folds the server's own judgement about the feed into `live`, so the dot goes
 * out when either half is untrue. The two facts are independent and the safe combination is
 * the conjunction.
 *
 * ★ EVERY DECISION IS IN launches.ts, NOT HERE. This file fetches on an interval, holds
 * four pieces of state, and renders what `railView` returns. That is deliberate and it is
 * not style: the test runner has no DOM, so a `.tsx` cannot be imported by a test at all —
 * anything decided in this file is untestable by construction.
 *
 * ★ TOKEN NAMES ARE TEXT AND ONLY EVER TEXT. `ticker`, `name` and `address` are typed by
 * whoever minted the coin. They are rendered as JSX children — never `dangerouslySetInnerHTML`
 * (which appears nowhere in this app), never an `href`, never a `src`, never a template that
 * becomes a URL. The projection already bounded their length and stripped control and bidi
 * characters; this is the second door, and it is the one that cannot be reasoned around.
 */

import { useEffect, useState } from 'react';

import { fetchLaunches } from '../../shared/api/index.ts';
import type { LaunchFeed } from '../../shared/api/index.ts';
import { Num } from '../../shared/ui/index.ts';
import { LAUNCH_FEED_ID, POLL_MS, railView } from './launches.ts';
import type { LaunchRow } from './launches.ts';
import styles from './rail.module.css';

type RailMode = 'trades' | 'launches' | 'viral';

interface Mode {
  readonly id: RailMode;
  readonly label: string;
  /** The rail header title for this mode. */
  readonly title: string;
  /** What this mode shows, in the present tense. */
  readonly shows: string;
  /** What has to exist first. One sentence, no roadmap. Null once something does. */
  readonly needs: string | null;
}

const MODES: readonly Mode[] = [
  {
    id: 'trades',
    label: 'Trades',
    title: 'Trades',
    shows: 'Fills as they land, newest first.',
    needs: 'Needs a trade feed. Nothing is streaming fills yet, so there is nothing to show.',
  },
  {
    id: 'launches',
    label: 'Launches',
    title: 'New launches',
    shows: 'Coins as they are minted.',
    /* Null: this one is wired. Its empty and error states come from `railView`, which knows
       whether the feed answered — a fixed sentence here would keep saying "nothing is
       watching for new coins" over a rail that was full. */
    needs: null,
  },
  {
    id: 'viral',
    label: 'Viral',
    title: 'Viral feed',
    shows: 'Posts as they spread.',
    needs: 'Needs a post feed. Nothing is ingesting posts yet, so there is nothing to show.',
  },
];

/* Her markup opens on Viral. */
const DEFAULT_MODE: RailMode = 'viral';

/** The clock the ages are drawn against. One state update, so every row agrees on "now". */
const CLOCK_MS = 1_000;

/**
 * One mint, in her tape-row grammar: icon | text | right-aligned figures.
 *
 * Nothing in here is clickable and nothing is a link. The address is identification — it is
 * the only thing separating three coins that all call themselves the same word — and it is
 * shown truncated so it reads as identification rather than as something to copy blind.
 */
function LaunchTapeRow({ row }: { row: LaunchRow }) {
  return (
    <div className={styles['tapeRow']}>
      {/* A letter, not the coin's own image. A mint's image URI is a URL an attacker chose,
          and an <img src> would be a request to their host for every row that scrolls past.
          The tile takes the dashed "not a real coin" treatment when there is no ticker to
          take a letter from, which is her existing grammar for exactly that. */}
      <span
        className={`${styles['tapeIc']} ${row.ticker === '' ? styles['tapeIcPend'] : styles['tapeIcOn']}`}
        aria-hidden="true"
      >
        {row.tile}
      </span>

      <div className={styles['tapeMid']}>
        <div className={styles['tapeSym']}>
          {/* An unknown ticker renders as nothing at all. It does NOT fall back to the
              address or to the name — either would look like a ticker to a person. */}
          <span>{row.ticker}</span>
          <span className={styles['tapeVenue']}>{row.venueLabel}</span>
        </div>
        {/* ★ THE ADDRESS COMES FIRST, AND THAT ORDER IS THE POINT. This line is clipped
            when it does not fit, so whichever end is last is the end that disappears — and
            the address is the ONLY thing telling three coins called "Jersey" apart, while
            the name is the string an attacker chose. Putting the short, fixed-width fact
            first means a name written to be 48 characters long pushes itself out of view
            rather than pushing the identification out of view. */}
        <div className={styles['tapeAct']} title={row.name}>
          {row.name === '' ? row.address : `${row.address} · ${row.name}`}
        </div>
      </div>

      <div className={styles['tapeR']}>
        <div className={styles['tapeSol']}>
          {/* Absent stays absent: a coin minted a minute ago has no pool and therefore no
              cap, and `formatUsd` returns the pending glyph with its reason rather than $0. */}
          <Num rendered={row.cap} />
        </div>
        <div className={styles['tapeT']} title={row.ageLabel} aria-label={row.ageLabel}>
          <Num rendered={row.age} dim />
        </div>
      </div>
    </div>
  );
}

export function LiveRail() {
  const [mode, setMode] = useState<RailMode>(DEFAULT_MODE);
  const [feed, setFeed] = useState<LaunchFeed | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const current = MODES.find((m) => m.id === mode) ?? MODES[MODES.length - 1];
  const onLaunches = mode === 'launches';

  /* Ages tick without a refetch. A rail whose "updated 4s ago" only moved when a request
     landed would freeze at the exact moment the freezing is the thing worth seeing. */
  useEffect(() => {
    if (!onLaunches) return;
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, [onLaunches]);

  /* The poll. It runs only while the Launches tab is open — a rail asking every six seconds
     for a list nobody is looking at is load we chose to spend on nothing — and every request
     carries the abort signal, so switching tabs or unmounting cancels the one in flight
     instead of resolving into a component that is gone.

     A failure is STORED rather than swallowed. The board's refetch deliberately ignores its
     own errors because a stale board beats no board and the status line already says we are
     not live; this rail has no such line unless it writes one, so the error is state and
     `railView` turns it into a banner. */
  useEffect(() => {
    if (!onLaunches) return;
    const controller = new AbortController();
    let live = true;

    const poll = (): void => {
      fetchLaunches(LAUNCH_FEED_ID, controller.signal).then(
        (next) => {
          if (!live) return;
          setFeed(next);
          setFailure(null);
          setLastOkAt(Date.now());
        },
        (error: unknown) => {
          /* An aborted request is not a failure of the feed — it is us leaving. Reporting it
             would flash "could not be read" every time somebody switched tabs. */
          if (!live || controller.signal.aborted) return;
          setFailure(error);
        },
      );
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
      controller.abort();
    };
  }, [onLaunches]);

  const view = railView({ feed, failure, lastOkAt, now });

  return (
    <aside className={styles['rail']} aria-label="live activity">
      <div className={styles['hd']}>
        {/* Off unless the last read of a wired feed actually succeeded. */}
        <span className={`${styles['lz']} ${onLaunches && view.live ? '' : styles['lzOff']}`} />
        <span className={styles['t']}>{current?.title ?? 'Live activity'}</span>
        {onLaunches ? (
          <span
            className={`${styles['status']} ${view.live ? styles['statusHot'] : ''}`}
            title="Polled, not streamed — this is when the last read came back"
          >
            {view.status}
          </span>
        ) : (
          <span className={styles['status']} title="No ingest is connected">
            no ingest
          </span>
        )}
        {/* An absent count is a dash, never 0 — 0 would read as "nothing happened". A count
            of zero from a feed that answered is a different thing and is shown as one. */}
        <span className={styles['count']}>{onLaunches ? view.count : '—'}</span>
      </div>

      <div className={styles['tabs']} role="tablist" aria-label="live feed mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={m.id === mode}
            className={`${styles['tab']} ${m.id === mode ? styles['tabOn'] : ''}`}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* ★ TWO BANNERS, STACKED, AND THE ORDER IS THE POINT. The amber surface is the
          rail's one signal that something is degraded-but-not-broken, and there are two
          independent things it can be saying.

          The SOURCE notice comes first because it is the more consequential of the two: a
          failing poll is our problem and self-correcting, while a mint feed nobody has
          heard from in six days means every age below is wrong about what "new" means. They
          are not exclusive and neither substitutes for the other — the state that shipped
          was a perfectly healthy poll over a dead transport, which produces exactly one of
          these and not the other.

          Both are `role="status"` rather than `alert`: this is a degradation a reader
          should notice, not an interruption. */}
      {onLaunches && view.sourceNotice !== null ? (
        <div className={styles['pausedBanner']} role="status">
          <b>{view.sourceNotice.headline}</b>
          {view.sourceNotice.detail}
        </div>
      ) : null}

      {onLaunches && view.notice !== null ? (
        <div className={styles['pausedBanner']} role="status">
          <b>{view.notice.headline}</b>
          {view.notice.detail}
        </div>
      ) : null}

      <div className={styles['stream']}>
        {onLaunches ? (
          <>
            {view.rows.map((row) => (
              <LaunchTapeRow key={row.key} row={row} />
            ))}
            {/* The end of the list, said out loud when the list is not the end of the frame.
                A scroller that simply stops claims its last row is the last mint. */}
            {view.overflow === null ? null : (
              <div className={styles['overflowNote']}>{view.overflow}</div>
            )}
            {view.empty === null ? null : (
              <div className={styles['card']}>
                <div className={styles['cardTitle']}>{view.empty.title}</div>
                <div className={styles['cardText']}>{view.empty.text}</div>
              </div>
            )}
          </>
        ) : (
          /* One real card, in her card chrome, carrying the truth. The shape is on screen and
             correct; nothing on it is invented. */
          <div className={styles['card']}>
            <div className={styles['cardTitle']}>{current?.shows ?? ''}</div>
            <div className={styles['cardText']}>{current?.needs ?? ''}</div>
            <span className={styles['cardNote']}>
              When the feed is connected, items arrive here newest-first and this card goes away.
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
