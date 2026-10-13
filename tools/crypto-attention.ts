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
import { attentionFacts, hasCryptoSignal, type AttentionFacts } from '../core/src/qualify/attention.ts';
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

await main();
