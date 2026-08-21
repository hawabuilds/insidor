/**
 * THE PAIRS SCREEN, AS A VALUE. Everything this screen decides, decided here.
 *
 * `Pairs.tsx` renders what `pairsView` returns and makes no decision of its own — not about
 * what the sentence above the table says, not about when a figure may be shown as current,
 * not about what an empty screen means. That split is not tidiness: this runner has no DOM,
 * so a `.tsx` cannot be imported by a test at all, and anything left in the component is
 * untestable by construction. `features/rail/launches.ts` states the same rule for the
 * surface next to this one and is where the argument is written out in full.
 *
 * ★ WHAT THIS SCREEN IS, IN ONE PARAGRAPH, BECAUSE THE NAME IN THE NAV IS NOT IT.
 * A launch is a MINT: a coin came into existence. A pair is a MARKET: some venue holds a
 * pool a price can be read off. Almost nothing crosses between them — of the mints this
 * product captured, seven in a hundred and ninety-two ever got a pool. The ratio is the most
 * valuable thing this screen can say and the table underneath is the evidence for it.
 *
 * ★ AND THE WORD "NEW" IS NOT USED, ANYWHERE, DELIBERATELY. Nothing in this system knows
 * when a pool opened: market readings could carry that history and do not yet, so pair age
 * is not derivable and a screen ordered by it would be sorting on a column it invented. The
 * ordering is MINT time, the heading says so, and the line naming what this screen cannot
 * show is rendered every time rather than kept in this comment.
 *
 * THE FOUR RULES THIS FILE HOLDS:
 *
 *   1. ★ NOTHING IS LISTED THAT CANNOT BE SHOWN TO BE REAL. The server publishes a
 *      `withheld` listing when the store holds no record of where each coin row came from,
 *      and this file renders that as a card explaining it rather than as an empty table or
 *      an error. A demo row under a heading that says a venue priced it is the exact failure
 *      this screen was built in response to.
 *
 *   2. ★ A FIGURE IS SHOWN WITH THE AGE OF THE READING IT CAME FROM. The board suppresses a
 *      stale reading whole, because every board row has a Buy button on it. This screen has
 *      no buy affordance at all, so suppressing here would delete the evidence rather than
 *      protect anybody — and the product rule already says what to do instead: a stale
 *      reading says it is stale.
 *
 *   3. ★ A BOUNDED MINT TIME IS NEVER SHOWN AS A READING. `mintAge` in shared/format holds
 *      that rule for both surfaces that show one.
 *
 *   4. ★ NOTHING IS INVENTED WHILE WAITING. No skeleton rows, no placeholder tickers, no
 *      count of zero standing in for a count we do not have.
 */

import { ReadError } from '../../shared/api/index.ts';
import type { Pair, PairFeed } from '../../shared/api/index.ts';
import { formatAge, formatDuration, mintAge } from '../../shared/format/duration.ts';
import { instant } from '../../shared/format/measure.ts';
import type { Millis } from '../../shared/format/measure.ts';
import { formatPrice, formatUsd } from '../../shared/format/number.ts';
import { pendingLabel } from '../../shared/format/rendered.ts';
import type { Rendered } from '../../shared/format/rendered.ts';

/** The feed the projector writes. `PAIR_FEED_ID` in services/project/src/pairs-main.ts. */
export const PAIR_FEED_ID = 'default';

/**
 * How often this screen asks again.
 *
 * ★ FIVE TIMES SLOWER THAN THE LAUNCHES RAIL, AND FOR A REASON ABOUT THE WORLD RATHER THAN
 * ABOUT LOAD. The rail's six seconds exist so that a coin minted while somebody is watching
 * appears while they are still watching. A row appears HERE when a coin acquires a pool and
 * something reads it, which is the market pass's cadence and not the mint feed's. Polling
 * faster than the thing that changes the data produces a screen that looks busy and never
 * changes, which teaches a user that the number is live when it is not.
 */
export const POLL_MS = 30_000;

/**
 * How long the last successful read may be, before this screen stops claiming to be current.
 *
 * Three polls, expressed as a multiple rather than typed independently: the question is
 * "have we missed several in a row", so changing the cadence cannot silently change what
 * counts as broken. This is a statement about OUR fetch loop and about no coin, which is why
 * it is allowed to live in the client at all — the fact about the world's contact with us is
 * `lastMintHeardAt`, and that is measured by the server and arrives on the frame.
 */
const STALE_AFTER_MS = 3 * POLL_MS;

/** Enough of an address to recognise, never enough to mistake for the whole thing. */
const ADDRESS_HEAD = 4;
const ADDRESS_TAIL = 4;

