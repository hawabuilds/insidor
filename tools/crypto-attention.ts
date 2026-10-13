/**
 * THE CRYPTO-ATTENTION TEST: does crypto talk under a post tell gold from the owner's "not" posts,
 * and would it rescue gold the judge fails?
 *
 * `SPEND=live node --env-file=.env.local --experimental-strip-types tools/crypto-attention.ts --yes
 *   [--rows=<judge rows json>] [--out=<dir>] [--cap=<usd>]`
 *
 * The posts are the judge-measurement's own (tools/retune.ts `--rows=` output: hand gold, the
 * owner's missed posts, and the held-out live "not" posts, each with the judge's answer). Each
 * text-source post has its replies and quote posts read twice through the adapter's `responses`
 * (Policy.attention's 20 of each), and core `attentionFacts` counts both reads:
 *
 *   any time   the newest responses now. For a weeks-old gold post most of these came AFTER its
 *              coin launched, so this flatters gold and is reported only beside the honest one.
 *   early      responses posted before min(coin launch, post + EARLY_MS): what a live read could
 *              have seen. The coin's launch is the gold sheet's; a post with no known coin (the
 *              missed posts, the "not" posts) is cut at post + EARLY_MS alone.
 *
 * Its own tool because it pays (the learning book, never the live lines) and because it is a
 * one-off measurement: the live step (services/runner/src/work/crypto-attention.ts) stores the
 * facts and decides nothing, and this is where the owner sees whether they should.
 *
 * What breaks if changed carelessly: the judge's pass is read exactly as the retune reads it
 * (eval/src/feed/examples.ts `inFeed`), and "unsure" is the core reason `judge_unsure` — a yes
 * under its bar, not a held kind. Redefining either here would compare the signal with a
 * different judge than the one the owner is choosing beside.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY as P } from '../contracts/src/policy.ts';
import type { Millis } from '../contracts/src/index.ts';
import type { ResponseAsk } from '../contracts/src/ports/responses.ts';
import { attentionFacts, hasCryptoSignal, isShill, othersSignal, type AttentionFacts } from '../core/src/qualify/attention.ts';
import { asDb, createPool, DB_ROLE, PgCryptoAttentionRepo } from '../store/src/index.ts';
import { heldKind } from '../core/src/qualify/kinds.ts';
import { xPlatform, httpClient as xClient, postTimeFromId } from '../adapters/platform/x/src/index.ts';
import { tuning } from '../eval/src/gold/coin-origins.ts';
import { loadEvidence } from '../eval/src/gold/coin-evidence.ts';
import { openSharedMeter } from './lib/shared-meter.ts';

/** A live read sees a post's first hours: it reads when the post clears the bar and an hour later. */
const EARLY_MS = 2 * 3_600_000;
const AFTER_AUDIT = '/tmp/insidor-attention/after-audit';
const W1_ROWS = '/tmp/insidor-attention/w1/rows.json';

interface JudgeRow {
  readonly id: string;
  readonly group: string;
  readonly coinable: boolean | null;
  readonly firstPass: boolean;
  readonly kind: string | null;
  readonly confidence?: number;
  readonly text?: string;
}

type Outcome = 'pass' | 'unsure' | 'no' | 'held' | 'unanswered';

const arg = (name: string): string | null => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const refuse = (why: string): never => {
  console.error(why);
  process.exit(1);
};

/** The judge rows file: the one given, else the newest rows JSON in after-audit/, else w1's. */
function rowsFile(): string {
  const given = arg('rows');
  if (given !== null) return given;
  const own = existsSync(AFTER_AUDIT)
    ? readdirSync(AFTER_AUDIT).filter((f) => f.endsWith('.json') && !f.startsWith('crypto-signal')).map((f) => `${AFTER_AUDIT}/${f}`)
    : [];
  const rows = own.filter((f) => {
    try {
      const j = JSON.parse(readFileSync(f, 'utf8')) as unknown;
      return Array.isArray(j) && j.length > 0 && typeof (j[0] as { firstPass?: unknown }).firstPass === 'boolean';
    } catch {
      return false;
    }
  });
  return rows.at(-1) ?? W1_ROWS;
}

function outcome(r: JudgeRow): Outcome {
  if (r.coinable === null) return 'unanswered';
  if (heldKind(r.kind, P.judge.heldKinds) !== null && r.firstPass) return 'held';
  if (r.firstPass) return 'pass';
  return r.coinable === true && heldKind(r.kind, P.judge.heldKinds) === null ? 'unsure' : 'no';
}

