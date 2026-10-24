/**
 * GET /sell/:signature/card — the facts the phone's flex card is drawn from after a sell
 * (mobile features/trade/ShareTradeSheet.tsx): where the person bought in, where they sold, the
 * multiple between the two, the SOL the sell made or lost, and the post the coin came from.
 *
 * Its own file, apart from wallet.ts, because it answers about ONE trade by its signature rather
 * than about a wallet, and because its numbers are the claims a person will post publicly: they are
 * held here in pure functions with their own tests, not computed inside a route.
 *
 * ★ EACH TRADE'S CAP IS ITS OWN EXECUTION'S, NOT THE MARKET'S LAST READING. The cap the trade
 * service stamps on a landed trade (`market_cap_usd`, 0109) is the newest market reading in the ten
 * minutes before it landed — one reading every few minutes. A buy and a sell 24 seconds apart got
 * the SAME reading (KURIBO, 24 Oct 2026: both $277,033 from 01:32:30), and the card said 1.0× on a
 * trade that lost SOL. So each trade's cap is worked out from what it traded:
 *   price per coin   the SOL it paid or got over the coins it got or gave (lamports over 1e9, coins
 *                    over 10^decimals). Every trade is SOL against the coin — a coin paired with
 *                    something else is still bought and sold for SOL through the router.
 *   × SOL in dollars the close of SOL's one-minute candle at the minute the trade landed, from the
 *                    same market data source the token page's chart uses (`solCandles`). A past
 *                    minute's close never changes, so each minute is asked once and kept.
 *   × supply         the coin's own market reading nearest the sell: its cap over its price, so the
 *                    card's cap is on the same basis (circulating or diluted) as the cap shown
 *                    everywhere else in the app. No reading: a launchpad coin (address ending
 *                    `pump`) is minted at exactly 1e9 coins of 6 decimals; anything else is unknown.
 * The amounts are the QUOTES the trade service recorded (`in_amount`/`out_amount`, 0062) — the side
 * the person typed is exact, the other side is the quote before slippage (at most `slippage_bps`
 * worse; a buy usually lands with a few more coins than quoted). Settled amounts are not stored.
 * The recorded `market_cap_usd` is used only for a trade whose amounts are missing.
 *   bought     the person's average entry: each landed buy's own cap before the sell, weighted by
 *              the coins each bought (the cap at the average price paid). One buy unknown makes the
 *              average unknown — leaving it out would claim an entry the person did not have.
 *   sold       the sell's own cap.
 *   multiple   sold / bought — the ratio of the prices, moved only by SOL's dollar move between the
 *              trades. Without SOL's dollar price it is still the price ratio, which needs none.
 *              Below 1 is a loss and is said as one.
 *   profit     the sell's SOL minus what the coins it sold cost at the average cost of the buys
 *              (Trador's average-cost rule, wallet.ts). From the quotes, so slippage can move the
 *              real figure a little; never invented when a side is missing. A sell of more coins
 *              than the buys here left (bought elsewhere too) has no profit: the cost of the rest is
 *              not ours to know.
 * Each unknown is a reason, not a zero; the phone leaves that element off the card. A reply missing
 * SOL's price because the source did not answer is not kept, so the phone's next ask can fill it.
 *
 * ★ A SELL THAT HAS NOT LANDED IS `pending`, NOT A CARD. The trade service records the sell as sent
 * and only later as confirmed (records.ts, about two and a half minutes at most). The phone asks
 * again until it lands; a sell never seen landing never gets a card, because as far as anyone can
 * tell it did not happen.
 *
 * ★ THE POST IS THE EARLIEST POST WHOSE CARD WAS MATCHED TO THIS COIN on a feed (public.feed_post's
 * `coins.kind = 'matched'`): the post the coin came from, the same match the post sheet's Buy uses.
 * Its picture is named only by our stored copy (public.post_picture, 0119), never the source's link,
 * because the phone draws it onto a canvas and only our storage answers with the CORS header that
 * allows that. No copy: no picture, and the phone uses the Insidor background.
 *
 * Public facts only (a signature, and trades already on the chain), so no sign-in; a reply is kept
 * ten minutes once the sell landed, and each client may ask `PER_CLIENT` times a minute.
 *
 * What breaks if changed carelessly: reading a buy's coins from `in_amount`. A buy is SOL in, coins
 * out; a sell is coins in, SOL out (wallet.ts `tradesFromRecord`). Swapped, every price, every cap
 * and every profit is nonsense that looks like a number. And the decimals: a coin's units read as
 * whole coins put its cap a million times too low.
 */

