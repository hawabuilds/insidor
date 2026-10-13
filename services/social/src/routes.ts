/**
 * THE SOCIAL ROUTES: profiles, follows, comments, likes, reports, standings and the season
 * leaderboard. No reference to node:http, so every rule runs in a test against a real migrated
 * database (e2e/src/social.test.ts) and stand-ins for the sign-in provider and the chain.
 *
 *   GET    /me                         my profile and standing (signed in)
 *   POST   /me                         bring my profile up to date from my sign-in
 *   PUT    /me { bio }
 *   GET    /profile/:key               by handle or id: profile, rank card, counts, recent comments
 *   GET    /profile/:key/followers     and /following
 *   POST   /follow/:userId             DELETE the same to unfollow
 *   GET    /comments?subject=          a narrative's, a coin's or a post's comments, threaded
 *   POST   /comments { subject, parentId?, body, proofUrl? }
 *   POST   /comments/:id/like          DELETE the same to unlike
 *   POST   /comments/:id/report { reason }    POST /comments/:id/hide (for me only)
 *   GET    /leaderboard                this season's standings
 *   GET    /me/owner, /owner/…         the owner's calls on posts, coin matches and names (owner.ts)
 *   GET    /missed, POST /missed       the owner's missed posts (missed.ts; the owner only)
 *
 * ★ ONLY A HOLDER CAN LIKE, CHECKED ON THE CHAIN AT THE TIME OF THE LIKE (Trador's rule). The
 * voter's wallets come from their signed sign-in token, never from the request; a chain that
 * cannot be read refuses the like rather than letting it through.
 *
 * ★ REP IS EARNED FROM OTHERS, ONCE PER LIKE, TWENTY LIKES A DAY PER VOTER. The like is always
 * recorded; rep is added only while the voter is under the daily cap, and the database's
 * unique (voter, comment) makes a second award impossible. Unliking removes the like and its rep.
 *
 * ★ PEOPLE'S OWN NUMBERS ONLY. A rank, rep and like counts are about people and what they did;
 * nothing here scores a coin or a post.
 *
 * Follows, replies and rank-ups queue an alert (people.alert_queue); the alert service decides
 * whether it is pushed.
 */

import { DEFAULT_POLICY, type OwnerPolicy, type SocialPolicy } from '@insidor/contracts/policy.ts';
import type { IdentityCheck, Person } from '@insidor/contracts/ports/people.ts';
import { boughtEarly, earnsRep, nextRank, rankFor, rankedUp, seasonOf, standings, votePoints, type RankId, type Standing } from '@insidor/core';

import { json, type Reply, type Request } from './http.ts';
import { missedRoute } from './missed.ts';
import { ownerRoute } from './owner.ts';
import { blockedWord, cleanBody, parseSubject, proofLinkOf, type Subject } from './rules.ts';

export interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R[]>;
}

/** The chain reads a like and a proof need. Each may fail; a failure is null, never a guess. */
export interface Chain {
  /** Whether any of the wallets holds the coin now; null when the chain could not be read. */
  holds(wallets: readonly string[], mint: string): Promise<boolean | null>;
  /** The price of this wallet's first buy of the coin, in SOL per token; null when none is seen. */
  firstBuyPriceSol(wallet: string, mint: string): Promise<number | null>;
  /** Every launchpad coin's starting price, SOL per token. */
  launchPriceSol(): Promise<number | null>;
  txTouchesMint(signature: string, mint: string): Promise<boolean>;
}

export interface SocialDeps {
  readonly db: Db;
  readonly identity: IdentityCheck;
  /** Null: no chain configured, so nobody can like. */
  readonly chain: Chain | null;
  readonly policy: SocialPolicy;
  /** Who the owner is (policy `owner`). Absent: nobody is, and every /owner route refuses. */
  readonly owner?: OwnerPolicy;
  readonly now: () => number;
  readonly pace: (client: string, now: number) => boolean;
}

