/**
 * WHETHER THE SCREEN DRAWING THIS IS THE ONE ON SCREEN. The bottom tabs stay mounted when left
 * (App.tsx), hidden, so coming back is instant and lands where the person was; this says which one
 * is showing, so a hidden tab asks the network for nothing — no polling, no live line — exactly as
 * a hidden browser tab asks nothing (features/feed/useLiveFeed.ts).
 *
 * The pages behind the one on screen are kept drawn too, hidden, so Back finds them as they were
 * (App.tsx, shared/kept-pages.ts); they are told the same way. True outside any provider. What breaks if changed carelessly: a poll that ignores this keeps
 * reading for a tab nobody is looking at, for as long as the app is open.
 */

import { createContext, useContext } from 'react';

export const ScreenActive = createContext(true);

export function useScreenActive(): boolean {
  return useContext(ScreenActive);
}

/**
 * The history entry this screen is on screen at (shared/nav.ts), or null while it is hidden. A
 * kept bottom tab is one screen across many entries; a sheet opened over it at one entry is closed
 * when the tab shows at another (shared/ui/dismiss.ts), so a tab-bar tap never finds an old sheet
 * up. Null outside any provider: such a screen claims no entry, and nothing is closed for it.
 */
export const ShownEntry = createContext<string | null>(null);

export function useShownEntry(): string | null {
  return useContext(ShownEntry);
}
