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
 * THE FOUR RULES THIS FILE HOLDS:
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
 *
 *   4. ★ A DEAD FEED DOES NOT LOOK LIKE A QUIET ONE. Our poll loop's health and the mint
 *      feed's health are INDEPENDENT, and for six days they disagreed in the worst possible
 *      direction: the pill read "updated 2s ago" and the pip pulsed over coins last heard
 *      about 141 hours earlier, and both of those were true. So there are two notice slots
 *      and not one. Everything in rule 2 is a statement about OUR fetch loop; `sourceNotice`
 *      is a statement about the world's contact with us, and neither can stand in for the
 *      other.
 */

import { ReadError } from '../../shared/api/index.ts';
import type { FeedSource, Launch, LaunchFeed } from '../../shared/api/index.ts';
import { formatAge, mintAge } from '../../shared/format/duration.ts';
import { instant } from '../../shared/format/measure.ts';
import type { Millis } from '../../shared/format/measure.ts';
import { formatUsd } from '../../shared/format/number.ts';
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
 * ★ AND IT IS ONE RULE IN ONE PLACE, NOW THAT TWO SURFACES SHOW A MINT AGE. This function
 * used to spell those three branches out itself, from before the pairs screen existed, and
 * `shared/format/duration.ts` named the duplication as debt in its own comment rather than
 * leaving it to be discovered. It is worth having been explicit about: the failure mode of
 * two copies here is silent and asymmetric — the tilde quietly stops appearing on whichever
 * screen was edited second, and a bounded estimate is then rendered as a reading on a
 * product whose every ordering claim hangs on mint time. So this delegates, and `mintAge` is
 * the only place the rule exists.
 *
 * The wrapper stays because the RAIL's row type is what it is: it takes a `Launch` and reads
 * the two fields that belong together, so no call site anywhere can pass the instant without
 * its bound.
 */
