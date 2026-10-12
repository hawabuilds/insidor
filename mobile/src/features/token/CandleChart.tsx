/**
 * The candle view: one bar per period from the same candles the line is drawn from — open,
 * high, low and close — green when a period closed above where it opened, red when below, as
 * Trador draws them. The line view is the closes; this is the whole of each period.
 *
 * Scaled to the lowest low and highest high in view, so a wick is never clipped. A period with
 * no trades is not in the data and is not drawn — a gap is a gap, never a flat candle at the
 * last price.
 */

import type { Candle } from '../../shared/api/index.ts';
import styles from './token.module.css';

const W = 346;
const H = 190;
const PAD = 6;

export function CandleChart({ candles }: { candles: readonly Candle[] }) {
  if (candles.length < 2) return null;
  const low = Math.min(...candles.map((c) => c.l));
  const high = Math.max(...candles.map((c) => c.h));
  const range = high - low || 1;
  const y = (v: number) => H - PAD - ((v - low) / range) * (H - 2 * PAD);
  const slot = W / candles.length;
  const body = Math.max(1, slot * 0.6);
  return (
    <svg className={styles['chart']} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Price, candles">
      {candles.map((c, i) => {
        const up = c.c >= c.o;
        const colour = up ? 'var(--up)' : 'var(--down)';
        const x = i * slot + slot / 2;
        const top = y(Math.max(c.o, c.c));
        const bottom = y(Math.min(c.o, c.c));
        return (
          <g key={c.t}>
            <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={colour} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <rect x={x - body / 2} y={top} width={body} height={Math.max(1, bottom - top)} fill={colour} />
          </g>
        );
      })}
    </svg>
  );
}
