/**
 * THE SOCIAL ROUTES: profiles, follows, comments, likes, reports, standings and the season
 * leaderboard. No reference to node:http, so every rule runs in a test against a real migrated
 * database (e2e/src/social.test.ts) and stand-ins for the sign-in provider and the chain.
 *
 *   GET    /me                         my profile and standing (signed in)
 *   POST   /me { pictureUrl? }         bring my profile up to date from my sign-in (and my X picture, xPictureOf)
 *   PUT    /me { name?, bio? } or { tradesPublic }   my name and bio (Edit profile), or "Show my trades to followers"
 *   POST   /me/picture, /me/banner { image }   my own picture or banner (profile-media.ts); DELETE to clear
 *   GET    /profile/:key               by handle or id: profile, rank card, counts, mutual followers, recent comments
 *   GET    /profile/:key/followers     and /following
 *   POST   /follow/:userId             DELETE the same to unfollow
 *   GET    /people/search?q=           people by handle or name, for Search's people strip (open to all)
 *   GET    /comments?subject=          a narrative's, a coin's or a post's comments, threaded
 *   POST   /comments { subject, parentId?, body, proofUrl? }
 *   POST   /comments/:id/like          DELETE the same to unlike
 *   POST   /comments/:id/report { reason }    POST /comments/:id/hide (for me only)
 *   GET    /leaderboard                this season's standings
 *   GET    /feed, /feed/people          the people you follow's trades and comments, People to follow (activity.ts)
 *   GET    /me/owner, /owner/…         the owner's calls on posts, coin matches and names (owner.ts)
 *   GET    /access, /invites/…, POST /waitlist, /owner/invites   invite-only access (invites.ts)
 *   GET    /onboarding, /username/:name, PUT /username, POST /onboarding/done   sign-up (onboarding.ts)
 *   POST   /onboarding/picture { image }   my photo, into our storage (picture.ts)
 *   GET    /missed, POST /missed       the owner's missed posts (missed.ts; the owner only)
 *   POST   /post/:id/reading          a post sheet was opened: ask for a fresh view reading (reading-ask.ts)
 *
 * ★ A PRIVATE PORTFOLIO HIDES THE WALLET (Trador's rule). A profile carries its wallet only to its
 * owner, or to everyone once "Show my trades to followers" is on; `portfolio` says which, so the
 * phone can say "@handle keeps their portfolio private" rather than show an empty one.
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
 * Follows, replies, likes on a comment and rank-ups queue an alert (people.alert_queue); the alert service decides
 * whether it is pushed. A follow or a reply carries who it is from (their id and their sign-in
 * picture) so the alert row shows their face and a follow can be followed back.
 */

import { DEFAULT_POLICY, type InvitePolicy, type OwnerPolicy, type SocialPolicy } from '@insidor/contracts/policy.ts';
import type { IdentityCheck, Person } from '@insidor/contracts/ports/people.ts';
import { boughtEarly, earnsRep, nextRank, rankFor, rankedUp, seasonOf, standings, votePoints, type RankId, type Standing } from '@insidor/core';

import { activityRoute } from './activity.ts';
import { json, type Reply, type Request } from './http.ts';
import { missedRoute } from './missed.ts';
import { mediaRoute, typedName, type MediaStore } from './profile-media.ts';
import { askForReading } from './reading-ask.ts';
import type { CoinCheck } from './coin-check.ts';
import { inviteRoute, ownerInvitesRoute } from './invites.ts';
import { onboardingRoute } from './onboarding.ts';
import { pictureRoute, type PhotoStore } from './picture.ts';
import { ownerRefOf, ownerRoute } from './owner.ts';
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
  /** Invite-only access (policy `invites`); absent, the defaults. */
  readonly invites?: InvitePolicy;
  /** The owner's pasted-address check (coin-check.ts); absent, it answers "not set up". */
  readonly coinCheck?: CoinCheck;
  /** Where sign-up photos are kept (picture.ts); absent or null, photos can't be saved and the route says so. */
  readonly photos?: PhotoStore | null;
  /** Where uploaded pictures and banners go (profile-media.ts); absent or null, uploads say they are not set up. */
  readonly media?: MediaStore;
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

