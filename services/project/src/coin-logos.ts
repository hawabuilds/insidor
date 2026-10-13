/**
 * THE COIN-LOGO MIRROR: which coins still need their logo copied into our storage, where each
 * one's picture comes from, and what the ledger records about the try — including, for a coin
 * left without one, why.
 *
 * ★ EVERY LAUNCHPAD COIN HAS A PICTURE. The launchpad refuses a launch without one, so a coin the
 * app draws as a letter is a coin whose picture we failed to fetch, never a coin that has none.
 * The mirror therefore tries every place the picture can be, and logs each coin it still could
 * not fill (`coin logo is a letter`) with the reason, countable from the ledger's `why`.
 *
 * Which coins, in two lists per pass: first every coin a person can see — named on a feed card or
 * a narrative page (no age window: a page still open shows its coins), in a post sheet's or a
 * "See N coins" list (which holds every coin a lookup found, so a coin is taken as soon as it is
 * first listed), a history narrative, a running older coin, or created on Insidor; then, within a
 * per-pass cap, every other coin we hold (public.coin_name), newest first, so a token page opened
 * from Search or a link has its logo too.
 *
 * Where from, in the owner's order, each tried only when the one before gave nothing:
 *   1. `launch` the picture the coin's own metadata names — the one already read
 *      (internal.coin_metadata), else the document at its metadata link read here — through a
 *      chain of IPFS gateways when it is content-addressed (adapter logo-picture.ts);
 *   2. `venue`  the launchpad's own copy (its coin record's picture);
 *   3. `market` the market source's copy.
 *
 * Separate from logos-main.ts so the order, the selection and the ledger are tested with
 * stand-ins; the entry only wires real pools, the sources and storage to this.
 *
 * What breaks if changed carelessly: the retry bounds. `none` is asked again only after
 * NONE_RETRY_MS, and `failed` waits FAILED_RETRY_MS doubled per attempt up to MAX_ATTEMPTS, then
 * GAVE_UP_RETRY_MS;
 * without them a coin with a dead picture host would be fetched every pass forever. And the pass
 * budget: this job runs on one schedule with the board's rebuild, so a pass must end in about a
 * minute however slow the picture hosts are.
 */

import type { Db } from '@insidor/store';

/** Coins a person can see, looked at per pass. */
export const SHOWN_PER_PASS = 60;
/** Every other coin we hold, looked at per pass behind them: a background backfill. */
export const BACKFILL_PER_PASS = 120;
/** Coins worked on at once. Each one's tries are in order; coins run side by side. */
export const CONCURRENCY = 8;
/** No new coin is started after this much of a pass; the ones under way finish. */
export const PASS_BUDGET_MS = 40_000;
/** A coin no source had a picture for is asked about again after this long. */
export const NONE_RETRY_MS = 6 * 3_600_000;
/** A failed copy waits this long before its second try, doubling for each try after. */
export const FAILED_RETRY_MS = 20 * 60_000;
/** A coin that failed this many times is a letter, and is asked again only after GAVE_UP_RETRY_MS. */
export const MAX_ATTEMPTS = 6;
/** A coin out of tries is tried afresh after this long: a host that was down for a day may be back. */
export const GAVE_UP_RETRY_MS = 24 * 3_600_000;
/** The launchpad is asked no more this pass after this many failures in a row (down, or refusing the region). */
export const VENUE_TRIP = 3;
/** The largest picture copied. Launch pictures are capped at about this size by the launchpad. */
export const MAX_LOGO_BYTES = 4 * 1024 * 1024;

const ADDRESS = '^[1-9A-HJ-NP-Za-km-z]{32,44}$';

/* `$1` none-retry cutoff, `$2` now, `$3` failed base wait in ms, `$4` max attempts, `$5` the
   gave-up cutoff. A row from
   before migration 0071 has no `why` and is taken as never tried: its sources were fewer. */
const DUE = `(l.address is null
        or (l.outcome <> 'stored' and l.why is null)
        or (l.outcome = 'none' and l.checked_at < $1)
        or (l.outcome = 'failed' and l.attempts < $4
            and l.checked_at < $2::timestamptz - make_interval(secs => $3::double precision / 1000 * power(2, l.attempts - 1)))
        or (l.outcome = 'failed' and l.attempts >= $4 and l.checked_at < $5))`;

const COLUMNS = `a.declared_social ->> 'metadata' as metadata_uri, m.image_uri as metadata_image, l.outcome as last_outcome, l.attempts`;
const JOINS = `
  left join public.asset a on a.chain = 'solana' and a.address = s.address
  left join internal.coin_metadata m on m.asset_key = a.asset_key and m.outcome = 'read'
  left join internal.coin_logo l on l.address = s.address`;