const bad = (error: string, status = 400): Reply => json(status, { error });
const SIGN_IN = bad('Sign in first.', 401);
const EPOCH = (P: SocialPolicy) => {
  const d = new Date(P.seasonEpochMs);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
};

/** The season now, with its dates: core counts months, the clock is read here. */
export function seasonNow(nowMs: number, P: SocialPolicy): { readonly id: number; readonly endsAt: number } {
  const d = new Date(nowMs);
  const epoch = EPOCH(P);
  const id = seasonOf({ year: d.getUTCFullYear(), month: d.getUTCMonth() }, epoch);
  return { id, endsAt: Date.UTC(epoch.year, epoch.month + id, 1) };
}

/* ── standings, kept for a moment ─────────────────────────────────── */

const standingsCache = new Map<number, { at: number; map: Map<string, Standing>; order: string[] }>();

async function seasonStandings(deps: SocialDeps, season: number, fresh = false): Promise<{ map: Map<string, Standing>; order: string[] }> {
  const held = standingsCache.get(season);
  if (!fresh && held !== undefined && deps.now() - held.at < deps.policy.standingsKeepMs) return held;
  const rows = await deps.db.query<{ userId: string; rep: number }>(
    `select author_id as "userId", sum(points)::float8 as rep from people.rep_event
      where season = $1 group by author_id order by rep desc, min(created_at) asc`,
    [season],
  );
  const map = standings(rows, deps.policy);
  const order = rows.filter((r) => r.rep > 0).map((r) => r.userId);
  const next = { at: deps.now(), map, order };
  standingsCache.set(season, next);
  return next;
}

const standingOf = (map: Map<string, Standing>, userId: string): Standing => map.get(userId) ?? { rep: 0, percentile: null };

/** For tests: forget kept standings and profile syncs so each test starts clean. */
export const forgetKept = (): void => {
  standingsCache.clear();
  synced.clear();
};

/* ── profiles ─────────────────────────────────────────────────────── */

interface ProfileRow {
  userId: string;
  handle: string | null;
  name: string | null;
  pictureUrl: string | null;
  bio: string;
  wallet: string | null;
}

const PROFILE_COLS = `user_id as "userId", handle, name, picture_url as "pictureUrl", bio, wallet`;

/** The profile row brought up to date from a signed sign-in. A handle someone else held moves to its new owner. */
export async function syncProfile(db: Db, p: Person): Promise<void> {
  const handle = p.handle?.toLowerCase() ?? null;
  const wallet = p.wallets.find((w) => w.kind === 'embedded')?.address ?? null;
  if (handle !== null) await db.query('update people.profile set handle = null where handle = $1 and user_id <> $2', [handle, p.userId]);
  await db.query(
    `insert into people.profile (user_id, handle, name, picture_url, wallet) values ($1, $2, $3, $4, $5)
     on conflict (user_id) do update set handle = excluded.handle, name = excluded.name, picture_url = excluded.picture_url,
       wallet = coalesce(excluded.wallet, people.profile.wallet), updated_at = now()`,
    [p.userId, handle, p.name, p.pictureUrl, wallet],
  );
}

const synced = new Map<string, number>();
const SYNC_EVERY_MS = 300_000;

async function signedIn(req: Request, deps: SocialDeps): Promise<Person | null> {
  if (req.token === null) return null;
  const person = await deps.identity.verify(req.token);
  if (person === null) return null;
  const last = synced.get(person.userId) ?? 0;
  if (deps.now() - last > SYNC_EVERY_MS) {
    await syncProfile(deps.db, person);
    synced.set(person.userId, deps.now());
  }
  return person;
}

async function profileBy(db: Db, key: string): Promise<ProfileRow | null> {
  const rows = await db.query<ProfileRow>(`select ${PROFILE_COLS} from people.profile where user_id = $1 or handle = lower($1) limit 1`, [key]);
  return rows[0] ?? null;
}

