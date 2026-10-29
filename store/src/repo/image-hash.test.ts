/**
 * `PgImageHashRepo.neighbours` holds the window's coin logos by mint hour and re-reads only the
 * hours whose digest moved: after the first frame an unchanged window costs the digest rows alone,
 * and the answer is the one the single statement over the whole window gave.
 *
 * Against a fake `Db` holding logos in memory and answering the three statements by their text.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { PgImageHashRepo, toBits } from './image-hash.ts';

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 29, 0, 0, 0);

interface Logo { address: string; at: number; hex: string }

function fakeDb(logos: Logo[], posts: Map<string, string>): { db: Db; logoRows: () => number } {
  let logoRows = 0;
  const inRange = (l: Logo, p: readonly unknown[]) => l.at >= new Date(p[0] as string).getTime() && l.at < new Date(p[1] as string).getTime();
  const db: Db = {
    query: async <R>(sql: string, params: readonly unknown[] = []): Promise<R[]> => {
      if (sql.includes('from internal.image_hash where uri = any')) {
        return (params[0] as string[]).flatMap((uri) => (posts.has(uri) ? [{ uri, bits: toBits(posts.get(uri)!) }] : [])) as R[];
      }
      if (sql.includes('group by 1')) {
        const by = new Map<number, string[]>();
        for (const l of logos.filter((x) => inRange(x, params))) {
          const h = Math.floor(l.at / H);
          by.set(h, [...(by.get(h) ?? []), `${l.address} ${l.at} ${l.hex}`]);
        }
        return [...by].map(([h, xs]) => ({ h: String(h), d: `${xs.length}/${xs.sort().join(',')}` })) as R[];
      }
      if (sql.includes('= any($4::bigint[])')) {
        const hours = new Set((params[3] as string[]).map(Number));
        const rows = logos.filter((l) => inRange(l, params) && hours.has(Math.floor(l.at / H))).map((l) => ({ address: l.address, minted_at: new Date(l.at), bits: toBits(l.hex) }));
        logoRows += rows.length;
        return rows as R[];
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
  return { db, logoRows: () => logoRows };
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

test('a window read again sends only the hours whose logos changed, with the same answer', async () => {
  const hex = (i: number) => (0x0f0f0f0f00000000n + BigInt(i)).toString(16).padStart(16, '0');
  const logos: Logo[] = Array.from({ length: 600 }, (_, i) => ({ address: `coin${i}`, at: T0 + i * 30_000, hex: hex(i % 7) }));
  const posts = new Map([['pic', hex(0)]]);
  const { db, logoRows } = fakeDb(logos, posts);
  const post = { itemId: 'p1', uri: 'pic', postedAt: (T0 + 2 * H) as Millis };
  const ask = () => new PgImageHashRepo(db).neighbours([post], H, 2 * H, 3, 50, 'v1');

  const first = await ask();
  assert.deepEqual(first.map((n) => n.address), naive(logos, { at: post.postedAt, hex: hex(0) }, H, 2 * H, 3, 50));
  const afterFirst = logoRows();
  assert.ok(afterFirst > 0);

  /* Nothing changed: no logo row crosses the wire, and a new repo (one per frame) shares the held hours. */
  assert.deepEqual(await ask(), first);
  assert.equal(logoRows(), afterFirst);

  /* A logo hashed into one hour: only that hour's logos are read again, and the answer has it. */
  logos.push({ address: 'late', at: T0 + 2 * H + 1_000, hex: hex(0) });
  const third = await ask();
  assert.deepEqual(third.map((n) => n.address), naive(logos, { at: post.postedAt, hex: hex(0) }, H, 2 * H, 3, 50));
  assert.ok(third.some((n) => n.address === 'late'));
  assert.equal(logoRows() - afterFirst, logos.filter((l) => Math.floor(l.at / H) === Math.floor((T0 + 2 * H) / H)).length);

  /* A logo gone from an hour (its metadata re-read): that hour's digest moves, and it is not served. */
  logos.splice(logos.findIndex((l) => l.address === 'late'), 1);
  assert.ok(!(await ask()).some((n) => n.address === 'late'));
});
