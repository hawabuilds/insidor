/**
 * WHETHER TO OFFER "ADD INSIDOR TO YOUR HOME SCREEN", AND HOW.
 *
 * Ported from the install half of Trador's `lib/notifications/pushClient.ts`. The push half is
 * deliberately not here: there are no subscriptions, no permission prompts and no server code
 * until services/notify exists.
 *
 * Three ways it can go, and they need different words:
 *
 *   ios       iPhone or iPad Safari, in a tab. There is no install API; the only way is Share,
 *             then Add to Home Screen, so the guide says exactly that.
 *   prompt    a browser that fired `beforeinstallprompt` (Android Chrome and friends). One button
 *             opens the browser's own install dialog.
 *   none      already installed, or a browser that offers neither. Nothing is shown — a guide to
 *             steps that do not exist on this browser is noise.
 *
 * A "not now" is respected for thirty days, so dismissing feels honoured rather than deferred.
 * Split from the component so each condition is tested without a browser.
 */

const DISMISSED_KEY = 'insidor.mobile.install.dismissedAt';
const DISMISS_DAYS = 30;
const DAY_MS = 86_400_000;

export function isIosSafari(ua: string, touch: boolean): boolean {
  /* iPadOS reports a Mac user agent; a touch screen is what gives it away. */
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && touch);
  /* Every iOS browser is WebKit underneath; Chrome, Firefox and Edge there cannot add to the
     Home Screen the same way, so they get no guide. */
  return ios && /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export type InstallWay = 'ios' | 'prompt' | 'none';

export function installWay(input: {
  readonly standalone: boolean;
  readonly iosSafari: boolean;
  readonly canPrompt: boolean;
}): InstallWay {
  if (input.standalone) return 'none';
  if (input.iosSafari) return 'ios';
  return input.canPrompt ? 'prompt' : 'none';
}

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function dismissedRecently(store: KeyValue | null, now: number): boolean {
  try {
    const at = Number(store?.getItem(DISMISSED_KEY) ?? NaN);
    return Number.isFinite(at) && now - at < DISMISS_DAYS * DAY_MS;
  } catch {
    return false;
  }
}

export function markDismissed(store: KeyValue | null, now: number): void {
  try {
    store?.setItem(DISMISSED_KEY, String(now));
  } catch {
    /* Private mode: the dismissal lasts for this session only. */
  }
}
