/**
 * THE PROFILE'S PARTS — the approved design (direction B, the owner, 2026-10-22), drawn once and
 * used by both profiles: your own (the Portfolio tab, and #/u/<you>) and someone else's (#/u/<them>).
 *
 *   ProfileHead     the banner (theirs, or the Insidor pattern) behind the status bar, the round
 *                   picture over its bottom-left, the round buttons over it, the name with its small
 *                   X button, @handle, bio, "N Following  N Followers", and the buttons under them
 *   PortfolioBlock  your own only: "Portfolio", the total, "+$X this week", the purple line, 1D–All
 *   StatsStrip      Caught early, Best catch, Hit rate (profile-words.ts statCells)
 *   CoinLists       "Holdings N" and "Created N" as two headings that switch the list under them
 *
 * Split from the screens because the two profiles differ only in what sits around these: your own
 * has the portfolio and Edit profile, someone else's has Follow and no money totals.
 *
 * ★ FACTS ONLY, AND A DASH WITH ITS REASON FOR WHAT WE DO NOT KNOW. A coin with no price is a dash
 * with why; a coin with no gain has a plain dash; a portfolio hidden by its owner says "Hidden by
 * @handle" where the lists would be, never an empty list.
 *
 * ★ PURPLE ONLY FOR STATE AND THE MAIN ACTION: Follow, the chart's line, the chosen tab's rule. The
 * chosen range is white on the chosen grey; tags are grey, except "Early", which is green as the
 * approved design draws it. No ring around any picture.
 *
 * What breaks if changed carelessly: the banner's z-index (profile.module.css). It sits above the
 * status-bar strip so it can run behind the clock; anything else raised that far covers the strip.
 */

import { useState, type ReactNode } from 'react';

import type { Catches, CreatedCoin, Holding, Portfolio } from '../../shared/api/index.ts';
import type { ProfileCard } from '../../shared/api/people.ts';
import { known } from '../../shared/format/measure.ts';
import { formatUsd } from '../../shared/format/number.ts';
import { hrefFor } from '../../shared/route.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { BackIcon, XLogoIcon } from '../../shared/ui/icons.tsx';
import { Nums } from '../../shared/ui/Num.tsx';
import { facesFileUrl } from '../../shared/ui/usePosterPic.ts';
import { Value } from '../../shared/ui/Value.tsx';
import { goBack } from '../../shared/nav.ts';
import { Avatar } from '../portfolio/Avatar.tsx';
import { BalanceChart } from '../portfolio/BalanceChart.tsx';
import type { BalancePoint } from '../portfolio/balance-points.ts';
import { asOfWords, compactAmount, gainsNote, noPriceReason, profitLine, solValueUsd } from '../portfolio/wallet-view.ts';
import { primeSearchedCoin } from '../token/searched-key.ts';
import { firstRows, launchedWords, moveLine, mutualsLine, PROFILE_RANGES, statCells, type ProfileRange } from './profile-words.ts';
import styles from './profile.module.css';

const PICTURE = 84;
const LOGO = 38;

/** Who the head draws: the profile card, or what the sign-in knows while the card is on its way. */
export type Who = Pick<ProfileCard, 'userId' | 'handle' | 'name' | 'pictureUrl' | 'bio' | 'followers' | 'following'> & Partial<Pick<ProfileCard, 'pictureFile' | 'bannerFile' | 'xHandle' | 'mutuals'>>;

/* ── the banner ─────────────────────────────────────────────────────── */

/** Their banner, or the Insidor pattern: small eye marks on the card grey, no colour wash. */
function Banner({ file }: { file: string | null }) {
  const src = facesFileUrl(file);
  const [failed, setFailed] = useState<string | null>(null);
  if (src !== null && failed !== src) return <img className={styles['bannerImg']} src={src} alt="" onError={() => setFailed(src)} />;
  return (
    <svg className={styles['bannerPattern']} aria-hidden="true" preserveAspectRatio="xMidYMid slice" viewBox="0 0 393 180">
      <defs>
        <pattern id="insidor-eyes" width="56" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(-12)">
          <path d="M8 20c6-8 22-8 28 0c-6 8-22 8-28 0z" fill="none" stroke="#24242b" strokeWidth="1.6" />
          <circle cx="22" cy="20" r="3.4" fill="#24242b" />
          <path d="M36 40c6-8 22-8 28 0c-6 8-22 8-28 0z" fill="none" stroke="#1c1c22" strokeWidth="1.6" transform="translate(-28 -20)" />
        </pattern>
        <linearGradient id="insidor-banner-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.45" stopColor="#0a0a0c" stopOpacity="0" />
          <stop offset="1" stopColor="#0a0a0c" stopOpacity="0.7" />
        </linearGradient>
      </defs>
      <rect width="393" height="180" fill="#131317" />
      <rect width="393" height="180" fill="url(#insidor-eyes)" />
      <rect width="393" height="180" fill="url(#insidor-banner-fade)" />
    </svg>
  );
}

