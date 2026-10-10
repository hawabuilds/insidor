/**
 * The amber "Sample data" bar.
 *
 * No dismiss control, on purpose: it goes away when what it says stops being true, and not
 * before. The words come from `shared/notice.ts`, where they are tested.
 */

import type { Notice as NoticeCopy } from '../notice.ts';
import styles from './ui.module.css';

export function Notice({ notice }: { notice: NoticeCopy | null }) {
  if (notice === null) return null;
  return (
    <div className={styles['notice']} role="status">
      <b>{notice.headline}</b>
      <span>{notice.detail}</span>
    </div>
  );
}
