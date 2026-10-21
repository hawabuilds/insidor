/**
 * WHAT A WALLET HOLDS — Trador's Stonkfolio, cut to what a glance needs: who you are with two round
 * buttons (the QR code that opens Receive, and the gear), the total, one line saying how it moved
 * over the chosen window ("+$8.10 (+0.92%) this week"), the window's chips and the chart, then
 * HOLDINGS: SOL first, then one short row per coin (HoldingRow.tsx, shared with a profile).
 * Followers, your bio and Edit profile live on your profile, reached from the gear.
 *
 * ★ FACTS, AND A DASH FOR WHAT WE DO NOT KNOW. A coin no market prices is a dash with a short
 * reason (it is not worth zero); a worth or total from the last price this phone saw says how old
 * it is ("as of 5m ago"), and a wallet that could not be read now shows its last read, said so; a coin with no gain shows "—", and the one note under the list says why ("Gains
 * count coins bought in Insidor."); coins past the list are counted, never dropped silently.
 *
 * ★ GAINS ARE FROM BUYS MADE IN INSIDOR, IN SOL, SHOWN AT TODAY'S SOL PRICE (services/read
 * wallet.ts). Trador values each buy at SOL's price that minute; we keep no history of it.
 *
 * ★ THE CHART STARTS WHEN THE WALLET WAS FIRST SEEN. Its points are snapshots taken when the wallet
 * is read (store/migrations/0041), then the live total; with fewer than two there is no line and no
 * move under the total, and the chart's place says when it will start rather than drawing one.
 *
 * Read-only: no key, no TRADING switch. Tapping a coin opens its token page.
 */

import type { ReactNode } from 'react';

import type { Portfolio as PortfolioData } from '../../shared/api/index.ts';
import { formatUsd } from '../../shared/format/number.ts';
import { hrefFor } from '../../shared/route.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { Avatar } from './Avatar.tsx';
import { BalanceChart } from './BalanceChart.tsx';
import type { BalancePoint } from './balance-points.ts';
import { Holdings } from './HoldingRow.tsx';
import { asOfWords, gainsNote, rangeLine } from './wallet-view.ts';
import styles from './portfolio.module.css';

export type ChartRange = '1d' | '1w' | '1m' | 'all';

/** Trador's chart windows. */
const RANGES: readonly { readonly key: ChartRange; readonly label: string }[] = [
  { key: '1d', label: '1D' },
  { key: '1w', label: '1W' },
  { key: '1m', label: '1M' },
  { key: 'all', label: 'All' },
];

/** The chart's height, Trador's: compact enough that three or four coins clear the tab bar. */
const CHART_HEIGHT = 88;

/** "12 Oct, 18:40" — the moment a scrubbed point was taken. */
const stamp = (t: number): string => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export interface WhoAmI {
  readonly name: string | null;
  readonly handle: string | null;
  readonly pictureUrl: string | null;
  readonly address: string;
}

