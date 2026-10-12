/**
 * ★ THE COIN UNIVERSE, END TO END: new coins' metadata read by content id, and their origins
 * checked — free steps settled on a dry run, paid steps priced and not sent; and live, a coin
 * matched to its post on picture plus name plus timing, a same-name coin with a different
 * picture left unlinked, and a post after launch called what it is.
 *
 * Real schema (PGlite), the real pass. The gateway, the source, the judge and the embedder are
 * stand-ins answering from tables; nothing opens a socket.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Item, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import type { EmbedPort } from '@insidor/contracts/ports/embed.ts';
import type { JudgePort } from '@insidor/contracts/ports/judge.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Logger } from '@insidor/runner/src/log.ts';
import { storeArrivals } from '@insidor/runner/src/work/arrivals.ts';
import { universePass, type UniverseDeps } from '@insidor/runner/src/work/universe.ts';
import { PgAuthorRepo, PgCoinUniverseRepo, PgImageEmbeddingRepo, PgItemRepo, PgObservationRepo, PgPostJudgementRepo } from '@insidor/store';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const NOW = Date.now() as Millis;
const MIN = 60_000;
const H = 3_600_000;
const P = DEFAULT_POLICY;
const X = sourceId('x');
const SPACE = P.group.image.space;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const openMeter = { record: () => undefined, spentUsd: () => 0, mayspend: () => true, line: () => ({ capUsd: 21, spentUsd: 0, stopAtUsd: 21, remainingUsd: 21, unrecordedUsd: 0 }) } as unknown as Meter;

let db: Db;
const calls = { lookup: 0, judge: 0, embed: 0 };

/** Each coin: its address, launch, and the metadata document its content id resolves to. */
const COINS = {
  trout: { launched: NOW - 2 * H, doc: { name: 'Big Trout', symbol: 'TROUT', image: 'trout', twitter: null } },
  troutTwin: { launched: NOW - 2 * H, doc: { name: 'Big Trout', symbol: 'TROUT2', image: 'other-fish', twitter: null } },
  late: { launched: NOW - 6 * H, doc: { name: 'Sleepy Otter', symbol: 'OTTER', image: 'otter', twitter: null } },
  promo: { launched: NOW - 2 * H, doc: { name: 'Promo Cat', symbol: 'PCAT', image: null, twitter: 'https://x.test/status/LATE' } },
  linked: { launched: NOW - 2 * H, doc: { name: 'Linked Dog', symbol: 'LDOG', image: null, twitter: 'https://x.test/status/EARLY' } },
  offChain: { launched: NOW - 2 * H, doc: null },
} as const;
type Name = keyof typeof COINS;
const address = (n: Name) => `${n}1111111111111111111111111111111111pump`.slice(0, 44);
const cid = (n: Name) => `bafy${n.toLowerCase()}${'a'.repeat(60)}`.slice(0, 59);

/** A picture's vector: each picture on its own axis, so only the same picture is alike. */
const AXES = ['trout', 'otter', 'salmon', 'other-fish'];
function vectorFor(uri: string): Float32Array {
  const v = new Float32Array(1024);
  const axis = AXES.findIndex((a) => uri.includes(a));
  v[axis < 0 ? AXES.length : axis] = 1;
  return v;
}

function post(n: number, text: string, picture: string | null, postedAt: number): Item {
  return {
    itemId: itemId(X, `${n}`), source: X, sourceItemId: `${n}`, origin: 'observed', authorKey: authorKey(X, `a${n}`),
    postedAt: postedAt as Millis, firstSeenAt: NOW, lang: 'en', text,
    media: picture === null ? [] : [{ kind: 'image', uri: `https://img.invalid/${picture}.jpg`, width: 1200, height: 675, durationMs: null }],
    counters: { reach: { value: 500_000, observedAt: NOW, fidelity: { kind: 'exact' } } }, fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: `x/${n}`,
  };
}

