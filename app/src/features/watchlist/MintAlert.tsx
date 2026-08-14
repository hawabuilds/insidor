/**
 * THE MINT ALERT, in Hawa's floating sheet (styles/index.css:609-616) with her `pop`
 * entrance and her lime `.newbadge` for the ticker.
 *
 * A coin is minted within about two minutes of the source post and takes about six days to
 * peak, so this notification is not "you missed it". It is "the thing you were watching just
 * got a coin, and it is still early" — which is why it leads with the age of the mint rather
 * than with a price, and why the copy does not say "hurry".
 *
 * It only fires on a SETTLED coin. `unsure` never reaches here, because the watch store's
 * transition rule ignores it — an alert that fires on "some coin claims this story" is an
 * alert the user learns to dismiss, and this is the one interruption the product gets.
 *
 * ★ There is no buy control on this card and there should never be one. The two actions are
 * "read it" and "put it away". A buy button on a notification is a product asking for a
 * decision in the two seconds before the user has read anything — and on an unsure match it
 * would not be allowed to exist at all, so it does not get to exist here either.
 */

import { formatAge } from '../../shared/format/duration.ts';
import { Num } from '../../shared/ui/index.ts';
import type { MintAlert as Alert } from './watchlist-store.ts';
import { instant } from '../../shared/format/measure.ts';
import styles from './watchlist.module.css';

export function MintAlerts({
  alerts,
  now,
  onOpen,
  onDismiss,
}: {
  alerts: readonly Alert[];
  now: number;
  onOpen: (storyId: string) => void;
  onDismiss: (storyId: string) => void;
}) {
  if (alerts.length === 0) return null;
  return (
    <div className={styles['alerts']} role="status" aria-live="polite">
      {alerts.map((alert) => (
        <div key={alert.storyId} className={styles['alert']}>
          <div className={styles['alertHead']}>
            <span className={styles['alertTicker']}>${alert.ticker}</span>
            <span className={styles['alertAge']}>
              <Num rendered={formatAge(instant(alert.at), now)} dim />
            </span>
          </div>
          <div className={styles['alertBody']}>
            A story you are watching now has a coin we can name.
          </div>
          <div className={styles['alertActions']}>
            <button
              type="button"
              className={`${styles['act']} ${styles['actGo']}`}
              onClick={() => onOpen(alert.storyId)}
            >
              open story
            </button>
            <button
              type="button"
              className={styles['act']}
              onClick={() => onDismiss(alert.storyId)}
            >
              dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