/* ── one row ──────────────────────────────────────────────────────────── */

export interface PairRow {
  /** Stable across frames, so React keeps the DOM node when the list shifts. */
  readonly key: string;
  /** One character for the tile. `?` when the coin named no ticker. */
  readonly tile: string;
  /** May be the empty string. It renders as nothing — never as the address. */
  readonly ticker: string;
  readonly name: string;
  readonly venueLabel: string;
  /** Already truncated for display. This screen never holds the full string. */
  readonly address: string;
  /** "~5d" for a bounded mint time, "5d" for an exact one, a dash for none. */
  readonly age: Rendered;
  /** The words behind the age, for the title and the accessible name. */
  readonly ageLabel: string;
  /** A price, at whatever precision it needs. Never "$0.00". */
  readonly price: Rendered;
  /** A dash with a reason on a curve. Absence is not illiquidity and is never $0. */
  readonly liquidity: Rendered;
  /** A dash with a reason when the venue reported no supply figure. Never $0. */
  readonly cap: Rendered;
  /** How old the reading beside it is. Rendered on every row, always. */
  readonly read: Rendered;
  readonly readLabel: string;
}

/**
 * The first character of the ticker, for the tile.
 *
 * `Array.from` and not `[0]`: a ticker beginning with an emoji or any other astral character
 * would otherwise be cut through the middle of a surrogate pair and render as a replacement
 * glyph. The projection has already stripped control and bidi characters, so whatever
 * survives to here is a printable character or nothing.
 *
 * (The launches rail has its own copy of this and of `shortAddress` below. They are display
 * helpers rather than rules about what may be claimed, so the cost of two copies is a
 * cosmetic difference rather than a false statement — unlike `mintAge`, which is why that
 * one was moved into shared/format instead.)
 */
function tileOf(ticker: string): string {
  const first = Array.from(ticker)[0];
  return first === undefined ? '?' : first.toUpperCase();
}

/**
 * The address, shortened.
 *
 * ★ SHOWN, NEVER LINKED, AND NEVER BUILT INTO A URL. It is the only thing distinguishing
 * three coins that all call themselves the same word, which is why it is on the row at all —
 * but it is also the one string here somebody might paste into a wallet, so it is presented
 * as identification and not as an affordance.
 */
function shortAddress(address: string): string {
  if (address.length <= ADDRESS_HEAD + ADDRESS_TAIL + 1) return address;
  return `${address.slice(0, ADDRESS_HEAD)}…${address.slice(-ADDRESS_TAIL)}`;
}

/**
 * The frame, as rows.
 *
 * The order is the server's and nothing here sorts, slices or filters. `pairs` arrived in
 * mint order, newest first, committed by the projector against mint times this package
 * cannot read — and there is no cap applied either, unlike the rail's: the projector's limit
 * is the only bound, and a screen that silently dropped rows off the end of a list whose
 * whole subject is "how few of these there are" would be undercounting the thing it is
 * counting.
 */
export function pairRows(pairs: readonly Pair[], now: Millis): readonly PairRow[] {
  return pairs.map((pair) => {
    const minted = mintAge(pair.mintedAt, pair.mintedAtBoundS, now);
    const read = formatAge(pair.readAt, now);
    return {
      key: pair.pairId,
      tile: tileOf(pair.ticker),
      ticker: pair.ticker,
      name: pair.name,
      venueLabel: pair.venueLabel,
      address: shortAddress(pair.address),
      age: minted.age,
      ageLabel: minted.label,
      /* Every one of these three returns the pending glyph with the venue's own reason when
         there is no number. There is no branch in any of them that produces a zero. */
      price: formatPrice(pair.priceUsd),
      liquidity: formatUsd(pair.liquidityUsd),
      cap: formatUsd(pair.marketCapUsd),
      read,
      readLabel:
        read.kind === 'pending'
          ? pendingLabel(read.reason)
          : `read ${read.text} ago — these figures are that old`,
    };
  });
}

/* ── the whole screen ─────────────────────────────────────────────────── */

/** Two lines of plain English. Both are fixed strings chosen in this file. */
export interface PairNote {
  readonly headline: string;
  readonly detail: string;
}

