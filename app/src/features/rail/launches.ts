/**
 * THE LAUNCHES RAIL, AS A VALUE. Everything the Launches tab decides, decided here.
 *
 * `LiveRail.tsx` renders what this file returns and makes no decision of its own — not
 * about what "updated" means, not about when an age may be shown as a reading, not about
 * what a failure says. That split is not tidiness: this runner has no DOM, so a `.tsx`
 * cannot be imported by a test at all (`board-order.test.ts` says the same thing from the
 * other side). Anything left in the component is untestable by construction, so the rules
 * live out here where `launches.test.ts` can call them with literals.
 *
 * THE THREE RULES THIS FILE HOLDS:
 *
 *   1. ★ A BOUNDED MINT TIME IS NEVER SHOWN AS A READING. A live mint feed reports when we
 *      HEARD about a coin; the mint happened at or shortly before that. So most ages here
 *      are the centre of an interval, and they render with a "~" and state the bound in
 *      words. "3m ago" and "~3m ago" are different claims and only one of them is ours to
 *      make. Mint time is the axis every ordering claim in this product hangs on.
 *
 *   2. ★ A FAILED POLL IS SAID OUT LOUD. A rail that renders nothing on a 500 is
 *      indistinguishable from a rail over a market where nothing is being minted, and the
 *      second is a legitimate answer. So a failure produces a notice, and a failure that
 *      arrives on top of rows we already hold keeps the rows and says they are not
 *      updating rather than blanking them.
 *
 *   3. ★ NOTHING IS INVENTED WHILE WAITING. No skeleton rows, no placeholder tickers, no
 *      count of zero standing in for a count we do not have.
 */

import { ReadError } from '../../shared/api/index.ts';
import type { Launch, LaunchFeed } from '../../shared/api/index.ts';
import { formatAge, formatDuration } from '../../shared/format/duration.ts';
import { instant } from '../../shared/format/measure.ts';
import type { Millis } from '../../shared/format/measure.ts';
import { formatUsd } from '../../shared/format/number.ts';
import { pendingLabel, value } from '../../shared/format/rendered.ts';
import type { Rendered } from '../../shared/format/rendered.ts';

/** The feed the projector writes. `LAUNCH_FEED_ID` in services/project/src/main.ts. */
export const LAUNCH_FEED_ID = 'default';

/**
 * How often the rail asks again.
 *
 * There is no live channel for launches — `openLiveChannel` covers the board and is
 * unimplemented besides — so this is a poll and the rail says so on screen. Six seconds is
 * fast enough that a coin minted while someone is watching appears while they are still
 * watching, and slow enough that a browser tab left open overnight is not a load problem.
 */
export const POLL_MS = 6_000;

/**
 * How long the last successful read may be, before the rail stops claiming to be live.
 *
 * Three polls, not a number typed independently: the question being answered is "have we
 * missed several in a row", and expressing it as a multiple means changing the cadence
 * cannot silently change what counts as broken. This is a statement about OUR fetch loop
 * and not about any coin, which is why it is allowed to live in the client at all.
 */
const STALE_AFTER_MS = 3 * POLL_MS;

/**
 * How many rows the rail keeps. A scroller, not an archive; the frame holds more.
 *
 * ★ AND WHEN THE FRAME DOES HOLD MORE, THE RAIL SAYS SO — see `overflow` on RailView. A
 * scroller that simply stops is a scroller whose last row reads as the last mint, and this
 * cap is reached on any live morning (a six hour window is routinely forty rows and the
 * projector's own cap is sixty). The dropped rows are the OLDEST, which is the safe
 * direction for a rail about earliness, but "you are seeing part of it" is still a fact
 * about what is on screen and it belongs on screen rather than in this comment.
 */
const MAX_ROWS = 30;

const MS_PER_SECOND = 1_000;

/** Enough of an address to recognise, never enough to mistake for the whole thing. */
const ADDRESS_HEAD = 4;
const ADDRESS_TAIL = 4;

/* ── one row ──────────────────────────────────────────────────────────── */

