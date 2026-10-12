/**
 * A PUSH TO A PHONE — the web-push protocol, through the `web-push` library Trador uses: the
 * message encrypted for the device's keys and signed with our VAPID key, sent to the browser
 * vendor's push service at the device's endpoint.
 *
 * ★ UNCONFIGURED IS A STATE, NOT AN ERROR. Without both VAPID keys nothing is sent and the
 * sender says so (`configured: false`); the alert still lands in the person's list. A push that
 * cannot go is never a reason to lose the alert.
 *
 * ★ A GONE DEVICE IS DROPPED. 404 and 410 from the push service mean the device unsubscribed or
 * expired; the caller deletes it, as Trador does, rather than sending to it forever.
 *
 * What breaks if changed carelessly: the private key. It is read once, from the environment, and
 * handed to the library. It is never logged, never put in an error, never returned.
 */

import webpush from 'web-push';

import type { PushSender } from '@insidor/contracts/ports/people.ts';

export interface VapidConfig {
  readonly publicKey: string | null;
  readonly privateKey: string | null;
  /** A mailto: or https: contact the push services may use. */
  readonly subject: string;
}

type Send = typeof webpush.sendNotification;

export function webPushSender(cfg: VapidConfig, send: Send = webpush.sendNotification.bind(webpush)): PushSender {
  const configured = cfg.publicKey !== null && cfg.privateKey !== null;
  return {
    configured,
    publicKey: configured ? cfg.publicKey : null,
    async send(target, message, ttlS) {
      if (!configured) return 'failed';
      try {
        await send(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify({ title: message.title, body: message.body, url: message.url.startsWith('/') ? message.url : '/' }),
          { TTL: ttlS, urgency: 'high', vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey ?? '', privateKey: cfg.privateKey ?? '' } },
        );
        return 'sent';
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        return status === 404 || status === 410 ? 'gone' : 'failed';
      }
    },
  };
}
