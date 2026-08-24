/**
 * THE STORY PAGE — evidence, coins, discussion, in Hawa's token-page chrome.
 *
 * This is the page that has to be honest, because it is where a user decides whether to
 * believe the board. Three things follow from that and none of them is styling:
 *
 *   - The header shows facts and one already-made judgement (`momentum`, a three-valued
 *     enum). There is no number here the client could threshold.
 *   - Absences render as absences. A story whose start time we do not know says so; it does
 *     not borrow the moment we first saw it and call that the beginning.
 *   - The buy affordance appears here through the same function the feed row uses, so the
 *     two surfaces cannot disagree about when a coin may be bought.
 *
 * ★ AND THE ONE THAT DECIDES THE LAYOUT. Price, market cap, liquidity and the day's move are
 * absent far more often than not — a coin minted this hour has no market to have any of them
 * in, a story with several settled coins has no single figure to show, and a reading the
 * server considers too old to be current is withheld rather than presented as live. So most
 * of the quick-stats strip is a dash most of the time. That is styled as "not known yet"
 * (her dashed grammar plus the reason word) rather than left to read as a broken panel, and
 * it is never, anywhere, filled in with a zero. The same rule decides the chart card: no
 * price SERIES reaches this client, so the card says so instead of drawing one.
 *
 * Fetch-on-mount rather than a router loader: there is one route parameter and no
 * server-side rendering, so a loader would be indirection with nothing to hide.
 */

import { useEffect, useState } from 'react';

import type { Coin, CoinLink, Story as StoryData } from '../../shared/api/index.ts';
import { fetchStory } from '../../shared/api/index.ts';
import type { BuyAction } from '../feed/index.ts';
import type { Delta as DeltaValue, Measured } from '../../shared/format/measure.ts';
import { pending } from '../../shared/format/measure.ts';
import { formatAge, formatDuration } from '../../shared/format/duration.ts';
import { formatCount, formatPrice, formatUsd } from '../../shared/format/number.ts';
import { pendingRendered } from '../../shared/format/rendered.ts';
import type { Rendered } from '../../shared/format/rendered.ts';
import { Delta, Num, Sparkline, Thumb } from '../../shared/ui/index.ts';
import { Coins } from './Coins.tsx';
import { Discussion } from './Discussion.tsx';
import { EvidenceList } from './Evidence.tsx';
import { storyNotice } from './story-provenance.ts';
import styles from './story.module.css';

const CLOCK_MS = 1_000;

/** A sparkline needs two known readings before it is a line rather than a dot. */
const MIN_READINGS = 2;

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly story: StoryData }
  | { readonly kind: 'failed'; readonly message: string };

type Tab = 'evidence' | 'discussion';

export interface StoryProps {
  readonly storyId: string;
  readonly onBuy: (action: BuyAction) => void;
  readonly isWatched: boolean;
  readonly onToggleWatch: (storyId: string) => void;
}

/**
 * A market figure for the story, taken from its coin.
 *
 * The pending reasons mirror the ones services/project/src/project.ts already picks for the
 * board's market cap, so the two surfaces give the same account of the same absence:
 *   none   → `not_minted`   — nothing has been minted, so there is no price to have.
 *   unsure → `not_reported` — coins exist but we will not name one, so no figure is OURS to
 *                             report. Deliberately not `no_market` (which would claim a
 *                             specific coin exists and is untraded) and not `not_minted`
 *                             (which would flatly deny the coins that do exist).
 *   several→ `not_reported` — same: several settled coins, no single figure to attribute.
 */
function coinFigure(coins: CoinLink, read: (coin: Coin) => Measured): Measured {
  switch (coins.kind) {
    case 'one':
      return read(coins.coin);
    case 'none':
      return pending('not_minted');
    case 'unsure':
    case 'several':
      return pending('not_reported');
  }
}