/* ── the head ───────────────────────────────────────────────────────── */

export function ProfileHead({ who, back = false, over, actions, countsFor }: {
  who: Who;
  /** A back button at the top left (a profile reached from somewhere); none on the Portfolio tab. */
  back?: boolean;
  /** The round buttons at the top right of the banner. */
  over: ReactNode;
  /** The buttons under the counts. */
  actions: ReactNode;
  /** Whose follow lists the counts open (handle or id); null draws them as plain text. */
  countsFor: string | null;
}) {
  const at = who.handle !== null ? `@${who.handle}` : null;
  const x = who.xHandle ?? null;
  const mutualPeople = who.mutuals?.people ?? [];
  return (
    <>
      <div className={styles['banner']}>
        <Banner file={who.bannerFile ?? null} />
        <div className={styles['overTop']}>
          {back ? (
            <button type="button" className={styles['glass']} aria-label="Back" onClick={() => goBack({ screen: 'portfolio' })}>
              <BackIcon size={20} />
            </button>
          ) : null}
          <span className={styles['spacer']} />
          {over}
        </div>
        <div className={styles['avatar']}>
          <Avatar name={who.name ?? who.handle} seed={who.userId} src={who.pictureUrl} file={who.pictureFile ?? null} size={PICTURE} />
        </div>
      </div>

      <div className={styles['who']}>
        <div className={styles['nameRow']}>
          <h1 className={styles['name']}>{who.name ?? at ?? 'Profile'}</h1>
          {x !== null ? (
            <a className={styles['xButton']} href={`https://x.com/${encodeURIComponent(x)}`} target="_blank" rel="noreferrer" aria-label={`Open @${x} on X`}>
              <span><XLogoIcon size={12} /></span>
            </a>
          ) : null}
        </div>
        {at !== null ? <div className={styles['handle']}>{at}</div> : null}
        {who.bio !== '' ? <p className={styles['bio']}>{who.bio}</p> : null}
        <div className={styles['counts']}>
          {countsFor !== null ? (
            <>
              <a href={hrefFor({ screen: 'follows', key: countsFor, which: 'following' })}><b>{who.following.toLocaleString('en-US')}</b> Following</a>
              <a href={hrefFor({ screen: 'follows', key: countsFor, which: 'followers' })}><b>{who.followers.toLocaleString('en-US')}</b> Followers</a>
            </>
          ) : (
            <>
              <span><b>{who.following.toLocaleString('en-US')}</b> Following</span>
              <span><b>{who.followers.toLocaleString('en-US')}</b> Followers</span>
            </>
          )}
        </div>
        {who.mutuals != null && mutualPeople.length > 0 ? <Mutuals who={who} /> : null}
        <div className={styles['actions']}>{actions}</div>
      </div>
    </>
  );
}

function Mutuals({ who }: { who: Who }) {
  const people = who.mutuals?.people ?? [];
  const line = mutualsLine(who.mutuals);
  return (
    <div className={styles['mutuals']}>
      <span className={styles['faces']}>
        {people.slice(0, 3).map((m) => <Avatar key={m.userId} name={m.name ?? m.handle} seed={m.userId} src={m.pictureUrl} file={m.pictureFile ?? null} size={20} />)}
      </span>
      <span>{line}</span>
    </div>
  );
}


