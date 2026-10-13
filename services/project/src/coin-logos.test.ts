/**
 * The logo mirror's choices, with stand-ins for the database, the sources and storage: the coin's
 * own metadata picture first, then the launchpad's copy, then the market source's; an outage is a
 * failed try, never "none"; a coin left as a letter is logged with why.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_ATTEMPTS, mirrorPass, resolveCoin, type DueCoin, type MirrorDeps } from './coin-logos.ts';

const A = 'So1aNaCoinMint1111111111111111111111111pmp';
const coin = (over: Partial<DueCoin> = {}): DueCoin => ({ address: A, metadataUri: 'https://ipfs.example/ipfs/doc', metadataImage: null, lastOutcome: null, attempts: 0, ...over });
const urls = (link: string) => (link.startsWith('ipfs://') ? ['https://gw1.example/x', 'https://gw2.example/x'] : [link]);

function deps(over: Partial<MirrorDeps> = {}): MirrorDeps & { recorded: unknown[][]; logged: [string, Record<string, unknown>][] } {
  const recorded: unknown[][] = [];
  const logged: [string, Record<string, unknown>][] = [];
  return {
    recorded,
    logged,
    db: {
      query: async (sql: string, params?: readonly unknown[]) => {
        if (sql.includes('insert into internal.coin_logo')) recorded.push([...(params ?? [])]);
        if (sql.includes('information_schema')) return [{ '?column?': 1 }] as never[];
        return [] as never[];
      },
    },
    nowMs: 0,
    elapsedMs: () => 0,
    metadataPicture: async () => 'ipfs://picture',
    venuePicture: async () => 'https://venue.example/p.png',
    marketImages: async () => new Map([[A, 'https://cdn.example/a.png']]),
    pictureUrls: urls,
    copy: async () => {},
    log: (m, f) => logged.push([m, f]),
    ...over,
  };
}

const open = () => true;
const noop = () => {};

test('★ the metadata picture first, through the next gateway when one fails', async () => {
  const tried: string[] = [];
  const r = await resolveCoin(coin(), deps({ copy: async (_a, u) => { tried.push(u); if (u.includes('gw1')) throw new Error('429'); } }), new Map(), open, noop);
  assert.deepEqual(r, { outcome: 'stored', source: 'launch', why: null });
  assert.deepEqual(tried, ['https://gw1.example/x', 'https://gw2.example/x']);
});

test('the picture already read from the metadata is used without reading the document again', async () => {
  let read = 0;
  const r = await resolveCoin(coin({ metadataImage: 'https://pin.example/ipfs/p' }), deps({ metadataPicture: async () => { read += 1; return null; } }), new Map(), open, noop);
  assert.equal(r.outcome, 'stored');
  assert.equal(read, 0);
});

test('★ then the launchpad copy, then the market copy, in that order', async () => {
  const d = deps({ copy: async (_a, u) => { if (!u.includes('cdn.example')) throw new Error('down'); } });
  const r = await resolveCoin(coin(), d, new Map([[A, 'https://cdn.example/a.png']]), open, noop);
  assert.deepEqual(r, { outcome: 'stored', source: 'market', why: null });
  const v = await resolveCoin(coin(), deps({ metadataPicture: async () => null }), new Map(), open, noop);
  assert.deepEqual(v, { outcome: 'stored', source: 'venue', why: null });
});

test('★ every source answering "no picture" is none; any outage makes it failed, with each reason', async () => {
  const none = await resolveCoin(coin({ metadataUri: null }), deps({ venuePicture: async () => null }), new Map(), open, noop);
  assert.equal(none.outcome, 'none');
  assert.match(none.why ?? '', /launch: no metadata link.*venue: no picture.*market: no picture/);

  const out = await resolveCoin(coin(), deps({ metadataPicture: async () => { throw new Error('timeout'); }, venuePicture: async () => null }), null, open, noop);
  assert.equal(out.outcome, 'failed');
  assert.match(out.why ?? '', /launch: metadata unreachable \(timeout\).*market: unreachable/);
});

test('a pass records each coin, and logs a letter when no source has a picture', async () => {
  const d = deps({
    metadataPicture: async () => null,
    venuePicture: async () => null,
    marketImages: async () => new Map(),
    db: {
      query: async (sql: string, params?: readonly unknown[]) => {
        if (sql.includes('information_schema')) return [{ x: 1 }] as never[];
        if (sql.includes('with shown')) return [{ address: A, metadata_uri: 'https://m.example/doc', metadata_image: null, last_outcome: null, attempts: null }] as never[];
        if (sql.includes('insert into internal.coin_logo')) d.recorded.push([...(params ?? [])]);
        return [] as never[];
      },
    },
  });
  const r = await mirrorPass(d);
  assert.equal(r.none, 1);
  assert.equal(r.letters, 1);
  assert.equal(d.recorded[0]?.[1], 'none');
  assert.ok(d.logged.some(([m, f]) => m === 'coin logo is a letter' && f['address'] === A));
});

test('a failed coin is a letter only once it is out of tries', async () => {
  const run = async (attempts: number) => {
    const d = deps({
      copy: async () => { throw new Error('down'); },
      db: {
        query: async (sql: string) => {
          if (sql.includes('information_schema')) return [{ x: 1 }] as never[];
          if (sql.includes('with shown')) return [{ address: A, metadata_uri: null, metadata_image: null, last_outcome: 'failed', attempts }] as never[];
          return [] as never[];
        },
      },
    });
    return (await mirrorPass(d)).letters;
  };
  assert.equal(await run(1), 0);
  assert.equal(await run(MAX_ATTEMPTS - 1), 1);
});

test('★ before migration 0071 the pass waits, touching nothing', async () => {
  const d = deps({ db: { query: async (sql: string) => { if (sql.includes('insert')) throw new Error('wrote'); return [] as never[]; } } });
  assert.equal((await mirrorPass(d)).stored, 0);
  assert.ok(d.logged.some(([m]) => m.includes('0071')));
});

test('the launchpad stops being asked this pass after it fails in a row', async () => {
  let asked = 0;
  let fails = 0;
  let ok = false;
  const isOpen = () => ok || fails < 3;
  const result = (good: boolean) => { if (good) ok = true; else fails += 1; };
  const d = deps({ metadataPicture: async () => null, venuePicture: async () => { asked += 1; throw new Error('blocked'); } });
  for (let i = 0; i < 5; i += 1) await resolveCoin(coin(), d, new Map(), isOpen, result);
  assert.equal(asked, 3);
});
