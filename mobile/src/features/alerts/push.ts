/**
 * THIS PHONE'S PUSH: whether it can, asking for it, and handing the subscription to the alert
 * service. Trador's pushClient, with its iPhone rule: Safari delivers notifications only to an
 * app added to the Home Screen and opened from there.
 *
 * Permission is asked first, as the very first thing the tap does (iPhone refuses a prompt that
 * does not come straight from a tap), then the service worker, then the subscription with the
 * server's public key, then saving it on the server. Nothing here holds a secret: the
 * subscription is an address for the push service, sent to our server and nowhere else.
 *
 * ★ WHY NOTHING EVER ARRIVED (2026-10-14): the owner's phone never saved a device — the notify log
 * has no subscribe and no test from it — and the app could not say why: every failure became one
 * "Couldn't turn notifications on", and a phone whose browser held a subscription the server never
 * saved showed the switch ON with a test button that could only fail. So now:
 *
 *   1. each step that stops says WHICH step and the browser's own words, on screen and in the
 *      notify log (POST /push/report), so the next failure is a line to read, not a guess
 *   2. the switch is ON only when the server holds this phone's device, not when the browser alone
 *      has a subscription (`currentPush` asks both)
 *   3. every launch of the app re-saves this phone's subscription when permission is granted
 *      (`resavePush`), so a save that failed once heals itself the next time the app opens
 *   4. a subscription made with another key (an older server key) is dropped and made again: the
 *      push service would refuse every push sent to it
 *   5. the service worker is given a bounded wait, never an endless one
 */

import { notifyCall, registerDevice, unregisterDevice } from '../../shared/api/people.ts';
import { isIosSafari } from '../install/install.ts';

export type PushPlace = 'unsupported' | 'needs-home-screen' | 'ready';
export type Permission = 'granted' | 'denied' | 'default' | 'unsupported';
/** Where turning push on stopped, said to the person and logged by the alert service. */
export type PushStep = 'permission' | 'service-worker' | 'subscribe' | 'save';
export type EnableResult = { readonly kind: 'on' } | { readonly kind: 'denied' } | { readonly kind: 'failed'; readonly step: PushStep; readonly error: string };

const READY_MS = 10_000;

export function standalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

export function pushPlace(): PushPlace {
  const ios = isIosSafari(navigator.userAgent, 'ontouchend' in document);
  if (ios && !standalone()) return 'needs-home-screen';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return 'ready';
}

export function permission(): Permission {
  return 'Notification' in window ? (Notification.permission as Permission) : 'unsupported';
}

/** A short name for this phone and how Insidor is open on it, for the person's device list and the log. Never the full user agent. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Browser';
  return `${kind} ${standalone() ? 'home-screen app' : 'browser tab'}`;
}

const keyBytes = (base64url: string): Uint8Array => {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array): boolean => {
  if (a === null || a === undefined) return true; /* the browser does not say: trust it */
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
};

const words = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 200);

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/sw.js', { scope: '/' }));
  /* `ready` never settles when no worker can activate; a bounded wait says so instead of hanging. */
  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('the service worker did not start within 10 seconds')), READY_MS)),
  ]);
  return reg;
}

async function subscription(reg: ServiceWorkerRegistration, publicKey: string): Promise<PushSubscription> {
  const key = keyBytes(publicKey);
  const had = await reg.pushManager.getSubscription();
  if (had !== null && sameKey(had.options?.applicationServerKey, key)) return had;
  if (had !== null) await had.unsubscribe().catch(() => undefined);
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
}

async function save(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (json.endpoint === undefined || json.keys?.p256dh === undefined || json.keys.auth === undefined) throw new Error('the browser gave a subscription without its keys');
  await registerDevice({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth }, device: deviceLabel() });
}

/** Tell the alert service where turning push on stopped (it logs one line; nothing is stored). */
function report(step: PushStep, error: string): void {
  void notifyCall('POST', '/push/report', { step, error, permission: permission(), standalone: standalone(), device: deviceLabel() }).catch(() => undefined);
}

/**
 * This phone's state: `on` only when the browser has a subscription AND the server holds this
 * phone (`devices` from the settings), never the browser alone.
 */
export async function currentPush(serverDevices: number): Promise<'on' | 'off' | 'denied'> {
  if (pushPlace() !== 'ready') return 'off';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted' || serverDevices === 0) return 'off';
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
}

/** From the tap, and nothing awaited before it: the permission prompt must come straight from the tap on iPhone. */
export async function enablePush(publicKey: string): Promise<EnableResult> {
  let asked: NotificationPermission;
  try {
    asked = await Notification.requestPermission();
  } catch (e) {
    report('permission', words(e));
    return { kind: 'failed', step: 'permission', error: words(e) };
  }
  if (asked !== 'granted') {
    report('permission', `answered ${asked}`);
    return { kind: 'denied' };
  }
  let step: PushStep = 'service-worker';
  try {
    const reg = await registration();
    step = 'subscribe';
    const sub = await subscription(reg, publicKey);
    step = 'save';
    await save(sub);
    return { kind: 'on' };
  } catch (e) {
    report(step, words(e));
    return { kind: 'failed', step, error: words(e) };
  }
}

/**
 * On every launch, signed in: if this phone already allowed notifications, its subscription is made
 * sure of (the server's key) and saved again. No prompt — permission is already granted — so it
 * needs no tap. This is what heals a phone whose first save failed.
 */
export async function resavePush(publicKey: string | null): Promise<void> {
  if (publicKey === null || pushPlace() !== 'ready' || Notification.permission !== 'granted') return;
  let step: PushStep = 'service-worker';
  try {
    const reg = await registration();
    step = 'subscribe';
    const sub = await subscription(reg, publicKey);
    step = 'save';
    await save(sub);
  } catch (e) {
    report(step, `on launch: ${words(e)}`);
  }
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await unregisterDevice(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe();
  }
}

/**
 * Turning push on from a tap, as Feed settings' switch and the sign-in ask both do: the server's key
 * checked, then `enablePush` (permission first, straight from the tap), and the outcome in words.
 * `blocked` is true when the phone now refuses for good (only its own settings can undo that);
 * `line` names the step that stopped and the browser's own words.
 */
export type TurnOn = { readonly kind: 'on' } | { readonly kind: 'denied'; readonly blocked: boolean } | { readonly kind: 'failed'; readonly line: string };

export async function turnOnPush(publicKey: string | null): Promise<TurnOn> {
  if (publicKey === null) return { kind: 'failed', line: 'The server has no push key.' };
  const r = await enablePush(publicKey);
  if (r.kind === 'on') return r;
  if (r.kind === 'denied') return { kind: 'denied', blocked: permission() === 'denied' };
  return { kind: 'failed', line: `Stopped at ${STEP_WORDS[r.step]}: ${r.error}` };
}

/** How to undo a block, which only the phone's own settings can do: said the same in Feed settings and the sign-in ask. */
export function blockedHow(): string {
  return standalone() ? 'On iPhone: Settings, Notifications, Insidor, then Allow Notifications. Then come back here.' : 'Allow notifications for this site in your browser settings, then come back here.';
}

/** The step's name in the person's words. */
export const STEP_WORDS: Readonly<Record<PushStep, string>> = {
  permission: 'asking for permission',
  'service-worker': 'starting the app’s background worker',
  subscribe: 'getting an address from the phone’s push service',
  save: 'saving this phone on our server',
};
