/**
 * THE NOTIFICATIONS ASK AFTER SIGN-IN — Trador's PushPrompt, as the pop-up the owner asked for
 * (2026-10-14: "a pop up when you first sign in asking you to allow push notifications like
 * trador"). Whether it shows, and which one, is push-ask.ts; this only draws it.
 *
 *   allow         what is sent and where to change it, Allow and Not now. Allow is the same turn-on
 *                 as Feed settings' switch (push.ts `turnOnPush`): the permission prompt comes
 *                 straight from the tap, as iPhone requires, then the phone is saved on our server
 *   home-screen   iPhone Safari in a tab, where no push can arrive: the Add to Home Screen steps
 *   blocked       Allow was answered Don't Allow: how to undo it in the phone's Settings, since
 *                 the app can never ask again
 *
 * Not now, the X, a swipe down, a tap outside and back all mean Not now: thirty days on this
 * device. It is drawn with the shared sheet (shared/ui/Sheet.tsx), so it looks and closes like the
 * app's other pop-ups.
 *
 * What breaks if changed carelessly: anything awaited in `allow` before `turnOnPush` puts the
 * permission prompt outside the tap, and iPhone then shows no prompt at all.
 */

import { useEffect, useState } from 'react';

import { fetchAlertSettings } from '../../shared/api/people.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { Sheet, SheetBody, SheetFoot, SheetHead } from '../../shared/ui/Sheet.tsx';
import { markDismissed as markInstallDismissed } from '../install/install.ts';
import { declinedAt, markDeclined, pushAsk } from './push-ask.ts';
import { blockedHow, permission, pushPlace, turnOnPush } from './push.ts';
import styles from './alerts.module.css';

export type PushAskState = 'allow' | 'home-screen' | 'blocked';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Mounted once in the shell: reads this phone and the alert service after sign-in, and asks if push-ask.ts says so. */
export function PushAsk({ signedIn }: { signedIn: boolean }) {
  const [shown, setShown] = useState<{ state: PushAskState; publicKey: string | null } | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    fetchAlertSettings().then(
      (s) => {
        const kind = pushAsk({ signedIn, place: pushPlace(), permission: permission(), serverPush: s.push.on && s.push.configured, declinedAt: declinedAt(storage()), now: Date.now() });
        if (live && kind !== 'none') setShown({ state: kind, publicKey: s.push.publicKey });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [signedIn]);
  if (shown === null) return null;
  return <PushAskView initial={shown.state} publicKey={shown.publicKey} onDone={() => setShown(null)} />;
}

/** The pop-up itself, by its state; exported so it can be drawn without a sign-in. */
export function PushAskView({ initial, publicKey, onDone }: { initial: PushAskState; publicKey: string | null; onDone: () => void }) {
  const toast = useToast();
  const [state, setState] = useState<PushAskState>(initial);
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState<string | null>(null);

  const notNow = () => {
    const now = Date.now();
    markDeclined(storage(), now);
    /* The Home Screen bar on For You says the same thing; one Not now answers both. */
    if (state === 'home-screen') markInstallDismissed(storage(), now);
    onDone();
  };
  const close = state === 'blocked' ? onDone : notNow;

  /* ★ Straight from the tap: nothing is awaited before turnOnPush asks the phone. */
  const allow = async () => {
    if (busy) return;
    setBusy(true);
    const r = await turnOnPush(publicKey);
    setBusy(false);
    if (r.kind === 'on') {
      toast('Notifications are on', 'Change any kind in Feed settings.');
      onDone();
      return;
    }
    if (r.kind === 'denied') {
      if (r.blocked) setState('blocked');
      else notNow();
      return;
    }
    setStopped(r.line);
  };

  const title = state === 'home-screen' ? 'Add Insidor to your Home Screen first' : state === 'blocked' ? 'Notifications are blocked' : 'Turn on notifications';
  return (
    <Sheet label={title} onClose={close} fit>
      <SheetHead title={title} />
      <SheetBody>
        {state === 'allow' ? (
          <>
            <p className={styles['askText']}>New posts on For You, coins launched or found for them, and coins for posts you watch, sent to this phone as they happen.</p>
            <p className={styles['sheetNote']}>Each kind has its own switch in Feed settings.</p>
            {stopped !== null ? <p className={styles['sheetNote']}>{stopped}</p> : null}
          </>
        ) : null}
        {state === 'home-screen' ? (
          <div className={styles['guide']}>
            <ol>
              <li>Tap the Share button in Safari.</li>
              <li>Choose Add to Home Screen, then Add.</li>
              <li>Open Insidor from your Home Screen and sign in there.</li>
            </ol>
            <span>On iPhone, Safari only delivers notifications to apps on the Home Screen.</span>
          </div>
        ) : null}
        {state === 'blocked' ? <p className={styles['askText']}>{blockedHow()}</p> : null}
      </SheetBody>
      <SheetFoot>
        <div className={styles['askButtons']}>
          {state === 'allow' ? (
            <Button look="primary" size="large" aria-busy={busy} onClick={() => void allow()}>
              {busy ? 'Asking your phone' : 'Allow'}
            </Button>
          ) : null}
          <Button look="quiet" size="large" onClick={close}>
            {state === 'blocked' ? 'Close' : 'Not now'}
          </Button>
        </div>
      </SheetFoot>
    </Sheet>
  );
}
