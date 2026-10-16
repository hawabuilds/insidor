/** The owner's alarm for an empty supplier account: once per supplier an hour, a recovery once, logged only with no owner. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { OwnerAlert } from '@insidor/store';
import { onOutOfCredit, outOfCredit, vendorAnswered } from '@insidor/vendor-kit';

import { billingAlerts } from './billing-alerts.ts';
import type { Logger, LogFields } from './log.ts';
import type { OwnerQueue } from './supplier-warnings.ts';

const T0 = Date.UTC(2026, 9, 13, 15, 30);
const MIN = 60_000;

function harness(opts: { wallets?: readonly string[]; profiles?: () => readonly string[] } = {}) {
  const lines: { level: string; msg: string; fields: LogFields | undefined }[] = [];
  const queued: { userId: string; alert: OwnerAlert }[] = [];
  let now = T0;
  const log: Logger = {
    info: (msg, fields) => void lines.push({ level: 'info', msg, fields }),
    warn: (msg, fields) => void lines.push({ level: 'warn', msg, fields }),
    error: (msg, fields) => void lines.push({ level: 'error', msg, fields }),
    child: () => log,
  };
  const owner: OwnerQueue = {
    ownerIds: async () => (opts.profiles ?? (() => ['owner-1']))(),
    queue: async (userId, alert) => void queued.push({ userId, alert }),
  };
  const b = billingAlerts({ ownerWallets: opts.wallets ?? ['OwnerWa11et'], owner, log, now: () => now });
  return { b, lines, queued, setNow: (t: number) => (now = t) };
}

const refusal = { vendor: 'anthropic', endpoint: 'POST /v1/messages', reason: 'credit balance too low', status: 400 };

test('★ a dead account is logged once an hour and pushed once per outage, however many calls it refuses', async () => {
  const h = harness();
  for (let i = 0; i < 50; i += 1) {
    h.setNow(T0 + i * 30_000);
    h.b.refused(refusal);
  }
  h.b.refused({ ...refusal, vendor: 'apify', reason: 'monthly usage limit reached', status: 402 });
  await h.b.flush();
  assert.equal(h.lines.filter((l) => l.level === 'error' && l.msg === 'supplier out of credit').length, 2);
  assert.deepEqual(
    h.queued.map((q) => q.alert),
    [
      { kind: 'supplier_account', subject: 'billing|anthropic|2026-10-13T15', rung: 0, facts: { supplier: 'Anthropic', uses: 'the judge', reason: 'credit balance too low', state: 'refused', vendor: 'anthropic' }, href: '/#/alerts' },
      { kind: 'supplier_account', subject: 'billing|apify|2026-10-13T15', rung: 0, facts: { supplier: 'Apify', uses: 'TikTok videos', reason: 'monthly usage limit reached', state: 'refused', vendor: 'apify' }, href: '/#/alerts' },
    ],
  );

  /* The next hour: one more line, carrying the count of refusals it did not log, and no second push. */
  h.setNow(T0 + 31 * MIN);
  h.b.refused(refusal);
  await h.b.flush();
  const second = h.lines.filter((l) => l.msg === 'supplier out of credit' && l.fields?.['vendor'] === 'anthropic');
  assert.equal(second.length, 2);
  assert.equal(second[1]?.fields?.['refusedSinceLastLine'], 49);
  assert.equal(second[1]?.fields?.['alert'], 'owner already pushed for this outage');
  assert.equal(h.queued.length, 2);

  /* Answered, then empty again: a new outage, a new push. */
  h.b.answered('anthropic');
  h.setNow(T0 + 40 * MIN);
  h.b.refused(refusal);
  await h.b.flush();
  assert.deepEqual(h.queued.slice(2).map((q) => [q.alert.facts['state'], q.alert.subject]), [['refused', 'billing|anthropic|2026-10-13T16']]);
});

test('a recovery is alerted once, on the first answer after a refusal; answers while nothing is down do nothing', async () => {
  const h = harness();
  h.b.answered('anthropic');
  h.b.refused(refusal);
  await h.b.flush();
  h.setNow(T0 + 12 * MIN);
  h.b.answered('anthropic');
  h.b.answered('anthropic');
  await h.b.flush();
  assert.equal(h.queued.length, 2);
  assert.equal(h.queued[1]?.alert.facts['state'], 'recovered');
  assert.match(h.queued[1]?.alert.subject ?? '', /^billing\|anthropic\|recovered\|/);
  assert.deepEqual(h.b.down(), []);
  assert.ok(h.lines.some((l) => l.msg === 'supplier answering again' && l.fields?.['downMinutes'] === 12));
});

test('no OWNER_WALLET: logged only; no profile yet: kept and tried again until the owner signs in', async () => {
  const none = harness({ wallets: [] });
  none.b.refused(refusal);
  await none.b.flush();
  assert.equal(none.queued.length, 0);
  assert.equal(none.lines[0]?.fields?.['alert'], 'no OWNER_WALLET; logged only');

  let profiles: readonly string[] = [];
  const later = harness({ profiles: () => profiles });
  later.b.refused(refusal);
  await later.b.flush();
  assert.equal(later.queued.length, 0);
  profiles = ['owner-1'];
  await later.b.flush();
  assert.equal(later.queued.length, 1, 'the owner who signs in later still gets it');

  profiles = [];
  const late = harness({ profiles: () => profiles });
  late.b.refused(refusal);
  await late.b.flush();
  late.setNow(T0 + 3 * 60 * MIN);
  profiles = ['owner-1'];
  await late.b.flush();
  assert.equal(late.queued.length, 1, 'an account still empty hours later is still worth the push');
});

test('★ the minute timer flushing with nothing pending does not stop later refusals from being queued (2026-10-15)', async () => {
  /* At boot the runner flushes each minute before anything is refused. That empty flush used to
     leave its settled promise in place for good, so every later flush did nothing while the log
     said "queued for the owner". */
  const h = harness();
  await h.b.flush();
  await h.b.flush();
  h.setNow(T0 + 5 * MIN);
  h.b.refused(refusal);
  await h.b.flush();
  assert.equal(h.queued.length, 1);
  assert.equal(h.queued[0]?.alert.kind, 'supplier_account');
  h.setNow(T0 + 9 * MIN);
  h.b.answered('anthropic');
  await h.b.flush();
  assert.deepEqual(h.queued.map((q) => q.alert.facts['state']), ['refused', 'recovered']);

  const noWallet = harness({ wallets: [] });
  await noWallet.b.flush();
  noWallet.b.refused(refusal);
  assert.equal(noWallet.lines.filter((l) => l.level === 'error').length, 1);
});

test('wired to the vendor edge: a billing error built in an adapter reaches the registry; a throwing queue never reaches the adapter', async () => {
  const h = harness();
  const off = onOutOfCredit({ refused: (e) => h.b.refused(e), answered: (v) => h.b.answered(v) });
  try {
    const e = outOfCredit('voyage', 'POST /v1/multimodalembeddings', 'no payment method on file', 429);
    assert.equal(e.reason, 'no payment method on file');
    await h.b.flush();
    vendorAnswered('voyage');
    await h.b.flush();
    assert.deepEqual(h.queued.map((q) => q.alert.facts['state']), ['refused', 'recovered']);
  } finally {
    off();
  }

  const broken = billingAlerts({
    ownerWallets: ['w'],
    owner: { ownerIds: async () => { throw new Error('db down'); }, queue: async () => undefined },
    log: { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => undefined as never },
    now: () => T0,
  });
  assert.doesNotThrow(() => broken.refused(refusal));
  await broken.flush();
});
