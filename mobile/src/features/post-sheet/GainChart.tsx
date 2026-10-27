/**
 * THE VIEWS-GAINED CHART — the one chart on the narrative page and the post sheet (the owner's
 * design, 2026-10-17): views gained per interval as one smooth purple line with a faint glow and a
 * fade under it to nothing, the newest value at the line's end, the Found and coin markers as dashed
 * lines with pills at their exact times, three times along the bottom (the first one saying when the
 * first post went up), and the 5m 15m 1h 4h 1D rail under it (the narrative page adds All: the whole
 * story from its first post, drawn from the projector's coarser series).
 *
 * ★ TOTAL VIEWS, WITH ITS NUMBERS ON IT (the owner, 2026-10-27: "we want to see total views chart, isn't
 * that the most similar to market cap"; and "lacking axis labelling and showing actual values"): the
 * running total ending on the real count, the views on the right in round steps with faint gridlines,
 * and a finger on it reads the total then and that interval's gain. A dashed rise from 0 covers the
 * time from the post going up to our first reading. Still
 * no market cap line and no bars: market cap is a fact in the line above the chart and the full price
 * chart is the token page's. The numbers
 * and the rules (which buckets, which gaps, which times) are gain-chart.ts's; this file only draws.
 *
 * Drawn in real pixels against the measured width, so dashes and the line keep their shape at any
 * phone width; before the first measure it draws nothing rather than at a guessed width. The
 * interval is the caller's (the fact line above follows it).
 *
 * What breaks if changed carelessly: the marker x is the marker's own instant on the time axis. A
 * marker snapped to a bucket would move the proof of who was first by up to a whole interval.
 */

import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { compact } from '../../shared/format/number.ts';
import { GAIN_INTERVALS, GAIN_INTERVAL_MS, allBucketMs, axisTicks, buckets, hm, placePills, plus, smoothPath, spanLabel, totalSeries, type ChartInterval, type GainSlots } from './gain-chart.ts';
import styles from './gain-chart.module.css';

const DAY = 86_400_000;
/** Room on the right for the views axis. */
const END_ROOM = 44;
const PILL_ROW = 26;
/** A time label's character width at its 12px, and the least room between two labels. */
const LABEL_CHAR = 6.6;
const LABEL_GAP = 12;
/** Space above the highest point, so the glow is never cut. */
const TOP_ROOM = 8;

export interface ChartMarker {
  readonly key: string;
  readonly tone: 'found' | 'coin';
  readonly text: string;
  /** Its instant; null for a launch whose time is not known (a pill, no line). */
  readonly at: number | null;
}

