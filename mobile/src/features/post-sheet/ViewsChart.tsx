/**
 * THE POST'S VIEWS CHART, as the token page's price chart works: the interval rail (1m 5m 15m 1h
 * 4h 1D, the token page's own buttons) and a two-way switch where the token page has line or
 * candles, here Total (views so far, a line) or Gained (views gained per interval, bars, as a coin
 * chart's volume). The span is always from posting to now; the interval sets how finely it is cut.
 *
 * Every mark comes from `views-chart.ts viewsPlan`, which owns the rules: no reading is invented,
 * a gap in our readings is a gap, the stretch before our first count is a labelled dashed line
 * from 0, and a bar exists only where two readings close enough say it. With nothing to draw in
 * the chosen view a line says why, in the chart's place.
 *
 * Found and Coin sit at their exact times, the same instants as the "Found 1h" and "Coin 1h" tags
 * above, as pills over dashed lines. A tap or a drag on the plot shows the time and views of the
 * nearest drawn reading, or the bar under the finger, with its real span ("+6.7K in 9m").
 *
 * Drawn in real pixels (the plot's width is measured), not a stretched viewBox, so dashes, bars
 * and dots keep their shape at any phone width. `data-no-swipe` keeps a drag on the plot from
 * pulling the sheet closed.
 *
 * THE NARRATIVE PAGE DRAWS THE SAME CHART (features/narrative/StoryChart.tsx) with four optional
 * extras the post sheet does not pass: `breaks` (moments its total could not be added up, which
 * break the line and bars as a gap in readings does), `dots` (each post at the time it went up, in a
 * lane along the bottom; a tap on one opens that post), `mc` (a coin's market cap line on its own
 * right-hand axis, behind a toggle that starts off; `onMc` says when it is turned on so the caller
 * reads the market only then) and `onInterval` (so that reading is at the chart's interval).
 *
 * What breaks if changed carelessly: the pills and the axis are laid out against the measured
 * width. Before the first measure the plot draws nothing rather than at a guessed width.
 */

import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';

import { compact } from '../../shared/format/number.ts';
import type { Reading } from './sheet-view.ts';
import { INTERVALS, INTERVAL_MS, cleanTicks, clockText, nearestBar, nearestPoint, spanText, viewsPlan, type Interval, type ViewsMode, type ViewsPlan } from './views-chart.ts';
import styles from './post-sheet.module.css';

/** A post in the dot lane: when it went up, and what a tap opens. */
export interface ChartDot {
  readonly id: string;
  readonly at: number;
}

/** The coin's market cap line: its points, or why there are none (null points while reading). */
export interface McLine {
  readonly points: readonly { readonly at: number; readonly value: number }[] | null;
  readonly why: string | null;
  /** Whose cap it is, said over the line while it shows ("$KAYLUB market cap"). */
  readonly label: string;
}

/** Two candles further apart than this many of the closest pair's spacing are not joined. */
const MC_JOIN = 3;
/** How near, in px, a tap must be to a dot to open its post. */
const DOT_HIT = 12;
/** The dot lane's height at the bottom of the plot. */
const DOT_LANE = 14;

/** A pill's width, estimated from its text at 12px bold: for keeping two pills apart before they render. */
const PILL_CHAR = 7;
const PILL_PAD = 16;
const PILL_GAP = 6;
/** Breathing room above the highest tick, so the newest dot is never cut. */
const TOP_ROOM = 6;
const HOUR = 3_600_000;
/** The row the Found and Coin pills sit in, above the plot. */
const PILL_ROW = 26;