/** Search's people strip shows this many at most: a swipeable row, not a directory. */
const PEOPLE_SEARCH_LIMIT = 20;

/**
 * A people search term: an @ in front is the way people write a handle, so it is dropped; handles
 * are stored lower case, so the term is too. Under 2 or over 40 characters is refused, as the
 * read service refuses a coin search that short.
 */
export function peopleTerm(raw: string | null): string | null {
  const t = (raw ?? '').trim().replace(/^@+/, '').toLowerCase();
  return t.length < 2 || t.length > 40 ? null : t;
}

/** The term with LIKE's own characters escaped, so "a_b" finds a_b and not every a?b. */
export const likeEscaped = (term: string): string => term.replace(/[\\%_]/g, (c) => `\\${c}`);

interface ProfileRow {
  userId: string;
  handle: string | null;
  name: string | null;
  pictureUrl: string | null;
  /** Their own uploaded picture (0124), tried before `pictureUrl`; null when none. */
  pictureFile: string | null;
  bannerFile: string | null;
  /** Their X handle from an X sign-in (0125); null for an email or Google member. */
  xHandle: string | null;
  bio: string;
  wallet: string | null;
  tradesPublic: boolean;
}

/* The name they typed in Edit profile wins over the sign-in's (0124); the sign-in rewrites `name` only. */
const PROFILE_COLS = `user_id as "userId", handle, coalesce(display_name, name) as name, picture_url as "pictureUrl", picture_file as "pictureFile", banner_file as "bannerFile", x_handle as "xHandle", bio, wallet, trades_public as "tradesPublic"`;
/** A person as a list shows them: with their own picture first when they uploaded one. */
const personOf = (r: ProfileRow) => ({ userId: r.userId, handle: r.handle, name: r.name, pictureUrl: r.pictureUrl, pictureFile: r.pictureFile });
/** How many of the people you follow who follow them are pictured on their profile. */
const MUTUALS_SHOWN = 3;

/**
 * The profile row brought up to date from a signed sign-in. An X handle someone else held as a copy
 * of their X handle moves to its new owner, as X moved it. A username a member CHOSE at sign-up
 * (handle_chosen_at, 0123) is theirs: the sign-in never overwrites it, and an X handle that matches
 * someone else's chosen name is simply not copied. A picture chosen at sign-up is kept the same way.
 */
/** An X handle as X allows it (0125's check), or null: anything else is not saved rather than failing the sign-in. */
const xHandleOf = (h: string | null): string | null => {
  const bare = h?.replace(/^@/, '') ?? null;
  return bare !== null && /^[A-Za-z0-9_]{1,15}$/.test(bare) ? bare : null;
};

export async function syncProfile(db: Db, p: Person): Promise<void> {
  const handle = p.handle?.toLowerCase() ?? null;
  const wallet = p.wallets.find((w) => w.kind === 'embedded')?.address ?? null;
  if (handle !== null) await db.query('update people.profile set handle = null where handle = $1 and user_id <> $2 and handle_chosen_at is null', [handle, p.userId]);
  await db.query(
    `insert into people.profile (user_id, handle, name, picture_url, wallet, x_handle)
     values ($1, case when exists (select 1 from people.profile o where o.handle = $2 and o.user_id <> $1) then null else $2 end, $3, $4, $5, $6)
     on conflict (user_id) do update set
       handle = case when people.profile.handle_chosen_at is not null then people.profile.handle else excluded.handle end,
       name = excluded.name,
       picture_url = case when people.profile.picture_chosen_at is not null then people.profile.picture_url else coalesce(excluded.picture_url, people.profile.picture_url) end,
       wallet = coalesce(excluded.wallet, people.profile.wallet),
       x_handle = coalesce(excluded.x_handle, people.profile.x_handle), updated_at = now()`,
    /* The X handle as X spells it, only from a signed X identity: what the X button links to (0125). */
    [p.userId, handle, p.name, p.pictureUrl, wallet, xHandleOf(p.handle)],
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

/**
 * A profile picture the app sent for its own signed-in person: kept only when it is X's own picture
 * host, so the one thing a request may say about itself can only ever be an X avatar, on the
 * sender's own profile. Anything else is null and the profile keeps what it had.
 */
export function xPictureOf(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 500) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.hostname === 'pbs.twimg.com' && u.pathname.startsWith('/profile_images/') ? u.toString() : null;
  } catch {
    return null;
  }
}

