/**
 * `node --env-file=.env.local --experimental-strip-types tools/notify-test.ts [--dry]`
 *
 * ONE OF EACH NOTIFICATION, TO THE OWNER'S OWN PHONE (the owner, 2026-10-14: "send me one of each
 * type to my phone and tell me when to check"). Each one is built the way the alert service builds
 * it — the same facts, words, pictures and link (services/notify) — from what is on the feed right
 * now: the newest For You post, a For You post with a coin, a coin that links a post, a post on a
 * story with a coin, and a watched post's coin found and launched. Then the test line.
 *
 * ★ STRAIGHT TO THE PHONE, PAST THE HOURLY LIMIT AND QUIET HOURS, ON PURPOSE. This is the owner
 * asking to see each one now; the deliverer's rules are for alerts nobody asked for. Each one is
 * also written to his Notifications list (people.alert, delivery as it went), so tapping it there
 * goes to the same place — the same rule as every real one. Its subject starts `sample:` so it can
 * never spend the claim a real alert of the same post would need.
 *
 * ★ WHAT THE PUSH SERVICE SAID IS PRINTED for each device: its host and status (201 taken, 403 a
 * key it refused, 404/410 gone), never the device's address, never a key.
 *
 * A kind with nothing on the feed to show it (no proven coin right now, say) is said and skipped,
 * never made up. `--dry` prints what would be sent and sends nothing.
 *
 * Needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT — the notify service's own keys (in
 * .env.local they are the same pair; `railway run --service notify` works too) — and DATABASE_URL.
 * Free: web push costs nothing; the one market read is the free quote endpoint.
 */

import process from 'node:process';

import { webPushSender } from '../adapters/push/webpush/src/index.ts';
import { dexscreenerQuotes } from '../adapters/market/dexscreener/src/tokens.ts';
import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import type { AlertKind } from '../core/src/notify/alerts.ts';
import { coinFacts } from '../services/notify/src/coin-facts.ts';
import { picturesOf, type Db } from '../services/notify/src/deliver.ts';
import { devicesOf, sendToDevices, type Answer } from '../services/notify/src/devices.ts';
import { posterPictures } from '../services/notify/src/faces.ts';
import { fypCoinEvents, fypCoinProposals, newRising, tokenHref, type RisingRow } from '../services/notify/src/pipeline.ts';
import { lineCoin } from '../services/notify/src/post-watch.ts';
import { alertText } from '../services/notify/src/text.ts';
import { connect } from './lib/pgclient.mjs';

const P = DEFAULT_POLICY.notify;
const dry = process.argv.includes('--dry');
const env = (k: string): string | null => {
  const v = process.env[k]?.trim();
  return v === undefined || v === '' ? null : v;
};

const client = await connect();
const db: Db = { query: async <R>(sql: string, params?: readonly unknown[]) => (await client.query(sql, params as unknown[])).rows as R[] };

const answers = new Map<string, Answer>();
const push = webPushSender({ publicKey: env('VAPID_PUBLIC_KEY'), privateKey: env('VAPID_PRIVATE_KEY'), subject: env('VAPID_SUBJECT') ?? 'mailto:alerts@insidor.app' }, undefined, (r) => {
  answers.set(r.endpoint, { status: r.status, reason: r.reason, host: r.host });
});
const dex = dexscreenerQuotes({ baseUrl: 'https://api.dexscreener.com', fetch: globalThis.fetch, timeoutMs: 6_000 });
const quotes = async (mints: readonly string[]) => new Map([...(await dex.quotes(mints))].map(([m, q]) => [m, { marketCapUsd: q.marketCapUsd, change: { h24: q.change.h24 } }]));

interface Sample {
  readonly kind: AlertKind;
  readonly subject: string;
  readonly facts: Record<string, unknown>;
  readonly href: string;
}