export interface PairsView {
  readonly rows: readonly PairRow[];
  /**
   * The sentence this screen exists to say — "4 of 192 mints we captured reached a market" —
   * or null when we do not hold a frame to say it from. Never assembled from a count we did
   * not receive, and never printed on the withheld branch, where the population it would
   * describe may contain fictions.
   */
  readonly ratio: string | null;
  /** What the list covers, in words. Null until a frame arrives. */
  readonly span: string | null;
  /**
   * When a mint was last heard, as two lines. This is a fact about the world's contact with
   * us and it is rendered whether or not anything else is wrong — a screen listing six-day
   * old coins under a healthy status pill is the lie of omission this was built to end.
   */
  readonly heard: PairNote | null;
  /** The amber banner: a read that failed, or one that has stopped arriving. */
  readonly notice: PairNote | null;
  /** The honest card shown when there is nothing to list. Never a skeleton row. */
  readonly empty: PairNote | null;
  /**
   * One line at the end of the list when the table holds FEWER rows than the sentence above
   * it counts, or null when the two agree.
   *
   * ★ THE SENTENCE AND THE TABLE ARE TWO STATEMENTS AND THEY CAN DISAGREE BY DESIGN. The
   * ratio comes from a count with no limit on it; the rows come from a listing with one
   * (`PAIR_LIMIT` in the pairs projector), and the projector additionally drops any single
   * row whose payload would have leaked. So "48 of 235 reached a market" can sit above 47
   * rows, or above 100, and a reader who counts them finds a number that contradicts the
   * headline with nothing on screen to reconcile it.
   *
   * The launches rail already solved exactly this — `overflow` on RailView, and the argument
   * there is that "the bottom of a scroller that simply stops reads as the end of the mint
   * stream". This screen is worse, not better, because the count is not merely a header here:
   * it is the sentence the whole screen exists to say, so a table that quietly fails to be
   * the evidence for it undermines the one claim being made.
   *
   * ★ IT NAMES THE GAP AND NOT ITS CAUSE. A capped list and a withheld row are both "not on
   * this frame", and the client cannot tell which happened — the frame carries no field for
   * it and must not, because "we censored a row" is our machinery. So the sentence states the
   * two numbers, which are both facts, and stops.
   */
  readonly shortfall: string | null;
  /**
   * One line naming what this screen cannot show, rendered whenever it holds a frame.
   *
   * ★ IT IS ON SCREEN AND NOT IN THIS COMMENT, which is the whole point of it existing. A
   * table of coins with prices on it reads as a trading surface, and a user who assumes
   * these rows are buyable, or that the list is ordered by how new the pool is, has been
   * misled by the shape of the thing rather than by anything it says.
   */
  readonly limits: string | null;
}

export interface PairsInput {
  /** The last frame we read, or null if we have never completed a read. */
  readonly feed: PairFeed | null;
  /** The last poll's failure, or null if the last poll succeeded. */
  readonly failure: unknown;
  /** When the last successful read completed. Null until one does. */
  readonly lastOkAt: Millis | null;
  readonly now: Millis;
}

const LIMITS =
  'Not shown, because nothing here knows them: when the pool opened, how new the pair is, ' +
  'whether the coin can be bought, and the day’s price move.';

/**
 * ★ WHAT A FAILURE IS ALLOWED TO SAY — a closed set of sentences, chosen here.
 *
 * The error object's own message never reaches the screen. A `ReadError` carries the path
 * and the status and would be merely unhelpful; anything else could carry a hostname, a
 * stack, or a fragment of a payload somebody minted. So the status is mapped onto one of
 * three fixed pairs and nothing else is read out of it.
 *
 * The 404 is separated from the rest because it is not a fault: it means no pairs feed has
 * ever been projected, which is true, actionable, and a different thing from "we asked and
 * could not get an answer".
 */
function noticeFor(failure: unknown, hasRows: boolean): PairNote {
  if (hasRows) {
    return {
      headline: 'The pairs feed stopped answering.',
      detail:
        'These are the last rows that came back. Nothing newer has arrived, so both the mint ' +
        'ages and the reading ages are older than they read.',
    };
  }
  if (failure instanceof ReadError && failure.status === 404) {
    return {
      headline: 'No pairs feed has been projected yet.',
      detail:
        'The endpoint answered, and it has no frame to give. Coins appear here once the ' +
        'market has been read and the projection has run.',
    };
  }
  return {
    headline: 'The pairs feed could not be read.',
    detail:
      'The request failed, so this list is empty because we could not ask — not because ' +
      'nothing has reached a market. It will be retried.',
  };
}

/**
 * When a mint was last heard, said out loud.
 *
 * Two different facts and two different sentences. An absent instant means nothing has ever
 * been heard on this feed, which is a statement about our own watching; a present one that
 * is old means we watched and the world went quiet. Rendering both as "no mints for a while"
 * would collapse the one distinction that tells an operator whether to start a process or to
 * go and look at a market.
 *
 * There is no threshold here and there is no verdict. The duration is a fact and the reader
 * can weigh it; a boolean "the feed is dead" would be our machinery on a user's screen, and
 * the number it was compared against would be too.
 */