export function ViewsChart({ readings, postedAt, foundAt, coinAt, now, height, breaks, beforeLabel, postedWord = 'posted', dots, onDot, mc, onMc, onInterval, startInterval = '1m' }: {
  readings: readonly Reading[];
  postedAt: number | null;
  foundAt: number | null;
  coinAt: number | null;
  now: number;
  /** The plot's own height, in px; the rail, the pills and the times are on top of it. */
  height: number;
  breaks?: readonly number[];
  beforeLabel?: string;
  /** The word after the first time: "posted", or "first post". */
  postedWord?: string;
  dots?: readonly ChartDot[];
  onDot?: (id: string) => void;
  /** Present: the MC toggle is drawn. */
  mc?: McLine;
  onMc?: (on: boolean) => void;
  onInterval?: (interval: Interval) => void;
  startInterval?: Interval;
}) {
  const [interval, setIntervalPick] = useState<Interval>(startInterval);
  const [mode, setMode] = useState<ViewsMode>('total');
  const [mcOn, setMcOn] = useState(false);
  const [finger, setFinger] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = plotRef.current;
    if (el === null) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plan = useMemo(
    () => viewsPlan(readings, postedAt, now, interval, mode, { found: foundAt, coin: coinAt }, { ...(breaks !== undefined ? { breaks } : {}), ...(beforeLabel !== undefined ? { beforeLabel } : {}) }),
    [readings, postedAt, now, interval, mode, foundAt, coinAt, breaks, beforeLabel],
  );
  if (plan === null) return null;

  const pick = (next: () => void) => {
    setFinger(null);
    next();
  };
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setFinger(plan.from + f * (plan.to - plan.from));
  };
  /* A tap in the dot lane near a post's dot opens that post; anywhere else reads the chart. */
  const dotUnder = (e: PointerEvent<HTMLDivElement>): ChartDot | null => {
    if (dots === undefined || onDot === undefined || width === 0) return null;
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientY - r.top < height - DOT_LANE - DOT_HIT) return null;
    const px = e.clientX - r.left;
    let best: ChartDot | null = null;
    let d = DOT_HIT;
    for (const dot of dots) {
      const dx = Math.abs(((dot.at - plan.from) / (plan.to - plan.from)) * width - px);
      if (dx <= d) {
        d = dx;
        best = dot;
      }
    }
    return best;
  };
  const long = plan.to - plan.from > 20 * HOUR;
  /* Only the candles inside the chart's span, so a spike from before it cannot set the axis. */
  const mcInside = mcOn && mc !== undefined && mc.points !== null ? mc.points.filter((p) => p.at >= plan.from && p.at <= plan.to) : [];
  const mcShown = mcInside.length > 1 ? mcInside : null;
  const mcTicks = mcShown === null ? null : cleanTicks(0, Math.max(...mcShown.map((p) => p.value)));

  return (
    <div className={styles['chart']}>
      <div className={styles['rail']}>
        <div className={styles['intervals']} role="group" aria-label="Chart interval">
          {INTERVALS.map((t) => (
            <button key={t} type="button" aria-pressed={t === interval} className={`${styles['interval']} ${t === interval ? styles['intervalOn'] : ''}`} onClick={() => pick(() => {
              setIntervalPick(t);
              onInterval?.(t);
            })}>
              {t}
            </button>
          ))}
        </div>
        <div className={styles['modes']} role="group" aria-label="Chart view">
          <button type="button" className={mode === 'total' ? styles['modeOn'] : ''} aria-pressed={mode === 'total'} onClick={() => pick(() => setMode('total'))}>Total</button>
          <button type="button" className={mode === 'gained' ? styles['modeOn'] : ''} aria-pressed={mode === 'gained'} onClick={() => pick(() => setMode('gained'))}>Gained</button>
        </div>
      </div>

      <div className={styles['chartRow']}>
        <div className={styles['plotArea']}>
          <Pills plan={plan} width={width} long={long} />
          <div
            ref={plotRef}
            className={styles['plot']}
            style={{ height }}
            data-no-swipe
            onPointerDown={(e) => {
              const dot = dotUnder(e);
              if (dot !== null) {
                onDot?.(dot.id);
                return;
              }
              e.currentTarget.setPointerCapture(e.pointerId);
              at(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons !== 0 || e.pointerType !== 'mouse') at(e);
            }}
          >
            {width > 0 ? <Plot plan={plan} mode={mode} width={width} height={height} finger={finger} interval={interval} long={long} dots={dots ?? []} mc={mcShown} mcTicks={mcTicks} /> : null}
            {width > 0 && mcOn && mc !== undefined ? <span className={styles['mcNote']}>{mcShown !== null ? mc.label : mc.points === null ? 'Reading the market cap' : (mc.why ?? 'No market cap to draw')}</span> : null}
          </div>
        </div>
        <div className={styles['axis']} style={{ height, marginTop: PILL_ROW }} aria-hidden="true">
          {/* With the MC line on, the right axis is the coin's; the views' steps sit inside the plot. */}
          {mcTicks !== null
            ? [...mcTicks].reverse().map((t, i, all) => (
                <span key={t} className={styles['mcAxis']} style={{ top: `${(i / (all.length - 1)) * 100}%` }}>${compact(t)}</span>
              ))
            : mode === 'gained' && plan.bars.length === 0 ? null : [...plan.ticks].reverse().map((t, i, all) => (
                <span key={t} style={{ top: `${(i / (all.length - 1)) * 100}%` }}>{compact(t)}</span>
              ))}
        </div>
      </div>
      <div className={styles['times']} aria-hidden="true">
        <span>{clockText(plan.from, long)}{plan.fromPosted ? ` ${postedWord}` : ''}</span>
        <span>{clockText(plan.from + (plan.to - plan.from) / 2, long)}</span>
        <span>Now</span>
      </div>
      {/* Under the chart, not on the rail: six intervals and the switch already fill a phone's row. */}
      {mc !== undefined ? (
        <div className={styles['mcRow']}>
          <button type="button" aria-pressed={mcOn} className={`${styles['mcToggle']} ${mcOn ? styles['mcOn'] : ''}`} onClick={() => pick(() => {
            setMcOn(!mcOn);
            onMc?.(!mcOn);
          })}>
            {mcOn ? 'Hide market cap' : 'Show market cap'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Pills({ plan, width, long }: { plan: ViewsPlan; width: number; long: boolean }) {
  if (width === 0) return <div className={styles['pills']} style={{ height: PILL_ROW }} />;
  const x = (t: number) => ((t - plan.from) / (plan.to - plan.from)) * width;
  const laid: { kind: 'found' | 'coin'; text: string; left: number; w: number }[] = [];
  for (const m of [...plan.markers].sort((a, b) => a.at - b.at)) {
    const text = `${m.kind === 'found' ? 'Found' : 'Coin'} ${clockText(m.at, long)}`;
    const w = text.length * PILL_CHAR + PILL_PAD;
    let left = Math.min(Math.max(0, x(m.at) - w / 2), width - w);
    const prev = laid[laid.length - 1];
    if (prev !== undefined && left < prev.left + prev.w + PILL_GAP) {
      left = prev.left + prev.w + PILL_GAP;
      /* No room on the right: the earlier pill steps left instead. */
      if (left + w > width) {
        left = width - w;
        prev.left = Math.max(0, left - PILL_GAP - prev.w);
      }
    }
    laid.push({ kind: m.kind, text, left, w });
  }
  return (
    <div className={styles['pills']} style={{ height: PILL_ROW }}>
      {laid.map((p) => (
        <span key={p.kind} className={p.kind === 'found' ? styles['pillFound'] : styles['pillCoin']} style={{ left: p.left }}>{p.text}</span>
      ))}
    </div>
  );
}

function Plot({ plan, mode, width, height, finger, interval, long, dots, mc, mcTicks }: {
  plan: ViewsPlan;
  mode: ViewsMode;
  width: number;
  height: number;
  finger: number | null;
  interval: Interval;
  long: boolean;
  dots: readonly ChartDot[];
  mc: readonly { readonly at: number; readonly value: number }[] | null;
  mcTicks: readonly number[] | null;
}) {
  const lo = plan.ticks[0] ?? 0;
  const hi = plan.ticks[plan.ticks.length - 1] ?? 1;
  /* With the coin's line on its axis, the views' steps are said inside the plot, at the left. */
  const viewsInside = mcTicks !== null && !(mode === 'gained' && plan.bars.length === 0);
  const x = (t: number) => ((t - plan.from) / (plan.to - plan.from)) * width;
  const y = (v: number) => TOP_ROOM + (height - TOP_ROOM) * (1 - (v - lo) / (hi - lo));
  const fmt = (n: number) => n.toFixed(1);
  const line = (pts: readonly { at: number; value: number }[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(x(p.at))} ${fmt(y(p.value))}`).join(' ');

  const point = finger !== null && mode === 'total' ? nearestPoint(plan, finger) : null;
  const bar = finger !== null && mode === 'gained' ? nearestBar(plan, finger) : null;
  const tip = point !== null
    ? { x: x(point.at), y: y(point.value), time: clockText(point.at, long), text: `${compact(point.value)} views` }
    : bar !== null
      ? { x: x(bar.start) + Math.max(1, (INTERVAL_MS[interval] / (plan.to - plan.from)) * width) / 2, y: y(Math.max(0, bar.gain)), time: clockText(bar.toAt, long), text: `${bar.gain >= 0 ? '+' : ''}${compact(bar.gain)} in ${spanText(bar.toAt - bar.fromAt)}` }
      : null;
  const slotW = (INTERVAL_MS[interval] / (plan.to - plan.from)) * width;
  const barW = Math.max(1, slotW > 5 ? slotW - 2 : slotW);
  const empty = mode === 'gained' && plan.bars.length === 0;

  return (
    <>
      <svg className={styles['plotSvg']} width={width} height={height} aria-hidden="true">
        <defs>
          <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9945FF" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#9945FF" stopOpacity="0" />
          </linearGradient>
        </defs>
        {plan.ticks.map((t) => (
          <line key={t} x1="0" x2={width} y1={y(t)} y2={y(t)} className={styles['grid']} />
        ))}
        {plan.markers.map((m) => (
          <line key={m.kind} x1={x(m.at)} x2={x(m.at)} y1={0} y2={height} className={m.kind === 'found' ? styles['markFound'] : styles['markCoin']} />
        ))}
        {plan.before !== null ? (
          mode === 'total'
            ? <path d={line([plan.before.from, plan.before.to])} className={styles['before']} />
            : <line x1={x(plan.before.from.at)} x2={x(plan.before.to.at)} y1={y(0)} y2={y(0)} className={styles['before']} />
        ) : null}
        {mode === 'total'
          ? plan.runs.map((run) => (
              <g key={run[0]?.at}>
                {run.length > 1 ? <path d={`${line(run)} L${fmt(x(run[run.length - 1]?.at ?? 0))} ${fmt(y(lo))} L${fmt(x(run[0]?.at ?? 0))} ${fmt(y(lo))} Z`} fill="url(#viewsFill)" /> : null}
                {run.length > 1 ? <path d={line(run)} className={styles['line']} /> : <circle cx={x(run[0]?.at ?? 0)} cy={y(run[0]?.value ?? 0)} r={2.5} className={styles['lone']} />}
              </g>
            ))
          : plan.bars.map((b) => (
              <rect
                key={b.start}
                x={x(b.start) + (slotW > 5 ? 1 : 0)}
                y={y(Math.max(0, b.gain))}
                width={Math.max(1, Math.min(barW, x(plan.to) - x(b.start) - (slotW > 5 ? 1 : 0)))}
                height={Math.max(1, Math.abs(y(b.gain) - y(0)))}
                rx={slotW > 8 ? 2 : 0}
                className={b.gain >= 0 ? styles['bar'] : styles['barDown']}
                opacity={bar !== null && bar.start !== b.start ? 0.55 : 1}
              />
            ))}
        {mode === 'total' ? <circle cx={x(plan.last.at)} cy={y(plan.last.value)} r={5} className={styles['lastDot']} /> : null}
        {mc !== null && mcTicks !== null ? <McPath points={mc} ticks={mcTicks} x={x} height={height} from={plan.from} to={plan.to} /> : null}
        {dots.filter((d) => d.at >= plan.from && d.at <= plan.to).map((d) => (
          <circle key={d.id} cx={x(d.at)} cy={height - DOT_LANE / 2} r={4} className={styles['postDot']} />
        ))}
        {tip !== null ? (
          <>
            <line x1={tip.x} x2={tip.x} y1={0} y2={height} className={styles['cross']} />
            {point !== null ? <circle cx={tip.x} cy={tip.y} r={4} className={styles['tipDot']} /> : null}
          </>
        ) : null}
      </svg>
      {plan.before !== null && x(plan.before.to.at) > 2 ? (
        <span className={styles['beforeLabel']}>
          <svg width="18" height="2" aria-hidden="true"><line x1="0" x2="18" y1="1" y2="1" className={styles['before']} /></svg>
          {plan.before.label}
        </span>
      ) : null}
      {empty && plan.noBars !== null ? <span className={styles['plotNote']}>{plan.noBars}</span> : null}
      {viewsInside ? plan.ticks.slice(1).map((t) => (
        <span key={t} className={styles['insideTick']} style={{ top: y(t) + 2 }}>{compact(t)}</span>
      )) : null}
      {tip !== null ? (
        <span
          className={styles['tip']}
          /* Beside the point, on whichever side has more room, so it never runs off the plot. */
          style={{ ...(tip.x > width / 2 ? { right: width - tip.x + 8 } : { left: tip.x + 8 }), top: Math.max(0, Math.min(tip.y - 27, height - 54)) }}
        >
          <span className={styles['tipTime']}>{tip.time}</span>
          <b>{tip.text}</b>
        </span>
      ) : null}
    </>
  );
}

/**
 * The coin's market cap on its own scale (the right axis): only the candles inside the chart's span,
 * joined where they are neighbours. A stretch with no candle (no trades then) is a gap, as for views.
 */
function McPath({ points, ticks, x, height, from, to }: {
  points: readonly { readonly at: number; readonly value: number }[];
  ticks: readonly number[];
  x: (t: number) => number;
  height: number;
  from: number;
  to: number;
}) {
  const hi = ticks[ticks.length - 1] ?? 1;
  const y = (v: number) => TOP_ROOM + (height - TOP_ROOM) * (1 - v / hi);
  const inside = points.filter((p) => p.at >= from && p.at <= to).sort((a, b) => a.at - b.at);
  const steps = inside.slice(1).map((p, i) => p.at - (inside[i]?.at ?? p.at)).filter((s) => s > 0);
  const spacing = steps.length > 0 ? Math.min(...steps) : 0;
  let d = '';
  inside.forEach((p, i) => {
    const prev = inside[i - 1];
    const join = prev !== undefined && p.at - prev.at <= MC_JOIN * spacing;
    d += `${join ? 'L' : 'M'}${x(p.at).toFixed(1)} ${y(p.value).toFixed(1)} `;
  });
  return <path d={d} className={styles['mcLine']} />;
}
