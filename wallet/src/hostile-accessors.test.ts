/**
 * ★ A WALLET EXTENSION CANNOT GET ITS OWN WORDS OUT BY MAKING A *READ* THROW.
 *
 * WHAT THIS FILE IS RESPONSIBLE FOR: the half of the leak guarantee that `no-logging.test.ts`
 * does not cover. That file plants a secret in every VALUE a provider hands back and proves
 * none of it reaches a state or a console. It cannot catch this, because the attack here is
 * not what the extension returns — it is what happens while we look.
 *
 * WHY IT EXISTS SEPARATELY: because the two are different mechanisms and a reader has to be
 * able to see which one they are reading. `no-logging.test.ts` is about DATA and its hostile
 * provider returns fat objects. This one is about CONTROL, and every provider in it is
 * ordinary except that one accessor runs code:
 *
 *     { get address() { throw new Error(theSecret) } }
 *
 * ★ THE BUG THIS WAS WRITTEN AGAINST WAS REAL AND ALL SEVEN OF ITS DOORS WERE OPEN.
 * `provider.ts` and `browser.ts` both assumed that reading a property, calling `on`/`off`,
 * and probing with `typeof` are things that cannot fail. Every one of them is an operation a
 * third party controls, and every one of them threw the EXTENSION'S OWN ERROR — message,
 * stack and any decoration — straight out through `connect()` and `disconnect()`, which the
 * port promises never reject. `Connect.tsx` calls both with `void` and no catch, so the
 * browser printed the whole object to the console as an unhandled rejection. The failure
 * mode was therefore the exact one the package's headers claim is structurally impossible,
 * arriving through the one door nobody had shut.
 *
 * ★ WHAT EACH TEST ASSERTS IS THE SAME TWO THINGS, AND BOTH MATTER. That the promise
 * RESOLVES — because a caller with nothing to catch cannot log what it caught — and that the
 * state it resolves with is one of ours. A version that caught the throw and returned
 * `failed` with the extension's text attached would pass the first and fail the second.
 *
 * WHAT BREAKS IF THIS IS CHANGED CARELESSLY: relaxing any of these to "does not contain the
 * secret" would weaken it to the property `no-logging.test.ts` already has. The assertion is
 * that the outcome is a MEMBER OF OUR CLOSED SET, which holds against text nobody planted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WALLET_FAILURES, WALLET_STATES } from '@insidor/contracts/ports/wallet.ts';
import type { WalletState } from '@insidor/contracts/ports/wallet.ts';

import { browserWallet } from './browser.ts';
import { globalDiscovery } from './discovery.ts';
import type { WalletProvider } from './provider.ts';

const SEED = 'zzsecretzz-correct-horse-battery-staple';
const ACCOUNT = 'AcctReference0000000000000000000001';

/** An object whose named property runs the extension's code — and throws it at us. */
function throwingAt<T extends object>(base: T, property: string): T {
  return Object.defineProperty(base, property, {
    enumerable: true,
    configurable: true,
    get() {
      throw new Error(`${property} getter: ${SEED}`);
    },
  });
}

/**
 * ★ THE ASSERTION, IN ONE PLACE. Not "the secret did not appear" — that only proves we
 * thought of this secret — but "every string in the resulting state is one this repository
 * declared". `no-logging.test.ts` ★ 4 makes the same argument and this is it applied to the
 * control path.
 */
function assertOurs(state: WalletState, what: string): void {
  const allowed = new Set<string>([...WALLET_STATES, ...WALLET_FAILURES, ACCOUNT]);
  const strings = JSON.stringify(state).match(/"([^"]*)"/g) ?? [];
  for (const quoted of strings) {
    const value = quoted.slice(1, -1);
    /* Object KEYS are ours by construction — they are the field names in contracts — so only
       values are checked, which is why the allowlist does not list `kind`, `code` and so on. */
    if (['kind', 'code', 'account', 'network', 'required', 'reported'].includes(value)) continue;
    assert.ok(
      allowed.has(value),
      `${what} produced the string ${JSON.stringify(value)}, which is not one of ours`,
    );
  }
  assert.ok(!JSON.stringify(state).includes('zzsecretzz'), `${what} carried planted material`);
}

/* ── the seven doors ──────────────────────────────────────────────────── */

