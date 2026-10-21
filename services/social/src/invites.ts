/**
 * INVITE-ONLY ACCESS: who may use the app, the codes that let people in, and the waitlist
 * (people.member_access, invite_code, invite_redemption, waitlist; 0120).
 *
 *   GET  /access                       am I in? and if not, my place on the waitlist (signed in)
 *   GET  /invites/code/:code           open to anyone: valid, used up or unknown, and who it is from
 *                                      (the inviter's handle and picture, or the partner's name)
 *   POST /invites/redeem { code }      bring a code: in, or why not (signed in)
 *   GET  /invites/mine                 my codes, and who joined with them (members)
 *   POST /waitlist                     put me on the waitlist; answers my place (signed in)
 *   GET  /owner/invites                the owner's numbers: members, waitlist, codes, top inviters, partners
 *   POST /owner/invites { action }     let_in { count }, give { count }, partner { code, label, maxUses? }
 *
 * ★ THE DATABASE SPENDS A CODE, NOT THIS FILE. `people.redeem_invite` locks the code's row and
 * records access, redemption and use in one call, because this service holds no transaction
 * across statements (main.ts: the transaction-mode pooler). Nothing here reads a count and then
 * writes on the strength of it.
 *
 * ★ A MEMBER'S CODES ARE MADE WHEN FIRST ASKED FOR, ONE PER NUMBERED SLOT. The allowance is policy
 * `invites.perMember` plus what the owner gave everyone (`extra_invites`); slot n is unique per
 * member, so two phones asking at once cannot mint a fourth code.
 *
 * ★ BEFORE 0120 THE DOORS ARE OPEN. A database without these tables answers "in" to everyone, as
 * the app behaved before invites; it is the migration, not a deploy order, that closes them. The
 * owner is always in.
 *
 * Its own file, apart from routes.ts, because access is a gate in front of the social layer, not
 * part of it: none of this is about follows, comments or rep.
 *
 * What breaks if changed carelessly: `codeOf`. Codes are stored upper-case without spaces or
 * dashes; a lookup that skipped the same cleaning would call a typed "superteamuk" unknown.
 */

import { randomInt } from 'node:crypto';

import type { InvitePolicy, OwnerPolicy } from '@insidor/contracts/policy.ts';
import type { Person } from '@insidor/contracts/ports/people.ts';

import { json, type Reply } from './http.ts';
import { ownerRefOf } from './owner.ts';

interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R[]>;
}

export interface InviteDeps {
  readonly db: Db;
  readonly invites: InvitePolicy;
  readonly owner?: OwnerPolicy;
}

const bad = (error: string, status = 400, extra: Record<string, unknown> = {}): Reply => json(status, { error, ...extra });

/** No 0/O, 1/I/L: a code read off a screen or a poster is typed right the first time. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A code as typed, cleaned the one way codes are stored; null when it cannot be one. */
export function codeOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{4,32}$/.test(c) ? c : null;
}

/** A fresh member code from `pick` (the crypto source in production; a stand-in under test). */
export function newCode(length: number, pick: (n: number) => number = randomInt): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[pick(CODE_ALPHABET.length)] ?? 'A';
  return out;
}

/** A partner's name for the front door: one line, trimmed, up to 60 characters. */
export function partnerLabelOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/\s+/g, ' ').trim();
  return t.length >= 1 && t.length <= 60 ? t : null;
}

/** A whole number from 1 to `max`; null otherwise. */
export function countOf(raw: unknown, max: number): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= max ? raw : null;
}

const missingTable = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42P01';

interface Face {
  readonly userId: string;
  readonly handle: string | null;
  readonly name: string | null;
  readonly pictureUrl: string | null;
}

/* ── access and the waitlist ──────────────────────────────────────── */

async function isMember(db: Db, userId: string): Promise<boolean> {
  return (await db.query('select 1 from people.member_access where user_id = $1', [userId])).length > 0;
}

