/**
 * THE FEED OF PEOPLE: what the people you follow bought, sold and said, newest first, and the
 * People to follow shown to someone who follows nobody yet. Trador's Following, Top calls and Latest
 * (lib/server/socialFeed.ts), on Insidor's own rows.
 *
 *   GET /feed?tab=following|top|latest&window=week|all&cursor=   twenty items a page (Following: trades and comments merged by time)
 *   GET /feed/people                          People to follow, ordered by what they did this week
 *
 * Separate from routes.ts because it reads a table the rest of the social service never touches
 * (public.trade, the trade service's record, select only: 0109) and because its paging is the
 * only merge of two streams in the service.
 *
 * ★ A TRADE IS SHOWN ONLY WHEN ITS PERSON TURNED ON "Show my trades to followers"
 * (`people.profile.trades_public`, on by default as Trador's, 0109). The filter is in the same statement that
 * reads the trades, joined on the person, so no path reads a trade without it. Only trades that
 * landed and succeeded (`confirmed`) are shown: a trade that was built, sent and never seen
 * landing did not happen as far as anyone can tell.
 *
 * ★ NO AMOUNTS, AS TRADOR. A trade says what somebody did and roughly where, never how much:
 * a buy carries the coin's market cap when it landed (recorded at settle, 0109, or else the
 * market reading nearest the landing within social.tradeCapWindowMs; none that close is null,
 * never a guess), and a sell says whether it was above or below the seller's own average buy
 * (Trador's sellOutcomes), from the SOL and coin amounts of their landed buys before it. Those
 * amounts are the quotes the trade service recorded (0062), the only per-trade figures we hold;
 * either side missing is null, and the app says nothing. People to follow says how many trades
 * and how many holders' likes, which are counts anyone could make, and never a return.
 *
 * ★ PAGING IS KEYSET OVER BOTH STREAMS. Each stream is read one page deep below the cursor, the two
 * are merged by (time, kind, id), and the cursor is the last item kept, so the next page starts
 * exactly there whichever stream it came from. Time travels as whole microseconds since the epoch,
 * because a millisecond cursor would skip or repeat rows written in the same millisecond.
 *
 * What breaks if changed carelessly: the order in SQL (time desc, then 't' before 'c', then id
 * desc) and `after()` here must agree, or a page boundary drops or repeats an item.
 */

import type { SocialPolicy } from '@insidor/contracts/policy.ts';
import type { Person } from '@insidor/contracts/ports/people.ts';
import type { RankId } from '@insidor/core';

import { json, type Reply } from './http.ts';

/** What the Feed needs of the service: routes.ts's SocialDeps fits it, without this file importing routes.ts back. */
interface SocialDeps {
  readonly db: { query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R[]> };
  readonly policy: SocialPolicy;
  readonly now: () => number;
}

type Ranks = (userIds: readonly string[]) => Promise<Map<string, RankId>>;

interface Who {
  readonly userId: string;
  readonly handle: string | null;
  readonly name: string | null;
  readonly pictureUrl: string | null;
}

interface CoinFacts {
  readonly mint: string;
  readonly symbol: string | null;
  readonly name: string | null;
  readonly imageUrl: string | null;
}

interface Cursor {
  readonly us: string;
  readonly k: 't' | 'c';
  readonly id: string;
}

/** The cursor as the app holds it: opaque, URL-safe. Anything that does not read back is the first page. */
const encode = (c: Cursor): string => Buffer.from(`${c.us}|${c.k}|${c.id}`).toString('base64url');
function decode(raw: string | null): Cursor | null {
  if (raw === null || raw === '') return null;
  const parts = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const [us, k, id] = parts;
  if (parts.length !== 3 || us === undefined || id === undefined || !/^\d{1,19}$/.test(us) || (k !== 't' && k !== 'c') || !/^[0-9a-f]{1,64}$/.test(id)) return null;
  return { us, k, id };
}

/** A comment's id sorts as text inside the cursor, so it is padded to the width of a bigint. */
const padId = (id: string): string => id.padStart(20, '0');

