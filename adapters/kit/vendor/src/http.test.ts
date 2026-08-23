/**
 * The shared transport predicates, tested where they live rather than three times in
 * three adapters.
 *
 * ★ THE FIRST TEST IS THE REASON THE MODULE EXISTS. `Number('')` is 0, so a header
 * that is present and blank once read back as a measured "this client has no requests
 * left" — a fabricated measurement in the one layer whose whole argument is that we
 * do not fabricate them. It is asserted here, once, so that no adapter can reacquire
 * it by writing its own reader.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bounded,
  headerNumber,
  headerValueProblem,
  httpUrlProblem,
  messageOf,
  quotaFrom,
  quotaNote,
  snippet,
  trimTrailingSlash,
} from './http.ts';

const headers = (values: Record<string, string>): Headers => new Headers(values);

const NAMES = {
  used: 'x-ratelimit-used',
  remaining: 'x-ratelimit-remaining',
  resetSeconds: 'x-ratelimit-reset',
  retryAfter: 'retry-after',
} as const;

/* ── ★ the bug this file exists not to have ───────────────────────────── */

test('★ a header that is PRESENT AND BLANK is no reading, not zero', () => {
  // Whoever eventually paces on a quota reading would stop dead on a source that was
  // fine. Null means "we do not have a reading", which is a different fact from every
  // number including zero.
  assert.equal(headerNumber(headers({ 'x-ratelimit-remaining': '' }), 'x-ratelimit-remaining'), null);
  assert.equal(headerNumber(headers({ 'x-ratelimit-remaining': '   ' }), 'x-ratelimit-remaining'), null);
});

test('only the spelling vendors actually use is accepted', () => {
  // `Number` reads '0x10' as 16 and '1e3' as 1000. Neither is a quota spelling, and a
  // guess about the remaining quota is worse than knowing we do not have one.
  const read = (raw: string): number | null => headerNumber(headers({ h: raw }), 'h');
  assert.equal(read('97'), 97);
  assert.equal(read('97.0'), 97);
  assert.equal(read(' -3 '), -3);
  assert.equal(read('0'), 0, 'a real zero is a real reading and must survive');
  assert.equal(read('0x10'), null);
  assert.equal(read('1e3'), null);
  assert.equal(read('lots'), null);
  assert.equal(read('Infinity'), null);
});

test('an absent header is null, and header names are case-insensitive', () => {
  assert.equal(headerNumber(headers({}), 'x-ratelimit-used'), null);
  assert.equal(headerNumber(headers({ 'X-RateLimit-Used': '5' }), 'x-ratelimit-used'), 5);
});

/* ── quota assembly ───────────────────────────────────────────────────── */

test('a vendor that publishes nothing yields four nulls, which is the honest answer', () => {
  const reading = quotaFrom(headers({}), NAMES);
  assert.deepEqual(reading, { used: null, remaining: null, resetSeconds: null, retryAfter: null });
  assert.ok(quotaNote(reading).includes('unknown'));
});

test('retry-after is kept as a STRING, because it may be a date rather than seconds', () => {
  // Collapsing both documented forms into a number would either lose the date form or
  // invent a clock read inside a module that has no clock.
  const reading = quotaFrom(headers({ 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }), NAMES);
  assert.equal(reading.retryAfter, 'Wed, 21 Oct 2026 07:28:00 GMT');
  assert.ok(quotaNote(reading).includes('retry after Wed'));
});

test('a quota note separates a reading from the absence of one', () => {
  const reading = quotaFrom(headers({ 'x-ratelimit-remaining': '0', 'retry-after': '30' }), NAMES);
  assert.equal(reading.remaining, 0);
  const note = quotaNote(reading);
  assert.ok(note.includes('remaining 0'));
  assert.ok(note.includes('used unknown'));
  assert.ok(note.includes('retry after 30'));
});

/* ── ★ bounding ───────────────────────────────────────────────────────── */

test('★ a vendor string is cut, and the cut is visible', () => {
  // An unbounded string ends up whole in an exception, which ends up whole in a log
  // line, a metric label and eventually a screen. A reader has to be able to see it
  // was cut rather than wonder whether the vendor sent something odd.
  assert.equal(bounded('short', 10), 'short');
  assert.equal(bounded('0123456789abc', 10), '0123456789…');
  assert.ok(bounded('x'.repeat(100_000), 40).length < 45);

  assert.equal(snippet('hi'), '"hi"');
  assert.ok(snippet('y'.repeat(500)).endsWith('…'));
  // Quoted, so a body full of whitespace or newlines is still one readable token.
  assert.equal(snippet('a\nb'), '"a\\nb"');
});

test('a caught non-Error is described without stringifying whatever it is', () => {
  // `JSON.stringify(err)` is how a vendor SDK's decorations end up in a log.
  assert.equal(messageOf(new TypeError('socket hang up')), 'socket hang up');
  assert.equal(messageOf('plain'), 'plain');
  assert.equal(messageOf(42), '42');
});

/* ── ★ configuration predicates ───────────────────────────────────────── */

test('★ a credential with whitespace in it is refused, not trimmed', () => {
  // A newline in a header value is header injection: the request that goes out is not
  // the request the code wrote. A trailing newline off a terminal paste is the
  // ordinary way it happens.
  assert.equal(headerValueProblem('a-good-key'), null);
  assert.ok(headerValueProblem('')?.includes('empty'));
  assert.ok(headerValueProblem('   ')?.includes('empty'));
  assert.ok(headerValueProblem('key\n')?.includes('newline'));
  assert.ok(headerValueProblem('key with spaces') !== null);
  assert.ok(headerValueProblem('key\u0000nul') !== null);
  assert.ok(headerValueProblem('key\rcr') !== null);
});

test('★ a base url carrying a query or a fragment is refused rather than normalised', () => {
  // The parameters we append would land after a `?` that is already there, silently
  // changing every request built on it. A base URL we quietly rewrote is one the
  // operator cannot reason about from the file they edited.
  assert.equal(httpUrlProblem('https://api.example.com'), null);
  assert.equal(httpUrlProblem('http://localhost:3000/v2'), null);
  assert.ok(httpUrlProblem('')?.includes('empty'));
  assert.ok(httpUrlProblem('api.example.com')?.includes('not a URL'));
  assert.ok(httpUrlProblem('ftp://api.example.com')?.includes('http(s)'));
  assert.ok(httpUrlProblem('file:///etc/passwd')?.includes('http(s)'));
  assert.ok(httpUrlProblem('https://api.example.com?token=x')?.includes('query string'));
  assert.ok(httpUrlProblem('https://api.example.com#frag')?.includes('fragment'));
});

test('a hostile base url is bounded before it reaches the message', () => {
  const problem = httpUrlProblem('z'.repeat(10_000));
  assert.ok(problem !== null);
  assert.ok(problem.length < 200, 'an unbounded value reached a configuration error');
});

test('joining a path to a base url is unambiguous', () => {
  assert.equal(trimTrailingSlash('https://api.example.com///'), 'https://api.example.com');
  assert.equal(trimTrailingSlash('  https://api.example.com  '), 'https://api.example.com');
});
