/**
 * WHERE THIS MEMBER IS IN SIGN-UP — asked once someone is let in on a browser never let in before,
 * and turned into the gate's `SignUp` (shared/sign-in.ts).
 *
 * ★ A REQUEST THAT FAILED IS `unchecked`, NEVER `needed`. The gate then lets the member in rather
 * than hold them at a screen they may have finished on another phone; the browser is not marked let
 * in, so the next launch asks again.
 *
 * What breaks if changed carelessly: the effect's key is `need`. Asked for a browser already let in,
 * a slow read would flash the sign-up screens at a member mid-scroll.
 */

import { useEffect, useState } from 'react';

import { fetchSignUp, type SignUpStatus } from '../../shared/api/onboarding.ts';
import type { SignUp } from '../../shared/sign-in.ts';

export interface SignUpState {
  readonly signUp: SignUp;
  /** What the server said, once it said it. */
  readonly status: SignUpStatus | null;
  /** The sign-up screens finished: the gate opens. */
  readonly finish: (s: SignUpStatus) => void;
}

export function useSignUp(need: boolean): SignUpState {
  const [status, setStatus] = useState<SignUpStatus | null>(null);
  const [signUp, setSignUp] = useState<SignUp>('unknown');
  useEffect(() => {
    if (!need) {
      setSignUp('unknown');
      return;
    }
    let live = true;
    fetchSignUp().then(
      (s) => {
        if (!live) return;
        setStatus(s);
        setSignUp(s.done ? 'done' : 'needed');
      },
      () => live && setSignUp('unchecked'),
    );
    return () => {
      live = false;
    };
  }, [need]);
  return {
    signUp,
    status,
    finish: (s) => {
      setStatus(s);
      setSignUp('done');
    },
  };
}