import { pictureFiles } from './post-pics.ts';
import type { Db, Row } from './queries.ts';
import type { Logger } from './log.ts';

/** The sell, by its signature (trade_signature_idx, 0062). */
export const SELL_SQL = `
select id, wallet, mint, kind, status, in_amount::text as in_amount, out_amount::text as out_amount,
       market_cap_usd, (extract(epoch from settled_at) * 1000)::bigint as settled_ms
  from public.trade
 where signature = $1
 order by coalesce(settled_at, sent_at, built_at) desc
 limit 1`;

/**
 * The same wallet's landed buys and sells of the coin before the sell (trade_landed_idx, 0109). "Before"
 * is against the sell's own stored time, not a millisecond copy of it: rounded to the millisecond,
 * the sell can land after itself and be counted as an earlier sell of its own coins.
 */
export const EARLIER_SQL = `
select t.kind, t.in_amount::text as in_amount, t.out_amount::text as out_amount, t.market_cap_usd,
       (extract(epoch from t.settled_at) * 1000)::bigint as settled_ms
  from public.trade t, public.trade s
 where s.id = $3 and t.wallet = $1 and t.mint = $2 and t.status = 'confirmed' and t.kind in ('buy', 'sell')
   and t.settled_at is not null and t.settled_at < s.settled_at
 order by t.settled_at asc`;

/**
 * The coin's decimals, and its supply read off its market reading nearest the sell (the newest at or
 * before it, else the first after): cap over price. Both walk market_reading's primary key.
 */
export const SCALE_SQL = `
select (select a.decimals from public.asset a where a.chain = 'solana' and a.address = $1) as decimals,
       coalesce(
         (select m.market_cap_usd / m.price_usd from public.market_reading m
           where m.chain = 'solana' and m.address = $1 and m.market_cap_usd > 0 and m.price_usd > 0
             and m.taken_at <= to_timestamp($2::double precision / 1000)
           order by m.taken_at desc limit 1),
         (select m.market_cap_usd / m.price_usd from public.market_reading m
           where m.chain = 'solana' and m.address = $1 and m.market_cap_usd > 0 and m.price_usd > 0
             and m.taken_at > to_timestamp($2::double precision / 1000)
           order by m.taken_at asc limit 1)) as supply`;

/** The earliest-posted post whose card was matched to the coin, with its poster. */
export const COIN_POST_SQL = `
select f.item_id, (extract(epoch from i.posted_at) * 1000)::bigint as posted_ms,
       f.payload ->> 'authorLabel' as author, f.payload ->> 'thumbUrl' as thumb,
       to_jsonb(a) ->> 'picture_copy' as author_file
  from public.feed_post f
  join public.item i on i.item_id = f.item_id
  left join public.author a on a.author_key = i.author_key
 where f.payload #>> '{coins,kind}' = 'matched' and f.payload #>> '{coins,coin,address}' = $1
 order by i.posted_at asc nulls last, f.item_id asc
 limit 1`;

export const COIN_NAME_SQL = `select ticker, name from public.coin_name where address = $1`;

/** A landed trade as the numbers need it: base units, exact. */
export interface CardTrade {
  readonly kind: 'buy' | 'sell';
  /** Lamports: what a buy paid, what a sell received. */
  readonly lamports: bigint;
  /** The coin's base units: what a buy got, what a sell gave. */
  readonly coins: bigint;
  /** The cap the trade service recorded when it landed: used only when the amounts are missing. */
  readonly capUsd: number | null;
  /** When it landed, ms; null when not recorded. */
  readonly atMs: number | null;
}

/** What turns a trade's price per coin into a cap. */
export interface CardScale {
  /** The coin's decimals; null when unknown. */
  readonly decimals: number | null;
  /** Whole coins the cap is over; null when unknown. */
  readonly supply: number | null;
  /** SOL's dollar price at a landing time, or null when it was not read. */
  readonly solUsdAt: (ms: number | null) => number | null;
}

export type Measured = { readonly v: number } | { readonly v: null; readonly why: string };

export interface CardNumbers {
  readonly boughtCapUsd: Measured;
  readonly soldCapUsd: Measured;
  readonly multiple: Measured;
  readonly profitSol: Measured;
}

/** A sell may give this much more than the buys here left before it is "bought elsewhere too":
    the buys' coin amounts are quotes, and the coins that landed can be a little more. */
const OVER_HELD_PCT = 105n;
const LAMPORTS_PER_SOL = 1e9;
/** What the launchpad mints every coin with: exactly this many coins, of this many decimals. */
const LAUNCHPAD_SUPPLY = 1e9;
const LAUNCHPAD_DECIMALS = 6;
const LAUNCHPAD_SUFFIX = 'pump';

