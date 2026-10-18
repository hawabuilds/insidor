/**
 * WHETHER THE SCREEN DRAWING THIS IS THE ONE ON SCREEN. The bottom tabs stay mounted when left
 * (App.tsx), hidden, so coming back is instant and lands where the person was; this says which one
 * is showing, so a hidden tab asks the network for nothing — no polling, no live line — exactly as
 * a hidden browser tab asks nothing (features/feed/useLiveFeed.ts).
 *
 * True outside any provider: a screen that is not a kept tab (a story, a coin page, a sheet) is on
 * screen whenever it is drawn. What breaks if changed carelessly: a poll that ignores this keeps
 * reading for a tab nobody is looking at, for as long as the app is open.
 */

import { createContext, useContext } from 'react';

export const ScreenActive = createContext(true);

export function useScreenActive(): boolean {
  return useContext(ScreenActive);
}
