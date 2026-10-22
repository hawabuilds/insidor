/**
 * THE SIGN-UP SCREEN'S FRAME — the approved layout every sign-up screen shares: a 44px row with
 * Back, the progress line and Skip; the question and its line under it; the main button at the
 * bottom in the thumb zone with its one text link under it. The door (features/landing) and the
 * steps after sign-in (SignUpSteps.tsx) draw with it, so the eight screens cannot drift apart.
 *
 * What breaks if changed carelessly: purple. The main button and the progress line are the only
 * purple here (with the photo ring, PhotoStep.tsx); a link or the Back arrow in purple breaks the
 * owner's rule for the whole flow.
 */

import type { ReactNode } from 'react';

import styles from './signup.module.css';

export function Frame({ progress = null, onBack, onSkip, foot, className, children }: {
  /** 0 to 1, or null for no line. */
  readonly progress?: number | null;
  readonly onBack?: (() => void) | undefined;
  readonly onSkip?: (() => void) | undefined;
  readonly foot?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={`${styles['screen']} ${className ?? ''}`}>
      <div className={styles['nav']}>
        {onBack !== undefined ? (
          <button type="button" className={styles['back']} onClick={onBack} aria-label="Back">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
        ) : null}
        {progress !== null ? (
          <div className={styles['bar']} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        ) : null}
        {progress !== null || onSkip !== undefined ? (
          onSkip !== undefined ? (
            <button type="button" className={styles['skip']} onClick={onSkip}>
              Skip
            </button>
          ) : (
            <span className={styles['skip']} />
          )
        ) : null}
      </div>
      <div className={styles['body']}>{children}</div>
      {foot !== undefined ? <div className={styles['foot']}>{foot}</div> : null}
    </div>
  );
}

export function Question({ children }: { readonly children: ReactNode }) {
  return <h1 className={styles['q']}>{children}</h1>;
}

export function Line({ children }: { readonly children: ReactNode }) {
  return <p className={styles['s']}>{children}</p>;
}

export function Primary({ onClick, busy = false, children }: { readonly onClick: () => void; readonly busy?: boolean; readonly children: ReactNode }) {
  return (
    <button type="button" className={styles['primary']} onClick={onClick} aria-busy={busy}>
      {children}
    </button>
  );
}

export function Secondary({ onClick, children }: { readonly onClick: () => void; readonly children: ReactNode }) {
  return (
    <button type="button" className={styles['secondary']} onClick={onClick}>
      {children}
    </button>
  );
}

/** The text link under the main button. `strong` is white (More options, Choose a different one); plain is grey (Log in, Later). */
export function TextLink({ onClick, strong = false, children }: { readonly onClick?: () => void; readonly strong?: boolean; readonly children?: ReactNode }) {
  if (onClick === undefined) return <span className={styles['link']} />;
  return (
    <button type="button" className={`${styles['link']} ${strong ? styles['linkStrong'] : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

/** Insidor's mark at any size: an eye, seeing it first. */
export function Mark({ size = 40 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="var(--brand)" />
      <path d="M8 20c3.4-5.6 7.4-8.4 12-8.4s8.6 2.8 12 8.4c-3.4 5.6-7.4 8.4-12 8.4S11.4 25.6 8 20Z" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" />
      <circle cx="20" cy="20" r="4.2" fill="#fff" />
    </svg>
  );
}

export function CheckMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}