/**
 * One cell of her quick-stats strip.
 *
 * `showWord` is on for every cell that is absent: a dash alone reads as breakage, and
 * "— no market yet" reads as an answer. `pend` also grounds the cell in a faint hatch, which
 * is the same idea as her `.tkico.pend` dashed tile — "nothing real is here yet" said with
 * texture rather than with a colour, because colour in this app means direction.
 */
function Stat({ label, rendered }: { label: string; rendered: Rendered }) {
  const pend = rendered.kind === 'pending';
  return (
    <div className={`${styles['qs']} ${pend ? styles['qsPend'] : ''}`}>
      <div className={styles['qsK']}>{label}</div>
      <div className={styles['qsV']}>
        <Num rendered={rendered} showWord={pend} />
      </div>
    </div>
  );
}

/**
 * The line under the stats strip, or nothing.
 *
 * It exists so that a row of dashes reads as an answer rather than as a broken panel — but it
 * has to be TRUE of the story in front of the user, not a fixed caption. A story whose coin
 * has real figures gets no line at all, and the wording follows the actual reason:
 * "no market feed" is right for one coin nobody is quoting, and wrong for a story we have
 * deliberately declined to attribute a single price to.
 */
function marketNote(coins: CoinLink, figures: readonly Measured[]): string | null {
  const allAbsent = figures.every((m) => !m.known);
  if (!allAbsent) return null;
  switch (coins.kind) {
    /* The cells already read "— no coin yet". Glossing that would be noise. */
    case 'none':
      return null;
    case 'unsure':
      return 'no price here: we are not naming a coin for this story, so there is no figure that would be ours to report';
    case 'several':
      return 'no single price: more than one coin is minted from this story, and each one’s own figures are in the panel beside this';
    case 'one':
      return 'nothing is quoting this coin yet, so price, market cap and liquidity are blank rather than zero';
  }
}

/**
 * The 24h cell.
 *
 * A known change keeps `<Delta>`, which colours by sign and by nothing else. An absent one
 * goes through the same pending treatment as every other cell instead, because `<Delta>`
 * renders a bare dash — and a bare dash standing in a row of dashes is the reading we are
 * trying to avoid. This way the cell says which absence it is.
 */
function DeltaStat({ label, value: change }: { label: string; value: DeltaValue }) {
  if (!change.known) return <Stat label={label} rendered={pendingRendered(change.pending)} />;
  return (
    <div className={styles['qs']}>
      <div className={styles['qsK']}>{label}</div>
      <div className={styles['qsV']}>
        <Delta value={change} />
      </div>
    </div>
  );
}

/** The chip in the identity header that says what this story has, coin-wise. */
function CoinChip({ coins }: { coins: CoinLink }) {
  switch (coins.kind) {
    case 'one':
      return <span className={`${styles['chip']} ${styles['chipCoin']}`}>${coins.coin.ticker}</span>;
    case 'several':
      return (
        <span className={`${styles['chip']} ${styles['chipCoin']}`}>
          {coins.coins.length} coins
        </span>
      );
    /* ★ Both of the remaining branches are "no coin you can act on", and both render as a
       label. There is no button in this component in any branch — see Coins.tsx for where the
       one buy affordance on this page lives, and why it cannot exist for an unsure match. */
    case 'unsure':
      return <span className={`${styles['chip']} ${styles['chipNone']}`}>no coin settled</span>;
    case 'none':
      return <span className={`${styles['chip']} ${styles['chipNone']}`}>no coin yet</span>;
  }
}

