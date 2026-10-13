/**
 * THE SEARCH TAB. Type a ticker or a name; see our narratives and posts that mention it, and
 * the coins on pump.fun that carry it, read live from the market when you type.
 *
 * ★ SEARCH IS A LIST, NEVER A LINK. A narrative row opens its own page. A post row opens the
 * post where it was posted, and carries no narrative and no coin, so there is no Buy here. A
 * coin row opens its token page, and says "Matched to this narrative" only when that
 * narrative's own page already names it; every other coin of the same name is just a coin.
 *
 * An outage is said, never shown as an empty list. A list a source cut short says "Showing top
 * results". Searching too fast is answered with a request to wait, not with nothing.
 */

import { useEffect, useState } from 'react';
import { ReadError, fetchSearch, type SearchCoin, type SearchNarrative, type SearchPost, type SearchResults } from '../../shared/api/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { formatUsd } from '../../shared/format/number.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { platformOf } from '../../shared/platform.ts';
import { hrefFor } from '../../shared/route.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { GAP_LINE, marketLine, orderCoins, showingTop, type CoinOrder } from './search-view.ts';
import { useOwnerState } from '../owner/hooks.ts';
import { withoutHidden } from '../owner/owner-store.ts';
import styles from './search.module.css';

/** Typing settles for this long before a search goes out. */
const SETTLE_MS = 350;
/** The server refuses shorter terms; the screen does not send them. */
const MIN_TERM = 2;

export function Search() {
  const [typed, setTyped] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(typed.trim().replace(/^\$+/, '')), SETTLE_MS);
    return () => clearTimeout(t);
  }, [typed]);

  return (
    <section className={styles['screen']}>
      <h1 className={styles['title']}>Search</h1>
      <input
        className={styles['input']}
        type="search"
        inputMode="search"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Ticker or name"
        aria-label="Search for a ticker or a name"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
      {term.length < MIN_TERM ? <p className={styles['hint']}>Search for a narrative, a post or a coin.</p> : <Results key={term} term={term} />}
    </section>
  );
}

function Results({ term }: { term: string }) {
  const [loaded] = useLoad(`search:${term}`, (signal) => fetchSearch(term, signal));
  if (loaded.state === 'loading') return <p className={styles['hint']}>Searching.</p>;
  if (loaded.state === 'failed') {
    const slow = loaded.error instanceof ReadError && loaded.error.said === 'slow down';
    return <p className={styles['hint']}>{slow ? 'Too many searches at once. Wait a minute and try again.' : 'Search could not be read just now.'}</p>;
  }
  return <Sections results={loaded.value} />;
}

function Sections({ results }: { results: SearchResults }) {
  const now = useNow();
  const [order, setOrder] = useState<CoinOrder>('cap');
  const { narratives, coins } = results;
  /* A post the owner just hid is left out now; the next projection leaves it out of search too. */
  const { hidden } = useOwnerState();
  const posts = { ...results.posts, items: withoutHidden(results.posts.items, hidden, (p) => p.id) };
  const nothing = narratives.items.length === 0 && posts.items.length === 0 && coins.kind === 'read' && coins.items.length === 0;
  if (nothing) return <p className={styles['hint']}>Nothing found for “{results.term}”.</p>;

  return (
    <>
      {showingTop(results) ? <p className={styles['top']}>Showing top results</p> : null}

      {narratives.items.length > 0 ? (
        <>
          <h2 className={styles['section']}>Narratives</h2>
          {narratives.items.map((n, i) => <NarrativeRow key={n.storyId ?? `past:${i}:${n.title}`} n={n} now={now} />)}
        </>
      ) : null}

      {posts.items.length > 0 ? (
        <>
          <h2 className={styles['section']}>Posts</h2>
          {posts.items.map((p) => <PostRow key={p.id} p={p} now={now} />)}
        </>
      ) : null}

      <div className={styles['sectionRow']}>
        <h2 className={styles['section']}>Coins on pump.fun</h2>
        {coins.kind === 'read' && coins.items.length > 1 ? (
          <div className={styles['order']} role="group" aria-label="Order coins by">
            <button type="button" aria-pressed={order === 'cap'} className={order === 'cap' ? styles['on'] : ''} onClick={() => setOrder('cap')}>Market cap</button>
            <button type="button" aria-pressed={order === 'new'} className={order === 'new' ? styles['on'] : ''} onClick={() => setOrder('new')}>Newest</button>
          </div>
        ) : null}
      </div>
      {coins.kind === 'unavailable' ? <p className={styles['hint']}>— coins could not be searched just now.</p> : null}
      {coins.kind === 'read' && coins.items.length === 0 ? <p className={styles['hint']}>No coin on pump.fun carries this name.</p> : null}
      {coins.kind === 'read' && coins.sourcesMissing > 0 ? <p className={styles['hint']}>One market could not be read, so this list may be short.</p> : null}
      {coins.kind === 'read' ? orderCoins(coins.items, order).map((c) => <CoinRow key={c.coinId} c={c} now={now} />) : null}
    </>
  );
}

