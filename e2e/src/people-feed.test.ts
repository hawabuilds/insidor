/**
 * THE FEED OF PEOPLE AGAINST THE REAL SCHEMA: every migration applied to an in-process Postgres,
 * seeded people following each other, landed and unlanded trades in `public.trade` as the trade
 * service writes them, and comments made through the social routes themselves.
 *
 * What it holds: only people you follow, only landed buys and sells, only from people who turned
 * on "Show my trades to followers" (on until they turn it off, as Trador's), newest first across trades and comments,
 * twenty a page with no item lost or repeated at the boundary, and People to follow for someone
 * who follows nobody, by counts anyone could make.
 */

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { beforeEach, test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Person } from '@insidor/contracts/ports/people.ts';
import { forgetKept, handle, type Db } from '@insidor/social';

import { migratedDb } from './db.ts';

const P = DEFAULT_POLICY.social;
const MINT = 'FerryHorn1111111111111111111111111111111pump';
const NOW = Date.UTC(2026, 9, 18, 12);

const wallet = (n: number) => `${'B'.repeat(40)}${String(n).padStart(3, '0').replace(/\d/g, (d) => 'abcdefghij'[Number(d)] ?? 'a')}`;
const person = (n: number): Person => ({ userId: `did:privy:${n}`, handle: `user${n}`, name: `User ${n}`, pictureUrl: null, wallets: [{ address: wallet(n), kind: 'embedded' }] });
const tradeId = (s: string) => createHash('sha256').update(s).digest('hex');

async function setup() {
  const db = (await migratedDb()) as unknown as Db;
  const people = new Map<string, Person>();
  const deps = { db, identity: { verify: async (token: string) => people.get(token) ?? null }, chain: null, policy: P, now: () => NOW, pace: () => true };
  const as = (p: Person) => {
    people.set(p.userId, p);
    return async (method: string, url: string, body: unknown = null) => {
      const r = await handle({ method, url, body, token: p.userId, client: 'test' }, deps);
      return { status: r.status, body: JSON.parse(r.body) as Record<string, unknown> };
    };
  };
  /* A trade as the trade service leaves it: one row, settled at `at`. */
  const trade = async (who: number, tag: string, kind: 'buy' | 'sell', status: string, at: string) => {
    await db.query(
      `insert into public.trade (id, wallet, kind, venue, mint, in_amount, out_amount, status, signature, built_at, sent_at, settled_at)
       values ($1, $2, $3, 'curve', $4, $5, $6, $7, $8, $9, $9, case when $7 in ('confirmed', 'failed') then $9::timestamptz else null end)`,
      [tradeId(tag), wallet(who), kind, MINT, kind === 'buy' ? '500000000' : '1000', kind === 'buy' ? '1000' : '250000000', status, `sig${tag}`, at],
    );
  };
  await db.query(`insert into public.asset (chain, address, asset_key, venue_id, minted_at_source, minted_at_conf, symbol, name, origin) values ('solana', $1, $2, 'curve', 'none', 'unknown', 'FERRY', 'Ferry Horn', 'live_stream')`, [MINT, `solana:${MINT}`]);
  /* What the market said of FERRY at `at`: its market cap, the one figure a buy row shows. */
  const reading = async (at: string, cap: number) => {
    await db.query(
      `insert into public.market_reading (chain, address, asset_key, venue_id, taken_at, price_absent, market_cap_usd, market_cap_basis, liquidity_absent, price_change_24h_absent, tradable, source_vendor, source_endpoint)
       values ('solana', $1, $2, 'solana:curve', $3, 'no_market', $4, 'circulating', 'no_market', 'no_market', false, 'test', 'test')`,
      [MINT, `solana:${MINT}`, at, cap],
    );
  };
  return { db, as, trade, reading };
}

type Item = { kind: string; key: string; at: number; person: { userId: string }; side?: string; marketCapUsd?: number | null; outcome?: string | null; coin?: { symbol: string | null }; body?: string };

beforeEach(() => forgetKept());

