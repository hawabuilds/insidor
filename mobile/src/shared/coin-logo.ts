/**
 * The coin logo's two decisions, apart from the component so `node --test` holds them: which
 * pictures to try and in what order, and the fallback disc's colour.
 *
 * Our storage's copy first (built from the address, never carried in a reply), then the
 * launchpad's own resized copy (built from the address, for the launchpad's coins only), then the
 * coin's own picture; the colour is fixed by the address so a coin's disc never changes between
 * screens. See shared/ui/CoinLogo.tsx for why each.
 *
 * ★ THE LAUNCHPAD'S IMAGE SERVICE ONLY FOR ITS OWN COINS. It answers every address, and one it
 * does not know with a shared placeholder picture — which loads fine, so the browser cannot tell
 * it from a logo and the letter would never show. Its coins carry its address suffix, so only
 * those are sent there. The market source's hosted copy is not tried here at all: the app never
 * shows a source's hosted copy (services/read search.ts), and the server's logo mirror already
 * copies it into our storage when nothing better exists.
 *
 * ★ A CONTENT-ADDRESSED PICTURE IS TRIED ON MORE THAN ONE GATEWAY. The same file sits behind every
 * IPFS gateway, and on 2026-10-13 two of the public ones answered 429 while the launchpad's own
 * served it in a second. So an IPFS link becomes the host it was written on, then the same list
 * the server's logo mirror uses (adapters/venue/solana-pumpfun/src/logo-picture.ts), resized
 * first where the gateway can. Only reached when our copy is missing.
 *
 * What breaks if changed carelessly: the colours exclude green and red, which mean price
 * direction only (tokens.css rule 1). And the gateway list should match the mirror's; a gateway
 * here that the mirror dropped (cloudflare-ipfs.com is retired) is a wasted try on every miss.
 */

/** In the order tried, after the host the link names. Kept equal to the mirror's list. */
export const IPFS_GATEWAYS: readonly string[] = ['https://pump.mypinata.cloud', 'https://ipfs.io', 'https://dweb.link', 'https://gateway.pinata.cloud'];
/** Gateways that resize on request; the small copy is tried before the original. */
const RESIZING_GATEWAYS: readonly string[] = ['https://pump.mypinata.cloud'];
const RESIZED = '?img-width=256&img-height=256&img-format=webp';
/* CIDv0 (base58, 46 chars from "Qm") or CIDv1 in base32 (from "b"), as the server reads them. */
const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,100})$/;

/** The IPFS content id a picture link names, or null. */
export function contentId(link: string): string | null {
  const scheme = /^ipfs:\/\/(?:ipfs\/)?([^/?#]+)/i.exec(link.trim())?.[1];
  if (scheme !== undefined) return CID.test(scheme) ? scheme : null;
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  const path = /^\/ipfs\/([^/?#]+)/.exec(url.pathname)?.[1];
  if (path !== undefined) return CID.test(path) ? path : null;
  const host = /^([^.]+)\.ipfs\./i.exec(url.hostname)?.[1];
  return host !== undefined && CID.test(host) ? host : null;
}

/**
 * The URLs for one picture: itself when it names no content id (a local preview on Create is a
 * blob: link, and stays one), else a chain of gateways.
 */
export function pictureChain(link: string): readonly string[] {
  const cid = contentId(link);
  if (cid === null) return [link];
  const out: string[] = [];
  const add = (u: string) => {
    if (!out.includes(u)) out.push(u);
  };
  const gateway = (g: string) => {
    if (RESIZING_GATEWAYS.includes(g)) add(`${g}/ipfs/${cid}${RESIZED}`);
    add(`${g}/ipfs/${cid}`);
  };
  try {
    const u = new URL(link.trim());
    if (u.protocol === 'https:' && u.pathname.startsWith('/ipfs/')) gateway(u.origin);
  } catch {
    /* ipfs://… names no host to prefer */
  }
  for (const g of IPFS_GATEWAYS) gateway(g);
  return out;
}

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

/** The launchpad's image service, resized on its side to the largest disc the app draws. Kept equal to the mirror's. */
export const LAUNCHPAD_IMAGE = 'https://images.pump.fun/coin-image';
const LAUNCHPAD_SIZE = '256x256';
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * The pictures to try, in order: our copy (when storage is configured), the launchpad's copy (its
 * own coins only), then the coin's own picture through its gateway chain.
 */
export function logoSources(address: string | null, imageUrl: string | null, base: string): readonly string[] {
  const out: string[] = [];
  const valid = address !== null && ADDRESS.test(address);
  if (base !== '' && valid) out.push(`${base}/${address}`);
  if (valid && /pump$/.test(address)) out.push(`${LAUNCHPAD_IMAGE}/${address}?variant=${LAUNCHPAD_SIZE}`);
  if (imageUrl !== null && imageUrl !== '') for (const u of pictureChain(imageUrl)) if (!out.includes(u)) out.push(u);
  return out;
}

/** The letter in the disc: the ticker's first, without a leading $; a question mark when there is none. */
export function logoLetter(ticker: string | null): string {
  return (ticker ?? '').replace(/^\$/, '').trim().charAt(0).toUpperCase() || '?';
}