export function Story({ storyId, onBuy, isWatched, onToggleWatch }: StoryProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>('evidence');

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setLoad({ kind: 'loading' });
    fetchStory(storyId, ac.signal)
      .then((story) => setLoad({ kind: 'ready', story }))
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setLoad({ kind: 'failed', message: e instanceof Error ? e.message : 'could not load' });
      });
    return () => ac.abort();
  }, [storyId]);

  if (load.kind === 'loading') return <div className={styles['loading']}>loading story…</div>;
  if (load.kind === 'failed') {
    return <div className={`${styles['loading']} ${styles['failed']}`}>{load.message}</div>;
  }

  const { story } = load;
  const readings = story.spark.points.filter((p) => p.value !== null).length;

  const price = coinFigure(story.coins, (c) => c.priceUsd);
  const cap = coinFigure(story.coins, (c) => c.marketCapUsd);
  const liquidity = coinFigure(story.coins, (c) => c.liquidityUsd);
  const note = marketNote(story.coins, [price, cap, liquidity]);

  const provenance = storyNotice(story.provenance);

  return (
    <div className={styles['tp2']}>
      <div className={styles['tp2Main']}>
        {/* ★ ABOVE THE HEADER, because it changes what every number under it means. The
            board carries the same notice over its list; this is the half that was missing,
            and without it a reader who clicked a seeded row landed on a page of invented
            view counts, invented accounts and invented posts with nothing over them.

            Same amber, same permanence, no dismiss control — see BoardProvenance.tsx. It
            comes off the page's own payload, so a story opened from a shared link with no
            board in sight is exactly as honest as one clicked through from the list. */}
        {provenance === null ? null : (
          <div className={styles['provenanceBar']} role="status">
            <b>{provenance.headline}</b>
            {provenance.detail}
          </div>
        )}

        {/* ===== identity header (her .tid) ===== */}
        <section className={`${styles['panel']} ${styles['tid']}`}>
          <div className={styles['tidIco']}>
            <Thumb url={story.thumbUrl} alt={story.title} />
          </div>

          <div className={styles['tidMeta']}>
            <div className={styles['tidTop']}>
              <h1 className={styles['tidTitle']}>
                {story.title}
                {/* Her star, index.css:682-685. A bare glyph, not a button-shaped control,
                    and inside the heading so it trails the last word rather than being
                    pushed onto a line of its own by a long title. */}
                <button
                  type="button"
                  className={`${styles['star']} ${isWatched ? styles['starOn'] : ''}`}
                  aria-pressed={isWatched}
                  aria-label={isWatched ? 'stop watching this story' : 'watch this story'}
                  title={isWatched ? 'watching — you will be told if it gets a coin' : 'watch'}
                  onClick={() => onToggleWatch(story.id)}
                >
                  {isWatched ? '★' : '☆'}
                </button>
              </h1>
            </div>

            <p className={styles['tidName']}>
              {story.summary[0]} {story.summary[1]}
            </p>

            <div className={styles['tidSub']}>
              <CoinChip coins={story.coins} />
              <span className={styles['chip']}>{story.evidence.length} sources</span>
            </div>
          </div>

          {/* Her price block, pushed right — carrying views, which is this story's own number
              and one we actually have. */}
          <div className={styles['tidFig']}>
            <div className={styles['tidFigK']}>views</div>
            <div className={styles['tidFigV']}>
              <Num rendered={formatCount(story.reach)} />
            </div>
            <div className={styles['tidFigChg']}>
              {/* Coloured by sign only. The magnitude never picks the colour. */}
              <Delta value={story.reachDelta24h} />
              <small>24h</small>
            </div>
          </div>
        </section>

        {/* ===== quick stats (her .qstats — one row, never two) ===== */}
        <section className={`${styles['panel']} ${styles['qstats']}`}>
          <Stat label="views" rendered={formatCount(story.reach)} />
          {/* ★ "views 24h", not "24h", AND THE LABEL MATTERS MORE NOW THAN IT USED TO.
              This is the only cell in the strip that carries a SIGNED, COLOURED figure, and
              the three cells to its right are price, market cap and liquidity — so a bare
              "24h" beside them reads as a price move. There now IS a 24-hour price move on
              this page, per coin, in the panel below (Coins.tsx), which is what turns a
              sloppy label from a vague risk into two quantities that look identical and
              differ completely: reach growth is how many more people saw a story; the
              coin's 24h is what its price did. The number here is honest — `reachDelta24h`
              straight off the wire, derived from nothing — but only the label says which
              quantity it is, and the label has to survive being read next to a dollar sign
              and next to a real percentage two panels down. `unit` is left at its default
              `count` for the same reason: this is a count of views, not a percentage, and
              `<Delta>` prints the suffix the unit names. */}
          <DeltaStat label="views 24h" value={story.reachDelta24h} />
          <Stat label="age" rendered={formatAge(story.firstSeenAt, now)} />
          {/* No "sources" cell: the count is a chip in the header two lines up and the tab
              below is labelled with it. A strip that has to scroll should not spend a cell
              saying something twice. */}
          <Stat label="price" rendered={formatPrice(price)} />
          <Stat label="mkt cap" rendered={formatUsd(cap)} />
          <Stat label="liquidity" rendered={formatUsd(liquidity)} />
        </section>

        {/* Says which absence this is, once, rather than leaving three dashes to be read as a
            failure — and only when they ARE absent. Note what it does not say: nothing here
            is "coming soon". */}
        {note === null ? null : <div className={styles['qsNote']}>{note}</div>}

        {/* ===== chart card (her .chartcard) =====
            ★ NO PRICE SERIES REACHES THIS CLIENT, so this card does not draw one. Market
            readings are now taken and kept — which is what the 24h figure beside each coin
            comes from — but each one is a reading at an instant, and nothing projects them
            onto the wire as a series. Two readings four minutes apart are not a chart, and
            drawing a line through them would invent every point in between. So the card
            carries the activity trace instead — real readings, straight off the wire — and
            says on its face that it is not price. A drawn-from-nothing candle chart is the
            single most convincing lie an interface like this can tell. */}
        <section className={`${styles['panel']} ${styles['chartcard']}`}>
          <div className={styles['chartTop']}>
            <div className={styles['chartTitle']}>
              <b>Activity</b>
              <span>mentions over {formatDuration(story.spark.windowMs)}</span>
            </div>
            <span className={styles['chartTag']}>not price</span>
          </div>

          <div className={styles['chartWell']}>
            {readings >= MIN_READINGS ? (
              <div className={styles['chartSpark']}>
                {/* A censored reading BREAKS the line — the component emits one polyline per
                    run of known points and never drops a gap to the floor (rule 2). */}
                <Sparkline
                  points={story.spark.points}
                  windowMs={story.spark.windowMs}
                  tone={story.momentum}
                  label={`activity for ${story.title}`}
                />
              </div>
            ) : (
              <div className={styles['chartEmpty']}>
                not enough readings yet to draw a line
                <br />a gap here means we looked and learned nothing
              </div>
            )}
          </div>

          <div className={styles['chartNote']}>
            no price chart: this line is mentions, not price. the 24h figure beside each coin
            is a reading, not a series — a real one goes here when there is one, not before
          </div>
        </section>

        {/* ===== tabs + unified data panel (her .tp-tabs / .tp-tabbody) ===== */}
        <div>
          <div className={styles['tpTabs']} role="tablist" aria-label="story detail">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'evidence'}
              className={`${styles['tpt']} ${tab === 'evidence' ? styles['tptOn'] : ''}`}
              onClick={() => setTab('evidence')}
            >
              Evidence · {story.evidence.length}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'discussion'}
              className={`${styles['tpt']} ${tab === 'discussion' ? styles['tptOn'] : ''}`}
              onClick={() => setTab('discussion')}
            >
              Discussion · {story.discussion.length}
            </button>
          </div>

          <div className={styles['tpTabbody']}>
            {tab === 'evidence' ? (
              <EvidenceList items={story.evidence} now={now} />
            ) : (
              <Discussion posts={story.discussion} now={now} />
            )}
          </div>
        </div>
      </div>

      {/* The one place on this page with a buy affordance, and only when there is a coin to
          name. Her sticky side column. */}
      <div className={styles['tp2Side']}>
        <Coins storyId={story.id} coins={story.coins} now={now} onBuy={onBuy} />
      </div>
    </div>
  );
}