const known = (v: number): Measured => ({ v });
const unknown = (why: string): Measured => ({ v: null, why });
const cap = (v: number | null): v is number => v !== null && Number.isFinite(v) && v > 0;
const hasAmounts = (t: CardTrade): boolean => t.lamports > 0n && t.coins > 0n;

/** SOL per whole coin, from a trade's amounts. */
function priceSol(t: CardTrade, decimals: number): number {
  return Number(t.lamports) / LAMPORTS_PER_SOL / (Number(t.coins) / 10 ** decimals);
}

/**
 * One trade's cap from its own execution (the header's rule); the recorded cap only when its
 * amounts are missing. Pure.
 */
export function executionCapUsd(t: CardTrade, scale: CardScale): Measured {
  if (!hasAmounts(t)) return cap(t.capUsd) ? known(t.capUsd) : unknown('not_recorded');
  if (scale.decimals === null || scale.supply === null || !cap(scale.supply)) return unknown('not_recorded');
  const solUsd = scale.solUsdAt(t.atMs);
  if (solUsd === null || !cap(solUsd)) return unknown('not_read_yet');
  const v = priceSol(t, scale.decimals) * solUsd * scale.supply;
  return cap(v) ? known(v) : unknown('not_recorded');
}

/**
 * The card's four numbers for one sell, from the trades before it (oldest first). Pure: the rules in
 * the header, each unknown with its reason.
 */
export function cardNumbers(sell: CardTrade, earlier: readonly CardTrade[], scale: CardScale): CardNumbers {
  const buys = earlier.filter((t) => t.kind === 'buy' && hasAmounts(t));
  const sold = earlier.filter((t) => t.kind === 'sell' && t.coins > 0n);
  const soldCapUsd = executionCapUsd(sell, scale);

  if (buys.length === 0) {
    const none = unknown('not_bought_here');
    return { boughtCapUsd: none, soldCapUsd, multiple: none, profitSol: none };
  }

  /* The cap at the average price paid: each buy's own cap weighted by the coins it bought. */
  const coinsBought = buys.reduce((s, b) => s + b.coins, 0n);
  const lamportsPaid = buys.reduce((s, b) => s + b.lamports, 0n);
  const buyCaps = buys.map((b) => executionCapUsd(b, scale));
  const missing = buyCaps.find((c) => c.v === null);
  const boughtCapUsd: Measured =
    missing !== undefined ? missing : known(buys.reduce((s, b, i) => s + Number(b.coins) * (buyCaps[i]?.v as number), 0) / Number(coinsBought));

  /* Sold over bought; with a cap unknown, the price ratio, which needs neither SOL's price nor the supply. */
  let multiple: Measured;
  if (boughtCapUsd.v !== null && soldCapUsd.v !== null) multiple = known(soldCapUsd.v / boughtCapUsd.v);
  else if (hasAmounts(sell)) multiple = known((Number(sell.lamports) / Number(sell.coins)) / (Number(lamportsPaid) / Number(coinsBought)));
  else multiple = unknown('not_recorded');

  /* Average cost: the sell's coins at what the buys paid per coin. */
  let profitSol: Measured;
  const heldHere = coinsBought - sold.reduce((s, t) => s + t.coins, 0n);
  if (!hasAmounts(sell)) profitSol = unknown('not_recorded');
  else if (heldHere <= 0n || sell.coins * 100n > heldHere * OVER_HELD_PCT) profitSol = unknown('bought_elsewhere');
  else {
    const cost = (sell.coins * lamportsPaid) / coinsBought;
    profitSol = known(Number(sell.lamports - cost) / LAMPORTS_PER_SOL);
  }

  return { boughtCapUsd, soldCapUsd, multiple, profitSol };
}

/**
 * A trade row as a CardTrade; null for a row that is not a buy or a sell. Missing amounts read as
 * zero units, which every rule above treats as "not recorded", never as a trade of nothing.
 */
export function cardTrade(r: Row): CardTrade | null {
  const kind = r['kind'];
  if (kind !== 'buy' && kind !== 'sell') return null;
  const inAmount = whole(r['in_amount']) ?? 0n;
  const outAmount = whole(r['out_amount']) ?? 0n;
  const c = r['market_cap_usd'];
  const capUsd = typeof c === 'number' ? c : typeof c === 'string' && c !== '' ? Number(c) : null;
  const atMs = ms(r['settled_ms']);
  return kind === 'buy'
    ? { kind, lamports: inAmount, coins: outAmount, capUsd, atMs }
    : { kind, lamports: outAmount, coins: inAmount, capUsd, atMs };
}