async function card(deps: SocialDeps, p: ProfileRow, viewer: string | null) {
  const season = seasonNow(deps.now(), deps.policy);
  const { map } = await seasonStandings(deps, season.id);
  const standing = standingOf(map, p.userId);
  const [counts] = await deps.db.query<{ followers: number; following: number; iFollow: boolean; followsMe: boolean }>(
    `select (select count(*)::int from people.follow where followee_id = $1) as followers,
            (select count(*)::int from people.follow where follower_id = $1) as following,
            exists (select 1 from people.follow where follower_id = $2 and followee_id = $1) as "iFollow",
            exists (select 1 from people.follow where follower_id = $1 and followee_id = $2) as "followsMe"`,
    [p.userId, viewer ?? ''],
  );
  return {
    userId: p.userId,
    handle: p.handle,
    name: p.name,
    pictureUrl: p.pictureUrl,
    bio: p.bio,
    wallet: p.wallet,
    rank: rankFor(standing, deps.policy),
    rep: Math.round(standing.rep),
    next: nextRank(standing.rep, deps.policy),
    topOfSeason: standing.percentile === 0,
    season,
    followers: counts?.followers ?? 0,
    following: counts?.following ?? 0,
    iFollow: counts?.iFollow ?? false,
    followsMe: counts?.followsMe ?? false,
    isMe: viewer === p.userId,
  };
}

/* ── comments ─────────────────────────────────────────────────────── */

/** The coin a subject's likes are checked against: the coin itself, or a narrative's one settled coin. */
async function coinOf(db: Db, s: Subject): Promise<string | null> {
  if (s.kind === 'coin') return s.id;
  const storyId = s.kind === 'story' ? s.id : (await db.query<{ storyId: string }>('select story_id as "storyId" from public.story_member where item_id = $1 limit 1', [s.id]))[0]?.storyId ?? null;
  if (storyId === null) return null;
  const rows = await db.query<{ address: string | null }>(`select payload #>> '{coins,coin,address}' as address from public.story_view where story_id = $1 and payload #>> '{coins,kind}' = 'one'`, [storyId]);
  return rows[0]?.address ?? null;
}

async function subjectExists(db: Db, s: Subject): Promise<boolean> {
  if (s.kind === 'coin') return true;
  if (s.kind === 'story') return (await db.query('select 1 from public.story where story_id = $1', [s.id])).length > 0;
  return (await db.query('select 1 from public.story_member where item_id = $1', [s.id])).length > 0;
}

/** Where a subject opens in the app, for an alert's link. */
async function hrefOf(db: Db, s: Subject): Promise<string> {
  if (s.kind === 'story') return `/#/story/${encodeURIComponent(s.id)}`;
  if (s.kind === 'coin') return `/#/token/${encodeURIComponent(`solana:${s.id}`)}`;
  const storyId = (await db.query<{ storyId: string }>('select story_id as "storyId" from public.story_member where item_id = $1 limit 1', [s.id]))[0]?.storyId;
  return storyId === undefined ? '/#/' : `/#/story/${encodeURIComponent(storyId)}`;
}

interface CommentRow {
  id: number;
  parentId: number | null;
  body: string;
  proofUrl: string | null;
  proof: boolean;
  at: string;
  likes: number;
  likedByMe: boolean;
  authorId: string;
  handle: string | null;
  name: string | null;
  pictureUrl: string | null;
  subject: string;
}

const COMMENT_SELECT = `
  select c.comment_id::int as id, c.parent_id::int as "parentId", c.body, c.proof_url as "proofUrl", c.proof,
         c.created_at as at, c.subject_kind || ':' || c.subject_id as subject,
         (select count(*)::int from people.comment_like l where l.comment_id = c.comment_id) as likes,
         exists (select 1 from people.comment_like l where l.comment_id = c.comment_id and l.voter_id = $2) as "likedByMe",
         p.user_id as "authorId", p.handle, p.name, p.picture_url as "pictureUrl"
    from people.comment c join people.profile p on p.user_id = c.author_id
   where c.hidden_at is null
     and not exists (select 1 from people.comment_hide h where h.comment_id = c.comment_id and h.user_id = $2)`;

