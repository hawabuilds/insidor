/**
 * The ⌘K palette — Hawa's shell, and an honest body.
 *
 * The chrome is hers to the pixel (palette.module.css). What is inside it is the truth: there
 * is no search service, no index, and nothing to match against, so the palette says so in one
 * line rather than offering a box that swallows what you type and answers nothing.
 *
 * `ui/` is a leaf: this imports React and its own stylesheet and nothing else from src/.
 */

import { useEffect } from 'react';

import styles from './palette.module.css';

/** The example chips are the shapes search WILL take, shown so the palette is legible as a
    search surface. They are not clickable, because there is nothing to click through to. */
const EXAMPLES: readonly string[] = ['a ticker', 'a contract address', 'a story'];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  /* Escape closes. Owned here rather than in the shell because it only means anything while
     the palette is open, and the shell should not have to remember to unbind it. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={styles['back']}
      role="presentation"
      onClick={onClose}
    >
      <div
        className={styles['pal']}
        role="dialog"
        aria-modal="true"
        aria-label="search"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles['top']}>
          <div className={styles['topRow']}>
            <span className={styles['ic']} aria-hidden="true">
              ⌕
            </span>
            <span className={styles['title']}>Search</span>
            <kbd className={styles['kbd']}>ESC</kbd>
          </div>
          <div className={styles['examples']}>
            <span className={styles['exLbl']}>will find</span>
            {EXAMPLES.map((ex) => (
              <span key={ex} className={styles['ex']}>
                {ex}
              </span>
            ))}
          </div>
        </div>

        <div className={styles['empty']}>
          <b>Search is not built yet.</b>
          Nothing is indexed. There is no search service behind this box and no stories,
          tickers or contracts to match against.
          <span className={styles['note']}>
            It needs an index over the board and an endpoint to query it. This is where it will
            open when both exist.
          </span>
        </div>
      </div>
    </div>
  );
}
