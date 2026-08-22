/**
 * THE SOURCE INDICATOR, AS A VALUE. Everything the corner of the nav decides, decided here.
 *
 * `SourceStatus.tsx` renders what this file returns and makes no decision of its own — not
 * about which shape a state takes, not about what a pip says on hover, not about when the
 * shell is entitled to put a sentence under the nav. That split is not tidiness: this test
 * runner has no DOM, so a `.tsx` cannot be imported by a test at all, and anything decided
 * in the component is untestable by construction. `features/rail/launches.ts` says the same
 * thing from the same position.
 *
 * THE FIVE RULES THIS FILE HOLDS:
 *
 *   1. ★ NO STATE IS DISTINGUISHED BY COLOUR ALONE. Every state carries a SHAPE as well as
 *      a hue — filled disc, hollow ring, diamond — and the shape is decided here rather than
 *      in the stylesheet so a test can assert the three are distinct. Roughly one man in
 *      twelve cannot separate the red from the lime, and a screenshot in a document is
 *      greyscale for everybody. An indicator legible only in colour is an indicator that
 *      silently does not work for the reader most likely to be looking at it in a hurry.
 *
 *   2. ★ DORMANT IS NOT A FAULT AND MUST NOT BE DRESSED AS ONE. Nobody has failed when a
 *      source is off; somebody made a decision. It gets the quietest treatment on the row —
 *      a hollow ring, no glow, no motion — and it never produces the banner on its own. A
 *      product working exactly as configured must not look broken.
 *
 *   3. ★ FAILING IS A FAULT AND MUST CATCH THE EYE. Turned on and not answering is the state
 *      somebody is paying for and not getting, and it is the one the previous shape of this
 *      surface — a boolean — could not say at all.
 *
 *   4. ★ THE INDICATOR NEVER CLAIMS MORE THAN THE POLL SUPPORTS. A frame we have not been
 *      able to refresh is a frame that describes the past, so the pips stop moving and the
 *      corner says it is not updating. The rail makes the same conjunction for the same
 *      reason: a pip lit over a fact we cannot confirm is the cheapest lie in the app with
 *      one more layer of indirection.
 *
 *   5. ★ AND WHEN NOTHING IS LIVE, THE SHELL SAYS SO IN WORDS. Six pixels of dark dot is not
 *      enough to carry "everything you are looking at is missing its inputs". "Nothing is
 *      ingesting" and "nothing is happening" produce the same empty board, and the whole
 *      codebase is arranged around telling those apart.
 */

import { ReadError } from '../../shared/api/index.ts';
import type { SourceFeed, SourceHealth, SourceState } from '../../shared/api/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { instant } from '../../shared/format/measure.ts';
import type { Millis } from '../../shared/format/measure.ts';

/** The indicator the projector writes. `SOURCE_VIEW_ID` in services/project is this string. */
export const SOURCE_VIEW_ID = 'default';

/**
 * How often the shell asks again.
 *
 * Thirty seconds, and it is deliberately two orders slower than the rail's six. What this
 * reports changes when somebody adds a credential or a vendor starts erroring — on a
 * deploy's clock, not a market's — so a fast poll would be a request every few seconds for
 * an answer that changes twice a month. It is not slower still because the one moment this
 * surface is being watched is the moment somebody has just turned a source on and is waiting
 * to see it light up, and half a minute is about as long as anybody will wait before
 * reloading the page and doubting the feature.
 */
export const POLL_MS = 30_000;

/**
 * How stale the last successful read may be before the corner stops claiming to be current.
 *
 * Three polls, not a number typed independently: the question is "have we missed several in
 * a row", and expressing it as a multiple means changing the cadence cannot silently change
 * what counts as broken. This is a statement about OUR fetch loop and about nothing else,
 * which is the only kind of bar allowed to live in the client at all — the bar that decides
 * whether a SOURCE is failing lives on the server and is never sent here.
 */
