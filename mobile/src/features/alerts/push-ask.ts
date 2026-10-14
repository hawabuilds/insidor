/**
 * WHETHER TO ASK FOR NOTIFICATIONS AFTER SIGN-IN, AND WHICH ASK — the decision behind PushAsk.tsx.
 *
 * The owner asked for Trador's pop-up when you sign in (2026-10-14). Trador's rules, kept:
 *
 *   - only someone signed in is asked, and only where a subscription can really be made
 *   - "Not now" is honoured for thirty days on this device, then it may ask again
 *   - a phone that already answered is never asked: allowed means the launch re-save covers it
 *     (push.ts `resavePush`), blocked can only be undone in the phone's own Settings
 *   - on iPhone Safari in a tab push is impossible, so the ask is the Add to Home Screen guide,
 *     not a permission prompt that resolves to nothing
 *
 * One addition: a server that sends no pushes (push off, or no keys) is not asked about at all.
 *
 * Split from the component so every condition is tested without a browser. What breaks if changed
 * carelessly: asking when permission is not `default` spends the phone's one prompt on nothing
 * (iPhone shows no prompt again once it was answered), and losing the thirty days nags on every
 * launch.
 */

import type { Permission, PushPlace } from './push.ts';

export type PushAskKind = 'none' | 'allow' | 'home-screen';

const DECLINED_KEY = 'insidor.mobile.push.declinedAt';
const DECLINE_DAYS = 30;
const DAY_MS = 86_400_000;

export function pushAsk(input: {
  readonly signedIn: boolean;
  readonly place: PushPlace;
  readonly permission: Permission;
  /** The alert service has push on and its keys set. */
  readonly serverPush: boolean;
  /** When "Not now" was last tapped on this device, or null. */
  readonly declinedAt: number | null;
  readonly now: number;
}): PushAskKind {
  if (!input.signedIn || !input.serverPush) return 'none';
  if (input.declinedAt !== null && input.now - input.declinedAt < DECLINE_DAYS * DAY_MS) return 'none';
  if (input.place === 'unsupported') return 'none';
  if (input.place === 'needs-home-screen') return 'home-screen';
  return input.permission === 'default' ? 'allow' : 'none';
}

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The last "Not now" on this device; a broken or blocked store reads as never, so it can still ask. */
export function declinedAt(store: KeyValue | null): number | null {
  try {
    const at = Number(store?.getItem(DECLINED_KEY) ?? NaN);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

export function markDeclined(store: KeyValue | null, now: number): void {
  try {
    store?.setItem(DECLINED_KEY, String(now));
  } catch {
    /* Private mode: the "Not now" lasts for this session only. */
  }
}
