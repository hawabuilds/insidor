/**
 * ★ NO KEY MATERIAL CAN REACH A LOG. ASSERTED, NOT PROMISED.
 *
 * This is the test the whole package is shaped around. A wallet extension is third-party
 * code running in our page: its return values and its errors may carry anything its author
 * put there, and on this path the worst thing they could carry is material that costs a
 * person their money. "We are careful in the catch block" is not a guarantee — it is a habit,
 * and habits are not what this file checks.
 *
 * Four assertions, in increasing strength:
 *
 *   1. ★ THE PACKAGE CONTAINS NO LOGGING CALL AT ALL. A grep over the sources. If there is
 *      no `console`, no `process.stdout` and no `process.stderr` anywhere in here, then
 *      nothing in here can write anything anywhere, whatever it is holding at the time. This
 *      is the cheapest of the four and by some distance the most durable.
 *
 *   2. ★ DRIVING THE WHOLE LIFECYCLE WITH A HOSTILE WALLET WRITES NOTHING. Every console
 *      method is captured while a provider that stuffs a recognisable secret into every
 *      value it can — the resolve, the account object, the network object, the thrown error,
 *      its `cause`, its `stack`, and the signature — is driven through connect, refusal,
 *      failure, account change, signing and disconnect. Nothing may be written.
 *
 *   3. ★ NO STATE THAT REACHES A CALLER CONTAINS ANY OF IT. Every state produced along the
 *      way is walked and asserted against the secret. A state is what gets rendered, and
 *      what gets rendered is what ends up in a screenshot, an error report and a bug ticket.
 *
 *   4. ★ AND THE STRINGEST ONE: EVERY STRING IN EVERY STATE IS A VALUE WE CHOSE. Not merely
 *      "does not contain the secret we planted" — which only proves we thought of that
 *      secret — but "is a member of a closed set declared in `contracts`, or one of the two
 *      references we deliberately carry". That is the property that holds against material
 *      nobody thought to plant, which is the material that matters.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { WalletState } from '@insidor/contracts/ports/wallet.ts';
import { WALLET_FAILURES, WALLET_STATES } from '@insidor/contracts/ports/wallet.ts';

import { browserWallet } from './browser.ts';
import type { WalletProvider } from './provider.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Distinctive enough that a substring match is conclusive, and shaped like the real thing. */
const SEED = 'zzsecretzz-correct-horse-battery-staple-eleven';
const ACCOUNT = 'AcctReference0000000000000000000001';
const NETWORK = 'net-a';

test('★ 1 — nothing in this package can log, because nothing in it calls a logger', () => {
  const sources = readdirSync(HERE)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
  assert.ok(sources.length >= 5, 'the grep must actually be reading the package');

  for (const name of sources) {
    const text = readFileSync(join(HERE, name), 'utf8');
    /* Comments are stripped so the headers may DISCUSS logging — a rule is allowed to name
       the thing it forbids, which is the same exemption tools/check-vocabulary.mjs makes. */
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
    for (const forbidden of ['console.', 'process.stdout', 'process.stderr', 'reportError(']) {
      assert.ok(
        !code.includes(forbidden),
        `${name} calls ${forbidden} — this package holds values from third-party code and ` +
          `must not be able to write any of them anywhere`,
      );
    }
  }
});

/**
 * A wallet extension doing its best to get a secret out through us.
 *
 * Everything it hands back carries `SEED` somewhere: as a property, in a message, in a
 * cause, in a stack. None of it is exotic — decorating errors and returning fat objects is
 * ordinary SDK behaviour, which is exactly why the defence cannot be "vendors would not do
 * that".
 */
function hostileProvider(): WalletProvider & { mode: 'ok' | 'refuse' | 'explode' } {
  const bag = { seed: SEED, secretKey: SEED, mnemonic: SEED, privateKey: SEED };
  const provider = {
    mode: 'ok' as 'ok' | 'refuse' | 'explode',
    account: { address: ACCOUNT, ...bag },
    network: { chain: NETWORK, ...bag },
    connect: () => {
      if (provider.mode === 'refuse') {
        return Promise.reject(
          Object.assign(new Error(`user rejected — ${SEED}`), {
            code: 4001,
            cause: bag,
            detail: SEED,
          }),
        );
      }
      if (provider.mode === 'explode') {
        const boom = Object.assign(new Error(`internal wallet failure: ${SEED}`), {
          code: 'SOMETHING_UNRECOGNISED',
          cause: bag,
          ...bag,
        });
        boom.stack = `Error: ${SEED}\n    at wallet (${SEED}:1:1)`;
        return Promise.reject(boom);
      }
      return Promise.resolve({ address: ACCOUNT, chain: NETWORK, ...bag });
    },
    disconnect: () => Promise.reject(Object.assign(new Error(SEED), { code: SEED })),
    signMessage: (payload: Uint8Array) =>
      Promise.resolve({ signature: new Uint8Array([payload.length, 9]), ...bag }),
    on: () => {},
    off: () => {},
  };
  return provider;
}