export function launchAge(launch: Launch, now: Millis): { readonly age: Rendered; readonly label: string } {
  return mintAge(launch.mintedAt, launch.mintedAtBoundS, now);
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
  /**
   * ★ A SECOND, INDEPENDENT NOTICE SLOT, and its independence is the design point.
   *
   * `notice` above describes OUR FETCH LOOP — "stopped answering", "gone quiet", "could not
   * be read" — which is why STALE_AFTER_MS is allowed to live in this file at all. This one
   * describes THE WORLD'S CONTACT WITH US: how long it has been since anything reported a
   * mint. The two are unrelated and both can be true at once, which is exactly the state
   * that shipped — a perfectly healthy six-second poll, answering 200 every time, over a
   * transport that had been silent for 141 hours.
   *
   * Making this a sixth branch of `notice` would have made the two mutually exclusive, and
   * the one they would have hidden is the consequential one: a failing poll is our problem
   * and self-correcting, while a dead mint feed means every age on screen is wrong about
   * what "new" means.
   *
   * ★ IT IS NOT DERIVED FROM A THRESHOLD HERE. The server decides whether a feed is live,
   * against a bar in the policy; this file reads `feed.source.live` and phrases it. A bar
   * typed in the client would be a second answer to "is this feed dead", and the two would
   * disagree the first time either moved.
   */
  readonly sourceNotice: RailNotice | null;
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
 * ★ WHAT THE FEED ITSELF IS DOING, said out loud, or null when it is being heard from.
 *
 * The fact this puts on screen is the one the rail had no way to state: that the coins
 * listed under a heading saying NEW LAUNCHES were last heard about six days ago. It is
 * gated on `source.live` — the server's own judgement, made against a bar in the policy —
 * rather than on a duration compared here, so there is exactly one answer to "is this feed
 * dead" in the whole system and the client is not holding a copy of the bar.
 *
 * ★ TWO SENTENCES, BECAUSE THERE ARE TWO FACTS AND COLLAPSING THEM WOULD LOSE THE USEFUL
 * ONE. An absent instant means nothing has EVER been heard on this feed — nobody has
 * started a watcher — and the answer to that is to go and start one. A present but old
 * instant means we watched and the world went quiet, or the transport died, and the answer
 * is to go and look. "No mints for a while" would cover both and help with neither.
 * `formatAge` already distinguishes them, so this needs no formatter of its own.
 *
 * ★ AND IT NEVER HIDES THE ROWS. When there are rows, the detail says what they actually
 * are — real coins, really minted, just not recent. Removing them would trade one untruth
 * for another; the rail's grammar is "say what it is", never "show less".
 *
 * ★ IT TAKES `hasRows` BECAUSE THE TWO CASES NEED DIFFERENT SENTENCES, and the empty one is
 * the sentence this whole change exists to make sayable. An empty rail already says "the
 * feed answered and had nothing in it" — true, and on its own it reads as a quiet market.
 * The one thing a reader needs is that the emptiness is OURS and not the market's, and no
 * sentence written to cover both cases says that. `noticeFor` above splits on the same
 * argument for the same reason.
 */
export function sourceNotice(
  source: FeedSource,
  hasRows: boolean,
  now: Millis,
): RailNotice | null {
  if (source.live) return null;

  const age = formatAge(source.lastHeardAt, now);
  if (age.kind === 'pending') {
    return {
      headline: 'No coin mint has ever been heard on this feed.',
      detail: hasRows
        ? 'Nothing has watched for new coins yet, so what is listed is whatever the store ' +
          'already held. It is not a record of what is being minted now.'
        : 'Nothing has watched for new coins yet, so there is nothing for this rail to ' +
          'list. That is a gap in what we are doing, not a quiet market.',
    };
  }
  return {
    headline: `No coin mint has been heard for ${age.text}.`,
    detail: hasRows
      ? 'This rail lists coins as they are minted, and nothing has reported one since ' +
        'then. What is listed is real and is not new — read every age against that.'
      : 'This rail lists coins as they are minted, and nothing has reported one since ' +
        'then. It is empty because nothing is being heard, not because nothing is ' +
        'being minted.',
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
      /* Null and not a "we do not know" banner. We have not read the feed yet, so we hold
         no statement about it — and inventing one before the first response lands is the
         same class of thing as a skeleton row. */
      sourceNotice: null,
      empty: {
        title: 'Reading the launches feed.',
        text: 'Nothing is shown until it answers. No placeholder rows, no invented coins.',
      },
    };
  }

  const rows = feed === null ? [] : launchRows(feed.launches, now);
  const stale = lastOkAt === null || now - lastOkAt > STALE_AFTER_MS;

  /* ★ COMPUTED ONCE, BEFORE THE LADDER, so every branch below carries it. It is a fact
     about the feed and not about which branch we happen to be in: a failed poll on top of a
     frame from a dead transport is both things at once, and the banner that matters most is
     the one about the transport. */
  const feedSource = feed === null ? null : sourceNotice(feed.source, rows.length > 0, now);
  /* ★ THE PIP FOLLOWS THE SERVER. `live` used to mean only "the last read succeeded", and
     rail.module.css already says why that is dangerous on its own — "a pulsing cyan dot
     over a feed nobody is streaming is the cheapest lie in the app". A lit pip over a feed
     the server has just told us is not live is that same lie with one more layer of
     indirection, so both conditions have to hold. */
  const sourceLive = feed !== null && feed.source.live;

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
      sourceNotice: feedSource,
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
      sourceNotice: feedSource,
      empty: null,
    };
  }

  if (rows.length === 0) {
    return {
      rows,
      status,
      live: sourceLive,
      /* A real zero, under a pill that says when we last asked. This is the one place a
         zero is honest on this rail: we asked, we got an answer, and the answer was that
         nothing has been minted in the window. */
      count: '0',
      overflow: null,
      notice: null,
      /* ★ THE BRANCH THIS FIELD WAS BUILT FOR. "The feed answered and had nothing in it" is
         a true sentence over a quiet market and a misleading one over a transport that
         died six days ago, and until now the rail said it identically in both cases. The
         banner is what makes the empty card mean the right thing. */
      sourceNotice: feedSource,
      empty: {
        title: 'No coins minted in the window.',
        /* ★ "THE FEED" IS AVOIDED HERE ON PURPOSE, because there are now two of them on
           this screen and the word had started doing both jobs: the endpoint we poll, which
           answered, and the mint source, which has not been heard from. The source banner
           owns the second sentence, so this one says only what WE did. */
        text: 'We asked, and the window held no coins. New mints appear here as they land.',
      },
    };
  }

  return {
    rows,
    status,
    live: sourceLive,
    count: frameCount === null ? '—' : String(frameCount),
    overflow,
    notice: null,
    sourceNotice: feedSource,
    empty: null,
  };
}
