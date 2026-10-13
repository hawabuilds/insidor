/**
 * THE NAME CHIPS AND THE TICKER'S COIN LIST on the Create sheet.
 *
 * `NameChips` is one row of small chips under the ticker: the post's other name ideas (the top one
 * is already in the fields), each filling the name and ticker when tapped. The row scrolls
 * sideways rather than wrapping, so five ideas cost the sheet one line of height, not five.
 *
 * The ideas are read once by the sheet (`GET /post/:id/names`, services/read name-ideas.ts) and
 * handed in, in the server's order, because the sheet also needs the top one to prefill the
 * fields. This never re-sorts.
 *
 * ★ A CHIP SAYS NO STANDING OF ITS OWN. Whether a ticker is free is said once, on the line under
 * the ticker field, for whatever ticker is in it — a chip's standing shows the moment it is
 * tapped. Five "Free"/"Taken" labels beside five chips was the length this sheet was cut from.
 *
 * ★ THE ROW IS ALWAYS THERE, AT ITS HEIGHT. While the ideas are still being read it holds three
 * blank chip shapes; with none to offer it says so in the same line. It never appears late or
 * disappears, because the pop-up is centred and one row arriving would move every field.
 *
 * `TickerCoins` is what "Taken by 3 coins" opens: the coins already using the ticker
 * (`GET /ticker/:symbol/coins`), each opening its own page, in a box that scrolls on its own so
 * the sheet does not grow past the screen.
 */

import type { SameNameCoins } from '../../shared/api/index.ts';
import { useNow } from '../../shared/hooks.ts';
import { CoinRow } from '../search/Search.tsx';
import type { Idea } from './create-form.ts';
import styles from './create.module.css';

/** Blank chips held in the row while the ideas are read: their widths, so nothing reflows. */
const HELD_WIDTHS = [64, 78, 58];

export function NameChips({ ideas, reading, onPick }: { ideas: readonly Idea[]; reading: boolean; onPick: (idea: Idea) => void }) {
  if (reading) {
    return (
      <div className={styles['chips']} aria-label="Other names" aria-busy="true">
        {HELD_WIDTHS.map((w) => <span key={w} className={styles['chipHeld']} style={{ width: w }} />)}
      </div>
    );
  }
  if (ideas.length === 0) {
    return <div className={styles['chips']}><span className={styles['chipsNone']}>No other names</span></div>;
  }
  return (
    <div className={styles['chips']} aria-label="Other names">
      {ideas.map((idea) => (
        <button key={idea.ticker} type="button" className={styles['chip']} title={idea.name} aria-label={`${idea.name}, $${idea.ticker}`} onClick={() => onPick(idea)}>
          ${idea.ticker}
        </button>
      ))}
    </div>
  );
}

/** The coins already using a ticker, each opening its own page. */
export function TickerCoins({ ticker, list }: { ticker: string; list: SameNameCoins }) {
  const now = useNow();
  return (
    <div className={styles['coins']}>
      {list.items.map((c) => <CoinRow key={c.coinId} c={c} now={now} />)}
      {list.more ? <p className={styles['note']}>More coins use ${ticker}; these are the newest.</p> : null}
    </div>
  );
}