async function shaped(deps: SocialDeps, rows: readonly CommentRow[], viewer: string | null) {
  const { map } = await seasonStandings(deps, seasonNow(deps.now(), deps.policy).id);
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    subject: r.subject,
    author: { userId: r.authorId, handle: r.handle, name: r.name, pictureUrl: r.pictureUrl, rank: rankFor(standingOf(map, r.authorId), deps.policy) },
    body: r.body,
    proofUrl: r.proofUrl,
    proof: r.proof,
    likes: r.likes,
    likedByMe: r.likedByMe,
    mine: viewer === r.authorId,
    at: new Date(r.at).getTime(),
  }));
}

/* ── alerts, queued for the alert service ─────────────────────────── */

async function queueAlert(db: Db, a: { userId: string; kind: 'follow' | 'reply' | 'rank_up'; subject: string; rung: number; facts: Record<string, unknown>; href: string }): Promise<void> {
  await db.query('insert into people.alert_queue (user_id, kind, subject, rung, facts, href) values ($1, $2, $3, $4, $5, $6)', [a.userId, a.kind, a.subject, a.rung, JSON.stringify(a.facts), a.href]);
}

const whoOf = (p: Person): string => (p.handle !== null ? `@${p.handle}` : (p.name ?? 'Someone'));
const profileHref = (p: { handle: string | null; userId: string }): string => `/#/u/${encodeURIComponent(p.handle ?? p.userId)}`;

/* ── the routes ───────────────────────────────────────────────────── */

const segmentsOf = (path: string): string[] => path.split('/').filter((s) => s !== '').map((s) => decodeURIComponent(s));