const STALE_AFTER_MS = 3 * POLL_MS;

/**
 * How long a label may be before the corner truncates it.
 *
 * The server already bounds this, and this is the second door — the same argument the rail
 * makes about a token's name. It matters more here than it looks: this element sits in a
 * 58px nav on every route, to the left of the only button in it, so an unbounded label does
 * not merely look wrong, it pushes the Connect button off the right of the screen.
 */
const LABEL_MAX_CHARS = 12;

/**
 * ★ THE SHAPE VOCABULARY, AND IT IS A PRODUCT DECISION RATHER THAN A STYLE ONE.
 *
 * Three states, three shapes, and the mapping is not arbitrary:
 *
 *   live    → `disc`     a filled dot. The only solid one, and the only one that moves.
 *   dormant → `ring`     an outline. Visibly hollow at six pixels and in greyscale, and
 *                        hollow is the right metaphor: there is nothing in it because nobody
 *                        put anything in it. It reads as absence rather than as damage.
 *   failing → `diamond`  a square turned through 45 degrees. The only shape with corners,
 *                        which is what makes it findable in peripheral vision without
 *                        relying on the red, and what makes it survive a greyscale
 *                        screenshot pasted into a document.
 *
 * It lives here and not in the stylesheet because a stylesheet cannot be imported by a test.
 * `sources.test.ts` asserts the three are distinct, which is the assertion that stops a
 * well-meant refactor from giving two states the same dot in different colours.
 */
export type PipShape = 'disc' | 'ring' | 'diamond';

export const SHAPE_OF: Readonly<Record<SourceState, PipShape>> = {
  live: 'disc',
  dormant: 'ring',
  failing: 'diamond',
};

/** One source in the corner: a shape, a word, and the sentence behind both. */
export interface SourcePip {
  /** Stable across frames, so React keeps the DOM node. Never rendered. */
  readonly key: string;
  /** Already bounded. Rendered as text and never as anything else. */
  readonly label: string;
  readonly state: SourceState;
  readonly shape: PipShape;
  /**
   * The whole sentence, shown on hover and on keyboard focus and used as the accessible
   * name. It is NOT on screen: the corner is three shapes and three short words, and a
   * sentence per source would make it a dashboard. The rail's `.tapeT` and the pairs head
   * use the same device.
   */
  readonly detail: string;
}

/** The tiny line beside the pips when the poll itself is not current. */
export interface SourceNote {
  readonly text: string;
  readonly detail: string;
}

/** The amber banner under the nav. Two parts, both fixed strings chosen in this file. */
export interface SourceNotice {
  readonly headline: string;
  readonly detail: string;
}

export interface SourcesView {
  /** One per source, in the order the server committed. Empty when we hold no frame. */
  readonly pips: readonly SourcePip[];
  /**
   * ★ THE CONJUNCTION RULE, AS ONE BOOLEAN. False whenever our own read is stale or failed,
   * whatever the pips say. The component uses it to stop the motion: a pulsing dot means
   * "this is happening right now", and a fact we could not refresh is not happening right
   * now — it happened. The pips keep their states, because the rail's grammar is "say what
   * it is" and never "show less", and the note beside them says the states are old.
   */
  readonly confirmed: boolean;
  /** The dash-with-a-cause, or null when the read is current. Never a silent blank. */
  readonly note: SourceNote | null;
  /** The shell's banner, or null. Non-null only when a sentence is genuinely owed. */
  readonly notice: SourceNotice | null;
  /** The accessible name for the whole cluster, so it is one landmark rather than N. */
  readonly label: string;
}

export interface SourcesInput {
  /** The last frame we read, or null if we have never completed a read. */
  readonly feed: SourceFeed | null;
  /** The last poll's failure, or null if the last poll succeeded. */
  readonly failure: unknown;
  /** When the last successful read completed. Null until one does. */
  readonly lastOkAt: Millis | null;
  readonly now: Millis;
}