test('★ the Feed shows the people you follow: their landed trades unless they turned sharing off, and their comments, newest first', async () => {
  const me = person(1);
  const friend = person(2);
  const stranger = person(3);
  const { as, trade, db, reading } = await setup();
  for (const p of [me, friend, stranger]) await as(p)('POST', '/me');
  assert.equal((await as(me)('POST', `/follow/${friend.userId}`)).status, 200);
  /* Three minutes before the friend's buy; the stranger's buy at 11:50 has none within ten minutes. */
  await reading('2026-10-18T09:57:00Z', 48_000);
  await reading('2026-10-18T11:30:00Z', 90_000);

  await trade(2, 'f-buy', 'buy', 'confirmed', '2026-10-18T10:00:00Z');
  await trade(2, 'f-sell', 'sell', 'confirmed', '2026-10-18T11:00:00Z');
  await trade(2, 'f-sent', 'buy', 'sent', '2026-10-18T11:30:00Z');
  await trade(2, 'f-failed', 'buy', 'failed', '2026-10-18T11:40:00Z');
  await trade(3, 's-buy', 'buy', 'confirmed', '2026-10-18T11:50:00Z');
  await as(friend)('POST', '/comments', { subject: `coin:${MINT}`, body: 'FERRY has a horn now' });
  await as(stranger)('POST', '/comments', { subject: `coin:${MINT}`, body: 'not followed' });

  /* On by default, as Trador's: the friend shares until they say otherwise. */
  const mine = await as(friend)('GET', '/me');
  assert.equal(mine.body['tradesPublic'], true, 'on until turned off');
  const theirs = (await as(me)('GET', `/profile/${friend.userId}`)).body['profile'] as { tradesPublic: unknown };
  assert.equal(theirs.tradesPublic, null, "another person's switch is not shown");
  const off = await as(friend)('PUT', '/me', { tradesPublic: false });
  assert.equal(off.body['tradesPublic'], false);
  const before = await as(me)('GET', '/feed');
  assert.equal(before.status, 200);
  assert.deepEqual((before.body['items'] as Item[]).map((i) => i.kind), ['comment'], 'turned off: only the comment, from the person followed');
  assert.equal(before.body['following'], 1);
  await as(friend)('PUT', '/me', { tradesPublic: true });

  const after = (await as(me)('GET', '/feed')).body['items'] as Item[];
  assert.deepEqual(after.map((i) => [i.kind, i.side ?? null]), [['comment', null], ['trade', 'sell'], ['trade', 'buy']], 'newest first; the unlanded and failed trades and the stranger are left out');
  const sell = after[1]!;
  assert.equal(sell.outcome, 'loss', 'sold at 250,000 lamports a unit against an average buy of 500,000: at a loss');
  assert.equal(sell.marketCapUsd, null, 'a sell carries no market cap');
  assert.equal(sell.coin?.symbol, 'FERRY');
  assert.equal(after[2]!.marketCapUsd, 48_000, "a buy's market cap is the reading nearest its landing");
  assert.equal(after[2]!.outcome, null);
  assert.ok(!('quotedLamports' in after[2]!) && !('amount' in after[2]!), 'no amounts, as Trador');

  /* Latest is every comment, as Trador's, and no trades. */
  const latest = (await as(me)('GET', '/feed?tab=latest')).body['items'] as Item[];
  assert.deepEqual(latest.map((i) => i.body), ['not followed', 'FERRY has a horn now']);

  /* A comment on a narrative carries its title and picture, for its pill. */
  await db.query(`insert into public.story (story_id, earliest_post_at, state, promoted_at, origin) values ('st_ferry', now(), 'promoted', now(), 'observed')`);
  await db.query(`insert into public.story_view (story_id, payload) values ('st_ferry', $1::jsonb)`, [JSON.stringify({ id: 'st_ferry', title: 'The ferry horn', thumbUrl: 'https://example.test/ferry.jpg' })]);
  assert.equal((await as(friend)('POST', '/comments', { subject: 'story:st_ferry', body: 'loud' })).status, 201);
  type On = { kind: string; storyId: string | null; title: string | null; pictureUrl: string | null; video: boolean; site: string | null; author: string | null };
  const top = ((await as(me)('GET', '/feed')).body['items'] as (Item & { on?: On })[])[0]!;
  assert.deepEqual([top.body, top.on?.kind, top.on?.storyId, top.on?.title, top.on?.pictureUrl], ['loud', 'story', 'st_ferry', 'The ferry horn', 'https://example.test/ferry.jpg']);

  /* A comment on a post carries the post's small picture, whether it is a video's cover, its site and its author, from its For You card. */
  await db.query(
    `insert into public.feed_post (feed_id, item_id, first_shown_at, last_shown_at, payload, payload_at) values ('fyp', 'tiktok:77', now(), now(), $1::jsonb, now())`,
    [JSON.stringify({ id: 'tiktok:77', thumbUrl: 'https://example.test/cover.jpg', thumbIsVideo: true, sourceLabel: 'TikTok', authorLabel: '@ferryfan' })],
  );
  await db.query(`insert into people.comment (author_id, subject_kind, subject_id, body) values ($1, 'post', 'tiktok:77', 'that horn')`, [friend.userId]);
  const onPost = ((await as(me)('GET', '/feed')).body['items'] as (Item & { on?: On })[])[0]!;
  assert.deepEqual(onPost.on && [onPost.on.kind, onPost.on.pictureUrl, onPost.on.video, onPost.on.site, onPost.on.author], ['post', 'https://example.test/cover.jpg', true, 'TikTok', '@ferryfan']);

  /* Turned off again, the trades go with it. */
  await as(friend)('PUT', '/me', { tradesPublic: false });
  assert.deepEqual(((await as(me)('GET', '/feed')).body['items'] as Item[]).map((i) => i.kind), ['comment', 'comment', 'comment']);

  assert.equal((await handle({ method: 'GET', url: '/feed', body: null, token: null, client: 't' }, { db: (await setup()).db, identity: { verify: async () => null }, chain: null, policy: P, now: () => NOW, pace: () => true })).status, 401, 'personal: signed in only');
});

