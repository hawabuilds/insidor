/**
 * SIGN-UP, AS THE SERVER KEEPS IT: where a member is in it, the username they pick, and the end of
 * it, with their member number (people.profile, 0123).
 *
 *   GET  /onboarding                 where I am: my username and whether I chose it, my picture and
 *                                    whether I chose it, whether I finished, my number, invites left,
 *                                    and a name to start the username box with (signed in)
 *   GET  /username/:name             is this name free for me? and, when it is not, a few that are
 *   PUT  /username { username }      take it (members only): it is mine, and no sign-in replaces it
 *   POST /onboarding/done            I reached the last screen: marked done, numbered (members only)
 *
 * The picture is picture.ts's: its body is a photo, and the transport lets only that route carry one.
 *
 * ★ THE DATABASE SAYS WHO HOLDS A NAME. A check answers "free" and the write can still lose to
 * someone faster; the unique index on `handle` decides, and the loser is told the name was taken
 * with fresh suggestions, never a server error.
 *
 * ★ NO NUMBER BEFORE ACCESS. A member number is taken only for someone with access, and only once
 * (people.member_number). Someone on the waitlist has none; the screen says nothing rather than 0.
 *
 * Its own file, apart from routes.ts, because sign-up is a phase a person passes through once,
 * not part of the social layer they use after.
 *
 * What breaks if changed carelessly: `done` is set once (`coalesce`). Resetting it on a second call
 * would send a member back through sign-up on their next new phone.
 */

import type { InvitePolicy, OwnerPolicy } from '@insidor/contracts/policy.ts';
import type { Person } from '@insidor/contracts/ports/people.ts';

import { json, type Reply } from './http.ts';
import { ownerRefOf } from './owner.ts';
import { PROBLEM_WORDS, baseOf, candidatesFor, cleanUsername, usernameProblem } from './username.ts';

interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R[]>;
}

export interface OnboardingDeps {
  readonly db: Db;
  readonly invites: InvitePolicy;
  readonly owner?: OwnerPolicy;
}

/** How many free names are offered when one is taken. */
const SUGGESTIONS = 3;

const bad = (error: string, status = 400, extra: Record<string, unknown> = {}): Reply => json(status, { error, ...extra });
const uniqueViolation = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '23505';

async function isMember(deps: OnboardingDeps, me: Person): Promise<boolean> {
  if (ownerRefOf(me, deps.owner) !== null) {
    await deps.db.query(`insert into people.member_access (user_id, via) values ($1, 'owner') on conflict (user_id) do nothing`, [me.userId]);
    return true;
  }
  return (await deps.db.query('select 1 from people.member_access where user_id = $1', [me.userId])).length > 0;
}

/** The names in `names` nobody but me holds. */
async function freeOf(db: Db, names: readonly string[], me: string): Promise<string[]> {
  if (names.length === 0) return [];
  const held = new Set((await db.query<{ handle: string }>('select handle from people.profile where handle = any($1) and user_id <> $2', [names, me])).map((r) => r.handle));
  return names.filter((n) => !held.has(n));
}

/** A few free names near `base`, from the person's own other names too. */
async function suggestionsFor(db: Db, base: string, me: Person): Promise<string[]> {
  const also = [me.handle ?? '', (me.name ?? '').replace(/\s+/g, '')];
  return (await freeOf(db, candidatesFor(base, also), me.userId)).slice(0, SUGGESTIONS);
}

type NameState = 'free' | 'yours' | 'taken' | 'invalid';

async function nameState(db: Db, name: string, me: string): Promise<NameState> {
  if (usernameProblem(name) !== null) return 'invalid';
  const [row] = await db.query<{ userId: string }>('select user_id as "userId" from people.profile where handle = $1', [name]);
  if (row === undefined) return 'free';
  return row.userId === me ? 'yours' : 'taken';
}

/** Codes I can still give: my allowance less the codes of mine someone used; null without access. */
async function invitesLeft(deps: OnboardingDeps, userId: string): Promise<number | null> {
  const [row] = await deps.db.query<{ extra: number; used: number }>(
    `select a.extra_invites as extra,
            (select coalesce(sum(c.uses), 0)::int from people.invite_code c where c.owner_id = a.user_id and c.kind = 'member') as used
       from people.member_access a where a.user_id = $1`,
    [userId],
  );
  return row === undefined ? null : Math.max(0, deps.invites.perMember + row.extra - row.used);
}