test('★ a throwing `code` getter on the rejection cannot replace our classification', async () => {
  const wallet = browserWallet({
    discover: () => ({
      connect: () => Promise.reject(throwingAt(new Error(`boom ${SEED}`), 'code')),
    }),
    requiredNetwork: null,
  });
  const state = await wallet.connect();
  /* `internal` and not a crash: we could not read the code, so we do not claim to know one.
     Notably NOT `refused` — inventing a declined prompt out of an unreadable error would tell
     a person they cancelled something they never saw. */
  assert.deepEqual(state, { kind: 'failed', code: 'internal' });
  assertOurs(state, 'a throwing code getter');
});

test('★ a throwing `account` getter on the provider is an unreadable account, not a crash', async () => {
  const provider = throwingAt(
    { connect: () => Promise.resolve(undefined) },
    'account',
  ) as unknown as WalletProvider;
  const wallet = browserWallet({ discover: () => provider, requiredNetwork: null });
  const state = await wallet.connect();
  assert.deepEqual(state, { kind: 'failed', code: 'unreadable-account' });
  assertOurs(state, 'a throwing account getter');
});

test('★ a throwing `address` getter inside the connect result is the same answer', async () => {
  const wallet = browserWallet({
    discover: () => ({ connect: () => Promise.resolve(throwingAt({}, 'address')) }),
    requiredNetwork: null,
  });
  const state = await wallet.connect();
  assert.deepEqual(state, { kind: 'failed', code: 'unreadable-account' });
  assertOurs(state, 'a throwing address getter');
});

test('★ an `on` that throws costs us the notifications, not the connection', async () => {
  const wallet = browserWallet({
    discover: () => ({
      connect: () => Promise.resolve(ACCOUNT),
      on: () => {
        throw new Error(`on(): ${SEED}`);
      },
      off: () => {},
    }),
    requiredNetwork: null,
  });
  const state = await wallet.connect();
  /* ★ THE CONNECTION IS REAL AND IS REPORTED AS REAL. A wallet that will not let us subscribe
     to changes has still connected, and downgrading that to a failure would tell a person
     their working wallet is broken. What we lose is the change feed — which is why `attach`
     records the subscription as not taken, so the next `detach` sweeps it anyway. */
  assert.deepEqual(state, { kind: 'connected', account: ACCOUNT, network: null });
  assertOurs(state, 'a throwing on()');
});

test('★ an `off` that throws still leaves us disconnected, and resolves', async () => {
  const wallet = browserWallet({
    discover: () => ({
      connect: () => Promise.resolve(ACCOUNT),
      on: () => {},
      off: () => {
        throw new Error(`off(): ${SEED}`);
      },
    }),
    requiredNetwork: null,
  });
  await wallet.connect();
  await wallet.disconnect();
  assert.deepEqual(wallet.state(), { kind: 'disconnected' });
});

test('★ a `disconnect` that throws is not a fault reported to the person', async () => {
  const wallet = browserWallet({
    discover: () => ({
      connect: () => Promise.resolve(ACCOUNT),
      disconnect: () => Promise.reject(new Error(`disconnect(): ${SEED}`)),
    }),
    requiredNetwork: null,
  });
  await wallet.connect();
  await wallet.disconnect();
  assert.deepEqual(wallet.state(), { kind: 'disconnected' });
});

test('★ a discovery lookup that throws reads as no wallet, which is not a fault', async () => {
  const wallet = browserWallet({
    discover: () => {
      throw new Error(`discover(): ${SEED}`);
    },
    requiredNetwork: null,
  });
  /* At CONSTRUCTION this was a blank document rather than a failed connection: `main.tsx`
     builds the adapter before React mounts. */
  assert.deepEqual(wallet.state(), { kind: 'unavailable' });
  const state = await wallet.connect();
  assert.deepEqual(state, { kind: 'unavailable' });
});

test('★ a page global defined as a throwing getter costs that key and not the sweep', () => {
  const scope: Record<string, unknown> = { later: { connect: () => Promise.resolve(ACCOUNT) } };
  Object.defineProperty(scope, 'first', {
    enumerable: true,
    get() {
      throw new Error(`window.first: ${SEED}`);
    },
  });
  const discover = globalDiscovery(['first', 'later'], scope);
  assert.notEqual(discover(), null, 'a wallet published under the second name is still found');
});

