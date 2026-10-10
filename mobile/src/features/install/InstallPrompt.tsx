/**
 * "ADD INSIDOR TO YOUR HOME SCREEN" — the install half of Trador's `PushPrompt.tsx`.
 *
 * A bar above the tab bar, on the feed only, with one tap to act and one to dismiss for thirty
 * days. On iPhone Safari it is a guide (Share, then Add to Home Screen), because Safari has no
 * install API. Where the browser fired `beforeinstallprompt` it is a button that opens the
 * browser's own dialog. Already installed, or neither available: nothing.
 *
 * Nothing about notifications is asked here, and nothing is asked on load before the page has
 * rendered its first screen. Push comes later, as services/notify.
 */

import { useEffect, useState } from 'react';
import { Button } from '../../shared/ui/Button.tsx';
import { CloseIcon, PlusIcon, ShareIcon } from '../../shared/ui/icons.tsx';
import { dismissedRecently, installWay, isIosSafari, markDismissed, type InstallWay } from './install.ts';
import styles from './install.module.css';

/** The event Chromium fires when it would let the page offer an install. Not in the DOM types. */
interface InstallEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function standalone(): boolean {
  const media = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  /* iOS never implemented the media query for home-screen apps; it sets this flag instead. */
  const ios = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return media || ios;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [way, setWay] = useState<InstallWay>('none');
  const [hidden, setHidden] = useState(() => dismissedRecently(storage(), Date.now()));

  useEffect(() => {
    const decide = (canPrompt: boolean) =>
      setWay(installWay({ standalone: standalone(), iosSafari: isIosSafari(navigator.userAgent, 'ontouchend' in document), canPrompt }));
    decide(false);
    const onPrompt = (e: Event) => {
      /* Hold the browser's own mini-bar back so the offer appears once, here, in our words. */
      e.preventDefault();
      setDeferred(e as InstallEvent);
      decide(true);
    };
    const onInstalled = () => setWay('none');
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (hidden || way === 'none') return null;

  const dismiss = () => {
    markDismissed(storage(), Date.now());
    setHidden(true);
  };

  return (
    <aside className={styles['bar']} aria-label="Add Insidor to your Home Screen">
      <img className={styles['icon']} src="/icons/icon-192.png" alt="" width={40} height={40} />
      <div className={styles['text']}>
        <b>Add Insidor to your Home Screen</b>
        {way === 'ios' ? (
          <span>
            Tap <ShareIcon size={14} className={styles['inline']} /> Share, then <PlusIcon size={14} className={styles['inline']} /> Add to Home Screen.
          </span>
        ) : (
          <span>Opens full screen, like an app.</span>
        )}
      </div>
      {way === 'prompt' && deferred !== null ? (
        <Button
          look="primary"
          onClick={() => {
            void deferred.prompt();
            void deferred.userChoice.then(() => setDeferred(null));
          }}
        >
          Install
        </Button>
      ) : null}
      <button type="button" className={styles['close']} aria-label="Not now" onClick={dismiss}>
        <CloseIcon size={15} />
      </button>
    </aside>
  );
}
