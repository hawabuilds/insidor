/**
 * NARRATIVES — viral posts grouped by the story they are about, fastest-growing first.
 *
 * The board's stories as whole pages (`GET /narratives/default`), only the real ones, ordered by the
 * views each gained in the last hour (narrative-order.ts, the owner's order of 2026-10-16), under the
 * same notice the feed shows. Each row opens the narrative's page.
 *
 * ★ LIVE, LIKE FOR YOU (features/feed useLiveFeed.ts, on when the build sets VITE_LIVE_FEED=on): while
 * the tab is open and on screen, a newer read slides new narratives in at the top and moves nothing
 * else; the list is put back in order only when nobody is looking at a row (opening the tab, coming
 * back after a while). The projector writes the board and the feeds together, so For You's "changed"
 * is this list's signal too. With the switch off the list is read on opening, as before.
 *
 * ★ THE ORDER SAYS WHAT IT IS. While the server sends no last-hour gain (it does not yet), the rows
 * are in the board's order, and a line says so rather than calling that order "fastest-growing".
 *
 * Rows are the feed's row with the posts count in place of a handle, and no platform badge on the
 * picture — a narrative spans several sites, and one badge would name one of them.
 */

import { useCallback } from 'react';
import { BOARD_VIEW, fetchNarratives, type NarrativesList, type Story } from '../../shared/api/index.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { boardNotice } from '../../shared/notice.ts';
import { hrefFor } from '../../shared/route.ts';
import { useComingSoon } from '../../shared/ui/ComingSoon.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { StoryRow } from '../../shared/ui/StoryRow.tsx';
import { LIVE_FEED } from '../feed/live-feed.ts';
import { LiveCard } from '../feed/LiveCard.tsx';
import { useLiveFeed } from '../feed/useLiveFeed.ts';
import { anyLastHour, byLastHour, lastHourLine, postsLine, realNarratives, stageLabel } from './narrative-order.ts';
import styles from './narratives.module.css';
import { tickerText } from '../../shared/format/ticker.ts';

/** The rows a read holds, in the tab's order: real ones only, fastest-growing first. */
const rowsOf = (list: NarrativesList): readonly Story[] => byLastHour(realNarratives(list.stories));

export function Narratives({ onCreate }: { onCreate: (story: Story) => void }) {
  const [list, reload] = useLoad('narratives', (signal) => fetchNarratives(BOARD_VIEW, signal));
  const live = useLiveFeed(LIVE_FEED, list, reload, rowsOf, false);
  const now = useNow();
  const soon = useComingSoon();
  const open = (s: Story) => (window.location.hash = hrefFor({ screen: 'story', storyId: s.id }));
  const rows = live.rows ?? (list.state === 'ready' ? rowsOf(list.value) : null);

  const row = useCallback((s: Story) => (
    <StoryRow
      item={s}
      now={now}
      byline={
        <span>
          {stageLabel(s) === null ? null : <span className={`${styles['stage']} ${styles[`stage_${s.stage ?? ''}`] ?? ''}`}>{stageLabel(s)}</span>}
          {postsLine(s)}
          {lastHourLine(s) !== null ? <span className={lastHourLine(s)?.startsWith('-') === true ? styles['gainDown'] : styles['gain']}>{lastHourLine(s)}</span> : null}
        </span>
      }
      platform={null}
      platformLabel=""
      handlers={{
        open: () => open(s),
        viewCoins: () => open(s),
        create: () => onCreate(s),
        buy: (ticker) => soon(`Buying ${tickerText(ticker)}`),
      }}
    />
  ), [now, onCreate, soon]);

  return (
    <section className={styles['screen']}>
      <header className={styles['header']}>
        <h1>Narratives</h1>
        <p>{rows !== null && !anyLastHour(rows) ? 'Viral posts grouped by the story they\'re about' : 'Fastest-growing first: views gained in the last hour'}</p>
      </header>

      <Notice notice={list.state === 'ready' ? boardNotice(list.value.provenance) : null} />

      {list.state === 'loading' && rows === null ? <p className={styles['empty']}>Loading.</p> : null}
      {list.state === 'failed' && rows === null ? <p className={styles['empty']}>Couldn't load the narratives.</p> : null}
      {rows !== null && rows.length === 0 ? <p className={styles['empty']}>No narratives yet.</p> : null}
      {rows !== null && rows.length > 0 && !anyLastHour(rows) ? (
        <p className={styles['orderNote']}>Views gained in the last hour aren't read for these yet, so this list isn't ranked by growth yet.</p>
      ) : null}
      {rows?.map((s) => (
        <LiveCard key={s.id} id={s.id} arrival={live.arrivals.get(s.id)}>
          {row(s)}
        </LiveCard>
      ))}
    </section>
  );
}