test('★ twenty a page, and the pages together are every item once, in order', async () => {
  const me = person(1);
  const friend = person(2);
  const { as, trade } = await setup();
  await as(me)('POST', '/me');
  await as(friend)('POST', '/me');
  await as(me)('POST', `/follow/${friend.userId}`);
  /* Thirty trades, several sharing a second, so the boundary falls inside a tie. */
  for (let n = 0; n < 30; n += 1) await trade(2, `t${n}`, n % 2 === 0 ? 'buy' : 'sell', 'confirmed', `2026-10-18T10:00:${String(Math.floor(n / 3)).padStart(2, '0')}Z`);
  /* Ten comments; the comment window allows ten an hour. */
  for (let n = 0; n < P.commentsPerWindow; n += 1) await as(friend)('POST', '/comments', { subject: `coin:${MINT}`, body: `call ${n}` });

  const seen: Item[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const r = await as(me)('GET', `/feed${cursor === null ? '' : `?cursor=${cursor}`}`);
    const items = r.body['items'] as Item[];
    assert.ok(items.length <= P.feedPageSize);
    seen.push(...items);
    cursor = r.body['cursor'] as string | null;
    pages += 1;
  } while (cursor !== null && pages < 10);
  assert.equal(pages, 2);
  assert.equal(seen.length, 30 + P.commentsPerWindow);
  assert.equal(new Set(seen.map((i) => i.key)).size, seen.length, 'no item twice');
  for (let i = 1; i < seen.length; i += 1) assert.ok(seen[i - 1]!.at >= seen[i]!.at, 'newest first across the page boundary');
});

test('★ someone who follows nobody gets People to follow, by counts anyone could make, and never themselves', async () => {
  const me = person(1);
  const trader = person(2);
  const talker = person(3);
  const quiet = person(4);
  const privateTrader = person(5);
  const { as, trade } = await setup();
  for (const p of [me, trader, talker, quiet, privateTrader]) await as(p)('POST', '/me');
  await as(privateTrader)('PUT', '/me', { tradesPublic: false });
  await as(talker)('PUT', '/me', { tradesPublic: false });
  const recent = new Date(NOW - 3_600_000).toISOString();
  await trade(2, 'a', 'buy', 'confirmed', recent);
  await trade(2, 'b', 'sell', 'confirmed', recent);
  await trade(5, 'c', 'buy', 'confirmed', recent);
  await as(talker)('POST', '/comments', { subject: `coin:${MINT}`, body: 'a take' });

  const empty = await as(me)('GET', '/feed');
  assert.deepEqual(empty.body, { items: [], cursor: null, following: 0 });

  const r = await as(me)('GET', '/feed/people');
  const people = r.body['people'] as { userId: string; tradesThisWeek: number | null; commentsThisWeek: number }[];
  assert.deepEqual(people.map((p) => p.userId), [trader.userId, talker.userId], 'the quiet one, the private trader and me are not suggested');
  assert.equal(people[0]!.tradesThisWeek, 2);
  assert.equal(people[1]!.tradesThisWeek, null, 'a person who does not share trades has no trade count, not zero');
  assert.equal(people[1]!.commentsThisWeek, 1);

  await as(me)('POST', `/follow/${trader.userId}`);
  const after = (await as(me)('GET', '/feed/people')).body['people'] as { userId: string }[];
  assert.ok(!after.some((p) => p.userId === trader.userId), 'someone followed is no longer suggested');
});

