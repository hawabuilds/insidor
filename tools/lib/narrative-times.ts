/**
 * THE NARRATIVE TIMES CHECK (the owner, 2026-10-18: "for every live narrative, compare its shown
 * 'First post', 'Found' and 'launched' times with the raw data, and list any that don't match ...
 * run this check daily, putting any mismatch in the 20:00 table"). For every narrative on the board
 * (public.board_row 'default'), what its page shows against what is stored:
 *
 *   first post     the page's earliest listed posted time (the phone takes it from the evidence)
 *                  against the listed posts' item.posted_at, and — with `match` — against the
 *                  earliest post the runner's own pass would list with the early posts (services/
 *                  runner work/narratives.ts, never a copy): a stored post that matches it and went
 *                  up earlier, which the page does not list
 *   we found it    the page's `foundAt` against the earliest item.first_seen_at of its listed posts
 *                  (the moment we first saved one), and the same for the pass's list
 *   launched       the page's coin (its settled one) against the create transaction's block time:
 *                  stored as the chain's (public.asset minted_at_source chain_rpc), or read with
 *                  `chain` when given; any other stored clock is a mismatch, whatever the phone
 *                  prints for it, because it is not the block
 *   Found Xm before the page says it when our find is before the launch it holds; a mismatch when
 *                  the block time is known and our find is not before it
 *
 * Free and read-only without `chain` (stored rows; the pass reads stored vectors and embeds
 * nothing). `chain` is one RPC call a coin on the caller's key.
 *
 * What breaks if changed carelessly: the pass must be the runner's (`narrativeGrouper`), or the
 * check measures a grouping nobody runs (the reason tools/narratives.ts gives).
 */

import type { Millis } from '../../contracts/src/vocabulary.ts';
import { DEFAULT_POLICY, type Policy } from '../../contracts/src/policy.ts';
import { inMemoryMeter } from '../../adapters/meter/spend/src/index.ts';
import { PgLearningRepo, PgNarrativeRepo, type Db } from '../../store/src/index.ts';
import { narrativeGrouper } from '../../services/runner/src/work/narratives.ts';

const POST_SPACE = 'multimodal-3.1024.post';
/** Two times this close are the same moment: the page prints minutes. */
const SAME_MS = 60_000;

export interface NarrativeTimeRow {
  readonly id: string;
  readonly title: string;
  readonly posts: number;
  readonly shownFirstPost: number | null;
  readonly listedFirstPost: number | null;
  /** With `match`: the earliest post the runner's pass lists for it (its posts and its early posts). */
  readonly passFirstPost: number | null;
  readonly passEarly: number;
  readonly shownFound: number | null;
  readonly listedFound: number | null;
  readonly passFound: number | null;
  readonly coin: { readonly address: string; readonly ticker: string | null; readonly storedMs: number | null; readonly source: string | null; readonly blockMs: number | null } | null;
  readonly mismatches: readonly string[];
}

const ms = (v: unknown): number | null => {
  const t = v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(t) ? t : null;
};
const min = (xs: readonly (number | null)[]): number | null => {
  const k = xs.filter((x): x is number => x !== null);
  return k.length === 0 ? null : Math.min(...k);
};
const differ = (a: number | null, b: number | null): boolean => (a === null) !== (b === null) || (a !== null && b !== null && Math.abs(a - b) >= SAME_MS);