export interface LaunchRow {
  /** Stable across frames, so React keeps the DOM node when the list shifts. */
  readonly key: string;
  /** One character for the tile. `?` when the coin named no ticker. */
  readonly tile: string;
  /** May be the empty string. It renders as nothing — never as the address. */
  readonly ticker: string;
  readonly name: string;
  readonly venueLabel: string;
  /** Already truncated for display. The rail never holds the full string. */
  readonly address: string;
  /** A dash when there is no market. Never `$0`. */
  readonly cap: Rendered;
  /** "~3m" for a bounded mint time, "3m" for an exact one, a dash for none. */
  readonly age: Rendered;
  /** The words behind the age, for the title and the accessible name. */
  readonly ageLabel: string;
}

/**
 * ★ THE AGE, AND WHETHER WE ARE ENTITLED TO STATE IT PRECISELY.
 *
 * Three outcomes, and the middle one is the common one on a socket-fed pipeline:
 *
 *   - No mint time at all → the pending glyph, with its reason. NOT "0s", which would read
 *     as brand new and would promote the coins we know least about to the top of a list
 *     whose entire subject is earliness.
 *   - A bounded mint time → the age with a "~" in front of it and the bound spelled out in
 *     the label. The tilde is doing real work: without it, an interval whose half-width is
 *     twenty seconds is displayed identically to a chain-confirmed reading, and somebody
 *     downstream compares it against a post timestamp to the second.
 *   - An exact mint time → the age plain. Only a chain confirmation earns this, and 0005's
 *     `exact_requires_real_source` is what stops anything else claiming it.
 *
 * `formatAge` already refuses a future origin (it returns `unreadable` rather than a
 * negative age), so a clock-skewed row arrives here as a dash and not as "-4s".
 */
export function launchAge(launch: Launch, now: Millis): { readonly age: Rendered; readonly label: string } {
  const age = formatAge(launch.mintedAt, now);
  if (age.kind === 'pending') return { age, label: pendingLabel(age.reason) };
  if (launch.mintedAtBoundS === null) return { age, label: `minted ${age.text} ago` };

  /* ★ THE BOUND IS ROUNDED UP, NEVER DOWN, and one second is its floor. `formatDuration`
     floors — it is built for ages, where flooring is right — so a half-second bound would be
     phrased "give or take 0s", which is the caveat deleted while the tilde stays on. That
     reads as an exact time wearing an apology. The projector already floors this at one
     second (`Math.max(1, Math.ceil(...))` in projectMintTime) so this cannot fire against
     our own server; it fires against a server that does not, and stating a bound smaller
     than it is claims a precision nobody has. */
  const bound = formatDuration(Math.max(MS_PER_SECOND, launch.mintedAtBoundS * MS_PER_SECOND));
  return {
    age: value(`~${age.text}`),
    /* The bound is stated in words rather than only implied by the tilde, because a tilde
       is a hint and a user acting on the order of two events needs the number. */
    label: `minted about ${age.text} ago, give or take ${bound}`,
  };
}

/**
 * The first character of the ticker, for the tile.
 *
 * `Array.from` and not `[0]`: a ticker beginning with an emoji or any other astral
 * character would otherwise be cut through the middle of a surrogate pair and render as a
 * replacement glyph. The projection has already stripped control and bidi characters, so
 * whatever survives to here is a printable character or nothing.
 */
function tileOf(ticker: string): string {
  const first = Array.from(ticker)[0];
  return first === undefined ? '?' : first.toUpperCase();
}

/**
 * The address, shortened.
 *
 * ★ SHOWN, NEVER LINKED, AND NEVER BUILT INTO A URL. It is the only thing distinguishing
 * three coins that all call themselves "Jersey", which is why it is on the row at all — but
 * an address is also the one string on this row that somebody might paste into a wallet, so
 * it is presented as identification and not as an affordance.
 */
function shortAddress(address: string): string {
  if (address.length <= ADDRESS_HEAD + ADDRESS_TAIL + 1) return address;
  return `${address.slice(0, ADDRESS_HEAD)}…${address.slice(-ADDRESS_TAIL)}`;
}

