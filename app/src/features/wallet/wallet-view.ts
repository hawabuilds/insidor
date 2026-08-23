/**
 * WHAT THE NAV SAYS ABOUT THE WALLET, DECIDED AS A VALUE.
 *
 * WHAT IT IS RESPONSIBLE FOR: turning one `WalletState` into the words, the tone and the one
 * control the corner of the nav shows. `Connect.tsx` renders what this returns and decides
 * nothing — not a sentence, not a tone, not whether the button is inert.
 *
 * WHY THE SPLIT: this test runner has no DOM, so a `.tsx` cannot be imported by a test at
 * all, and anything decided inside the component is untestable by construction.
 * `features/sources/sources.ts` and `features/rail/launches.ts` sit in the same position for
 * the same reason. Here it matters more than usual, because the assertion that has to hold
 * is "no two of these states say the same thing", and that is a property of the whole table
 * rather than of any one branch.
 *
 * ★ WHAT BREAKS IF THIS IS CHANGED CARELESSLY.
 *
 *   1. ★ SEVEN STATES, ELEVEN SENTENCES, NO TWO ALIKE. The five failure codes are five
 *      different problems with five different next actions — authorise the site, unlock the
 *      wallet, switch network, or nothing you can do. A shared "couldn't connect" would be
 *      shorter and would send four people out of five to the wrong place.
 *      `wallet-view.test.ts` asserts every sentence is distinct, and that assertion exists
 *      because merging two of them always looks like tidying.
 *
 *   2. ★ CANCELLING IS NOT AN ERROR AND MUST NOT LOOK LIKE ONE. `refused` gets the quiet
 *      tone, the word "cancelled", and a sentence that says nothing went wrong — because
 *      nothing did. A person who dismissed a prompt on purpose and is then told their
 *      software is broken learns to distrust the next prompt, which is the one that will
 *      matter. The tone is asserted, not merely intended.
 *
 *   3. ★ NO WALLET INSTALLED IS ALSO NOT AN ERROR. It is the commonest state there is. It
 *      gets the quiet tone and a sentence that says so plainly and offers no download link,
 *      no "get started", no upsell. The product works without one; this corner is not the
 *      place to argue otherwise.
 *
 *   4. ★ AN ACCOUNT REFERENCE IS NEVER A LABEL, AND THE TYPE IS WHAT ENFORCES IT. `action`
 *      carries the button's words and `account` carries the reference, and no branch below
 *      puts one into the other. There is no `name` field here and there must never be one: a
 *      reference is a reference, and rendering it where a person's name goes turns a piece
 *      of routing information into an identity claim. Truncation is for the eye — the whole
 *      value is carried alongside so it can be copied, and shown only on hover.
 *
 *   5. ★ CONNECTING IS THE ONE STATE ALLOWED TO MAKE THE CONTROL INERT. `App.module.css`
 *      reserved `:disabled` for "a wallet that genuinely exists and is mid-connect" and this
 *      is that moment: the wallet's own prompt is open and a second press would open a
 *      second one. Every other state leaves the button live, including `unavailable` —
 *      pressing it there looks for a wallet again, which is the designed answer to an
 *      extension that injected itself late.
 */

import type { WalletFailure, WalletState, WalletStateKind } from '@insidor/contracts/ports/wallet.ts';

/**
 * How many code points of an account reference survive at each end.
 *
 * Code points and not UTF-16 units, for `features/sources/sources.ts`'s reason: a cut
 * landing between the halves of one character leaves a lone surrogate that renders as a
 * replacement glyph. Six and four because that is the shape people already read these in —
 * enough at the front to recognise, enough at the back to tell two apart.
 */
const HEAD_CHARS = 6;
const TAIL_CHARS = 4;

/** Below this there is nothing to hide and an ellipsis would be theatre. */
const TRUNCATE_ABOVE = HEAD_CHARS + TAIL_CHARS + 2;

/** The button. `busy` is the only thing entitled to make it inert — see note 5. */
export interface WalletAction {
  readonly label: string;
  readonly intent: 'connect' | 'disconnect';
  readonly busy: boolean;
}

/**
 * The quiet line beside the button.
 *
 * `tone` is two values and never three: `quiet` for a fact and `warn` for something a person
 * can act on. There is no `error` tone, because nothing here is an error to the person
 * reading it — the worst case is a wallet that would not answer, which is a warn.
 */
export interface WalletNote {
  readonly text: string;
  readonly detail: string;
  readonly tone: 'quiet' | 'warn';
}

/** A reference, in two lengths. Note 4: neither of them is a name. */
export interface WalletAccount {
  readonly short: string;
  readonly full: string;
}

export interface WalletView {
  /** The state this was built from. Rendered as a data attribute and used as a test handle. */
  readonly kind: WalletStateKind;
  readonly action: WalletAction;
  readonly note: WalletNote | null;
  readonly account: WalletAccount | null;
}