/** The name row's skeleton while a profile is read. */
export function HeadSkeleton({ back }: { back: boolean }) {
  return (
    <>
      <div className={styles['banner']}>
        <Banner file={null} />
        <div className={styles['overTop']}>
          {back ? (
            <button type="button" className={styles['glass']} aria-label="Back" onClick={() => goBack({ screen: 'portfolio' })}>
              <BackIcon size={20} />
            </button>
          ) : null}
        </div>
      </div>
      <div className={styles['who']}><span className={styles['skName']} /></div>
    </>
  );
}

/* ── your portfolio ─────────────────────────────────────────────────── */

export function PortfolioBlock({ total, asOf, points, range, onRange }: {
  /** The total, drawn; null while the wallet is read. */
  total: ReactNode | null;
  /** "Worth as of 5m ago" when the total leans on a last price. */
  asOf: string | null;
  points: readonly BalancePoint[] | null;
  range: ProfileRange;
  onRange: (r: ProfileRange) => void;
}) {
  const [scrubbed, setScrubbed] = useState<BalancePoint | null>(null);
  const move = moveLine(points, range);
  return (
    <section className={styles['section']} aria-label="Portfolio">
      <h2 className={styles['label']}>Portfolio</h2>
      <div className={styles['total']}>
        {scrubbed !== null ? `$${scrubbed.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : (total ?? '—')}
      </div>
      {scrubbed !== null ? (
        <div className={styles['move']}>{new Date(scrubbed.t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
      ) : move !== null ? (
        <div className={`${styles['move']} ${move.tone === 'down' ? styles['down'] : styles['up']}`}><Nums text={move.text} /></div>
      ) : null}
      {asOf !== null && scrubbed === null ? <div className={styles['move']}>{asOf}</div> : null}
      {points !== null && points.length >= 2 ? (
        <div className={styles['chart']}><BalanceChart points={points} height={120} onScrub={setScrubbed} tone="brand" /></div>
      ) : (
        <div className={styles['chartNote']}>{points === null ? '' : 'The chart starts from the first time Insidor reads this wallet. Check back shortly.'}</div>
      )}
      <div className={styles['ranges']} role="group" aria-label="Chart range">
        {PROFILE_RANGES.map((r) => (
          <button key={r.key} type="button" aria-pressed={r.key === range} className={r.key === range ? styles['rangeOn'] : styles['range']} onClick={() => onRange(r.key)}>{r.label}</button>
        ))}
      </div>
    </section>
  );
}

/* ── the stats strip ────────────────────────────────────────────────── */

export function StatsStrip({ catches, state }: { catches: Catches | null; state: 'shown' | 'hidden' | 'no_wallet' }) {
  return (
    <div className={styles['stats']}>
      {statCells(catches, state).map((c) => (
        <div key={c.label} className={styles['stat']}>
          <div className={styles['statValue']}>{c.value}</div>
          <div className={styles['statLabel']}>{c.label}</div>
          {c.reason !== null ? <div className={styles['statWhy']}>{c.reason}</div> : null}
        </div>
      ))}
    </div>
  );
}

/* ── Holdings and Created ───────────────────────────────────────────── */

type Read = Extract<Portfolio, { kind: 'read' }>;

export function CoinLists({ data, catches, self, at, hidden = false, noWallet = false, now, asOf = null }: {
  /** The wallet read; null while it loads; 'unavailable' when it could not be read. */
  data: Portfolio | null;
  catches: Catches | null;
  self: boolean;
  /** "@handle", for the hidden and empty lines. */
  at: string;
  hidden?: boolean;
  noWallet?: boolean;
  now: number;
  /** Rows whose worth is from the last price this phone saw, and when (wallet-view.ts steadyWallet). */
  asOf?: ReadonlyMap<string, number> | null;
}) {
  const [tab, setTab] = useState<'holdings' | 'created'>('holdings');
  const [all, setAll] = useState(false);
  const read: Read | null = data !== null && data.kind === 'read' ? data : null;
  const coins = read === null ? null : read.holdings.length + read.notShown;
  const created = read === null ? null : read.created.coins.length;
  const count = (n: number | null) => (n === null ? null : <span>{n.toLocaleString('en-US')}</span>);
  return (
    <>
      <div className={styles['tabs']} role="tablist" aria-label="Coins">
        <button type="button" role="tab" aria-selected={tab === 'holdings'} className={`${styles['tab']} ${tab === 'holdings' ? styles['tabOn'] : ''}`} onClick={() => { setTab('holdings'); setAll(false); }}>
          Holdings{hidden ? null : count(coins)}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'created'} className={`${styles['tab']} ${tab === 'created' ? styles['tabOn'] : ''}`} onClick={() => { setTab('created'); setAll(false); }}>
          Created{hidden ? null : count(created)}
        </button>
      </div>

      {hidden ? (
        <div className={styles['empty']}><b>Hidden by {at}</b><p>{at} keeps their trades private.</p></div>
      ) : noWallet ? (
        <div className={styles['empty']}><b>No wallet yet</b><p>{at} has no wallet on Insidor yet, so there is nothing to list.</p></div>
      ) : data === null ? (
        <ul className={styles['list']}>{[0, 1, 2, 3].map((i) => <li key={i} className={styles['skeleton']} />)}</ul>
      ) : read === null ? (
        <p className={styles['note']}>— what this wallet holds could not be read just now.</p>
      ) : tab === 'holdings' ? (
        <HoldingRows data={read} early={catches?.kind === 'read' ? catches.early : null} all={all} onAll={() => setAll(true)} self={self} at={at} asOf={asOf} now={now} />
      ) : (
        <CreatedRows coins={read.created.coins} all={all} onAll={() => setAll(true)} self={self} at={at} now={now} />
      )}
    </>
  );
}

type HoldingLine = { readonly kind: 'sol' } | { readonly kind: 'coin'; readonly h: Holding };

function HoldingRows({ data, early, all, onAll, self, at, asOf, now }: { data: Read; early: ReadonlySet<string> | null; all: boolean; onAll: () => void; self: boolean; at: string; asOf: ReadonlyMap<string, number> | null; now: number }) {
  const lines: HoldingLine[] = [{ kind: 'sol' }, ...data.holdings.map((h) => ({ kind: 'coin' as const, h }))];
  const shown = firstRows(lines, all);
  return (
    <>
      <ul className={styles['list']}>
        {shown.rows.map((l) => (l.kind === 'sol' ? <li key="sol"><SolRow data={data} /></li> : <li key={l.h.address}><CoinRow h={l.h} early={early?.has(l.h.address) ?? false} asOf={asOf?.get(l.h.address) ?? null} now={now} /></li>))}
      </ul>
      {shown.more > 0 ? <button type="button" className={styles['showAll']} onClick={onAll}>Show all</button> : null}
      {data.holdings.length === 0 ? (
        <div className={styles['empty']}>
          <b>No coins yet</b>
          <p>{self ? 'Buy a coin from a post and it shows up here.' : `${at} holds no coins yet.`}</p>
        </div>
      ) : null}
      {all && data.notShown > 0 ? <p className={styles['foot']}>{data.notShown.toLocaleString('en-US')} more coins not shown.</p> : null}
      {self && data.holdings.length > 0 ? <p className={styles['foot']}>{gainsNote(data.holdings)}</p> : null}
    </>
  );
}

function SolRow({ data }: { data: Read }) {
  const sol = solValueUsd(data);
  return (
    <div className={styles['row']}>
      <SolMark />
      <div className={styles['mid']}>
        <div className={styles['ticker']}>SOL</div>
        <div className={styles['sub']}>{data.solBalance.known ? data.solBalance.amount.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—'}</div>
      </div>
      <div className={styles['right']}>
        <div className={styles['worth']}>{sol === null ? '—' : <Value r={formatUsd(known(sol))} num />}</div>
        <div className={styles['change']}>{sol === null ? 'Price not read' : 'Cash'}</div>
      </div>
    </div>
  );
}

function CoinRow({ h, early, asOf, now }: { h: Holding; early: boolean; asOf: number | null; now: number }) {
  const ticker = h.ticker === null ? '—' : `$${h.ticker.replace(/^\$/, '')}`;
  const gain = profitLine(h.profit);
  const priced = h.valueUsd.known;
  const reason = noPriceReason(h.valueUsd);
  return (
    <a className={styles['row']} href={hrefFor({ screen: 'token', coinId: h.coinId })} onClick={() => primeSearchedCoin(h)}>
      <CoinLogo small address={h.address} ticker={h.ticker} imageUrl={h.imageUrl} size={LOGO} />
      <div className={styles['mid']}>
        <div className={styles['tickerRow']}>
          <span className={styles['ticker']}>{ticker}</span>
          {early ? <span className={styles['early']}>Early</span> : null}
        </div>
        <div className={styles['sub']}>{compactAmount(h.amount, h.decimals)}</div>
      </div>
      <div className={styles['right']}>
        <div className={styles['worth']} title={priced ? undefined : reason.title}>{priced ? <Value r={formatUsd(h.valueUsd)} num /> : '—'}</div>
        {priced && asOf !== null ? (
          <div className={styles['change']} title="The last price this phone saw; it is read again on the next refresh.">{asOfWords(asOf, now)}</div>
        ) : priced ? (
          <div className={`${styles['change']} ${gain.tone === 'up' ? styles['up'] : gain.tone === 'down' ? styles['down'] : ''}`} title={gain.title}>{gain.text}</div>
        ) : (
          <div className={styles['change']} title={reason.title}>{reason.text}</div>
        )}
      </div>
    </a>
  );
}

function CreatedRows({ coins, all, onAll, self, at, now }: { coins: readonly CreatedCoin[]; all: boolean; onAll: () => void; self: boolean; at: string; now: number }) {
  if (coins.length === 0) {
    return (
      <div className={styles['empty']}>
        <b>No coins created yet</b>
        <p>{self ? 'Coins you launch on Insidor show up here.' : `${at} hasn't launched a coin on Insidor yet.`}</p>
      </div>
    );
  }
  const shown = firstRows(coins, all);
  return (
    <>
      <ul className={styles['list']}>
        {shown.rows.map((c) => (
          <li key={c.address}>
            <a className={styles['row']} href={hrefFor({ screen: 'token', coinId: c.coinId })}>
              <CoinLogo small address={c.address} ticker={c.ticker} size={LOGO} />
              <div className={styles['mid']}>
                <div className={styles['tickerRow']}>
                  <span className={styles['ticker']}>{c.ticker === null ? '—' : `$${c.ticker.replace(/^\$/, '')}`}</span>
                  {c.fromCatch ? <span className={styles['tag']}>From a catch</span> : null}
                  {c.graduated === true ? <span className={styles['tag']}>Graduated</span> : null}
                </div>
                <div className={styles['subWords']}>{launchedWords(c.launchedAt, now)}</div>
              </div>
              <div className={styles['right']}>
                <div className={styles['worth']}>{c.marketCapUsd.known ? <Value r={formatUsd(c.marketCapUsd)} num /> : '—'}</div>
                <div className={styles['capLabel']}>{c.marketCapUsd.known ? 'market cap' : noPriceReason(c.marketCapUsd).text}</div>
              </div>
            </a>
          </li>
        ))}
      </ul>
      {shown.more > 0 ? <button type="button" className={styles['showAll']} onClick={onAll}>Show all</button> : null}
    </>
  );
}

