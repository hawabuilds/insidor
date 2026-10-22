/**
 * The small views line on a row, always in purple.
 *
 * Purple and never green or red, because this is a line of VIEWS, not of price: green and red
 * mean price on this screen and nothing else (tokens.css, rule 1). A views line drawn green
 * would read as a coin going up.
 *
 * The behaviour that matters is the desktop sparkline's (`app/src/shared/ui/Sparkline.tsx`):
 * a censored reading arrives as `null` and BREAKS the line rather than dropping it to the
 * floor, because a drop to zero reads as collapse on a chart whose job is to show
 * acceleration. Fewer than two known points is not a flat line either — a flat line is a claim
 * about stability — so NOTHING is drawn. It used to be a grey "—" whose only reason was a hover
 * title ("Not enough readings to draw yet") that a phone never shows, so on a card it read as a
 * missing number beside the views. The views figure next to it is the fact; a line that cannot be
 * drawn is simply absent, not a dash pretending to be a value.
 */

import styles from './ui.module.css';

export interface SparkPoint {
  readonly atMs: number;
  readonly value: number | null;
}

/** Split into runs of consecutive known points; each run is its own line. */
export function runs(points: readonly SparkPoint[]): { atMs: number; value: number }[][] {
  const out: { atMs: number; value: number }[][] = [];
  let current: { atMs: number; value: number }[] = [];
  for (const p of points) {
    if (p.value === null) {
      if (current.length > 0) out.push(current);
      current = [];
      continue;
    }
    current.push({ atMs: p.atMs, value: p.value });
  }
  if (current.length > 0) out.push(current);
  return out;
}

export function Sparkline({
  points,
  windowMs,
  width = 52,
  height = 22,
  label,
}: {
  points: readonly SparkPoint[];
  windowMs: number;
  width?: number;
  height?: number;
  label: string;
}) {
  const segments = runs(points);
  const known = segments.flat();
  if (known.length < 2) return null;

  const pad = 2;
  const lastAt = known[known.length - 1]?.atMs ?? 0;
  /* The x axis is the window the server declared, not the span of the points we happen to
     have: two points an hour apart are not drawn as if they filled the chart. */
  const span = windowMs > 0 ? windowMs : 1;
  const startAt = lastAt - span;
  let min = Infinity;
  let max = -Infinity;
  for (const p of known) {
    min = Math.min(min, p.value);
    max = Math.max(max, p.value);
  }
  const range = max - min || 1;
  const x = (at: number) => pad + ((at - startAt) / span) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / range) * (height - pad * 2);

  return (
    <svg className={styles['spark']} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {segments
        .filter((run) => run.length > 1)
        .map((run, i) => (
          <polyline
            key={i}
            fill="none"
            stroke="var(--brand-300)"
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={run.map((p) => `${x(p.atMs).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}
          />
        ))}
    </svg>
  );
}
