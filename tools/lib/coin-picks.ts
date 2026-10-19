/**
 * THE 20:00 TABLE'S "COIN PICKS" (the owner, 2026-10-20): what the one-post-one-coin rule did over
 * the last 24 hours, and how it stood against the owner's own coin calls.
 *
 *   counts    posts and narratives judged in the window (a pick row written or kept in it), by
 *             where each stands now: it has a coin, it is waiting for a clear leader among coins
 *             of its name (the card shows Create meanwhile), or no coin uses its name (Create)
 *   owner     each judged post the owner gave a coin call, against his call: right; wrong (another
 *             coin picked, or any coin where he said no coin is from it); no pick while his coin
 *             was one the rule weighed; or his coin was never one the rule weighed, so no rule
 *             could have picked it — the matcher's miss, not the rule's
 *   basis     every count split by what the rule judged on: trades, or market readings when the
 *             trade feed could not measure a coin
 *
 * Its own file so the arithmetic is tested on made-up rows (coin-picks.test.ts) apart from the SQL.
 * The owner's calls are folded by core `foldCoinCalls`, the rule the projector and the re-tune use:
 * a second reading of "what did the owner say" here would be a table about another owner.
 *
 * What breaks if changed carelessly: the "never weighed" line. It must be read from the coins the
 * rule weighed (internal.one_coin_candidate), never from the pick: a missing coin is a matcher
 * miss, and counting it as "no pick" would blame the rule for a coin it was never shown.
 */

import { addressOfCoinId, foldCoinCalls, type PostCoinCalls } from '../../core/src/index.ts';
import { PgOwnerCoinCallRepo, missingTable, type Db } from '../../store/src/index.ts';

const DAY_MS = 86_400_000;

export type Basis = 'trades' | 'market_readings' | null;

export interface PickRow {
  readonly kind: 'post' | 'narrative';
  readonly id: string;
  readonly address: string | null;
  readonly outcome: 'picked' | 'waiting' | 'none';
  readonly basis: Basis;
}

export type Verdict = 'right' | 'wrong' | 'no_pick' | 'never_weighed';

/** A post's pick against the owner's calls; null when his calls give nothing to compare. */
export function verdictOf(pick: PickRow, calls: PostCoinCalls | undefined, weighed: ReadonlySet<string>): Verdict | null {
  if (calls === undefined) return null;
  if (calls.own !== null) {
    if (pick.address === calls.own.address) return 'right';
    if (pick.address !== null) return 'wrong';
    return weighed.has(calls.own.address) ? 'no_pick' : 'never_weighed';
  }
  if (calls.none) return pick.address === null ? 'right' : 'wrong';
  if (pick.address !== null && calls.wrong.has(pick.address)) return 'wrong';
  return null;
}

const BASIS_WORDS: Record<'trades' | 'market_readings', string> = { trades: 'on trades', market_readings: 'on market readings' };
const split = (rows: readonly PickRow[]): string => {
  const parts = (['trades', 'market_readings'] as const).map((b) => [b, rows.filter((r) => r.basis === b).length] as const).filter(([, n]) => n > 0);
  return parts.length === 0 ? '' : ` (${parts.map(([b, n]) => `${n} ${BASIS_WORDS[b]}`).join(', ')})`;
};