function heardNote(feed: PairFeed, now: Millis): PairNote {
  const age = formatAge(feed.head.lastMintHeardAt, now);
  if (age.kind === 'pending') {
    return {
      headline: 'No mint has ever been heard on this feed.',
      detail:
        'Nothing has watched for new coins yet, so this list is drawn from whatever the ' +
        'store already held rather than from anything arriving.',
    };
  }
  return {
    headline: `Mints last heard ${age.text} ago.`,
    detail:
      'Nothing has reported a mint since then, so nothing on this list is newer than that. ' +
      'The order here is mint time — when a pool opened is not something we know.',
  };
}

/**
 * The sentence above the table.
 *
 * ★ THE ZERO-DENOMINATOR CASE IS ITS OWN SENTENCE AND NOT A "0 of 0". A ratio over an empty
 * population reads as a measurement of a market, and what actually happened is that we
 * captured nothing to measure. Those are different facts and the second one is about us.
 */
function ratioText(mintsInWindow: number, withMarket: number, withoutMarket: number): string {
  if (mintsInWindow === 0) return 'No mints were captured in this window, so there is nothing to price.';
  return `${withMarket} of ${mintsInWindow} mints we captured reached a market. ${withoutMarket} have none.`;
}

/**
 * The line that reconciles the table with the sentence above it, or null when they agree.
 *
 * ★ THE TWO NUMBERS COME FROM TWO STATEMENTS AND ARE ALLOWED TO DIFFER. `withMarket` is a
 * count with no limit on it; the rows are a listing with one, and the projector additionally
 * drops any single row whose payload would have leaked. So a reader who counts the rows can
 * find a number the headline contradicts, and until this line existed there was nothing on
 * screen to reconcile them. The launches rail already had this — `overflow` on RailView, and
 * the argument there is that a scroller which simply stops reads as the end of the stream.
 *
 * ★ IT NAMES THE GAP AND NEVER ITS CAUSE. A capped list and a withheld row are both "not on
 * this frame" and the client cannot tell which happened — the frame carries no field for it
 * and must not, because "we censored a row" is our machinery and not a fact about a coin. So
 * it states the two numbers, which are both facts, and stops.
 *
 * `missing > 0` and not `!==`: more rows than the count would mean the frame and the counts
 * disagree in the other direction, which is not a shortfall and is not this line's to
 * explain.
 */
function shortfallText(withMarket: number, listed: number): string | null {
  const missing = withMarket - listed;
  if (missing <= 0) return null;
  return `Listing ${listed} of the ${withMarket} that reached a market. The other ${missing} are not on this frame.`;
}

/**
 * The card shown when the table is empty, chosen against the COUNT rather than against the
 * table.
 *
 * ★ THE TWO CASES ARE DIFFERENT FACTS AND ONE OF THEM USED TO BE PRINTED AS THE OTHER. The
 * branch is reached whenever there are no rows, and it said "Nothing we captured reached a
 * market" — which is true when `withMarket` is zero and is a flat contradiction of the
 * sentence printed directly above it when it is not. A frame that counted forty-eight and
 * carried none of them is a fact about US: every row was withheld at the projection, or the
 * rows did not survive the write. Saying the market produced nothing in that state is the
 * same shape of untruth this whole screen exists to refuse, arriving through an empty card.
 */
function emptyCard(withMarket: number, ratio: string, heard: PairNote): PairNote {
  if (withMarket > 0) {
    return {
      headline: 'None of them are listed here.',
      detail:
        `${ratio} None of them reached this frame, so what is missing is ours and not the ` +
        'market’s.',
    };
  }
  /* ★ THE EMPTY CARD CARRIES THE SILENCE, and this is the sentence the whole screen was
     asked for: an empty list is only informative next to when we last looked. Without it,
     "nothing reached a market" reads as a fact about the market when it may be a fact about
     a process that stopped running six days ago. */
  return {
    headline: 'Nothing we captured reached a market.',
    detail: `${ratio} ${heard.headline}`,
  };
}

