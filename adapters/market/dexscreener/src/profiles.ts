/**
 * A coin's face on this vendor: its picture, the links its team gave the vendor, and the day's
 * volume, liquidity and market cap of its deepest pool — many coins a call, keyless.
 *
 * Read by two callers for two different things: the coin-logo mirror (services/project), which
 * copies the picture into our own storage so a feed of logos loads from one place, and the token
 * page's About read (services/read), which shows the links and the day's numbers.
 *
 * Separate from tokens.ts because these fields are the vendor's `info` block, which is a claim
 * made to the vendor by whoever paid to list it, not a market fact; tokens.ts reads only prices.
 *
 * ★ THE PICTURE URL NEVER LEAVES THE SERVER AS-IS. It is a vendor host, and the app's censor
 * throws on this vendor's name inside any value; the mirror copies the bytes and the app loads
 * them from our storage. ★ LINKS ARE KEPT ONLY AS https URLS, typed by kind; anything else (a
 * javascript: link, a relative path) is dropped here, before a caller can render it.
 *
 * What breaks if changed carelessly: the deepest pool wins for the numbers, but the picture and
 * links are taken from whichever pool carries them — a coin's newest pool often has no `info`
 * while its curve pair does, and taking only the deepest would lose a picture that exists.
 */

import { arr, num, rec, str, VendorUnavailable } from '@insidor/vendor-kit';

import { TOKENS_ENDPOINT } from './client.ts';
import { TOKENS_BATCH } from './tokens.ts';

export type ProfileLinkKind = 'x' | 'telegram' | 'website' | 'tiktok' | 'discord';

export interface ProfileLink {
  readonly kind: ProfileLinkKind;
  readonly url: string;
}

export interface CoinProfile {
  /** The vendor's copy of the coin's picture; null when it holds none. */
  readonly imageUrl: string | null;
  /** In the vendor's order, socials first, then websites; never two of the same URL. */
  readonly links: readonly ProfileLink[];
  readonly volume24hUsd: number | null;
  readonly liquidityUsd: number | null;
  readonly marketCapUsd: number | null;
}

const SOCIAL_KIND: Readonly<Record<string, ProfileLinkKind>> = {
  twitter: 'x',
  x: 'x',
  telegram: 'telegram',
  tiktok: 'tiktok',
  discord: 'discord',
};

/** An https URL, normalised; null for anything else. */
export function httpsUrl(v: unknown): string | null {
  const s = str(v);
  if (s === null) return null;
  try {
    const u = new URL(s.trim());
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function linksOf(info: Record<string, unknown>): ProfileLink[] {
  const out: ProfileLink[] = [];
  const seen = new Set<string>();
  const add = (kind: ProfileLinkKind, url: string | null) => {
    if (url === null || seen.has(url)) return;
    seen.add(url);
    out.push({ kind, url });
  };
  for (const s of arr(info.socials)) {
    const r = rec(s);
    const kind = SOCIAL_KIND[(str(r.type) ?? '').toLowerCase()];
    if (kind !== undefined) add(kind, httpsUrl(r.url));
  }
  for (const w of arr(info.websites)) add('website', httpsUrl(rec(w).url));
  return out;
}

/** One profile per coin the reply lists; a coin it does not list is absent. Pure. */
export function readProfiles(raw: unknown): ReadonlyMap<string, CoinProfile> {
  const out = new Map<string, { depth: number; profile: CoinProfile }>();
  for (const p of arr(raw)) {
    const r = rec(p);
    const address = str(rec(r.baseToken).address);
    if (str(r.chainId) !== 'solana' || address === null) continue;
    const info = rec(r.info);
    const depth = num(rec(r.liquidity).usd) ?? -1;
    const held = out.get(address);
    const imageUrl = httpsUrl(info.imageUrl);
    const links = linksOf(info);
    const deeper = held === undefined || depth > held.depth;
    out.set(address, {
      depth: deeper ? depth : (held?.depth ?? -1),
      profile: {
        imageUrl: held?.profile.imageUrl ?? imageUrl,
        links: held !== undefined && held.profile.links.length > 0 ? held.profile.links : links,
        volume24hUsd: deeper ? num(rec(r.volume).h24) : (held?.profile.volume24hUsd ?? null),
        liquidityUsd: deeper ? (depth >= 0 ? depth : null) : (held?.profile.liquidityUsd ?? null),
        marketCapUsd: deeper ? (num(r.marketCap) ?? num(r.fdv)) : (held?.profile.marketCapUsd ?? null),
      },
    });
  }
  return new Map([...out].map(([a, v]) => [a, v.profile]));
}

/** Profiles for many coins, a batch a call. Throws on an outage; never answers "no profiles". */
export function dexscreenerProfiles(config: { readonly baseUrl: string; readonly fetch: typeof globalThis.fetch; readonly timeoutMs: number }) {
  return {
    batch: TOKENS_BATCH,
    async profiles(addresses: readonly string[]): Promise<ReadonlyMap<string, CoinProfile>> {
      const out = new Map<string, CoinProfile>();
      for (let i = 0; i < addresses.length; i += TOKENS_BATCH) {
        const slice = addresses.slice(i, i + TOKENS_BATCH);
        let response: Response;
        try {
          response = await config.fetch(`${config.baseUrl.replace(/\/+$/, '')}/tokens/v1/solana/${slice.map(encodeURIComponent).join(',')}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(config.timeoutMs) });
        } catch (error) {
          throw new VendorUnavailable('dexscreener', TOKENS_ENDPOINT, `request failed: ${error instanceof Error ? error.message : 'unknown'}`);
        }
        if (!response.ok) throw new VendorUnavailable('dexscreener', TOKENS_ENDPOINT, `responded ${response.status}`, response.status);
        for (const [a, p] of readProfiles(await response.json())) out.set(a, p);
      }
      return out;
    },
  };
}
