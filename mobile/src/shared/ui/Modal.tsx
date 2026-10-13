/**
 * A centred pop-up over the dimmed, blurred page, after Trador's `ui/Modal.tsx`.
 *
 * It closes the same ways a sheet does (dismiss.ts): the 44px X at the top right, a tap on the
 * dimmed page, a swipe down, the phone's back, and Escape; the page behind is held still and given
 * back where it was. Focus moves into it when it opens so a keyboard or screen-reader user lands
 * inside rather than behind it. Taller than the screen, it scrolls inside itself.
 *
 * What breaks if changed carelessly: every pop-up that is not a sheet is drawn with this (sign in,
 * Send, Receive, the coin lists on the feed), so a change here changes all of them at once.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { useDismiss, useSwipeClose } from './dismiss.ts';
import { CloseIcon } from './icons.tsx';
import styles from './ui.module.css';

export function Modal({ title, subtitle, onClose, children }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useDismiss(onClose);
  useSwipeClose(box, onClose);
  useEffect(() => {
    box.current?.focus();
  }, []);

  return (
    <div className={styles['scrim']} onClick={onClose}>
      <div
        ref={box}
        className={styles['modal']}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-sheet-scroll
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className={styles['modalClose']} onClick={onClose} aria-label="Close">
          <CloseIcon size={18} />
        </button>
        <h2 className={styles['modalTitle']}>{title}</h2>
        {subtitle !== undefined ? <p className={styles['modalSub']}>{subtitle}</p> : null}
        {children}
      </div>
    </div>
  );
}
