/**
 * THE TOKEN PAGE'S PVP LINE (the owner, 2026-10-31, reports/mockups/pvp.html right panel): under the
 * odds line, one amber-tagged row, "PvP  $KJI for this post is ahead at $51K, this one $12K  ›", and a
 * tap opens the post, where every coin of the race is listed with its own Buy.
 *
 * Its own file beside LaunchOdds.tsx, not inside it: the odds line is about launches like this one,
 * this is about one other coin for the same post. Who is ahead is shared/pvp.ts `pvpAhead`, the same
 * rule as the For You card and the post's dock, so the three never name different leaders.
 *
 * ★ ONLY WHILE TRUE. The row is drawn only when another coin for the post has a read cap strictly above
 * this one's (this page's own live cap when it has one, so the line agrees with the cap under it). The
 * leader's own page, a race with an unread cap, or a coin that has caught up shows nothing at all.
 *
 * What breaks if changed carelessly: the row's height. The page is laid out so two whole trades show
 * above Buy and Sell on a 390x844 phone (TokenView.tsx); this row pushes them down while it shows, which
 * the owner accepted for a PvP, and it must stay one line.
 */

import type { AboutPost } from '../../shared/api/index.ts';
import { formatUsd } from '../../shared/format/number.ts';
import { measuredFrom, type Measured } from '../../shared/format/measure.ts';
import { tickerText } from '../../shared/format/ticker.ts';
import { pvpAhead } from '../../shared/pvp.ts';
import { hrefFor } from '../../shared/route.ts';
import { ChevronIcon } from '../../shared/ui/icons.tsx';
import { Num } from '../../shared/ui/Num.tsx';
import styles from './pvp-line.module.css';

const usd = (n: number): string => {
  const r = formatUsd(measuredFrom(n, 'no_market'));
  return r.text;
};

export function PvpLine({ posts, address, cap }: { posts: readonly AboutPost[]; address: string; cap: Measured }) {
  const ahead = pvpAhead(posts.map((p) => ({ postId: p.postId, ...(p.evidence.racingCoins !== undefined ? { racingCoins: p.evidence.racingCoins } : {}) })), address, cap);
  if (ahead === null) return null;
  return (
    <a className={styles['line']} href={hrefFor({ screen: 'post', postId: ahead.postId })}>
      <span className={styles['tag']}>PvP</span>
      <span className={styles['words']}>
        {tickerText(ahead.leader.ticker)} for this post is ahead at <Num className={styles['figure']}>{usd(ahead.leaderCap)}</Num>, this one <Num className={styles['figure']}>{usd(ahead.ownCap)}</Num>
      </span>
      <span className={styles['end']} aria-hidden="true"><ChevronIcon size={14} /></span>
    </a>
  );
}
