import { test } from 'node:test';
import assert from 'node:assert/strict';

import { joinedPill, menuRows, placesOf, type Place } from './menu-rows.ts';

/** Everything the long menu reached before it was condensed (2026-10-21). */
/* How Insidor works ('learn') was taken off the menu by the owner on 2026-10-26. */
const BEFORE: readonly Place[] = ['profile', 'edit-profile', 'wallet-card', 'export-key', 'import-wallet', 'link-wallet', 'linked-wallets', 'show-trades', 'notifications', 'leaderboard', 'missed-posts', 'leave'];

test('★ condensed, not cut: everything the long menu reached is still reached', () => {
  const places = placesOf({ owner: true, member: true, canExport: true });
  for (const p of BEFORE) assert.ok(places.includes(p), p);
  assert.ok(places.includes('invites'));
  assert.ok(places.includes('invite-controls'));
});

test("★ Trador's order: wallets, invites, settings, the leaderboard, the owner's tools, sign out last", () => {
  assert.deepEqual(menuRows({ owner: true, member: true, canExport: true }), ['wallets', 'invites', 'settings', 'leaderboard', 'owner', 'leave']);
  assert.deepEqual(menuRows({ owner: false, member: true, canExport: true }), ['wallets', 'invites', 'settings', 'leaderboard', 'leave'], 'owner tools for the owner only');
});

test('a session still coming back shows no profile, no invites and no export', () => {
  const places = placesOf({ owner: false, member: false, canExport: false });
  for (const p of ['profile', 'invites', 'export-key', 'show-trades', 'missed-posts'] as const) assert.ok(!places.includes(p), p);
  assert.ok(places.includes('leave'));
});

test('the Invites pill counts people, and says nothing before it is read', () => {
  assert.equal(joinedPill(null), null);
  assert.equal(joinedPill(0), '0 joined');
  assert.equal(joinedPill(4), '4 joined');
});