test('★ a trade records the market cap when it lands, from a reading at most ten minutes old; none that close is none', async () => {
  const me = person(1);
  const friend = person(2);
  const { as, db, trade, reading } = await setup();
  await as(me)('POST', '/me');
  await as(friend)('POST', '/me');
  await as(me)('POST', `/follow/${friend.userId}`);
  /* Sent now, settled by the trade service's own step. */
  await trade(2, 'live', 'buy', 'sent', new Date().toISOString());
  await reading(new Date(Date.now() - 120_000).toISOString(), 51_500);
  await db.query('select public.record_trade_settled($1, $2, true, null)', [tradeId('live'), `${'5'.repeat(64)}`]);
  const [none] = await db.query<{ cap: number | null }>('select market_cap_usd as cap from public.trade where id = $1', [tradeId('live')]);
  assert.equal(none?.cap ?? null, null, 'a different signature settles nothing');
  await db.query(`update public.trade set signature = $2 where id = $1`, [tradeId('live'), '5'.repeat(64)]);
  await db.query('select public.record_trade_settled($1, $2, true, null)', [tradeId('live'), '5'.repeat(64)]);
  const [row] = await db.query<{ cap: number | null; at: string | null }>('select market_cap_usd as cap, market_cap_at as at from public.trade where id = $1', [tradeId('live')]);
  assert.equal(row?.cap, 51_500);
  assert.ok(row?.at !== null);

  /* A buy with no reading within the window says nothing. */
  await trade(2, 'old', 'buy', 'confirmed', '2026-10-01T10:00:00Z');
  await reading('2026-10-01T10:30:00Z', 70_000);
  const items = (await as(me)('GET', '/feed')).body['items'] as Item[];
  const old = items.find((i) => i.key === `t:${tradeId('old')}`);
  assert.equal(old?.marketCapUsd, null, 'thirty minutes away is not the market cap at the trade');
});

test("★ Top calls ranks every comment by holders' likes, newer first on a tie, this week or all time", async () => {
  const me = person(1);
  const a = person(2);
  const b = person(3);
  const c = person(4);
  const d = person(5);
  const { as, db } = await setup();
  for (const p of [me, a, b, c, d]) await as(p)('POST', '/me');
  const ids: number[] = [];
  for (const [who, body] of [[a, 'one like'], [b, 'three likes'], [a, 'none'], [b, 'one like too']] as const) {
    ids.push(((await as(who)('POST', '/comments', { subject: `coin:${MINT}`, body })).body['comment'] as { id: number }).id);
  }
  /* Likes as the like route leaves them (it checks holders on the chain, which this test has none of). */
  const like = (comment: number, voter: Person) => db.query('insert into people.comment_like (comment_id, voter_id) values ($1, $2)', [comment, voter.userId]);
  await like(ids[0]!, me);
  await like(ids[1]!, me);
  await like(ids[1]!, a);
  await like(ids[1]!, c);
  await like(ids[3]!, a);
  /* An old comment with the most likes: all time only. */
  const [old] = await db.query<{ id: number }>(`insert into people.comment (author_id, subject_kind, subject_id, body, created_at) values ($1, 'coin', $2, 'old call', now() - interval '30 days') returning comment_id::int as id`, [a.userId, MINT]);
  for (const v of [me, b, c, d]) await like(old!.id, v);

  const week = (await as(me)('GET', '/feed?tab=top')).body['items'] as (Item & { likes: number })[];
  assert.deepEqual(week.map((i) => [i.body, i.likes]), [['three likes', 3], ['one like too', 1], ['one like', 1], ['none', 0]]);
  const all = (await as(me)('GET', '/feed?tab=top&window=all')).body['items'] as (Item & { likes: number })[];
  assert.equal(all[0]?.body, 'old call');
  assert.ok(all.every((i) => i.kind === 'comment'), 'Top calls is comments only');
});