/** The coin's decimals and supply from SCALE_SQL's row, with the launchpad's fixed mint as the fallback. */
export function coinScale(mint: string, row: Row | undefined): { readonly decimals: number | null; readonly supply: number | null } {
  const d = Number(row?.['decimals']);
  const s = Number(row?.['supply']);
  const launchpad = mint.endsWith(LAUNCHPAD_SUFFIX);
  const decimals = row?.['decimals'] !== null && row?.['decimals'] !== undefined && Number.isInteger(d) && d >= 0 ? d : launchpad ? LAUNCHPAD_DECIMALS : null;
  const supply = row?.['supply'] !== null && row?.['supply'] !== undefined && cap(s) ? s : launchpad ? LAUNCHPAD_SUPPLY : null;
  return { decimals, supply };
}

/** A SOL one-minute candle: its minute's start and its close in dollars. */
export interface SolCandle {
  readonly t: number;
  readonly c: number;
}

const MINUTE_MS = 60_000;
/** A landing with no SOL candle in its own minute takes the close this many minutes before at most. */
const SOL_NEAR_MINUTES = 5;
/** One candle request covers at most this many minutes (the source's own page). */
const SOL_SPAN_MINUTES = 1_000;
/** A card asks SOL's price at most this many times; a buy further back than that is unknown. */
const SOL_CALLS_PER_CARD = 4;
/** Past minutes kept; a past minute's close never changes, so this bounds memory only. */
const SOL_MINUTES_KEPT = 50_000;

/** SOL's close for a landing time from kept minute closes: its own minute, else the nearest before. Pure. */
export function solUsdNear(closes: ReadonlyMap<number, number>, at: number | null): number | null {
  if (at === null) return null;
  const minute = Math.floor(at / MINUTE_MS) * MINUTE_MS;
  for (let back = 0; back <= SOL_NEAR_MINUTES; back++) {
    const c = closes.get(minute - back * MINUTE_MS);
    if (c !== undefined) return c;
  }
  return null;
}

/**
 * The candle requests that cover these landing times, newest first: each one ends after its newest
 * time and reaches back over every time within a page of it. Pure.
 */
export function solRequests(times: readonly number[]): readonly { readonly untilMs: number; readonly minutes: number }[] {
  const sorted = [...new Set(times.map((t) => Math.floor(t / MINUTE_MS) * MINUTE_MS))].sort((a, b) => b - a);
  const out: { untilMs: number; minutes: number }[] = [];
  let i = 0;
  while (i < sorted.length && out.length < SOL_CALLS_PER_CARD) {
    const newest = sorted[i] as number;
    const untilMs = newest + MINUTE_MS;
    let oldest = newest;
    while (i < sorted.length && (untilMs - (sorted[i] as number)) / MINUTE_MS + SOL_NEAR_MINUTES <= SOL_SPAN_MINUTES) oldest = sorted[i++] as number;
    out.push({ untilMs, minutes: (untilMs - oldest) / MINUTE_MS + SOL_NEAR_MINUTES });
  }
  return out;
}

function whole(v: unknown): bigint | null {
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return null;
  return BigInt(v);
}

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const FILE = /^[0-9a-f]{32}$/;
/** A landed sell's facts do not change; the post's picture copy may arrive later, so not forever. */
const KEEP_MS = 600_000;
const WINDOW_MS = 60_000;
const PER_CLIENT = 30;

export interface TradeCardDeps {
  readonly db: Db;
  readonly log: Logger;
  readonly now: () => number;
  /**
   * SOL's one-minute dollar candles ending before `untilMs`, at most `minutes` of them (the token
   * page's market data source). Null when there is none: every cap is then unknown, the multiple
   * and profit still stand on the amounts.
   */
  readonly solCandles: ((untilMs: number, minutes: number) => Promise<readonly SolCandle[]>) | null;
}

const json = (status: number, value: unknown) => ({ status, body: JSON.stringify(value) });
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const ms = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && Number.isFinite(n) && n > 0 ? n : null;
};

