/**
 * THE PAIRS SCREEN, in Hawa's chrome: her section head, her toolbar, her table, her empty
 * card, and the rail's one amber banner.
 *
 * ★ NOT ONE NEW CLASS. Every className below comes from `feed.module.css` or
 * `rail.module.css` — the same eight grid tracks the board declares, the same sticky header
 * recipe, the same `.noresult` card, the same amber `.pausedBanner`. That is deliberate
 * beyond tidiness: a second table styled independently is a second table that drifts, and
 * this screen and the board are the same object at two altitudes. The eight tracks are
 * reused as they are and the columns were chosen to fit them, rather than the tracks being
 * bent to fit new columns.
 *
 * THREE PROPERTIES THIS COMPONENT MUST NOT LOSE
 *
 *   - It renders `view.rows.map(...)` and never sorts, filters or slices. The server
 *     committed the order and it is MINT order — a client that re-sorted would be inventing
 *     an ordering claim, and the one a user would reach for ("newest pair") is precisely the
 *     one nothing in this system can derive.
 *
 *   - It makes no decision. Every sentence, every dash and every branch comes out of
 *     `pairsView` in `pairs.ts`, where a test can call it with literals. This runner has no
 *     DOM, so anything decided in this file is untestable by construction.
 *
 *   - ★ EVERY STRING FROM A COIN IS RENDERED AS TEXT. `ticker` and `name` are typed by
 *     whoever minted the coin. They go into JSX children — never into `dangerouslySetInnerHTML`,
 *     never into an `href`, never into an `<img src>`, and never into a template that becomes
 *     one. The projection already bounds their length and strips control and bidi characters;
 *     this is the second door, and there are two on purpose.
 */

import { useEffect, useState } from 'react';

import { fetchPairs, USING_FIXTURES } from '../../shared/api/index.ts';
import type { PairFeed } from '../../shared/api/index.ts';
import { Num } from '../../shared/ui/index.ts';
import feed from '../feed/feed.module.css';
import rail from '../rail/rail.module.css';
import { PAIR_FEED_ID, POLL_MS, pairsView } from './pairs.ts';
import type { PairRow } from './pairs.ts';

/** How often the age columns re-read the clock. Ages are coarse; a second is plenty. */
const CLOCK_MS = 1_000;

/**
 * Where the numbers on this screen came from. Derived, not asserted — a hardcoded sentence
 * about what is connected goes stale the day it changes, and a provenance label that has
 * quietly become false is worse than none. `Feed.tsx` says the same thing the same way.
 */
const SOURCE = USING_FIXTURES
  ? {
      label: 'sample data',
      title:
        'Every number on this screen is invented. No database and no market reader are connected — these rows exist to show the rules, not the market.',
    }
  : {
      label: 'local database',
      title:
        'This screen is computed from the local database. Each row carries the age of the reading it came from.',
    };

/**
 * One row.
 *
 * Eight cells, in the same order and the same tracks as the header below it — and all eight
 * always rendered, with `.h` marking the two the width query drops. Conditional rendering
 * would let the header and the rows fall out of lockstep at one width and not another, which
 * tears the grid; `feed.module.css` states that rule and this obeys it.
 */
function PairTableRow({ row }: { row: PairRow }) {
  return (
    <div
      className={feed['row']}
      role="row"
      /* ★ The one property not taken from her stylesheet, and it removes an affordance
         rather than adding one. `.row` carries `cursor: pointer` because a board row opens a
         story; these rows open nothing, and a hand cursor over a row that does not respond
         is a promise the screen cannot keep. */
      style={{ cursor: 'default' }}
    >
      {/* ★ NO RANK NUMBER. The board's `#` is its committed ranking; this list is ordered by
          mint time and nothing about position here is a judgement, so the track carries the
          letter tile instead of a number that would read as one. */}
      <span className={feed['rank']} aria-hidden="true">
        {row.tile}
      </span>

      <div className={feed['narrCell']}>
        <div className={feed['narrMeta']}>
          {/* An empty ticker renders as nothing. It does NOT fall back to the address or to
              the name — either would look like a ticker to a person deciding what to buy. */}
          <div className={feed['narrTitle']}>{row.ticker}</div>
          {/* The address FIRST and the name second, deliberately: the line clips, and the
              address is the only thing telling three coins with the same name apart. */}
          <div className={feed['narrBlurb']}>
            {row.address} · {row.name}
          </div>
        </div>
      </div>

      <div className={`${feed['numCell']} ${feed['h']}`}>
        <span>{row.venueLabel}</span>
      </div>

      <div className={feed['numCell']}>
        <Num rendered={row.price} />
      </div>

      <div className={`${feed['numCell']} ${feed['h']}`}>
        <Num rendered={row.liquidity} />
      </div>

      {/* The mint age, with its "~" when the time is bounded. The words behind it — including
          the bound — are the title and the accessible name, because a tilde is a hint and
          somebody comparing two events needs the number. */}
      <div className={feed['numCell']} title={row.ageLabel} aria-label={row.ageLabel}>
        <Num rendered={row.age} dim />
      </div>

      <div className={feed['numCell']}>
        <Num rendered={row.cap} />
      </div>

      {/* ★ HOW OLD THE THREE FIGURES BESIDE IT ARE, ON EVERY ROW, ALWAYS. This screen
          publishes a reading rather than suppressing a stale one, and that is only honest
          while this cell is next to it. */}
      <div className={feed['numCell']} title={row.readLabel} aria-label={row.readLabel}>
        <Num rendered={row.read} dim />
      </div>
    </div>
  );
}