/** The coins on screen whose logo is missing, retryable, or never tried. `$6` limit. */
export const SHOWN_SQL = `
with shown as (
  select jsonb_path_query(payload, 'lax $.**.address') #>> '{}' as address from public.rising_row
  union
  select jsonb_path_query(payload, 'lax $.**.address') #>> '{}' from public.story_view
  union
  select address from public.same_name_coin
  union
  select address from public.created_coin
  union
  select address from public.history_coin
  union
  select address from internal.older_coin where running
)
select s.address, ${COLUMNS}
  from shown s ${JOINS}
 where s.address ~ '${ADDRESS}' and ${DUE}
 order by l.checked_at asc nulls first
 limit $6`;

/** Every other coin we hold, newest first. `$6` limit, `$7` addresses already taken this pass. */
export const BACKFILL_SQL = `
select s.address, ${COLUMNS}
  from public.coin_name s ${JOINS}
 where s.address ~ '${ADDRESS}' and not (s.address = any($7::text[])) and ${DUE}
 order by coalesce(a.minted_at, s.launched_at) desc nulls last
 limit $6`;

export const RECORD_SQL = `
insert into internal.coin_logo (address, outcome, source, attempts, checked_at, why)
values ($1, $2, $3, 1, now(), $4)
on conflict (address) do update
   set outcome = excluded.outcome,
       source = excluded.source,
       attempts = case when excluded.outcome = 'failed' and internal.coin_logo.outcome = 'failed'
                        then internal.coin_logo.attempts + 1 else 1 end,
       checked_at = excluded.checked_at,
       why = excluded.why`;

/** Whether migration 0071 has run; before it the ledger cannot say why, nor name the launchpad. */
export const MIGRATED_SQL = `
select 1 from information_schema.columns where table_schema = 'internal' and table_name = 'coin_logo' and column_name = 'why'`;

export interface DueCoin {
  readonly address: string;
  /** The coin's metadata link as the mint recorded it; null when the coin is not indexed. */
  readonly metadataUri: string | null;
  /** The picture link from the metadata document already read, if one was. */
  readonly metadataImage: string | null;
  readonly lastOutcome: string | null;
  readonly attempts: number;
}

export type LogoSource = 'launch' | 'venue' | 'market';

interface Row {
  address: string;
  metadata_uri: string | null;
  metadata_image: string | null;
  last_outcome: string | null;
  attempts: number | null;
}

const toCoin = (r: Row): DueCoin => ({
  address: r.address,
  metadataUri: r.metadata_uri,
  metadataImage: r.metadata_image,
  lastOutcome: r.last_outcome,
  attempts: r.attempts ?? 0,
});

export async function dueCoins(db: Db, nowMs: number): Promise<{ readonly shown: readonly DueCoin[]; readonly backfill: readonly DueCoin[] }> {
  const common = [new Date(nowMs - NONE_RETRY_MS), new Date(nowMs), FAILED_RETRY_MS, MAX_ATTEMPTS, new Date(nowMs - GAVE_UP_RETRY_MS)];
  const shown = (await db.query<Row>(SHOWN_SQL, [...common, SHOWN_PER_PASS])).map(toCoin);
  const backfill = (await db.query<Row>(BACKFILL_SQL, [...common, BACKFILL_PER_PASS, shown.map((c) => c.address)])).map(toCoin);
  return { shown, backfill };
}

export interface MirrorDeps {
  readonly db: Db;
  readonly nowMs: number;
  /** Milliseconds since the pass began, for the pass budget. */
  readonly elapsedMs: () => number;
  /** The picture link a metadata document names; null when none; throws when no host answered. */
  readonly metadataPicture: (uri: string) => Promise<string | null>;
  /** The launchpad's copy of the picture; null when it has none; throws on an outage. */
  readonly venuePicture: (address: string) => Promise<string | null>;
  /** The market source's picture per address; throws on an outage. */
  readonly marketImages: (addresses: readonly string[]) => Promise<ReadonlyMap<string, string | null>>;
  /** The URLs to try for one picture link, best first (a gateway chain for a content id). */
  readonly pictureUrls: (link: string) => readonly string[];
  readonly copy: (address: string, url: string) => Promise<void>;
  readonly log: (msg: string, fields: Record<string, unknown>) => void;
}

export interface PassResult {
  readonly stored: number;
  readonly none: number;
  readonly failed: number;
  /** Coins left as a letter for good this pass: no picture anywhere, or out of tries. */
  readonly letters: number;
  readonly bySource: Readonly<Record<LogoSource, number>>;
  readonly skippedForTime: number;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 120);

export type Resolved =
  | { readonly outcome: 'stored'; readonly source: LogoSource; readonly why: null }
  | { readonly outcome: 'none' | 'failed'; readonly source: null; readonly why: string };

/**
 * One coin, through the sources in order. `failed` when any source could not be asked or its
 * picture could not be copied — an outage is never "it has none" — and `none` only when every
 * source answered that it holds no picture.
 */
