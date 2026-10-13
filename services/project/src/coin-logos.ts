/**
 * THE COIN-LOGO MIRROR: which coins on screen still need their logo copied into our storage,
 * where each one's picture comes from, and what the ledger records about the try.
 *
 * Which coins: the ones a person can see — the coins named in the For You and Popular feeds, on
 * a narrative page projected in the last two days, in a "See N coins" list, or created on
 * Insidor. Chainwatch indexes every launch (tens of thousands a day), and copying all of them
 * would be storage spent on pictures nobody opens.
 *
 * Where from, in the owner's order: the market source's copy of the coin's picture first (it is
 * resized and served from a CDN, and a coin's team can update it there); failing that, the
 * picture in the coin's own metadata from its launch, read through OUR gateway by content id
 * (internal.coin_metadata) or, when the metadata was never read, the URI chainwatch recorded.
 * Neither: the ledger says `none`, and the app draws the ticker's first letter.
 *
 * Separate from logos-main.ts so the choice and the selection are tested with stand-ins; the
 * entry only wires real pools, the market source and storage to this.
 *
 * What breaks if changed carelessly: the retry bounds. `none` is asked again only after
 * NONE_RETRY_MS and `failed` at most MAX_ATTEMPTS times; without them, a coin with a dead
 * picture host would be fetched every pass forever.
 */

import type { Db } from '@insidor/store';

/** Coins looked at per pass. A pass runs every two minutes; this keeps one under a minute. */
export const PER_PASS = 60;
/** A coin no source had a picture for is asked about again after this long. */
export const NONE_RETRY_MS = 6 * 3_600_000;
/** A failed copy waits this long before the next try. */
export const FAILED_RETRY_MS = 20 * 60_000;
/** A picture that failed this many times is left where it is; the app falls back to it directly. */
export const MAX_ATTEMPTS = 4;
/** Narrative pages projected within this window count as on screen. */
export const STORY_WINDOW_MS = 48 * 3_600_000;
/** The largest picture copied. Launch pictures are capped at about this size by the launchpad. */
export const MAX_LOGO_BYTES = 4 * 1024 * 1024;

const ADDRESS = '^[1-9A-HJ-NP-Za-km-z]{32,44}$';

/**
 * The coins on screen whose logo is missing, retryable, or never tried — with the two launch
 * picture candidates. `$1` story window start, `$2` none-retry cutoff, `$3` failed-retry cutoff,
 * `$4` max attempts, `$5` limit.
 */
export const DUE_SQL = `
with shown as (
  select distinct jsonb_path_query(payload, 'lax $.**.address') #>> '{}' as address from public.rising_row
  union
  select distinct jsonb_path_query(payload, 'lax $.**.address') #>> '{}' from public.story_view where projected_at >= $1
  union
  select address from public.same_name_coin
  union
  select address from public.created_coin
)
select s.address, m.image_uri as metadata_image, a.image_uri as asset_image
  from shown s
  join public.asset a on a.chain = 'solana' and a.address = s.address
  left join internal.coin_metadata m on m.asset_key = a.asset_key and m.outcome = 'read'
  left join internal.coin_logo l on l.address = s.address
 where s.address ~ '${ADDRESS}'
   and (l.address is null
        or (l.outcome = 'none' and l.checked_at < $2)
        or (l.outcome = 'failed' and l.checked_at < $3 and l.attempts < $4))
 order by l.checked_at asc nulls first, a.minted_at desc nulls last
 limit $5`;

export const RECORD_SQL = `
insert into internal.coin_logo (address, outcome, source, attempts, checked_at)
values ($1, $2, $3, 1, now())
on conflict (address) do update
   set outcome = excluded.outcome,
       source = excluded.source,
       attempts = case when excluded.outcome = 'failed' and internal.coin_logo.outcome = 'failed'
                        then internal.coin_logo.attempts + 1 else 1 end,
       checked_at = excluded.checked_at`;

export interface DueCoin {
  readonly address: string;
  readonly metadataImage: string | null;
  readonly assetImage: string | null;
}

export type LogoSource = { readonly source: 'market' | 'launch'; readonly url: string };

const https = (v: string | null): string | null => {
  if (v === null) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
};

/** The pictures to try, in order: the market's copy, then the launch picture through our gateway, then as recorded. */
export function sourcesFor(coin: DueCoin, marketImage: string | null): readonly LogoSource[] {
  const out: LogoSource[] = [];
  const add = (source: LogoSource['source'], url: string | null) => {
    const u = https(url);
    if (u !== null && !out.some((o) => o.url === u)) out.push({ source, url: u });
  };
  add('market', marketImage);
  add('launch', coin.metadataImage);
  add('launch', coin.assetImage);
  return out;
}

export async function dueCoins(db: Db, nowMs: number): Promise<readonly DueCoin[]> {
  const rows = await db.query<{ address: string; metadata_image: string | null; asset_image: string | null }>(DUE_SQL, [
    new Date(nowMs - STORY_WINDOW_MS),
    new Date(nowMs - NONE_RETRY_MS),
    new Date(nowMs - FAILED_RETRY_MS),
    MAX_ATTEMPTS,
    PER_PASS,
  ]);
  return rows.map((r) => ({ address: r.address, metadataImage: r.metadata_image, assetImage: r.asset_image }));
}

export interface MirrorDeps {
  readonly db: Db;
  readonly nowMs: number;
  /** The market source's picture per address; throws on an outage. */
  readonly marketImages: (addresses: readonly string[]) => Promise<ReadonlyMap<string, string | null>>;
  readonly copy: (address: string, url: string) => Promise<void>;
  readonly log: (msg: string, fields: Record<string, unknown>) => void;
}

/** One pass. Returns how many were stored, had none, and failed. */
export async function mirrorPass(deps: MirrorDeps): Promise<{ readonly stored: number; readonly none: number; readonly failed: number }> {
  const due = await dueCoins(deps.db, deps.nowMs);
  if (due.length === 0) return { stored: 0, none: 0, failed: 0 };
  /* An outage at the market source is not "it has no picture": the launch picture is still
     tried, but a coin whose only option was the market's is recorded failed, not none. */
  let market: ReadonlyMap<string, string | null> | null = null;
  try {
    market = await deps.marketImages(due.map((c) => c.address));
  } catch (e) {
    deps.log('market pictures unavailable', { err: e instanceof Error ? e.message : String(e) });
  }
  let stored = 0;
  let none = 0;
  let failed = 0;
  for (const coin of due) {
    const sources = sourcesFor(coin, market?.get(coin.address) ?? null);
    let outcome: { readonly outcome: 'stored' | 'none' | 'failed'; readonly source: LogoSource['source'] | null } =
      sources.length === 0 ? { outcome: market === null ? 'failed' : 'none', source: null } : { outcome: 'failed', source: null };
    for (const s of sources) {
      try {
        await deps.copy(coin.address, s.url);
        outcome = { outcome: 'stored', source: s.source };
        break;
      } catch (e) {
        deps.log('logo copy failed', { address: coin.address, source: s.source, err: e instanceof Error ? e.message : String(e) });
      }
    }
    await deps.db.query(RECORD_SQL, [coin.address, outcome.outcome, outcome.source]);
    if (outcome.outcome === 'stored') stored += 1;
    else if (outcome.outcome === 'none') none += 1;
    else failed += 1;
  }
  return { stored, none, failed };
}
