/**
 * THE ONE GATE: whether this person sees the app, the front door, or a moment's hold while a
 * returning session comes back. Sign in once, at the door, and every screen is open; signed out,
 * every address shows the door — a shared link included, kept in the address bar, so signing in
 * lands where the link pointed. Trador's model.
 *
 * Pure, so every case runs under a test. App.tsx asks it once per render, after all its hooks.
 *
 *   1. ★ A RETURNING PERSON NEVER SEES THE DOOR FLASH, AND NEVER WAITS FOR THE SIGN-IN CODE. While
 *      the sign-in provider is still loading or starting in a browser that was signed in before,
 *      the answer is `app` (the owner, 2026-10-18: For You's first paint must not wait on the
 *      wallet code, which main.tsx now loads after it). The screens are the public ones, read
 *      without a sign-in; anything that needs the wallet sees it `unavailable` or `connecting`
 *      for that moment, as it would mid-restore. If the session turns out to be gone, the state
 *      becomes `disconnected` and the door shows (App.tsx forgets the browser): the one cost is
 *      a second or two of For You before the door for someone whose session expired.
 *   2. ★ A BUILD WITH NO SIGN-IN IS THE DEMO. With no app id there is nobody to sign in as, so the
 *      door's "Join now" walks in to the app, whose screens show only what the services hold —
 *      empty states where there is nothing, never sample data.
 *
 *   3. ★ SIGNED IN IS NOT LET IN (invite-only, 2026-10-21). A first sign-in waits a moment
 *      (`holding`) while the social service says whether this person has access; with it, the app;
 *      without it, the door with the code box (`invite`) or their place on the waitlist
 *      (`waitlist`); when the service could not be asked, the door says so and offers a retry
 *      (`unchecked`), never a no. A browser that was let in before (`entered`) goes straight in,
 *      as in rule 1: access is never taken back, and everyone signed in before invites kept it.
 *
 * What breaks if changed carelessly: `connecting` while the sign-in window is open must stay on
 * the door — the person is mid sign-in, and the door is where they will come back to.
 */

import type { WalletState } from '@insidor/contracts/ports/wallet.ts';

export type Gate = 'app' | 'landing' | 'holding' | 'invite' | 'waitlist' | 'unchecked';

/** What the social service said about this sign-in: not asked yet, in, out, out and waiting, or could not be asked. */
export type Access = 'unknown' | 'in' | 'out' | 'waiting' | 'unchecked';

const BY_ACCESS: Readonly<Record<Access, Gate>> = { unknown: 'holding', in: 'app', out: 'invite', waiting: 'waitlist', unchecked: 'unchecked' };

export function gateFor(r: { readonly configured: boolean; readonly state: WalletState; readonly entered: boolean; readonly access?: Access }): Gate {
  if (!r.configured) return r.entered ? 'app' : 'landing';
  if (r.state.kind === 'connected' || r.state.kind === 'wrong-network') return r.entered ? 'app' : BY_ACCESS[r.access ?? 'unknown'];
  if (r.entered && (r.state.kind === 'unavailable' || r.state.kind === 'connecting')) return 'app';
  return 'landing';
}

/** Read once, at build time: a build either carries sign-in or is the demo. */
export const SIGN_IN_CONFIGURED = ((import.meta.env?.['VITE_PRIVY_APP_ID'] as string | undefined) ?? '').trim() !== '';
