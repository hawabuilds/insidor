/**
 * Delivery. Twenty lines of `fetch`, and it is deliberately NOT an adapter.
 *
 * Every other outbound call in this system goes through adapters/, and that is
 * the right rule for the pipeline. It is the wrong rule here: importing the
 * adapter package would give the watchdog the same module graph, the same
 * dependency versions and the same install as the processes it is watching, and
 * an observer that shares a failure mode with its subject is decoration. The
 * dependency rule says `watchdog → contracts, store` and nothing else; this is
 * what that costs, and it is the cheaper side of the trade.
 *
 * Delivery failures are logged, never thrown. A pager that takes the process
 * down when the pager is down is a second outage caused by the first.
 */

import type { AlertChannel } from './config.ts';
import { errorText, type Logger } from './log.ts';
import type { Alert } from './checks.ts';

export interface Notifier {
  fire(alerts: readonly Alert[]): Promise<void>;
  clear(keys: readonly string[]): Promise<void>;
}

const SEND_TIMEOUT_MS = 10_000;

function render(alert: Alert): string {
  const mark = alert.severity === 'page' ? '[PAGE]' : '[warn]';
  return `${mark} ${alert.title}\n${alert.detail}`;
}

export function createNotifier(channel: AlertChannel, log: Logger): Notifier {
  if (channel.kind === 'off') {
    return {
      fire: async (alerts) => {
        for (const a of alerts) log.warn('alert (delivery disabled)', { ...a });
      },
      clear: async (keys) => {
        if (keys.length > 0) log.info('recovered (delivery disabled)', { keys });
      },
    };
  }

  const endpoint = `https://api.telegram.org/bot${channel.botToken}/sendMessage`;

  const send = async (text: string): Promise<void> => {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: channel.chatId, text, disable_notification: false }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) log.error('alert delivery rejected', { status: res.status });
    } catch (e) {
      log.error('alert delivery failed', { err: errorText(e) });
    }
  };

  return {
    async fire(alerts) {
      for (const a of alerts) {
        // Logged as well as sent: if delivery is broken, the evidence that a
        // condition fired still exists somewhere we can read later.
        log.warn('alert', { ...a });
        await send(render(a));
      }
    },
    async clear(keys) {
      for (const key of keys) {
        log.info('recovered', { key });
        await send(`[clear] ${key}`);
      }
    },
  };
}