export function hm(at: number | null): string {
  if (at === null) return '—';
  return new Date(at).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

export async function narrativeTimeRows(db: Db, opts: { readonly policy?: Policy; readonly match?: boolean; readonly chain?: ((address: string) => Promise<number | null>) | null } = {}): Promise<{ readonly rows: readonly NarrativeTimeRow[]; readonly passMs: number | null }> {
  const policy = opts.policy ?? DEFAULT_POLICY;
  const pages = await db.query<{ story_id: string; payload: Record<string, unknown> }>(
    `select r.story_id, s.payload from public.board_row r join public.story_view s using (story_id) where r.view_id = 'default' order by r."position"`,
  );
  const ids = [...new Set(pages.flatMap((p) => (Array.isArray(p.payload['postIds']) ? (p.payload['postIds'] as string[]) : [])))];

  /* The runner's own pass, read-only: what each narrative would list with its early posts. */
  let pass: ReadonlyMap<string, readonly string[]> = new Map();
  let early: ReadonlyMap<string, number> = new Map();
  let passMs: number | null = null;
  if (opts.match === true) {
    const repo = new PgNarrativeRepo(db);
    const applied = await new PgLearningRepo(db).latestApplied();
    const quiet = { info: () => {}, warn: () => {}, error: () => {}, child: () => quiet };
    const grouper = narrativeGrouper({
      repo, save: async () => false, block: async () => ({ cutoff: applied?.cutoff ?? null, chosenOn: applied?.cutoffModel ?? null }), titler: null, embed: null,
      keepVectors: async () => false, meter: inMemoryMeter({ dailyCapUsd: 0, softStop: 1, now: () => Date.now() }), mode: 'dry', policy, postSpace: POST_SPACE, log: quiet, now: () => Date.now() as Millis,
    });
    const started = Date.now();
    const g = await grouper.group();
    passMs = Date.now() - started;
    if (typeof g !== 'string') {
      pass = new Map(g.pass.narratives.map((n) => [n.id, [...n.members, ...(n.early ?? [])]] as const));
      early = new Map(g.pass.narratives.map((n) => [n.id, (n.early ?? []).length] as const));
    }
  }
  const all = [...new Set([...ids, ...[...pass.values()].flat()])];
  const items = new Map((all.length === 0 ? [] : await db.query<{ item_id: string; posted_at: Date | null; first_seen_at: Date }>(
    `select item_id, posted_at, first_seen_at from public.item where item_id = any($1::text[])`, [all],
  )).map((r) => [r.item_id, r] as const));

  const coinOf = (p: Record<string, unknown>): { address: string; ticker: string | null } | null => {
    const c = p['coins'] as { kind?: string; coin?: { address?: string; ticker?: string | null } } | null | undefined;
    return c?.kind === 'one' && typeof c.coin?.address === 'string' ? { address: c.coin.address, ticker: c.coin.ticker ?? null } : null;
  };
  const addresses = [...new Set(pages.flatMap((p) => { const c = coinOf(p.payload); return c === null ? [] : [c.address]; }))];
  const assets = new Map((addresses.length === 0 ? [] : await db.query<{ address: string; minted_at: Date | null; minted_at_source: string | null }>(
    `select address, minted_at, minted_at_source from public.asset where chain = 'solana' and address = any($1::text[])`, [addresses],
  )).map((r) => [r.address, r] as const));
  const blocks = new Map<string, number | null>();
  for (const a of addresses) {
    const stored = assets.get(a);
    if (stored?.minted_at_source === 'chain_rpc') blocks.set(a, ms(stored.minted_at));
    else if (opts.chain) {
      try {
        const s = await opts.chain(a);
        blocks.set(a, s === null ? null : s * 1_000);
      } catch {
        blocks.set(a, null);
      }
    }
  }

  const rows: NarrativeTimeRow[] = [];
  for (const p of pages) {
    const postIds = Array.isArray(p.payload['postIds']) ? (p.payload['postIds'] as string[]) : [];
    const evidence = Array.isArray(p.payload['evidence']) ? (p.payload['evidence'] as { postedAt?: { at?: number | null } }[]) : [];
    const shownFirstPost = min(evidence.map((e) => (typeof e.postedAt?.at === 'number' ? e.postedAt.at : null)));
    const listedFirstPost = min(postIds.map((i) => ms(items.get(i)?.posted_at ?? null)));
    const shownFound = ms((p.payload['foundAt'] as { at?: unknown } | undefined)?.at ?? null);
    const listedFound = min(postIds.map((i) => ms(items.get(i)?.first_seen_at ?? null)));
    const passList = pass.get(p.story_id) ?? null;
    const passFirstPost = passList === null ? null : min(passList.map((i) => ms(items.get(i)?.posted_at ?? null)));
    const passFound = passList === null ? null : min(passList.map((i) => ms(items.get(i)?.first_seen_at ?? null)));
    const c = coinOf(p.payload);
    const asset = c === null ? undefined : assets.get(c.address);
    const coin = c === null ? null : { ...c, storedMs: ms(asset?.minted_at ?? null), source: asset?.minted_at_source ?? null, blockMs: blocks.get(c.address) ?? null };

    const m: string[] = [];
    if (differ(shownFirstPost, listedFirstPost)) m.push(`first post shown ${hm(shownFirstPost)}, its posts say ${hm(listedFirstPost)}`);
    if (passList !== null && passFirstPost !== null && (listedFirstPost === null || passFirstPost < listedFirstPost - SAME_MS)) m.push(`an earlier stored post matches it: first post ${hm(passFirstPost)}, shown ${hm(shownFirstPost)}`);
    if (differ(shownFound, listedFound)) m.push(`we found it shown ${hm(shownFound)}, its posts say ${hm(listedFound)}`);
    if (passList !== null && passFound !== null && (listedFound === null || passFound < listedFound - SAME_MS)) m.push(`with the matching posts we found it ${hm(passFound)}, shown ${hm(shownFound)}`);
    if (coin !== null) {
      if (coin.source !== 'chain_rpc') m.push(`launched is not the block time: stored ${hm(coin.storedMs)} from ${coin.source ?? 'no row'}${coin.blockMs !== null ? `, block ${hm(coin.blockMs)}` : ''}`);
      const found = shownFound;
      if (coin.blockMs !== null && found !== null && coin.storedMs !== null && found < coin.storedMs && found >= coin.blockMs) m.push(`"Found before" would be false: found ${hm(found)}, block ${hm(coin.blockMs)}`);
    }
    rows.push({
      id: p.story_id, title: String(p.payload['title'] ?? ''), posts: postIds.length, shownFirstPost, listedFirstPost, passFirstPost, passEarly: early.get(p.story_id) ?? 0,
      shownFound, listedFound, passFound, coin, mismatches: m,
    });
  }
  return { rows, passMs };
}

/** The 20:00 table's section: counts, then each narrative with a mismatch. */
export function narrativeTimeLines(r: { readonly rows: readonly NarrativeTimeRow[]; readonly passMs: number | null }): string[] {
  const bad = r.rows.filter((x) => x.mismatches.length > 0);
  const kinds = new Map<string, number>();
  for (const x of bad) for (const m of x.mismatches) {
    const k = m.startsWith('an earlier stored') ? 'earlier stored post not listed' : m.startsWith('with the matching') ? 'earlier find in the matching posts' : m.startsWith('launched is not') ? 'launched not the block time' : m.startsWith('"Found before"') ? 'Found before false' : m.startsWith('first post shown') ? 'first post shown wrong' : 'we found it shown wrong';
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  const lines = [`${r.rows.length} narratives on the board; ${bad.length} with a mismatch${r.passMs === null ? '' : ` (the runner's pass, read-only, ${r.passMs} ms)`}.`];
  if (kinds.size > 0) lines.push([...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('; ') + '.');
  if (bad.length > 0) {
    lines.push('', '| narrative | title | posts | first post shown → raw | we found it shown → raw | launched | mismatch |', '|---|---|---|---|---|---|---|');
    for (const x of bad) {
      const launched = x.coin === null ? '—' : `${x.coin.ticker ?? x.coin.address.slice(0, 6)} ${hm(x.coin.storedMs)} (${x.coin.source ?? 'none'})${x.coin.blockMs !== null ? `, block ${hm(x.coin.blockMs)}` : ''}`;
      const raw = (shown: number | null, pass: number | null) => `${hm(shown)} → ${hm(pass ?? shown)}`;
      lines.push(`| ${x.id} | ${x.title.replace(/\|/g, '/').slice(0, 40)} | ${x.posts}${x.passEarly > 0 ? ` +${x.passEarly}` : ''} | ${raw(x.shownFirstPost, x.passFirstPost)} | ${raw(x.shownFound, x.passFound)} | ${launched} | ${x.mismatches.join('; ').replace(/\|/g, '/')} |`);
    }
  }
  return lines;
}
