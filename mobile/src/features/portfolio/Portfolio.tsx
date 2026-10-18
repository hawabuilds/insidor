/**
 * WHAT A WALLET HOLDS — Trador's Stonkfolio, its layout kept, without the pie chart and the
 * Stonks/Stocks split (Insidor holds launchpad coins only): who you are, your followers and
 * following with Edit profile, your bio, the portfolio value with your SOL and what is not priced,
 * Send and Receive, the chart with its range, and one row per coin (HoldingRow.tsx, shared with a
 * profile's portfolio).
 *
 * ★ FACTS, AND A DASH FOR WHAT WE DO NOT KNOW. A coin no market prices says "Unpriced" (it is not
 * worth zero); a coin not bought in Insidor says so where its gain would be; coins past the list are
 * counted, never dropped silently. Follower counts that could not be read are a dash.
 *
 * ★ GAINS ARE FROM BUYS MADE IN INSIDOR, IN SOL, SHOWN AT TODAY'S SOL PRICE (services/read
 * wallet.ts). Trador values each buy at SOL's price that minute; we keep no history of SOL's price,
 * so the line under the list says how the number is made.
 *
 * ★ THE CHART STARTS WHEN THE WALLET WAS FIRST SEEN. Its points are snapshots taken when the wallet
 * is read (store/migrations/0041), then the live total; with fewer than two there is no line, and
 * the chart's place says when it will start rather than drawing one from nothing.
 *
 * Read-only: no key, no TRADING switch. Tapping a coin opens its token page.
 */

import type { ReactNode } from 'react';

import type { Holding, Portfolio as PortfolioData } from '../../shared/api/index.ts';
import type { Measured } from '../../shared/format/measure.ts';
import { formatUsd } from '../../shared/format/number.ts';
import { hrefFor } from '../../shared/route.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { Avatar } from './Avatar.tsx';
import { BalanceChart } from './BalanceChart.tsx';
import { windowChange, type BalancePoint } from './balance-points.ts';
import { HoldingRow } from './HoldingRow.tsx';
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

const solText = (m: Measured): string => (m.known ? m.amount.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—');

/** Your followers, following and bio from the social service; `null` while they load, `unread` when they could not be read. */
export type Social = { readonly kind: 'read'; readonly key: string; readonly followers: number; readonly following: number; readonly bio: string } | { readonly kind: 'unread' } | null;

export interface WhoAmI {
  readonly name: string | null;
  readonly handle: string | null;
  readonly pictureUrl: string | null;
  readonly address: string;
}

/** "86xCn…o2MMY": five of each end, as Trador shows it. */
const shortAddress = (a: string): string => (a.length <= 12 ? a : `${a.slice(0, 5)}…${a.slice(-5)}`);

export function Portfolio({
  who, social = undefined, data, points, range, onRange, scrubbed, onScrub, copied, onCopy, actions, notice, menu,
}: {
  /** Your own social line; absent for a linked wallet, which has no profile. */
  social?: Social | undefined;
  who: WhoAmI;
  data: PortfolioData | null;
  /** The chart's points, live total last; null while they load. */
  points: readonly BalancePoint[] | null;
  range: ChartRange;
  onRange: (r: ChartRange) => void;
  scrubbed: BalancePoint | null;
  onScrub: (p: BalancePoint | null) => void;
  copied: boolean;
  onCopy: () => void;
  /** Send and Receive, as the screen decides to offer them. */
  actions: ReactNode;
  notice: ReactNode;
  /** The profile menu's gear, top right of the header. */
  menu: ReactNode;
}) {
  const read = data !== null && data.kind === 'read' ? data : null;
  const change = points === null ? null : windowChange(points);
  return (
    <div className={styles['page']}>
      <header className={styles['header']}>
        <div className={styles['who']}>
          <Avatar name={who.name ?? who.handle} seed={who.address} src={who.pictureUrl} size={46} />
          <div className={styles['whoText']}>
            <h1 className={styles['name']}>{who.name ?? who.handle ?? 'Portfolio'}</h1>
            <div className={styles['ids']}>
              {who.handle !== null ? <span className={styles['handle']}>@{who.handle}</span> : null}
              <button type="button" className={styles['copy']} onClick={onCopy} aria-label={`Copy address ${who.address}`}>
                <span className={styles['mono']}>{copied ? 'Copied' : shortAddress(who.address)}</span>
                <CopyGlyph />
              </button>
            </div>
          </div>
          {menu}
        </div>

        {social !== undefined ? <SocialLine social={social} /> : null}

        <div className={styles['value']}>
          <div className={styles['label']}>{scrubbed !== null ? 'Value at' : 'Portfolio value'}</div>
          <div className={styles['big']}>
            {scrubbed !== null ? `$${scrubbed.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : read === null ? '—' : <Value r={formatUsd(read.totalUsd)} />}
          </div>
          {scrubbed !== null ? (
            /* While scrubbing, the line is the moment pointed at: today's composition would be wrong for it. */
            <div className={styles['subline']}><span>{stamp(scrubbed.t)}</span></div>
          ) : read !== null ? (
            <div className={styles['subline']}>
              {change !== null ? <span className={change < 0 ? styles['downInline'] : styles['upInline']}>{change < 0 ? `▼ ${Math.abs(change).toFixed(2)}%` : `▲ +${change.toFixed(2)}%`}</span> : null}
              <span>{solText(read.solBalance)} SOL</span>
              {read.unpriced > 0 ? <span>{read.unpriced.toLocaleString('en-US')} not priced here</span> : null}
            </div>
          ) : null}
        </div>

        {actions}

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
      ) : data.holdings.length === 0 ? (
        <div className={styles['nothing']}>
          <b>Nothing here yet</b>
          <p>Buy a coin from a narrative and it shows up here.</p>
        </div>
      ) : (
        <ul className={styles['list']}>
          {data.holdings.map((h) => <li key={h.address}><HoldingRow h={h} /></li>)}
        </ul>
      )}

      {read !== null && read.notShown > 0 ? <p className={styles['foot']}>{read.notShown.toLocaleString('en-US')} more coins not shown.</p> : null}
      {read !== null && read.holdings.length > 0 ? <p className={styles['foot']}>{GAINS_NOTE}</p> : null}

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

/**
 * Trador's followers / following / Edit profile row, then the bio. The counts open the lists; Edit
 * profile opens your profile, where the bio is edited (Trador's sheet edits it in place).
 */
function SocialLine({ social }: { social: Social }) {
  const count = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-US'));
  const read = social !== null && social.kind === 'read' ? social : null;
  return (
    <>
      <div className={styles['social']}>
        {read !== null ? (
          <>
            <a href={hrefFor({ screen: 'follows', key: read.key, which: 'followers' })}><b>{count(read.followers)}</b> followers</a>
            <a href={hrefFor({ screen: 'follows', key: read.key, which: 'following' })}><b>{count(read.following)}</b> following</a>
            <a className={styles['edit']} href={hrefFor({ screen: 'profile', key: read.key })}>Edit profile</a>
          </>
        ) : (
          <>
            <span><b>{count(null)}</b> followers</span>
            <span><b>{count(null)}</b> following</span>
          </>
        )}
      </div>
      {read !== null && read.bio !== '' ? <p className={styles['bio']}>{read.bio}</p> : null}
    </>
  );
}

/** How a gain is made, said once under the list: our record, in SOL, at today's price. */
export const GAINS_NOTE = "Gains count buys made in Insidor: what each coin is worth in SOL now against the SOL paid, at today's SOL price. Coins bought elsewhere show a dash.";

function CopyGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}
