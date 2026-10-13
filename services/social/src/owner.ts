/**
 * THE OWNER'S CALLS: the only routes here that change what the feeds show, so the only routes that
 * ask WHO, not just whether someone is signed in.
 *
 *   GET  /me/owner                          { owner: boolean } — whether the app draws the controls
 *   POST /owner/feedback { kind, itemId, call, coin?, name?, ticker?, betterName?, note?, shown? }
 *   GET  /owner/feedback?kind=&items=a,b    the current call on each item (and name)
 *   GET  /owner/hidden                      posts whose current call is "Not a meme", newest first
 *   POST /owner/coin-check, /owner/coin-label   a pasted coin address checked, then saved (owner-coin.ts)
 *
 * A coin call `cleared` (0072) is "Remove my label": a new row that says no call from here on.
 *
 * ★ THE SERVER IS THE GATE; THE APP ONLY HIDES BUTTONS. A person is the owner when a wallet or the
 * X handle in their SIGNED sign-in token is listed in policy `owner` — never anything the request
 * says about itself. Anyone else gets 403 on every /owner route, signed in or not (401 first when
 * not), and /me/owner answers false. An empty owner list means nobody, never everybody.
 *
 * ★ APPEND-ONLY (internal.owner_feedback, 0054). Every tap is a new row with the date; the newest
 * row per item (per name, for names) is the call. "Is a meme" after "Not a meme" is not an undo,
 * it is a second call, and the re-tune sees both.
 *
 * Its own file, apart from routes.ts, because none of it is social: these rows are training data
 * for the judge, the matching rules and the name suggestions, and what the projector hides. The
 * `call` key on the wire is the column `verdict`: that word is the system's, not the screen's.
 *
 * What breaks if changed carelessly: `ownerRefOf`. Comparing wallets case-insensitively would make
 * two different addresses one (the alphabet is case-sensitive); comparing handles case-sensitively
 * would lock the owner out on a capital letter. And `shown` is display-only: it is the owner's own
 * client's copy of a card, and nothing here may decide anything from it.
 */

import type { OwnerPolicy } from '@insidor/contracts/policy.ts';
import type { Person } from '@insidor/contracts/ports/people.ts';

import { json, type Reply } from './http.ts';
import { ownerCoinRoute, type CoinCheck } from './owner-coin.ts';

interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R[]>;
}

export const FEEDBACK_KINDS = ['post', 'coin_match', 'name'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

const CALLS: Readonly<Record<FeedbackKind, readonly string[]>> = {
  post: ['meme', 'not'],
  coin_match: ['right', 'wrong', 'none', 'cleared'],
  name: ['up', 'down'],
};

/** One call, checked. Every optional field is null rather than absent, as the row stores it. */
export interface Feedback {
  readonly kind: FeedbackKind;
  readonly itemId: string;
  readonly call: string;
  readonly coin: string | null;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly betterName: string | null;
  readonly note: string | null;
  readonly shown: Readonly<Record<string, string | number | boolean | null>> | null;
}

const ITEM_ID = /^[A-Za-z0-9_:.\-]{1,200}$/;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_NOTE = 200;
const MAX_NAME = 80;
const MAX_TICKER = 20;
const MAX_ITEMS = 100;
const MAX_HIDDEN = 200;
const MAX_SHOWN_TEXT = 600;

/** The card facts kept beside a call: these keys, these types, nothing else. */
const SHOWN_KEYS: Readonly<Record<string, 'text' | 'link' | 'number' | 'flag'>> = {
  excerpt: 'text',
  authorLabel: 'text',
  sourceLabel: 'text',
  line: 'text',
  coinId: 'text',
  permalink: 'link',
  thumbUrl: 'link',
  thumbIsVideo: 'flag',
  postedAt: 'number',
};

/** The owner reference that matched, `wallet:<address>` or `x:<handle>`; null for everyone else. */
export function ownerRefOf(person: Person, owner: OwnerPolicy | undefined): string | null {
  if (owner === undefined) return null;
  const wallet = person.wallets.find((w) => owner.wallets.includes(w.address));
  if (wallet !== undefined) return `wallet:${wallet.address}`;
  const handle = person.handle?.replace(/^@/, '').toLowerCase() ?? null;
  if (handle !== null && owner.xHandles.some((h) => h.replace(/^@/, '').toLowerCase() === handle)) return `x:${handle}`;
  return null;
}

const text = (v: unknown, max: number): string | null | 'bad' => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return 'bad';
  const t = v.replace(/\s+/g, ' ').trim();
  if (t === '') return null;
  return t.length > max ? 'bad' : t;
};

