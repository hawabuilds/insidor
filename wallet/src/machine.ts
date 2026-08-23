/**
 * THE CONNECTION STATE MACHINE, AS A PURE FUNCTION.
 *
 * WHAT IT IS RESPONSIBLE FOR: every decision about which of the seven wallet states we are
 * in. Given a state and an event it returns the next state, and it does nothing else — no
 * clock, no network, no provider, no browser.
 *
 * WHY IT IS SEPARATE FROM THE ADAPTER: because the rules below are the part that is easy to
 * get subtly wrong and impossible to notice, and a rule needs a test rather than a comment.
 * The adapter next door has to be driven with promises and listeners to be exercised at all;
 * this file is exercised by calling it. `features/sources/sources.ts` and
 * `features/rail/launches.ts` make the same split for the same reason.
 *
 * ★ WHAT BREAKS IF THIS IS CHANGED CARELESSLY — the five rules, each of which exists because
 *   the obvious shortcut is wrong.
 *
 *   1. ★ A REFUSAL IS NOT STICKY AND IS NOT A FAILURE. `refused` accepts `requested` and
 *      goes straight back to `connecting`. Somebody who declined once and then changed their
 *      mind must be able to press the button again and have it work, with no reload and no
 *      second control. And `refused` is not routed through `failed`, so nothing downstream
 *      can accidentally give it error styling: the type makes that impossible, and this file
 *      makes sure the type is what gets used.
 *
 *   2. ★ A CHANGE NOTIFICATION MAY NOT CONNECT US. `changed` is honoured only from
 *      `connected` and `wrong-network`. A wallet that announces an account while we are
 *      `disconnected` has not been asked to connect, and treating the announcement as
 *      permission would mean a page could learn an account nobody chose to share with it.
 *      Connection happens because a person pressed a button, and by no other route.
 *
 *   3. ★ AN ACCOUNT THAT GOES AWAY TAKES THE CONNECTION WITH IT. `changed` with a null
 *      account is `disconnected`, never `connected` holding the previous reference. A stale
 *      address on screen is the exact shape of the lie this whole codebase is arranged
 *      against: it is a fact about the world that stopped being true, still being asserted.
 *
 *   4. ★ THE THREE NETWORK OUTCOMES ARE THREE, NOT TWO. `settle` below returns `connected`
 *      when we can confirm the network is acceptable, `wrong-network` when we can confirm it
 *      is not, and `failed('unreadable-network')` when this deployment required one and the
 *      wallet would not say. Collapsing the third into either of the others invents a fact:
 *      one direction tells a person their correctly-configured wallet is wrong, the other
 *      tells them a wallet we could not check is fine.
 *
 *   5. ★ `unavailable` IS DECIDED BY PROBING AND BY NOTHING ELSE. No other event can enter
 *      or leave it, so a failure can never be reported as "you have no wallet" and a missing
 *      extension can never be reported as a fault. It is the commonest state there is and it
 *      is not an error.
 */

import type {
  AccountRef,
  NetworkRef,
  WalletFailure,
  WalletState,
} from '@insidor/contracts/ports/wallet.ts';

/**
 * What this build requires of a wallet.
 *
 * `requiredNetwork` is nullable and the nullability is load-bearing. Non-null means a
 * deployment has told us which network its venues can trade on, so a mismatch is a fact we
 * are entitled to assert. Null means nobody told us, so we never assert one — we report the
 * network the wallet named and leave the judgement to whoever has the standing to make it.
 * There is no default, because there is no network we could honestly guess: a wrong guess
 * would tell a person with a correctly-configured wallet that they are on the wrong network,
 * which is worse than saying nothing.
 */
export interface WalletRules {
  readonly requiredNetwork: NetworkRef | null;
}

/**
 * The events. Every one of them carries either nothing or values that have already been
 * through `provider.ts` — there is no `unknown` in this file, which is what makes it
 * impossible for a vendor's payload to reach a state through here.
 */
