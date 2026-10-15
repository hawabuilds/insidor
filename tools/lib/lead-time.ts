/**
 * LEAD TIME — the main number from 2026-10-15 (the owner: "find viral posts BEFORE they're
 * coined"). For every coined post, For You's first showing against the first coin's launch:
 * the share of coined posts we showed first, and the median minutes of lead (negative: the coin
 * came first), for each source and in all.
 *
 * A coined post is one a coin's metadata names (internal.coin_post_link, 0083) or whose coin the
 * owner confirmed. The first coin is the earliest launched of them: copycats come later. A post we
 * never showed is in the count and never "ahead"; its lead is a dash, not a zero.
 *
 * Shared by tools/lead-time.ts, the re-tune's summary (tools/retune.ts) and the number table
 * (tools/name-report.ts), so the three never disagree. Before 0083 it reads the same links out of
 * the metadata documents directly (the shapes the migration's backfill reads), so the number
 * exists from the first day; after it, from the view the runner keeps current.
 *
 * What breaks if changed carelessly: counting from the post's time instead of its first coin. A
 * post made days before anyone coined it is not "late" for us until the coin exists.
 */

import type { Db } from '../../store/src/index.ts';

export interface LeadRow {
  readonly itemId: string;
  readonly source: string;
  readonly postedAt: Date | null;
  readonly firstCoinAt: Date;
  readonly firstCoin: string;
  readonly coins: number;
  /** A coin's metadata names the post (else only the owner's confirmed coin ties them). */
  readonly named: boolean;
  readonly foundBy: string | null;
  readonly foundAt: Date | null;
  readonly shownAt: Date | null;
  /** Minutes from first showing to the first coin: positive when we showed it first. */
  readonly leadMin: number | null;
}

export interface LeadSummary {
  readonly source: string;
  readonly coined: number;
  readonly shown: number;
  readonly shownFirst: number;
  /** Median minutes of lead over the posts we showed; null when none were shown. */
  readonly medianLeadMin: number | null;
}

/** The links straight from the metadata documents, for a database without 0083. */
const LINKED_FROM_METADATA = `
  select l.source || ':' || l.id as item_id, a.address, a.minted_at, true as named
    from internal.coin_metadata m
    join public.asset a using (asset_key)
    cross join lateral (
      select 'tiktok' as source, x[1] as id
        from regexp_matches(concat_ws(' ', m.social_link, m.website, m.chat_link, m.description), 'tiktok\\.com/@[A-Za-z0-9_.]+/(?:video|photo)/([0-9]{8,25})', 'g') as x
      union
      select 'x', x[1]
        from regexp_matches(concat_ws(' ', m.social_link, m.website, m.chat_link, m.description), '(?:x|twitter)\\.com/[A-Za-z0-9_]+/status(?:es)?/([0-9]{8,25})', 'g') as x
    ) l
   where m.outcome = 'read' and a.minted_at >= $1`;

const LINKED_FROM_TABLE = `
  select l.source || ':' || l.source_item_id as item_id, l.address, l.minted_at, true as named
    from internal.coin_post_link l where l.minted_at >= $1`;

const query = (linked: string) => `
  with linked as (
    ${linked}
    union all
    select f.item_id, f.coin_address, coalesce(a.minted_at, n.launched_at), false
      from internal.owner_feedback f
      left join public.asset a on a.address = f.coin_address
      left join public.coin_name n on n.address = f.coin_address
     where f.subject_kind = 'coin_match' and f.verdict = 'right' and f.coin_address is not null
  ),
  firsts as (
    select item_id, min(minted_at) as first_coin_at, (array_agg(address order by minted_at))[1] as first_coin, count(distinct address)::int as coins,
           bool_or(named) as named
      from linked where minted_at is not null group by item_id
  )
  select c.item_id, split_part(c.item_id, ':', 1) as source, i.posted_at, c.first_coin_at, c.first_coin, c.coins, c.named,
         fb.lane as found_by, fb.found_at, fp.first_shown_at as shown_at
    from firsts c
    left join public.item i on i.item_id = c.item_id
    left join internal.item_found_by fb on fb.item_id = c.item_id
    left join public.feed_post fp on fp.item_id = c.item_id and fp.feed_id = 'fyp'
   where c.first_coin_at >= $1`;

const missing = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42P01';

/** Every post whose first coin launched since `since`. */
export async function leadRows(db: Db, since: Date): Promise<readonly LeadRow[]> {
  type Raw = { item_id: string; source: string; posted_at: Date | null; first_coin_at: Date; first_coin: string; coins: number; named: boolean; found_by: string | null; found_at: Date | null; shown_at: Date | null };
  let rows: Raw[];
  try {
    rows = await db.query<Raw>(query(LINKED_FROM_TABLE), [since]);
  } catch (e) {
    if (!missing(e)) throw e;
    rows = await db.query<Raw>(query(LINKED_FROM_METADATA), [since]);
  }
  return rows.map((r) => ({
    itemId: r.item_id,
    source: r.source,
    postedAt: r.posted_at,
    firstCoinAt: r.first_coin_at,
    firstCoin: r.first_coin,
    coins: r.coins,
    named: r.named,
    foundBy: r.found_by,
    foundAt: r.found_at,
    shownAt: r.shown_at,
    leadMin: r.shown_at === null ? null : (r.first_coin_at.getTime() - r.shown_at.getTime()) / 60_000,
  }));
}

const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] ?? null) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

/** Per source and in all ('all'). */
export function summarise(rows: readonly LeadRow[]): readonly LeadSummary[] {
  const of = (source: string, xs: readonly LeadRow[]): LeadSummary => {
    const shown = xs.filter((r) => r.leadMin !== null);
    return { source, coined: xs.length, shown: shown.length, shownFirst: shown.filter((r) => (r.leadMin ?? 0) > 0).length, medianLeadMin: median(shown.map((r) => r.leadMin ?? 0)) };
  };
  const sources = [...new Set(rows.map((r) => r.source))].sort();
  return [...sources.map((s) => of(s, rows.filter((r) => r.source === s))), of('all', rows)];
}

const pct = (n: number, d: number) => (d === 0 ? '—' : `${Math.round((100 * n) / d)}%`);
const mins = (m: number | null) => (m === null ? '— (none shown)' : `${m >= 0 ? '+' : ''}${Math.round(m)} min`);

/** One line per source: "x: 12% of 900 coined posts shown before the coin (108); median lead +35 min over 140 shown". */
export function leadLines(summary: readonly LeadSummary[]): readonly string[] {
  return summary.map((s) => `${s.source}: ${pct(s.shownFirst, s.coined)} of ${s.coined} coined posts shown before the coin (${s.shownFirst}); median lead ${mins(s.medianLeadMin)} over ${s.shown} shown`);
}

/** The summary as plain facts, for a JSON log line or an alert. */
export function leadFacts(summary: readonly LeadSummary[]): Record<string, { coined: number; shown: number; shownFirst: number; shownFirstPct: number | null; medianLeadMin: number | null }> {
  return Object.fromEntries(summary.map((s) => [s.source, { coined: s.coined, shown: s.shown, shownFirst: s.shownFirst, shownFirstPct: s.coined === 0 ? null : Math.round((100 * s.shownFirst) / s.coined), medianLeadMin: s.medianLeadMin === null ? null : Math.round(s.medianLeadMin) }]));
}