export function createTradeCard(deps: TradeCardDeps) {
  const kept = new Map<string, { at: number; reply: { status: number; body: string } }>();
  const calls = new Map<string, number[]>();
  /** SOL's close per past minute start; the current minute is never kept, it is still moving. */
  const solCloses = new Map<number, number>();

  /** Fill the kept closes for these times; returns the still-open minute's closes, for this reply only. */
  async function readSol(times: readonly number[]): Promise<Map<number, number>> {
    const live = new Map<number, number>();
    const solCandles = deps.solCandles;
    if (solCandles === null) return live;
    const open = Math.floor(deps.now() / MINUTE_MS) * MINUTE_MS;
    const need = times.filter((t) => !solCloses.has(Math.floor(t / MINUTE_MS) * MINUTE_MS));
    await Promise.all(
      solRequests(need).map(async (r) => {
        try {
          const candles = await solCandles(r.untilMs, r.minutes);
          if (solCloses.size > SOL_MINUTES_KEPT) solCloses.clear();
          for (const c of candles) if (cap(c.c)) (c.t < open ? solCloses : live).set(c.t, c.c);
        } catch (e) {
          deps.log.info('trade card sol price unavailable', { err: e instanceof Error ? e.message : String(e) });
        }
      }),
    );
    return live;
  }

  async function post(mint: string) {
    const row = (await deps.db.query(COIN_POST_SQL, [mint]))[0];
    if (row === undefined) return null;
    const thumb = str(row['thumb']);
    const files = thumb === null ? new Map<string, string>() : await pictureFiles(deps.db, [thumb]);
    const pictureFile = thumb === null ? null : (files.get(thumb.split(/[?#]/, 1)[0] ?? thumb) ?? null);
    const author = str(row['author']);
    const authorFile = str(row['author_file']);
    return {
      id: str(row['item_id']),
      postedAt: ms(row['posted_ms']),
      author: author !== null && author.startsWith('@') ? author : null,
      authorPictureFile: authorFile !== null && FILE.test(authorFile) ? authorFile : null,
      pictureFile,
    };
  }

  async function read(signature: string) {
    const row = (await deps.db.query(SELL_SQL, [signature]))[0];
    if (row === undefined) return { reply: json(200, { kind: 'none', why: 'not_found' }), keep: false };
    if (row['kind'] !== 'sell') return { reply: json(200, { kind: 'none', why: 'not_a_sell' }), keep: true };
    const status = row['status'];
    if (status === 'failed' || status === 'send_fail') return { reply: json(200, { kind: 'none', why: 'failed' }), keep: true };
    const settled = ms(row['settled_ms']);
    if (status !== 'confirmed' || settled === null) return { reply: json(200, { kind: 'pending' }), keep: false };

    const mint = str(row['mint']);
    const sell = cardTrade(row);
    if (mint === null || sell === null) return { reply: json(200, { kind: 'none', why: 'not_recorded' }), keep: true };
    const [earlierRows, scaleRows, names, coinPost] = await Promise.all([
      deps.db.query(EARLIER_SQL, [row['wallet'], mint, row['id']]),
      deps.db.query(SCALE_SQL, [mint, settled]),
      deps.db.query(COIN_NAME_SQL, [mint]),
      post(mint),
    ]);
    const earlier = earlierRows.flatMap((r) => cardTrade(r) ?? []);
    const times = [sell, ...earlier.filter((t) => t.kind === 'buy')].flatMap((t) => (t.atMs === null ? [] : [t.atMs]));
    const live = await readSol(times);
    const numbers = cardNumbers(sell, earlier, {
      ...coinScale(mint, scaleRows[0]),
      solUsdAt: (at) => solUsdNear(live, at) ?? solUsdNear(solCloses, at),
    });
    const name = names[0];
    const unread = [numbers.boughtCapUsd, numbers.soldCapUsd].some((m) => m.v === null && m.why === 'not_read_yet');
    return {
      reply: json(200, {
        kind: 'read',
        mint,
        ticker: name === undefined ? null : str(name['ticker']),
        name: name === undefined ? null : str(name['name']),
        soldAt: settled,
        ...numbers,
        post: coinPost,
      }),
      keep: !unread,
    };
  }

  return {
    async card(signature: string, client: string) {
      if (!SIGNATURE.test(signature)) return json(400, { error: 'bad request' });
      const now = deps.now();
      const recent = (calls.get(client) ?? []).filter((t) => now - t < WINDOW_MS);
      if (recent.length >= PER_CLIENT) return json(429, { error: 'slow down' });
      calls.set(client, [...recent, now]);
      const held = kept.get(signature);
      if (held !== undefined && now - held.at < KEEP_MS) return held.reply;
      const { reply, keep } = await read(signature);
      for (const [k, v] of kept) if (now - v.at >= KEEP_MS) kept.delete(k);
      if (keep) kept.set(signature, { at: now, reply });
      return reply;
    },
  };
}

export type TradeCard = ReturnType<typeof createTradeCard>;