export async function handle(req: Request, deps: SocialDeps): Promise<Reply> {
  const P = deps.policy;
  if (!deps.pace(req.client, deps.now())) return bad('Too many requests. Wait a moment.', 429);
  let url: URL;
  let seg: string[];
  try {
    url = new URL(req.url, 'http://local');
    seg = segmentsOf(url.pathname);
  } catch {
    return bad('bad request');
  }
  const m = req.method;
  const [head, id, sub] = seg;

  if (m === 'GET' && seg.length === 0) return json(200, { service: 'social' });
  if (m === 'GET' && head === 'health') return json(200, { ok: true });

  const me = await signedIn(req, deps);

  const owned = await ownerRoute({ method: m, seg, query: url.searchParams, body: req.body }, me, deps);
  if (owned !== null) return owned;
  if (head === 'missed' && seg.length === 1) return missedRoute(m, req.body, me, { db: deps.db, owner: deps.owner, learning: DEFAULT_POLICY.learning });

  if (head === 'me' && seg.length === 1) {
    if (me === null) return SIGN_IN;
    if (m === 'POST') {
      await syncProfile(deps.db, me);
      synced.set(me.userId, deps.now());
    }
    if (m === 'PUT') {
      const bio = typeof (req.body as { bio?: unknown } | null)?.bio === 'string' ? ((req.body as { bio: string }).bio).trim() : null;
      if (bio === null || bio.length > P.maxBioChars) return bad(`A bio is up to ${P.maxBioChars} characters.`);
      if (blockedWord(bio)) return bad("That bio uses a word that isn't allowed here.");
      await deps.db.query('update people.profile set bio = $2, updated_at = now() where user_id = $1', [me.userId, bio]);
    }
    if (m !== 'GET' && m !== 'POST' && m !== 'PUT') return bad('method not allowed', 405);
    const p = await profileBy(deps.db, me.userId);
    return p === null ? bad('not found', 404) : json(200, await card(deps, p, me.userId));
  }

  if (m === 'GET' && head === 'profile' && id !== undefined) {
    const p = await profileBy(deps.db, id);
    if (p === null) return bad('not found', 404);
    if (sub === 'followers' || sub === 'following') {
      const rows = await deps.db.query<ProfileRow>(
        sub === 'followers'
          ? `select ${PROFILE_COLS} from people.profile where user_id in (select follower_id from people.follow where followee_id = $1) order by name nulls last limit 200`
          : `select ${PROFILE_COLS} from people.profile where user_id in (select followee_id from people.follow where follower_id = $1) order by name nulls last limit 200`,
        [p.userId],
      );
      const { map } = await seasonStandings(deps, seasonNow(deps.now(), P).id);
      return json(200, { people: rows.map((r) => ({ userId: r.userId, handle: r.handle, name: r.name, pictureUrl: r.pictureUrl, rank: rankFor(standingOf(map, r.userId), P) })) });
    }
    const comments = await deps.db.query<CommentRow>(`${COMMENT_SELECT} and c.author_id = $1 order by c.created_at desc limit 30`, [p.userId, me?.userId ?? '']);
    return json(200, { profile: await card(deps, p, me?.userId ?? null), comments: await shaped(deps, comments, me?.userId ?? null) });
  }

  if (head === 'follow' && id !== undefined && seg.length === 2) {
    if (me === null) return SIGN_IN;
    if (id === me.userId) return bad("You can't follow yourself.");
    const target = await profileBy(deps.db, id);
    if (target === null) return bad('not found', 404);
    if (m === 'POST') {
      const added = await deps.db.query('insert into people.follow (follower_id, followee_id) values ($1, $2) on conflict do nothing returning 1', [me.userId, target.userId]);
      if (added.length > 0) {
        await queueAlert(deps.db, { userId: target.userId, kind: 'follow', subject: me.handle ?? me.userId, rung: 0, facts: { who: whoOf(me) }, href: profileHref({ handle: me.handle, userId: me.userId }) });
      }
      return json(200, { following: true });
    }
    if (m === 'DELETE') {
      await deps.db.query('delete from people.follow where follower_id = $1 and followee_id = $2', [me.userId, target.userId]);
      return json(200, { following: false });
    }
    return bad('method not allowed', 405);
  }

  if (head === 'comments' && seg.length === 1) {
    if (m === 'GET') {
      const s = parseSubject(url.searchParams.get('subject'));
      if (s === null) return bad('bad request');
      const rows = await deps.db.query<CommentRow>(`${COMMENT_SELECT} and c.subject_kind = $1 and c.subject_id = $3 order by c.created_at asc limit 500`, [s.kind, me?.userId ?? '', s.id]);
      const coin = await coinOf(deps.db, s);
      return json(200, { subject: `${s.kind}:${s.id}`, coin, comments: await shaped(deps, rows, me?.userId ?? null) });
    }
    if (m === 'POST') {
      if (me === null) return SIGN_IN;
      const b = (req.body ?? {}) as Record<string, unknown>;
      const s = parseSubject(b['subject']);
      if (s === null || !(await subjectExists(deps.db, s))) return bad("That isn't something you can comment on.");
      const body = cleanBody(b['body'], P.maxCommentChars);
      if (body === null) return bad(`A comment is 1 to ${P.maxCommentChars} characters.`);
      if (blockedWord(body)) return bad("That comment uses a word that isn't allowed here.");
      const [recent] = await deps.db.query<{ n: number }>('select count(*)::int as n from people.comment where author_id = $1 and created_at > now() - make_interval(secs => $2::float8 / 1000)', [me.userId, P.commentWindowMs]);
      if ((recent?.n ?? 0) >= P.commentsPerWindow) return bad(`That's ${P.commentsPerWindow} comments in an hour. Wait a little before the next.`, 429);
      const parentId = typeof b['parentId'] === 'number' && Number.isInteger(b['parentId']) ? b['parentId'] : null;
      let parentAuthor: { authorId: string } | null = null;
      if (parentId !== null) {
        const parent = await deps.db.query<{ authorId: string }>('select author_id as "authorId" from people.comment where comment_id = $1 and subject_kind = $2 and subject_id = $3', [parentId, s.kind, s.id]);
        if (parent[0] === undefined) return bad('That reply has nothing to reply to.');
        parentAuthor = parent[0];
      }
      const coin = await coinOf(deps.db, s);
      const proofUrl = typeof b['proofUrl'] === 'string' && b['proofUrl'].trim() !== '' ? b['proofUrl'].trim().slice(0, 500) : null;
      let proof = false;
      if (proofUrl !== null) {
        const link = proofLinkOf(proofUrl);
        if (link === null) return bad('A proof link must be an https link.');
        if (link.kind === 'x_post') proof = me.handle !== null && link.handle === me.handle.toLowerCase();
        if (link.kind === 'tx' && coin !== null && deps.chain !== null) proof = await deps.chain.txTouchesMint(link.signature, coin).catch(() => false);
      }
      const [row] = await deps.db.query<{ id: number }>(
        'insert into people.comment (author_id, subject_kind, subject_id, parent_id, body, proof_url, proof, coin_mint) values ($1, $2, $3, $4, $5, $6, $7, $8) returning comment_id::int as id',
        [me.userId, s.kind, s.id, parentId, body, proofUrl, proof, coin],
      );
      if (parentAuthor !== null && parentAuthor.authorId !== me.userId && row !== undefined) {
        await queueAlert(deps.db, { userId: parentAuthor.authorId, kind: 'reply', subject: String(row.id), rung: 0, facts: { who: whoOf(me), excerpt: body.slice(0, 80) }, href: await hrefOf(deps.db, s) });
      }
      const created = await deps.db.query<CommentRow>(`${COMMENT_SELECT} and c.comment_id = $1`, [row?.id ?? 0, me.userId]);
      return json(201, { comment: (await shaped(deps, created, me.userId))[0] ?? null });
    }
    return bad('method not allowed', 405);
  }

  if (head === 'comments' && id !== undefined && /^\d+$/.test(id) && sub !== undefined && seg.length === 3) {
    if (me === null) return SIGN_IN;
    const commentId = Number(id);
    const [c] = await deps.db.query<{ authorId: string; coin: string | null; proof: boolean; subjectKind: string; subjectId: string }>(
      'select author_id as "authorId", coin_mint as coin, proof, subject_kind as "subjectKind", subject_id as "subjectId" from people.comment where comment_id = $1 and hidden_at is null',
      [commentId],
    );
    if (c === undefined) return bad('not found', 404);

    if (sub === 'like' && m === 'POST') return like(deps, me, commentId, c);
    if (sub === 'like' && m === 'DELETE') {
      await deps.db.query('delete from people.comment_like where comment_id = $1 and voter_id = $2', [commentId, me.userId]);
      await deps.db.query('delete from people.rep_event where comment_id = $1 and voter_id = $2', [commentId, me.userId]);
      standingsCache.clear();
      return json(200, { liked: false, likes: await likeCount(deps.db, commentId) });
    }
    if (sub === 'report' && m === 'POST') {
      const reason = typeof (req.body as { reason?: unknown } | null)?.reason === 'string' ? (req.body as { reason: string }).reason.slice(0, 200) : '';
      await deps.db.query('insert into people.comment_report (comment_id, reporter_id, reason) values ($1, $2, $3) on conflict do nothing', [commentId, me.userId, reason]);
      const [n] = await deps.db.query<{ n: number }>('select count(*)::int as n from people.comment_report where comment_id = $1', [commentId]);
      if ((n?.n ?? 0) >= P.reportsToHide) await deps.db.query('update people.comment set hidden_at = coalesce(hidden_at, now()) where comment_id = $1', [commentId]);
      return json(200, { reported: true });
    }
    if (sub === 'hide' && m === 'POST') {
      await deps.db.query('insert into people.comment_hide (user_id, comment_id) values ($1, $2) on conflict do nothing', [me.userId, commentId]);
      return json(200, { hidden: true });
    }
    return bad('method not allowed', 405);
  }

  if (m === 'GET' && head === 'leaderboard' && seg.length === 1) {
    const season = seasonNow(deps.now(), P);
    const { map, order } = await seasonStandings(deps, season.id);
    const top = order.slice(0, P.leaderboardSize);
    const profiles = top.length === 0 ? [] : await deps.db.query<ProfileRow>(`select ${PROFILE_COLS} from people.profile where user_id = any($1)`, [top]);
    const byId = new Map(profiles.map((p) => [p.userId, p]));
    return json(200, {
      season,
      rows: top.map((userId, i) => {
        const p = byId.get(userId);
        const st = standingOf(map, userId);
        return { position: i + 1, userId, handle: p?.handle ?? null, name: p?.name ?? null, pictureUrl: p?.pictureUrl ?? null, rank: rankFor(st, P), rep: Math.round(st.rep), isMe: me?.userId === userId };
      }),
    });
  }

  return bad('not found', 404);
}