/** My place among the people still waiting (1 is next), and when I asked; null when I never asked or am in. */
async function placeOf(db: Db, userId: string): Promise<{ position: number; joinedAt: number } | null> {
  const [row] = await db.query<{ position: number; joinedAt: number }>(
    `select (select count(*)::int from people.waitlist o
              where o.seq <= w.seq and o.let_in_at is null
                and not exists (select 1 from people.member_access a where a.user_id = o.user_id)) as position,
            (extract(epoch from w.joined_at) * 1000)::float8 as "joinedAt"
       from people.waitlist w where w.user_id = $1`,
    [userId],
  );
  return row === undefined ? null : row;
}

async function accessOf(deps: InviteDeps, me: Person): Promise<{ access: boolean; waitlist: { position: number; joinedAt: number } | null }> {
  if (ownerRefOf(me, deps.owner) !== null) {
    await deps.db.query(`insert into people.member_access (user_id, via) values ($1, 'owner') on conflict (user_id) do nothing`, [me.userId]);
    return { access: true, waitlist: null };
  }
  if (await isMember(deps.db, me.userId)) return { access: true, waitlist: null };
  return { access: false, waitlist: await placeOf(deps.db, me.userId) };
}

/* ── members' codes ───────────────────────────────────────────────── */

/** Every slot of my allowance holds a code, made now where one is missing. */
async function ensureCodes(deps: InviteDeps, userId: string): Promise<void> {
  const [row] = await deps.db.query<{ extra: number }>('select extra_invites as extra from people.member_access where user_id = $1', [userId]);
  if (row === undefined) return;
  const allowance = deps.invites.perMember + row.extra;
  const have = new Set((await deps.db.query<{ slot: number }>('select slot from people.invite_code where owner_id = $1', [userId])).map((r) => r.slot));
  for (let slot = 1; slot <= allowance; slot += 1) {
    if (have.has(slot)) continue;
    /* A new code can collide with one already out; a few draws make that vanishingly unlikely. */
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const made = await deps.db.query(
        `insert into people.invite_code (code, kind, owner_id, slot, max_uses) values ($1, 'member', $2, $3, 1) on conflict do nothing returning 1`,
        [newCode(deps.invites.codeLength), userId, slot],
      );
      if (made.length > 0) break;
      /* Another request filled the slot first: done. */
      if ((await deps.db.query('select 1 from people.invite_code where owner_id = $1 and slot = $2', [userId, slot])).length > 0) break;
    }
  }
}

/* ── the routes ───────────────────────────────────────────────────── */

/** The invite routes, or null when the path is not one of them. */
export async function inviteRoute(method: string, seg: readonly string[], body: unknown, me: Person | null, deps: InviteDeps): Promise<Reply | null> {
  const [head, sub, arg] = seg;
  const ours = (head === 'access' && seg.length === 1) || (head === 'waitlist' && seg.length === 1) || (head === 'invites' && (seg.length === 2 || (sub === 'code' && seg.length === 3)));
  if (!ours) return null;
  try {
    return await route(method, head, sub, arg, body, me, deps);
  } catch (e) {
    /* Before 0120: the doors are open, and there is nothing to invite with yet. */
    if (!missingTable(e)) throw e;
    if (head === 'access') return json(200, { access: true, waitlist: null });
    return bad('Invites are not open yet.', 503);
  }
}

