/**
 * The dead-copy rule (dead-copies.ts): only a coin whose picture was compared and differs, that does
 * not link the post, is an hour old and never read above $5K leaves "See N coins". Every other coin
 * stays, and a list the rule would empty is left whole.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { copyCandidates, withoutDeadCopies, type CopyFacts } from './dead-copies.ts';
import type { PostLookup } from './rising.ts';
import type { WireCoinEvidence } from './wire.ts';

const HOUR = 3_600_000;
const NOW = 100 * HOUR;
const P = { on: true, minAgeMs: HOUR, underCapUsd: 5_000 };
const ev = (samePicture: boolean | null, linksPost: boolean | null = false): WireCoinEvidence => ({ samePicture, linksPost, launchedAfterMs: 60_000 });
const unsure = (coins: readonly string[], evidence: Record<string, WireCoinEvidence>): PostLookup => ({
  coins,
  more: false,
  match: { kind: 'unsure', order: coins, evidence: new Map(Object.entries(evidence)) },
});
const facts = (o: Record<string, CopyFacts>): ReadonlyMap<string, CopyFacts> => new Map(Object.entries(o));
const old = (cap: number | null): CopyFacts => ({ launchedAtMs: NOW - 2 * HOUR, highestCapUsd: cap });
const young = (cap: number): CopyFacts => ({ launchedAtMs: NOW - HOUR / 2, highestCapUsd: cap });

const coinsOf = (m: ReadonlyMap<string, PostLookup>, id: string): readonly string[] => {
  const l = m.get(id);
  return l !== undefined && 'coins' in l ? l.coins : [];
};

test('a different-picture copy an hour old that never passed $5K leaves the list', () => {
  const l = new Map([['p', unsure(['dead', 'same'], { dead: ev(false), same: ev(true) })]]);
  const out = withoutDeadCopies(l, facts({ dead: old(3_000), same: old(3_000) }), NOW, P);
  assert.deepEqual(coinsOf(out, 'p'), ['same']);
});

test('every other coin stays: young, ever past $5K, never priced, picture not compared, linking the post', () => {
  const coins = ['young', 'ran', 'unread', 'unknownPic', 'links', 'dead'];
  const l = new Map([['p', unsure(coins, { young: ev(false), ran: ev(false), unread: ev(false), unknownPic: ev(null), links: ev(false, true), dead: ev(false) })]]);
  const out = withoutDeadCopies(l, facts({ young: young(2_000), ran: old(5_000), unread: old(null), unknownPic: old(2_000), links: old(2_000), dead: old(2_000) }), NOW, P);
  assert.deepEqual(coinsOf(out, 'p'), ['young', 'ran', 'unread', 'unknownPic', 'links']);
});

test('a list the rule would empty is left whole, so the card never turns into "No coin yet" on it', () => {
  const l = new Map([['p', unsure(['a', 'b'], { a: ev(false), b: ev(false) })]]);
  const out = withoutDeadCopies(l, facts({ a: old(1_000), b: old(1_000) }), NOW, P);
  assert.deepEqual(coinsOf(out, 'p'), ['a', 'b']);
});

test('a coin not on the evidence (the vouching coin) and a settled post are never touched', () => {
  const matched: PostLookup = { coins: ['m', 'x'], more: false, match: { kind: 'matched', coin: { address: 'm' } as never, evidence: ev(true, true) } };
  const l = new Map<string, PostLookup>([
    ['p', unsure(['vouch', 'dead', 'ok'], { dead: ev(false), ok: ev(true) })],
    ['q', matched],
  ]);
  const out = withoutDeadCopies(l, facts({ vouch: old(1_000), dead: old(1_000), x: old(1_000) }), NOW, P);
  assert.deepEqual(coinsOf(out, 'p'), ['vouch', 'ok']);
  assert.equal(out.get('q'), matched);
});

test('off is the lists as they were; candidates are only compared, different, non-linking coins', () => {
  const l = new Map([['p', unsure(['a', 'b', 'c'], { a: ev(false), b: ev(null), c: ev(false, true) })]]);
  assert.equal(withoutDeadCopies(l, facts({ a: old(1_000) }), NOW, { ...P, on: false }), l);
  assert.deepEqual(copyCandidates(l), ['a']);
});
