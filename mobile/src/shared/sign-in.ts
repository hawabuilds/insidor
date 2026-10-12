/**
 * THE ONE GATE: whether this person sees the app, the front door, or a moment's hold while a
 * returning session comes back. Sign in once, at the door, and every screen is open; signed out,
 * every address shows the door — a shared link included, kept in the address bar, so signing in
 * lands where the link pointed. Trador's model.
 *
 * Pure, so every case runs under a test. App.tsx asks it once per render, after all its hooks.
 *
 *   1. ★ A RETURNING PERSON NEVER SEES THE DOOR FLASH. While the sign-in provider is still starting
 *      in a browser that was signed in before, the answer is `holding`, not `landing`.
 *   2. ★ A BUILD WITH NO SIGN-IN IS THE DEMO. With no app id there is nobody to sign in as, so the
 *      door's "Join now" walks in to the app, whose screens show only what the services hold —
 *      empty states where there is nothing, never sample data.
 *
 * What breaks if changed carelessly: `connecting` while the sign-in window is open must stay on
 * the door — the person is mid sign-in, and the door is where they will come back to.
 */

import type { WalletState } from '@insidor/contracts/ports/wallet.ts';

export type Gate = 'app' | 'landing' | 'holding';

export function gateFor(r: { readonly configured: boolean; readonly state: WalletState; readonly entered: boolean }): Gate {
  if (!r.configured) return r.entered ? 'app' : 'landing';
  if (r.state.kind === 'connected' || r.state.kind === 'wrong-network') return 'app';
  if (r.entered && (r.state.kind === 'unavailable' || r.state.kind === 'connecting')) return 'holding';
  return 'landing';
}

/** Read once, at build time: a build either carries sign-in or is the demo. */
export const SIGN_IN_CONFIGURED = ((import.meta.env?.['VITE_PRIVY_APP_ID'] as string | undefined) ?? '').trim() !== '';