/**
 * A label, bounded and made inert.
 *
 * The server bounds this already and chooses it from a fixed map; this is the second door,
 * for `LiveRail`'s reason — a single door is not a door you rely on alone. Code points and
 * not UTF-16 units, so a cut can never land between the two halves of one character and
 * leave a lone surrogate that renders as a replacement glyph in the nav.
 *
 * A label that is nothing but whitespace comes back as the empty string, and the caller
 * drops that source rather than rendering a nameless shape. A coloured dot with no word
 * beside it is not something a reader can act on, and inventing a word for it would be
 * inventing a fact.
 */
function boundedLabel(raw: string): string {
  const collapsed = raw.replace(/\s+/gu, ' ').trim();
  if (collapsed === '') return '';
  const points = Array.from(collapsed);
  if (points.length <= LABEL_MAX_CHARS) return collapsed;
  return `${points.slice(0, LABEL_MAX_CHARS).join('').trimEnd()}…`;
}

/**
 * ★ WHAT EACH STATE IS ALLOWED TO SAY, and every sentence is chosen here.
 *
 * Six sentences, because three states times "have we ever heard from it" is six genuinely
 * different situations and no sentence written to cover two of them says either well:
 *
 *   live                      → when it last answered. The reassurance is the recency.
 *   dormant, never answered   → nobody turned it on. No fault, no alarm, no apology.
 *   dormant, answered before  → it was on and it is not now. That is a change somebody made
 *                               and the instant is the evidence of it, so it is not hidden.
 *   failing, never answered   → turned on and has never worked. The likeliest cause is a
 *                               credential that was wrong from the start, and "has never
 *                               answered" is the sentence that points at it.
 *   failing, answered before  → turned on, worked, stopped. The age is the whole diagnostic.
 *
 * ★ IT SAYS "TURNED ON" AND NEVER NAMES WHAT WOULD TURN IT ON. No variable, no host, no
 * endpoint, and above all not who we buy the data from — that name is ours and is refused at
 * the decoder in both directions. And a failure says "not answering", never what the vendor
 * actually returned: their message names them, and often names us.
 */
function detailFor(label: string, state: SourceState, health: SourceHealth, now: Millis): string {
  const age = formatAge(health.lastHeardAt, now);
  const never = age.kind === 'pending';
  if (state === 'live') {
    return never ? `${label} is answering.` : `${label} answered ${age.text} ago.`;
  }
  if (state === 'dormant') {
    return never
      ? `${label} is not turned on. Nothing has ever been read from it.`
      : `${label} is not turned on. It last answered ${age.text} ago.`;
  }
  return never
    ? `${label} is turned on and has never answered.`
    : `${label} is turned on and has not answered for ${age.text}.`;
}

/**
 * The frame, as pips.
 *
 * The order is the server's and nothing here sorts. That refusal is load-bearing on this
 * surface in a way it is not on the rail: these are three shapes somebody glances at dozens
 * of times a day, and an order that changed when a state changed would mean the pip they
 * looked at is not the pip that was there a moment ago. A fixed order is what lets a reader
 * learn the positions once and afterwards read the shapes instead of the words.
 */
export function sourcePips(sources: readonly SourceHealth[], now: Millis): readonly SourcePip[] {
  const pips: SourcePip[] = [];
  for (const health of sources) {
    const label = boundedLabel(health.label);
    /* A source we cannot name is not shown, and is not given a placeholder. The server drops
       these too; this is the second door, and both doors fail in the same direction. */
    if (label === '') continue;
    pips.push({
      key: health.sourceId,
      label,
      state: health.state,
      shape: SHAPE_OF[health.state],
      detail: detailFor(label, health.state, health, now),
    });
  }
  return pips;
}