async function route(method: string, head: string | undefined, sub: string | undefined, arg: string | undefined, body: unknown, me: Person | null, deps: InviteDeps): Promise<Reply> {
  const { db } = deps;

  /* Open to anyone: the front door reads it before sign-in to say who invited you. */
  if (head === 'invites' && sub === 'code' && arg !== undefined) {
    if (method !== 'GET') return bad('method not allowed', 405);
    const code = codeOf(arg);
    if (code === null) return json(200, { code: null, state: 'unknown', from: null });
    const [c] = await db.query<{ kind: string; uses: number; maxUses: number; label: string | null } & Face>(
      `select c.kind, c.uses, c.max_uses as "maxUses", c.partner_label as label,
              p.user_id as "userId", p.handle, p.name, p.picture_url as "pictureUrl"
         from people.invite_code c left join people.profile p on p.user_id = c.owner_id
        where c.code = $1`,
      [code],
    );
    if (c === undefined) return json(200, { code, state: 'unknown', from: null });
    const from = c.kind === 'partner' ? { kind: 'partner', label: c.label } : { kind: 'member', userId: c.userId, handle: c.handle, name: c.name, pictureUrl: c.pictureUrl };
    return json(200, { code, state: c.uses >= c.maxUses ? 'used_up' : 'valid', from });
  }

  if (me === null) return bad('Sign in first.', 401);

  if (head === 'access') {
    if (method !== 'GET') return bad('method not allowed', 405);
    return json(200, await accessOf(deps, me));
  }

  if (head === 'waitlist') {
    if (method !== 'POST') return bad('method not allowed', 405);
    const now = await accessOf(deps, me);
    if (now.access) return json(200, now);
    await db.query('insert into people.waitlist (user_id, handle) values ($1, $2) on conflict (user_id) do nothing', [me.userId, me.handle?.toLowerCase() ?? null]);
    return json(200, await accessOf(deps, me));
  }

  if (head === 'invites' && sub === 'redeem') {
    if (method !== 'POST') return bad('method not allowed', 405);
    if (ownerRefOf(me, deps.owner) !== null) return json(200, { access: true, result: 'member' });
    const code = codeOf((body as { code?: unknown } | null)?.code);
    if (code === null) return bad("That isn't a code we know. Check it and try again.", 404, { state: 'unknown' });
    const [r] = await db.query<{ result: string }>('select people.redeem_invite($1, $2) as result', [code, me.userId]);
    const result = r?.result ?? 'unknown';
    if (result === 'joined' || result === 'member') return json(200, { access: true, result });
    if (result === 'used_up') return bad('That code has been used. Ask for another, or join the waitlist.', 409, { state: 'used_up' });
    return bad("That isn't a code we know. Check it and try again.", 404, { state: 'unknown' });
  }

  if (head === 'invites' && sub === 'mine') {
    if (method !== 'GET') return bad('method not allowed', 405);
    if (!(await accessOf(deps, me)).access) return bad('Invites open once you are in.', 403);
    await ensureCodes(deps, me.userId);
    const codes = await db.query<{ code: string; used: boolean }>(
      `select code, uses >= max_uses as used from people.invite_code where owner_id = $1 order by used, slot`,
      [me.userId],
    );
    const joined = await db.query<Face & { at: number }>(
      `select p.user_id as "userId", p.handle, p.name, p.picture_url as "pictureUrl", (extract(epoch from r.redeemed_at) * 1000)::float8 as at
         from people.invite_redemption r
         join people.invite_code c on c.code = r.code
         join people.profile p on p.user_id = r.user_id
        where c.owner_id = $1
        order by r.redeemed_at desc
        limit $2`,
      [me.userId, deps.invites.joinedShown],
    );
    return json(200, { codes, joined });
  }

  return bad('not found', 404);
}

/* ── the owner's ──────────────────────────────────────────────────── */

/** GET and POST /owner/invites. `ref` is the owner reference owner.ts matched; nobody else reaches this. */
export async function ownerInvitesRoute(method: string, body: unknown, ref: string, deps: InviteDeps): Promise<Reply> {
  try {
    return await ownerRoute(method, body, ref, deps);
  } catch (e) {
    if (missingTable(e)) return bad('Invites are not open yet: migration 0120 is not applied.', 503);
    throw e;
  }
}