export type WalletEvent =
  /** The result of looking for a provider. The only way in or out of `unavailable`. */
  | { readonly kind: 'probed'; readonly present: boolean }
  /** Somebody pressed the button. */
  | { readonly kind: 'requested' }
  /** The wallet's prompt resolved. Either value may be null; `settle` decides what that means. */
  | {
      readonly kind: 'opened';
      readonly account: AccountRef | null;
      readonly network: NetworkRef | null;
    }
  /** The person declined. Its own event, so it can never be built out of a failure. */
  | { readonly kind: 'refused' }
  /** Something went wrong, as one of the closed codes. */
  | { readonly kind: 'failed'; readonly code: WalletFailure }
  /** The wallet announced a different account or network while we were connected. */
  | {
      readonly kind: 'changed';
      readonly account: AccountRef | null;
      readonly network: NetworkRef | null;
    }
  /** The connection ended — because we ended it, or because the wallet did. */
  | { readonly kind: 'closed' };

/** Before anything has been probed we know nothing, so the machine is started by a probe. */
export const UNPROBED: WalletState = { kind: 'disconnected' };

/**
 * The network judgement, and the account judgement that has to precede it.
 *
 * Order matters: an unusable account reference is reported as such even when the network is
 * also wrong, because "we could not read your account" is the thing that has to be fixed
 * first and reporting the network instead would send somebody to the wrong setting.
 */
export function settle(
  account: AccountRef | null,
  network: NetworkRef | null,
  rules: WalletRules,
): WalletState {
  if (account === null) return { kind: 'failed', code: 'unreadable-account' };
  const required = rules.requiredNetwork;
  if (required === null) return { kind: 'connected', account, network };
  if (network === null) return { kind: 'failed', code: 'unreadable-network' };
  if (network !== required) return { kind: 'wrong-network', account, required, reported: network };
  return { kind: 'connected', account, network };
}

/** True while we hold a live connection — the only states a change notification may act on. */
function isLive(state: WalletState): boolean {
  return state.kind === 'connected' || state.kind === 'wrong-network';
}

/**
 * The transition. Total, pure, and returns the SAME OBJECT when nothing changed, so a caller
 * can compare by identity and a subscriber is not woken for a non-event.
 */
export function next(state: WalletState, event: WalletEvent, rules: WalletRules): WalletState {
  /* ★ Rule 5, enforced once rather than in five branches. While we know there is no provider
     here, nothing but another probe may move us: a late event from a wallet that has gone
     away must not be able to turn "you have no wallet extension" into "something failed".
     The adapter already returns early in that case, so this guard exists for the events that
     arrive from a listener rather than from a call — which are exactly the ones nobody is
     watching. Written as a branch inside `probed` five times, it is five chances to forget. */
  if (state.kind === 'unavailable' && event.kind !== 'probed') return state;

  switch (event.kind) {
    /* Rule 5. Probing is the only authority on whether a wallet exists here, so it overrides
       whatever we thought — including a live connection, because a provider that has gone
       away has taken the connection with it. Finding one does not connect us; it only stops
       us claiming there is nothing to connect to. */
    case 'probed': {
      if (!event.present) return state.kind === 'unavailable' ? state : { kind: 'unavailable' };
      return state.kind === 'unavailable' ? { kind: 'disconnected' } : state;
    }

    /* Rule 1 lives here: `refused` is not in the list of states that ignore this. There is
       nothing to ask when no provider exists, so `unavailable` is the one state a press
       cannot leave — the adapter re-probes before emitting this, so by the time it arrives
       we have already looked again. */
    case 'requested':
      return state.kind === 'unavailable' ? state : { kind: 'connecting' };

    case 'opened':
      return settle(event.account, event.network, rules);

    case 'refused':
      return state.kind === 'refused' ? state : { kind: 'refused' };

    case 'failed':
      return state.kind === 'failed' && state.code === event.code ? state : { kind: 'failed', code: event.code };

    /* Rules 2 and 3. */
    case 'changed': {
      if (!isLive(state)) return state;
      if (event.account === null) return { kind: 'disconnected' };
      return settle(event.account, event.network, rules);
    }

    case 'closed':
      if (state.kind === 'unavailable' || state.kind === 'disconnected') return state;
      return { kind: 'disconnected' };
  }
}