async function profileBy(db: Db, key: string): Promise<ProfileRow | null> {
  const rows = await db.query<ProfileRow>(`select ${PROFILE_COLS} from people.profile where user_id = $1 or handle = lower($1) limit 1`, [key]);
  return rows[0] ?? null;
}

/**
 * Whether a profile shows its portfolio: `shown` (theirs, or switched on), `private` (switched
 * off, so the wallet is withheld), or `no_wallet` (none on the profile yet). The one switch is
 * "Show my trades to followers", which governs both the Feed and this, as Trador's
 * `portfolio_public` governs both. Saying `private` tells no more than the missing wallet does.
 */
export function portfolioOf(p: { userId: string; wallet: string | null; tradesPublic: boolean }, viewer: string | null): 'shown' | 'private' | 'no_wallet' {
  if (p.wallet === null) return 'no_wallet';
  return viewer === p.userId || p.tradesPublic ? 'shown' : 'private';
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
  /* "Followed by @a and 4 others": people the viewer follows who follow them. Not on your own profile. */
  let mutuals: { count: number; people: ReturnType<typeof personOf>[] } | null = null;
  if (viewer !== null && viewer !== p.userId) {
    const rows = await deps.db.query<ProfileRow & { total: number }>(
      `select ${PROFILE_COLS}, count(*) over ()::int as total from people.profile
        where user_id in (select a.followee_id from people.follow a join people.follow b on b.follower_id = a.followee_id
                           where a.follower_id = $1 and b.followee_id = $2)
        order by handle nulls last limit $3`,
      [viewer, p.userId, MUTUALS_SHOWN],
    );
    mutuals = { count: rows[0]?.total ?? 0, people: rows.map(personOf) };
  }
  return {
    userId: p.userId,
    handle: p.handle,
    name: p.name,
    pictureUrl: p.pictureUrl,
    pictureFile: p.pictureFile,
    bannerFile: p.bannerFile,
    /* Their X account, for the X button: only an X sign-in has one (0125), never the chosen username. */
    xHandle: p.xHandle,
    bio: p.bio,
    /* Trador's visibleWallet: a private portfolio hides the wallet too, since the address is the
       whole portfolio to anyone with an explorer. Its owner always sees their own. */
    wallet: viewer === p.userId || p.tradesPublic ? p.wallet : null,
    portfolio: portfolioOf(p, viewer),
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
    /* Their own switch, shown only to them: whether anyone else has it on is not ours to list. */
    tradesPublic: viewer === p.userId ? p.tradesPublic : null,
    mutuals,
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
         p.user_id as "authorId", p.handle, coalesce(p.display_name, p.name) as name, p.picture_url as "pictureUrl"
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

async function queueAlert(db: Db, a: { userId: string; kind: 'follow' | 'reply' | 'rank_up' | 'comment_useful'; subject: string; rung: number; facts: Record<string, unknown>; href: string }): Promise<void> {
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

  /* Open to anyone, like the sheet itself: no sign-in is read for it (reading-ask.ts). */
  if (m === 'POST' && head === 'post' && id !== undefined && sub === 'reading' && seg.length === 3) return askForReading(deps.db, id, deps.now());

  const me = await signedIn(req, deps);

  /* Invite-only access (invites.ts); the owner's numbers and controls are behind the same owner check as every /owner route. */
  const invites = { db: deps.db, invites: deps.invites ?? DEFAULT_POLICY.invites, ...(deps.owner === undefined ? {} : { owner: deps.owner }) };
  if (head === 'owner' && id === 'invites' && seg.length === 2) {
    if (me === null) return SIGN_IN;
    const ref = ownerRefOf(me, deps.owner);
    return ref === null ? bad('Only the owner can do this.', 403) : ownerInvitesRoute(m, req.body, ref, invites);
  }
  const invited = await inviteRoute(m, seg, req.body, me, invites);
  if (invited !== null) return invited;
  if (head === 'onboarding' && id === 'picture' && seg.length === 2) return pictureRoute(m, req.body, me, { db: deps.db, photos: deps.photos ?? null });
  const onboarded = await onboardingRoute(m, seg, req.body, me, invites);
  if (onboarded !== null) return onboarded;

  const owned = await ownerRoute({ method: m, seg, query: url.searchParams, body: req.body }, me, deps);
  if (owned !== null) return owned;
  const activity = await activityRoute(m, seg, url.searchParams, me, deps, async (ids) => {
    const { map } = await seasonStandings(deps, seasonNow(deps.now(), P).id);
    return new Map(ids.map((u) => [u, rankFor(standingOf(map, u), P)]));
  });
  if (activity !== null) return activity;
  if (head === 'missed' && seg.length === 1) return missedRoute(m, req.body, me, { db: deps.db, owner: deps.owner, learning: DEFAULT_POLICY.learning, ...(deps.coinCheck === undefined ? {} : { coinCheck: deps.coinCheck }) });

  if (head === 'me' && (id === 'picture' || id === 'banner') && seg.length === 2) {
    if (me === null) return SIGN_IN;
    return mediaRoute(m, id, req.body, me.userId, { db: deps.db, media: deps.media ?? null });
  }

  if (head === 'me' && seg.length === 1) {
    if (me === null) return SIGN_IN;
    if (m === 'POST') {
      await syncProfile(deps.db, me);
      synced.set(me.userId, deps.now());
      /* Their own X picture, as the sign-in window showed it to the app, when the signed token
         carried none (see xPictureOf): every @handle on screen is drawn with its picture. */
      const sent = me.pictureUrl === null ? xPictureOf((req.body as { pictureUrl?: unknown } | null)?.pictureUrl) : null;
      if (sent !== null) await deps.db.query('update people.profile set picture_url = $2, updated_at = now() where user_id = $1 and picture_chosen_at is null', [me.userId, sent]);
    }
    if (m === 'PUT' && typeof (req.body as { tradesPublic?: unknown } | null)?.tradesPublic === 'boolean') {
      await deps.db.query('update people.profile set trades_public = $2, updated_at = now() where user_id = $1', [me.userId, (req.body as { tradesPublic: boolean }).tradesPublic]);
    } else if (m === 'PUT') {
      const b = (req.body ?? {}) as { bio?: unknown; name?: unknown };
      if (b.bio === undefined && b.name === undefined) return bad('Nothing to save.');
      /* Both are checked before either is written, so a refused name does not half-save the sheet. */
      const bio = b.bio === undefined ? undefined : typeof b.bio === 'string' ? b.bio.trim() : null;
      if (bio === null || (bio !== undefined && bio.length > P.maxBioChars)) return bad(`A bio is up to ${P.maxBioChars} characters.`);
      if (bio !== undefined && blockedWord(bio)) return bad("That bio uses a word that isn't allowed here.");
      const name = b.name === undefined ? undefined : typedName(b.name);
      if (name === null) return bad('A name is up to 50 characters.');
      if (name?.name != null && blockedWord(name.name)) return bad("That name uses a word that isn't allowed here.");
      if (bio !== undefined) await deps.db.query('update people.profile set bio = $2, updated_at = now() where user_id = $1', [me.userId, bio]);
      if (name !== undefined) await deps.db.query('update people.profile set display_name = $2, updated_at = now() where user_id = $1', [me.userId, name.name]);
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
      return json(200, { people: rows.map((r) => ({ ...personOf(r), rank: rankFor(standingOf(map, r.userId), P) })) });
    }
    const comments = await deps.db.query<CommentRow>(`${COMMENT_SELECT} and c.author_id = $1 order by c.created_at desc limit 30`, [p.userId, me?.userId ?? '']);
    return json(200, { profile: await card(deps, p, me?.userId ?? null), comments: await shaped(deps, comments, me?.userId ?? null) });
  }

  if (m === 'GET' && head === 'people' && id === 'search' && seg.length === 2) {
    const term = peopleTerm(url.searchParams.get('q'));
    if (term === null) return bad('A search is 2 to 40 characters.');
    const like = likeEscaped(term);
    /* Exact handle first, then a handle that starts with it, then a name or X handle that holds it;
       within each, the most followed. A missing handle compares as null, and null sorts first under
       desc, so each test is coalesced to false. The viewer is never in their own results. */
    const rows = await deps.db.query<ProfileRow & { followers: number; iFollow: boolean }>(
      `select ${PROFILE_COLS},
              (select count(*)::int from people.follow f where f.followee_id = p.user_id) as followers,
              exists (select 1 from people.follow f where f.follower_id = $3 and f.followee_id = p.user_id) as "iFollow"
         from people.profile p
        where p.user_id <> $3
          and (p.handle like $2 || '%' escape '\\' or coalesce(p.display_name, p.name) ilike '%' || $2 || '%' escape '\\' or p.x_handle ilike $2 || '%' escape '\\')
        order by coalesce(p.handle = $1, false) desc, coalesce(p.handle like $2 || '%' escape '\\', false) desc, followers desc, p.user_id
        limit ${PEOPLE_SEARCH_LIMIT}`,
      [term, like, me?.userId ?? ''],
    );
    const { map } = await seasonStandings(deps, seasonNow(deps.now(), P).id);
    return json(200, { people: rows.map((r) => ({ ...personOf(r), rank: rankFor(standingOf(map, r.userId), P), followers: r.followers, iFollow: r.iFollow })) });
  }

  if (head === 'follow' && id !== undefined && seg.length === 2) {
    if (me === null) return SIGN_IN;
    if (id === me.userId) return bad("You can't follow yourself.");
    const target = await profileBy(deps.db, id);
    if (target === null) return bad('not found', 404);
    if (m === 'POST') {
      const added = await deps.db.query('insert into people.follow (follower_id, followee_id) values ($1, $2) on conflict do nothing returning 1', [me.userId, target.userId]);
      if (added.length > 0) {
        await queueAlert(deps.db, { userId: target.userId, kind: 'follow', subject: me.handle ?? me.userId, rung: 0, facts: { who: whoOf(me), userId: me.userId, picture: me.pictureUrl }, href: profileHref({ handle: me.handle, userId: me.userId }) });
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
        await queueAlert(deps.db, { userId: parentAuthor.authorId, kind: 'reply', subject: String(row.id), rung: 0, facts: { who: whoOf(me), excerpt: body.slice(0, 80), userId: me.userId, picture: me.pictureUrl }, href: await hrefOf(deps.db, s) });
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
    /* Trador's "N people found your comment useful": one alert per comment, its level the count of holders who liked it. */
    const [liked] = await deps.db.query<{ n: number; body: string }>('select (select count(*)::int from people.comment_like where comment_id = $1) as n, body from people.comment where comment_id = $1', [commentId]);
    if (liked !== undefined) {
      const subject: Subject = { kind: c.subjectKind as Subject['kind'], id: c.subjectId };
      await queueAlert(deps.db, { userId: c.authorId, kind: 'comment_useful', subject: String(commentId), rung: liked.n, facts: { count: liked.n, excerpt: liked.body.slice(0, 80) }, href: await hrefOf(deps.db, subject) });
    }
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
