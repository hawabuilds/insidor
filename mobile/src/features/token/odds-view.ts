/**
 * The similar-launches card's formatting and colour rules, apart from LaunchOdds.tsx so a test can reach
 * them without a JSX loader. A share is a whole percentage (one decimal under 1%, "<0.1%" for a sliver,
 * never "0%" for one that happened); a share or time not sent is a dash. A value is coloured only when it
 * is clearly better or worse than usual: `CLEARLY` times as good, or as bad.
 */

/** "Clearly" better or worse: half again as much, or two thirds as little. */
const CLEARLY = 1.5;

/** "31%", "0.8%", "<0.1%", or a dash when the share was not sent. */
export function sharePercent(share: number | null): string {
  if (share === null) return '—';
  const p = share * 100;
  if (p > 0 && p < 0.1) return '<0.1%';
  if (p > 0 && p < 1) return `${p.toFixed(1)}%`;
  return `${Math.round(p)}%`;
}

/** A peak time: "40s", "4m", "1h 52m", "2d 3h"; a dash when not measured or too few launches doubled. */
export function peakText(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** The same, rounded for the top line: "~40m", "~6h", "~2d"; a dash when not measured. */
export function peakAbout(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 3_600) return `~${Math.max(1, Math.round(seconds / 60))}m`;
  if (seconds < 172_800) return `~${Math.round(seconds / 3_600)}h`;
  return `~${Math.round(seconds / 86_400)}d`;
}

/** 'good', 'bad' or '' (white): whether this coin's value is clearly better or worse than usual. */
export function better(mine: number | null, usual: number | null, moreIsGood: boolean): 'good' | 'bad' | '' {
  if (mine === null || usual === null || usual <= 0) return '';
  const r = mine / usual;
  if (r >= CLEARLY) return moreIsGood ? 'good' : 'bad';
  if (r <= 1 / CLEARLY) return moreIsGood ? 'bad' : 'good';
  return '';
}