export function Pairs() {
  const [feedFrame, setFeedFrame] = useState<PairFeed | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  /* The clock is state, ticked here and passed down through the view, so every row in one
     paint agrees on what time it is and a test can state the time. */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  /* The poll. There is no live channel for this feed and the screen says how long ago the
     last read succeeded, so a screen that has stopped updating looks different from a market
     where nothing has happened.

     ★ THE OUTCOME IS RECORDED RATHER THAN SWALLOWED, and a failure does not blank rows we
     already hold: a stale list beside a notice saying it is stale is worth more than an
     empty one. An aborted request is us leaving, not a failure of the feed. */
  useEffect(() => {
    let live = true;
    const ac = new AbortController();

    const tick = (): void => {
      fetchPairs(PAIR_FEED_ID, ac.signal)
        .then((next) => {
          if (!live) return;
          setFeedFrame(next);
          setFailure(null);
          setLastOkAt(Date.now());
        })
        .catch((error: unknown) => {
          if (!live || ac.signal.aborted) return;
          setFailure(error);
        });
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      live = false;
      ac.abort();
      clearInterval(id);
    };
  }, []);

  const view = pairsView({ feed: feedFrame, failure, lastOkAt, now });

  return (
    <>
      <div className={feed['vhead']}>
        {/* ★ THE HEADING DOES NOT SAY "NEW". Nothing here knows when a pool opened, so
            nothing here may imply a pair is new. What it can say is what it actually shows. */}
        <div className={feed['vtitle']}>Launches with a market</div>
        <div className={feed['vsub']}>
          <span>Of the mints we captured, these are the ones a venue could price.</span>
          <span
            className={`${feed['simtag']} ${USING_FIXTURES ? feed['simtagFixtures'] : ''}`}
            title={SOURCE.title}
          >
            {SOURCE.label}
          </span>
        </div>
        {/* ★ WHAT THIS SCREEN CANNOT SHOW, SAID IN THE HEAD RATHER THAN LEFT TO BE ASSUMED.
            A table of coins with prices in it reads as a trading surface, and a user who
            assumes these rows are buyable — or that the list is ordered by how new the pool
            is — has been misled by the shape of the thing rather than by anything it says. */}
        {view.limits === null ? null : <div className={feed['vsub']}>{view.limits}</div>}
      </div>

      <div className={feed['tbar']}>
        {/* ★ THE RATIO IS THE MOST VALUABLE THING ON THIS SCREEN and it goes above the table,
            not under it. The table is the evidence for the sentence rather than the other way
            round. Absent — never a fabricated "0 of 0" — until a frame carries the counts. */}
        <div className={feed['tbarMeta']}>
          {view.ratio === null ? null : <span className={feed['tbarCount']}>{view.ratio}</span>}
        </div>

        <div className={feed['tbarMeta']}>
          {/* When a mint was last heard: a fact about the world's contact with us, rendered
              in every state including the healthy ones. A screen listing six-day-old coins
              under no mention of the silence behind them is the lie of omission this whole
              surface was built to avoid. The second line is on hover and in the label. */}
          {view.heard === null ? null : (
            <span className={feed['tbarCount']} title={view.heard.detail} role="status">
              {view.heard.headline}
            </span>
          )}
          {view.span === null ? null : <span className={feed['fresh']}>{view.span}</span>}
        </div>
      </div>

      {/* The rail's amber banner, reused rather than re-drawn: it is the app's one
          degraded-but-not-broken surface, and a read that failed or has stopped arriving is
          exactly that. It is NOT used for the withheld state, which is not degraded — it is a
          correct refusal, and it renders as the honest card below. */}
      {view.notice === null ? null : (
        <div className={rail['pausedBanner']} role="status">
          <b>{view.notice.headline}</b>
          {view.notice.detail}
        </div>
      )}

      <div className={feed['board']} role="table" aria-label="mints that reached a market">
        {/* Eight header cells, in the same order and the same tracks as the row. */}
        <div className={feed['header']} role="row">
          <span className={feed['rank']} aria-hidden="true" />
          <span>Coin</span>
          <span className={`${feed['headerRight']} ${feed['h']}`}>Venue</span>
          <span className={feed['headerRight']}>Price</span>
          <span className={`${feed['headerRight']} ${feed['h']}`}>Liquidity</span>
          <span className={feed['headerRight']}>Minted</span>
          <span className={feed['headerRight']}>Mkt cap</span>
          <span className={feed['headerRight']}>Read</span>
        </div>

        {view.empty === null ? (
          <>
            {view.rows.map((row) => (
              <PairTableRow key={row.key} row={row} />
            ))}
            {/* ★ THE LINE THAT RECONCILES THE TABLE WITH THE SENTENCE ABOVE IT. The ratio is
                a count with no limit on it and the rows are a listing with one, so the table
                can hold fewer rows than the headline claims — and a reader who counts them
                would find the screen contradicting itself with nothing to explain it. The
                rail's `overflowNote` is reused rather than re-drawn: it is the same fact
                about the same kind of list, and it belongs at the END of the rows, where a
                scroller that simply stops is what raises the question. */}
            {view.shortfall === null ? null : (
              <div className={rail['overflowNote']}>{view.shortfall}</div>
            )}
          </>
        ) : (
          <div className={feed['noresult']}>
            <b>{view.empty.headline}</b>
            {view.empty.detail}
            {/* The span the board's empty card uses for its one mono line. Here it carries
                what the list covers, so an empty screen still says how far it looked. */}
            {view.span === null ? null : <span className={feed['noresultNote']}>{view.span}</span>}
          </div>
        )}
      </div>
    </>
  );
}