/* The source: recognises `x.test/status/<id>` links; EARLY was posted before the coin, LATE after. */
const POSTED = { EARLY: NOW - 5 * H, LATE: NOW - H };
const source = {
  id: X,
  capabilities: { discovery: ['keyword'] },
  parseLink: (url: string) => {
    const id = /x\.test\/status\/(\w+)/.exec(url)?.[1];
    return id === undefined ? null : { kind: 'post' as const, sourceItemId: id };
  },
  postTimeFromId: (id: string) => (POSTED as Record<string, number>)[id] ?? null,
  estimate: () => ({ vendor: 'x', endpoint: 'lookup', unit: 'per-item-returned', estUnits: 1, usd: 0.000_15 }),
  lookup: async (ids: readonly string[]) => {
    calls.lookup += 1;
    const items = ids.map((id) => ({ ...post(900, 'my dog doing the thing', null, (POSTED as Record<string, number>)[id] ?? NOW), itemId: itemId(X, id), sourceItemId: id }));
    return { value: { items, authors: [], cursor: null, hasMore: false }, spend: { usd: 0.000_15 } };
  },
} as unknown as PlatformAdapter;

const judge = {
  id: 'judge:test',
  estimate: () => ({ vendor: 'anthropic', endpoint: 'judge', unit: 'per-call', estUnits: 1, usd: 0.001 }),
  judge: async () => {
    calls.judge += 1;
    return { value: [{ kind: 'judged', judgement: { judgeId: 'judge:test', promptId: 'p', judgedAt: NOW, coinable: true, confidence: 0.9, lookedAt: 'text', proposedName: 'Linked Dog', alternateNames: [], subjectSpans: [], rationaleRef: null, costUsd: 0.001 } }], spend: { usd: 0.001 } };
  },
} as unknown as JudgePort;

const embed = {
  id: 'embed:voyage/test',
  space: SPACE,
  dimensions: 1024,
  maxBatch: 32,
  embedText: async () => ({ value: [], spend: { usd: 0 } }),
  embedMedia: async (media: readonly { uri: string }[]) => {
    calls.embed += 1;
    return { value: media.map((m) => ({ space: SPACE, dimensions: 1024, values: vectorFor(m.uri) })), spend: { usd: 0.000_2 } };
  },
} as unknown as EmbedPort;

function deps(mode: 'dry' | 'live'): UniverseDeps {
  const items = new PgItemRepo(db);
  return {
    coins: new PgCoinUniverseRepo(db),
    metadata: {
      read: async (uri) => {
        const name = (Object.keys(COINS) as Name[]).find((n) => uri !== null && uri.includes(cid(n)));
        const doc = name === undefined ? null : COINS[name].doc;
        if (name === undefined || doc === null) return { kind: 'notContentAddressed' };
        return {
          kind: 'read',
          cid: cid(name),
          metadata: { name: doc.name, ticker: doc.symbol, description: null, imageUri: doc.image === null ? null : `https://gateway.invalid/ipfs/${doc.image}`, links: { social: doc.twitter, website: null, chat: null } },
        };
      },
    },
    platforms: { all: () => [source] },
    items,
    authors: new PgAuthorRepo(db),
    postScores: new PgPostJudgementRepo(db),
    images: new PgImageEmbeddingRepo(db),
    store: storeArrivals({ authors: new PgAuthorRepo(db), items, observations: new PgObservationRepo(db) }, P, () => NOW),
    postJudge: judge,
    embed,
    pairs: null,
    meter: openMeter,
    mode,
    policy: P,
    log: quiet,
    now: () => NOW,
  };
}

const origin = async (n: Name) =>
  (await db.query<{ status: string; post_item_id: string | null; post_offset_ms: string | null; why: string }>(`select status, post_item_id, post_offset_ms, why from internal.coin_origin where asset_key = $1`, [`solana:${address(n)}`]))[0];

