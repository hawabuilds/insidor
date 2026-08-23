/**
 * THE WALLET CORNER, tested against the rules it exists to hold.
 *
 * There is no DOM in this runner, which is exactly why every decision lives in
 * `wallet-view.ts` and this file can reach all of it. Two of these are greps — one over the
 * component and one over the whole app — and both are here because the specific ways this
 * feature can go wrong are silent: a view computed and never rendered, a caught error
 * printed to a console, or a signing seam quietly wired to a button.
 *
 * THE FIVE RULES:
 *
 *   1. ★ NO TWO STATES SAY THE SAME THING. Eleven distinct situations, eleven distinct
 *      sentences. Merging two always looks like tidying and always sends somebody to the
 *      wrong place.
 *
 *   2. ★ CANCELLING IS NOT AN ERROR, AND NEITHER IS HAVING NO WALLET. Both get the quiet
 *      tone. A person who dismissed a prompt on purpose must not be told anything is broken.
 *
 *   3. ★ AN ADDRESS IS TRUNCATED AND IS NEVER A LABEL. The view has no field where a name
 *      would go, and no branch puts a reference into the button's words.
 *
 *   4. ★ EXACTLY ONE CONTROL IN EVERY STATE, AND ONLY ONE STATE MAY MAKE IT INERT.
 *      Connecting a wallet must change what the app knows, not what it offers.
 *
 *   5. ★ NOTHING HERE LOGS, AND NOTHING HERE SIGNS. Asserted over the source, because both
 *      are one careless line away and neither would fail any other check.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { WalletState } from '@insidor/contracts/ports/wallet.ts';
import { WALLET_FAILURES, WALLET_STATES } from '@insidor/contracts/ports/wallet.ts';

import { truncateRef, walletView } from './wallet-view.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_SRC = join(HERE, '..', '..');

const ACCOUNT = 'AcctReference0000000000000000000001';

/** One of every state the port can be in, including every failure code. */
const EVERY_STATE: readonly WalletState[] = [
  { kind: 'unavailable' },
  { kind: 'disconnected' },
  { kind: 'connecting' },
  { kind: 'connected', account: ACCOUNT, network: 'net-a' },
  { kind: 'refused' },
  { kind: 'wrong-network', account: ACCOUNT, required: 'net-a', reported: 'net-b' },
  ...WALLET_FAILURES.map((code): WalletState => ({ kind: 'failed', code })),
];

test('every state the port declares has a rendering', () => {
  const covered = new Set(EVERY_STATE.map((state) => walletView(state).kind));
  for (const kind of WALLET_STATES) {
    assert.ok(covered.has(kind), `${kind} has no rendering`);
  }
  assert.equal(EVERY_STATE.length, WALLET_STATES.length - 1 + WALLET_FAILURES.length);
});

test('★ RULE 1 — no two states say the same thing', () => {
  const shortLines = new Set<string>();
  const sentences = new Set<string>();
  for (const state of EVERY_STATE) {
    const view = walletView(state);
    if (view.note === null) continue;
    assert.ok(!shortLines.has(view.note.text), `two states share the line "${view.note.text}"`);
    assert.ok(!sentences.has(view.note.detail), `two states share a whole sentence`);
    shortLines.add(view.note.text);
    sentences.add(view.note.detail);
  }
  /* Five failure codes plus unavailable, connecting, refused and wrong-network. The two
     states that say nothing — disconnected and connected — are the two where a permanent
     note would be a note nobody reads. */
  assert.equal(shortLines.size, WALLET_FAILURES.length + 4);
});

test('★ RULE 1 — every sentence names what to do next, and none is a shrug', () => {
  for (const state of EVERY_STATE) {
    const view = walletView(state);
    if (view.note === null) continue;
    assert.ok(view.note.detail.length > 40, `"${view.note.text}" has no real explanation`);
    assert.ok(
      view.note.detail !== view.note.text,
      'the tooltip must say more than the label it belongs to',
    );
  }
});

test('★ RULE 2 — cancelling is not an error state', () => {
  const view = walletView({ kind: 'refused' });
  assert.equal(view.note?.tone, 'quiet', 'a declined prompt must not be dressed as a fault');
  assert.match(view.note?.detail ?? '', /nothing went wrong/i);
  /* And it must not be reachable by mistake from the failure table: `refused` is its own
     branch of the union and carries no code, so no failure can render as it and it cannot
     render as a failure. */
  for (const code of WALLET_FAILURES) {
    const failure = walletView({ kind: 'failed', code });
    assert.notEqual(failure.note?.text, view.note?.text);
    assert.equal(failure.note?.tone, 'warn');
  }
});

test('★ RULE 2 — having no wallet is not an error state either, and is not an upsell', () => {
  const view = walletView({ kind: 'unavailable' });
  assert.equal(view.note?.tone, 'quiet');
  assert.match(view.note?.detail ?? '', /not a fault/i);
  /* No download link, no "get started". The product works without one. */
  assert.doesNotMatch(view.note?.detail ?? '', /install (a|one|it) |download|get started/i);
});

test('waiting for the wallet is quiet too — nothing has gone wrong yet', () => {
  assert.equal(walletView({ kind: 'connecting' }).note?.tone, 'quiet');
});

