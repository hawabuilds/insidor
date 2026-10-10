/**
 * A centred modal over a blurred scrim, after Trador's `ui/Modal.tsx`.
 *
 * Escape and a tap on the scrim both close it; focus moves into it when it opens so a
 * keyboard or screen-reader user lands inside rather than behind it.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons.tsx';
import styles from './ui.module.css';

export function Modal({ title, subtitle, onClose, children }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles['scrim']} onClick={onClose}>
      <div
        ref={box}
        className={styles['modal']}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className={styles['modalClose']} onClick={onClose} aria-label="Close">
          <CloseIcon size={16} />
        </button>
        <h2 className={styles['modalTitle']}>{title}</h2>
        {subtitle !== undefined ? <p className={styles['modalSub']}>{subtitle}</p> : null}
        {children}
      </div>
    </div>
  );
}