async function likeCount(db: Db, commentId: number): Promise<number> {
  const [n] = await db.query<{ n: number }>('select count(*)::int as n from people.comment_like where comment_id = $1', [commentId]);
  return n?.n ?? 0;
}

async function like(deps: SocialDeps, me: Person, commentId: number, c: { authorId: string; coin: string | null; proof: boolean; subjectKind: string; subjectId: string }): Promise<Reply> {
  const P = deps.policy;
  if (c.authorId === me.userId) return bad("You can't like your own comment.");
  if (c.coin === null) return bad('Likes open when this has one coin: only its holders can like.', 409);
  if (deps.chain === null) return bad("Likes can't be checked right now: the chain isn't connected.", 503);
  const wallets = me.wallets.map((w) => w.address);
  if (wallets.length === 0) return bad('Only holders of this coin can like its comments, and your sign-in has no wallet yet.', 403);
  const holds = await deps.chain.holds(wallets, c.coin).catch(() => null);
  if (holds === null) return bad("Your holdings couldn't be read just now. Try again in a moment.", 503);
  if (!holds) return bad('Only holders of this coin can like its comments.', 403);

  const added = await deps.db.query('insert into people.comment_like (comment_id, voter_id) values ($1, $2) on conflict do nothing returning 1', [commentId, me.userId]);
  let earned = 0;
  if (added.length > 0) {
    const now = deps.now();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const [today] = await deps.db.query<{ n: number }>('select count(*)::int as n from people.rep_event where voter_id = $1 and created_at >= $2', [me.userId, dayStart.toISOString()]);
    if (earnsRep(today?.n ?? 0, P)) {
      const season = seasonNow(now, P);
      const before = await seasonStandings(deps, season.id, true);
      const voterRank: RankId = rankFor(standingOf(before.map, me.userId), P);
      const authorBefore = rankFor(standingOf(before.map, c.authorId), P);
      const [author] = await deps.db.query<{ wallet: string | null; handle: string | null }>('select wallet, handle from people.profile where user_id = $1', [c.authorId]);
      const firstBuy = author?.wallet ? await deps.chain.firstBuyPriceSol(author.wallet, c.coin).catch(() => null) : null;
      const launch = firstBuy === null ? null : await deps.chain.launchPriceSol().catch(() => null);
      const early = boughtEarly(firstBuy, launch, P);
      const points = votePoints({ voterRank, proof: c.proof, early }, P);
      const inserted = await deps.db.query(
        `insert into people.rep_event (season, voter_id, comment_id, author_id, points, voter_rank, proof_boost, early_boost)
         values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (voter_id, comment_id) do nothing returning 1`,
        [season.id, me.userId, commentId, c.authorId, points, voterRank, c.proof, early],
      );
      if (inserted.length > 0) {
        earned = points;
        const after = await seasonStandings(deps, season.id, true);
        const authorAfter = rankFor(standingOf(after.map, c.authorId), P);
        if (rankedUp(authorBefore, authorAfter)) {
          await queueAlert(deps.db, { userId: c.authorId, kind: 'rank_up', subject: authorAfter, rung: season.id, facts: { rank: authorAfter, season: season.id }, href: profileHref({ handle: author?.handle ?? null, userId: c.authorId }) });
        }
      }
    }
  }
  return json(200, { liked: true, likes: await likeCount(deps.db, commentId), earned });
}