/** Captures every console method for the duration of one run. */
async function withCapturedConsole(body: () => Promise<void>): Promise<readonly unknown[]> {
  const written: unknown[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir'] as const;
  const console_ = globalThis.console as unknown as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  for (const name of methods) {
    saved.set(name, console_[name]);
    console_[name] = (...args: unknown[]) => written.push(...args);
  }
  try {
    await body();
  } finally {
    for (const [name, fn] of saved) console_[name] = fn;
  }
  return written;
}

/** Every string anywhere inside a value, however deep. */
function stringsIn(value: unknown, into: string[] = []): readonly string[] {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, into);
  else if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value as Record<string, unknown>)) stringsIn(inner, into);
  }
  return into;
}

/** Drives the whole lifecycle against a hostile wallet, collecting every state seen. */
async function driveHostile(): Promise<{ states: WalletState[]; written: readonly unknown[] }> {
  const provider = hostileProvider();
  const states: WalletState[] = [];

  const written = await withCapturedConsole(async () => {
    const wallet = browserWallet({ discover: () => provider, requiredNetwork: NETWORK });
    states.push(wallet.state());
    wallet.subscribe((state) => states.push(state));

    provider.mode = 'refuse';
    states.push(await wallet.connect());

    provider.mode = 'explode';
    states.push(await wallet.connect());

    provider.mode = 'ok';
    states.push(await wallet.connect());

    const signer = wallet.signer();
    assert.ok(signer !== null, 'the hostile provider still connects — that is the point');
    /* Bytes in, bytes out, and neither may end up anywhere afterwards. */
    await signer.sign(new Uint8Array([1, 2, 3, 4, 5]));
    states.push(wallet.state());

    await wallet.disconnect();
    states.push(wallet.state());
  });

  return { states, written };
}

test('★ 2 — a full lifecycle against a hostile wallet writes nothing at all', async () => {
  const { written } = await driveHostile();
  assert.deepEqual(written, [], 'something in the connection path wrote to the console');
});

test('★ 3 — no state produced along the way carries any of it', async () => {
  const { states } = await driveHostile();
  assert.ok(states.length >= 6, 'the drive must actually have produced states');
  for (const state of states) {
    assert.ok(
      !JSON.stringify(state).includes('zzsecretzz'),
      `a wallet state carried planted material: ${JSON.stringify(state)}`,
    );
  }
});

test('★ 4 — every string in every state is a value we chose, not one we were handed', async () => {
  const { states } = await driveHostile();
  const allowed = new Set<string>([...WALLET_STATES, ...WALLET_FAILURES, ACCOUNT, NETWORK]);
  for (const state of states) {
    for (const found of stringsIn(state)) {
      assert.ok(
        allowed.has(found),
        `a wallet state carried the string ${JSON.stringify(found)}, which is not one of ` +
          `ours. Every string that reaches a caller must come from a closed set in ` +
          `contracts, or be the account or network reference we deliberately carry.`,
      );
    }
  }
});

test('★ a declined prompt with a decorated error is still just `refused`', async () => {
  const provider = hostileProvider();
  provider.mode = 'refuse';
  const wallet = browserWallet({ discover: () => provider, requiredNetwork: null });
  const state = await wallet.connect();
  /* The error carried the secret in four places and a code in one. Only the code survived. */
  assert.deepEqual(state, { kind: 'refused' });
});

test('★ a signing failure throws a code and never the payload or what the wallet said', async () => {
  const provider = hostileProvider();
  const wallet = browserWallet({ discover: () => provider, requiredNetwork: null });
  await wallet.connect();
  const signer = wallet.signer();
  assert.ok(signer !== null);

  const payload = new Uint8Array([222, 173, 190, 239]);
  const angry = { ...provider, signMessage: () => Promise.reject(new Error(`nope ${SEED}`)) };
  const second = browserWallet({ discover: () => angry, requiredNetwork: null });
  await second.connect();
  const secondSigner = second.signer();
  assert.ok(secondSigner !== null);

  await assert.rejects(
    () => secondSigner.sign(payload),
    (thrown: unknown) => {
      const whole = `${String(thrown)} ${(thrown as Error).stack ?? ''}`;
      assert.ok(!whole.includes('zzsecretzz'), 'the wallet\'s own words escaped in a throw');
      assert.ok(!whole.includes('222'), 'the payload escaped in a throw');
      assert.ok(!whole.includes('deadbeef'), 'the payload escaped in a throw');
      assert.match(whole, /signing did not complete \(internal\)/);
      return true;
    },
  );
});

test('★ a signature is returned and then held nowhere', async () => {
  const provider = hostileProvider();
  const wallet = browserWallet({ discover: () => provider, requiredNetwork: null });
  await wallet.connect();
  const signer = wallet.signer();
  assert.ok(signer !== null);
  const signature = await signer.sign(new Uint8Array([1, 2, 3]));
  assert.deepEqual([...signature], [3, 9]);
  /* The state after signing is identical to the state before it: nothing about the fact that
     a signature was produced, or what it was, is remembered anywhere a caller can reach. */
  assert.deepEqual(wallet.state(), { kind: 'connected', account: ACCOUNT, network: NETWORK });
});
