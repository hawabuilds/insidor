/**
 * THE TERMS AND THE PRIVACY POLICY, as the sign-up's legal line opens them — PLACEHOLDERS. Insidor
 * had no pages for either when sign-up was built (2026-10-22), so each opens over the door with a
 * plain note that the owner's text goes here. Drawn in the app rather than as a link out, because
 * the door is the one place a signed-out person can be, and a link out of a Home Screen app lands
 * in a browser they then have to find their way back from.
 *
 * What breaks if changed carelessly: the words. A placeholder must say it is one; pretending these
 * are terms would be a claim nobody wrote.
 */

import styles from './signup.module.css';

export type LegalPage = 'terms' | 'privacy';

const TITLE: Readonly<Record<LegalPage, string>> = { terms: 'Terms', privacy: 'Privacy Notice' };

export function Legal({ page, onClose }: { readonly page: LegalPage; readonly onClose: () => void }) {
  return (
    <div className={styles['legal']} role="dialog" aria-label={TITLE[page]}>
      <button type="button" className={styles['back']} onClick={onClose} aria-label="Back">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </button>
      <h2>{TITLE[page]}</h2>
      <p>This page is a placeholder. Insidor's {TITLE[page].toLowerCase()} will be published here before sign-up opens to everyone.</p>
      <p>Insidor shows posts and the coins made for them. Nothing in the app is financial advice. You must be 18 or older to use it.</p>
    </div>
  );
}