/** Newest first: later time, then a trade before a comment at the same moment, then the larger id. */
function after(a: { us: string; k: string; id: string }, b: { us: string; k: string; id: string }): number {
  const ua = BigInt(a.us);
  const ub = BigInt(b.us);
  if (ua !== ub) return ua > ub ? -1 : 1;
  if (a.k !== b.k) return a.k > b.k ? -1 : 1;
  return a.id === b.id ? 0 : a.id > b.id ? -1 : 1;
}

const US = (col: string) => `(extract(epoch from ${col}) * 1000000)::bigint::text`;
const AT_CURSOR = (n: number) => `('epoch'::timestamptz + $${n}::bigint * interval '1 microsecond')`;

interface TradeRow extends Who {
  id: string;
  side: 'buy' | 'sell';
  mint: string;
  marketCapUsd: number | null;
  outcome: 'profit' | 'loss' | null;
  signature: string | null;
  us: string;
}

interface CommentRow extends Who {
  id: string;
  body: string;
  subjectKind: 'story' | 'coin' | 'post';
  subjectId: string;
  coinMint: string | null;
  likes: number;
  likedByMe: boolean;
  replies: number;
  us: string;
}

/** Landed buys and sells of the people followed who share them. */
async function tradeRows(deps: SocialDeps, authors: readonly string[] | null, cursor: Cursor | null, limit: number): Promise<TradeRow[]> {
  return deps.db.query<TradeRow>(
    `select t.id, t.kind as side, t.mint, t.signature,
            case when t.kind = 'buy' then coalesce(t.market_cap_usd, (
              select m.market_cap_usd from public.market_reading m
               where m.chain = 'solana' and m.address = t.mint and m.market_cap_usd is not null
                 and m.taken_at between t.settled_at - $6::bigint * interval '1 millisecond' and t.settled_at + $6::bigint * interval '1 millisecond'
               order by abs(extract(epoch from m.taken_at - t.settled_at)) limit 1)) end as "marketCapUsd",
            case when t.kind = 'sell' and t.in_amount > 0 and t.out_amount > 0 then (
              select case when sum(b.out_amount) > 0 and sum(b.in_amount) > 0
                          then case when t.out_amount / t.in_amount >= sum(b.in_amount) / sum(b.out_amount) then 'profit' else 'loss' end end
                from public.trade b
               where b.wallet = t.wallet and b.mint = t.mint and b.kind = 'buy' and b.status = 'confirmed'
                 and b.settled_at < t.settled_at and b.in_amount > 0 and b.out_amount > 0) end as outcome, ${US('t.settled_at')} as us,
            p.user_id as "userId", p.handle, p.name, p.picture_url as "pictureUrl"
       from public.trade t
       join people.profile p on p.wallet = t.wallet and p.trades_public
      where t.status = 'confirmed' and t.kind in ('buy', 'sell') and t.settled_at is not null and t.mint is not null
        and ($1::text[] is null or p.user_id = any($1::text[]))
        and ($2::text is null or (t.settled_at <= ${AT_CURSOR(2)}
             and (t.settled_at, 't'::text, t.id) < (${AT_CURSOR(2)}, $3::text, $4::text)))
      order by t.settled_at desc, t.id desc
      limit $5`,
    [authors, cursor?.us ?? null, cursor?.k ?? 't', cursor?.id ?? '', limit, deps.policy.tradeCapWindowMs],
  );
}

/** Visible top-level comments, as Trador's feed: a reply read apart from what it answers is noise. */
async function commentRows(deps: SocialDeps, viewer: string, authors: readonly string[] | null, cursor: Cursor | null, limit: number): Promise<CommentRow[]> {
  return deps.db.query<CommentRow>(
    `select c.comment_id::text as id, c.body, c.subject_kind as "subjectKind", c.subject_id as "subjectId", c.coin_mint as "coinMint",
            ${US('c.created_at')} as us,
            (select count(*)::int from people.comment_like l where l.comment_id = c.comment_id) as likes,
            exists (select 1 from people.comment_like l where l.comment_id = c.comment_id and l.voter_id = $1) as "likedByMe",
            (select count(*)::int from people.comment r where r.parent_id = c.comment_id and r.hidden_at is null) as replies,
            p.user_id as "userId", p.handle, p.name, p.picture_url as "pictureUrl"
       from people.comment c
       join people.profile p on p.user_id = c.author_id
      where c.parent_id is null and c.hidden_at is null
        and not exists (select 1 from people.comment_hide h where h.comment_id = c.comment_id and h.user_id = $1)
        and ($2::text[] is null or c.author_id = any($2::text[]))
        and ($3::text is null or (c.created_at <= ${AT_CURSOR(3)}
             and (c.created_at, 'c'::text, lpad(c.comment_id::text, 20, '0')) < (${AT_CURSOR(3)}, $4::text, $5::text)))
      order by c.created_at desc, c.comment_id desc
      limit $6`,
    [viewer, authors, cursor?.us ?? null, cursor?.k ?? 'c', cursor?.id ?? '', limit],
  );
}

