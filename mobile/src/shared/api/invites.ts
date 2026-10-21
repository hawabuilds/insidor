/**
 * INVITES, AS THE PHONE APP ASKS FOR THEM — the client for services/social invites.ts: whether I am
 * in, a code checked at the door, a code brought, the waitlist, my codes and who joined with them,
 * and the owner's numbers and controls.
 *
 * Every reply is decoded here, field by field, so a screen holds only what it draws. A request that
 * could not be made is thrown, never turned into an answer: "we could not ask" is not "you are not
 * in" (shared/sign-in.ts keeps the two apart).
 *
 * What breaks if changed carelessly: `redeemCode` reads the refusal's `state` from the error's
 * status (409 used up, 404 unknown). A server that changes those statuses turns every refusal
 * into "we could not ask".
 */

import { PeopleError, socialCall } from './people.ts';

export interface InvitePerson {
  readonly userId: string;
  readonly handle: string | null;
  readonly name: string | null;
  readonly pictureUrl: string | null;
}

export type InviteFrom = ({ readonly kind: 'member' } & InvitePerson) | { readonly kind: 'partner'; readonly label: string };
export type CodeState = 'valid' | 'used_up' | 'unknown';
export interface CodeCheck {
  readonly code: string | null;
  readonly state: CodeState;
  readonly from: InviteFrom | null;
}

export interface AccessAnswer {
  readonly access: boolean;
  /** My place on the waitlist (1 is next) and when I asked; null when I never asked or am in. */
  readonly waitlist: { readonly position: number; readonly joinedAt: number } | null;
}

export interface MyInvites {
  readonly codes: readonly { readonly code: string; readonly used: boolean }[];
  readonly joined: readonly (InvitePerson & { readonly at: number })[];
}

export interface InviteStats {
  readonly members: number;
  readonly joinedWithCode: number;
  readonly letInFromWaitlist: number;
  readonly beforeInvites: number;
  readonly waiting: number;
  readonly memberCodes: { readonly allowed: number; readonly made: number; readonly used: number };
  readonly perMember: number;
  readonly topInviters: readonly (InvitePerson & { readonly joined: number })[];
  readonly partners: readonly { readonly code: string; readonly label: string; readonly uses: number; readonly maxUses: number; readonly createdAt: number }[];
}

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const https = (v: unknown): string | null => (typeof v === 'string' && v.startsWith('https://') ? v : null);

export function personOf(v: unknown): InvitePerson {
  const o = obj(v);
  return { userId: str(o['userId']) ?? '', handle: str(o['handle']), name: str(o['name']), pictureUrl: https(o['pictureUrl']) };
}

export function decodeCodeCheck(v: unknown): CodeCheck {
  const o = obj(v);
  const state: CodeState = o['state'] === 'valid' || o['state'] === 'used_up' ? o['state'] : 'unknown';
  const f = obj(o['from']);
  const from: InviteFrom | null = f['kind'] === 'partner' && str(f['label']) !== null ? { kind: 'partner', label: str(f['label']) ?? '' } : f['kind'] === 'member' ? { kind: 'member', ...personOf(f) } : null;
  return { code: str(o['code']), state, from };
}

export function decodeAccess(v: unknown): AccessAnswer {
  const o = obj(v);
  const w = o['waitlist'];
  const wait = w === null || w === undefined ? null : { position: num(obj(w)['position']), joinedAt: num(obj(w)['joinedAt']) };
  return { access: o['access'] === true, waitlist: wait !== null && wait.position >= 1 ? wait : null };
}

export function decodeMyInvites(v: unknown): MyInvites {
  const o = obj(v);
  const codes = (Array.isArray(o['codes']) ? o['codes'] : []).flatMap((c) => {
    const code = str(obj(c)['code']);
    return code === null ? [] : [{ code, used: obj(c)['used'] === true }];
  });
  const joined = (Array.isArray(o['joined']) ? o['joined'] : []).map((j) => ({ ...personOf(j), at: num(obj(j)['at']) }));
  return { codes, joined };
}

export function decodeStats(v: unknown): InviteStats {
  const o = obj(v);
  const mc = obj(o['memberCodes']);
  return {
    members: num(o['members']),
    joinedWithCode: num(o['joinedWithCode']),
    letInFromWaitlist: num(o['letInFromWaitlist']),
    beforeInvites: num(o['beforeInvites']),
    waiting: num(o['waiting']),
    memberCodes: { allowed: num(mc['allowed']), made: num(mc['made']), used: num(mc['used']) },
    perMember: num(o['perMember']),
    topInviters: (Array.isArray(o['topInviters']) ? o['topInviters'] : []).map((t) => ({ ...personOf(t), joined: num(obj(t)['joined']) })),
    partners: (Array.isArray(o['partners']) ? o['partners'] : []).flatMap((p) => {
      const r = obj(p);
      const code = str(r['code']);
      return code === null ? [] : [{ code, label: str(r['label']) ?? code, uses: num(r['uses']), maxUses: num(r['maxUses']), createdAt: num(r['createdAt']) }];
    }),
  };
}

export const fetchAccess = async (): Promise<AccessAnswer> => decodeAccess(await socialCall('GET', '/access'));
export const checkCode = async (code: string): Promise<CodeCheck> => decodeCodeCheck(await socialCall('GET', `/invites/code/${encodeURIComponent(code)}`));
export const joinWaitlist = async (): Promise<AccessAnswer> => decodeAccess(await socialCall('POST', '/waitlist'));
export const fetchMyInvites = async (): Promise<MyInvites> => decodeMyInvites(await socialCall('GET', '/invites/mine'));

/** A code brought: in, or the server's reason it did not let me in. Anything else is thrown. */
export async function redeemCode(code: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly state: 'used_up' | 'unknown'; readonly message: string }> {
  try {
    await socialCall('POST', '/invites/redeem', { code });
    return { ok: true };
  } catch (e) {
    if (e instanceof PeopleError && (e.status === 409 || e.status === 404)) return { ok: false, state: e.status === 409 ? 'used_up' : 'unknown', message: e.message };
    throw e;
  }
}

export const fetchInviteStats = async (): Promise<InviteStats> => decodeStats(await socialCall('GET', '/owner/invites'));
export const letInNext = async (count: number): Promise<InviteStats> => decodeStats(obj(await socialCall('POST', '/owner/invites', { action: 'let_in', count }))['stats']);
export const giveEveryone = async (count: number): Promise<InviteStats> => decodeStats(obj(await socialCall('POST', '/owner/invites', { action: 'give', count }))['stats']);
export const makePartnerCode = async (p: { readonly code: string; readonly label: string; readonly maxUses: number }): Promise<InviteStats> =>
  decodeStats(obj(await socialCall('POST', '/owner/invites', { action: 'partner', ...p }))['stats']);
