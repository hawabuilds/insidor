/**
 * A wallet's value over time — Trador's BalanceChart, ported as is: a plain SVG area, no chart
 * library, stretched to the column.
 *
 *   1. The baseline is the lowest point in view, not zero, padded so the low point is not welded
 *      to the bottom edge: a wallet moving between $980 and $1,020 is a flat line against zero.
 *   2. The colour comes from first to last point, not the last tick: a line green because the
 *      latest point ticked up while the window is down tells the wrong story about the window.
 *
 * Scrubbing reports the point under the finger, so the header can show "Value at" that moment.
 */

import { useMemo, useState } from 'react';


import type { BalancePoint } from './balance-points.ts';

const W = 1000;
const H = 300;

export function BalanceChart({ points, height, onScrub }: { points: readonly BalancePoint[]; height: number; onScrub: (p: BalancePoint | null) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const geometry = useMemo(() => {
    if (points.length === 0) return null;
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    /* A flat series has no range; a nominal span centres it instead of dividing by zero. */
    const span = max - min || Math.max(max * 0.02, 1);
    const floor = min - span * 0.15;
    const ceiling = max + span * 0.15;
    const x = (i: number) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * W);
    const y = (v: number) => H - ((v - floor) / (ceiling - floor)) * H;
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ');
    const first = points[0]?.value ?? 0;
    const last = points[points.length - 1]?.value ?? 0;
    return { line, area: `${line} L${W},${H} L0,${H} Z`, x, y, rising: last >= first };
  }, [points]);
  if (geometry === null) return null;

  const stroke = geometry.rising ? 'var(--up)' : 'var(--down)';
  const gradient = `balance-fill-${geometry.rising ? 'up' : 'down'}`;
  const hovered = hover === null ? null : points[hover] ?? null;
  const pick = (ratio: number) => {
    const i = Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
    setHover(i);
    onScrub(points[i] ?? null);
  };

  return (
    <div style={{ position: 'relative', height }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%', touchAction: 'none', display: 'block' }}
        role="img"
        aria-label="Wallet value over time"
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          if (box.width > 0) pick((e.clientX - box.left) / box.width);
        }}
        onPointerLeave={() => {
          setHover(null);
          onScrub(null);
        }}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.26" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={geometry.area} fill={`url(#${gradient})`} />
        <path d={geometry.line} fill="none" stroke={stroke} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hovered !== null && hover !== null ? (
          <line x1={geometry.x(hover)} y1={0} x2={geometry.x(hover)} y2={H} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>
      {/* A separate dot: inside a stretched viewBox a circle draws as an ellipse. */}
      {hovered !== null && hover !== null ? (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', left: `${(geometry.x(hover) / W) * 100}%`, top: `${(geometry.y(hovered.value) / H) * 100}%`,
            width: 10, height: 10, borderRadius: '50%', background: stroke, transform: 'translate(-50%, -50%)', boxShadow: '0 0 0 2px var(--bg)', pointerEvents: 'none',
          }}
        />
      ) : null}
    </div>
  );
}