/**
 * The frame, as rows.
 *
 * The order is the server's and nothing here sorts: `launches` arrived newest-mint-first,
 * committed by the projector against mint times this package cannot read. The cap is a
 * presentation bound applied AFTER the order, so it keeps the newest rather than whatever
 * happened to be cheapest to fetch.
 */
export function launchRows(launches: readonly Launch[], now: Millis): readonly LaunchRow[] {
  return launches.slice(0, MAX_ROWS).map((launch) => {
    const { age, label } = launchAge(launch, now);
    return {
      key: launch.launchId,
      tile: tileOf(launch.ticker),
      ticker: launch.ticker,
      name: launch.name,
      venueLabel: launch.venueLabel,
      address: shortAddress(launch.address),
      /* A coin with no pool has no cap, and `formatUsd` returns the pending glyph with its
         reason. There is no branch anywhere in that formatter that produces a zero. */
      cap: formatUsd(launch.marketCapUsd),
      age,
      ageLabel: label,
    };
  });
}

/* ── the whole tab ────────────────────────────────────────────────────── */

/** The amber banner. Two lines, both fixed strings chosen here. */
export interface RailNotice {
  readonly headline: string;
  readonly detail: string;
}

/** The honest card shown when there is nothing to list. Never a skeleton row. */
export interface RailEmpty {
  readonly title: string;
  readonly text: string;
}

export interface RailView {
  readonly rows: readonly LaunchRow[];
  /** The header pill. Says what actually happened, never "live" on a poll. */
  readonly status: string;
  /** Whether the pip pulses and the pill goes lime. False whenever we are not current. */
  readonly live: boolean;
  /**
   * The header count, or an em dash when we do not have one. Never a stand-in zero.
   *
   * ★ IT COUNTS THE FRAME AND NOT THE RENDERED ROWS, and the difference is the whole
   * reason this comment is long. The empty branch below reads this number out loud as a
   * statement about the world — "no coins minted in the window" — so it is a claim about
   * what the feed reported, not about how many nodes the scroller happens to hold. Reading
   * it off the capped list made it silently become the second thing the moment a frame
   * carried more than MAX_ROWS, which is most of the time on a live feed: forty-one mints
   * came back and the header said thirty.
   */
  readonly count: string;
  /**
   * One line at the end of the list when the frame carries more than the rail renders, or
   * null when it does not. The bottom of a scroller that simply stops reads as the end of
   * the mint stream, and that is a thing the rail would be saying without knowing it.
   */
  readonly overflow: string | null;
  readonly notice: RailNotice | null;
  readonly empty: RailEmpty | null;
}

export interface RailInput {
  /** The last frame we read, or null if we have never completed a read. */
  readonly feed: LaunchFeed | null;
  /** The last poll's failure, or null if the last poll succeeded. */
  readonly failure: unknown;
  /** When the last successful read completed. Null until one does. */
  readonly lastOkAt: Millis | null;
  readonly now: Millis;
}

/**
 * ★ WHAT A FAILURE IS ALLOWED TO SAY — a closed set of sentences, chosen here.
 *
 * The error object's own message never reaches the screen. A `ReadError` carries the path
 * and the status and would be merely unhelpful; anything else could carry a hostname, a
 * stack, or a fragment of a payload somebody minted. So the status is mapped onto one of
 * three fixed pairs and nothing else is read out of it.
 *
 * The 404 is worth separating from the rest, because it is not a fault: it means no
 * launches feed has ever been projected, which is a true and actionable thing to say and is
 * different from "we asked and could not get an answer".
 */
function noticeFor(failure: unknown, hasRows: boolean): RailNotice {
  if (hasRows) {
    return {
      headline: 'The launches feed stopped answering.',
      detail:
        'These coins are the last frame that came back. Nothing newer has arrived, so treat ' +
        'the ages as older than they read.',
    };
  }
  if (failure instanceof ReadError && failure.status === 404) {
    return {
      headline: 'No launches feed has been projected yet.',
      detail:
        'The endpoint answered, and it has no frame to give. Coins appear here once something ' +
        'has watched for mints and the projection has run.',
    };
  }
  return {
    headline: 'The launches feed could not be read.',
    detail:
      'The request failed, so this list is empty because we could not ask — not because ' +
      'nothing is being minted. It will be retried.',
  };
}

