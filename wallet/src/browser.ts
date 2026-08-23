/**
 * THE BROWSER WALLET ADAPTER — the only file that talks to a wallet extension.
 *
 * WHAT IT IS RESPONSIBLE FOR: driving `machine.ts` from a real provider. It probes, opens
 * the wallet's prompt, listens for account and network changes, and hands out a `Signer`.
 * Every value it receives from the provider goes through `provider.ts` first; every decision
 * about what state that puts us in is made by `machine.ts`. This file holds the wiring
 * between them and no rules of its own.
 *
 * WHY IT EXISTS SEPARATELY FROM `discovery.ts`: the provider is INJECTED, exactly as every
 * adapter in this repository injects `fetch`. That is what makes the entire connection
 * lifecycle — including refusal, an unreadable account, a network mismatch and a wallet that
 * vanishes mid-session — testable with no browser, no extension and no network.
 *
 * ★ WHAT BREAKS IF THIS IS CHANGED CARELESSLY.
 *
 *   1. ★ NOTHING IN THIS PACKAGE LOGS, AND THAT IS ASSERTED RATHER THAN INTENDED. There is
 *      no `console` call in this file or any other file here, and `no-logging.test.ts` reads
 *      the sources and fails if one appears. The reason is narrow and absolute: this is the
 *      one path where a bug costs a person money, the objects crossing it come from
 *      third-party code running in our page, and a log line is a copy of something in a
 *      place nobody is auditing. A payload handed to a signer, a signature returned by one,
 *      and anything an extension decorated an error with are all things that must exist for
 *      microseconds inside one function and then be gone.
 *
 *   2. ★ `connect` NEVER REJECTS AND NEVER RE-THROWS THE PROVIDER'S ERROR. Everything the
 *      extension throws is classified into one of our own codes and the object is dropped on
 *      the floor — not stored, not attached to a state, not wrapped, not re-thrown. A caller
 *      with no catch block is a caller that cannot log what it caught.
 *
 *   3. ★ PRESSING CONNECT RE-PROBES, AND THAT IS THE DESIGNED ANSWER TO A SLOW EXTENSION.
 *      Extensions inject themselves into the page asynchronously, so a probe at construction
 *      genuinely can miss one that arrives a moment later. We do not poll for it and we do
 *      not start a timer: we look again every time somebody asks to connect. This is exactly
 *      the case the Connect button's liveness was reserved for — it stays pressable in
 *      `unavailable`, pressing it looks again, and if a wallet has appeared it connects. A
 *      disabled button would have made that impossible and would have been wrong twice over.
 *
 *   4. ★ NOTHING IS REMEMBERED BETWEEN SESSIONS AND NOTHING IS CACHED WITHIN ONE. No
 *      storage, no session key, no remembered approval, no last signature. There is
 *      therefore no state a later page load could inherit and no approval one press could
 *      stretch to cover a second thing. Adding "reconnect automatically on reload" would be
 *      adding exactly that, and it is not a convenience worth the shape it creates.
 *
 *   5. ★ THE SIGNER IS BUILT FRESH AND CAPTURES ONLY WHAT IT NEEDS. It holds the account
 *      reference it was created for and refuses if the connection moved underneath it, so a
 *      handle taken while one account was connected can never sign for another.
 *
 *   6. ★ EVERY LINE THAT ENTERS SOMEBODY ELSE'S CODE IS WRAPPED, AND NOTE 2 WAS NOT TRUE
 *      UNTIL IT WAS. `connect` had exactly one `try`, around `found.connect()`, on the
 *      assumption that the rest of this file only reads data. It does not: `discover()`,
 *      `target.on(...)`, `target.off(...)`, `target.disconnect(...)` and the `typeof` probes
 *      in front of them are all calls into or reads from an object a third party wrote, and
 *      an extension that threw from any of them sent its own error — message and stack — out
 *      through a promise the port says never rejects. `Connect.tsx` calls both verbs with
 *      `void` and no catch, so that arrived in the browser console as an unhandled rejection
 *      carrying whatever the extension had decorated it with. Every one of them now goes
 *      through `quietly`, whose fallback is one of our own values.
 *
 *      The same applies INWARD: `emit` walks our own subscribers, and one that throws used
 *      to abandon the walk, so a render error in one consumer stopped every other consumer
 *      being told the account had changed — a stale address on screen, which is note 3 of
 *      `machine.ts` arriving by a route that file cannot see.
 */

import type { Signer } from '@insidor/contracts/ports/venue.ts';
import type { NetworkRef, Wallet, WalletState } from '@insidor/contracts/ports/wallet.ts';

import { UNPROBED, next } from './machine.ts';
import type { WalletEvent, WalletRules } from './machine.ts';
import { classify, networkWithin, quietly, readAccount, readNetwork, readSignature } from './provider.ts';
import type { WalletProvider } from './provider.ts';

