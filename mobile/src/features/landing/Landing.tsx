/**
 * THE FRONT DOOR — Trador's landing page (`LoginScreen.tsx`), in Insidor's words.
 *
 * One claim, one line saying what the app holds, one thing to press. The wordmark sits on dark
 * with clear space above the headline; the headline is light, large and on two lines, with the
 * payoff in the accent colour. "Join now" opens the sign-in: Continue with X (X only, for now), and a
 * wallet is made on the way in.
 *
 * ★ NO NUMBERS ON THE DOOR. Trador took its counts off this page after they disagreed with the
 * live universe by forty times; a figure on the front door that is wrong is worse than none.
 *
 * In a build with no sign-in, "Join now" goes straight in and says why, as Trador's demo mode
 * does — never a button that opens nothing. While sign-in is starting or finishing, the door says
 * "Loading" where the button will be, as Trador's does, rather than offering one that cannot work
 * yet. The iOS app
 * is a label, not a disabled button.
 *
 * ★ INVITE ONLY (2026-10-21). The code box sits above Join now: a code typed there, or brought by an
 * invite link (insidor.app/i/<CODE>, features/invites/invite-code.ts), is kept on the phone and
 * brought to the server once the person has signed in, and the door says who it is from, with
 * their picture. A member signing in again needs no code. Signed in without access, the same door
 * asks for the code ("Enter") and offers "No code? Join the waitlist" — still no numbers: the proof
 * row the brief allowed was left off for the rule above.
 *
 * This is the only place anyone signs in (shared/sign-in.ts is the gate in front of the app).
 */

import { useState } from 'react';

import { useWallet } from '../../shared/wallet.tsx';
import { CodeBox, useCodeCheck } from '../invites/CodeBox.tsx';
import { cleanCode, keepCode, pendingCode } from '../invites/invite-code.ts';
import inv from '../invites/invites.module.css';
import { Modal } from '../../shared/ui/Modal.tsx';
import { XMark } from '../../shared/ui/icons.tsx';
import styles from './landing.module.css';

/** Signed in without access: what the door does with a code, the waitlist, and signing out. */
export interface InviteDoor {
  /** The access check could not be made: say so and offer a retry, never a no. */
  readonly unchecked: boolean;
  /** Why the code brought on the way in was refused. */
  readonly refusal: string | null;
  readonly bring: (code: string) => Promise<string | null>;
  readonly wait: () => Promise<string | null>;
  readonly retry: () => void;
  /** "@handle", or null. */
  readonly signedInAs: string | null;
  readonly signOut: () => void;
}

