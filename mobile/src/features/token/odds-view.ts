/**
 * The launch history's formatting rules, apart from LaunchOdds.tsx so a test can reach them without a JSX
 * loader: a share is a whole percentage, a share under one percent is "<1%" (never "0%", which would say
 * none did), and a share or a time the server did not send is a dash.
 */

/** "31%", "<1%", or a dash when the share was not sent. */
export function sharePercent(share: number | null): string {
  if (share === null) return '—';
  const p = share * 100;
  if (p > 0 && p < 1) return '<1%';
  return `${Math.round(p)}%`;
}

/** A share as a multiple of the average launch's: "4.0×", "17×"; a dash when the average is none or unknown. */
export function timesText(share: number | null, avg: number | null): string {
  if (share === null || avg === null || avg <= 0) return '—';
  const r = share / avg;
  return r >= 10 ? `${Math.round(r)}×` : `${r.toFixed(1)}×`;
}

/** A median time: "40s", "4m", "1h 2m"; a dash when too few launches doubled to say. */
export function peakText(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