export function Portfolio({
  who, data, asOf = null, unread = false, now = 0, points, range, onRange, scrubbed, onScrub, buttons, notice, menu,
}: {
  who: WhoAmI;
  data: PortfolioData | null;
  /** Where the shown dollars lean on a last price, and when it was read (wallet-view.ts steadyWallet). */
  asOf?: { readonly total: number | null; readonly holdings: ReadonlyMap<string, number> } | null;
  /** True when `data` is the last read because this one failed. */
  unread?: boolean;
  now?: number;
  /** The chart's points, live total last; null while they load. */
  points: readonly BalancePoint[] | null;
  range: ChartRange;
  onRange: (r: ChartRange) => void;
  scrubbed: BalancePoint | null;
  onScrub: (p: BalancePoint | null) => void;
  /** The round buttons before the gear: the QR code (Receive), and Send in a trading build. */
  buttons: ReactNode;
  notice: ReactNode;
  /** The profile menu's gear, top right of the header. */
  menu: ReactNode;
}) {
  const read = data !== null && data.kind === 'read' ? data : null;
  const move = rangeLine(points, range);
  return (
    <div className={styles['page']}>
      <header className={styles['header']}>
        <div className={styles['who']}>
          <Avatar name={who.name ?? who.handle} seed={who.address} src={who.pictureUrl} size={48} />
          <div className={styles['whoText']}>
            <h1 className={styles['name']}>{who.name ?? who.handle ?? 'Portfolio'}</h1>
            {who.handle !== null ? <div className={styles['ids']}><span className={styles['handle']}>@{who.handle}</span></div> : null}
          </div>
          {buttons}
          {menu}
        </div>

        <div className={styles['value']}>
          <div className={styles['big']}>
            {scrubbed !== null ? `$${scrubbed.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : read === null ? '—' : <Value r={formatUsd(read.totalUsd)} />}
          </div>
          {scrubbed !== null ? (
            /* While scrubbing, the line is the moment pointed at. */
            <div className={styles['moveLine']}>{stamp(scrubbed.t)}</div>
          ) : move !== null ? (
            <div className={`${styles['moveLine']} ${move.tone === 'down' ? styles['downInline'] : styles['upInline']}`}>{move.text}</div>
          ) : null}
          {scrubbed === null && read !== null && asOf?.total != null ? (
            <div className={styles['moveLine']}>{unread ? `Couldn't read your wallet just now. Worth ${asOfWords(asOf.total, now)}` : `Worth ${asOfWords(asOf.total, now)}`}</div>
          ) : null}
        </div>

        <div className={styles['controls']}>
          <div role="group" aria-label="Chart range" className={styles['pills']}>
            {RANGES.map((r) => (
              <button key={r.key} type="button" aria-pressed={r.key === range} className={r.key === range ? styles['pillOn'] : styles['pill']} onClick={() => onRange(r.key)}>{r.label}</button>
            ))}
          </div>
        </div>
      </header>

      {points !== null && points.length >= 2 ? (
        <div className={styles['chartLine']}><BalanceChart points={points} height={CHART_HEIGHT} onScrub={onScrub} /></div>
      ) : points === null ? (
        <div className={styles['chart']} />
      ) : (
        <div className={styles['chart']}>
          <p>Your balance chart starts from the first time Insidor sees this wallet. Check back shortly — there is no way to know what it was worth before then.</p>
        </div>
      )}

      {notice}

      {data === null ? (
        <ul className={styles['list']}>
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className={styles['skeleton']}><span className={styles['skDot']} /><span className={styles['skLines']}><span /><span /></span><span className={styles['skBox']} /></li>
          ))}
        </ul>
      ) : data.kind === 'unavailable' ? (
        <p className={styles['empty']}>— what this wallet holds could not be read just now.</p>
      ) : (
        <>
          <Holdings data={data} asOf={asOf} now={now} />
          {data.holdings.length === 0 ? (
            <div className={styles['nothing']}>
              <b>No coins yet</b>
              <p>Buy a coin from a narrative and it shows up here.</p>
            </div>
          ) : (
            <p className={styles['foot']}>{gainsNote(data.holdings)}</p>
          )}
        </>
      )}

      {read !== null && read.created.coins.length > 0 ? (
        <>
          <h2 className={styles['section']}>Coins you created</h2>
          <ul className={styles['list']}>
            {read.created.coins.map((c) => (
              <li key={c.address}>
                <a className={styles['row']} href={hrefFor({ screen: 'token', coinId: c.coinId })}>
                  <CoinLogo small address={c.address} ticker={c.ticker} size={36} />
                  <div className={styles['mid']}>
                    <div className={styles['symbolRow']}><span className={styles['symbol']}>{c.ticker ?? '—'}</span><span className={styles['pair']}>Created on Insidor</span></div>
                    <div className={styles['units']}>Market cap</div>
                  </div>
                  <div className={styles['right']}><div className={styles['worth']}><Value r={formatUsd(c.marketCapUsd)} /></div></div>
                </a>
              </li>
            ))}
          </ul>
          <p className={styles['foot']}>Unclaimed creator fees {read.created.unclaimedFeesSol.known ? `${read.created.unclaimedFeesSol.amount.toLocaleString('en-US', { maximumFractionDigits: 4 })} SOL` : '—'}</p>
        </>
      ) : null}
    </div>
  );
}