export interface BrowserWalletConfig {
  /**
   * Looks for a provider. Called at construction and again on every connect attempt — see
   * note 3 above. Returns null when this browser has none, which is the common case and not
   * a fault.
   */
  readonly discover: () => WalletProvider | null;
  /**
   * The network this build's venues can trade on, or null if nobody has told us. Null is a
   * real answer and produces no claim about the network at all; see `WalletRules`.
   */
  readonly requiredNetwork: NetworkRef | null;
}

/**
 * The change notifications we listen for.
 *
 * Several spellings because extensions differ and an adapter that knew only one would
 * silently keep showing an account a person had already switched away from — note 3 of
 * `machine.ts` is about exactly that failure. Subscribing to a name an extension does not
 * publish costs nothing; missing one costs a stale address on screen.
 */
const ACCOUNT_EVENTS = ['accountChanged', 'accountsChanged', 'change'] as const;
const CLOSE_EVENTS = ['disconnect'] as const;

export function browserWallet(config: BrowserWalletConfig): Wallet {
  const rules: WalletRules = { requiredNetwork: config.requiredNetwork };

  /**
   * Note 6. `discover` reads a property off the page, and a page can define that property as
   * a getter. Here it runs at CONSTRUCTION, inside `main.tsx`, before React mounts — so a
   * throw was not a failed connection, it was a blank document. A wallet we cannot even look
   * for is `unavailable`, which is the state that says exactly that and is not a fault.
   */
  const look = (): WalletProvider | null => quietly(() => config.discover(), null);

  let provider: WalletProvider | null = look();
  let state: WalletState = next(UNPROBED, { kind: 'probed', present: provider !== null }, rules);
  let attached: WalletProvider | null = null;

  const listeners = new Set<(state: WalletState) => void>();

  /**
   * The single write path. `next` returns the same object when nothing changed, so an
   * identity comparison is the whole change detector — and a subscriber is never woken for a
   * non-event, which matters because the app renders from this through
   * `useSyncExternalStore` and a new object every read would be an infinite render loop.
   */
  const emit = (event: WalletEvent): WalletState => {
    const settled = next(state, event, rules);
    if (settled === state) return state;
    state = settled;
    /* Note 6, inward half. The state is committed BEFORE anybody is told, and each listener
       is isolated, so one consumer that throws while rendering cannot stop the next consumer
       hearing about the same change — nor turn a state transition into a rejected `connect`.
       We do not learn which listener failed and do not try to: that is the consumer's own
       error, it belongs to the consumer's own boundary, and carrying it here would mean this
       file holding an error object again. */
    for (const listener of listeners) quietly(() => listener(settled), undefined);
    return settled;
  };

  /**
   * What the provider currently publishes, narrowed. Never trusted, never stored raw.
   *
   * The property read itself is guarded, not just the value: `provider.account` is a read on
   * an object an extension wrote, and `readAccount` never sees a getter that throws before
   * the value reaches it.
   */
  const currentAccount = (): string | null =>
    provider === null ? null : readAccount(quietly(() => provider?.account, undefined));
  const currentNetwork = (): string | null =>
    provider === null ? null : readNetwork(quietly(() => provider?.network, undefined));

  const onAccountEvent = (payload: unknown): void => {
    /* Some extensions publish a list rather than an account. Taking the first is the whole
       of the interpretation we do; anything more elaborate would be guessing which of
       several accounts a person meant, which is not ours to guess. */
    const head = Array.isArray(payload) ? (payload as readonly unknown[])[0] : payload;
    emit({
      kind: 'changed',
      account: readAccount(head) ?? currentAccount(),
      /* `networkWithin` and not `readNetwork` — see the note on it. This payload is about an
         account, so a bare string in it is an account and must never be read as a network. */
      network: networkWithin(head) ?? currentNetwork(),
    });
  };

  const onCloseEvent = (): void => {
    emit({ kind: 'closed' });
  };

  /**
   * Note 6. `target.off` is the extension's function and the `typeof` in front of it is a
   * read on the extension's object; either can run its code. `attached` is cleared whatever
   * happens, because from where we stand we are no longer listening — an extension that
   * refuses to be unsubscribed cannot make us keep believing its events, and a `detach` that
   * threw would have left us attached AND rejected whatever called it.
   */
  const detach = (): void => {
    const target = attached;
    attached = null;
    if (target === null) return;
    quietly(() => {
      if (typeof target.off !== 'function') return;
      for (const name of ACCOUNT_EVENTS) target.off(name, onAccountEvent);
      for (const name of CLOSE_EVENTS) target.off(name, onCloseEvent);
    }, undefined);
  };

  /**
   * The mirror. `attached` is set only if the subscription actually took: a provider whose
   * `on` throws halfway has given us an unknown number of live listeners, and claiming it is
   * attached would make the next `detach` skip a provider that can still push events at us.
   * Recording it as not-attached costs one redundant `off` sweep and never the reverse.
   */
  const attach = (target: WalletProvider): void => {
    if (attached === target) return;
    detach();
    const subscribed = quietly(() => {
      if (typeof target.on !== 'function') return false;
      for (const name of ACCOUNT_EVENTS) target.on(name, onAccountEvent);
      for (const name of CLOSE_EVENTS) target.on(name, onCloseEvent);
      return true;
    }, false);
    if (subscribed) attached = target;
  };

  return {
    state: () => state,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    connect: async () => {
      /* Note 3: look again before deciding there is nothing here. Note 6: through `look`. */
      const found = look();
      provider = found;
      /* A different object from the one we were listening to means the extension was
         replaced, reloaded or removed. Its listeners can no longer tell us anything true
         about the wallet we now hold, so they go before we ask this one anything — otherwise
         a failed reconnect leaves the previous provider still able to push events at us. */
      if (attached !== found) detach();
      emit({ kind: 'probed', present: found !== null });
      if (found === null || state.kind === 'unavailable') return state;
      /* A second press while the wallet's own prompt is already open must not open a second
         one. The person is looking at the first. */
      if (state.kind === 'connecting') return state;

      emit({ kind: 'requested' });

      let result: unknown;
      try {
        result = await found.connect();
      } catch (thrown: unknown) {
        /* Note 2. `classify` reads one scalar and returns one of our own values; the object
           itself goes no further than this block and is referenced nowhere below. */
        const outcome = classify(thrown);
        return outcome === 'refused'
          ? emit({ kind: 'refused' })
          : emit({ kind: 'failed', code: outcome });
      }

      attach(found);
      /* The prompt's own return is preferred, because it describes the account the person
         just chose; what the provider publishes is the fallback for extensions that resolve
         with nothing. */
      return emit({
        kind: 'opened',
        account: readAccount(result) ?? currentAccount(),
        network: networkWithin(result) ?? currentNetwork(),
      });
    },

    disconnect: async () => {
      const target = provider;
      detach();
      if (target !== null) {
        try {
          /* ★ The `typeof` probe is INSIDE the try, which is note 6 in one line: it is a read
             on the extension's object and can run the extension's code, so it belongs on the
             same side of the boundary as the call it guards. Outside, it was the one
             expression in this function that could reject a promise the port says resolves. */
          if (typeof target.disconnect === 'function') await target.disconnect();
        } catch {
          /* A wallet that will not be told it has been disconnected is still disconnected
             from where we stand: we have dropped its listeners and we will ask again before
             we use it. Surfacing this would report a fault to a person who did the thing
             they asked for and got it. Nothing is caught into a variable, so there is
             nothing here that could later be logged. */
        }
      }
      emit({ kind: 'closed' });
    },

    /**
     * Note 5. Null unless we are connected on an acceptable network — `wrong-network` gets
     * no signer, because a signature for a network we cannot trade on is a signature nobody
     * can honour and we should not be collecting it.
     */
    signer: (): Signer | null => {
      if (state.kind !== 'connected') return null;
      const accountRef = state.account;
      return {
        accountRef,
        sign: async (payload: Uint8Array): Promise<Uint8Array> => {
          const target = provider;
          /* Note 6. Looked up ONCE, inside a guard, and held as a local. Two things follow.
             A `signMessage` we could not even READ is "this wallet cannot sign" — our own
             sentence — rather than whatever the lookup threw; unguarded, this was the one
             expression in the signing path outside a try, and its throw carried the
             extension's words into a rejection the caller has every reason to log. And
             holding the function means the object cannot swap it between the check and the
             call, which a getter returning a different value each read can do. */
          const signMessage =
            target === null
              ? null
              : quietly(
                  () => (typeof target.signMessage === 'function' ? target.signMessage : null),
                  null,
                );
          if (target === null || signMessage === null) {
            throw new Error('wallet: this wallet cannot sign');
          }
          if (state.kind !== 'connected' || state.account !== accountRef) {
            throw new Error('wallet: the connected account changed');
          }
          let raw: unknown;
          try {
            raw = await signMessage.call(target, payload);
          } catch (thrown: unknown) {
            /* The code, and not one character of what the extension said. The payload is not
               named here either: a message that quoted what we were asked to sign would put
               it in every log that catches this. `classify` is total, so a `code` getter that
               throws yields `internal` rather than replacing this sentence with theirs. */
            throw new Error(`wallet: signing did not complete (${classify(thrown)})`);
          }
          const signature = readSignature(raw);
          if (signature === null) throw new Error('wallet: signature was not readable');
          return signature;
        },
      };
    },
  };
}
