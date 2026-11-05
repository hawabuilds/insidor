/**
 * How auto buy writes its numbers (AutoBuySheet.tsx, AutoBuyStrip.tsx): SOL from lamports, a market
 * cap limit, how long it stays on. Apart from the sheet so `node --test` holds them.
 *
 * What breaks if changed carelessly: SOL is shown from whole lamports, never rounded up into an
 * amount the person did not choose.
 */

const LAMPORTS = 1_000_000_000;

/** "0.5", "0.25", "0.000255": SOL from lamports, trailing zeros dropped. */
export function solOf(lamports: number): string {
  const sol = lamports / LAMPORTS;
  const places = sol >= 0.01 ? 4 : 6;
  return sol.toFixed(places).replace(/\.?0+$/, '');
}

/** "$50K", "$1M": a market cap limit as the choices write it. */
export function capOf(usd: number): string {
  return usd >= 1_000_000 ? `$${usd / 1_000_000}M` : `$${Math.round(usd / 1_000)}K`;
}

/** "24 hours", "3 days". */
export function activeOf(ms: number): string {
  const h = Math.round(ms / 3_600_000);
  return h < 48 ? `${h} hours` : `${Math.round(h / 24)} days`;
}
