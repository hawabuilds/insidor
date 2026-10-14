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
 * ★ PICTURES ARE LINKS, AND ONLY HTTPS ONES. `image` (the post's picture or video frame) and `icon`
 * (the poster's face or the coin's logo) travel as https addresses; the device fetches them when it
 * draws the notification. Anything else is dropped, never sent. `tag` makes a repeat replace the
 * first on the device instead of stacking a second copy.
 *
 * ★ EVERY REFUSAL IS TOLD. The push service's status (and only the status and its host) goes to
 * `report`, so the service log says why a device did not take a push — 403 from a key mismatch,
 * 400 from a bad payload — instead of a bare "failed". Never the endpoint path: it is the device's
 * address.
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

/**
 * What the push service said: the status (0 when it never answered), its host and its short reason.
 * `endpoint` is there for the caller to file the answer under its device row; a log line takes the
 * host, never the endpoint.
 */
export type PushReport = (r: { readonly ok: boolean; readonly status: number; readonly host: string; readonly reason: string; readonly endpoint: string }) => void;

const https = (v: string | null | undefined): string | null => (typeof v === 'string' && /^https:\/\/\S+$/.test(v) && v.length <= 2_000 ? v : null);
const hostOf = (endpoint: string): string => {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'unknown';
  }
};

export function webPushSender(cfg: VapidConfig, send: Send = webpush.sendNotification.bind(webpush), report: PushReport = () => undefined): PushSender {
  const configured = cfg.publicKey !== null && cfg.privateKey !== null;
  return {
    configured,
    publicKey: configured ? cfg.publicKey : null,
    async send(target, message, ttlS) {
      if (!configured) return 'failed';
      try {
        const image = https(message.image);
        const icon = https(message.icon);
        const payload = {
          title: message.title,
          body: message.body,
          url: message.url.startsWith('/') ? message.url : '/',
          ...(image === null ? {} : { image }),
          ...(icon === null ? {} : { icon }),
          ...(typeof message.tag === 'string' && message.tag !== '' ? { tag: message.tag.slice(0, 200) } : {}),
        };
        const r = await send(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(payload),
          { TTL: ttlS, urgency: 'high', vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey ?? '', privateKey: cfg.privateKey ?? '' } },
        );
        report({ ok: true, status: typeof (r as { statusCode?: unknown } | undefined)?.statusCode === 'number' ? (r as { statusCode: number }).statusCode : 201, host: hostOf(target.endpoint), reason: '', endpoint: target.endpoint });
        return 'sent';
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        const body = (e as { body?: unknown }).body;
        /* The push service's own short reason (Apple: {"reason":"BadJwtToken"}), never more than a line. */
        const reason = typeof body === 'string' ? body.replace(/\s+/g, ' ').slice(0, 120) : e instanceof Error ? e.message.slice(0, 120) : '';
        report({ ok: false, status: typeof status === 'number' ? status : 0, host: hostOf(target.endpoint), reason, endpoint: target.endpoint });
        return status === 404 || status === 410 ? 'gone' : 'failed';
      }
    },
  };
}