/** SOL's own mark, drawn here so no picture is fetched for it. */
function SolMark() {
  return (
    <svg width={LOGO} height={LOGO} viewBox="0 0 38 38" aria-hidden="true" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="profile-sol-mark" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <circle cx="19" cy="19" r="19" fill="#141418" />
      <g fill="url(#profile-sol-mark)">
        <path d="M12.5 23.6h12.6l-2.6 2.6H9.9z" />
        <path d="M12.5 11.8h12.6l-2.6 2.6H9.9z" />
        <path d="M25.1 17.7H12.5l-2.6 2.6h12.6z" transform="matrix(-1 0 0 1 35 0)" />
      </g>
    </svg>
  );
}

/* ── sharing ────────────────────────────────────────────────────────── */

/** The phone's share sheet with the profile's link, or the link copied where there is none. */
export async function shareProfile(key: string, name: string): Promise<'shared' | 'copied' | 'failed'> {
  const url = `${location.origin}${location.pathname}${hrefFor({ screen: 'profile', key })}`;
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title: `${name} on Insidor`, url });
      return 'shared';
    }
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch (e) {
    /* Closing the share sheet is not a failure worth a toast. */
    return e instanceof DOMException && e.name === 'AbortError' ? 'shared' : 'failed';
  }
}

export function ShareGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="M7 8l5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

/** Three dots in a row, drawn: the more menu's mark (a typed dot character is refused, screen-rules.test.ts). */
export function MoreGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

export { styles as profileStyles };