function shownOf(v: unknown): Feedback['shown'] | 'bad' {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return 'bad';
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const type = SHOWN_KEYS[k];
    if (type === undefined || raw === null || raw === undefined) continue;
    if (type === 'flag' && typeof raw === 'boolean') out[k] = raw;
    if (type === 'number' && typeof raw === 'number' && Number.isFinite(raw)) out[k] = raw;
    if (type === 'text' && typeof raw === 'string') out[k] = raw.slice(0, MAX_SHOWN_TEXT);
    if (type === 'link' && typeof raw === 'string' && raw.startsWith('https://') && raw.length <= MAX_SHOWN_TEXT * 2) out[k] = raw;
  }
  return Object.keys(out).length === 0 ? null : out;
}

/** The request body as one call, or the sentence saying what is wrong with it. */
export function parseFeedback(body: unknown): Feedback | string {
  if (typeof body !== 'object' || body === null) return 'Send a call.';
  const b = body as Record<string, unknown>;
  const kind = FEEDBACK_KINDS.find((k) => k === b['kind']);
  if (kind === undefined) return 'A call is about a post, a coin match or a name.';
  const itemId = typeof b['itemId'] === 'string' ? b['itemId'].trim() : '';
  if (!ITEM_ID.test(itemId)) return 'That item id is not one we hold.';
  const call = typeof b['call'] === 'string' ? b['call'] : '';
  if (!CALLS[kind].includes(call)) return `A ${kind.replace('_', ' ')} call is one of ${CALLS[kind].join(', ')}.`;
  const note = text(b['note'], MAX_NOTE);
  if (note === 'bad') return `A note is up to ${MAX_NOTE} characters.`;
  const shown = shownOf(b['shown']);
  if (shown === 'bad') return 'That card could not be read.';

  let coin: string | null = null;
  let name: string | null = null;
  let ticker: string | null = null;
  let betterName: string | null = null;
  if (kind === 'coin_match') {
    const raw = typeof b['coin'] === 'string' ? b['coin'].replace(/^solana:/, '') : b['coin'] === undefined || b['coin'] === null ? null : '';
    if (raw !== null && !MINT.test(raw)) return 'That coin address is not a coin address.';
    if (call === 'none' && raw !== null) return '"No coin is from this" names no coin.';
    if (call === 'cleared' && raw !== null) return '"Remove my label" names no coin.';
    if (call === 'right' && raw === null) return '"Right coin" names the coin.';
    coin = raw;
  }
  if (kind === 'name') {
    const n = text(b['name'], MAX_NAME);
    if (n === 'bad' || n === null) return 'Say which name this is about.';
    const t = text(b['ticker'], MAX_TICKER);
    if (t === 'bad') return `A ticker is up to ${MAX_TICKER} characters.`;
    const better = text(b['betterName'], MAX_NAME);
    if (better === 'bad') return `A better name is up to ${MAX_NAME} characters.`;
    name = n;
    ticker = t;
    betterName = better;
  }
  return { kind, itemId, call, coin, name, ticker, betterName, note, shown };
}