async function ownerRoute(method: string, body: unknown, ref: string, deps: InviteDeps): Promise<Reply> {
  const { db } = deps;
  const P = deps.invites;
  if (method === 'POST') {
    const b = (body ?? {}) as Record<string, unknown>;
    if (b['action'] === 'let_in') {
      const count = countOf(b['count'], P.maxLetIn);
      if (count === null) return bad(`Let in 1 to ${P.maxLetIn} at a time.`);
      const [r] = await db.query<{ n: number }>('select people.let_in_next($1) as n', [count]);
      return json(200, { letIn: r?.n ?? 0, stats: await statsOf(deps) });
    }
    if (b['action'] === 'give') {
      const count = countOf(b['count'], P.maxGive);
      if (count === null) return bad(`Give 1 to ${P.maxGive} codes at a time.`);
      const given = await db.query('update people.member_access set extra_invites = extra_invites + $1 returning 1', [count]);
      return json(200, { members: given.length, stats: await statsOf(deps) });
    }
    if (b['action'] === 'partner') {
      const code = codeOf(b['code']);
      if (code === null) return bad('A code is 4 to 32 letters and numbers.');
      const label = partnerLabelOf(b['label']);
      if (label === null) return bad("Name the partner as the front door should show it, up to 60 characters.");
      const maxUses = b['maxUses'] === undefined || b['maxUses'] === null ? P.partnerDefaultUses : countOf(b['maxUses'], P.partnerMaxUses);
      if (maxUses === null) return bad(`A partner code works 1 to ${P.partnerMaxUses} times.`);
      const made = await db.query(
        `insert into people.invite_code (code, kind, partner_label, created_by, max_uses) values ($1, 'partner', $2, $3, $4) on conflict do nothing returning 1`,
        [code, label, ref, maxUses],
      );
      if (made.length === 0) return bad('That code is taken.', 409);
      return json(201, { code, stats: await statsOf(deps) });
    }
    return bad('Say what to do: let_in, give or partner.');
  }
  if (method !== 'GET') return bad('method not allowed', 405);
  return json(200, await statsOf(deps));
}

async function statsOf(deps: InviteDeps) {
  const { db } = deps;
  const P = deps.invites;
  const [n] = await db.query<{ members: number; byCode: number; letIn: number; before: number; waiting: number; allowed: number; issued: number; used: number }>(
    `select (select count(*)::int from people.member_access) as members,
            (select count(*)::int from people.member_access where via = 'code') as "byCode",
            (select count(*)::int from people.member_access where via = 'waitlist') as "letIn",
            (select count(*)::int from people.member_access where via = 'before_invites') as before,
            (select count(*)::int from people.waitlist w where w.let_in_at is null
               and not exists (select 1 from people.member_access a where a.user_id = w.user_id)) as waiting,
            (select coalesce(sum($1::int + extra_invites), 0)::int from people.member_access) as allowed,
            (select count(*)::int from people.invite_code where kind = 'member') as issued,
            (select coalesce(sum(uses), 0)::int from people.invite_code where kind = 'member') as used`,
    [P.perMember],
  );
  const top = await db.query<Face & { joined: number }>(
    `select p.user_id as "userId", p.handle, p.name, p.picture_url as "pictureUrl", count(*)::int as joined
       from people.invite_redemption r
       join people.invite_code c on c.code = r.code and c.kind = 'member'
       join people.profile p on p.user_id = c.owner_id
      group by p.user_id
      order by joined desc, min(r.redeemed_at) asc
      limit $1`,
    [P.topInviters],
  );
  const partners = await db.query<{ code: string; label: string; uses: number; maxUses: number; createdAt: number }>(
    `select code, partner_label as label, uses, max_uses as "maxUses", (extract(epoch from created_at) * 1000)::float8 as "createdAt"
       from people.invite_code where kind = 'partner' order by created_at desc`,
  );
  return {
    members: n?.members ?? 0,
    joinedWithCode: n?.byCode ?? 0,
    letInFromWaitlist: n?.letIn ?? 0,
    beforeInvites: n?.before ?? 0,
    waiting: n?.waiting ?? 0,
    /* "Codes out": what members may hand out, the codes made so far, and how many were used. */
    memberCodes: { allowed: n?.allowed ?? 0, made: n?.issued ?? 0, used: n?.used ?? 0 },
    perMember: P.perMember,
    topInviters: top,
    partners,
  };
}
