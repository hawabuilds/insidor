/**
 * Both people services listen for their pool's 'error' event. Without a listener a dropped idle
 * connection ends the process (2026-10-21: notify and social both exited at once and were down
 * nine minutes). Read from the source, because main.ts opens a real pool when imported; and shown
 * live with a bare emitter, which is what pg's pool is.
 */

import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const main = (svc: string): string => readFileSync(new URL(`../../${svc}/src/main.ts`, import.meta.url), 'utf8');

test("★ notify and social each handle their pool's 'error' event", () => {
  for (const svc of ['notify', 'social']) assert.match(main(svc), /pool\.on\('error',/, `${svc}/src/main.ts`);
});

test('an emitter with no error listener throws on an error event; with one, it does not', () => {
  const bare = new EventEmitter();
  assert.throws(() => bare.emit('error', new Error('Connection terminated unexpectedly')));
  const held = new EventEmitter();
  const seen: string[] = [];
  held.on('error', (e: Error) => seen.push(e.message));
  held.emit('error', new Error('Connection terminated unexpectedly'));
  assert.deepEqual(seen, ['Connection terminated unexpectedly']);
});
