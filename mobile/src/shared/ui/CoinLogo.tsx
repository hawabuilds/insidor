/**
 * A COIN'S LOGO, wherever a coin is listed: feed cards, "See N coins", Search, the token page,
 * Portfolio, Alerts, the Create success screen. One component so every surface tries the same
 * pictures in the same order and falls back the same way.
 *
 * In order, each tried only when the one before fails to load, or is still loading on screen after
 * SLOW_MS (a stalled gateway hands over to the next instead of leaving a blank disc):
 *   1. our storage's copy, at `VITE_COIN_LOGO_BASE/<address>` (services/project/src/logos-main.ts
 *      copies the coin's metadata picture there, else the launchpad's copy, else the market's);
 *   2. the coin's own picture as the reply carried it, through a chain of IPFS gateways when it is
 *      content-addressed (shared/coin-logo.ts);
 *   3. Trador's fallback: the ticker's first letter in a circle, on a colour fixed by the address.
 *      Every launchpad coin has a picture, so a letter means every source above failed.
 *
 * ★ "SLOW" IS JUDGED ONLY ON SCREEN. The pictures load lazily, so one below the fold has not
 * started; the timer checks the picture is in view before handing over, and the last source is
 * never abandoned for slowness (only for an error), so a slow picture still beats a letter.
 *
 * ★ THE STORAGE URL IS BUILT HERE FROM THE ADDRESS, NEVER CARRIED IN A REPLY. The censor in
 * shared/api/decode.ts refuses the storage vendor's name inside any value, and a copied logo needs
 * no server to say where it is: the path is the address. Unset, step 1 is skipped.
 *
 * What breaks if changed carelessly: the path must match `COIN_LOGO_FOLDER` in
 * adapters/storage/supabase/src/coin-logo.ts — the base ends in that folder, the file is the
 * address with no extension. And the colours exclude green and red: those mean price direction
 * (tokens.css rule 1), and a coin's disc beside its price must not read as a signal.
 */

import { useEffect, useRef, useState } from 'react';

import { logoGradient, logoLetter, logoSources } from '../coin-logo.ts';

const BASE = ((import.meta.env?.['VITE_COIN_LOGO_BASE'] as string | undefined) ?? '').replace(/\/+$/, '');
/** A picture still loading in view after this long hands over to the next source. */
const SLOW_MS = 3_000;

export function CoinLogo({ address, ticker, imageUrl = null, size }: {
  /** The coin's on-chain address; null when the surface knows only its ticker. */
  address: string | null;
  /** For the letter: the ticker, or the name when there is no ticker. */
  ticker: string | null;
  imageUrl?: string | null;
  size: number;
}) {
  const sources = logoSources(address, imageUrl, BASE);
  const [failed, setFailed] = useState<readonly string[]>([]);
  const shown = sources.find((s) => !failed.includes(s)) ?? null;
  const last = shown !== null && sources.indexOf(shown) === sources.length - 1;
  const img = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (shown === null || last) return;
    let timer = 0;
    const check = () => {
      const el = img.current;
      if (el === null || el.complete) return;
      const r = el.getBoundingClientRect();
      const inView = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
      if (inView) setFailed((f) => (f.includes(shown) ? f : [...f, shown]));
      else timer = window.setTimeout(check, SLOW_MS);
    };
    timer = window.setTimeout(check, SLOW_MS);
    return () => window.clearTimeout(timer);
  }, [shown, last]);
  if (shown !== null) {
    return (
      <img
        ref={img}
        src={shown}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailed((f) => [...f, shown])}
        style={{ width: size, height: size, minWidth: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: 'var(--card)' }}
      />
    );
  }
  const letter = logoLetter(ticker);
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, minWidth: size, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center', background: logoGradient(address ?? ticker ?? '?'), color: '#fff', fontWeight: 800, fontSize: Math.round(size * 0.4) }}
    >
      {letter}
    </span>
  );
}