async function samples(): Promise<{ readonly found: Sample[]; readonly missing: string[] }> {
  const found: Sample[] = [];
  const missing: string[] = [];
  const fyp = await db.query<RisingRow & { postedAt: number | null }>(`select item_id as "itemId", payload from public.rising_row where feed_id = 'fyp' order by (payload -> 'readAt' ->> 'at')::bigint desc nulls last`);
  const all = await db.query<RisingRow>(`select distinct on (item_id) item_id as "itemId", payload from public.rising_row order by item_id, feed_id = 'fyp' desc`);

  /* New on FYP: the newest post, as the pipeline words it. */
  const newest = fyp[0];
  if (newest === undefined) missing.push('New on FYP: For You is empty right now');
  else {
    const [p] = newRising([newest], new Set());
    const pic = (await posterPictures(db, [newest.itemId])).get(newest.itemId);
    if (p !== undefined) found.push({ kind: p.kind, subject: p.subject, facts: { ...p.facts, ...(pic === undefined ? {} : { picture: pic }) }, href: p.href });
  }

  /* The For You coin kinds, from every feed post that has one now (the same events the pipeline makes, as if never seen). */
  const listedRows = await db.query<{ itemId: string; address: string; launchedAfterMs: string | null }>(
    `select distinct on (subject_id) subject_id as "itemId", address, launched_after_ms as "launchedAfterMs" from public.same_name_coin where subject_kind = 'post' and subject_id = any($1::text[]) order by subject_id, position nulls last`,
    [all.map((r) => r.itemId)],
  );
  const listed = new Map(listedRows.map((r) => [r.itemId, { address: r.address, launchedAfterMs: r.launchedAfterMs === null ? null : Number(r.launchedAfterMs) }]));
  const events = fypCoinEvents(all, listed, { coin: new Set(), proven: new Set(), story: new Set() }).events;
  for (const [kind, label] of [['fyp_coin', 'Coin launched or found for this post'], ['fyp_proven', 'Coin links this post'], ['story_post', 'Coin for this story']] as const) {
    /* Prefer one with a market cap the push can say. */
    const pick = events.filter((e) => e.kind === kind);
    const [made] = await fypCoinProposals(db, all, pick.slice(0, 5), { quotes, ownerWallets: DEFAULT_POLICY.owner.wallets }).then((ps) => [...ps].sort((a, b) => (b.facts['mcUsd'] === null ? 0 : 1) - (a.facts['mcUsd'] === null ? 0 : 1)));
    if (made === undefined) missing.push(`${label}: no post on the feeds has one right now`);
    else found.push({ kind: made.kind, subject: made.subject, facts: made.facts, href: made.href });
  }

  /* The watch: a post with a coin on its line, said as "found"; a post whose coin came after it, said as "launched". */
  const withCoin = all.flatMap((r) => {
    const c = lineCoin(r.payload);
    return c === null ? [] : [{ r, c }];
  });
  const facts = await coinFacts(db, quotes, withCoin.map((x) => x.c.address));
  const pictures = await posterPictures(db, withCoin.map((x) => x.r.itemId));
  const watchFacts = (x: (typeof withCoin)[number], found: 'found' | 'launched'): Sample => {
    const coin = facts.get(x.c.address);
    const madeAt = coin?.mintedAtMs ?? x.c.mintedAtMs;
    return {
      kind: 'watch_coin',
      subject: `${x.r.itemId}|${x.c.address}`,
      facts: {
        found,
        symbol: x.c.ticker !== '' ? x.c.ticker : (coin?.symbol ?? ''),
        address: x.c.address,
        author: x.r.payload.authorLabel ?? null,
        excerpt: x.r.payload.excerpt ?? null,
        ageMs: madeAt === null ? null : Date.now() - madeAt,
        mcUsd: coin?.mcUsd ?? x.c.mcUsd,
        change24h: coin?.change24h ?? null,
        image: typeof x.r.payload.thumbUrl === 'string' && x.r.payload.thumbUrl.startsWith('https://') ? x.r.payload.thumbUrl : null,
        logo: coin?.logo ?? x.c.imageUrl,
        ...(pictures.has(x.r.itemId) ? { picture: pictures.get(x.r.itemId) } : {}),
      },
      href: tokenHref(x.c.address),
    };
  };
  const anyCoin = withCoin[0];
  if (anyCoin === undefined) missing.push('Watchlist: coin found: no post on the feeds has a coin right now');
  else found.push(watchFacts(anyCoin, 'found'));
  const after = withCoin.filter((x) => x.c.launchedAfterMs !== null && x.c.launchedAfterMs >= 0).sort((a, b) => (b.c.mintedAtMs ?? 0) - (a.c.mintedAtMs ?? 0))[0];
  if (after === undefined) missing.push('Watchlist: coin launched: no post on the feeds has a coin made after it right now');
  else found.push(watchFacts(after, 'launched'));

  found.push({ kind: 'push_test', subject: 'test', facts: {}, href: '/#/feed/notifications' });
  return { found, missing };
}

const owners = await db.query<{ userId: string; name: string | null }>('select user_id as "userId", name from people.profile where wallet = any($1::text[])', [[...DEFAULT_POLICY.owner.wallets]]);
if (owners.length === 0) {
  console.log('No profile is signed in with the owner wallet yet. Sign in on the phone first.');
  await client.end();
  process.exit(1);
}
if (!push.configured) {
  console.log('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set here: run with --env-file=.env.local or `railway run --service notify`.');
  await client.end();
  process.exit(1);
}

const { found, missing } = await samples();
const stamp = Date.now();
console.log('What is sent (title, body, where a tap opens, the pictures):');
for (const s of found) {
  const text = alertText(s.kind, s.facts);
  const pics = picturesOf(s.kind, s.facts);
  console.log(`\n  ${s.kind}  →  ${s.href}\n    ${text.title}\n    ${text.body}\n    image ${pics.image === null ? 'none' : 'yes'}, icon ${pics.icon === null ? 'none' : 'yes'}`);
}
for (const m of missing) console.log(`\n  skipped  ${m}`);
let anyDevice = false;
for (const owner of owners) {
  const devices = await devicesOf(db, owner.userId);
  console.log(`\n${owner.name ?? owner.userId}: ${devices.length} device${devices.length === 1 ? '' : 's'} saved`);
  if (devices.length === 0) continue;
  anyDevice = true;
  if (dry) continue;
  for (const s of found) {
    const text = alertText(s.kind, s.facts);
    const subject = `sample:${stamp}:${s.subject}`;
    const r = await sendToDevices(db, push, answers, devices, { title: text.title, body: text.body, url: s.href, ...picturesOf(s.kind, s.facts), tag: `${s.kind}:${subject}` }, P.pushTtlS);
    await db.query('insert into people.alert (user_id, kind, subject, rung, title, body, href, facts, delivery) values ($1, $2, $3, 0, $4, $5, $6, $7, $8)', [
      owner.userId, s.kind, subject, text.title, text.body, s.href, JSON.stringify(s.facts), r.sent > 0 ? 'push' : 'refused',
    ]);
    console.log(`  ${s.kind}: pushed to ${r.sent} of ${devices.length}: ${r.answers.map((a) => `${a.host} ${a.status}${a.reason === '' ? '' : ` ${a.reason}`}`).join(', ')}`);
  }
}
if (!anyDevice) console.log('\nNo device is saved for the owner: open Insidor from the Home Screen icon, Notifications, the gear, and turn Feed notifications on. Then run this again.');
await client.end();
