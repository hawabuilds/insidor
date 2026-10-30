/**
 * The launch history block's one formatting rule, apart from LaunchOdds.tsx so a test can reach it
 * without a JSX loader: a share is a whole percentage, a share under one percent is "<1%" (never "0%",
 * which would say none did), and a share the server did not send is a dash.
 */

/** "31%", "<1%", or a dash when the share was not sent. */
export function sharePercent(share: number | null): string {
  if (share === null) return '—';
  const p = share * 100;
  if (p > 0 && p < 1) return '<1%';
  return `${Math.round(p)}%`;
}
