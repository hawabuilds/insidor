/**
 * A round picture, or a monogram on a colour chosen from a stable seed — Trador's Avatar. A
 * picture that fails to load falls back to the monogram, never a broken image.
 *
 * ★ EVERY @HANDLE IS DRAWN WITH ITS PICTURE (the owner, 2026-10-21). The pictures are walked by the
 * shared fallback (shared/ui/usePosterPic.ts over usePictureTries): our stored copy first when the
 * row has one (`file`, a poster's copy), then the link, one retry round later, and the monogram
 * only when every source has failed or there is none.
 */

import { usePosterPic } from '../../shared/ui/usePosterPic.ts';

const GRADIENTS = [
  'linear-gradient(135deg,#9945FF,#5D22A1)',
  'linear-gradient(135deg,#5B8DEF,#1E40AF)',
  'linear-gradient(135deg,#22D3EE,#0E7490)',
  'linear-gradient(135deg,#E879F9,#A21CAF)',
  'linear-gradient(135deg,#F5A524,#B4710C)',
  'linear-gradient(135deg,#8B93A7,#4A5060)',
];

function gradientFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return GRADIENTS[hash % GRADIENTS.length] ?? GRADIENTS[0] ?? '';
}

export function Avatar({ name, seed, src, file = null, size }: { name: string | null; seed: string; src: string | null; file?: string | null; size: number }) {
  const pic = usePosterPic(file, src);
  if (pic.src !== null) {
    return <img key={pic.tryKey} src={pic.src} alt="" width={size} height={size} loading="lazy" decoding="async" onError={pic.onError} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  return (
    <span aria-hidden="true" style={{ width: size, height: size, minWidth: size, background: gradientFor(seed), borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800, fontSize: Math.round(size * 0.4) }}>
      {(name?.trim()?.[0] ?? '?').toUpperCase()}
    </span>
  );
}