/** The section's lines from the window's pick rows, the owner's folded calls and the coins weighed per post. */
export function coinPickLines(picks: readonly PickRow[], calls: ReadonlyMap<string, PostCoinCalls>, weighed: ReadonlyMap<string, ReadonlySet<string>>): readonly string[] {
  const out: string[] = [];
  for (const kind of ['post', 'narrative'] as const) {
    const rows = picks.filter((p) => p.kind === kind);
    const noun = kind === 'post' ? 'Posts' : 'Narratives';
    if (rows.length === 0) {
      out.push(`${noun}: none judged`);
      continue;
    }
    const picked = rows.filter((r) => r.outcome === 'picked');
    const waiting = rows.filter((r) => r.outcome === 'waiting');
    const none = rows.filter((r) => r.outcome === 'none');
    out.push(`${noun}: ${rows.length} judged — got a coin ${picked.length}${split(picked)}; waited, no clear leader yet ${waiting.length}${split(waiting)}; showed Create, no coin of the name ${none.length}`);
  }
  if (picks.some((p) => p.kind === 'post' && p.outcome === 'waiting')) out.push('A post that waits shows Create until a coin leads.');

  const judged = picks.filter((p) => p.kind === 'post').flatMap((p) => {
    const v = verdictOf(p, calls.get(p.id), weighed.get(p.id) ?? new Set());
    return v === null ? [] : [{ p, v }];
  });
  out.push('');
  if (judged.length === 0) {
    out.push('Against my coin calls: no judged post has a call yet');
    return out;
  }
  const of = (v: Verdict) => judged.filter((j) => j.v === v).map((j) => j.p);
  out.push(`Against my coin calls (${judged.length} posts):`);
  out.push(`- right: ${of('right').length}${split(of('right'))}`);
  out.push(`- wrong coin: ${of('wrong').length}${split(of('wrong'))}`);
  out.push(`- no pick while my coin was among those weighed: ${of('no_pick').length}${split(of('no_pick'))}`);
  out.push(`- my coin was never among those weighed: ${of('never_weighed').length}`);
  for (const j of judged.filter((x) => x.v === 'wrong')) {
    const c = calls.get(j.p.id);
    out.push(`  wrong: ${j.p.id} showed ${j.p.address ?? 'no coin'}, my call ${c?.own?.address ?? (c?.none ? 'no coin' : 'not this one')}`);
  }
  return out;
}

/** The section read from the store: pick rows updated in the 24 h before `nowMs`, the owner's calls, the coins weighed. */
export async function coinPickSection(db: Db, nowMs: number): Promise<readonly string[]> {
  const since = new Date(nowMs - DAY_MS).toISOString();
  const until = new Date(nowMs).toISOString();
  let picks: PickRow[];
  try {
    const rows = await db.query<{ kind: 'post' | 'narrative'; id: string; address: string | null; outcome: PickRow['outcome']; basis: string | null }>(
      `select 'post' as kind, item_id as id, address, outcome, evidence->>'basis' as basis from internal.post_coin_pick where updated_at >= $1 and updated_at < $2
       union all
       select 'narrative', narrative_id, address, outcome, evidence->>'basis' from internal.narrative_coin_pick where updated_at >= $1 and updated_at < $2`,
      [since, until],
    );
    picks = rows.map((r) => ({ kind: r.kind, id: r.id, address: r.address, outcome: r.outcome, basis: r.basis === 'trades' || r.basis === 'market_readings' ? r.basis : null }));
  } catch (e) {
    if (missingTable(e)) return ['No coin picks yet: the pick tables are not there (0113).'];
    throw e;
  }
  const postIds = picks.filter((p) => p.kind === 'post').map((p) => p.id);
  const callRows = await new PgOwnerCoinCallRepo(db).rows(postIds);
  const calls = foldCoinCalls(callRows.map((r) => ({ itemId: r.itemId, verdict: r.verdict, coinAddress: r.coinAddress, shownCoin: addressOfCoinId(r.shownCoinId), atMs: r.atMs, id: r.id })));
  const called = [...calls.keys()];
  const weighed = new Map<string, Set<string>>();
  if (called.length > 0) {
    const rows = await db.query<{ item_id: string; address: string }>(`select item_id, address from internal.one_coin_candidate where item_id = any($1::text[])`, [called]);
    for (const r of rows) weighed.set(r.item_id, (weighed.get(r.item_id) ?? new Set()).add(r.address));
  }
  return coinPickLines(picks, calls, weighed);
}