test('★ a `signMessage` we cannot even look up is our sentence, never the extension\'s', async () => {
  const base = { connect: () => Promise.resolve(ACCOUNT), on: () => {}, off: () => {} };
  let armed = false;
  const provider = new Proxy(base as unknown as WalletProvider, {
    get(target, prop, receiver) {
      if (prop === 'signMessage' && armed) throw new Error(`signMessage lookup: ${SEED}`);
      return Reflect.get(target, prop, receiver);
    },
  });
  const wallet = browserWallet({ discover: () => provider, requiredNetwork: null });
  await wallet.connect();
  const signer = wallet.signer();
  assert.ok(signer !== null);
  armed = true;
  await assert.rejects(
    () => signer.sign(new Uint8Array([1])),
    (thrown: unknown) => {
      const whole = `${String(thrown)} ${(thrown as Error).stack ?? ''}`;
      assert.ok(!whole.includes('zzsecretzz'), 'the extension\'s words escaped through a lookup');
      assert.match(whole, /this wallet cannot sign/);
      return true;
    },
  );
});

/* ── and the door that faces inward ───────────────────────────────────── */

test('★ one of OUR subscribers throwing does not stop the others being told', async () => {
  const wallet = browserWallet({
    discover: () => ({ connect: () => Promise.resolve(ACCOUNT) }),
    requiredNetwork: null,
  });
  const seen: WalletState[] = [];
  wallet.subscribe(() => {
    throw new Error('a consumer blew up while rendering');
  });
  wallet.subscribe((state) => seen.push(state));

  const state = await wallet.connect();
  /* ★ THE POINT IS THE SECOND SUBSCRIBER. React's `useSyncExternalStore` callback is one of
     these, and a component that threw while rendering used to take the whole notification
     with it — so every other consumer kept the previous account on screen. That is a fact
     that has stopped being true, still being asserted, which is note 3 of `machine.ts`
     arriving by a route that file cannot see. */
  assert.deepEqual(state, { kind: 'connected', account: ACCOUNT, network: null });
  assert.deepEqual(seen.at(-1), { kind: 'connected', account: ACCOUNT, network: null });
});

/**
 * The change path, which is the one that fires from INSIDE the extension's own dispatch —
 * so an escaping throw lands in the extension's code and is logged by whatever it does with
 * its errors, somewhere we cannot see and cannot audit.
 *
 * ★ THE TWO CASES DIFFER IN WHETHER WE CAN STILL SEE AN ACCOUNT ANYWHERE, and the answers
 * differ with them. That is the point of testing both: "we could not read the notification"
 * is not by itself evidence about the account.
 */
function announcer(publishes: boolean) {
  const fired = new Map<string, (payload: unknown) => void>();
  const provider: WalletProvider = {
    connect: () => Promise.resolve(ACCOUNT),
    on: (event, listener) => {
      fired.set(event, listener);
    },
    off: () => {},
    ...(publishes ? { account: ACCOUNT } : {}),
  };
  return { provider, fired };
}

test('★ an unreadable change notification drops the connection rather than assert a stale one', async () => {
  const { provider, fired } = announcer(false);
  const wallet = browserWallet({ discover: () => provider, requiredNetwork: null });
  await wallet.connect();

  const announce = fired.get('accountChanged');
  assert.ok(announce !== undefined, 'the adapter must have subscribed');
  announce(throwingAt({}, 'address'));

  /* ★ `disconnected`, AND THAT IS THE CONSERVATIVE ANSWER RATHER THAN A LOST ONE. This wallet
     publishes nothing at `provider.account`, so after a notification we could not read there
     is no account we can still see anywhere — and rule 3 of `machine.ts` is that an account
     we cannot confirm is not one we keep showing. The alternative is holding the previous
     reference on screen on the strength of a message that told us nothing, which is a fact
     that stopped being checkable still being asserted. Pressing Connect asks again. */
  assert.deepEqual(wallet.state(), { kind: 'disconnected' });
});

test('★ but a wallet that still publishes its account keeps the connection through one', async () => {
  const { provider, fired } = announcer(true);
  const wallet = browserWallet({ discover: () => provider, requiredNetwork: null });
  await wallet.connect();

  const announce = fired.get('accountChanged');
  assert.ok(announce !== undefined);
  announce(throwingAt({}, 'address'));

  /* Here the fallback in `onAccountEvent` has something real to fall back TO — the account
     the provider still publishes — so the connection is unchanged and no throw escaped into
     the extension's dispatch on the way. */
  assert.deepEqual(wallet.state(), { kind: 'connected', account: ACCOUNT, network: null });
});