/**
 * Everything this screen shows, from the four things the component knows.
 *
 * Read the branches in order; each one is a different fact and none of them is a default:
 *
 *   never read, no failure  → we are asking. No rows, no counts, and a card that says so.
 *   failed, no frame        → a notice. Empty and broken must not look the same.
 *   failed, holding a frame → the rows we have, plus a notice that they are not updating.
 *   stale (three polls)     → the rows we have, plus a notice that they are not refreshing.
 *   rows withheld           → no rows, and a card naming what has to exist before there can
 *                             be any. NOT an error and NOT an empty market.
 *   read, nothing priced    → the real counts, and a card saying so beside the silence — or,
 *                             when the counts are NOT zero and the frame carried none of them
 *                             anyway, a card saying the gap is ours rather than the market's.
 *   read, rows              → the rows, plus one line reconciling them with the count above
 *                             them whenever the table is shorter than its own headline.
 *
 * `heard`, `span`, `limits` and `shortfall` are computed BEFORE the ladder and attached to
 * every branch that holds a frame, because they are true of the frame regardless of what else
 * went wrong.
 * A staleness fact that disappeared the moment a poll failed would be missing at exactly the
 * moment it was most worth reading.
 */
export function pairsView(input: PairsInput): PairsView {
  const { feed, lastOkAt, now } = input;
  /* `undefined` counts as no failure alongside `null`. The field is typed `unknown` because
     a caught value is genuinely unknown — a thrown string, a DOMException, anything — and
     narrowing it at the boundary would be a promise nothing checks. */
  const failed = input.failure !== null && input.failure !== undefined;

  if (feed === null && !failed) {
    return {
      rows: [],
      ratio: null,
      span: null,
      heard: null,
      notice: null,
      empty: {
        headline: 'Reading the pairs feed.',
        detail: 'Nothing is shown until it answers. No placeholder rows, no invented coins.',
      },
      shortfall: null,
      limits: null,
    };
  }

  if (feed === null) {
    return {
      rows: [],
      ratio: null,
      span: null,
      heard: null,
      notice: noticeFor(input.failure, false),
      empty: null,
      shortfall: null,
      limits: null,
    };
  }

  const heard = heardNote(feed, now);
  const span = `Mints from the last ${formatDuration(feed.head.windowMs)}, newest mint first.`;
  const listing = feed.head.rows;
  const rows = pairRows(feed.pairs, now);
  const stale = lastOkAt === null || now - lastOkAt > STALE_AFTER_MS;

  /* ★ THE WITHHELD BRANCH COMES BEFORE THE FAILURE BRANCHES, and the order is the argument.
     A frame that says its rows may not be listed carries none, so "failed while holding
     rows" cannot be true of it — and a transport notice printed over this card would suggest
     the emptiness is a connection problem that will clear itself. It will not. It clears when
     the store learns where its rows came from. */
  if (listing.listing === 'withheld') {
    return {
      rows: [],
      /* No ratio. The counts behind one would be over a population that may hold coins
         nobody ever minted, and a confident "4 of 192" is exactly the shape of the invented
         data this screen refuses to print. */
      ratio: null,
      span,
      heard,
      notice: null,
      empty: {
        headline: 'These rows are not being listed.',
        detail:
          'Nothing in the store records which coins were seen on a live feed and which were ' +
          'written by a demo tool. Listing them would put invented coins under a heading ' +
          'that says a venue priced them, so none are listed until the two can be told apart.',
      },
      /* Nothing to reconcile: this branch carries no rows AND no counts, deliberately, so
         there are not two numbers that could disagree. */
      shortfall: null,
      limits: LIMITS,
    };
  }

  const ratio = ratioText(listing.mintsInWindow, listing.withMarket, listing.withoutMarket);
  /* ★ COMPUTED ONCE, BEFORE THE LADDER, so every branch that carries the ratio carries the
     reconciliation with it. A line that appeared only on the healthy branch would be missing
     from the two states where the table is most likely to be short of its own headline. */
  const shortfall = shortfallText(listing.withMarket, rows.length);

  if (failed) {
    return {
      rows,
      ratio,
      span,
      heard,
      notice: noticeFor(input.failure, rows.length > 0),
      empty: null,
      shortfall,
      limits: LIMITS,
    };
  }

  if (stale) {
    return {
      rows,
      ratio,
      span,
      heard,
      notice: {
        headline: 'This screen has stopped refreshing.',
        detail:
          'Nothing has come back for several attempts. What is listed is the last frame we ' +
          'read, and the reading ages beside each row are older than they say.',
      },
      empty: null,
      shortfall,
      limits: LIMITS,
    };
  }

  if (rows.length === 0) {
    return {
      rows,
      ratio,
      span,
      heard,
      notice: null,
      empty: emptyCard(listing.withMarket, ratio, heard),
      /* The card below is already the whole sentence on this branch, so a second line
         underneath an empty table would say the same thing twice. */
      shortfall: null,
      limits: LIMITS,
    };
  }

  return { rows, ratio, span, heard, notice: null, empty: null, shortfall, limits: LIMITS };
}