export function Landing({ configured, onEnter, invite = null }: { configured: boolean; onEnter: () => void; invite?: InviteDoor | null }) {
  const { wallet, state } = useWallet();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(() => pendingCode() ?? '');
  const [problem, setProblem] = useState<string | null>(invite?.refusal ?? null);
  const [busy, setBusy] = useState(false);
  const check = useCodeCheck(code);
  /* Sign-in starting, or finishing after the provider hands back: Trador's "Loading", no button. */
  const waiting = invite === null && configured && (wallet === null || state.kind === 'unavailable' || state.kind === 'connecting');
  const typed = (v: string) => {
    setCode(v);
    setProblem(null);
  };
  const enter = async () => {
    if (invite === null || busy) return;
    const clean = cleanCode(code);
    if (clean === null) {
      setProblem('Type your invite code first.');
      return;
    }
    setBusy(true);
    setProblem(await invite.bring(clean));
    setBusy(false);
  };
  const toWaitlist = async () => {
    if (invite === null || busy) return;
    setBusy(true);
    setProblem(await invite.wait());
    setBusy(false);
  };

  return (
    <div className={styles['page']}>
      <div className={styles['middle']}>
        <div className={styles['brand']}>
          <Mark />
          <span className={styles['wordmark']}>INSIDOR</span>
        </div>

        <h1 className={styles['claim']}>
          Catch the meme
          <br />
          <span className={styles['payoff']}>before the coin</span>
        </h1>

        <p className={styles['line']}>
          Viral posts, grouped into narratives,
          <br />
          with the coins they became.
        </p>

        <div className={styles['actions']}>
          {configured ? <CodeBox value={code} onChange={typed} check={check} problem={problem} /> : null}
          {invite !== null ? (
            <>
              {invite.unchecked ? <p className={styles['demo']}>We couldn't check your invite just now.</p> : null}
              {invite.unchecked ? (
                <button type="button" className={styles['join']} onClick={invite.retry}>
                  Try again
                </button>
              ) : (
                <button type="button" className={styles['join']} onClick={() => void enter()}>
                  {busy ? 'Checking' : 'Enter'} <Arrow />
                </button>
              )}
              <button type="button" className={inv['quiet']} onClick={() => void toWaitlist()}>
                No code? Join the waitlist
              </button>
              <p className={inv['signedAs']}>
                <span>Signed in{invite.signedInAs !== null ? ` as ${invite.signedInAs}` : ''}</span>
                <button type="button" className={inv['textButton']} onClick={invite.signOut}>Sign out</button>
              </p>
            </>
          ) : waiting ? <span className={styles['waiting']}>Loading</span> : (
            <button
              type="button"
              className={styles['join']}
              onClick={() => {
                if (!configured) return onEnter();
                /* The code goes with the sign-in: kept here, brought once signed in (features/invites/useAccess.ts). */
                const clean = cleanCode(code);
                if (clean !== null) keepCode(clean);
                setOpen(true);
              }}
            >
              Join now <Arrow />
            </button>
          )}
          {invite === null ? (
            <span className={styles['ios']} aria-label="iOS app coming soon">
              <Apple /> Coming soon
            </span>
          ) : null}
          {invite === null && configured && state.kind === 'refused' ? <p className={styles['demo']}>You closed sign-in. Join now to try again.</p> : null}
          {invite === null && configured && state.kind === 'failed' ? <p className={styles['demo']}>Sign-in didn't finish. Join now to try again.</p> : null}
          {!configured ? <p className={styles['demo']}>Sign-in isn't set up in this build: set VITE_PRIVY_APP_ID for real login.</p> : null}
        </div>
      </div>

      {open ? (
        <Modal title="Log in or create an account" onClose={() => setOpen(false)}>
          <button
            type="button"
            className={styles['x']}
            onClick={() => {
              setOpen(false);
              void wallet?.connect('x');
            }}
          >
            <XMark size={18} /> Continue with X
          </button>
          <p className={styles['small']}>A wallet is created for you on the way in. Nothing to install, nothing to pay.</p>
        </Modal>
      ) : null}
    </div>
  );
}

/** A returning person's session coming back: the mark, pulsing, and nothing to press. */
export function Holding() {
  return (
    <div className={styles['holding']} role="status" aria-label="Loading">
      <Mark />
    </div>
  );
}

/** Insidor's mark: an eye — seeing it first. */
export function Mark() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="var(--brand)" />
      <path d="M8 20c3.4-5.6 7.4-8.4 12-8.4s8.6 2.8 12 8.4c-3.4 5.6-7.4 8.4-12 8.4S11.4 25.6 8 20Z" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" />
      <circle cx="20" cy="20" r="4.2" fill="#fff" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Apple() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.37 12.6c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.83-.81-3-.79-1.55.02-2.97.9-3.77 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.78.74 2.99.72 1.24-.02 2.02-1.12 2.77-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.42-3.65l.04.02ZM14.1 5.85c.63-.77 1.06-1.83.94-2.89-.91.04-2.01.61-2.66 1.37-.58.67-1.09 1.75-.95 2.79 1.01.08 2.04-.51 2.67-1.27Z" />
    </svg>
  );
}
