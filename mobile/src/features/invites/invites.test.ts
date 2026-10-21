import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeAccess, decodeCodeCheck, decodeMyInvites } from '../../shared/api/invites.ts';
import { cleanCode, codeFromPath, inviteLink, takeInviteLink } from './invite-code.ts';

test('★ a code is cleaned as the server cleans it', () => {
  assert.equal(cleanCode(' superteam-uk '), 'SUPERTEAMUK');
  assert.equal(cleanCode('abc'), null);
  assert.equal(cleanCode('AB$CD'), null);
});

test('★ an invite link carries its code, and nothing else does', () => {
  assert.equal(codeFromPath('/i/abcd2345'), 'ABCD2345');
  assert.equal(codeFromPath('/i/SUPERTEAMUK/'), 'SUPERTEAMUK');
  assert.equal(codeFromPath('/i/'), null);
  assert.equal(codeFromPath('/'), null);
  assert.equal(codeFromPath('/i/AB/x'), null);
  assert.equal(codeFromPath('/x/ABCD2345'), null);
  assert.equal(inviteLink('https://insidor.app/', 'ABCD2345'), 'https://insidor.app/i/ABCD2345');
});

test('the link is turned back into the app address, keeping the hash', () => {
  const went: string[] = [];
  assert.equal(takeInviteLink({ pathname: '/i/abcd2345', hash: '#/narratives' }, (u) => went.push(u)), 'ABCD2345');
  assert.deepEqual(went, ['/#/narratives']);
  assert.equal(takeInviteLink({ pathname: '/', hash: '' }, (u) => went.push(u)), null);
  assert.equal(went.length, 1, 'any other address is left alone');
});

test('the door holds only what it draws: who a code is from, and nothing that is not a picture link', () => {
  const member = decodeCodeCheck({ code: 'ABCD', state: 'valid', from: { kind: 'member', userId: 'u', handle: 'ana', name: 'Ana', pictureUrl: 'http://bad' }, extra: 1 });
  assert.deepEqual(member, { code: 'ABCD', state: 'valid', from: { kind: 'member', userId: 'u', handle: 'ana', name: 'Ana', pictureUrl: null } });
  assert.deepEqual(decodeCodeCheck({ state: 'used_up', from: { kind: 'partner', label: 'Superteam UK' } }).from, { kind: 'partner', label: 'Superteam UK' });
  assert.equal(decodeCodeCheck({ state: 'weird' }).state, 'unknown');
});

test('a place on the waitlist is a place, or none', () => {
  assert.deepEqual(decodeAccess({ access: false, waitlist: { position: 4, joinedAt: 1 } }), { access: false, waitlist: { position: 4, joinedAt: 1 } });
  assert.deepEqual(decodeAccess({ access: false, waitlist: { position: 0 } }), { access: false, waitlist: null });
  assert.deepEqual(decodeAccess({ access: 'yes' }), { access: false, waitlist: null }, 'only a true is in');
  assert.deepEqual(decodeMyInvites({ codes: [{ code: 'A2B3', used: true }, { nope: 1 }], joined: [{ userId: 'u', handle: 'b', at: 5 }] }), {
    codes: [{ code: 'A2B3', used: true }],
    joined: [{ userId: 'u', handle: 'b', name: null, pictureUrl: null, at: 5 }],
  });
});
