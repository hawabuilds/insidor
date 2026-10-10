/**
 * The price line, coloured by direction over the selected timeframe: green if it ended higher
 * than it started, red if lower. Price is the one line on screen allowed those colours.
 */

import styles from './token.module.css';

const W = 346;
const H = 190;

export function PriceChart({ series, direction }: { series: readonly number[]; direction: 'up' | 'down' | 'flat' }) {
  if (series.length < 2) return null;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const x = (i: number) => (i / (series.length - 1)) * W;
  const y = (v: number) => H - 6 - ((v - min) / range) * (H - 16);
  const line = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const colour = direction === 'down' ? 'var(--down)' : direction === 'up' ? 'var(--up)' : 'var(--text-3)';
  const wash = direction === 'down' ? 'var(--down-wash)' : direction === 'up' ? 'var(--up-wash)' : 'transparent';
  return (
    <svg className={styles['chart']} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Price, ${direction}`}>
      <polygon points={`0,${H} ${line} ${W},${H}`} fill={wash} />
      <polyline points={line} fill="none" stroke={colour} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