/**
 * What each coin is called and looks like, in one read for the page; a coin we never saw is its
 * address alone. A fixture's row is not read: its name is a fiction, and the trade is real.
 */
async function coinsOf(deps: SocialDeps, mints: readonly string[]): Promise<Map<string, CoinFacts>> {
  const found = new Map<string, CoinFacts>();
  if (mints.length === 0) return found;
  const rows = await deps.db.query<CoinFacts>(
    `select m.mint, coalesce(a.symbol, n.ticker) as symbol, coalesce(a.name, n.name) as name, a.image_uri as "imageUrl"
       from unnest($1::text[]) as m(mint)
       left join public.asset a on a.chain = 'solana' and a.address = m.mint and a.origin <> 'fixture'
       left join public.coin_name n on n.address = m.mint`,
    [mints],
  );
  for (const r of rows) found.set(r.mint, r);
  return found;
}

/** A post's narrative and every narrative's title, for the line under a comment. */
async function storiesOf(deps: SocialDeps, rows: readonly CommentRow[]): Promise<{ postStory: Map<string, string>; title: Map<string, string | null> }> {
  const postIds = [...new Set(rows.filter((r) => r.subjectKind === 'post').map((r) => r.subjectId))];
  const postStory = new Map<string, string>();
  if (postIds.length > 0) {
    const links = await deps.db.query<{ itemId: string; storyId: string }>('select distinct on (item_id) item_id as "itemId", story_id as "storyId" from public.story_member where item_id = any($1::text[])', [postIds]);
    for (const l of links) postStory.set(l.itemId, l.storyId);
  }
  const storyIds = [...new Set([...rows.filter((r) => r.subjectKind === 'story').map((r) => r.subjectId), ...postStory.values()])];
  const title = new Map<string, string | null>();
  if (storyIds.length > 0) {
    const titles = await deps.db.query<{ storyId: string; title: string | null }>(
      `select s.story_id as "storyId", coalesce(v.payload ->> 'title', s.display_title) as title
         from public.story s left join public.story_view v on v.story_id = s.story_id
        where s.story_id = any($1::text[])`,
      [storyIds],
    );
    for (const t of titles) title.set(t.storyId, t.title);
  }
  return { postStory, title };
}

const person = (r: Who, ranks: Map<string, RankId>) => ({ userId: r.userId, handle: r.handle, name: r.name, pictureUrl: r.pictureUrl, rank: ranks.get(r.userId) ?? 'intern' });
const microsToMs = (us: string): number => Number(BigInt(us) / 1000n);

/**
 * Top calls: comments by the likes holders gave them, as Trador ranks by Useful votes, newer first
 * on a tie. Likes alone, not blended with age or reach, so the order is exactly the number beside
 * each comment and anyone can count it. `since` null is all time.
 */
async function topRows(deps: SocialDeps, viewer: string, since: string | null, cursor: { likes: number; id: string } | null, limit: number): Promise<CommentRow[]> {
  return deps.db.query<CommentRow>(
    `select * from (
       select c.comment_id::text as id, c.body, c.subject_kind as "subjectKind", c.subject_id as "subjectId", c.coin_mint as "coinMint",
              ${US('c.created_at')} as us,
              (select count(*)::int from people.comment_like l where l.comment_id = c.comment_id) as likes,
              exists (select 1 from people.comment_like l where l.comment_id = c.comment_id and l.voter_id = $1) as "likedByMe",
              (select count(*)::int from people.comment r where r.parent_id = c.comment_id and r.hidden_at is null) as replies,
              p.user_id as "userId", p.handle, p.name, p.picture_url as "pictureUrl"
         from people.comment c
         join people.profile p on p.user_id = c.author_id
        where c.parent_id is null and c.hidden_at is null
          and not exists (select 1 from people.comment_hide h where h.comment_id = c.comment_id and h.user_id = $1)
          and ($2::timestamptz is null or c.created_at >= $2::timestamptz)
     ) ranked
     where ($3::int is null or (ranked.likes, ranked.id::bigint) < ($3::int, $4::bigint))
     order by ranked.likes desc, ranked.id::bigint desc
     limit $5`,
    [viewer, since, cursor?.likes ?? null, cursor?.id ?? '0', limit],
  );
}