interface Target {
  readonly id: string;
  readonly group: 'gold' | 'missed' | 'live-not';
  readonly postId: string | null;
  readonly why: string | null;
  readonly postedAt: number | null;
  readonly launchedAt: number | null;
  readonly judge: Outcome;
  readonly text: string;
}

function targets(rows: readonly JudgeRow[]): Target[] {
  const evidence = loadEvidence();
  const cases = new Map(tuning().map((c) => [c.id, c] as const));
  const out: Target[] = [];
  for (const r of rows) {
    if (r.group !== 'gold' && r.group !== 'missed' && r.group !== 'live-not') continue;
    const base = { id: r.id, group: r.group, judge: outcome(r), text: (r.text ?? '').slice(0, 100) } as const;
    if (r.id.startsWith('x:')) {
      const postId = r.id.slice(2);
      out.push({ ...base, postId, why: null, postedAt: postTimeFromId(postId), launchedAt: null });
      continue;
    }
    if (!r.id.startsWith('bt')) {
      out.push({ ...base, postId: null, why: `not a text-source post (${r.id.split(':')[0]})`, postedAt: null, launchedAt: null });
      continue;
    }
    const c = cases.get(r.id);
    const post = evidence.get(r.id)?.origin?.post ?? null;
    const platform = c === undefined || c.origin.kind === 'none' ? null : c.origin.platform;
    const launchedAt = c === undefined ? null : Date.parse(c.createdAt);
    if (post === null || platform !== 'x') {
      out.push({ ...base, postId: null, why: platform === null ? 'no origin post' : `origin on ${platform}`, postedAt: post?.postedAt ?? null, launchedAt: Number.isNaN(launchedAt) ? null : launchedAt });
      continue;
    }
    out.push({ ...base, postId: post.postId, why: null, postedAt: post.postedAt ?? postTimeFromId(post.postId), launchedAt: Number.isNaN(launchedAt) ? null : launchedAt });
  }
  return out;
}

const summary = (f: AttentionFacts) => ({
  replies: f.repliesRead,
  quotes: f.reproductionsRead,
  cut: f.repliesCut || f.reproductionsCut,
  cashtags: f.cashtags,
  coinWords: f.coinWordResponses,
  ca: f.caMentions,
  addresses: f.addresses,
  cryptoQuoters: f.cryptoReproducers,
  cryptoRepliers: f.cryptoRepliers,
  firstSignalAt: f.firstSignalAt === null ? null : new Date(f.firstSignalAt).toISOString(),
  signal: hasCryptoSignal(f),
  broad: hasCryptoSignal(f) || f.coinWordResponses > 0 || f.cryptoRepliers > 0,
});