function NarrativeRow({ n, now }: { n: SearchNarrative; now: number }) {
  const body = (
    <>
      <Thumb url={n.thumbUrl} size={48} />
      <span className={styles['text']}>
        <b>{n.title}</b>
        <span className={styles['meta']}>
          <span className={n.live ? styles['live'] : ''}>{n.live ? 'Live' : 'From before'}</span>
        </span>
        {n.originPost !== null ? (
          <span className={styles['meta']}>
            <span>{n.originPost.afterLaunch ? 'Went viral after launch' : 'Origin'}</span>
            {n.originPost.permalink !== null ? (
              <a className={styles['origin']} href={n.originPost.permalink} target="_blank" rel="noopener noreferrer">{n.originPost.authorLabel}</a>
            ) : (
              <b>{n.originPost.authorLabel}</b>
            )}
          </span>
        ) : n.originGap !== null ? (
          <span className={styles['meta']}>{GAP_LINE[n.originGap]}</span>
        ) : null}
        {!n.live ? (
          <span className={styles['timeline']}>
            <span>First post <Value r={formatAge(n.firstPostAt, now)} /></span>
            <span>First coin <Value r={formatAge(n.firstCoinAt, now)} /></span>
            <span>Peak <Value r={formatUsd(n.peakMarketCapUsd)} /></span>
          </span>
        ) : null}
      </span>
    </>
  );
  /* A past narrative was never on the board: it has no page, so the row is not a link. */
  return n.storyId !== null ? (
    <a className={styles['row']} href={hrefFor({ screen: 'story', storyId: n.storyId })}>{body}</a>
  ) : (
    <div className={styles['row']}>{body}</div>
  );
}

/** A post: who, when, what. No narrative, no coin, no button — it opens where it was posted. */
function PostRow({ p, now }: { p: SearchPost; now: number }) {
  const body = (
    <>
      <Thumb url={p.thumbUrl} size={48} platform={platformOf(p.sourceLabel)} platformLabel={p.sourceLabel} />
      <span className={styles['text']}>
        <span className={styles['excerpt']}>{p.excerpt}</span>
        <span className={styles['meta']}>
          <b>{p.authorLabel}</b>
          <Value r={formatAge(p.postedAt, now)} />
        </span>
      </span>
    </>
  );
  return p.permalink !== null ? (
    <a className={styles['row']} href={p.permalink} target="_blank" rel="noopener noreferrer">{body}</a>
  ) : (
    <div className={styles['row']}>{body}</div>
  );
}

/** A coin: its picture, ticker, market line, launch and cap. Opens its token page. Shared with
    the same-name list (features/feed/SameNameCoins.tsx), so both lists draw a coin alike. */
export function CoinRow({ c, now }: { c: SearchCoin; now: number }) {
  const label = c.ticker ?? c.name ?? c.address.slice(0, 6);
  return (
    <a className={styles['row']} href={hrefFor({ screen: 'token', coinId: c.coinId })}>
      <CoinLogo address={c.address} ticker={label} imageUrl={c.imageUrl} size={44} />
      <span className={styles['text']}>
        <span className={styles['coinTop']}>
          <b>{c.ticker ?? '—'}</b>
          <span className={styles['name']}>{c.name ?? ''}</span>
        </span>
        <span className={styles['meta']}>
          <span className={c.venue === 'pool' ? styles['bonded'] : ''}>{marketLine(c)}</span>
          <Value r={formatAge(c.launchedAt, now)} />
        </span>
        {c.matched !== null ? <span className={styles['matched']}>Matched to this narrative: {c.matched.title}</span> : null}
      </span>
      <span className={styles['cap']}>
        <Value r={formatUsd(c.marketCapUsd)} />
      </span>
    </a>
  );
}
