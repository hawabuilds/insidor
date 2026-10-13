/**
 * NAME CHIPS ON THE CREATE SHEET: 3 to 5 name and ticker ideas for a coin made from a post, each
 * saying whether its ticker is free. Tapping a chip fills the name and ticker; both stay editable.
 *
 * Read from `GET /post/:id/names` (services/read name-ideas.ts). The ideas are the server's,
 * made from the post's subject when it was put on the feed, in the server's order — free
 * tickers first, then the subject's own one-word name before any phrase. This never re-sorts.
 *
 * ★ "FREE" IS THE SERVER'S WORD, AND ONLY WHEN EVERY SOURCE ANSWERED. A ticker the server could
 * not check says "Couldn't check", never "Free". "Taken by 3 coins" opens the coins under it,
 * each opening its own page.
 *
 * ★ ITS OWN COMPONENT WITH A SMALL DATA INTERFACE, so other controls can sit beside each chip
 * without touching this file. The interface:
 *
 *   postId    the feed post the ideas are for. With no post (a narrative's Create) nothing shows.
 *   onPick    called with the chip's `NameIdea` ({ name, ticker, use }) when it is tapped.
 *   beside    optional: drawn under each chip, handed that chip's `NameIdea` — the owner's thumbs
 *             and "Better name" (features/owner/NameCall.tsx, which takes `{ name, ticker }`).
 *
 * Nothing shows while loading or when the post has no ideas: an empty row is not a claim, and
 * the name fields below are already filled from the post.
 */

import { useState, type ReactNode } from 'react';

import { fetchPostNames, fetchTickerCoins, type NameIdea } from '../../shared/api/index.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { CoinRow } from '../search/Search.tsx';
import { tickerUseLine } from './create-form.ts';
import styles from './create.module.css';

export type { NameIdea };

export function NameSuggestions({ postId, onPick, beside }: { postId: string; onPick: (idea: NameIdea) => void; beside?: ((idea: NameIdea) => ReactNode) | undefined }) {
  const [loaded] = useLoad(`post-names:${postId}`, (signal) => fetchPostNames(postId, signal));
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (loaded.state !== 'ready' || loaded.value.length === 0) return null;

  return (
    <div className={styles['ideas']} aria-label="Name ideas">
      {loaded.value.map((idea) => (
        <div key={idea.ticker} className={styles['idea']}>
          <div className={styles['ideaRow']}>
            <button
              type="button"
              aria-pressed={picked === idea.ticker}
              className={`${styles['ideaChip']} ${picked === idea.ticker ? styles['ideaOn'] : ''}`}
              onClick={() => {
                setPicked(idea.ticker);
                onPick(idea);
              }}
            >
              {idea.name} <b>${idea.ticker}</b>
            </button>
            {idea.use.kind === 'taken' ? (
              <button type="button" className={styles['ideaTaken']} aria-expanded={open === idea.ticker} onClick={() => setOpen(open === idea.ticker ? null : idea.ticker)}>
                {tickerUseLine(idea.use)}
              </button>
            ) : (
              <span className={idea.use.kind === 'free' ? styles['ideaFree'] : styles['ideaUnknown']}>{tickerUseLine(idea.use)}</span>
            )}
          </div>
          {open === idea.ticker ? <TickerCoins ticker={idea.ticker} /> : null}
          {beside?.(idea)}
        </div>
      ))}
    </div>
  );
}

/** The coins already using a ticker, each opening its own page. */
function TickerCoins({ ticker }: { ticker: string }) {
  const [loaded] = useLoad(`ticker-coins:${ticker}`, (signal) => fetchTickerCoins(ticker, signal));
  const now = useNow();
  if (loaded.state === 'loading') return <p className={styles['ideaNote']}>Loading.</p>;
  if (loaded.state === 'failed') return <p className={styles['ideaNote']}>These coins could not be read just now.</p>;
  const list = loaded.value;
  return (
    <div className={styles['ideaCoins']}>
      {list.items.map((c) => <CoinRow key={c.coinId} c={c} now={now} />)}
      {list.more ? <p className={styles['ideaNote']}>More coins use ${ticker}; these are the newest.</p> : null}
    </div>
  );
}