async function main(): Promise<void> {
  if (process.env['SPEND'] !== 'live' || !process.argv.includes('--yes')) refuse('This test spends money: SPEND=live and --yes.');
  const apiKey = process.env['X_API_KEY'] ?? '';
  if (apiKey === '') refuse('X_API_KEY is not set.');
  const cap = Number(arg('cap') ?? '0.79');
  const outDir = arg('out') ?? AFTER_AUDIT;
  const file = rowsFile();
  const rows = JSON.parse(readFileSync(file, 'utf8')) as JudgeRow[];
  const list = targets(rows);
  console.log(`judge rows: ${file}; posts: ${list.length}, readable: ${list.filter((t) => t.postId !== null).length}`);

  const shared = await openSharedMeter(cap, process.env, 'learning');
  const x = xPlatform({ client: xClient({ apiKey, baseUrl: process.env['X_API_BASE'] ?? 'https://api.twitterapi.io', fetch: globalThis.fetch }), meter: shared.meter, now: () => Date.now() as Millis });
  const budget = { capUsd: cap, spentUsd: 0, maxCalls: null, deadline: (Date.now() + 3_600_000) as Millis };
  const ask = (untilMs: number | null): ResponseAsk => ({ maxReplies: P.attention.repliesPerPost, maxReproductions: P.attention.reproductionsPerPost, untilMs: untilMs as Millis | null });

  const results = new Map<string, { early: AttentionFacts | null; any: AttentionFacts | null; earlyCut: number | null; error: string | null }>();
  const read = async (t: Target, which: 'early' | 'any') => {
    if (t.postId === null) return;
    const slot = results.get(t.id) ?? { early: null, any: null, earlyCut: null, error: null };
    results.set(t.id, slot);
    const earlyCut = t.postedAt === null ? t.launchedAt : Math.min(t.launchedAt ?? Number.POSITIVE_INFINITY, t.postedAt + EARLY_MS);
    if (which === 'early') slot.earlyCut = earlyCut;
    if (which === 'early' && earlyCut === null) return;
    try {
      const got = await x.responses!(t.postId, ask(which === 'early' ? earlyCut : null), budget);
      slot[which] = attentionFacts(got.value, P.attention);
    } catch (e) {
      slot.error = `${which}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
    }
  };
  /* Most telling first, so a cap that binds cuts the least telling: the early reads, then the
     any-time reads; gold and missed before the "not" posts in each. Four at a time. */
  const byGroup = [...list.filter((t) => t.group !== 'live-not'), ...list.filter((t) => t.group === 'live-not')];
  const jobs = [...byGroup.map((t) => () => read(t, 'early')), ...byGroup.map((t) => () => read(t, 'any'))];
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < jobs.length) await jobs[next++]!();
    }),
  );
  const spent = shared.meter.spentUsd();
  await shared.close();

  const perPost = list.map((t) => {
    const r = results.get(t.id);
    return {
      id: t.id,
      group: t.group,
      postId: t.postId,
      skipped: t.why,
      judge: t.judge,
      postedAt: t.postedAt === null ? null : new Date(t.postedAt).toISOString(),
      coinLaunchedAt: t.launchedAt === null ? null : new Date(t.launchedAt).toISOString(),
      earlyCutAt: r?.earlyCut == null ? null : new Date(r.earlyCut).toISOString(),
      /* The earliest strict-signal response of the any-time read came before the coin launched. */
      anyFirstSignalBeforeLaunch: r?.any?.firstSignalAt == null || t.launchedAt === null ? null : r.any.firstSignalAt < t.launchedAt,
      early: r?.early == null ? null : summary(r.early),
      any: r?.any == null ? null : summary(r.any),
      error: r?.error ?? null,
      text: t.text,
    };
  });
  writeFileSync(`${outDir}/crypto-signal-rows.json`, JSON.stringify({ judgeRows: file, spentUsd: spent, earlyMs: EARLY_MS, heldKinds: P.judge.heldKinds, posts: perPost }, null, 1));
  console.log(`spent $${spent.toFixed(4)} on the learning book; rows at ${outDir}/crypto-signal-rows.json`);
}

/* ── --store: the re-read with the author split, for the re-measure (2026-10-13) ─────────────── */

const EXPERIMENT_ROWS = `${AFTER_AUDIT}/judge-experiments-rows.json`;
/* The owner's newest "not a meme" taps not in the rows file, newest first, at most this many. */
const MORE_TAPS = 60;

interface StorePost {
  readonly id: string;
  readonly group: string;
  readonly postId: string;
  readonly text: string | null;
  readonly authorId: string | null;
  readonly authorHandle: string | null;
  readonly postedAt: number | null;
  readonly launchedAt: number | null;
}

/**
 * `--store`: every post of the judge-experiment rows plus the owner's newer "not" taps, read
 * once with the early cut (before the coin launched, or within EARLY_MS of the post), split into
 * the author's own coin talk and other accounts', and stored in internal.crypto_attention under the
 * row's own id, marked `test` so the live step neither counts nor skips on it. On the LIVE posts
 * line, as the owner asked. Writes `crypto-facts-ready` with the count when done.
 */
async function store(): Promise<void> {
  const cap = Number(arg('cap') ?? '0.90');
  const rows = JSON.parse(readFileSync(arg('rows') ?? EXPERIMENT_ROWS, 'utf8')) as { id: string; group: string; text?: string }[];
  const url = process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'];
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: url }, applicationName: 'insidor-crypto-test' });
  const db = asDb(pool);
  const inFile = new Set(rows.map((r) => r.id));
  const taps = await db.query<{ item_id: string }>(
    `select item_id from (select distinct on (item_id) item_id, verdict, created_at from internal.owner_feedback
        where subject_kind = 'post' and item_id like 'x:%' order by item_id, created_at desc, id desc) t
      where verdict = 'not' order by created_at desc`,
  );
  const extra = taps.map((t) => t.item_id).filter((id) => !inFile.has(id)).slice(0, MORE_TAPS);
  const all = [...rows.map((r) => ({ id: r.id, group: r.group, text: r.text ?? null })), ...extra.map((id) => ({ id, group: 'live-not-tap', text: null }))];
  const xIds = all.filter((r) => r.id.startsWith('x:')).map((r) => r.id);
  const held = new Map(
    (await db.query<{ item_id: string; body: string | null; handle: string | null; source_author_id: string | null }>(
      `select i.item_id, i.body, a.handle, a.source_author_id from public.item i left join public.author a on a.author_key = i.author_key where i.item_id = any($1::text[])`,
      [xIds],
    )).map((r) => [r.item_id, r] as const),
  );
  const evidence = loadEvidence();
  const cases = new Map(tuning().map((c) => [c.id, c] as const));
  const posts: StorePost[] = [];
  const skipped: string[] = [];
  for (const r of all) {
    if (r.id.startsWith('x:')) {
      const postId = r.id.slice(2);
      const h = held.get(r.id);
      posts.push({ id: r.id, group: r.group, postId, text: h?.body ?? r.text, authorId: h?.source_author_id ?? null, authorHandle: h?.handle ?? null, postedAt: postTimeFromId(postId), launchedAt: null });
      continue;
    }
    const c = cases.get(r.id);
    const post = evidence.get(r.id)?.origin?.post ?? null;
    if (c === undefined || post === null || c.origin.kind === 'none' || c.origin.platform !== 'x') {
      skipped.push(r.id);
      continue;
    }
    const launched = Date.parse(c.createdAt);
    posts.push({ id: r.id, group: r.group, postId: post.postId, text: post.text, authorId: null, authorHandle: post.authorHandle, postedAt: post.postedAt ?? postTimeFromId(post.postId), launchedAt: Number.isNaN(launched) ? null : launched });
  }
  console.log(`posts: ${posts.length} (${extra.length} owner taps beyond the file), skipped ${skipped.length}: ${skipped.join(' ')}`);

  const apiKey = process.env['X_API_KEY'] ?? '';
  if (apiKey === '') refuse('X_API_KEY is not set.');
  const shared = await openSharedMeter(cap, process.env, 'live');
  const x = xPlatform({ client: xClient({ apiKey, baseUrl: process.env['X_API_BASE'] ?? 'https://api.twitterapi.io', fetch: globalThis.fetch }), meter: shared.meter, now: () => Date.now() as Millis });
  const repo = new PgCryptoAttentionRepo(db);
  const budget = { capUsd: cap, spentUsd: 0, maxCalls: null, deadline: (Date.now() + 3_600_000) as Millis };
  const out: unknown[] = [];
  let stored = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < posts.length) {
        const t = posts[next++]!;
        const cut = t.postedAt === null ? t.launchedAt : Math.min(t.launchedAt ?? Number.POSITIVE_INFINITY, t.postedAt + EARLY_MS);
        try {
          const got = await x.responses!(t.postId, { maxReplies: P.attention.repliesPerPost, maxReproductions: P.attention.reproductionsPerPost, untilMs: cut as Millis | null }, budget);
          const f = attentionFacts(got.value, P.attention, { text: t.text, authorId: t.authorId, authorHandle: t.authorHandle });
          await repo.record(t.id, Date.now() as Millis, {
            repliesRead: f.repliesRead, quotesRead: f.reproductionsRead, repliesCut: f.repliesCut, quotesCut: f.reproductionsCut,
            cashtags: f.cashtags, coinWords: f.coinWordResponses, caMentions: f.caMentions, contractAddresses: f.addresses,
            cryptoQuoters: f.cryptoReproducers, cryptoRepliers: f.cryptoRepliers, firstSignalAt: f.firstSignalAt as Millis | null, costUsd: got.spend.usd,
            others: f.others, own: f.own, authorKnown: f.authorKnown, postShill: f.postShill, othersFirstAt: f.othersFirstAt as Millis | null,
            cutAt: cut as Millis | null, readFor: 'test',
          });
          stored += 1;
          out.push({ id: t.id, group: t.group, cutAt: cut === null ? null : new Date(cut).toISOString(), authorKnown: f.authorKnown, postShill: f.postShill, own: f.own, others: f.others, othersSignal: othersSignal(f), shill: isShill(f), responses: f.repliesRead + f.reproductionsRead });
        } catch (e) {
          out.push({ id: t.id, group: t.group, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
        }
      }
    }),
  );
  const spent = shared.meter.spentUsd();
  await shared.close();
  await pool.end();
  writeFileSync(`${AFTER_AUDIT}/crypto-facts-rows.json`, JSON.stringify({ spentUsd: spent, skipped, posts: out }, null, 1));
  writeFileSync(`${AFTER_AUDIT}/crypto-facts-ready`, `${stored}\n`);
  console.log(`stored ${stored} of ${posts.length}; spent $${spent.toFixed(4)} on the live posts line`);
}

if (process.argv.includes('--store')) {
  if (process.env['SPEND'] !== 'live' || !process.argv.includes('--yes')) refuse('This spends money: SPEND=live and --yes.');
  await store();
} else {
  await main();
}
