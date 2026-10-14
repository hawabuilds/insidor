/**
 * "ADD MISSED POSTS": the owner pastes up to `learning.maxMissedPerPaste` links of posts we should
 * have shown, and reads back what became of each.
 *
 *   GET  /missed                      the list, newest first, and the search change suggested
 *   POST /missed { text, preview }    what the paste reads as (each post and its coin address),
 *                                     nothing written
 *   POST /missed { text }             the posts queued for the runner, and each address saved
 *                                     as that post's coin
 *
 * ★ A PASTE MAY CARRY COIN ADDRESSES. Each is paired with its post (missed-paste.ts) and saved
 * exactly as "Which coin?" saves one — the same route, owner-coin.ts: checked against the coin
 * sources, then the owner's `right` coin call for that post. An address no source knows saves
 * nothing and says so; an address with no post is sent back as left over, never dropped. A link
 * that is not a post is refused here with what to paste instead, and not queued.
 *
 * ★ THE OWNER ONLY, CHECKED HERE ON EVERY CALL, by the same rule as the owner's other calls
 * (owner.ts `ownerRefOf`): a wallet or the X handle of the SIGNED sign-in, listed in Policy.owner.
 * Anyone else gets 403 and nothing about the list. `owner_ref` is that rule's answer
 * (`wallet:…` or `x:…`), so a paste is tied to the owner identity that made it.
 *
 * ★ THIS SERVICE ONLY QUEUES. It holds no source keys, so it cannot read a post: it writes one
 * `queued` row per link (0055) and the runner reads, stores and diagnoses it within a minute
 * (services/runner/src/work/missed-posts.ts). Only post links are queued (owner-coin.ts
 * `postIdOf`, the link rule the runner's sources share); a repeat of one the owner already pasted
 * is dropped by the table's unique key. The coin label goes through owner-coin.ts, which owns
 * that write.
 *
 * ★ WORDS, NOT OUR FIELDS. Each row goes out as a headline and fact lines the runner's diagnosis
 * is turned into here (`describe`), so the phone app renders sentences and holds none of the
 * pipeline's names — the judge's answer included, which reaches the owner as what it said.
 *
 * Before 0055 is applied the table is missing; the owner then gets 503 "not set up yet", and no
 * other route is touched.
 *
 * What breaks if changed carelessly: the owner check is owner.ts's `ownerRefOf`, not a copy. A
 * second rule here would drift from the one that guards the owner's other controls.
 */

import type { LearningPolicy, OwnerPolicy } from '@insidor/contracts/policy.ts';
import type { Person } from '@insidor/contracts/ports/people.ts';

import type { CoinCheck } from './coin-check.ts';
import { json, type Reply } from './http.ts';
import { readPaste, type PasteRead } from './missed-paste.ts';
import { ownerRefOf } from './owner.ts';
import { ownerCoinRoute } from './owner-coin.ts';

export interface MissedDb {
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R[]>;
}

export interface MissedDeps {
  readonly db: MissedDb;
  /** Who the owner is (Policy.owner); absent, nobody is. */
  readonly owner: OwnerPolicy | undefined;
  readonly learning: Pick<LearningPolicy, 'maxMissedPerPaste'>;
  /** The coin sources, for the addresses in a paste; absent, an address is answered "not set up". */
  readonly coinCheck?: CoinCheck;
}

const LIST_LIMIT = 200;

