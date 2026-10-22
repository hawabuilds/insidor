/**
 * SIGN-UP, AS THE PHONE APP ASKS FOR IT — the client for services/social onboarding.ts and
 * picture.ts: where I am in sign-up, whether a username is free, taking one, my photo, and the end
 * of sign-up with my member number.
 *
 * Every reply is decoded here, field by field, so a screen holds only what it draws. A request that
 * could not be made is thrown, never turned into an answer: "we could not ask" is not "taken".
 *
 * What breaks if changed carelessly: `takeUsername` reads a lost race from the 409 status. A server
 * that changes it turns "just taken" into "couldn't save".
 */

import { PeopleError, socialCall } from './people.ts';

export interface SignUpStatus {
  readonly handle: string | null;
  readonly handleChosen: boolean;
  readonly name: string | null;
  readonly pictureUrl: string | null;
  readonly pictureChosen: boolean;
  readonly done: boolean;
  /** "Member 213": null before access, never 0. */
  readonly memberNo: number | null;
  /** Invites I can still give; null before access. */
  readonly invitesLeft: number | null;
  /** What the username box starts with: my name, or my X handle when it is free. */
  readonly start: string | null;
}

export type NameState = 'free' | 'yours' | 'taken' | 'invalid';
export interface NameCheck {
  readonly name: string;
  readonly state: NameState;
  /** Why an invalid name is, in words; null otherwise. */
  readonly problem: string | null;
  readonly suggestions: readonly string[];
}

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const https = (v: unknown): string | null => (typeof v === 'string' && v.startsWith('https://') ? v : null);
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^[a-z0-9_]{3,15}$/.test(x)) : []);

export function decodeStatus(v: unknown): SignUpStatus {
  const o = obj(v);
  const no = count(o['memberNo']);
  return {
    handle: str(o['handle']),
    handleChosen: o['handleChosen'] === true,
    name: str(o['name']),
    pictureUrl: https(o['pictureUrl']),
    pictureChosen: o['pictureChosen'] === true,
    done: o['done'] === true,
    memberNo: no === null || no === 0 ? null : no,
    invitesLeft: count(o['invitesLeft']),
    start: str(o['start']),
  };
}

export function decodeNameCheck(v: unknown): NameCheck {
  const o = obj(v);
  const s = o['state'];
  const state: NameState = s === 'free' || s === 'yours' || s === 'taken' ? s : 'invalid';
  return { name: str(o['name']) ?? '', state, problem: str(o['problem']), suggestions: names(o['suggestions']) };
}

export const fetchSignUp = async (): Promise<SignUpStatus> => decodeStatus(await socialCall('GET', '/onboarding'));
export const checkUsername = async (name: string): Promise<NameCheck> => decodeNameCheck(await socialCall('GET', `/username/${encodeURIComponent(name)}`));
export const finishSignUp = async (): Promise<SignUpStatus> => decodeStatus(await socialCall('POST', '/onboarding/done'));

/** Take a username: my new status, or why not (taken, with free ones near it; or the rule it breaks). */
export async function takeUsername(name: string): Promise<{ readonly ok: true; readonly status: SignUpStatus } | { readonly ok: false; readonly message: string; readonly suggestions: readonly string[] }> {
  try {
    return { ok: true, status: decodeStatus(await socialCall('PUT', '/username', { username: name })) };
  } catch (e) {
    if (e instanceof PeopleError && (e.status === 409 || e.status === 400)) return { ok: false, message: e.message, suggestions: [] };
    throw e;
  }
}

/** My photo, as a data URL of the square the screen cropped: the saved photo's link, or the server's reason. */
export async function savePhoto(dataUrl: string): Promise<{ readonly ok: true; readonly pictureUrl: string } | { readonly ok: false; readonly message: string }> {
  try {
    const url = https(obj(await socialCall('POST', '/onboarding/picture', { image: dataUrl }))['pictureUrl']);
    return url === null ? { ok: false, message: "Your photo couldn't be saved just now. Try again." } : { ok: true, pictureUrl: url };
  } catch (e) {
    if (e instanceof PeopleError) return { ok: false, message: e.message };
    return { ok: false, message: "Couldn't reach Insidor just now. Try again." };
  }
}