/**
 * ★ WHEN THE SHELL OWES THE READER A SENTENCE, AND WHEN IT OWES THEM SILENCE.
 *
 * Two conditions produce a banner, and the second is the one the owner asked for by name:
 *
 *   NOTHING IS LIVE. Every surface below the nav is then showing whatever was already in the
 *   store, and an empty one is empty because of us. This is the case the whole feature
 *   exists for: "nothing is ingesting" and "nothing is happening" produce an identical
 *   screen, and only a sentence separates them.
 *
 *   SOMETHING IS FAILING while something else is live. The board is not lying about the
 *   world, it is missing a slice of it, and the size of that slice is not visible from the
 *   rows. Six pixels of red diamond says WHICH; only the banner says what it means.
 *
 * ★ AND DORMANT ALONE NEVER PRODUCES ONE, WHICH IS THE HARDEST LINE HERE TO HOLD. A source
 * nobody turned on is a decision, not a degradation, and a banner over somebody's own
 * decision is a banner they learn to look past — which costs us the day it says something
 * they needed. The pip says it. That is enough.
 *
 * ★ IT TAKES THE WHOLE LIST AND NOT A COUNT, because the sentences differ by WHICH mixture
 * is on screen, and because the failing branch names the source. Naming it is allowed and is
 * the point: the label is a display string the server chose, and "TikTok is not answering"
 * is a sentence somebody can act on in a way that "a source is not answering" is not.
 */
export function sourceNotice(pips: readonly SourcePip[]): SourceNotice | null {
  const live = pips.filter((p) => p.state === 'live');
  const failing = pips.filter((p) => p.state === 'failing');

  /* The first line is what is true; the second is what it means for what is on screen. That
     grammar is fixed across every banner in this app — `sourceNotice` in
     features/rail/launches.ts is the pattern this copy is written to match. */
  if (pips.length === 0) {
    return {
      headline: 'Nothing is ingesting posts.',
      detail:
        'No source is connected at all, so nothing new is being read into any of this. ' +
        'What is on screen came from somewhere else and is not a picture of what is ' +
        'happening now. An empty board here is a gap in what we are doing, not a quiet ' +
        'market.',
    };
  }
  if (live.length === 0) {
    return failing.length === 0
      ? {
          headline: 'Nothing is ingesting posts.',
          detail:
            'No source has been turned on, so nothing new is being read into this board. ' +
            'What is on it came from somewhere else. An empty board here is a gap in what ' +
            'we are doing, not a quiet market.',
        }
      : {
          headline: 'No source is answering.',
          detail:
            'Every source is either turned off or not responding, so nothing new is ' +
            'arriving. What is on screen is real and is not current, and an empty board is ' +
            'our silence rather than the world’s.',
        };
  }
  if (failing.length > 0) {
    const names = failing.map((p) => p.label).join(' and ');
    const one = failing.length === 1;
    return {
      headline: one ? `${names} is not answering.` : `${names} are not answering.`,
      /* ★ THE PRONOUN AGREES WITH THE HEADLINE, and it is not a nicety. The headline above
         it may already name two sources, and "posts from IT" then makes the reader stop and
         work out which of the two is meant — on the one line in the app whose whole job is
         to be understood at a glance while something is broken. A sentence somebody has to
         re-read is a sentence they stop reading. */
      detail:
        `Posts from ${one ? 'it' : 'them'} are missing from everything on screen, and the ` +
        'rest is still arriving normally. What you are seeing is narrower than what ' +
        'happened, not evidence that less happened.',
    };
  }
  return null;
}

