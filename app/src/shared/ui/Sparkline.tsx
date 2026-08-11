/**
 * The small line graph on a feed row.
 *
 * The important behaviour is what it does with a hole. A censored reading — the counter was
 * quantized and the change fell below the rounding step — arrives as `value: null`, meaning
 * nothing was learned. Drawing that as a point at zero would draw a cliff, and a cliff reads
 * as collapse on a chart whose whole job is to show acceleration. So a null BREAKS THE LINE:
 * the graph shows two segments with a gap, which is what actually happened.
 *
 * Fewer than two known points is not a flat line at zero either. It is a dim "no reading
 * yet", because a flat line is a claim about stability and we have not made a reading.
 *
 * Drawn as inline SVG with no charting library: it is 40 lines of arithmetic, it renders
 * sixty times per tick, and a library here would be the largest dependency in the app.
 */

import styles from './primitives.module.css';

/**
 * Declared here rather than imported from the wire vocabulary, because `ui/` is a leaf: it
 * knows shapes, never the domain. These are structurally identical to `SparkPoint` and
 * `Tone`, so a wire value passes straight in and the compiler still checks it — but this
 * directory stays importable from anywhere without dragging the API layer along.
 */
export interface SparkPoint {
  readonly atMs: number;
  readonly value: number | null;
}

export type Tone = 'rising' | 'steady' | 'cooling';

const WIDTH = 96;
const HEIGHT = 24;
const PAD = 2;

function strokeFor(tone: Tone | null): string {
  switch (tone) {
    case 'rising':
      return 'var(--lime)';
    case 'cooling':
      return 'var(--red)';
    case 'steady':
      return 'var(--text-2)';
    default:
      return 'var(--text-3)';
  }
}

/** Split into runs of consecutive known points. Each run becomes its own polyline. */
function runs(points: readonly SparkPoint[]): { atMs: number; value: number }[][] {
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
  tone,
  label,
}: {
  points: readonly SparkPoint[];
  windowMs: number;
  tone: Tone | null;
  label: string;
}) {
  const segments = runs(points);
  const known = segments.flat();

  if (known.length < 2) {
    return (
      <span className={styles['sparkEmpty']} title="not enough readings yet">
        no reading
      </span>
    );
  }

  const lastAt = known[known.length - 1]?.atMs ?? 0;
  /* The x axis is the window the server declared, not the span of the points we happen to
     have. Two points an hour apart must not be drawn as if they filled the whole chart. */
  const startAt = lastAt - windowMs;
  const span = windowMs > 0 ? windowMs : 1;

  let min = Infinity;
  let max = -Infinity;
  for (const p of known) {
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }
  const range = max - min || 1;

  const x = (atMs: number): number => PAD + ((atMs - startAt) / span) * (WIDTH - PAD * 2);
  const y = (v: number): number => HEIGHT - PAD - ((v - min) / range) * (HEIGHT - PAD * 2);

  return (
    <svg
      className={styles['spark']}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      {segments
        .filter((run) => run.length > 1)
        .map((run, i) => (
          <polyline
            key={i}
            fill="none"
            stroke={strokeFor(tone)}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={run.map((p) => `${x(p.atMs).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}
          />
        ))}
    </svg>
  );
}
