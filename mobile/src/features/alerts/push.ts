/**
 * THIS PHONE'S PUSH: whether it can, asking for it, and handing the subscription to the alert
 * service. Trador's pushClient, with its iPhone rule: Safari delivers notifications only to an
 * app added to the Home Screen and opened from there.
 *
 * Permission is asked first (iPhone requires it to come from the tap), then the service worker,
 * then the subscription with the server's public key. Nothing here holds a secret: the
 * subscription is an address for the push service, sent to our server and nowhere else.
 */

import { registerDevice, unregisterDevice } from '../../shared/api/people.ts';
import { isIosSafari } from '../install/install.ts';

export type PushPlace = 'unsupported' | 'needs-home-screen' | 'ready';

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

const keyBytes = (base64url: string): Uint8Array => {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function currentPush(): Promise<'on' | 'off' | 'denied'> {
  if (pushPlace() !== 'ready') return 'off';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
}

export async function enablePush(publicKey: string): Promise<'on' | 'denied' | 'failed'> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  try {
    const reg = await registration();
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (json.endpoint === undefined || json.keys?.p256dh === undefined || json.keys.auth === undefined) return 'failed';
    await registerDevice({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
    return 'on';
  } catch {
    return 'failed';
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
