/**
 * COPY, AND SAY SO WHERE IT WAS TAPPED (the owner, 2026-10-25: "some indication when i copy a ca in
 * the token chart from where i am copying"). The address chip turns green and its copy icon a tick
 * for `COPIED_MS`, with a 10 ms buzz where the phone has one; the old "Address copied" toast showed
 * far from the finger and was easy to miss. A refused copy still says so in a toast (the caller's).
 *
 * Its own file so the token's header and its Info tab show it the same way, and a second tap within
 * the window restarts it rather than stacking timers.
 *
 * What breaks if changed carelessly: the timer must be cleared on unmount, or a quick back-swipe
 * after copying sets state on a gone component.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the chip says "copied". */
export const COPIED_MS = 1_500;

/** `copied` while the tick shows; `copy` writes the text and resolves false when the phone refused. */
export function useCopied(): { readonly copied: boolean; readonly copy: (text: string) => Promise<boolean> } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  const copy = useCallback(async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return false;
    }
    try {
      navigator.vibrate?.(10);
    } catch {
      /* No buzz on this phone: the tick says it. */
    }
    setCopied(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    return true;
  }, []);
  return { copied, copy };
}
