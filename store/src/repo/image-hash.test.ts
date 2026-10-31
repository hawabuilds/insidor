/**
 * `PgImageHashRepo.neighbours` holds the window's coin logos by mint hour and re-reads only the
 * hours whose digest moved: after the first frame an unchanged window costs the digest rows alone,
 * and the answer is the one the single statement over the whole window gave. The newest hours are
 * digested every frame, older ones once their recheck is due; with a hold file the hours outlive
 * the process, as the projector's frames (one process each) need.
 *
 * Against a fake `Db` holding logos in memory and answering the three statements by their text.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { forgetHeldLogos, PgImageHashRepo, toBits } from './image-hash.ts';

const H = 3_600_000;
const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 29, 0, 0, 0);

interface Logo { address: string; at: number; hex: string }

function fakeDb(logos: Logo[], posts: Map<string, string>): { db: Db; logoRows: () => number; digestedHours: () => number[] } {
  let logoRows = 0;
  let digested: number[] = [];
  /* The statements' [lo, hi) ranges: `$1` is the hash version, then each range's two bounds. */
  const rangesOf = (p: readonly unknown[]) => {
    const out: [number, number][] = [];
    for (let i = 1; i + 1 < p.length; i += 2) out.push([new Date(p[i] as string).getTime(), new Date(p[i + 1] as string).getTime()]);
    return out;
  };
  const inRanges = (l: Logo, p: readonly unknown[]) => rangesOf(p).some(([lo, hi]) => l.at >= lo && l.at < hi);
  const hoursOf = (p: readonly unknown[]) =>
    rangesOf(p).flatMap(([lo, hi]) => {
      const out: number[] = [];
      for (let h = lo / H; h < hi / H; h += 1) out.push(h);
      return out;
    });
  const db: Db = {
    query: async <R>(sql: string, params: readonly unknown[] = []): Promise<R[]> => {
      if (sql.includes('from internal.image_hash where uri = any')) {
        return (params[0] as string[]).flatMap((uri) => (posts.has(uri) ? [{ uri, bits: toBits(posts.get(uri)!) }] : [])) as R[];
      }
      if (sql.includes('group by 1')) {
        digested = hoursOf(params);
        const by = new Map<number, string[]>();
        for (const l of logos.filter((x) => inRanges(x, params))) {
          const h = Math.floor(l.at / H);
          by.set(h, [...(by.get(h) ?? []), `${l.address} ${l.at} ${l.hex}`]);
        }
        return [...by].map(([h, xs]) => ({ h: String(h), d: `${xs.length}/${xs.sort().join(',')}` })) as R[];
      }
      if (sql.includes('select a.address, a.minted_at')) {
        const rows = logos.filter((l) => inRanges(l, params)).map((l) => ({ address: l.address, minted_at: new Date(l.at), bits: toBits(l.hex) }));
        logoRows += rows.length;
        return rows as R[];
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
  return { db, logoRows: () => logoRows, digestedHours: () => digested };
}

/** The answer the old single statement gave: every logo in [post − allowance, post + window], nearest first. */
function naive(logos: readonly Logo[], post: { at: number; hex: string }, allowance: number, window: number, maxDistance: number, perPost: number): string[] {
  const bits = (hex: string) => BigInt(`0x${hex}`);
  const dist = (a: string, b: string) => (bits(a) ^ bits(b)).toString(2).split('').filter((c) => c === '1').length;
  return logos
    .filter((l) => l.at >= post.at - allowance && l.at <= post.at + window)
    .map((l) => ({ address: l.address, at: l.at, d: dist(l.hex, post.hex) }))
    .filter((x) => x.d <= maxDistance)
    .sort((a, b) => a.d - b.d || a.at - b.at)
    .slice(0, perPost)
    .map((x) => x.address);
}

const hex = (i: number) => (0x0f0f0f0f00000000n + BigInt(i)).toString(16).padStart(16, '0');

test('a window read again sends only the hours whose logos changed, with the same answer', async () => {
  forgetHeldLogos();
  const logos: Logo[] = Array.from({ length: 600 }, (_, i) => ({ address: `coin${i}`, at: T0 + i * 30_000, hex: hex(i % 7) }));
  const posts = new Map([['pic', hex(0)]]);
  const { db, logoRows } = fakeDb(logos, posts);
  const post = { itemId: 'p1', uri: 'pic', postedAt: (T0 + 2 * H) as Millis };
  /* A day after the window: every hour is old, so each is digested again once its recheck is due. */
  let now = T0 + 24 * H;
  const ask = () => new PgImageHashRepo(db, { file: null, now: () => now }).neighbours([post], H, 2 * H, 3, 50, 'v1');

  const first = await ask();
  assert.deepEqual(first.map((n) => n.address), naive(logos, { at: post.postedAt, hex: hex(0) }, H, 2 * H, 3, 50));
  const afterFirst = logoRows();
  assert.ok(afterFirst > 0);

  /* Nothing changed: no logo row crosses the wire, and a new repo (one per frame) shares the held hours. */
  now += 16 * MIN;
  assert.deepEqual(await ask(), first);
  assert.equal(logoRows(), afterFirst);

  /* A logo hashed into one hour: only that hour's logos are read again, and the answer has it. */
  logos.push({ address: 'late', at: T0 + 2 * H + 1_000, hex: hex(0) });
  now += 16 * MIN;
  const third = await ask();
  assert.deepEqual(third.map((n) => n.address), naive(logos, { at: post.postedAt, hex: hex(0) }, H, 2 * H, 3, 50));
  assert.ok(third.some((n) => n.address === 'late'));
  assert.equal(logoRows() - afterFirst, logos.filter((l) => Math.floor(l.at / H) === Math.floor((T0 + 2 * H) / H)).length);

  /* A logo gone from an hour (its metadata re-read): that hour's digest moves, and it is not served. */
  logos.splice(logos.findIndex((l) => l.address === 'late'), 1);
  now += 16 * MIN;
  assert.ok(!(await ask()).some((n) => n.address === 'late'));
});

test('★ the newest hours are digested every frame, an older one only once its recheck is due', async () => {
  forgetHeldLogos();
  const logos: Logo[] = Array.from({ length: 600 }, (_, i) => ({ address: `coin${i}`, at: T0 + i * 30_000, hex: hex(i % 7) }));
  const { db, digestedHours } = fakeDb(logos, new Map([['pic', hex(0)]]));
  const post = { itemId: 'p1', uri: 'pic', postedAt: (T0 + 2 * H) as Millis };
  /* The window covers hours T0+1h .. T0+4h; "now" is half an hour into its last hour. */
  let now = T0 + 4 * H + 30 * MIN;
  const ask = () => new PgImageHashRepo(db, { file: null, now: () => now }).neighbours([post], H, 2 * H, 3, 50, 'v-hot');
  const h0 = T0 / H;

  await ask();
  assert.deepEqual(digestedHours(), [h0 + 1, h0 + 2, h0 + 3, h0 + 4]);

  /* A minute on: only the hours that ended within the last two are asked about. */
  now += MIN;
  await ask();
  assert.deepEqual(digestedHours(), [h0 + 2, h0 + 3, h0 + 4]);

  /* A logo hashed late into an old hour waits for that hour's recheck, then is found. */
  logos.push({ address: 'late', at: T0 + H + 1_000, hex: hex(0) });
  now += MIN;
  assert.ok(!(await ask()).some((n) => n.address === 'late'));
  now += 15 * MIN;
  assert.ok((await ask()).some((n) => n.address === 'late'));
  assert.deepEqual(digestedHours(), [h0 + 1, h0 + 2, h0 + 3, h0 + 4]);
});

test('★ with a hold file a new process starts from the held hours: no logo row is read again', async () => {
  forgetHeldLogos();
  const dir = mkdtempSync(join(tmpdir(), 'logo-hold-'));
  try {
    const logos: Logo[] = Array.from({ length: 600 }, (_, i) => ({ address: `coin${i}`, at: T0 + i * 30_000, hex: hex(i % 7) }));
    const { db, logoRows } = fakeDb(logos, new Map([['pic', hex(0)]]));
    const post = { itemId: 'p1', uri: 'pic', postedAt: (T0 + 2 * H) as Millis };
    let now = T0 + 24 * H;
    const hold = { file: join(dir, 'hours.json'), now: () => now };
    const first = await new PgImageHashRepo(db, hold).neighbours([post], H, 2 * H, 3, 50, 'v-file');
    const afterFirst = logoRows();
    assert.ok(afterFirst > 0);

    forgetHeldLogos();
    now += MIN;
    assert.deepEqual(await new PgImageHashRepo(db, hold).neighbours([post], H, 2 * H, 3, 50, 'v-file'), first);
    assert.equal(logoRows(), afterFirst);

    /* A file for another hash version is not used. */
    forgetHeldLogos();
    await new PgImageHashRepo(db, hold).neighbours([post], H, 2 * H, 3, 50, 'v-other');
    assert.ok(logoRows() > afterFirst);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
