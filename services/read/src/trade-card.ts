/**
 * GET /sell/:signature/card — the facts the phone's flex card is drawn from after a sell
 * (mobile features/trade/ShareTradeSheet.tsx): where the person bought in, where they sold, the
 * multiple between the two, the SOL the sell made or lost, and the post the coin came from.
 *
 * Its own file, apart from wallet.ts, because it answers about ONE trade by its signature rather
 * than about a wallet, and because its numbers are the claims a person will post publicly: they are
 * held here in pure functions with their own tests, not computed inside a route.
 *
 * ★ ONLY OUR OWN RECORD, NEVER A GUESS. Every number comes from `public.trade` (0062, 0109): the
 * coin's market cap the trade service recorded when each trade landed, and the quoted SOL and coin
 * amounts. Nothing is fetched from a market here — no new paid call — and nothing is estimated.
 *   bought     the person's average entry: the market caps of their landed buys of this coin before
 *              the sell, weighted by the coins each bought (the cap at the average price paid). A
 *              buy with no recorded cap makes the average unknown — leaving it out would claim an
 *              entry the person did not have.
 *   sold       the sell's recorded market cap.
 *   multiple   sold / bought. Below 1 is a loss and is said as one.
 *   profit     the sell's SOL minus what the coins it sold cost at the average cost of the buys
 *              (Trador's average-cost rule, wallet.ts). From the quotes the trade service recorded,
 *              so slippage can move the real figure a little; never invented when a side is missing.
 *              A sell of more coins than the buys here left (bought elsewhere too) has no profit: the
 *              cost of the rest is not ours to know.
 * Each unknown is a reason, not a zero; the phone leaves that element off the card.
 *
 * ★ A SELL THAT HAS NOT LANDED IS `pending`, NOT A CARD. The trade service records the sell as sent
 * and only later as confirmed (records.ts, about two and a half minutes at most), and the market cap
 * is recorded at that moment. The phone asks again until it lands; a sell never seen landing never
 * gets a card, because as far as anyone can tell it did not happen.
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
 * out; a sell is coins in, SOL out (wallet.ts `tradesFromRecord`). Swapped, every multiple and every
 * profit is nonsense that looks like a number.
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
select t.kind, t.in_amount::text as in_amount, t.out_amount::text as out_amount, t.market_cap_usd
  from public.trade t, public.trade s
 where s.id = $3 and t.wallet = $1 and t.mint = $2 and t.status = 'confirmed' and t.kind in ('buy', 'sell')
   and t.settled_at is not null and t.settled_at < s.settled_at
 order by t.settled_at asc`;

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
  readonly capUsd: number | null;
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

const known = (v: number): Measured => ({ v });
const unknown = (why: string): Measured => ({ v: null, why });
const cap = (v: number | null): v is number => v !== null && Number.isFinite(v) && v > 0;

/**
 * The card's four numbers for one sell, from the trades before it (oldest first). Pure: the rules in
 * the header, each unknown with its reason.
 */
export function cardNumbers(sell: CardTrade, earlier: readonly CardTrade[]): CardNumbers {
  const buys = earlier.filter((t) => t.kind === 'buy' && t.lamports > 0n && t.coins > 0n);
  const sold = earlier.filter((t) => t.kind === 'sell' && t.coins > 0n);
  const soldCapUsd = cap(sell.capUsd) ? known(sell.capUsd) : unknown('not_recorded');

  if (buys.length === 0) {
    const none = unknown('not_bought_here');
    return { boughtCapUsd: none, soldCapUsd, multiple: none, profitSol: none };
  }

  /* The cap at the average price paid: each buy's cap weighted by the coins it bought. */
  const coinsBought = buys.reduce((s, b) => s + b.coins, 0n);
  let boughtCapUsd: Measured;
  if (buys.every((b) => cap(b.capUsd))) {
    const weighted = buys.reduce((s, b) => s + Number(b.coins) * (b.capUsd as number), 0);
    boughtCapUsd = known(weighted / Number(coinsBought));
  } else {
    boughtCapUsd = unknown('not_recorded');
  }

  const multiple = boughtCapUsd.v !== null && soldCapUsd.v !== null ? known(soldCapUsd.v / boughtCapUsd.v) : unknown('not_recorded');

  /* Average cost: the sell's coins at what the buys paid per coin. */
  let profitSol: Measured;
  const heldHere = coinsBought - sold.reduce((s, t) => s + t.coins, 0n);
  if (sell.lamports <= 0n || sell.coins <= 0n) profitSol = unknown('not_recorded');
  else if (heldHere <= 0n || sell.coins * 100n > heldHere * OVER_HELD_PCT) profitSol = unknown('bought_elsewhere');
  else {
    const lamportsPaid = buys.reduce((s, b) => s + b.lamports, 0n);
    const cost = (sell.coins * lamportsPaid) / coinsBought;
    profitSol = known(Number(sell.lamports - cost) / LAMPORTS_PER_SOL);
  }

  return { boughtCapUsd, soldCapUsd, multiple, profitSol };
}

/** A trade row as a CardTrade; null for a row whose amounts are not whole positive numbers. */
export function cardTrade(r: Row): CardTrade | null {
  const kind = r['kind'];
  if (kind !== 'buy' && kind !== 'sell') return null;
  const inAmount = whole(r['in_amount']);
  const outAmount = whole(r['out_amount']);
  if (inAmount === null || outAmount === null) return null;
  const c = r['market_cap_usd'];
  const capUsd = typeof c === 'number' ? c : typeof c === 'string' && c !== '' ? Number(c) : null;
  return kind === 'buy'
    ? { kind, lamports: inAmount, coins: outAmount, capUsd }
    : { kind, lamports: outAmount, coins: inAmount, capUsd };
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
    const earlier = (await deps.db.query(EARLIER_SQL, [row['wallet'], mint, row['id']])).flatMap((r) => cardTrade(r) ?? []);
    const [names, coinPost] = await Promise.all([deps.db.query(COIN_NAME_SQL, [mint]), post(mint)]);
    const name = names[0];
    return {
      reply: json(200, {
        kind: 'read',
        mint,
        ticker: name === undefined ? null : str(name['ticker']),
        name: name === undefined ? null : str(name['name']),
        soldAt: settled,
        ...cardNumbers(sell, earlier),
        post: coinPost,
      }),
      keep: true,
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