/**
 * A reference shortened for the eye.
 *
 * Exported because the buy panel shows an asset address the same way and a second spelling
 * of "truncate an opaque reference" is a second thing to get wrong. The input is already
 * bounded and free of control characters by the time it reaches here — the adapter's
 * `provider.ts` refuses anything else — so this file does no sanitising of its own and must
 * not start: two spellings of one guard drift, and the direction they drift is the one where
 * the outer is laxer than the inner.
 */
export function truncateRef(ref: string): string {
  const points = Array.from(ref);
  if (points.length <= TRUNCATE_ABOVE) return ref;
  const head = points.slice(0, HEAD_CHARS).join('');
  const tail = points.slice(points.length - TAIL_CHARS).join('');
  return `${head}…${tail}`;
}

const account = (ref: string): WalletAccount => ({ short: truncateRef(ref), full: ref });

const CONNECT: WalletAction = { label: 'Connect', intent: 'connect', busy: false };
const RETRY: WalletAction = { label: 'Try again', intent: 'connect', busy: false };
const DISCONNECT: WalletAction = { label: 'Disconnect', intent: 'disconnect', busy: false };
const WAITING: WalletAction = { label: 'Connecting…', intent: 'connect', busy: true };

/**
 * ★ ONE SENTENCE PER FAILURE CODE, AND EACH ONE NAMES THE NEXT ACTION.
 *
 * Note 1. The temptation is a single "we could not connect to your wallet", which is true of
 * all five and useful for none: three of them are fixed inside the wallet, one is fixed by
 * whoever configured this build, and one cannot be fixed by anybody reading it. A sentence
 * that does not distinguish those is a sentence that costs somebody an afternoon.
 */
const FAILURES: Readonly<Record<WalletFailure, WalletNote>> = {
  unauthorized: {
    text: 'not authorised',
    detail:
      'Your wallet has not authorised this site to talk to it. Allow this site in your ' +
      'wallet, then try again.',
    tone: 'warn',
  },
  disconnected: {
    text: 'wallet went away',
    detail:
      'Your wallet reported itself as disconnected. It is usually locked or closed — unlock ' +
      'it and try again.',
    tone: 'warn',
  },
  'unreadable-account': {
    text: 'no account returned',
    detail:
      'Your wallet answered without giving us an account we could read, so nothing is ' +
      'connected. Trying again is worth one attempt; after that it is your wallet to look at.',
    tone: 'warn',
  },
  'unreadable-network': {
    text: 'network not stated',
    detail:
      'This build requires a particular network and your wallet did not say which one it is ' +
      'on. We will not claim a connection we cannot check.',
    tone: 'warn',
  },
  internal: {
    text: 'did not complete',
    detail:
      'The connection did not complete and your wallet did not say why. Nothing was shared ' +
      'and nothing changed.',
    tone: 'warn',
  },
};

/** Everything the corner needs, for one state. Total: every branch is spelled out. */
export function walletView(state: WalletState): WalletView {
  switch (state.kind) {
    /* Note 3. No install link, no "get started", no apology. */
    case 'unavailable':
      return {
        kind: 'unavailable',
        action: CONNECT,
        note: {
          text: 'no wallet found',
          detail:
            'No wallet extension is answering in this browser, which is the ordinary case ' +
            'and not a fault. If you have just installed one, press Connect to look again.',
          tone: 'quiet',
        },
        account: null,
      };

    /* The resting state says nothing. A note here would be a note that is always on, and a
       note that is always on is a note nobody reads — the same argument the fixture bar and
       the source banner both turn on. */
    case 'disconnected':
      return { kind: 'disconnected', action: CONNECT, note: null, account: null };

    /* Note 5. */
    case 'connecting':
      return {
        kind: 'connecting',
        action: WAITING,
        note: {
          text: 'waiting for your wallet',
          detail: "Your wallet's own prompt is open. Approve or dismiss it there.",
          tone: 'quiet',
        },
        account: null,
      };

    case 'connected':
      return {
        kind: 'connected',
        action: DISCONNECT,
        note: null,
        account: account(state.account),
      };

    /* ★ Note 2. Quiet, past tense, and it says outright that nothing went wrong. */
    case 'refused':
      return {
        kind: 'refused',
        action: CONNECT,
        note: {
          text: 'you cancelled',
          detail:
            'You dismissed your wallet, so nothing was connected and nothing was shared. ' +
            'Nothing went wrong. Press Connect if you change your mind.',
          tone: 'quiet',
        },
        account: null,
      };

    /* Both references are named. "Wrong network" without saying which one is a dead end, and
       the two values are already bounded and inert by the time they arrive (see the note on
       `truncateRef`), so putting them in a sentence is safe. */
    case 'wrong-network':
      return {
        kind: 'wrong-network',
        action: DISCONNECT,
        note: {
          text: 'different network',
          detail:
            `Your wallet is on ${state.reported} and this build works with ` +
            `${state.required}. Switch networks in your wallet.`,
          tone: 'warn',
        },
        account: account(state.account),
      };

    case 'failed':
      return { kind: 'failed', action: RETRY, note: FAILURES[state.code], account: null };
  }
}