test('★ RULE 3 — an account reference is truncated, and both ends survive', () => {
  const view = walletView({ kind: 'connected', account: ACCOUNT, network: null });
  assert.ok(view.account !== null);
  assert.notEqual(view.account.short, view.account.full, 'a long reference must be shortened');
  assert.equal(view.account.full, ACCOUNT, 'the whole value stays available to copy');
  assert.ok(view.account.short.startsWith(ACCOUNT.slice(0, 6)));
  assert.ok(view.account.short.endsWith(ACCOUNT.slice(-4)));
  assert.ok(view.account.short.includes('…'));
});

test('★ RULE 3 — a reference is never the button\'s words, in any state', () => {
  for (const state of EVERY_STATE) {
    const view = walletView(state);
    assert.ok(
      !view.action.label.includes(ACCOUNT.slice(0, 6)),
      `${view.kind} put a reference in the control's label`,
    );
    if (view.note !== null) {
      assert.ok(
        !view.note.text.includes(ACCOUNT.slice(0, 6)),
        `${view.kind} put a reference in the note`,
      );
    }
  }
});

test('★ RULE 3 — the view has no field where a name would go', () => {
  const view = walletView({ kind: 'connected', account: ACCOUNT, network: null });
  for (const forbidden of ['name', 'displayName', 'handle', 'label', 'title']) {
    assert.ok(!(forbidden in (view.account ?? {})), `an account gained a "${forbidden}"`);
  }
});

test('a reference short enough to read whole is not decorated with an ellipsis', () => {
  assert.equal(truncateRef('abc'), 'abc');
  /* Code points, not UTF-16 units: a cut between the halves of one character would leave a
     lone surrogate that renders as a replacement glyph. */
  const emoji = '👛'.repeat(20);
  assert.ok(!truncateRef(emoji).includes('�'));
  assert.ok(!/[\uD800-\uDFFF]/.test(truncateRef(emoji).replace(/\p{Emoji_Presentation}/gu, '')));
});

test('★ RULE 4 — there is exactly one control, and only connecting may make it inert', () => {
  for (const state of EVERY_STATE) {
    const view = walletView(state);
    assert.ok(view.action.label.length > 0, `${view.kind} has no control`);
    assert.equal(
      view.action.busy,
      view.kind === 'connecting',
      `${view.kind} is not the state entitled to a disabled control`,
    );
  }
});

test('★ RULE 4 — a connected wallet offers a way back out and nothing else', () => {
  for (const state of EVERY_STATE) {
    const view = walletView(state);
    const expected = state.kind === 'connected' || state.kind === 'wrong-network'
      ? 'disconnect'
      : 'connect';
    assert.equal(view.action.intent, expected, `${view.kind} offers the wrong verb`);
  }
});

test('★ RULE 4 — the wrong network offers no way to proceed, only a way to stop', () => {
  const view = walletView({ kind: 'wrong-network', account: ACCOUNT, required: 'net-a', reported: 'net-b' });
  /* Both names are in the sentence, because "wrong network" without saying which is a dead
     end for whoever has to fix it. */
  assert.match(view.note?.detail ?? '', /net-b/);
  assert.match(view.note?.detail ?? '', /net-a/);
  assert.equal(view.action.intent, 'disconnect');
});

/** Every .ts/.tsx under app/src, tests excluded. */
function appSources(dir: string, into: string[] = []): readonly string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) appSources(full, into);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) into.push(full);
  }
  return into;
}

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

test('★ RULE 5 — nothing in the wallet feature logs', () => {
  const files = readdirSync(HERE).filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n));
  assert.ok(files.length >= 4, 'the grep must actually be reading the feature');
  for (const name of files) {
    const code = stripComments(readFileSync(join(HERE, name), 'utf8'));
    for (const forbidden of ['console.', 'reportError(']) {
      assert.ok(
        !code.includes(forbidden),
        `${name} calls ${forbidden}. connect() resolves rather than rejecting precisely so ` +
          `there is no error object here to print.`,
      );
    }
  }
});

test('★ RULE 5 — nothing in the app asks the wallet for a signer', () => {
  /* The seam exists in the port and is implemented in the adapter, and its narrowness is the
     proof that we hold the ability to ask for a signature and never the ability to produce
     one. It is called by nothing, because there is nothing to hand a signature to: no venue
     will price a coin here, no service can submit what was signed, and no idempotency key is
     minted before the first signature. A caller appearing in the app is the first half of a
     plausible-looking stub, which is the failure shared/api/client.ts names by name. */
  for (const file of appSources(APP_SRC)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    assert.ok(
      !/\.signer\s*\(/.test(code),
      `${relative(APP_SRC, file)} calls .signer(). Nothing in the browser may request a ` +
        `signature until submission, confirmation and idempotency exist in a service.`,
    );
  }
});

test('★ RULE 5 — and submitTrade is still an explicit hole', () => {
  const client = readFileSync(join(APP_SRC, 'shared', 'api', 'client.ts'), 'utf8');
  assert.match(
    client,
    /export async function submitTrade[\s\S]{0,400}?notImplemented\(/,
    'submitTrade must keep throwing. A plausible stub gets wired to a button.',
  );
});

test('★ the component renders the view and decides nothing', () => {
  const component = readFileSync(join(HERE, 'Connect.tsx'), 'utf8');
  assert.match(component, /walletView\(state\)/, 'a view computed and never rendered is the silent failure');
  /* No sentence may be written in the component: every string a person reads is chosen in
     wallet-view.ts, where a test can reach it. */
  const code = stripComments(component);
  for (const state of EVERY_STATE) {
    const view = walletView(state);
    if (view.note === null) continue;
    assert.ok(!code.includes(view.note.text), 'a sentence was duplicated into the component');
  }
});