interface CallRow {
  kind: FeedbackKind;
  itemId: string;
  call: string;
  coin: string | null;
  name: string | null;
  ticker: string | null;
  betterName: string | null;
  note: string | null;
  at: number;
}

const CALL_COLS = `subject_kind as kind, item_id as "itemId", verdict as call, coin_address as coin, name, ticker,
  better_name as "betterName", note, (extract(epoch from created_at) * 1000)::float8 as at`;

export interface OwnerDeps {
  readonly db: Db;
  readonly owner?: OwnerPolicy;
  /** Reads a pasted coin address on the launchpad and the market sources; absent, the check says it is not set up. */
  readonly coinCheck?: CoinCheck;
}

const bad = (error: string, status = 400): Reply => json(status, { error });

/**
 * The owner routes, or null when the path is not one of them. `me` is the signed-in person
 * (routes.ts verified the token), or null.
 */
export async function ownerRoute(
  r: { readonly method: string; readonly seg: readonly string[]; readonly query: URLSearchParams; readonly body: unknown },
  me: Person | null,
  deps: OwnerDeps,
): Promise<Reply | null> {
  const [head, sub] = r.seg;
  if (head === 'me' && sub === 'owner' && r.seg.length === 2) {
    if (r.method !== 'GET') return bad('method not allowed', 405);
    return json(200, { owner: me !== null && ownerRefOf(me, deps.owner) !== null });
  }
  if (head !== 'owner' || r.seg.length !== 2) return null;
  if (me === null) return bad('Sign in first.', 401);
  const ref = ownerRefOf(me, deps.owner);
  if (ref === null) return bad('Only the owner can do this.', 403);

  if (sub === 'feedback' && r.method === 'POST') {
    const f = parseFeedback(r.body);
    if (typeof f === 'string') return bad(f);
    const [row] = await deps.db.query<CallRow>(
      `insert into internal.owner_feedback (owner_ref, user_id, subject_kind, item_id, verdict, coin_address, name, ticker, better_name, note, shown)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       returning ${CALL_COLS}`,
      [ref, me.userId, f.kind, f.itemId, f.call, f.coin, f.name, f.ticker, f.betterName, f.note, f.shown === null ? null : JSON.stringify(f.shown)],
    );
    return json(201, { saved: row ?? null });
  }

  if (sub === 'feedback' && r.method === 'GET') {
    const kind = FEEDBACK_KINDS.find((k) => k === r.query.get('kind'));
    if (kind === undefined) return bad('Say which kind of call.');
    const items = (r.query.get('items') ?? '').split(',').map((s) => s.trim()).filter((s) => ITEM_ID.test(s));
    if (items.length === 0) return json(200, { calls: [] });
    if (items.length > MAX_ITEMS) return bad(`Up to ${MAX_ITEMS} items at once.`);
    const calls = await deps.db.query<CallRow>(
      `select distinct on (item_id, coalesce(name, '')) ${CALL_COLS}
         from internal.owner_feedback
        where subject_kind = $1 and item_id = any($2::text[])
        order by item_id, coalesce(name, ''), created_at desc, id desc`,
      [kind, items],
    );
    return json(200, { calls });
  }

  if (sub === 'hidden' && r.method === 'GET') {
    const posts = await deps.db.query<{ itemId: string; note: string | null; at: number; shown: Record<string, unknown> | null }>(
      `select "itemId", note, at, shown from (
         select distinct on (item_id) item_id as "itemId", verdict, note, shown,
                (extract(epoch from created_at) * 1000)::float8 as at
           from internal.owner_feedback
          where subject_kind = 'post'
          order by item_id, created_at desc, id desc
       ) cur
       where verdict = 'not'
       order by at desc
       limit ${MAX_HIDDEN}`,
    );
    return json(200, { posts });
  }

  if (sub === 'coin-check' || sub === 'coin-label') return ownerCoinRoute(r.method, sub, r.body, me, ref, deps);

  return bad('method not allowed', 405);
}