/** Top calls' cursor: the last comment's likes and id, opaque to the app. */
const encodeRank = (likes: number, id: string): string => Buffer.from(`r|${likes}|${id}`).toString('base64url');
function decodeRank(raw: string | null): { likes: number; id: string } | null {
  if (raw === null || raw === '') return null;
  const [r, likes, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  return r === 'r' && likes !== undefined && id !== undefined && /^\d{1,9}$/.test(likes) && /^\d{1,19}$/.test(id) ? { likes: Number(likes), id } : null;
}

type Entry = { readonly k: 't' | 'c'; readonly id: string; readonly us: string; readonly trade: TradeRow | null; readonly comment: CommentRow | null };

export type FeedTab = 'following' | 'top' | 'latest';

/**
 * One page of a tab, as Trador's three: Following is the trades and comments of the people you
 * follow; Top calls is every comment by holders' likes, this week or all time; Latest is every
 * comment, newest first. Trades appear in Following only, as in Trador.
 */
async function feed(deps: SocialDeps, me: Person, tab: FeedTab, window: 'week' | 'all', cursorRaw: string | null, ranks: Ranks): Promise<Reply> {
  const limit = deps.policy.feedPageSize;
  const followed = (await deps.db.query<{ id: string }>('select followee_id as id from people.follow where follower_id = $1', [me.userId])).map((r) => r.id);
  let page: readonly Entry[];
  let nextCursor: string | null;
  if (tab === 'top') {
    const since = window === 'week' ? new Date(deps.now() - deps.policy.peopleWindowMs).toISOString() : null;
    const rows = await topRows(deps, me.userId, since, decodeRank(cursorRaw), limit + 1);
    page = rows.slice(0, limit).map((r) => ({ k: 'c' as const, id: padId(r.id), us: r.us, trade: null, comment: r }));
    const last = rows[limit - 1];
    nextCursor = rows.length > limit && last !== undefined ? encodeRank(last.likes, last.id) : null;
  } else {
    const cursor = decode(cursorRaw);
    const authors = tab === 'following' ? followed : null;
    if (authors !== null && authors.length === 0) return json(200, { items: [], cursor: null, following: 0 });
    /* One more than a page from each stream: the extra row says whether that stream goes on. */
    const [trades, comments] = await Promise.all([authors === null ? Promise.resolve([]) : tradeRows(deps, authors, cursor, limit + 1), commentRows(deps, me.userId, authors, cursor, limit + 1)]);
    const merged: Entry[] = [
      ...trades.map((r) => ({ k: 't' as const, id: r.id, us: r.us, trade: r, comment: null })),
      ...comments.map((r) => ({ k: 'c' as const, id: padId(r.id), us: r.us, trade: null, comment: r })),
    ].sort(after);
    page = merged.slice(0, limit);
    const last = page[page.length - 1];
    nextCursor = merged.length > limit && last !== undefined ? encode({ us: last.us, k: last.k, id: last.id }) : null;
  }

  const pageComments = page.flatMap((x) => (x.comment === null ? [] : [x.comment]));
  const mints = new Set<string>();
  for (const x of page) {
    if (x.trade !== null) mints.add(x.trade.mint);
    if (x.comment?.subjectKind === 'coin') mints.add(x.comment.subjectId);
    else if (x.comment?.coinMint) mints.add(x.comment.coinMint);
  }
  const [coins, stories, rankMap] = await Promise.all([coinsOf(deps, [...mints]), storiesOf(deps, pageComments), ranks([...new Set(page.map((x) => (x.trade ?? x.comment)!.userId))])]);
  const coin = (mint: string): CoinFacts => coins.get(mint) ?? { mint, symbol: null, name: null, imageUrl: null };

  const items = page.map((x) => {
    if (x.trade !== null) {
      const t = x.trade;
      return { kind: 'trade' as const, key: `t:${t.id}`, at: microsToMs(t.us), person: person(t, rankMap), side: t.side, coin: coin(t.mint), marketCapUsd: t.marketCapUsd, outcome: t.outcome, signature: t.signature };
    }
    const c = x.comment!;
    const storyId = c.subjectKind === 'story' ? c.subjectId : c.subjectKind === 'post' ? (stories.postStory.get(c.subjectId) ?? null) : null;
    const coinMint = c.subjectKind === 'coin' ? c.subjectId : c.coinMint;
    return {
      kind: 'comment' as const,
      key: `c:${c.id}`,
      at: microsToMs(c.us),
      person: person(c, rankMap),
      commentId: Number(c.id),
      body: c.body,
      likes: c.likes,
      likedByMe: c.likedByMe,
      replies: c.replies,
      on: { kind: c.subjectKind, id: c.subjectId, storyId, title: storyId === null ? null : (stories.title.get(storyId) ?? null), coin: coinMint === null ? null : coin(coinMint) },
    };
  });
  return json(200, { items, cursor: nextCursor, following: followed.length });
}

/**
 * People to follow: anyone but you and those you follow, who did something this week that others
 * can count — holders who liked their comments, their own landed trades (only when shared), or
 * comments at all. Ordered by those counts, in that order, then by followers. Every number shown
 * is one of those counts; nothing is blended into a figure of ours.
 */
async function peopleToFollow(deps: SocialDeps, me: Person, ranks: Ranks): Promise<Reply> {
  const since = new Date(deps.now() - deps.policy.peopleWindowMs).toISOString();
  const rows = await deps.db.query<Who & { likes: number; trades: number | null; comments: number; followers: number }>(
    `with facts as (
       select p.user_id, p.handle, p.name, p.picture_url, p.trades_public, p.wallet,
              (select count(*)::int from people.comment_like l join people.comment c on c.comment_id = l.comment_id
                where c.author_id = p.user_id and c.hidden_at is null and l.created_at >= $2) as likes,
              (select count(*)::int from public.trade t
                where p.trades_public and p.wallet is not null and t.wallet = p.wallet and t.status = 'confirmed'
                  and t.kind in ('buy', 'sell') and t.settled_at is not null and t.settled_at >= $2) as trades,
              (select count(*)::int from people.comment c where c.author_id = p.user_id and c.hidden_at is null and c.created_at >= $2) as comments,
              (select count(*)::int from people.follow f where f.followee_id = p.user_id) as followers
         from people.profile p
        where p.user_id <> $1
          and not exists (select 1 from people.follow f where f.follower_id = $1 and f.followee_id = p.user_id)
     )
     select user_id as "userId", handle, name, picture_url as "pictureUrl", likes,
            case when trades_public then trades else null end as trades, comments, followers
       from facts
      where likes > 0 or trades > 0 or comments > 0
      order by facts.likes desc, facts.trades desc, facts.comments desc, facts.followers desc, facts.user_id
      limit $3`,
    [me.userId, since, deps.policy.peopleToFollow],
  );
  const rankMap = await ranks(rows.map((r) => r.userId));
  return json(200, {
    people: rows.map((r) => ({ ...person(r, rankMap), followers: r.followers, likesThisWeek: r.likes, tradesThisWeek: r.trades, commentsThisWeek: r.comments })),
  });
}

/** The Feed's routes, or null when the request is not one of them. Signed in only: this is personal data. */
export async function activityRoute(method: string, seg: readonly string[], query: URLSearchParams, me: Person | null, deps: SocialDeps, ranks: Ranks): Promise<Reply | null> {
  if (seg[0] !== 'feed') return null;
  if (method !== 'GET') return json(405, { error: 'method not allowed' });
  if (me === null) return json(401, { error: 'Sign in first.' });
  if (seg.length === 1) {
    const asked = query.get('tab');
    const tab: FeedTab = asked === 'latest' || asked === 'top' ? asked : 'following';
    return feed(deps, me, tab, query.get('window') === 'all' ? 'all' : 'week', query.get('cursor'), ranks);
  }
  if (seg.length === 2 && seg[1] === 'people') return peopleToFollow(deps, me, ranks);
  return json(404, { error: 'not found' });
}
