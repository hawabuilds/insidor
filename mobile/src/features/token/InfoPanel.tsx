/**
 * THE INFO TAB — Trador's `panels/InfoPanel.tsx` for a launchpad coin, in our CSS modules: the
 * stat block a trader reads before sizing (depth, day volume, cap, price, holders, what it is
 * priced in, volume over liquidity, the day's move), then the rows (pair, launchpad, where it
 * stands on the curve, whether it can be traded, the address with copy, the creator, the launch),
 * then Insidor's own part: the narrative and where the coin came from (passed in by the page that
 * knows them) and the feed posts that name this coin, each with its evidence as facts.
 *
 * Trador's "Holder rewards" and "Pool" rows are not ported: no launchpad coin here routes
 * rewards, and the read service does not carry a pool address. "Supply" is replaced by Holders,
 * which the owner asked for and which no other screen shows.
 *
 * ★ EVERY UNKNOWN SAYS SO. A number the source did not give is a dash with its reason (`Value`),
 * never "$0"; "Vol / liq" is shown only when both of its numbers are known.
 *
 * What breaks if changed carelessly: the price and market cap here must be the ones the header
 * shows. Both read the cap through the shared `useCoinCap` (shared/coin-cap.ts) from the same
 * served figure, and this tab shows the latest trade's price, the one that cap is at.
 */

import type { ReactNode } from 'react';

import type { CoinAbout, CoinMarket } from '../../shared/api/index.ts';
import { evidenceFacts } from '../../shared/coin-status.ts';
import { formatAge } from '../../shared/format/duration.ts';
import type { Measured } from '../../shared/format/measure.ts';
import { formatChangePercent, formatCount, formatPrice, formatUsd } from '../../shared/format/number.ts';
import { pendingRendered, value } from '../../shared/format/rendered.ts';
import { hrefFor } from '../../shared/route.ts';
import { useCoinCap } from '../../shared/useCoinCap.ts';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { ChevronIcon, CopyIcon, ExternalIcon } from '../../shared/ui/icons.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { servedCap, type TokenFacts } from './token-facts.ts';
import styles from './info.module.css';

/** The latest price the market read gives: the newest trade's, else the last candle's close. */
export function latestPrice(market: CoinMarket | null): Measured | null {
  if (market?.kind !== 'read') return null;
  const trade = market.trades?.find((t) => t.priceUsd.known);
  if (trade !== undefined && trade.priceUsd.known) return trade.priceUsd;
  const last = market.candles?.[market.candles.length - 1];
  return last === undefined ? null : { known: true, amount: last.c };
}

/** "On curve 43%", "Bonded", or not listed; the curve's percentage only when it was read. */
export function standing(market: CoinMarket | null, venue: 'curve' | 'pool' | null): string {
  const read = market?.kind === 'read' ? market : null;
  const v = read?.venue ?? venue;
  if (v === 'pool') return 'Bonded';
  if (v === 'curve') {
    const p = read?.curveProgress;
    return p?.known === true ? `On curve ${Math.min(100, p.amount * 100).toFixed(p.amount < 0.1 ? 1 : 0)}%` : 'On curve';
  }
  return 'Not listed yet';
}

