/**
 * THE CARD'S AUTO BUY STRIP (the owner, 2026-11-05: "Auto buy 0.5 SOL", the neutral design): under a
 * watched post's actions while an auto buy is on for it. Two words and the amount; a tap opens the
 * sheet to change it or turn it off.
 *
 * Its own file so the card stays unaware of auto buy: nothing is drawn while none is on, and for
 * anyone the server does not allow, never.
 */

import type { RisingPost } from '../../shared/api/index.ts';
import { useAutoBuys } from '../../shared/auto-buys.ts';
import { ChevronIcon } from '../../shared/ui/icons.tsx';
import { solOf } from './format.ts';
import s from './auto-buy.module.css';

export function AutoBuyStrip({ post, onOpen }: { post: RisingPost; onOpen: () => void }) {
  const store = useAutoBuys();
  const buy = store.allowed() ? store.get(post.id) : null;
  if (buy === null) return null;
  return (
    <button type="button" className={s['strip']} onClick={(e) => { e.stopPropagation(); onOpen(); }} aria-label={`Auto buy ${solOf(buy.lamports)} SOL. Change or turn off`}>
      <span className={s['stripText']}>Auto buy <span className={s['stripAmt']}>{solOf(buy.lamports)} SOL</span></span>
      <ChevronIcon size={14} />
    </button>
  );
}

/** Whether a post is one auto buy is for: no coin yet, or one still being looked for. */
export const awaitsCoin = (post: RisingPost): boolean => post.coins.kind === 'none' || post.coins.kind === 'pending';