before(async () => {
  db = await migratedDb();
  for (const n of Object.keys(COINS) as Name[]) {
    const c = COINS[n];
    await db.query(
      `insert into public.asset (chain, address, asset_key, venue_id, minted_at, minted_at_source, minted_at_conf, minted_at_bound_s, symbol, name, declared_social, first_seen_at, origin)
       values ('solana', $1, $2, 'solana:pump', $3, 'vendor_field', 'bounded', 5, $4, $5, $6::jsonb, $3, 'live_stream')`,
      [address(n), `solana:${address(n)}`, new Date(c.launched), c.doc?.symbol ?? 'OFF', c.doc?.name ?? 'Off Chain', JSON.stringify({ metadata: c.doc === null ? 'https://brand-new.example/m.json' : `https://ipfs.io/ipfs/${cid(n)}` })],
    );
  }
  /* What we already hold: the trout picture three hours before the trout coin; the otter
     an hour AFTER the otter coin; and a post that names the trout with a different picture. */
  const held = [
    post(1, 'a BIG TROUT in the river this morning', 'trout', NOW - 3 * H),
    post(2, 'big trout energy today', 'salmon', NOW - 4 * H),
    post(3, 'sleepy otter is the mood', 'otter', NOW - 5 * H),
  ];
  await new PgItemRepo(db).upsert(held);
  const images = new PgImageEmbeddingRepo(db);
  for (const p of held) {
    const uri = p.media[0]?.uri;
    if (uri !== undefined) await images.record('item', p.itemId, uri, SPACE, vectorFor(uri), NOW);
  }
});

test('★ a dry run reads metadata (free), settles what is free, and prices the rest without sending it', async () => {
  const result = await universePass(deps('dry'));
  assert.deepEqual([calls.lookup, calls.judge, calls.embed], [0, 0, 0], 'nothing paid was sent');

  const meta = await db.query<{ asset_key: string; outcome: string }>(`select asset_key, outcome from internal.coin_metadata order by asset_key`);
  assert.equal(meta.find((m) => m.asset_key.includes('offChain'))?.outcome, 'not_content_addressed', 'a link that names no content id is never fetched');
  assert.equal(meta.filter((m) => m.outcome === 'read').length, 5);

  assert.equal((await origin('promo'))?.status, 'promo_only', 'the linked post\'s id says it came after the coin: settled for free');
  const linked = await origin('linked');
  assert.equal(linked?.status, 'not_checked_yet');
  assert.match(linked?.why ?? '', /dry run: reading the linked post would cost \$/);
  assert.equal((await origin('trout'))?.status, 'not_checked_yet', 'its picture would need embedding');
  assert.ok(result.usd > 0, 'and the pass says what the paid steps would have cost');
});

test('★ live: a coin matches its post on picture plus name plus timing; a same-name coin with a different picture stays unlinked', async () => {
  await universePass(deps('live'));
  const trout = await origin('trout');
  assert.equal(trout?.status, 'matched_by_insidor');
  assert.equal(trout?.post_item_id, 'x:1');
  assert.equal(Number(trout?.post_offset_ms), -H, 'posted an hour before the coin');
  assert.equal((await origin('troutTwin'))?.status, 'unlinked', 'never a link on a name alone');
});

test('★ live: a matching post made after the coin is viral after launch, never the origin', async () => {
  const late = await origin('late');
  assert.equal(late?.status, 'viral_after_launch');
  assert.equal(Number(late?.post_offset_ms), H, 'posted an hour after the coin');
});

test('live: the creator\'s post, read once and judged once, is linked by the creator', async () => {
  const linked = await origin('linked');
  assert.equal(linked?.status, 'linked_by_creator');
  assert.equal(linked?.post_item_id, 'x:EARLY');
  assert.equal(calls.lookup, 1, 'read once');
  assert.ok((await new PgItemRepo(db).byIds([itemId(X, 'EARLY')])).has(itemId(X, 'EARLY')), 'and stored, so the next coin linking it costs nothing');
});
