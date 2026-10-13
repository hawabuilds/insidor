/**
 * THE ONE BOTTOM SHEET every sheet in the app is drawn with: the post sheet and Choose coin, Create
 * coin, Feed settings. After Trador's `ui/Sheet.tsx` and its `SheetTitle`/`SheetFooter`, with the
 * owner's rules for closing and size on top.
 *
 * Why one component: the owner asked that every sheet close the same five ways (the 44px X at the
 * top right, a swipe down, a tap on the dimmed page above it, the phone's back, Escape), dim the
 * page, give the page back where it was, open to about 54px from the top, and keep its buttons
 * clear of the phone's home bar. Written once here, a sheet cannot forget one of them.
 *
 * A sheet is three parts, and only the middle one scrolls: `SheetHead` (the caller's content and
 * the X), `SheetBody`, and `SheetFoot`, fixed at the bottom with the safe area plus 16px under it.
 * A sheet too tall for the phone scrolls its body; nothing in the head or foot shrinks to fit.
 * Anything else the caller puts inside `Sheet` is drawn over the body, positioned against the
 * sheet, without moving it (Choose coin's quick buy panel). The parts are separate components, not
 * props, so a sheet with two views (the post and Choose coin) keeps one sheet and one history
 * entry while its views swap their own parts in.
 *
 * The Buy and Sell ticket (features/trade/OrderSheet.tsx) is not drawn with this and must stay so:
 * the owner keeps it exactly as it is.
 *
 * What breaks if changed carelessly: `data-sheet-scroll` on the body is how the swipe knows the
 * list is at its top; without it a swipe down inside a scrolled list would close the sheet.
 */

import { createContext, useContext, useRef, type ReactNode } from 'react';

import { useDismiss, useSwipeClose } from './dismiss.ts';
import { CloseIcon } from './icons.tsx';
import styles from './bottom-sheet.module.css';

const Closer = createContext<() => void>(() => undefined);

export function Sheet({ label, onClose, escape = true, fit = false, children }: {
  /** What a screen reader calls the sheet. */
  readonly label: string;
  readonly onClose: () => void;
  /** False while something drawn over this sheet (the Buy ticket) owns Escape. */
  readonly escape?: boolean;
  /** As tall as its content (up to the same top), rather than nearly the full screen. */
  readonly fit?: boolean;
  readonly children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(onClose, { escape });
  useSwipeClose(panel, onClose);
  return (
    <div className={styles['scrim']} onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div ref={panel} className={`${styles['panel']} ${fit ? styles['fit'] : ''}`} role="dialog" aria-modal="true" aria-label={label}>
        <Closer.Provider value={onClose}>{children}</Closer.Provider>
      </div>
    </div>
  );
}

/** The head: a plain title, or the caller's own row, and the X at the right. */
export function SheetHead({ title, children }: { readonly title?: string; readonly children?: ReactNode }) {
  const close = useContext(Closer);
  return (
    <div className={styles['head']} data-sheet-grab>
      <span className={styles['grip']} aria-hidden="true" />
      <div className={styles['headMain']}>{children ?? (title !== undefined ? <h2 className={styles['title']}>{title}</h2> : null)}</div>
      <button type="button" className={styles['close']} aria-label="Close" onClick={close}>
        <CloseIcon size={18} />
      </button>
    </div>
  );
}

/** The part that scrolls. `last` when no foot follows, so its end clears the home bar. */
export function SheetBody({ last = false, children }: { readonly last?: boolean; readonly children: ReactNode }) {
  return (
    <div className={`${styles['body']} ${last ? styles['bodyLast'] : ''}`} data-sheet-scroll>
      {children}
    </div>
  );
}

/** The fixed bottom: the sheet's main buttons, with the safe area plus 16px under them. */
export function SheetFoot({ children }: { readonly children: ReactNode }) {
  return <div className={styles['foot']}>{children}</div>;
}
