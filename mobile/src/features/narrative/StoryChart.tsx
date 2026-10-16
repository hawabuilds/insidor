/**
 * THE NARRATIVE'S VIEWS CHART — the post sheet's chart (features/post-sheet ViewsChart.tsx: 1m to 1D,
 * Total or Gained, tap to read, Found and Coin markers, the dashed stretch, gaps kept) drawn over the
 * narrative's total views, with each post as a dot at the time it went up (a tap opens that post) and,
 * behind the MC switch, the coin's market cap on its own axis.
 *
 * Its own file because it owns the two things the post sheet's chart does not: the total, which is
 * story-views.ts's rule and nothing else (a moment where any post's views are unknown is a break,
 * never a sum with a hole in it), and the market read for the MC line, which happens only while the
 * switch is on, at the chart's interval, once per interval. The total arrives from the page: the
 * projector's `viewsSeries` (summed under that rule from every post's readings, every ten minutes)
 * when it sends one, else the phone's sum of the readings its feed cards carry.
 *
 * ★ WHEN THE TOTAL CANNOT BE DRAWN AT ALL it says why in words, with how many posts we have no
 * readings for, rather than drawing a partial sum. The dots and markers need no total and are
 * still meaningful, but a chart with no line would look like a narrative nobody watched.
 *
 * ★ THE MC LINE IS PRICE TIMES THE LAUNCHPAD'S SUPPLY, only for a coin whose supply we know
 * (shared/coin-cap.ts `knownSupply`), the same rule every cap in the app follows. Any other coin
 * says why there is no line.
 *
 * What breaks if changed carelessly: reading the market while the switch is off costs a market call
 * for every narrative page opened, for a line nobody asked to see.
 */

import { useEffect, useMemo, useState } from 'react';

import { fetchCoinMarket, type SheetCoin, type StoryMember } from '../../shared/api/index.ts';
import { capAtPrice, knownSupply } from '../../shared/coin-cap.ts';
import { tickerText } from '../../shared/format/ticker.ts';
import { ViewsChart, type McLine } from '../post-sheet/index.ts';
import type { Interval } from '../post-sheet/index.ts';
import { storyTotal, type StoryTotal } from './story-views.ts';
import styles from './narrative.module.css';

/** The chart opens on this interval: a narrative spans hours, not minutes. */
const FIRST_INTERVAL: Interval = '15m';

export function StoryChart({ members, total, foundAt, coin, coinAt, now, onPost }: {
  members: readonly StoryMember[];
  total: StoryTotal;
  foundAt: number | null;
  /** The narrative's own coin, for the MC line; null: no switch. */
  coin: SheetCoin | null;
  /** The coin marker: the narrative's coin's launch. */
  coinAt: number | null;
  now: number;
  onPost: (m: StoryMember) => void;
}) {
  const [interval, setIntervalPick] = useState<Interval>(FIRST_INTERVAL);
  const [mcOn, setMcOn] = useState(false);
  const label = coin === null ? '' : `${tickerText(coin.ticker ?? coin.name ?? coin.address.slice(0, 4))} market cap`;
  const [mc, setMc] = useState<Omit<McLine, 'label'>>({ points: null, why: null });

  const first = useMemo(() => {
    const times = members.flatMap((m) => (m.postedAt.known ? [m.postedAt.at] : []));
    return times.length === 0 ? null : Math.min(...times);
  }, [members]);
  const dots = useMemo(() => members.flatMap((m) => (m.postedAt.known ? [{ id: m.id, at: m.postedAt.at }] : [])), [members]);
  const readings = useMemo(() => total.points.map((p) => ({ atMs: p.atMs, value: p.value })), [total]);

  /* The market, only while the switch is on, at the chart's interval. */
  useEffect(() => {
    if (!mcOn || coin === null) return;
    if (!knownSupply(coin.address)) {
      setMc({ points: [], why: 'No market cap line: this coin\'s supply is not known' });
      return;
    }
    const ac = new AbortController();
    setMc({ points: null, why: null });
    fetchCoinMarket(`solana:${coin.address}`, interval, ac.signal).then(
      (m) => {
        if (m.kind !== 'read' || m.candles === null) setMc({ points: [], why: 'The market could not be read just now' });
        else if (m.candles.length === 0) setMc({ points: [], why: 'No trades yet' });
        else setMc({ points: m.candles.filter((c) => c.c > 0).map((c) => ({ at: c.t, value: capAtPrice(c.c) })), why: 'No trades in this span' });
      },
      () => {
        if (!ac.signal.aborted) setMc({ points: [], why: 'The market could not be read just now' });
      },
    );
    return () => ac.abort();
  }, [mcOn, coin, interval]);

  if (total.points.length === 0) {
    return (
      <p className={styles['chartNote']}>
        {total.neverRead > 0
          ? `We have no view readings for ${total.neverRead === 1 ? '1 post' : `${total.neverRead} posts`} in this narrative, so its total over time can't be added up yet.`
          : "We haven't read every post's views at the same time yet, so the total over time can't be added up."}
      </p>
    );
  }

  const byId = new Map(members.map((m) => [m.id, m] as const));
  return (
    <div className={styles['chartBox']}>
      <ViewsChart
        readings={readings}
        postedAt={first}
        foundAt={foundAt}
        coinAt={coinAt}
        now={now}
        height={150}
        breaks={total.breaks}
        beforeLabel="before every post was read"
        postedWord="first post"
        dots={dots}
        onDot={(id) => {
          const m = byId.get(id);
          if (m !== undefined) onPost(m);
        }}
        {...(coin !== null ? { mc: { ...mc, label }, onMc: setMcOn } : {})}
        onInterval={setIntervalPick}
        startInterval={FIRST_INTERVAL}
      />
      {total.unknownNow > 0 || total.breaks.length > 0 ? (
        <p className={styles['chartFoot']}>
          The line breaks where some post's views are unknown: a total that leaves a post out isn't drawn.
        </p>
      ) : null}
    </div>
  );
}

/** The narrative's total, from its posts' readings: story-views.ts's rule. */
export function useStoryTotal(members: readonly StoryMember[], now: number): StoryTotal {
  /* Recomputed when the posts change, and once a minute as now moves (the "unknown now" count). */
  const minute = Math.floor(now / 60_000);
  return useMemo(
    () => storyTotal(members.map((m) => ({ id: m.id, postedAt: m.postedAt.known ? m.postedAt.at : null, readings: m.views })), minute * 60_000),
    [members, minute],
  );
}