/**
 * Everything the corner shows, from the four things the component knows.
 *
 * Read the branches in order; each is a different fact and none of them is a default:
 *
 *   never read, no failure  → we are asking. No pips, no banner, and a dash that says so.
 *                             NOT an empty cluster: an element that is absent before the
 *                             first response and present after it is an element nobody
 *                             notices arriving, and NOT a banner either, because we hold no
 *                             statement about the pipeline yet and inventing one before the
 *                             first response lands is the same class of thing as a skeleton
 *                             row.
 *   failed, no frame        → a dash with a cause. We cannot say anything about any source,
 *                             and saying nothing at all would look identical to a healthy
 *                             pipeline with no sources — which is precisely the confusion
 *                             this surface exists to end.
 *   failed, holding a frame → the pips we have, still, with the corner saying they are not
 *                             updating. Blanking them would throw away true information
 *                             because a later request failed.
 *   read, current           → the pips, moving.
 *
 * `stale` is folded in rather than being its own branch, exactly as in `railView`: a frame we
 * have not refreshed for three polls is not current whatever the last request returned, so
 * the motion stops and the note appears even on a run of quietly slow responses.
 *
 * ★ THE BANNER IS COMPUTED FROM THE FRAME WE HOLD, EVEN A STALE ONE. A failing source does
 * not stop being failing because our own poll is late, and suppressing the sentence on a
 * slow network would hide the fault at exactly the moment there is most reason to suspect
 * one. The note beside the pips is what tells the reader how fresh the claim is.
 */
export function sourcesView(input: SourcesInput): SourcesView {
  const { feed, lastOkAt, now } = input;
  /* `undefined` counts as no failure alongside `null`. The field is `unknown` because a
     caught value genuinely is — a thrown string, a DOMException, anything — and narrowing it
     at the boundary would be a promise nothing checks. */
  const failed = input.failure !== null && input.failure !== undefined;

  if (feed === null && !failed) {
    return {
      pips: [],
      confirmed: false,
      note: { text: '—', detail: 'Reading which sources are answering.' },
      notice: null,
      label: 'Reading which sources are answering.',
    };
  }

  /* Failed before we ever held a frame. A dash with a cause, and NO banner: we know nothing
     about any source, and "nothing is ingesting" is a claim we have no evidence for. The
     absence of the banner is itself the honest answer, and the dash is what stops it reading
     as a healthy pipeline with no sources in it. */
  if (feed === null) {
    const detail = noteDetailFor(input.failure);
    return {
      pips: [],
      confirmed: false,
      note: { text: '—', detail },
      notice: null,
      label: detail,
    };
  }

  const pips = sourcePips(feed.sources, now);
  const stale = lastOkAt === null || now - lastOkAt > STALE_AFTER_MS;
  const notice = sourceNotice(pips);

  if (failed || stale) {
    const since = lastOkAt === null ? null : formatAge(instant(lastOkAt), now);
    const age = since === null || since.kind === 'pending' ? null : since.text;
    return {
      pips,
      confirmed: false,
      note: {
        text: 'not updating',
        detail:
          age === null
            ? 'These are the last states we read. The check itself is not answering, so ' +
              'they may have changed since.'
            : `These are the states we read ${age} ago. The check itself is not answering, ` +
              'so they may have changed since.',
      },
      notice,
      label: indicatorLabel(pips),
    };
  }

  return { pips, confirmed: true, note: null, notice, label: indicatorLabel(pips) };
}

/**
 * What a failed read is allowed to say, as a closed set of sentences.
 *
 * The error's own message never reaches the corner. A `ReadError` carries a path and a
 * status and would be merely unhelpful; anything else could carry a hostname or a fragment
 * of a stack. The 404 is separated because it is not a fault: it means the indicator has
 * never been projected, which is a true and actionable thing to say and is different from
 * "we asked and got no answer".
 */
function noteDetailFor(failure: unknown): string {
  if (failure instanceof ReadError && failure.status === 404) {
    return 'Nothing has recorded which sources are answering yet, so this cannot say.';
  }
  return 'We could not read which sources are answering. This is our check failing, not a source.';
}

/** One accessible name for the whole cluster, so it is one landmark rather than N. */
function indicatorLabel(pips: readonly SourcePip[]): string {
  if (pips.length === 0) return 'Nothing is ingesting posts.';
  return `Sources: ${pips.map((p) => `${p.label} ${p.state}`).join(', ')}.`;
}
