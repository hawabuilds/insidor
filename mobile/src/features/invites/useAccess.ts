/**
 * WHETHER THIS SIGN-IN IS LET IN — asked once a person has signed in on a browser that was never
 * let in before, and turned into the gate's `Access` (shared/sign-in.ts).
 *
 * The order on a first sign-in: ask the social service; if not in and a code is waiting on this
 * phone (an invite link, or typed at the door before signing in), bring it; then the answer. A
 * code the server refused is forgotten here and its reason shown at the door, so a used-up code is
 * not brought again on every launch.
 *
 * ★ A REQUEST THAT FAILED IS `unchecked`, NEVER `out`. The door then says it could not check and
 * offers a retry; it does not tell a member they are not one because a network call failed.
 *
 * ★ WHILE WAITING, THE PLACE IS READ AGAIN every minute and whenever the app comes back to the
 * front, so someone the owner lets in goes straight in without signing in again.
 *
 * What breaks if changed carelessly: the effect's key is `need`, not `signedIn`. Asked for a
 * browser already let in, a failed read would push a member out to the door for no reason.
 */

import { useEffect, useState } from 'react';

import { fetchAccess, joinWaitlist, redeemCode } from '../../shared/api/invites.ts';
import type { Access } from '../../shared/sign-in.ts';
import { keepCode, pendingCode } from './invite-code.ts';

const ASK_AGAIN_MS = 60_000;
const COULD_NOT_ASK = "Couldn't reach Insidor just now. Try again.";

export interface AccessState {
  readonly access: Access;
  /** My place on the waitlist (1 is next) and when I asked. */
  readonly place: { readonly position: number; readonly joinedAt: number } | null;
  /** Why the code brought on the way in was refused; null when none was. */
  readonly refusal: string | null;
  /** Bring a code: null when it let me in, else the reason it did not. */
  readonly bring: (code: string) => Promise<string | null>;
  /** Join the waitlist: null when done, else what went wrong. */
  readonly wait: () => Promise<string | null>;
  readonly retry: () => void;
}

export function useAccess(signedIn: boolean, entered: boolean): AccessState {
  const need = signedIn && !entered;
  const [access, setAccess] = useState<Access>('unknown');
  const [place, setPlace] = useState<AccessState['place']>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [ask, setAsk] = useState(0);

  useEffect(() => {
    if (!need) {
      setAccess('unknown');
      return;
    }
    let live = true;
    void (async () => {
      try {
        let a = await fetchAccess();
        const code = a.access ? null : pendingCode();
        if (code !== null) {
          const r = await redeemCode(code);
          keepCode(null);
          if (r.ok) a = { access: true, waitlist: null };
          else if (live) setRefusal(r.message);
        }
        if (!live) return;
        setPlace(a.waitlist);
        setAccess(a.access ? 'in' : a.waitlist !== null ? 'waiting' : 'out');
      } catch {
        if (live) setAccess((now) => (now === 'waiting' ? now : 'unchecked'));
      }
    })();
    return () => {
      live = false;
    };
  }, [need, ask]);

  useEffect(() => {
    if (access !== 'waiting') return;
    const again = () => setAsk((n) => n + 1);
    const t = setInterval(again, ASK_AGAIN_MS);
    const back = () => {
      if (document.visibilityState === 'visible') again();
    };
    document.addEventListener('visibilitychange', back);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', back);
    };
  }, [access]);

  const bring = async (code: string): Promise<string | null> => {
    try {
      const r = await redeemCode(code);
      if (!r.ok) return r.message;
      keepCode(null);
      setAccess('in');
      return null;
    } catch {
      return COULD_NOT_ASK;
    }
  };
  const wait = async (): Promise<string | null> => {
    try {
      const a = await joinWaitlist();
      setPlace(a.waitlist);
      setAccess(a.access ? 'in' : 'waiting');
      return null;
    } catch {
      return COULD_NOT_ASK;
    }
  };
  return {
    access,
    place,
    refusal,
    bring,
    wait,
    retry: () => {
      setAccess('unknown');
      setAsk((n) => n + 1);
    },
  };
}
