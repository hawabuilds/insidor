/**
 * The post-picture copier with a stand-in database and storage: a shown picture is copied once
 * whatever its signature, an expired link is recorded and never fetched, what expires first goes
 * first, the per-pass and per-day caps hold, a refusal waits for a new link or the retry, and
 * before migration 0119 nothing is fetched at all.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { COPIED_TODAY_SQL, expiresAtMs, linkPath, planPictures, postPicFile, postPicPass, RECORD_EXPIRED_SQL, RECORD_PICTURE_SQL, SHOWN_PICTURES_SQL, type PostPicDeps, type ShownRow } from './post-pics.ts';

const NOW = 1_792_300_000_000;
const tiktok = (id: string, expiresS: number, sig = 'a') => `https://p16-sign.example/obj/${id}~tplv-cover.jpeg?x-expires=${expiresS}&x-signature=${sig}`;
const x = (id: string) => `https://pbs.example/media/${id}.jpg`;
const row = (link: string, surface = 1, tried: string | null = null, triedAt: number | null = null): ShownRow => ({ link, surface, tried_link: tried, tried_at: triedAt === null ? null : new Date(triedAt) });
const RETRY = DEFAULT_POLICY.postPictures.retryAfterMs;

test('★ the path and the name ignore the signature; a new picture is a new name', () => {
  const a = tiktok('abc', 1, 'a');
  const b = tiktok('abc', 2, 'b');
  assert.equal(linkPath(a), linkPath(b));
  assert.equal(postPicFile(linkPath(a)), postPicFile(linkPath(b)));
  assert.match(postPicFile(linkPath(a)), /^[0-9a-f]{32}$/);
  assert.notEqual(postPicFile(linkPath(a)), postPicFile(linkPath(tiktok('new', 1))));
  assert.equal(expiresAtMs(a), 1000);
  assert.equal(expiresAtMs(x('m')), null, 'a link that does not say never expires');
});

test('★ a link already expired when first seen is recorded, not fetched; one that still loads is due', () => {
  const plan = planPictures([row(tiktok('old', NOW / 1000 - 10)), row(tiktok('fresh', NOW / 1000 + 3_600))], NOW, RETRY);
  assert.deepEqual(plan.expired.map((e) => e.path), [linkPath(tiktok('old', 0))]);
  assert.deepEqual(plan.due.map((d) => d.path), [linkPath(tiktok('fresh', 0))]);
});

test('of one picture\'s several links, the one that loads longest is taken', () => {
  const stale = tiktok('p', NOW / 1000 - 10, 'old');
  const fresh = tiktok('p', NOW / 1000 + 7_200, 'new');
  const plan = planPictures([row(stale, 1), row(fresh, 2)], NOW, RETRY);
  assert.equal(plan.due.length, 1);
  assert.equal(plan.due[0]?.link, fresh);
  assert.equal(plan.due[0]?.surface, 1, 'the picture keeps its most urgent surface');
});

test('★ For You first, then what expires soonest, then links that never expire', () => {
  const plan = planPictures(
    [row(x('scroll-x'), 1), row(tiktok('scroll-late', NOW / 1000 + 80_000), 1), row(tiktok('scroll-soon', NOW / 1000 + 600), 1), row(x('fyp'), 0), row(x('story'), 2)],
    NOW,
    RETRY,
  );
  assert.deepEqual(plan.due.map((d) => d.path.split('/').pop()?.split('~')[0]), ['fyp.jpg', 'scroll-soon', 'scroll-late', 'scroll-x.jpg', 'story.jpg']);
});

test('a refused picture waits for a new link or the retry, and is never retried once its link has expired', () => {
  const link = x('r');
  assert.equal(planPictures([row(link, 1, link, NOW - 60_000)], NOW, RETRY).waiting, 1);
  assert.equal(planPictures([row(link, 1, link, NOW - RETRY)], NOW, RETRY).due.length, 1);
  const signed = tiktok('t', NOW / 1000 + 3_600, 'b');
  assert.equal(planPictures([row(signed, 1, tiktok('t', NOW / 1000 - 5, 'a'), NOW - 60_000)], NOW, RETRY).due.length, 1, 'a newer read brought a link that loads');
  const dead = tiktok('t', NOW / 1000 - 5, 'a');
  const plan = planPictures([row(dead, 1, dead, NOW - RETRY * 2)], NOW, RETRY);
  assert.deepEqual([plan.due.length, plan.expired.length, plan.waiting], [0, 0, 1]);
});

function deps(rows: ShownRow[], over: Partial<PostPicDeps> = {}, opts: { migrated?: boolean; today?: number } = {}) {
  const recorded: unknown[][] = [];
  const expired: unknown[][] = [];
  const copied: string[] = [];
  const d: PostPicDeps = {
    db: {
      query: async (sql: string, params?: readonly unknown[]) => {
        if (sql.includes('to_regclass')) return [{ ok: opts.migrated ?? true }] as never[];
        if (sql === SHOWN_PICTURES_SQL) return rows as never[];
        if (sql === COPIED_TODAY_SQL) return [{ n: opts.today ?? 0 }] as never[];
        if (sql === RECORD_PICTURE_SQL) recorded.push([...(params ?? [])]);
        if (sql === RECORD_EXPIRED_SQL) expired.push([...(params ?? [])]);
        return [] as never[];
      },
    },
    policy: DEFAULT_POLICY.postPictures,
    nowMs: NOW,
    elapsedMs: () => 0,
    copy: async (file) => void copied.push(file),
    log: () => {},
    ...over,
  };
  return { d, recorded, expired, copied };
}

test('a due picture is copied and recorded with its name; an expired one recorded without a fetch', async () => {
  const fresh = tiktok('f', NOW / 1000 + 3_600);
  const old = tiktok('o', NOW / 1000 - 3_600);
  const { d, recorded, expired, copied } = deps([row(fresh), row(old)]);
  const r = await postPicPass(d);
  assert.deepEqual([r.copied, r.expired, r.left, r.today], [1, 1, 0, 1]);
  assert.deepEqual(copied, [postPicFile(linkPath(fresh))]);
  assert.deepEqual(recorded, [[linkPath(fresh), postPicFile(linkPath(fresh)), fresh]]);
  assert.deepEqual(expired, [[[linkPath(old)], [old]]]);
});

test('★ a refusal is recorded with no name, so a copy already there is kept', async () => {
  const { d, recorded } = deps([row(x('h'))], {
    copy: async () => {
      throw new Error('not a PNG, JPEG, WebP or GIF');
    },
  });
  assert.equal((await postPicPass(d)).refused, 1);
  assert.deepEqual(recorded, [[linkPath(x('h')), null, x('h')]]);
});

test('★ the per-pass and per-day caps hold', async () => {
  const many = Array.from({ length: 100 }, (_, i) => row(x(`m${i}`)));
  const perPass = deps(many);
  assert.equal((await postPicPass(perPass.d)).copied, DEFAULT_POLICY.postPictures.perPass);
  const nearDay = deps(many, {}, { today: DEFAULT_POLICY.postPictures.perDay - 3 });
  const r = await postPicPass(nearDay.d);
  assert.deepEqual([r.copied, r.today], [3, DEFAULT_POLICY.postPictures.perDay]);
  const full = deps(many, {}, { today: DEFAULT_POLICY.postPictures.perDay });
  assert.equal((await postPicPass(full.d)).copied, 0);
});

test('no new picture is started after the pass budget', async () => {
  const { d, copied } = deps([row(x('a')), row(x('b'))], { elapsedMs: () => DEFAULT_POLICY.postPictures.budgetMs + 1 });
  assert.equal((await postPicPass(d)).left, 2);
  assert.deepEqual(copied, []);
});

test('before migration 0119, or with the policy off, nothing is fetched', async () => {
  const before = deps([row(x('a'))], {}, { migrated: false });
  assert.equal((await postPicPass(before.d)).copied, 0);
  assert.deepEqual(before.copied, []);
  const off = deps([row(x('a'))], { policy: { ...DEFAULT_POLICY.postPictures, on: false } });
  assert.equal((await postPicPass(off.d)).copied, 0);
  assert.deepEqual(off.copied, []);
});
