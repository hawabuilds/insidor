/**
 * THE FRONT DOOR — Trador's landing page (`LoginScreen.tsx`), in Insidor's words.
 *
 * One claim, one line saying what the app holds, one thing to press. The wordmark sits on dark
 * with clear space above the headline; the headline is light, large and on two lines, with the
 * payoff in the accent colour. "Join now" opens the sign-in: Continue with X or with Google, and a
 * wallet is made on the way in.
 *
 * ★ NO NUMBERS ON THE DOOR. Trador took its counts off this page after they disagreed with the
 * live universe by forty times; a figure on the front door that is wrong is worse than none.
 *
 * In a build with no sign-in, "Join now" goes straight in and says why, as Trador's demo mode
 * does — never a button that opens nothing. The iOS app is a label, not a disabled button.
 */

import { useState } from 'react';

import { useWallet } from '../../shared/wallet.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import { XMark } from '../../shared/ui/icons.tsx';
import styles from './landing.module.css';

export function Landing({ onEnter }: { onEnter: () => void }) {
  const { wallet, state } = useWallet();
  const [open, setOpen] = useState(false);
  const canSignIn = wallet !== null && state.kind !== 'unavailable';

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
          <button type="button" className={styles['join']} onClick={() => (canSignIn ? setOpen(true) : onEnter())}>
            Join now <Arrow />
          </button>
          <span className={styles['ios']} aria-label="iOS app coming soon">
            <Apple /> Coming soon
          </span>
          {!canSignIn ? <p className={styles['demo']}>Sign-in isn't set up in this build: set VITE_PRIVY_APP_ID for real login.</p> : null}
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
          <button
            type="button"
            className={styles['google']}
            onClick={() => {
              setOpen(false);
              void wallet?.connect('google');
            }}
          >
            <Google /> Continue with Google
          </button>
          <p className={styles['small']}>A wallet is created for you on the way in. Nothing to install, nothing to pay.</p>
        </Modal>
      ) : null}
    </div>
  );
}

/** Insidor's mark: an eye — seeing it first. */
function Mark() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="var(--brand)" />
      <path d="M8 20c3.4-5.6 7.4-8.4 12-8.4s8.6 2.8 12 8.4c-3.4 5.6-7.4 8.4-12 8.4S11.4 25.6 8 20Z" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" />
      <circle cx="20" cy="20" r="4.2" fill="#fff" />
    </svg>
  );
}

function Google() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.6 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12s4.2 9.5 9.4 9.5c5.4 0 9-3.8 9-9.2 0-.6-.1-1.1-.2-1.6H12Z" />
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
