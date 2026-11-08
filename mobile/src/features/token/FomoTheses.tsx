/**
 * THE "THESES FROM FOMO" SECTION IN THE TRADES TAB — up to three of fomo's traders' written views on the
 * coin, with their position as fomo reports it, below the trades list (TradesPanel.tsx).
 *
 * fomo is a social trading app: a trader writes a short thesis alongside their trade, and fomo shows
 * the position size and PnL beside it. Here each thesis shows the trader's picture and @handle (the
 * memory rule — every @handle shown anywhere gets its profile picture beside it), when they posted,
 * three lines of their words, their position if they still hold, and "via fomo" with a link.
 *
 * "See all" links to the coin on fomo, where every thesis is read in full.
 *
 * ★ NOTHING SHOWN WHEN THERE IS NOTHING: not configured, the read failed, or the coin has no theses —
 * the section is simply absent, the same as if the coin had no trades yet. The chart already notes
 * when fomo is unreachable (CoinChart.tsx), so this section never repeats that reason.
 *
 * What breaks if changed carelessly: the theses are fomo's data and must say "via fomo" on every row,
 * with the link to fomo's own page — the fomo team's leave to show these is on that condition.
 */

import type { CoinTheses, Thesis } from '../../shared/api/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { compactMoney } from '../../shared/format/number.ts';
import { Value } from '../../shared/ui/Value.tsx';
import styles from './token.module.css';

export function FomoTheses({ theses, coinAddress, now }: {
  theses: CoinTheses;
  coinAddress: string;
  now: number;
}) {
  if (theses.kind !== 'read' || theses.theses.length === 0) return null;
  /* Newest first, then highest liked, then as the server sent them (oldest first). */
  const sorted = [...theses.theses].sort((a, b) => b.at - a.at || (b.likes ?? 0) - (a.likes ?? 0));
  const shown = sorted.slice(0, 3);
  return (
    <section className={styles['fomoTheses']}>
      <div className={styles['fomoThesesHead']}>
        <span className={styles['fomoThesesTitle']}>Theses from fomo</span>
        <a className={styles['fomoThesesAll']} href={`https://fomo.family/tokens/solana/${coinAddress}`} target="_blank" rel="noreferrer">See all</a>
      </div>
      {shown.map((t) => <ThesisRow key={t.id} thesis={t} now={now} />)}
    </section>
  );
}

function ThesisRow({ thesis: t, now }: { thesis: Thesis; now: number }) {
  const p = t.position;
  return (
    <a className={styles['fomoThesisRow']} href={t.url} target="_blank" rel="noreferrer">
      <div className={styles['fomoThesisWho']}>
        {t.pictureUrl !== null
          ? <img className={styles['thesisPic']} src={t.pictureUrl} alt="" />
          : <span className={styles['thesisPic']}>{t.handle.slice(0, 1).toUpperCase()}</span>}
        <div className={styles['fomoThesisWhoText']}>
          <div className={styles['fomoThesisWhoLine']}>
            <span className={styles['fomoThesisHandle']}>@{t.handle}</span>
            <span className={styles['thesisPill']}>Thesis</span>
          </div>
          <span className={styles['fomoThesisWhen']}><Value r={formatAge(t.at as never, now as never)} /></span>
        </div>
      </div>
      <p className={styles['fomoThesisText']}>{t.text}</p>
      {p !== null && !p.closed && p.valueUsd !== null ? (
        <div className={styles['fomoThesisPnl']}>
          <span>Holds <b>${compactMoney(p.valueUsd)}</b></span>
          {p.pnlUsd !== null ? <b className={p.pnlUsd >= 0 ? styles['up'] : styles['down']}>{p.pnlUsd >= 0 ? '+' : '-'}${compactMoney(Math.abs(p.pnlUsd))}</b> : null}
        </div>
      ) : null}
      <div className={styles['fomoThesisVia']}>
        <span className={styles['fomoThesisViaBadge']} aria-hidden="true" />
        via fomo
      </div>
    </a>
  );
}