const dated = (at: number): string =>
  new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function InfoPanel({ facts, market, about, tradable, now, insidor = null }: {
  facts: TokenFacts;
  market: CoinMarket | null;
  /** Null while it loads or when it could not be read: its numbers are then dashes. */
  about: CoinAbout | null;
  /** Whether a quote can be got now, as the server said; null when nothing has measured it. */
  tradable: boolean | null;
  now: number;
  /** The page's own Insidor facts: the narrative and the coin's origin, when it has them. */
  insidor?: ReactNode;
}) {
  const toast = useToast();
  const unread: Measured = { known: false, pending: about === null ? 'not_read_yet' : 'not_reported' };
  const liquidity = facts.liquidityUsd?.known === true ? facts.liquidityUsd : (about?.liquidityUsd ?? unread);
  const volume = about?.volume24hUsd ?? unread;
  const served = servedCap(facts, about);
  const cap = useCoinCap(facts.address, served.known || about !== null ? served : unread, false, facts.price);
  const price = latestPrice(market) ?? facts.price;
  const change = formatChangePercent(facts.change24h);
  const turnover = liquidity.known && volume.known && liquidity.amount > 0 ? value(`${(volume.amount / liquidity.amount).toFixed(2)}x`) : null;
  const launched = about?.launchedAt.known === true ? about.launchedAt : facts.launchedAt;
  const ticker = facts.ticker ?? '—';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(facts.address);
      toast('Address copied');
    } catch {
      toast('Could not copy', facts.address);
    }
  };

  return (
    <div className={styles['info']}>
      <dl className={styles['stats']}>
        <Stat label="Liquidity"><Value r={formatUsd(liquidity)} /></Stat>
        <Stat label="24h volume"><Value r={formatUsd(volume)} /></Stat>
        <Stat label="Market cap"><Value r={formatUsd(cap)} /></Stat>
        <Stat label="Price"><Value r={formatPrice(price)} /></Stat>
        <Stat label="Holders"><Value r={formatCount(about?.holders ?? unread)} /></Stat>
        <Stat label="Priced in">SOL</Stat>
        <Stat label="Vol / liq">{turnover === null ? <Value r={pendingRendered('not_reported')} /> : <Value r={turnover} />}</Stat>
        <Stat label="24h change" tone={change.direction}>
          {change.direction === 'up' ? '▲ ' : change.direction === 'down' ? '▼ ' : ''}
          <Value r={change.text} />
        </Stat>
      </dl>

      <div className={styles['rows']}>
        <Row label="Pair"><b>{ticker} / SOL</b></Row>
        <Row label="Launchpad">
          <a className={styles['strong']} href={`https://pump.fun/coin/${facts.address}`} target="_blank" rel="noopener noreferrer">
            {facts.venueLabel} <ExternalIcon size={13} />
          </a>
        </Row>
        <Row label="Status"><b>{standing(market, facts.venue)}</b></Row>
        <Row label="Tradeable">
          {tradable === null ? <span className={styles['faint']}>Not measured</span> : tradable ? <b>Yes</b> : <span className={styles['faint']}>Not right now</span>}
        </Row>
        <Row label="Contract">
          <span className={styles['mint']}>
            <span className={styles['mono']}>{facts.address.slice(0, 6)}…{facts.address.slice(-4)}</span>
            <button type="button" onClick={() => void copy()} aria-label="Copy contract address"><CopyIcon size={13} /></button>
            <a href={`https://solscan.io/token/${facts.address}`} target="_blank" rel="noopener noreferrer" aria-label="View on the explorer"><ExternalIcon size={13} /></a>
          </span>
        </Row>
        <Row label="Creator">
          {about?.creator != null ? (
            <a className={styles['muted']} href={`https://solscan.io/account/${about.creator}`} target="_blank" rel="noopener noreferrer">
              <span className={styles['mono']}>{about.creator.slice(0, 6)}…{about.creator.slice(-4)}</span> <ExternalIcon size={13} />
            </a>
          ) : (
            <Value r={pendingRendered(about === null ? 'not_read_yet' : 'not_reported')} />
          )}
        </Row>
        <Row label="Launched">
          {launched.known ? (
            <span className={styles['muted']}>
              {dated(launched.at)}&nbsp;&nbsp;&nbsp;<Value r={formatAge(launched, now as never)} /> old
            </span>
          ) : (
            <Value r={formatAge(launched, now as never)} />
          )}
        </Row>
      </div>

      {insidor !== null || (about !== null && about.posts.length > 0) ? <h3 className={styles['section']}>On Insidor</h3> : null}
      {insidor}
      {about?.posts.map((p) => {
        const said = evidenceFacts(p.evidence);
        const body = (
          <>
            <span className={styles['postHead']}>
              <span className={styles['kicker']}>{p.own ? "This post's coin" : 'Uses this post’s name'}</span>
              {p.permalink !== null ? <ChevronIcon size={16} /> : null}
            </span>
            <span className={styles['post']}>
              <Thumb url={p.thumbUrl} size={48} />
              <span className={styles['postText']}>
                <span className={styles['by']}>
                  <b>{p.authorLabel}</b>
                  <span>{p.sourceLabel}</span>
                  <Value r={formatAge(p.postedAt, now as never)} />
                </span>
                <span className={styles['excerpt']}>{p.excerpt}</span>
              </span>
            </span>
            {said.length > 0 ? <span className={styles['facts']}>{said.join(', ')}</span> : null}
          </>
        );
        return (
          <div key={p.postId} className={styles['card']}>
            {p.permalink !== null ? <a className={styles['cardLink']} href={p.permalink} target="_blank" rel="noopener noreferrer">{body}</a> : <div>{body}</div>}
            {p.story !== null ? (
              <a className={styles['storyLink']} href={hrefFor({ screen: 'story', storyId: p.story.storyId })}>
                In {p.story.title} <ChevronIcon size={14} />
              </a>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, tone = null, children }: { label: string; tone?: 'up' | 'down' | 'flat' | null; children: ReactNode }) {
  return (
    <div className={styles['stat']}>
      <dt>{label}</dt>
      <dd className={tone === 'up' ? styles['up'] : tone === 'down' ? styles['down'] : ''}>{children}</dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles['row']}>
      <span className={styles['rowLabel']}>{label}</span>
      <span className={styles['rowValue']}>{children}</span>
    </div>
  );
}
