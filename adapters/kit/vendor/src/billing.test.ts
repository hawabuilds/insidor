/**
 * The billing error and its hook: the error is still an outage to every caller that only knows
 * outages, every listener hears it once when it is built, and a listener that throws cannot
 * replace it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { OutOfCredit, onOutOfCredit, outOfCredit, vendorAnswered } from './billing.ts';
import { VendorUnavailable } from './errors.ts';

test('a billing refusal is an outage to a caller that only knows outages, and carries its reason', () => {
  const e = new OutOfCredit('judge-vendor', 'POST /v1/x', 'credit balance too low', 400);
  assert.ok(e instanceof VendorUnavailable);
  assert.equal(e.reason, 'credit balance too low');
  assert.equal(e.status, 400);
  assert.match(e.message, /refused for billing: credit balance too low/);
});

test('every listener hears a refusal when it is built, and an answer; a throwing listener is dropped', () => {
  const heard: string[] = [];
  const offA = onOutOfCredit({ refused: (e) => heard.push(`refused ${e.vendor}`), answered: (v) => heard.push(`answered ${v}`) });
  const offB = onOutOfCredit({
    refused: () => {
      throw new Error('listener broke');
    },
  });
  const e = outOfCredit('v', 'GET /', 'payment required', 402);
  assert.ok(e instanceof OutOfCredit);
  vendorAnswered('v');
  offA();
  offB();
  outOfCredit('v', 'GET /', 'payment required');
  assert.deepEqual(heard, ['refused v', 'answered v']);
});