/**
 * Everything the Launches tab shows, from the four things the component knows.
 *
 * Read the branches in order; each one is a different fact and none of them is a default:
 *
 *   never read, no failure  → we are asking. No rows, no count, and a card that says so.
 *   failed, no frame        → a notice. Empty and broken must not look the same.
 *   failed, holding a frame → the rows we have, plus a notice that they are not updating.
 *                             Blanking them would throw away true information because a
 *                             later request failed.
 *   read, no launches       → a count of 0, which is a real count under a status pill that
 *                             says when we last asked, and the honest empty card.
 *   read, launches          → the rows.
 *
 * `stale` is folded in rather than being its own branch: a frame we have not been able to
 * refresh for three polls is not live, whatever the last request returned, so the pip goes
 * out and the notice appears even on a run of quietly slow responses.
 */
export function railView(input: RailInput): RailView {
  const { feed, lastOkAt, now } = input;
  /* `undefined` counts as no failure alongside `null`. The field is typed `unknown` because
     a caught value is genuinely unknown — a thrown string, a DOMException, anything — and
     narrowing it to `Error | null` at the boundary would be a promise nothing checks. */
  const failed = input.failure !== null && input.failure !== undefined;

  if (feed === null && !failed) {
    return {
      rows: [],
      status: 'asking',
      live: false,
      count: '—',
      overflow: null,
      notice: null,
      empty: {
        title: 'Reading the launches feed.',
        text: 'Nothing is shown until it answers. No placeholder rows, no invented coins.',
      },
    };
  }

  const rows = feed === null ? [] : launchRows(feed.launches, now);
  const stale = lastOkAt === null || now - lastOkAt > STALE_AFTER_MS;

  /* How many mints the frame actually carried, which is a different number from how many
     the rail renders. Every count below is this one; `rows.length` is a fact about the DOM
     and is never shown to anybody. */
  const frameCount = feed === null ? null : feed.launches.length;
  const overflow =
    frameCount === null || frameCount <= rows.length
      ? null
      : `Showing the newest ${rows.length} of ${frameCount} on this frame. Older mints in the window are not listed.`;

  if (failed) {
    return {
      rows,
      status: 'not updating',
      live: false,
      count: frameCount === null || frameCount === 0 ? '—' : String(frameCount),
      overflow,
      notice: noticeFor(input.failure, rows.length > 0),
      empty: null,
    };
  }

  /* The last successful read, phrased as an age. "updated" and never "live": this is a
     poll, and a pill reading "feed live" over a six second interval would be the cheapest
     lie in the app — the same argument rail.module.css makes about the pip. */
  const since = lastOkAt === null ? null : formatAge(instant(lastOkAt), now);
  const status = since === null || since.kind === 'pending' ? 'updated' : `updated ${since.text} ago`;

  if (stale) {
    return {
      rows,
      status,
      live: false,
      count: frameCount === null ? '—' : String(frameCount),
      overflow,
      notice: {
        headline: 'The launches feed has gone quiet.',
        detail:
          'Nothing has come back for several attempts. What is listed is the last frame we ' +
          'read, and it is not being refreshed.',
      },
      empty: null,
    };
  }

  if (rows.length === 0) {
    return {
      rows,
      status,
      live: true,
      /* A real zero, under a pill that says when we last asked. This is the one place a
         zero is honest on this rail: we asked, we got an answer, and the answer was that
         nothing has been minted in the window. */
      count: '0',
      overflow: null,
      notice: null,
      empty: {
        title: 'No coins minted in the window.',
        text: 'The feed answered and had nothing in it. New mints appear here as they land.',
      },
    };
  }

  return {
    rows,
    status,
    live: true,
    count: frameCount === null ? '—' : String(frameCount),
    overflow,
    notice: null,
    empty: null,
  };
}
