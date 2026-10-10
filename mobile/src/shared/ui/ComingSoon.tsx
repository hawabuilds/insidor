/**
 * "Coming soon", said the same way everywhere a control has nothing behind it yet.
 *
 * ★ BUY, SELL AND CREATE ROUTE HERE AND NOWHERE ELSE. Tapping one shows this toast and does
 * nothing: no transaction, no address, no success message. `submitTrade` is never called.
 * Keeping every such control on one hook means there is exactly one place to look to prove
 * that, and exactly one place that changes when trading is real.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './ui.module.css';

const SHOW_FOR_MS = 1_800;

type Toast = { readonly headline: string; readonly detail: string };

const Ctx = createContext<(t: Toast) => void>(() => undefined);

export function ComingSoonProvider({ children }: { children: ReactNode }) {
  const [what, setWhat] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((t: Toast) => {
    if (timer.current !== null) clearTimeout(timer.current);
    setWhat(t);
    timer.current = setTimeout(() => setWhat(null), SHOW_FOR_MS);
  }, []);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {what !== null ? (
        <div className={styles['toast']} role="status" aria-live="polite">
          <b>{what.headline}</b>
          <span>{what.detail}</span>
        </div>
      ) : null}
    </Ctx.Provider>
  );
}

/** `soon('Buying')` shows the toast. Returns nothing and starts nothing. */
export function useComingSoon(): (what: string) => void {
  const show = useContext(Ctx);
  return useCallback((what: string) => show({ headline: 'Coming soon', detail: what }), [show]);
}

/** The same toast for something that did happen — "Link copied". Never for a trade. */
export function useToast(): (headline: string, detail?: string) => void {
  const show = useContext(Ctx);
  return useCallback((headline: string, detail = '') => show({ headline, detail }), [show]);
}
