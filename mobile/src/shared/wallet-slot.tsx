/**
 * WHERE THE KEY IMPORT BOX IS DRAWN, WHILE ITS CODE LIVES WITH THE WALLET VENDOR'S. The vendor's
 * code is loaded after the first paint (main.tsx, wallet-vendor.tsx) and its provider is drawn
 * BESIDE the app, not around it, so its arrival never redraws the app from scratch. The one screen
 * that needs the vendor's own hooks, Import (features/portfolio/ImportScreen.tsx), marks a place
 * here with <KeyImportSlot>; the vendor's side draws the box into that place through a portal,
 * inside its provider. The box's props cross by reference and nothing else does: the key itself
 * still goes from the field to the vendor and nowhere else (wallet-embedded KeyImport.tsx).
 *
 * Until the vendor's code has arrived the slot is empty, which is only ever seen for a moment on a
 * screen that already needs a signed-in wallet. What breaks if changed carelessly: drawing the
 * vendor's provider around the app again would rebuild every open tab when it loads.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export interface KeyImportProps {
  readonly onDone: (outcome: 'imported' | 'cancelled' | 'failed') => void;
  readonly classes?: { readonly field?: string | undefined; readonly primary?: string | undefined; readonly secondary?: string | undefined; readonly row?: string | undefined };
}

export interface Slot {
  readonly node: HTMLElement;
  readonly props: KeyImportProps;
}

let slot: Slot | null = null;
const listeners = new Set<() => void>();
const set = (s: Slot | null) => {
  slot = s;
  for (const l of [...listeners]) l();
};

/** The vendor's side reads the place to draw into. */
export function useKeyImportSlot(): Slot | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => slot,
  );
}

/** Marks where the key import box goes; the vendor's side fills it. */
export function KeyImportSlot(props: KeyImportProps) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  /* ★ THE SLOT IS SET ONCE PER PLACE, NOT ONCE PER RENDER. The screen passes a fresh onDone and
     classes on every render; publishing them each time made the vendor side redraw the box, which
     re-rendered the screen, which published again: React gave up with "maximum update depth"
     (error #185) the moment "I understand" opened the box (the owner, 2026-10-24). The latest props
     are read through a ref instead, so the box is drawn once and still calls the current onDone. */
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    if (node === null) return;
    const classes = latest.current.classes;
    set({ node, props: { onDone: (outcome) => latest.current.onDone(outcome), ...(classes === undefined ? {} : { classes }) } });
    return () => set(null);
  }, [node]);
  return <div ref={setNode} style={{ display: 'contents' }} />;
}