export function GainChart({ slots, allSlots = null, total = null, intervals = GAIN_INTERVALS, firstAt, firstWord, now, interval, onInterval, markers, height, rail = true }: {
  slots: GainSlots;
  /** The real views now (the post's newest reading, the narrative's total): the line ends on it. Null: the line shows the growth from 0. */
  total?: number | null;
  /** The whole story's coarser slots, drawn on "All"; null: "All" draws `slots` from the first post. */
  allSlots?: GainSlots | null;
  /** The rail's intervals: the narrative page adds "All". */
  intervals?: readonly ChartInterval[];
  /** When the first post went up (the post, on the sheet); null when not known. */
  firstAt: number | null;
  /** "first post" or "posted". */
  firstWord: string;
  now: number;
  interval: ChartInterval;
  onInterval: (i: ChartInterval) => void;
  markers: readonly ChartMarker[];
  height: number;
  /** False on the post sheet, which has one interval and no room for the times and the rail. */
  rail?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  /* The interval under the finger, while it is on the chart. */
  const [scrubAt, setScrubAt] = useState<number | null>(null);
  const glow = useId().replace(/:/g, '');
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* "All": the whole story, from its first post (or its first reading) to now, no day cap. */
  const all = interval === 'All';
  const series = all && allSlots !== null && allSlots.values.length > 0 ? allSlots : slots;
  const end = series.fromMs + series.values.length * series.stepMs;
  /* The span: from the first post (the five-minute slots carry at most a day), to the newest slot. */
  const from = Math.min(end - series.stepMs, all ? (firstAt ?? series.fromMs) : Math.max(firstAt ?? series.fromMs, end - DAY));
  const fromIsPost = firstAt !== null && from === firstAt;
  const bucketMs = all ? allBucketMs(end - from, series.stepMs) : GAIN_INTERVAL_MS[interval];
  const shown = useMemo(() => buckets(series, bucketMs, from), [series, bucketMs, from]);
  const plotW = Math.max(0, width - END_ROOM);
  const x = (t: number) => (end <= from ? 0 : ((Math.min(Math.max(t, from), end) - from) / (end - from)) * plotW);

  const pills = placePills(
    markers.map((m) => ({ key: m.key, text: m.text, x: m.at === null ? null : x(m.at) })),
    width,
  );
  const rows = pills.length === 0 ? 0 : Math.max(...pills.map((p) => p.row)) + 1;
  const top = rows * PILL_ROW;
  const plotH = height;
  /* ★ TOTAL VIEWS, LIKE A MARKET CAP LINE (the owner, 2026-10-27): the running total, ending on the
     real count; a dashed rise from 0 at the post's own time to our first reading, so the chart starts
     at its left edge and the stretch before we found it is plainly drawn as not read. */
  const totals = useMemo(() => totalSeries(shown, total), [shown, total]);
  const axis = axisTicks(Math.max(1, ...totals.points.map((p) => p.v)));
  const max = axis.top;
  const y = (v: number) => top + TOP_ROOM + (plotH - TOP_ROOM) * (1 - v / max);
  const span = spanLabel(bucketMs);
  /* The point nearest the finger. */
  const scrubbed = scrubAt === null ? null : totals.points.reduce<(typeof totals.points)[number] | null>((best, p) => (best === null || Math.abs(x(p.t) - scrubAt) < Math.abs(x(best.t) - scrubAt) ? p : best), null);
  const scrubTo = (clientX: number) => {
    const el = ref.current;
    if (el === null) return;
    setScrubAt(Math.max(0, Math.min(plotW, clientX - el.getBoundingClientRect().left)));
  };
  const base = top + plotH;

  /* One line: the total where our first read bucket begins, then at each bucket's end. */
  const line = totals.start === null ? [] : [{ x: x(totals.start.t), y: y(totals.start.v) }, ...totals.points.map((p) => ({ x: x(p.t), y: y(p.v) }))];
  /* Before our first reading, from the post's own time at 0 views: dashed, never a reading. */
  const lead = fromIsPost && totals.start !== null && totals.start.t > from ? { x1: x(from), y1: y(0), x2: x(totals.start.t), y2: y(totals.start.v) } : null;
  const counted = totals.points.length;
  const mid = from + (end - from) / 2;
  /* The middle time only where it clears the first one ("Thu 14:01 first post" is long on All). */
  const startText = `${hm(from, now)}${fromIsPost ? ` ${firstWord}` : ''}`;
  const midText = hm(mid, now);
  const midFits = x(mid) - (midText.length * LABEL_CHAR) / 2 > startText.length * LABEL_CHAR + LABEL_GAP;

  return (
    <div className={styles['chart']}>
      <div className={styles['readout']} aria-live="polite">
        {scrubbed !== null ? (
          <>{hm(scrubbed.t, now)}: <b>{compact(scrubbed.v)} views</b>{scrubbed.gain !== null ? `, ${plus(scrubbed.gain)} in ${span}` : ''}</>
        ) : (
          <>Total views</>
        )}
      </div>
      <div
        ref={ref}
        className={styles['plot']}
        style={{ height: top + plotH }}
        onPointerDown={(e) => scrubTo(e.clientX)}
        onPointerMove={(e) => {
          if (scrubAt !== null || e.pointerType === 'mouse') scrubTo(e.clientX);
        }}
        onPointerUp={() => setScrubAt(null)}
        onPointerCancel={() => setScrubAt(null)}
        onPointerLeave={() => setScrubAt(null)}
      >
        {width > 0 ? (
          <>
            <svg width={width} height={top + plotH} className={styles['svg']} aria-hidden="true">
              <defs>
                <linearGradient id={`${glow}f`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#B48CFF" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="#B48CFF" stopOpacity="0" />
                </linearGradient>
                <filter id={`${glow}g`} x="-10%" y="-30%" width="120%" height="160%">
                  <feGaussianBlur stdDeviation="3" />
                </filter>
              </defs>
              {axis.ticks.map((t) => (
                <line key={`g${t}`} x1={0} x2={plotW} y1={y(t)} y2={y(t)} className={styles['grid']} />
              ))}
              {pills.map((p) => {
                const m = markers.find((k) => k.key === p.key);
                /* A line only inside the span: a time before it is said by its pill alone, never drawn at the edge. */
                if (m === undefined || m.at === null || p.x === null || m.at < from || m.at > end) return null;
                return <line key={p.key} x1={p.x} x2={p.x} y1={p.row * PILL_ROW + PILL_ROW - 4} y2={base} className={m.tone === 'coin' ? styles['coinLine'] : styles['foundLine']} />;
              })}
              {lead !== null ? <line x1={lead.x1} y1={lead.y1} x2={lead.x2} y2={lead.y2} className={styles['lead']} /> : null}
              {line.length > 1 ? (() => {
                const d = smoothPath(line);
                const a = line[0] as { x: number; y: number };
                const z = line[line.length - 1] as { x: number; y: number };
                return (
                  <g>
                    <path d={`${d}L${z.x.toFixed(1)},${base}L${a.x.toFixed(1)},${base}Z`} fill={`url(#${glow}f)`} />
                    <path d={d} className={styles['glow']} filter={`url(#${glow}g)`} />
                    <path d={d} className={styles['line']} />
                  </g>
                );
              })() : null}
              {scrubbed !== null ? (
                <g>
                  <line x1={x(scrubbed.t)} x2={x(scrubbed.t)} y1={top} y2={base} className={styles['scrubLine']} />
                  <circle cx={x(scrubbed.t)} cy={y(scrubbed.v)} r={3.5} className={styles['scrubDot']} />
                </g>
              ) : null}
            </svg>
            {axis.ticks.map((t) => (
              <span key={`a${t}`} className={styles['axis']} style={{ left: plotW + 6, top: y(t) - 8 }}>{t === 0 ? '0' : compact(t)}</span>
            ))}
            {pills.map((p) => {
              const m = markers.find((k) => k.key === p.key);
              return (
                <span key={p.key} className={`${styles['pill']} ${m?.tone === 'coin' ? styles['pillCoin'] : styles['pillFound']}`} style={{ left: p.left, top: p.row * PILL_ROW }}>
                  {p.text}
                </span>
              );
            })}
            {counted < 2 ? (
              <span className={styles['few']} style={{ top: top + plotH / 2 - 9 }}>
                {counted === 0 ? 'No views read in this span yet' : all ? 'Less than two readings so far' : `Less than two ${interval} intervals so far`}
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      {width > 0 ? (
      <div className={styles['times']} style={{ width: plotW }}>
        <span>{startText}</span>
        {midFits ? <span className={styles['mid']} style={{ left: x(mid) }}>{midText}</span> : null}
        <span>{hm(end, now)}</span>
      </div>
      ) : null}
      {rail ? (
      <div className={styles['rail']} role="group" aria-label="Chart interval">
        {intervals.map((i) => (
          <button key={i} type="button" className={`${styles['iv']} ${i === interval ? styles['ivOn'] : ''}`} aria-pressed={i === interval} onClick={() => onInterval(i)}>
            {i}
          </button>
        ))}
      </div>
      ) : null}
    </div>
  );
}
