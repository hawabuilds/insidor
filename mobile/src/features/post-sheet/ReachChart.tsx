/**
 * THE POST'S VIEWS OVER TIME, as the post sheet draws them: one purple line over a filled area,
 * max, half and 0 on the right with light gridlines, three times underneath, dotted markers where
 * we found the post and where its first coin launched, and a dot on the latest reading.
 *
 * Every point is one of our own view readings (`sheet-view.ts chartPlan`); a reading the source
 * rounded away is stepped over, so the line never breaks and never drops to the floor. With fewer
 * than two counted readings there is no chart at all — the caller is handed null and draws nothing.
 *
 * Each dotted marker carries a small "Found" or "Coin" label at its top, on whichever side has
 * room; when the two would sit on top of each other, Coin's label drops a line, so the two can
 * always be told apart even when both fall at the right edge.
 *
 * The lines are an SVG stretched to the box; the dots and labels are HTML laid over it at the same
 * fractions, so a circle stays a circle at any phone width.
 */

import { compact } from '../../shared/format/number.ts';
import { areaPath, linePath, type ChartPlan } from './sheet-view.ts';
import styles from './post-sheet.module.css';

const W = 300;
const H = 100;
/** Markers closer than this share of the width would have their labels collide. */
const CROWDED = 0.16;
/** A marker this near the right edge puts its label on its left. */
const LABEL_ROOM = 0.18;
/** How far a crowded Coin label drops below the Found one, in pixels. */
const LABEL_LINE = 17;

function timeLabel(at: number, now: number): string {
  if (now - at < 2 * 60_000) return 'Now';
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function ReachChart({ plan, now, height }: { plan: ChartPlan; now: number; height: number }) {
  const pct = (f: number) => `${(f * 100).toFixed(2)}%`;
  return (
    <div className={styles['chart']}>
      <div className={styles['chartRow']}>
        <div className={styles['plot']} style={{ height }}>
          <svg className={styles['plotSvg']} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="reachFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#9945FF" stopOpacity="0.38" />
                <stop offset="100%" stopColor="#9945FF" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 0.5, 1].map((g) => (
              <line key={g} x1="0" x2={W} y1={H - g * H} y2={H - g * H} className={styles['grid']} vectorEffect="non-scaling-stroke" />
            ))}
            {plan.markers.map((m) => (
              <line key={m.kind} x1={m.x * W} x2={m.x * W} y1="0" y2={H} className={styles['marker']} vectorEffect="non-scaling-stroke" />
            ))}
            <path d={areaPath(plan.points, W, H)} fill="url(#reachFill)" />
            <path d={linePath(plan.points, W, H)} className={styles['line']} vectorEffect="non-scaling-stroke" />
          </svg>
          {plan.markers.filter((m) => m.onLine).map((m) => (
            <span key={m.kind} className={styles['markDot']} style={{ left: pct(m.x), bottom: pct(markerY(plan, m.x)) }} title={m.kind === 'found' ? 'Found' : 'First coin'} />
          ))}
          <span className={styles['lastDot']} style={{ left: pct(plan.last.x), bottom: pct(plan.last.y) }} />
          {plan.markers.map((m) => {
            const other = plan.markers.find((o) => o.kind !== m.kind);
            const crowded = other !== undefined && Math.abs(other.x - m.x) < CROWDED;
            const leftward = m.x > 1 - LABEL_ROOM;
            return (
              <span
                key={`l-${m.kind}`}
                className={`${styles['markLabel']} ${leftward ? styles['markLabelLeft'] : ''}`}
                style={{ left: pct(m.x), top: crowded && m.kind === 'coin' ? LABEL_LINE : 0 }}
              >
                {m.kind === 'found' ? 'Found' : 'Coin'}
              </span>
            );
          })}
        </div>
        <div className={styles['axis']} style={{ height }} aria-hidden="true">
          <span>{compact(plan.max)}</span>
          <span>{compact(plan.max / 2)}</span>
          <span>0</span>
        </div>
      </div>
      <div className={styles['times']} aria-hidden="true">
        {plan.times.map((t) => <span key={t.x}>{timeLabel(t.at, now)}</span>)}
      </div>
    </div>
  );
}

/** Where the line is at `x`, so a marker's dot sits on it: between the two points around it. */
function markerY(plan: ChartPlan, x: number): number {
  const pts = plan.points.filter((p): p is { x: number; y: number } => p !== null);
  let prev = pts[0];
  for (const p of pts) {
    if (p.x >= x) {
      if (prev === undefined || p.x === prev.x) return p.y;
      return prev.y + ((p.y - prev.y) * (x - prev.x)) / (p.x - prev.x);
    }
    prev = p;
  }
  return prev?.y ?? 0;
}