interface Row {
  id: string;
  url: string;
  added_at: Date;
  status: 'queued' | 'done' | 'failed';
  diagnosis: string | null;
  diagnosis_detail: Record<string, unknown>;
  coins: { address?: string; name?: string | null; ticker?: string | null; launchedAt?: string | null }[];
  usd: string;
  posted_at: Date | null;
  last_error: string | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1_440;

/** "45 min", "3 h 20 min", "2 days": a span of minutes in words. */
export function span(min: number | null): string {
  if (min === null) return 'an unknown time';
  const m = Math.max(0, Math.round(min));
  if (m < MINUTES_PER_HOUR) return `${m} min`;
  if (m < MINUTES_PER_DAY) return `${Math.floor(m / MINUTES_PER_HOUR)} h${m % MINUTES_PER_HOUR === 0 ? '' : ` ${m % MINUTES_PER_HOUR} min`}`;
  const d = Math.round(m / MINUTES_PER_DAY);
  return `${d} day${d === 1 ? '' : 's'}`;
}

const FILTER_WORDS: Readonly<Record<string, string>> = {
  language: 'its language is not one the search asks for',
  repost: 'it is a plain repost, which the search leaves out',
  reply: 'it is a reply, which the search left out',
  media: 'it has no picture or video',
  tag: 'it carries none of the tags we watch',
};

const SAID_WORDS: Readonly<Record<string, string>> = {
  not_memeable: 'said it is not a meme',
  judge_unsure: 'said it is a meme, but not surely enough',
  name_test: 'said it is a meme, but its name is too long to be a coin',
  not_scored: 'has not answered',
};

export type Tone = 'wait' | 'missed' | 'late' | 'ok' | 'failed';

/** A row as the owner reads it: a headline, a tone for its colour, and the facts behind it. */
export function describe(r: Pick<Row, 'status' | 'diagnosis' | 'diagnosis_detail' | 'last_error'>): { headline: string; tone: Tone; lines: string[] } {
  const d = r.diagnosis_detail;
  if (r.status === 'queued') return { headline: 'Checking', tone: 'wait', lines: r.last_error === null ? [] : ['The last read failed; trying again.'] };
  const lines: string[] = [];
  switch (r.diagnosis) {
    case 'never_found': {
      if (d['held'] === true) lines.push('We had it from another search, never from the one that feeds For You.');
      const why = text(d['why']);
      if (why === 'discovery_down') {
        const back = num(d['downToMs']);
        lines.push(d['notRunningYet'] === true
          ? 'Our search was not running yet when it was posted, so no setting would have found it.'
          : `Our search was down when it was posted${back === null ? ', and is still down' : `, until ${new Date(back).toISOString().slice(11, 16)} UTC`}, so it never had its first minutes in the search.`);
        return { headline: 'Never found: search was down', tone: 'missed', lines };
      }
      if (num(d['upMinutes']) !== null) lines.push(`Our search was down for part of its first ${num(d['windowMinutes']) ?? '?'} min: up for ${num(d['upMinutes'])} of them.`);
      if (why === 'not_in_search') lines.push(`Not in our search: ${FILTER_WORDS[text(d['filter']) ?? ''] ?? 'the search does not ask for posts like it'}${text(d['lang']) !== null && d['filter'] === 'language' ? ` (${String(d['lang'])})` : ''}.`);
      if (why === 'under_floor') lines.push(`Under the like floor: ${num(d['approvals']) ?? 'unknown'} likes now, and the search asks for ${num(d['floor']) ?? 'more'} within ${num(d['reachMinutes']) ?? '?'} min of posting.`);
      if (why === 'between_checks') lines.push(num(d['crossedFloorMinutes']) !== null ? `Between checks: it passed the like floor about ${span(num(d['crossedFloorMinutes']))} after posting, after the search stopped looking back.` : 'Between checks: the watched tags are asked in turn, and it was not among the newest when its tag came round.');
      if (why === 'unexplained') lines.push('The search should have returned it; we cannot say why it did not.');
      if (why === 'unsure') lines.push('We cannot tell which part of the search missed it yet.');
      return { headline: 'Never found', tone: 'missed', lines };
    }
    case 'not_judged':
      return { headline: 'Found, not yet checked', tone: 'wait', lines: [`Found ${span(num(d['foundMinutes']))} after posting; the meme check has not answered about it.`] };
    case 'rejected': {
      const j = (d['judge'] ?? {}) as Record<string, unknown>;
      lines.push(`Found ${span(num(d['foundMinutes']))} after posting.`);
      lines.push(`The meme check ${SAID_WORDS[text(j['said']) ?? ''] ?? 'kept it off'}${text(j['name']) !== null ? `, and named it "${String(j['name'])}"` : ''}.`);
      return { headline: 'Found, turned down', tone: 'missed', lines };
    }
    case 'under_reach_bar':
      lines.push(`Found ${span(num(d['foundMinutes']))} after posting, and passed the meme check.`);
      lines.push(num(d['mostReach']) !== null ? `Most views we read: ${Number(d['mostReach']).toLocaleString('en-US')}, ${span(num(d['mostReachMinutes']))} after posting. For You needs ${Number(d['fypBar']).toLocaleString('en-US')} or fast early growth.` : 'We never read its views.');
      return { headline: 'Found, not enough views', tone: 'missed', lines };
    case 'shown_late':
    case 'shown': {
      lines.push(`Shown ${span(num(d['shownMinutes']))} after posting${num(d['crossedBarMinutes']) !== null ? `; it passed the view bar ${span(num(d['crossedBarMinutes']))} after posting` : ''}.`);
      if (r.diagnosis === 'shown_late') lines.push(`The first coin of its name launched ${span(num(d['afterCoinMinutes']))} before we showed it.`);
      else if (num(d['beforeCoinMinutes']) !== null) lines.push(`Shown ${span(num(d['beforeCoinMinutes']))} before the first coin of its name.`);
      return r.diagnosis === 'shown_late' ? { headline: 'Shown too late', tone: 'late', lines } : { headline: 'Shown in time', tone: 'ok', lines };
    }
    case 'unsure':
      return { headline: 'Cannot tell', tone: 'wait', lines: ['Found, passed the meme check and the view bar, but never recorded as shown.'] };
    case 'not_a_post':
      return { headline: 'Not a post link', tone: 'failed', lines: ['Paste the full link to an X or TikTok post.'] };
    case 'unreadable':
      return { headline: 'Could not read it', tone: 'failed', lines: ['The post is deleted, private, or the read kept failing.'] };
    case 'duplicate':
      return { headline: 'Already added', tone: 'failed', lines: ['This post is already in the list.'] };
    case 'no_source':
      return { headline: 'Cannot read this source', tone: 'failed', lines: ['We cannot read one post by itself from this source.'] };
    case 'no_line':
      return { headline: 'No money to read it', tone: 'failed', lines: ['The learning work has no daily line for this source.'] };
    default:
      return { headline: 'Checked', tone: 'wait', lines };
  }
}

async function list(deps: MissedDeps, extra: Record<string, unknown> = {}): Promise<Reply> {
  const rows = await deps.db.query<Row>(
    `select id::text, url, added_at, status, diagnosis, diagnosis_detail, coins, usd::text, posted_at, last_error
       from internal.missed_post order by added_at desc, id desc limit $1`,
    [LIST_LIMIT],
  );
  const [s] = await deps.db.query<{ text: string | null }>('select text from internal.missed_post_suggestion where id = 1');
  return json(200, {
    ...extra,
    max: deps.learning.maxMissedPerPaste,
    suggestion: s?.text ?? null,
    posts: rows.map((r) => {
      const d = describe(r);
      const read = Number(r.usd);
      return {
        id: r.id,
        url: r.url,
        addedAt: new Date(r.added_at).getTime(),
        postedAt: r.posted_at === null ? null : new Date(r.posted_at).getTime(),
        headline: d.headline,
        tone: d.tone,
        lines: read > 0 ? [...d.lines, `Reading it cost $${read.toFixed(4)}.`] : d.lines,
        coins: (Array.isArray(r.coins) ? r.coins : []).map((c) => ({ address: c.address ?? '', name: c.name ?? null, ticker: c.ticker ?? null, launchedAt: c.launchedAt === null || c.launchedAt === undefined ? null : Date.parse(c.launchedAt) })),
      };
    }),
  });
}

/** The /missed routes, for a signed-in person (null: not signed in). */
export async function missedRoute(method: string, body: unknown, me: Person | null, deps: MissedDeps): Promise<Reply> {
  try {
    return await missedCall(method, body, me, deps);
  } catch (e) {
    /* Deployed before 0055 is applied: say so, rather than a server error. */
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42P01') return json(503, { error: 'Missed posts are not set up yet.' });
    throw e;
  }
}

async function missedCall(method: string, body: unknown, me: Person | null, deps: MissedDeps): Promise<Reply> {
  if (me === null) return json(401, { error: 'Sign in first.' });
  const ownerRef = ownerRefOf(me, deps.owner);
  if (ownerRef === null) return json(403, { error: 'Only the owner can add missed posts.' });
  if (method === 'GET') return list(deps);
  if (method !== 'POST') return json(405, { error: 'method not allowed' });
  const b = (body ?? {}) as { text?: unknown; preview?: unknown };
  const read = readPaste(b.text);
  const posts = read.posts.filter((p) => p.refused === null);
  const problem = posts.length === 0
    ? (read.posts.find((p) => p.refused !== null)?.refused ?? 'Paste at least one https link to a post.')
    : posts.length > deps.learning.maxMissedPerPaste ? `Up to ${deps.learning.maxMissedPerPaste} links at once.` : null;
  if (b.preview === true) return json(200, { read: readOut(read), problem, max: deps.learning.maxMissedPerPaste });
  if (problem !== null) return json(400, { error: problem, read: readOut(read) });
  await deps.db.query(
    `insert into internal.missed_post (url, owner_ref) select unnest($1::text[]), $2 on conflict (owner_ref, url) do nothing`,
    [posts.map((p) => p.url), ownerRef],
  );
  const coins = await Promise.all(posts.flatMap((p) => (p.address === null ? [] : [labelCoin(p.url, p.address, me, ownerRef, deps)])));
  return list(deps, { saved: coins, loose: read.loose, refused: read.posts.flatMap((p) => (p.refused === null ? [] : [{ url: p.url, said: p.refused }])) });
}

/** The paste as the owner reads it before saving. */
const readOut = (read: PasteRead) => ({
  posts: read.posts.map((p) => ({ url: p.url, address: p.address, refused: p.refused })),
  loose: read.loose,
});

/**
 * One address saved as its post's coin, through the "Which coin?" route itself, so the check and
 * the write are that route's and cannot drift. The answer is words: what was saved, or why not.
 */
async function labelCoin(url: string, address: string, me: Person, ownerRef: string, deps: MissedDeps): Promise<{ url: string; address: string; ok: boolean; said: string }> {
  const r = await ownerCoinRoute('POST', 'coin-label', { coin: address, postUrl: url }, me, ownerRef, { db: deps.db, ...(deps.coinCheck === undefined ? {} : { coinCheck: deps.coinCheck }) });
  const out = JSON.parse(r.body) as { error?: unknown; coin?: { name?: unknown; ticker?: unknown } };
  if (r.status === 201) {
    const ticker = typeof out.coin?.ticker === 'string' ? `$${out.coin.ticker}` : null;
    const name = typeof out.coin?.name === 'string' ? out.coin.name : null;
    return { url, address, ok: true, said: `Saved ${ticker ?? name ?? 'this coin'} as its coin.` };
  }
  if (r.status === 404) return { url, address, ok: false, said: "Can't find this coin, so nothing was saved for it." };
  return { url, address, ok: false, said: typeof out.error === 'string' ? out.error : 'The coin could not be saved.' };
}