interface StatusRow {
  handle: string | null;
  handleChosen: boolean;
  name: string | null;
  pictureUrl: string | null;
  pictureChosen: boolean;
  done: boolean;
  memberNo: string | null;
}

async function statusOf(deps: OnboardingDeps, me: Person) {
  const [p] = await deps.db.query<StatusRow>(
    `select handle, handle_chosen_at is not null as "handleChosen", name, picture_url as "pictureUrl",
            picture_chosen_at is not null as "pictureChosen", onboarded_at is not null as done, member_no::text as "memberNo"
       from people.profile where user_id = $1`,
    [me.userId],
  );
  /* The box starts with my current name, else my X handle when it is free and fits the rules. */
  const fromX = baseOf(me.handle);
  const start = p?.handle ?? (usernameProblem(fromX) === null && (await freeOf(deps.db, [fromX], me.userId)).length === 1 ? fromX : null);
  return {
    handle: p?.handle ?? null,
    handleChosen: p?.handleChosen ?? false,
    name: p?.name ?? me.name,
    pictureUrl: p?.pictureUrl ?? me.pictureUrl,
    pictureChosen: p?.pictureChosen ?? false,
    done: p?.done ?? false,
    memberNo: p?.memberNo === null || p?.memberNo === undefined ? null : Number(p.memberNo),
    invitesLeft: await invitesLeft(deps, me.userId),
    start,
  };
}

/** The sign-up routes, or null when the path is not one of them. */
export async function onboardingRoute(method: string, seg: readonly string[], body: unknown, me: Person | null, deps: OnboardingDeps): Promise<Reply | null> {
  const [head, sub] = seg;
  const ours = (head === 'onboarding' && (seg.length === 1 || (sub === 'done' && seg.length === 2))) || (head === 'username' && seg.length <= 2);
  if (!ours) return null;
  if (me === null) return bad('Sign in first.', 401);
  const { db } = deps;

  if (head === 'onboarding' && sub === undefined) {
    if (method !== 'GET') return bad('method not allowed', 405);
    return json(200, await statusOf(deps, me));
  }

  if (head === 'onboarding' && sub === 'done') {
    if (method !== 'POST') return bad('method not allowed', 405);
    if (!(await isMember(deps, me))) return bad('Sign-up finishes once you are in.', 403);
    await db.query('update people.profile set onboarded_at = coalesce(onboarded_at, now()), updated_at = now() where user_id = $1', [me.userId]);
    await db.query('select people.member_number($1)', [me.userId]);
    return json(200, await statusOf(deps, me));
  }

  if (head === 'username' && sub !== undefined) {
    if (method !== 'GET') return bad('method not allowed', 405);
    const name = cleanUsername(sub);
    const problem = usernameProblem(name);
    const state = await nameState(db, name, me.userId);
    const suggestions = state === 'taken' || problem === 'reserved' ? await suggestionsFor(db, name, me) : [];
    return json(200, { name, state, problem: problem === null ? null : PROBLEM_WORDS[problem], suggestions });
  }

  if (head === 'username' && sub === undefined) {
    if (method !== 'PUT') return bad('method not allowed', 405);
    if (!(await isMember(deps, me))) return bad('Pick a username once you are in.', 403);
    const name = cleanUsername((body as { username?: unknown } | null)?.username);
    const problem = usernameProblem(name);
    if (problem !== null) return bad(PROBLEM_WORDS[problem], 400, { state: 'invalid' });
    const taken = async () => bad('That name was just taken.', 409, { state: 'taken', suggestions: await suggestionsFor(db, name, me) });
    if ((await nameState(db, name, me.userId)) === 'taken') return taken();
    try {
      await db.query('update people.profile set handle = $2, handle_chosen_at = now(), updated_at = now() where user_id = $1', [me.userId, name]);
    } catch (e) {
      if (uniqueViolation(e)) return taken();
      throw e;
    }
    return json(200, await statusOf(deps, me));
  }

  return bad('not found', 404);
}
