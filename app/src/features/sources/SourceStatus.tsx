/**
 * THE SOURCE INDICATOR — a few pixels in the corner of the nav, and one sentence under it.
 *
 * ★ WHAT IT IS FOR, in one sentence: a board fed by three sources and a board fed by one
 * look identical, and this is the only thing on the screen that says which you are looking
 * at. Everything else the app renders is a fact about the world; this is the fact that tells
 * you how much of the world reached us.
 *
 * ★ EVERY DECISION IS IN sources.ts, NOT HERE. This file polls on an interval, holds four
 * pieces of state, and renders what `sourcesView` returns. That is not style: the test
 * runner has no DOM, so a `.tsx` cannot be imported by a test at all, and anything decided
 * in this file is untestable by construction. Which shape a state takes, what a pip says on
 * hover, when the shell owes the reader a sentence — all of it is out there, where
 * `sources.test.ts` can call it with literals. `LiveRail.tsx` says the same thing from the
 * same position.
 *
 * ★ THREE SEPARATE CHANNELS CARRY THE STATE, AND THAT IS THE ACCESSIBILITY REQUIREMENT
 * RATHER THAN A FLOURISH. A shape (disc, ring, diamond), a colour, and a word — so the
 * indicator still works for a reader who cannot separate the red from the lime, and it still
 * works in a greyscale screenshot pasted into a document, which is how most people will ever
 * see it. Colour alone would fail both.
 *
 * ★ AND THE DETAIL IS REACHABLE BY KEYBOARD, which is why there is a `.tip` element at all
 * rather than a bare `title`. A native tooltip appears on hover and never on focus, so a
 * `title` alone puts the entire explanation behind a mouse. Each source is a focus target,
 * `:focus-within` reveals the same sentence, and `aria-label` carries it to a screen reader.
 * One string, chosen once in sources.ts, delivered three ways.
 *
 * ★ NOTHING HERE IS CLICKABLE, deliberately. The nav says WHICH source is dark; the banner
 * under it says what that means for what is on screen. There is no third thing to open, and
 * a click target would promise one.
 */

import { useEffect, useState } from 'react';

import { fetchSources } from '../../shared/api/index.ts';
import type { SourceFeed } from '../../shared/api/index.ts';
import { POLL_MS, SOURCE_VIEW_ID, sourcesView } from './sources.ts';
import type { SourcesView } from './sources.ts';
import styles from './sources.module.css';

/** The clock the ages behind the tooltips are drawn against. One update, so all agree. */
const CLOCK_MS = 1_000;

/**
 * The poll, the clock, and the view — as a hook, so the shell holds no logic of its own.
 *
 * ★ WHY A HOOK AND NOT TWO COMPONENTS THAT EACH FETCH. The indicator and the banner live in
 * different places in the DOM — one inside the nav, one below it — and they must never be
 * able to disagree, because they are two renderings of one frame. Two fetches would be two
 * frames, and the pair could show a lit pip above a sentence saying nothing is answering.
 * One hook, one frame, two consumers.
 *
 * The poll runs unconditionally, unlike the rail's — the rail's runs only while its tab is
 * open because nobody is looking at a list they cannot see. This is in the nav on every
 * route, so there is no moment when it is not being looked at, and at thirty seconds it is
 * two requests a minute for the fact that gives every other surface its meaning.
 *
 * A failure is STORED rather than swallowed. The board's refetch ignores its own errors,
 * because a stale board beats no board and the status line already says it is not live; this
 * corner has no such line unless it writes one, so the error becomes state and `sourcesView`
 * turns it into a dash with a cause.
 */
export function useSourceHealth(): SourcesView {
  const [feed, setFeed] = useState<SourceFeed | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  /* Ages tick without a refetch. A corner whose "not updating" only appeared when a request
     landed would say nothing at the exact moment nothing is landing. */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    const poll = (): void => {
      fetchSources(SOURCE_VIEW_ID, controller.signal).then(
        (next) => {
          if (!alive) return;
          setFeed(next);
          setFailure(null);
          setLastOkAt(Date.now());
        },
        (error: unknown) => {
          /* An aborted request is not a failure of anything — it is us leaving. Reporting it
             would flash a dash in the nav on every unmount. */
          if (!alive || controller.signal.aborted) return;
          setFailure(error);
        },
      );
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
      controller.abort();
    };
  }, []);

  return sourcesView({ feed, failure, lastOkAt, now });
}

/**
 * The cluster, for the nav's right-hand group.
 *
 * `role="status"` on the cluster and never `alert`: a dark source is a state a reader should
 * notice, not an interruption that seizes their focus. It is ONE landmark with one
 * accessible name rather than N, so a screen reader passing through the nav hears a single
 * summary instead of three separate images.
 */
export function SourceStatus({ view }: { view: SourcesView }) {
  return (
    <div
      className={`${styles['sources']} ${view.confirmed ? '' : styles['stalled']}`}
      role="status"
      aria-label={view.label}
    >
      {view.pips.map((pip) => (
        /* Focusable, so the sentence behind the shape is reachable without a mouse. The
           global `:focus-visible` ring in tokens.css applies unchanged. */
        <span
          key={pip.key}
          className={styles['src']}
          tabIndex={0}
          role="img"
          aria-label={pip.detail}
          title={pip.detail}
        >
          <span className={`${styles['pip']} ${styles[pip.shape]}`} aria-hidden="true" />
          {/* The label is a string the SERVER chose and this app never derives one. It is
              rendered as JSX children — never an href, never a src, never a template that
              becomes a URL — and it was bounded twice before it got here. */}
          <span
            className={`${styles['label']} ${pip.state === 'failing' ? styles['labelFailing'] : ''}`}
            aria-hidden="true"
          >
            {pip.label}
          </span>
          <span className={styles['tip']} aria-hidden="true">
            {pip.detail}
          </span>
        </span>
      ))}

      {/* The dash-with-a-cause, or "not updating". Never a silent blank: an indicator that
          disappears when it cannot read is indistinguishable from a healthy one. */}
      {view.note === null ? null : (
        <span className={styles['note']} tabIndex={0} title={view.note.detail}>
          {view.note.text}
          <span className={styles['tip']} aria-hidden="true">
            {view.note.detail}
          </span>
        </span>
      )}
    </div>
  );
}

/**
 * The sentence, when one is owed. Rendered by the shell, directly under the nav.
 *
 * ★ IT IS THE APP'S ONE AMBER SURFACE AND NOT A SECOND ONE. The rail's `.pausedBanner`, the
 * pairs screen's reuse of it and the shell's `.fixtureBar` are all this same recipe, and
 * amber is what this app means by "degraded but not broken". A second treatment would dilute
 * the one signal that already means something.
 *
 * `role="status"` for the rail's reason: a reader should notice it, not be interrupted by
 * it. `<b>` is the fact; the body is what it means for what is on screen — the fixed grammar
 * every banner here follows.
 */
export function SourceBanner({ view }: { view: SourcesView }) {
  if (view.notice === null) return null;
  return (
    <div className={styles['banner']} role="status">
      <b>{view.notice.headline}</b>
      {view.notice.detail}
    </div>
  );
}