export async function resolveCoin(
  coin: DueCoin,
  deps: Pick<MirrorDeps, 'metadataPicture' | 'venuePicture' | 'pictureUrls' | 'copy'>,
  market: ReadonlyMap<string, string | null> | null,
  venueOpen: () => boolean,
  venueResult: (ok: boolean) => void,
): Promise<Resolved> {
  const notes: string[] = [];
  let outage = false;

  const tryLink = async (source: LogoSource, link: string | null): Promise<boolean> => {
    if (link === null) return false;
    const urls = deps.pictureUrls(link);
    if (urls.length === 0) {
      notes.push(`${source}: picture link not fetchable`);
      return false;
    }
    let last = '';
    for (const url of urls) {
      try {
        await deps.copy(coin.address, url);
        return true;
      } catch (e) {
        last = errText(e);
      }
    }
    outage = true;
    notes.push(`${source}: ${urls.length} host${urls.length === 1 ? '' : 's'} failed (${last})`);
    return false;
  };

  /* 1. the coin's own metadata */
  let launch = coin.metadataImage;
  if (launch === null) {
    if (coin.metadataUri === null) notes.push('launch: no metadata link (coin not indexed)');
    else {
      try {
        launch = await deps.metadataPicture(coin.metadataUri);
        if (launch === null) notes.push('launch: metadata names no picture');
      } catch (e) {
        outage = true;
        notes.push(`launch: metadata unreachable (${errText(e)})`);
      }
    }
  }
  if (await tryLink('launch', launch)) return { outcome: 'stored', source: 'launch', why: null };

  /* 2. the launchpad's copy */
  if (!venueOpen()) {
    outage = true;
    notes.push('venue: not asked, down this pass');
  } else {
    let venue: string | null = null;
    try {
      venue = await deps.venuePicture(coin.address);
      venueResult(true);
      if (venue === null) notes.push('venue: no picture');
    } catch (e) {
      venueResult(false);
      outage = true;
      notes.push(`venue: unreachable (${errText(e)})`);
    }
    if (await tryLink('venue', venue)) return { outcome: 'stored', source: 'venue', why: null };
  }

  /* 3. the market source's copy */
  if (market === null) {
    outage = true;
    notes.push('market: unreachable');
  } else {
    const m = market.get(coin.address) ?? null;
    if (m === null) notes.push('market: no picture');
    if (await tryLink('market', m)) return { outcome: 'stored', source: 'market', why: null };
  }

  return { outcome: outage ? 'failed' : 'none', source: null, why: notes.join('; ').slice(0, 500) };
}

/** One pass: the coins on screen first, then the backfill, inside the pass budget. */
export async function mirrorPass(deps: MirrorDeps): Promise<PassResult> {
  const bySource: Record<LogoSource, number> = { launch: 0, venue: 0, market: 0 };
  const empty: PassResult = { stored: 0, none: 0, failed: 0, letters: 0, bySource, skippedForTime: 0 };
  if ((await deps.db.query(MIGRATED_SQL, [])).length === 0) {
    deps.log('coin logos wait for migration 0071', {});
    return empty;
  }
  const { shown, backfill } = await dueCoins(deps.db, deps.nowMs);
  const due = [...shown, ...backfill];
  if (due.length === 0) return empty;

  /* One batch read of the market source for the whole pass; an outage there is not "no picture". */
  let market: ReadonlyMap<string, string | null> | null = null;
  try {
    market = await deps.marketImages(due.map((c) => c.address));
  } catch (e) {
    deps.log('market pictures unavailable', { err: errText(e) });
  }

  let venueFailsInRow = 0;
  let venueEverOk = false;
  const venueOpen = () => venueEverOk || venueFailsInRow < VENUE_TRIP;
  const venueResult = (ok: boolean) => {
    if (ok) {
      venueEverOk = true;
      venueFailsInRow = 0;
    } else venueFailsInRow += 1;
  };

  let stored = 0;
  let none = 0;
  let failed = 0;
  let letters = 0;
  let done = 0;
  for (let i = 0; i < due.length; i += CONCURRENCY) {
    if (deps.elapsedMs() > PASS_BUDGET_MS) break;
    await Promise.all(
      due.slice(i, i + CONCURRENCY).map(async (coin) => {
        const r = await resolveCoin(coin, deps, market, venueOpen, venueResult);
        await deps.db.query(RECORD_SQL, [coin.address, r.outcome, r.source, r.why]);
        done += 1;
        if (r.outcome === 'stored') {
          stored += 1;
          bySource[r.source] += 1;
          return;
        }
        if (r.outcome === 'none') none += 1;
        else failed += 1;
        const attempts = r.outcome === 'failed' && coin.lastOutcome === 'failed' ? coin.attempts + 1 : 1;
        if (r.outcome === 'none' || attempts >= MAX_ATTEMPTS) {
          letters += 1;
          deps.log('coin logo is a letter', { address: coin.address, outcome: r.outcome, attempts, why: r.why });
        }
      }),
    );
  }
  return { stored, none, failed, letters, bySource, skippedForTime: due.length - done };
}
