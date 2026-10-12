/**
 * The seeded-board notice, rendered. The sentence itself is in `board-provenance.ts`.
 *
 * This file is deliberately four lines of logic and no wording: everything that decides
 * WHETHER to speak lives on the frame the server committed, and everything that decides
 * WHAT to say lives in a module a test can import. See `board-provenance.ts` for both
 * arguments and for the bug the pair of them closes.
 *
 * ★ THERE IS NO DISMISS CONTROL, and that is not an omission. A banner the user can close is
 * a banner that is absent in the screenshot somebody later mistakes for a product, and this
 * one's claim — everything below this line is invented, in the database — is exactly the
 * claim that screenshot would lose. The app itself holds no invented data; a seeded database
 * is the one place left that can, which is why this banner reads the frame and nothing else.
 *
 * `role="status"` and not `alert`, matching every other amber bar in this app: a reader
 * should notice this, not be interrupted by it.
 */

import { useBoardMeta } from '../../shared/api/live/useBoard.ts';
import { provenanceNotice } from './board-provenance.ts';
import styles from './feed.module.css';

export function BoardProvenanceBanner() {
  const notice = provenanceNotice(useBoardMeta().provenance);
  if (notice === null) return null;
  return (
    <div className={styles['provenanceBar']} role="status">
      <b>{notice.headline}</b>
      {notice.detail}
    </div>
  );
}
