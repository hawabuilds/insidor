/**
 * The coin logo's two decisions, apart from the component so `node --test` holds them: which
 * pictures to try and in what order, and the fallback disc's colour.
 *
 * Our storage's copy first (built from the address, never carried in a reply), then the coin's
 * own picture; the colour is fixed by the address so a coin's disc never changes between
 * screens. See shared/ui/CoinLogo.tsx for why each.
 *
 * What breaks if changed carelessly: the colours exclude green and red, which mean price
 * direction only (tokens.css rule 1).
 */

/** Trador's monogram colours (ui/Avatar.tsx): Solana purple first, then five far from green and red. */
const GRADIENTS = [
  'linear-gradient(135deg,#9945FF,#5D22A1)',
  'linear-gradient(135deg,#5B8DEF,#1E40AF)',
  'linear-gradient(135deg,#22D3EE,#0E7490)',
  'linear-gradient(135deg,#E879F9,#A21CAF)',
  'linear-gradient(135deg,#F5A524,#B4710C)',
  'linear-gradient(135deg,#8B93A7,#4A5060)',
];

export function logoGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return GRADIENTS[hash % GRADIENTS.length] ?? GRADIENTS[0] ?? '';
}

/** The pictures to try, in order: our copy (when storage is configured), then the coin's own. */
export function logoSources(address: string | null, imageUrl: string | null, base: string): readonly string[] {
  const out: string[] = [];
  if (base !== '' && address !== null && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) out.push(`${base}/${address}`);
  if (imageUrl !== null && imageUrl !== '' && !out.includes(imageUrl)) out.push(imageUrl);
  return out;
}

/** The letter in the disc: the ticker's first, without a leading $; a question mark when there is none. */
export function logoLetter(ticker: string | null): string {
  return (ticker ?? '').replace(/^\$/, '').trim().charAt(0).toUpperCase() || '?';
}
