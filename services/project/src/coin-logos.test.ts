/**
 * The logo mirror's choices, with stand-ins for the database, the market source and storage:
 * the market's picture first, then the launch picture; an outage is a failed try, never "none".
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { mirrorPass, sourcesFor } from './coin-logos.ts';

const A = 'So1aNaCoinMint1111111111111111111111111pmp';

test('★ the market picture first, then the launch picture through our gateway, then as recorded', () => {
  const s = sourcesFor({ address: A, metadataImage: 'https://gw.example/ipfs/cid', assetImage: 'http://creator.example/p.png' }, 'https://cdn.example/a.png');
  assert.deepEqual(s, [
    { source: 'market', url: 'https://cdn.example/a.png' },
    { source: 'launch', url: 'https://gw.example/ipfs/cid' },
  ]);
});

function fakeDb(due: readonly { address: string; metadata_image: string | null; asset_image: string | null }[]) {
  const recorded: unknown[][] = [];
  return {
    recorded,
    db: {
      query: async (sql: string, params?: readonly unknown[]) => {
        if (sql.includes('insert into internal.coin_logo')) recorded.push([...(params ?? [])]);
        return (sql.includes('with shown') ? due : []) as never[];
      },
    },
  };
}

test('a failed market copy falls back to the launch picture, and the ledger says which', async () => {
  const { db, recorded } = fakeDb([{ address: A, metadata_image: 'https://gw.example/ipfs/cid', asset_image: null }]);
  const r = await mirrorPass({
    db,
    nowMs: 0,
    marketImages: async () => new Map([[A, 'https://cdn.example/a.png']]),
    copy: async (_a, url) => {
      if (url.includes('cdn.example')) throw new Error('down');
    },
    log: () => {},
  });
  assert.deepEqual(r, { stored: 1, none: 0, failed: 0 });
  assert.deepEqual(recorded, [[A, 'stored', 'launch']]);
});

test('★ no picture anywhere is none; a market outage with no launch picture is failed, not none', async () => {
  const none = fakeDb([{ address: A, metadata_image: null, asset_image: null }]);
  await mirrorPass({ db: none.db, nowMs: 0, marketImages: async () => new Map(), copy: async () => {}, log: () => {} });
  assert.deepEqual(none.recorded, [[A, 'none', null]]);

  const out = fakeDb([{ address: A, metadata_image: null, asset_image: null }]);
  await mirrorPass({ db: out.db, nowMs: 0, marketImages: async () => { throw new Error('429'); }, copy: async () => {}, log: () => {} });
  assert.deepEqual(out.recorded, [[A, 'failed', null]]);
});
